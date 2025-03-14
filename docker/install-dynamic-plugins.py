import copy
from enum import StrEnum
import hashlib
import json
import os
import sys
import tempfile
import yaml
import tarfile
import shutil
import subprocess
import base64
import binascii
import atexit
import time
import signal
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

class PullPolicy(StrEnum):
    IF_NOT_PRESENT = 'IfNotPresent'
    ALWAYS = 'Always'
    # NEVER = 'Never' not needed

class InstallException(Exception):
    """Exception class from which every exception in this library will derive."""
    pass

RECOGNIZED_ALGORITHMS = (
    'sha512',
    'sha384',
    'sha256',
)

def merge(source, destination, prefix=''):
    for key, value in source.items():
        if isinstance(value, dict):
            node = destination.setdefault(key, {})
            merge(value, node, prefix + key + '.')
        else:
            if key in destination and destination[key] != value:
                raise InstallException(
                    f"Config key '{prefix + key}' defined differently for 2 dynamic plugins"
                )
            destination[key] = value
    return destination

def maybeMergeConfig(config, globalConfig):
    if config is not None and isinstance(config, dict):
        print('\t==> Merging plugin-specific configuration', flush=True)
        return merge(config, globalConfig)
    return globalConfig


# ================== OCI DOWNLOADER ==================
class OciDownloader:
    def __init__(self, destination: str):
        self._skopeo = shutil.which('skopeo')
        if self._skopeo is None:
            raise InstallException('skopeo executable not found in PATH')

        self.tmp_dir_obj = tempfile.TemporaryDirectory()
        self.tmp_dir = self.tmp_dir_obj.name
        self.image_to_tarball = {}
        self.destination = destination

    def skopeo(self, command):
        rv = subprocess.run([self._skopeo] + command, check=True, capture_output=True)
        if rv.returncode != 0:
            raise InstallException(f'Error while running skopeo command: {rv.stderr}')
        return rv.stdout

    def get_plugin_tar(self, image: str) -> str:
        if image not in self.image_to_tarball:
            print(f'\t==> Copying image {image} to local filesystem', flush=True)
            image_digest = hashlib.sha256(
                image.encode('utf-8'), usedforsecurity=False
            ).hexdigest()
            local_dir = os.path.join(self.tmp_dir, image_digest)
            # replace oci:// prefix with docker://
            image_url = image.replace('oci://', 'docker://')
            self.skopeo(['copy', image_url, f'dir:{local_dir}'])
            manifest_path = os.path.join(local_dir, 'manifest.json')
            manifest = json.load(open(manifest_path))
            # get the first layer of the image
            layer = manifest['layers'][0]['digest']
            (_sha, filename) = layer.split(':')
            local_path = os.path.join(local_dir, filename)
            self.image_to_tarball[image] = local_path

        return self.image_to_tarball[image]

    def extract_plugin(self, tar_file: str, plugin_path: str) -> None:
        with tarfile.open(tar_file, 'r:gz') as tar: # NOSONAR
            filesToExtract = []
            max_size = int(os.environ.get('MAX_ENTRY_SIZE', 20000000))
            for member in tar.getmembers():
                if not member.name.startswith(plugin_path):
                    continue
                # zip bomb protection
                if member.size > max_size:
                    raise InstallException('Zip bomb detected in ' + member.name)

                if member.islnk() or member.issym():
                    realpath = os.path.realpath(os.path.join(plugin_path, *os.path.split(member.linkname)))
                    if not realpath.startswith(plugin_path):
                        print(
                            '\t==> WARNING: skipping file containing link outside of the archive: '
                            f'{member.name} -> {member.linkpath}'
                        )
                        continue

                filesToExtract.append(member)
            tar.extractall(os.path.abspath(self.destination), members=filesToExtract, filter='tar')

    def download(self, package: str) -> str:
        """
        Baixa a imagem e extrai apenas o diretório plugin_path.
        Retorna o plugin_path.
        """
        image, plugin_path = package.split('!')
        tar_file = self.get_plugin_tar(image)
        plugin_directory = os.path.join(self.destination, plugin_path)
        if os.path.exists(plugin_directory):
            print('\t==> Removing previous plugin directory', plugin_directory, flush=True)
            shutil.rmtree(plugin_directory, ignore_errors=True, onerror=None)
        self.extract_plugin(tar_file=tar_file, plugin_path=plugin_path)
        return plugin_path

    def digest(self, package: str) -> str:
        image, _ = package.split('!')
        image_url = image.replace('oci://', 'docker://')
        output = self.skopeo(['inspect', image_url])
        data = json.loads(output)
        # OCI artifact digest field is "hashmethod:hash"
        digest = data['Digest'].split(':')[1]
        return f"{digest}"


# ================== INTEGRITY CHECK ==================
def verify_package_integrity(plugin: dict, archive: str, working_directory: str) -> None:
    package = plugin['package']
    if 'integrity' not in plugin:
        raise InstallException(f'Package integrity for {package} is missing')

    integrity = plugin['integrity']
    if not isinstance(integrity, str):
        raise InstallException(f'Package integrity for {package} must be a string')

    algorithm_hash = integrity.split('-')
    if len(algorithm_hash) != 2:
        raise InstallException(
            f'Package integrity for {package} must be <algorithm>-<hash>'
        )

    algorithm, hash_digest = algorithm_hash
    if algorithm not in RECOGNIZED_ALGORITHMS:
        raise InstallException(
            f'{package}: Provided Package integrity algorithm {algorithm} not supported. '
            f'Use one of: {RECOGNIZED_ALGORITHMS}'
        )

    try:
        base64.b64decode(hash_digest, validate=True)
    except binascii.Error:
        raise InstallException(
            f'{package}: Provided Package integrity hash {hash_digest} is not valid base64'
        )

    cat_process = subprocess.Popen(["cat", archive], stdout=subprocess.PIPE)
    openssl_dgst_process = subprocess.Popen(
        ["openssl", "dgst", "-" + algorithm, "-binary"],
        stdin=cat_process.stdout,
        stdout=subprocess.PIPE
    )
    openssl_base64_process = subprocess.Popen(
        ["openssl", "base64", "-A"],
        stdin=openssl_dgst_process.stdout,
        stdout=subprocess.PIPE
    )

    output, _ = openssl_base64_process.communicate()
    result_hash = output.decode('utf-8').strip()
    if hash_digest != result_hash:
        raise InstallException(
            f'{package}: Hash mismatch: {result_hash} != {hash_digest}'
        )

# ================== LOCKING ==================
def create_lock(lock_file_path):
    while True:
        try:
            with open(lock_file_path, 'x'):
                print(f"======= Created lock file: {lock_file_path}")
                return
        except FileExistsError:
            wait_for_lock_release(lock_file_path)

def remove_lock(lock_file_path):
    if os.path.exists(lock_file_path):
        os.remove(lock_file_path)
        print(f"======= Removed lock file: {lock_file_path}")

def wait_for_lock_release(lock_file_path):
    print(f"======= Waiting for lock release (file: {lock_file_path})...", flush=True)
    while True:
        if not os.path.exists(lock_file_path):
            break
        time.sleep(1)
    print("======= Lock released.")


# ================== PLUGIN INSTALL LOGIC (ASYNC WRAPPER) ==================
def install_plugin(plugin, dynamicPluginsRoot, skipIntegrityCheck, maxEntrySize, plugin_path_by_hash, oci_downloader):
    """
    Função chamada em paralelo para instalar *um* plugin:
      - Baixa OCI ou NPM
      - Faz verificação de integridade (se aplicável)
      - Retorna o 'plugin_path' instalado e o pluginConfig.
    """
    package = plugin['package']
    plugin_hash = plugin['hash']
    # Para sabermos se instalamos ou não esse plugin (caso skip for IF_NOT_PRESENT)
    installed_plugin_path = None

    # 1) Verifica se é OCI ou NPM
    if package.startswith('oci://'):
        # Determina pull policy (se for :latest!, default = ALWAYS)
        if ':latest!' in package:
            default_policy = PullPolicy.ALWAYS
        else:
            default_policy = PullPolicy.IF_NOT_PRESENT

        pull_policy = plugin.get('pullPolicy', default_policy)
        if isinstance(pull_policy, str):
            pull_policy = PullPolicy(pull_policy)

        if plugin_hash in plugin_path_by_hash and pull_policy == PullPolicy.IF_NOT_PRESENT:
            # Pula download, já está instalado
            print(f'\n======= Skipping download of already installed OCI plugin {package}', flush=True)
            old_path = plugin_path_by_hash.pop(plugin_hash)
            return old_path, plugin.get('pluginConfig')

        # Se pull_policy for ALWAYS, checa digest
        if plugin_hash in plugin_path_by_hash and pull_policy == PullPolicy.ALWAYS:
            old_path = plugin_path_by_hash.pop(plugin_hash)
            digest_file_path = os.path.join(
                dynamicPluginsRoot,
                old_path,
                'dynamic-plugin-image.hash'
            )
            local_image_digest = None
            if os.path.isfile(digest_file_path):
                with open(digest_file_path, 'r') as f:
                    local_image_digest = f.read().strip()

            remote_digest = oci_downloader.digest(package)
            if remote_digest == local_image_digest:
                print(f'\n======= Skipping download of already installed OCI plugin {package}', flush=True)
                return old_path, plugin.get('pluginConfig')
            else:
                print(f'\n======= Installing dynamic plugin (OCI, updated digest) {package}', flush=True)
        else:
            print(f'\n======= Installing dynamic OCI plugin {package}', flush=True)

        # De fato faz download
        installed_plugin_path = oci_downloader.download(package)

        # Salva o digest em um arquivo
        digest_file_path = os.path.join(
            dynamicPluginsRoot,
            installed_plugin_path,
            'dynamic-plugin-image.hash'
        )
        with open(digest_file_path, 'w') as f:
            f.write(oci_downloader.digest(package))

    else:
        # NPM plugin
        pull_policy = plugin.get('pullPolicy', PullPolicy.IF_NOT_PRESENT)
        if isinstance(pull_policy, str):
            pull_policy = PullPolicy(pull_policy)

        # Se já tem hash e pullpolicy=IF_NOT_PRESENT => skip
        if plugin_hash in plugin_path_by_hash:
            old_path = plugin_path_by_hash.pop(plugin_hash)
            force_download = plugin.get('forceDownload', False)
            if pull_policy == PullPolicy.ALWAYS or force_download:
                print(f'\n======= Forcing download of already installed NPM plugin {package}', flush=True)
            else:
                print(f'\n======= Skipping download of already installed NPM plugin {package}', flush=True)
                return old_path, plugin.get('pluginConfig')
        else:
            print(f'\n======= Installing dynamic NPM plugin {package}', flush=True)

        package_is_local = package.startswith('./')
        if (not package_is_local
            and not skipIntegrityCheck
            and 'integrity' not in plugin):
            raise InstallException(f'No integrity hash provided for Package {package}')

        # Ajusta se local
        if package_is_local:
            package = os.path.join(os.getcwd(), package[2:])

        print('\t==> Grabbing package archive through `npm pack`', flush=True)
        completed = subprocess.run(
            ['npm', 'pack', package],
            capture_output=True,
            cwd=dynamicPluginsRoot
        )
        if completed.returncode != 0:
            raise InstallException(
                f'Error while installing plugin {package} with npm pack: '
                + completed.stderr.decode('utf-8')
            )

        archive = os.path.join(
            dynamicPluginsRoot, completed.stdout.decode('utf-8').strip()
        )

        if not package_is_local and not skipIntegrityCheck:
            print('\t==> Verifying package integrity', flush=True)
            verify_package_integrity(plugin, archive, dynamicPluginsRoot)

        # Normalmente o nome do dir = <nome-0.0.1>, sem .tgz
        directory = archive.replace('.tgz', '')
        directoryRealpath = os.path.realpath(directory)
        installed_plugin_path = os.path.basename(directoryRealpath)

        if os.path.exists(directory):
            print('\t==> Removing previous plugin directory', directory, flush=True)
            shutil.rmtree(directory, ignore_errors=True, onerror=None)
        os.mkdir(directory)

        print('\t==> Extracting package archive', archive, flush=True)
        with tarfile.open(archive, 'r:gz') as file:
            for member in file.getmembers():
                if member.isreg():
                    if not member.name.startswith('package/'):
                        raise InstallException(
                            f'NPM package archive does not start with \"package/\": {member.name}'
                        )

                    if member.size > maxEntrySize:
                        raise InstallException('Zip bomb detected in ' + member.name)

                    # remove prefixo
                    member.name = member.name.removeprefix('package/')
                    file.extract(member, path=directory, filter='tar')
                elif member.isdir():
                    print('\t\tSkipping directory entry', member.name, flush=True)
                elif member.islnk() or member.issym():
                    if not member.linkpath.startswith('package/'):
                        raise InstallException(
                            f'NPM package link outside of archive: {member.name} -> {member.linkpath}'
                        )
                    member.name = member.name.removeprefix('package/')
                    member.linkpath = member.linkpath.removeprefix('package/')
                    realpath = os.path.realpath(
                        os.path.join(directory, *os.path.split(member.linkname))
                    )
                    if not realpath.startswith(directoryRealpath):
                        raise InstallException(
                            f'NPM package link outside of archive: {member.name} -> {member.linkpath}'
                        )
                    file.extract(member, path=directory, filter='tar')
                else:
                    # se for CHRTYPE, BLKTYPE, etc
                    raise InstallException(
                        f'NPM package archive contains special file: {member.name}'
                    )

        print('\t==> Removing package archive', archive, flush=True)
        os.remove(archive)

    # Independente de ser OCI ou NPM, grava dynamic-plugin-config.hash
    hash_file_path = os.path.join(dynamicPluginsRoot, installed_plugin_path, 'dynamic-plugin-config.hash')
    with open(hash_file_path, 'w') as digest_file:
        digest_file.write(plugin_hash)

    print('\t==> Successfully installed dynamic plugin', package, flush=True)
    return installed_plugin_path, plugin.get('pluginConfig')


# ================== MAIN ==================
def main():
    start_time = datetime.now()

    if len(sys.argv) < 2:
        raise InstallException(
            'Usage: python script.py <dynamicPluginsRoot>'
        )

    dynamicPluginsRoot = sys.argv[1]

    # Lock
    lock_file_path = os.path.join(dynamicPluginsRoot, 'install-dynamic-plugins.lock')
    atexit.register(remove_lock, lock_file_path)
    signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(0))
    create_lock(lock_file_path)

    try:
        maxEntrySize = int(os.environ.get('MAX_ENTRY_SIZE', 20000000))
        skipIntegrityCheck = os.environ.get("SKIP_INTEGRITY_CHECK", "").lower() == "true"

        dynamicPluginsFile = 'dynamic-plugins.yaml'
        dynamicPluginsGlobalConfigFile = os.path.join(dynamicPluginsRoot, 'app-config.dynamic-plugins.yaml')

        if not os.path.isfile(dynamicPluginsFile):
            print(f"No {dynamicPluginsFile} file found. Skipping dynamic plugins installation.")
            with open(dynamicPluginsGlobalConfigFile, 'w') as file:
                file.write('')
            return

        with open(dynamicPluginsFile, 'r') as f:
            content = yaml.safe_load(f)

        if not content:
            print(f"{dynamicPluginsFile} file is empty. Skipping dynamic plugins installation.")
            with open(dynamicPluginsGlobalConfigFile, 'w') as file:
                file.write('')
            return

        if not isinstance(content, dict):
            raise InstallException(f"{dynamicPluginsFile} content must be a YAML object")

        if skipIntegrityCheck:
            print(f"SKIP_INTEGRITY_CHECK={skipIntegrityCheck}, skipping package integrity checks")

        globalConfig = {
            'dynamicPlugins': {
                'rootDirectory': 'dynamic-plugins-root'
            }
        }

        allPlugins = {}
        includes = content.get('includes', [])
        if not isinstance(includes, list):
            raise InstallException(f"content of 'includes' must be a list in {dynamicPluginsFile}")

        # Carrega plugins de includes
        for include in includes:
            if not isinstance(include, str):
                raise InstallException(f"'includes' must contain string file paths, got {include}")
            print('\n======= Including dynamic plugins from', include, flush=True)

            if not os.path.isfile(include):
                raise InstallException(f"File {include} does not exist")

            with open(include, 'r') as incFile:
                includeContent = yaml.safe_load(incFile)

            if not isinstance(includeContent, dict):
                raise InstallException(f"{include} content must be a YAML object")

            includePlugins = includeContent.get('plugins', [])
            if not isinstance(includePlugins, list):
                raise InstallException(f"'plugins' must be a list in {include}")

            for plugin in includePlugins:
                allPlugins[plugin['package']] = plugin

        # Carrega plugins do dynamic-plugins.yaml principal
        plugins = content.get('plugins', [])
        if not isinstance(plugins, list):
            raise InstallException(f"'plugins' must be a list in {dynamicPluginsFile}")

        for plugin in plugins:
            package = plugin['package']
            if package in allPlugins:
                print('\n======= Overriding dynamic plugin configuration', package, flush=True)
                for key, val in plugin.items():
                    if key != 'package':
                        allPlugins[package][key] = val
            else:
                allPlugins[package] = plugin

        # Gera hash de cada plugin
        for plugin in allPlugins.values():
            hash_dict = copy.deepcopy(plugin)
            hash_dict.pop('pluginConfig', None)
            plugin_hash = hashlib.sha256(
                json.dumps(hash_dict, sort_keys=True).encode('utf-8')
            ).hexdigest()
            plugin['hash'] = plugin_hash

        # Lê plugins já instalados
        plugin_path_by_hash = {}
        for dir_name in os.listdir(dynamicPluginsRoot):
            dir_path = os.path.join(dynamicPluginsRoot, dir_name)
            if os.path.isdir(dir_path):
                hash_file_path = os.path.join(dir_path, 'dynamic-plugin-config.hash')
                if os.path.isfile(hash_file_path):
                    with open(hash_file_path, 'r') as hf:
                        hash_val = hf.read().strip()
                        plugin_path_by_hash[hash_val] = dir_name

        # Preparação do downloader (OCI)
        oci_downloader = OciDownloader(dynamicPluginsRoot)

        # Filtra plugins habilitados
        active_plugins = []
        for plugin in allPlugins.values():
            if plugin.get('disabled') is True:
                print('\n======= Skipping disabled dynamic plugin', plugin['package'], flush=True)
            else:
                active_plugins.append(plugin)

        # ================================
        # FASE DE INSTALAÇÃO EM PARALELO
        # ================================
        results = []  # lista de (pluginPathInstalado, pluginConfig)
        exceptions = []

        # Usamos 4 threads ou quantas forem (N) dependendo do seu cenário
        # Se tiver muitas imagens, aumentar. Se tiver poucas, 4 ou 5 é suficiente.
        with ThreadPoolExecutor(max_workers=4) as executor:
            future_to_plugin = {}
            for plugin in active_plugins:
                future = executor.submit(
                    install_plugin,
                    plugin,
                    dynamicPluginsRoot,
                    skipIntegrityCheck,
                    maxEntrySize,
                    plugin_path_by_hash,
                    oci_downloader
                )
                future_to_plugin[future] = plugin['package']

            for future in as_completed(future_to_plugin):
                pkg = future_to_plugin[future]
                try:
                    installed_path, plugin_cfg = future.result()
                    # Guardamos o que precisamos para merges após as threads
                    results.append((installed_path, plugin_cfg))
                except Exception as exc:
                    exceptions.append((pkg, exc))

        # Se houve exceção em alguma thread, exibimos e abortamos
        if exceptions:
            for pkg, exc in exceptions:
                print(f'\n**** ERROR while installing plugin {pkg}: {exc}', flush=True)
            # Caso deseje encerrar com código de erro, ou re-raise:
            raise InstallException('One or more plugins failed to install.')

        # ================================
        # MERGE DE CONFIGs
        # ================================
        for installed_path, plugin_cfg in results:
            if plugin_cfg:
                globalConfig = maybeMergeConfig(plugin_cfg, globalConfig)

        # Salva config global
        yaml.safe_dump(globalConfig, open(dynamicPluginsGlobalConfigFile, 'w'))

        # Remove plugins que restaram em plugin_path_by_hash (significa que eles
        # estavam instalados antes, mas não foram citados agora)
        for outdated_hash, old_plugin_dir in plugin_path_by_hash.items():
            plugin_directory = os.path.join(dynamicPluginsRoot, old_plugin_dir)
            print('\n======= Removing previously installed dynamic plugin', old_plugin_dir, flush=True)
            shutil.rmtree(plugin_directory, ignore_errors=True, onerror=None)

    finally:
        # Mesmo se der erro, remove o lock
        end_time = datetime.now()
        elapsed_time = end_time - start_time
        print(f'Total Execution Time: {elapsed_time}')

if __name__ == '__main__':
    main()
