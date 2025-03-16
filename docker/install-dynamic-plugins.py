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
import threading
import concurrent.futures
import functools
from datetime import datetime



def cache_results(func):
    cache = {}
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        if args not in cache:
            cache[args] = func(*args, **kwargs)
        return cache[args]
    return wrapper

class OciDownloader:
    def __init__(self, destination: str):
        self._skopeo = shutil.which('skopeo')
        if self._skopeo is None:
            raise InstallException('skopeo executable not found in PATH')

        self.tmp_dir_obj = tempfile.TemporaryDirectory()
        self.tmp_dir = self.tmp_dir_obj.name
        self.image_to_tarball = {}
        self.destination = destination

    @cache_results
    def skopeo(self, command):
        rv = subprocess.run([self._skopeo] + command, check=True, capture_output=True)
        if rv.returncode != 0:
            raise InstallException(f'Error while running skopeo command: {rv.stderr}')
        return rv.stdout

    def get_plugin_tar(self, image: str) -> str:
        if image not in self.image_to_tarball:
            print(f'\t==> Copying image {image} to local filesystem', flush=True)
            image_digest = hashlib.sha256(image.encode('utf-8'), usedforsecurity=False).hexdigest()
            local_dir = os.path.join(self.tmp_dir, image_digest)
            image_url = image.replace('oci://', 'docker://')
            self.skopeo(['copy', image_url, f'dir:{local_dir}'])
            manifest_path = os.path.join(local_dir, 'manifest.json')
            manifest = json.load(open(manifest_path))
            layer = manifest['layers'][0]['digest']
            (_sha, filename) = layer.split(':')
            local_path = os.path.join(local_dir, filename)
            self.image_to_tarball[image] = local_path

        return self.image_to_tarball[image]

    def extract_plugin(self, tar_file: str, plugin_path: str) -> None:
        with tarfile.open(tar_file, 'r:gz') as tar: # NOSONAR
            filesToExtract = []
            for member in tar.getmembers():
                if not member.name.startswith(plugin_path):
                    continue
                if member.size > int(os.environ.get('MAX_ENTRY_SIZE', 20000000)):
                    raise InstallException('Zip bomb detected in ' + member.name)
                if member.islnk() or member.issym():
                    realpath = os.path.realpath(os.path.join(plugin_path, *os.path.split(member.linkname)))
                    if not realpath.startswith(plugin_path):
                        print(f'\t==> WARNING: skipping file containing link outside of the archive: ' + member.name + ' -> ' + member.linkpath)
                        continue
                filesToExtract.append(member)
            tar.extractall(os.path.abspath(self.destination), members=filesToExtract, filter='tar')

    def download(self, package: str) -> str:
        (image, plugin_path) = package.split('!')
        tar_file = self.get_plugin_tar(image)
        plugin_directory = os.path.join(self.destination, plugin_path)
        if os.path.exists(plugin_directory):
            print('\t==> Removing previous plugin directory', plugin_directory, flush=True)
            shutil.rmtree(plugin_directory, ignore_errors=True, onerror=None)
        self.extract_plugin(tar_file=tar_file, plugin_path=plugin_path)
        return plugin_path

    def digest(self, package: str) -> str:
        (image, plugin_path) = package.split('!')
        image_url = image.replace('oci://', 'docker://')
        output = self.skopeo(['inspect', image_url])
        data = json.loads(output)
        digest = data['Digest'].split(':')[1]
        return f"{digest}"

def install_plugin(plugin, dynamicPluginsRoot, globalConfig, plugin_path_by_hash, oci_downloader, skipIntegrityCheck, maxEntrySize):
    package = plugin['package']
    if 'disabled' in plugin and plugin['disabled'] is True:
        print('\n======= Skipping disabled dynamic plugin', package, flush=True)
        return globalConfig

    plugin_path = ''
    if package.startswith('oci://'):
        try:
            pull_policy = plugin.get('pullPolicy', PullPolicy.ALWAYS if ':latest!' in package else PullPolicy.IF_NOT_PRESENT)
            if plugin['hash'] in plugin_path_by_hash and pull_policy == PullPolicy.IF_NOT_PRESENT:
                print('\n======= Skipping download of already installed dynamic plugin', package, flush=True)
                plugin_path_by_hash.pop(plugin['hash'])
                return maybeMergeConfig(plugin.get('pluginConfig'), globalConfig)
            if plugin['hash'] in plugin_path_by_hash and pull_policy == PullPolicy.ALWAYS:
                digest_file_path = os.path.join(dynamicPluginsRoot, plugin_path_by_hash.pop(plugin['hash']), 'dynamic-plugin-image.hash')
                local_image_digest = None
                if os.path.isfile(digest_file_path):
                    with open(digest_file_path, 'r') as digest_file:
                        digest_value = digest_file.read().strip()
                        local_image_digest = digest_value
                remote_image_digest = oci_downloader.digest(package)
                if remote_image_digest == local_image_digest:
                    print('\n======= Skipping download of already installed dynamic plugin', package, flush=True)
                    return maybeMergeConfig(plugin.get('pluginConfig'), globalConfig)
                else:
                    print('\n======= Installing dynamic plugin', package, flush=True)
            else:
                print('\n======= Installing dynamic plugin', package, flush=True)

            plugin_path = oci_downloader.download(package)
            digest_file_path = os.path.join(dynamicPluginsRoot, plugin_path, 'dynamic-plugin-image.hash')
            with open(digest_file_path, 'w') as digest_file:
                digest_file.write(oci_downloader.digest(package))
            for key in [k for k, v in plugin_path_by_hash.items() if v == plugin_path]:
                plugin_path_by_hash.pop(key)
        except Exception as e:
            raise InstallException(f"Error while adding OCI plugin {package} to downloader: {e}")
    else:
        plugin_already_installed = False
        pull_policy = plugin.get('pullPolicy', PullPolicy.IF_NOT_PRESENT)
        if plugin['hash'] in plugin_path_by_hash:
            force_download = plugin.get('forceDownload', False)
            if pull_policy == PullPolicy.ALWAYS or force_download:
                print('\n======= Forcing download of already installed dynamic plugin', package, flush=True)
            else:
                print('\n======= Skipping download of already installed dynamic plugin', package, flush=True)
                plugin_already_installed = True
            plugin_path_by_hash.pop(plugin['hash'])
        else:
            print('\n======= Installing dynamic plugin', package, flush=True)

        if plugin_already_installed:
            return maybeMergeConfig(plugin.get('pluginConfig'), globalConfig)

        package_is_local = package.startswith('./')
        if not package_is_local and not skipIntegrityCheck and not 'integrity' in plugin:
            raise InstallException(f"No integrity hash provided for Package {package}")

        if package_is_local:
            package = os.path.join(os.getcwd(), package[2:])

        print('\t==> Grabbing package archive through `npm pack`', flush=True)
        completed = subprocess.run(['npm', 'pack', package], capture_output=True, cwd=dynamicPluginsRoot)
        if completed.returncode != 0:
            raise InstallException(f'Error while installing plugin { package } with \'npm pack\' : ' + completed.stderr.decode('utf-8'))

        archive = os.path.join(dynamicPluginsRoot, completed.stdout.decode('utf-8').strip())

        if not (package_is_local or skipIntegrityCheck):
            print('\t==> Verifying package integrity', flush=True)
            verify_package_integrity(plugin, archive, dynamicPluginsRoot)

        directory = archive.replace('.tgz', '')
        directoryRealpath = os.path.realpath(directory)
        plugin_path = os.path.basename(directoryRealpath)

        if os.path.exists(directory):
            print('\t==> Removing previous plugin directory', directory, flush=True)
            shutil.rmtree(directory, ignore_errors=True, onerror=None)
        os.mkdir(directory)

        print('\t==> Extracting package archive', archive, flush=True)
        file = tarfile.open(archive, 'r:gz') # NOSONAR
        for member in file.getmembers():
            if member.isreg():
                if not member.name.startswith('package/'):
                    raise InstallException("NPM package archive archive does not start with 'package/' as it should: " + member.name)
                if member.size > maxEntrySize:
                    raise InstallException('Zip bomb detected in ' + member.name)
                member.name = member.name.removeprefix('package/')
                file.extract(member, path=directory, filter='tar')
            elif member.isdir():
                print('\t\tSkipping directory entry', member.name, flush=True)
            elif member.islnk() or member.issym():
                if not member.linkpath.startswith('package/'):
                    raise InstallException('NPM package archive contains a link outside of the archive: ' + member.name + ' -> ' + member.linkpath')
                member.name = member.name.removeprefix('package/')
                member.linkpath = member.linkpath.removeprefix('package/')
                realpath = os.path.realpath(os.path.join(directory, *os.path.split(member.linkname)))
                if not realpath.startswith(directoryRealpath):
                    raise InstallException('NPM package archive contains a link outside of the archive: ' + member.name + ' -> ' + member.linkpath)
                file.extract(member, path=directory, filter='tar')
            else:
                if member.type == tarfile.CHRTYPE:
                    type_str = "character device"
                elif member.type == tarfile.BLKTYPE:
                    type_str = "block device"
                elif member.type == tarfile.FIFOTYPE:
                    type_str = "FIFO"
                else:
                    type_str = "unknown"
                raise InstallException('NPM package archive contains a non regular file: ' + member.name + ' - ' + type_str)
        file.close()

        print('\t==> Removing package archive', archive, flush=True)
        os.remove(archive)

    hash = plugin['hash']
    hash_file_path = os.path.join(dynamicPluginsRoot, plugin_path, 'dynamic-plugin-config.hash')
    with open(hash_file_path, 'w') as digest_file:
        digest_file.write(hash)

    if 'pluginConfig' not in plugin:
        print('\t==> Successfully installed dynamic plugin', package, flush=True)
        return globalConfig

    return maybeMergeConfig(plugin.get('pluginConfig'), globalConfig)

def main():
	start_time = datetime.now()

    dynamicPluginsRoot = sys.argv[1]
    lock_file_path = os.path.join(dynamicPluginsRoot, 'install-dynamic-plugins.lock')
    atexit.register(remove_lock, lock_file_path)
    signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(0))
    create_lock(lock_file_path)

    maxEntrySize = int(os.environ.get('MAX_ENTRY_SIZE', 20000000))
    skipIntegrityCheck = os.environ.get("SKIP_INTEGRITY_CHECK", "").lower() == "true"
    dynamicPluginsFile = 'dynamic-plugins.yaml'
    dynamicPluginsGlobalConfigFile = os.path.join(dynamicPluginsRoot, 'app-config.dynamic-plugins.yaml')

    if not os.path.isfile(dynamicPluginsFile):
        print(f"No {dynamicPluginsFile} file found. Skipping dynamic plugins installation.")
        with open(dynamicPluginsGlobalConfigFile, 'w') as file:
            file.write('')
            file.close()
        exit(0)

    globalConfig = {
        'dynamicPlugins': {
            'rootDirectory': 'dynamic-plugins-root'
        }
    }

    with open(dynamicPluginsFile, 'r') as file:
        content = yaml.safe_load(file)

    if content == '' or content is None:
        print(f"{dynamicPluginsFile} file is empty. Skipping dynamic plugins installation.")
        with open(dynamicPluginsGlobalConfigFile, 'w') as file:
            file.write('')
            file.close()
        exit(0)

    if not isinstance(content, dict):
        raise InstallException(f"{dynamicPluginsFile} content must be a YAML object")

    allPlugins = {}
    if skipIntegrityCheck:
        print(f"SKIP_INTEGRITY_CHECK has been set to {skipIntegrityCheck}, skipping integrity check of packages")

    if 'includes' in content:
        includes = content['includes']
    else:
        includes = []

    if not isinstance(includes, list):
        raise InstallException(f"content of the \'includes\' field must be a list in {dynamicPluginsFile}")

    for include in includes:
        if not isinstance(include, str):
            raise InstallException(f"content of the \'includes\' field must be a list of strings in {dynamicPluginsFile}")

        print('\n======= Including dynamic plugins from', include, flush=True)
        if not os.path.isfile(include):
            raise InstallException(f"File {include} does not exist")

        with open(include, 'r') as file:
            includeContent = yaml.safe_load(file)

        if not isinstance(includeContent, dict):
            raise InstallException(f"{include} content must be a YAML object")

        includePlugins = includeContent['plugins']
        if not isinstance(includePlugins, list):
            raise InstallException(f"content of the \'plugins\' field must be a list in {include}")

        for plugin in includePlugins:
            allPlugins[plugin['package']] = plugin

    if 'plugins' in content:
        plugins = content['plugins']
    else:
        plugins = []

    if not isinstance(plugins, list):
        raise InstallException(f"content of the \'plugins\' field must be a list in {dynamicPluginsFile}")

    for plugin in plugins:
        package = plugin['package']
        if not isinstance(package, str):
            raise InstallException(f"content of the \'plugins.package\' field must be a string in {dynamicPluginsFile}")

        if package not in allPlugins:
            allPlugins[package] = plugin
            continue

        print('\n======= Overriding dynamic plugin configuration', package, flush=True)
        for key in plugin:
            if key == 'package':
                continue
            allPlugins[package][key] = plugin[key]

    for plugin in allPlugins.values():
        hash_dict = copy.deepcopy(plugin)
        hash_dict.pop('pluginConfig', None)
        hash = hashlib.sha256(json.dumps(hash_dict, sort_keys=True).encode('utf-8')).hexdigest()
        plugin['hash'] = hash

    plugin_path_by_hash = {}
    for dir_name in os.listdir(dynamicPluginsRoot):
        dir_path = os.path.join(dynamicPluginsRoot, dir_name)
        if os.path.isdir(dir_path):
            hash_file_path = os.path.join(dir_path, 'dynamic-plugin-config.hash')
            if os.path.isfile(hash_file_path):
                with open(hash_file_path, 'r') as hash_file:
                    hash_value = hash_file.read().strip()
                    plugin_path_by_hash[hash_value] = dir_name

    oci_downloader = OciDownloader(dynamicPluginsRoot)

    with concurrent.futures.ThreadPoolExecutor() as executor:
        futures = [
            executor.submit(
                install_plugin, plugin, dynamicPluginsRoot, globalConfig, plugin_path_by_hash, oci_downloader, skipIntegrityCheck, maxEntrySize
            ) for plugin in allPlugins.values()
        ]
        for future in concurrent.futures.as_completed(futures):
            globalConfig = future.result()

    yaml.safe_dump(globalConfig, open(dynamicPluginsGlobalConfigFile, 'w'))

    for hash_value in plugin_path_by_hash:
        plugin_directory = os.path.join(dynamicPluginsRoot, plugin_path_by_hash[hash_value])
        print('\n======= Removing previously installed dynamic plugin', plugin_path_by_hash[hash_value], flush=True)
        shutil.rmtree(plugin_directory, ignore_errors=True, onerror=None)

end_time = datetime.now()
elapsed_time = end_time - start_time
print(f'Total Execution Time: {elapsed_time}')


main()
