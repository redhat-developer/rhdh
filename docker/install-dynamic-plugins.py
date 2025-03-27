#!/usr/bin/env python3
"""
Script para instalar plugins dinâmicos a partir de imagens OCI ou pacotes NPM,
agora com instalação paralela via ThreadPoolExecutor.
"""

import base64
import binascii
import copy
from datetime import datetime
import hashlib
import json
import logging
import os
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import yaml
from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple, Union
import atexit
from concurrent.futures import ThreadPoolExecutor, as_completed

# ------------------------------------------------------------------------------
# Configuração de Logging
# ------------------------------------------------------------------------------

class OptimizedLogger:
    """Sistema de logging otimizado para ambientes containerizados."""

    def __init__(self, log_dir=None):
        """Inicializa o logger com opções para arquivo de log."""
        self.logger = logging.getLogger('dynamic-plugins')
        self.logger.setLevel(logging.INFO)
        self.log_file = None

        # Remover handlers existentes para evitar duplicação
        for handler in self.logger.handlers[:]:
            self.logger.removeHandler(handler)

        # Formatador para mensagens de log
        formatter = logging.Formatter(
            '%(asctime)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )

        # Handler para console sempre presente
        console_handler = logging.StreamHandler()
        console_handler.setFormatter(formatter)
        self.logger.addHandler(console_handler)

        # Opcionalmente adicionar handler de arquivo
        if log_dir:
            try:
                log_path = Path(log_dir)
                log_path.mkdir(parents=True, exist_ok=True)
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                self.log_file = log_path / f"plugin_install_{timestamp}.log"

                file_handler = logging.FileHandler(str(self.log_file))
                file_handler.setFormatter(formatter)
                self.logger.addHandler(file_handler)

                self.info(f"Log file created at: {self.log_file}")
            except Exception as e:
                self.logger.warning(f"Could not set up file logging: {e}")

    def info(self, msg, *args, **kwargs):
        self.logger.info(msg, *args, **kwargs)

    def warning(self, msg, *args, **kwargs):
        self.logger.warning(msg, *args, **kwargs)

    def error(self, msg, *args, **kwargs):
        self.logger.error(msg, *args, **kwargs)

    def debug(self, msg, *args, **kwargs):
        self.logger.debug(msg, *args, **kwargs)

    def critical(self, msg, *args, **kwargs):
        self.logger.critical(msg, *args, **kwargs)

    def log_system_info(self):
        """Registra informações do sistema para diagnóstico."""
        self.info("-" * 50)
        self.info("System Information:")
        self.info(f"  Hostname: {os.environ.get('HOSTNAME', 'unknown')}")
        self.info(f"  Time: {datetime.now().isoformat()}")

        if os.path.exists('/var/run/secrets/kubernetes.io/serviceaccount'):
            try:
                with open('/var/run/secrets/kubernetes.io/serviceaccount/namespace', 'r') as f:
                    namespace = f.read().strip()
                self.info(f"  Kubernetes namespace: {namespace}")
            except Exception:
                pass

        try:
            import platform
            self.info(f"  Python version: {platform.python_version()}")
            self.info(f"  Platform: {platform.platform()}")
        except ImportError:
            pass

        self.info("-" * 50)

    def log_execution_result(self, success=True, error=None):
        """Registra o resultado da execução do script."""
        if success:
            self.info("Plugin installation completed successfully!")
        else:
            self.error(f"Plugin installation failed: {error}")

        if self.log_file:
            self.info(f"Full logs available at: {self.log_file}")

logger = OptimizedLogger()

# ------------------------------------------------------------------------------
# Definições de Classes e Constantes
# ------------------------------------------------------------------------------

class PullPolicy(StrEnum):
    IF_NOT_PRESENT = 'IfNotPresent'
    ALWAYS = 'Always'

class InstallException(Exception):
    """Exceção base para erros neste script."""
    pass

RECOGNIZED_ALGORITHMS = frozenset(['sha512', 'sha384', 'sha256'])

# ------------------------------------------------------------------------------
# Funções Auxiliares
# ------------------------------------------------------------------------------

def merge(source: Dict[str, Any], destination: Dict[str, Any], prefix: str = '') -> Dict[str, Any]:
    for key, value in source.items():
        if isinstance(value, dict):
            node = destination.setdefault(key, {})
            merge(value, node, prefix + key + '.')
        else:
            if key in destination and destination[key] != value:
                raise InstallException(
                    f"Config key '{prefix + key}' definida de forma diferente em plugins distintos."
                )
            destination[key] = value
    return destination

def maybe_merge_config(config: Optional[Dict[str, Any]], global_config: Dict[str, Any]) -> Dict[str, Any]:
    if config is not None and isinstance(config, dict):
        logger.info('\t==> Merging plugin-specific configuration')
        return merge(config, global_config)
    return global_config

def check_prerequisites() -> Dict[str, str]:
    required_tools = {
        'skopeo': "Skopeo is required for OCI image handling",
        'npm': "NPM is required for NPM package handling"
    }
    found = {}
    missing = []
    for tool, desc in required_tools.items():
        path = shutil.which(tool)
        if path:
            found[tool] = path
        else:
            missing.append(f"- {tool}: {desc}")
    if missing:
        raise InstallException("Required tools not found:\n" + "\n".join(missing))
    return found

# ------------------------------------------------------------------------------
# Funções de Lock
# ------------------------------------------------------------------------------

def create_lock(lock_file_path: Union[str, Path]):
    lock_path = Path(lock_file_path)
    while True:
        try:
            lock_path.touch(exist_ok=False)
            logger.info(f"======= Created lock file: {lock_path}")
            return
        except FileExistsError:
            wait_for_lock_release(lock_path)

def remove_lock(lock_file_path: Union[str, Path]):
    lock_path = Path(lock_file_path)
    if lock_path.exists():
        try:
            lock_path.unlink()
            logger.info(f"======= Removed lock file: {lock_path}")
        except OSError as e:
            logger.warning(f"Failed to remove lock file: {e}")

def wait_for_lock_release(lock_path: Path):
    logger.info(f"======= Waiting for lock release (file: {lock_path})...")
    start_time = time.time()
    timeout = 300  # 5 minutos de timeout

    while lock_path.exists():
        time.sleep(1)
        if time.time() - start_time > timeout:
            logger.warning(f"Lock wait timed out after {timeout}s - removing stale lock.")
            remove_lock(lock_path)
            break
    logger.info("======= Lock released.")

# ------------------------------------------------------------------------------
# Funções para carregamento de arquivos
# ------------------------------------------------------------------------------

def load_yaml(file_path: Union[str, Path]) -> Optional[Any]:
    p = Path(file_path)
    if not p.is_file():
        logger.warning(f"File not found: {p}")
        return None
    try:
        with p.open('r') as f:
            return yaml.safe_load(f)
    except yaml.YAMLError as e:
        raise InstallException(f"Error parsing YAML file {p}: {e}")

# ------------------------------------------------------------------------------
# OCI Downloader com otimizações
# ------------------------------------------------------------------------------

class OciDownloader:
    def __init__(self, destination: Union[str, Path], tools: Dict[str, str]):
        self._skopeo = tools.get('skopeo')
        if not self._skopeo:
            raise InstallException('skopeo not in PATH')

        self.tmp_dir_obj = tempfile.TemporaryDirectory()
        self.tmp_dir = Path(self.tmp_dir_obj.name)
        self.image_to_tarball = {}
        self.destination = Path(destination)
        self._digest_cache = {}

    def skopeo(self, command: List[str]) -> str:
        try:
            result = subprocess.run(
                [self._skopeo] + command,
                check=True,
                capture_output=True,
                text=True
            )
            return result.stdout
        except subprocess.CalledProcessError as e:
            msg = f"Error running skopeo: {e.stderr}"
            logger.error(msg)
            raise InstallException(msg)

    def get_plugin_tar(self, image: str) -> Path:
        if image in self.image_to_tarball:
            return self.image_to_tarball[image]

        logger.info(f'\t==> Copying image {image} to local filesystem')
        digest = hashlib.sha256(image.encode('utf-8'), usedforsecurity=False).hexdigest()
        local_dir = self.tmp_dir / digest

        image_url = image.replace('oci://', 'docker://')
        self.skopeo(['copy', image_url, f'dir:{local_dir}'])

        manifest_path = local_dir / 'manifest.json'
        with manifest_path.open('r') as f:
            manifest = json.load(f)

        layer_digest = manifest['layers'][0]['digest'].split(':')[1]
        local_path = local_dir / layer_digest
        self.image_to_tarball[image] = local_path
        return local_path

    def extract_plugin(self, tar_file: Path, plugin_path: str):
        extracted_path = self.destination.absolute()
        max_size = int(os.environ.get('MAX_ENTRY_SIZE', 20000000))

        with tarfile.open(tar_file, 'r:gz') as tar:
            members = []
            for member in tar.getmembers():
                if not member.name.startswith(plugin_path):
                    continue
                if member.size > max_size:
                    raise InstallException(f'Zip bomb in {member.name}')
                if member.islnk() or member.issym():
                    realpath = (extracted_path / plugin_path).joinpath(*Path(member.linkname).parts).resolve()
                    if not str(realpath).startswith(str(extracted_path)):
                        logger.warning(
                            f'\t==> WARNING: skipping symlink outside: {member.name} -> {member.linkpath}'
                        )
                        continue
                members.append(member)
            tar.extractall(extracted_path, members=members, filter='tar')

    def download(self, package: str) -> str:
        image, plugin_path = package.split('!')
        tar_path = self.get_plugin_tar(image)

        plugin_dir = self.destination / plugin_path
        if plugin_dir.exists():
            logger.info(f'\t==> Removing previous plugin directory {plugin_dir}')
            shutil.rmtree(plugin_dir, ignore_errors=True)

        self.extract_plugin(tar_path, plugin_path)
        return plugin_path

    def digest(self, package: str) -> str:
        image, _ = package.split('!')
        if image in self._digest_cache:
            return self._digest_cache[image]

        image_url = image.replace('oci://', 'docker://')
        output = self.skopeo(['inspect', image_url])
        data = json.loads(output)
        result = data['Digest'].split(':')[1]
        self._digest_cache[image] = result
        return result

# ------------------------------------------------------------------------------
# Verificação de Integridade com hashlib (sem openssl)
# ------------------------------------------------------------------------------

def verify_package_integrity(plugin: dict, archive: Union[str, Path]):
    package = plugin['package']

    integrity = plugin.get('integrity')
    if not integrity:
        raise InstallException(f'Package integrity for {package} is missing')
    if not isinstance(integrity, str):
        raise InstallException(f'Package integrity for {package} must be a string')

    parts = integrity.split('-')
    if len(parts) != 2:
        raise InstallException(
            f'Integrity must be <algorithm>-<base64hash> for {package}'
        )

    algorithm, b64_digest = parts
    if algorithm not in RECOGNIZED_ALGORITHMS:
        raise InstallException(
            f'{package}: Provided algorithm {algorithm} not supported. '
            f'Use one of: {RECOGNIZED_ALGORITHMS}'
        )

    try:
        base64.b64decode(b64_digest, validate=True)
    except binascii.Error:
        raise InstallException(f'{package}: Invalid base64: {b64_digest}')

    # Mapear algoritmo
    import hashlib
    hash_map = {
        'sha256': hashlib.sha256,
        'sha384': hashlib.sha384,
        'sha512': hashlib.sha512
    }
    hasher = hash_map[algorithm]()

    with open(archive, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            hasher.update(chunk)

    calculated = base64.b64encode(hasher.digest()).decode('utf-8')
    if calculated != b64_digest:
        raise InstallException(
            f'{package}: integrity check failed. '
            f'Expected={b64_digest}, Got={calculated}'
        )
    logger.info(f'\t==> Integrity check passed for {package}')

# ------------------------------------------------------------------------------
# Função principal com paralelismo
# ------------------------------------------------------------------------------

def main():
    start_time = datetime.now()

    if len(sys.argv) < 2:
        raise InstallException("Usage: python script.py <dynamicPluginsRoot>")

    dynamicPluginsRoot = sys.argv[1]

    lock_file_path = os.path.join(dynamicPluginsRoot, 'install-dynamic-plugins.lock')
    atexit.register(remove_lock, lock_file_path)
    signal.signal(signal.SIGTERM, lambda *a: sys.exit(0))
    create_lock(lock_file_path)

    maxEntrySize = int(os.environ.get('MAX_ENTRY_SIZE', 20000000))
    skipIntegrityCheck = os.environ.get("SKIP_INTEGRITY_CHECK", "").lower() == "true"

    dynamicPluginsFile = 'dynamic-plugins.yaml'
    dynamicPluginsGlobalConfigFile = os.path.join(dynamicPluginsRoot, 'app-config.dynamic-plugins.yaml')

    if not os.path.isfile(dynamicPluginsFile):
        logger.info(f"No {dynamicPluginsFile} file found. Skipping dynamic plugins installation.")
        with open(dynamicPluginsGlobalConfigFile, 'w') as f:
            f.write('')
        sys.exit(0)

    globalConfig = {
        'dynamicPlugins': {
            'rootDirectory': 'dynamic-plugins-root'
        }
    }

    content = load_yaml(dynamicPluginsFile)
    if not content:
        logger.info(f"{dynamicPluginsFile} is empty or invalid. Skipping installation.")
        with open(dynamicPluginsGlobalConfigFile, 'w') as f:
            f.write('')
        sys.exit(0)

    if not isinstance(content, dict):
        raise InstallException(f"{dynamicPluginsFile} must be a YAML object")

    if skipIntegrityCheck:
        logger.info(f"SKIP_INTEGRITY_CHECK={skipIntegrityCheck}, skipping integrity checks")

    includes = content.get('includes', [])
    if not isinstance(includes, list):
        raise InstallException(f"'includes' must be a list in {dynamicPluginsFile}")

    allPlugins = {}
    for include in includes:
        if not isinstance(include, str):
            raise InstallException(f"'includes' must be a list of strings in {dynamicPluginsFile}")
        logger.info('\n======= Including dynamic plugins from %s', include)

        includeContent = load_yaml(include)
        if not includeContent:
            continue
        if not isinstance(includeContent, dict):
            raise InstallException(f"{include} must be a YAML object")

        incPlugs = includeContent.get('plugins', [])
        if not isinstance(incPlugs, list):
            raise InstallException(f"'plugins' must be a list in {include}")

        for p in incPlugs:
            allPlugins[p['package']] = p

    # Plugins do arquivo principal
    plugins = content.get('plugins', [])
    if not isinstance(plugins, list):
        raise InstallException(f"'plugins' must be a list in {dynamicPluginsFile}")

    # Override
    for plugin in plugins:
        package = plugin['package']
        if package in allPlugins:
            logger.info('\n======= Overriding dynamic plugin configuration %s', package)
            for k, v in plugin.items():
                if k != 'package':
                    allPlugins[package][k] = v
        else:
            allPlugins[package] = plugin

    # Gera hash
    for plugin in allPlugins.values():
        hash_dict = copy.deepcopy(plugin)
        hash_dict.pop('pluginConfig', None)
        h = hashlib.sha256(json.dumps(hash_dict, sort_keys=True).encode('utf-8')).hexdigest()
        plugin['hash'] = h

    # Lê instalados
    plugin_path_by_hash = {}
    for dir_name in os.listdir(dynamicPluginsRoot):
        dir_path = os.path.join(dynamicPluginsRoot, dir_name)
        if os.path.isdir(dir_path):
            hf = os.path.join(dir_path, 'dynamic-plugin-config.hash')
            if os.path.isfile(hf):
                with open(hf, 'r') as hf2:
                    old_hash = hf2.read().strip()
                    plugin_path_by_hash[old_hash] = dir_name

    tools = check_prerequisites()
    oci_downloader = OciDownloader(dynamicPluginsRoot, tools)

    # Filtrar plugins ativos
    active_plugins = []
    for p in allPlugins.values():
        if not p.get('disabled'):
            active_plugins.append(p)
        else:
            logger.info('\n======= Skipping disabled dynamic plugin %s', p['package'])

    # -----------
    # Passo 1: função para instalar 1 plugin (chamada em paralelo)
    # -----------
    def install_one_plugin(plugin):
        """
        Retorna (plugin, installed_path, erro_ou_None).
        Se erro, installed_path será None, e vice-versa.
        """
        package = plugin['package']
        plugin_hash = plugin['hash']
        pull_policy = plugin.get(
            'pullPolicy',
            PullPolicy.ALWAYS if ':latest!' in package else PullPolicy.IF_NOT_PRESENT
        )
        if isinstance(pull_policy, str):
            pull_policy = PullPolicy(pull_policy)

        installed_path = None

        # Se OCI
        if package.startswith('oci://'):
            try:
                # If already installed & policy=IF_NOT_PRESENT => skip
                if plugin_hash in plugin_path_by_hash and pull_policy == PullPolicy.IF_NOT_PRESENT:
                    logger.info('\n======= Skipping download of installed plugin %s', package)
                    plugin_path_by_hash.pop(plugin_hash)
                    return (plugin, None, None)

                # If already installed & policy=ALWAYS => check digest
                if plugin_hash in plugin_path_by_hash and pull_policy == PullPolicy.ALWAYS:
                    old_dir = plugin_path_by_hash.pop(plugin_hash)
                    old_digest_file = os.path.join(dynamicPluginsRoot, old_dir, 'dynamic-plugin-image.hash')
                    local_digest = None
                    if os.path.isfile(old_digest_file):
                        with open(old_digest_file, 'r') as df:
                            local_digest = df.read().strip()
                    remote_digest = oci_downloader.digest(package)
                    if remote_digest == local_digest:
                        logger.info('\n======= Skipping download (same digest) %s', package)
                        return (plugin, None, None)
                    else:
                        logger.info('\n======= Installing dynamic plugin %s', package)
                else:
                    logger.info('\n======= Installing dynamic plugin %s', package)

                installed_path = oci_downloader.download(package)
                digest_path = os.path.join(dynamicPluginsRoot, installed_path, 'dynamic-plugin-image.hash')
                with open(digest_path, 'w') as df:
                    df.write(oci_downloader.digest(package))

                # Remove duplicatas
                duplicates = [k for k, v in plugin_path_by_hash.items() if v == installed_path]
                for dup in duplicates:
                    plugin_path_by_hash.pop(dup)

            except Exception as e:
                return (plugin, None, f"Error while adding OCI plugin {package}: {e}")

        else:
            # NPM
            plugin_already_installed = False
            if plugin_hash in plugin_path_by_hash:
                force_dl = plugin.get('forceDownload', False)
                if pull_policy == PullPolicy.ALWAYS or force_dl:
                    logger.info('\n======= Forcing download of installed plugin %s', package)
                else:
                    logger.info('\n======= Skipping download of installed plugin %s', package)
                    plugin_already_installed = True
                plugin_path_by_hash.pop(plugin_hash)
            else:
                logger.info('\n======= Installing dynamic plugin %s', package)

            if plugin_already_installed:
                # skip
                return (plugin, None, None)

            package_is_local = package.startswith('./')
            if (not package_is_local) and (not skipIntegrityCheck) and 'integrity' not in plugin:
                return (plugin, None, f"No integrity hash for {package}")

            if package_is_local:
                package = os.path.join(os.getcwd(), package[2:])

            logger.info('\t==> Grabbing package archive through `npm pack`')
            completed = subprocess.run(
                ['npm', 'pack', package],
                cwd=dynamicPluginsRoot,
                capture_output=True,
                text=True
            )
            if completed.returncode != 0:
                return (plugin, None, f"Error installing plugin {package}: {completed.stderr}")

            archive = os.path.join(dynamicPluginsRoot, completed.stdout.strip())

            if (not package_is_local) and (not skipIntegrityCheck):
                logger.info('\t==> Verifying package integrity')
                try:
                    verify_package_integrity(plugin, archive)
                except Exception as e:
                    return (plugin, None, f"Integrity check failed for {package}: {e}")

            directory = archive.replace('.tgz', '')
            directory_realpath = os.path.realpath(directory)
            installed_path = os.path.basename(directory_realpath)

            if os.path.exists(directory):
                logger.info('\t==> Removing previous plugin directory %s', directory)
                shutil.rmtree(directory, ignore_errors=True)
            os.mkdir(directory)

            logger.info('\t==> Extracting package archive %s', archive)
            try:
                with tarfile.open(archive, 'r:gz') as f:
                    for member in f.getmembers():
                        if member.isreg():
                            if not member.name.startswith('package/'):
                                raise InstallException(
                                    f"NPM package archive doesn't start with 'package/': {member.name}"
                                )
                            if member.size > maxEntrySize:
                                raise InstallException('Zip bomb detected in ' + member.name)
                            member.name = member.name.removeprefix('package/')
                            f.extract(member, path=directory, filter='tar')
                        elif member.isdir():
                            logger.info('\t\tSkipping directory entry %s', member.name)
                        elif member.islnk() or member.issym():
                            if not member.linkpath.startswith('package/'):
                                raise InstallException(
                                    f"NPM package link outside: {member.name} -> {member.linkpath}"
                                )
                            member.name = member.name.removeprefix('package/')
                            member.linkpath = member.linkpath.removeprefix('package/')

                            rp = os.path.realpath(os.path.join(directory, *os.path.split(member.linkname)))
                            if not rp.startswith(directory_realpath):
                                raise InstallException(
                                    f"NPM package link escapes archive: {member.name} -> {member.linkpath}"
                                )
                            f.extract(member, path=directory, filter='tar')
                        else:
                            t_str = 'unknown'
                            if member.type == tarfile.CHRTYPE:
                                t_str = 'character device'
                            elif member.type == tarfile.BLKTYPE:
                                t_str = 'block device'
                            elif member.type == tarfile.FIFOTYPE:
                                t_str = 'FIFO'
                            raise InstallException(
                                f'Archive has a non-regular file: {member.name} - {t_str}'
                            )
            except Exception as ex:
                return (plugin, None, str(ex))

            logger.info('\t==> Removing package archive %s', archive)
            os.remove(archive)

        # Cria arquivo de hash
        if installed_path:
            hash_file_path = os.path.join(dynamicPluginsRoot, installed_path, 'dynamic-plugin-config.hash')
            with open(hash_file_path, 'w') as hf:
                hf.write(plugin_hash)

        return (plugin, installed_path, None)

    # -----------
    # Passo 2: instalar plugins em paralelo
    # -----------
    from concurrent.futures import ThreadPoolExecutor, as_completed
    results = []
    exceptions = []

    # Ajuste o max_workers conforme o ambiente
    with ThreadPoolExecutor(max_workers=2) as executor:
        future_map = {}
        for p in active_plugins:
            f = executor.submit(install_one_plugin, p)
            future_map[f] = p['package']

        for f in as_completed(future_map):
            pkg = future_map[f]
            try:
                plugin_obj, installed_path, error = f.result()
                if error:
                    exceptions.append((pkg, error))
                else:
                    results.append((plugin_obj, installed_path))
            except Exception as e:
                exceptions.append((pkg, str(e)))

    # Se houve exceções, aborta
    if exceptions:
        for pkg, err in exceptions:
            logger.error(f"Error installing {pkg}: {err}")
        raise InstallException("One or more plugins failed to install in parallel")

    # -----------
    # Passo 3: merges de config e logs de finalização
    # -----------
    for plugin_obj, installed_path in results:
        # Se installed_path for None => plugin não foi reinstalado, mas não é erro
        if 'pluginConfig' in plugin_obj:
            globalConfig = maybe_merge_config(plugin_obj.get('pluginConfig'), globalConfig)
        logger.info('\t==> Successfully installed dynamic plugin %s', plugin_obj['package'])

    # Salva config final
    with open(dynamicPluginsGlobalConfigFile, 'w') as gf:
        yaml.safe_dump(globalConfig, gf)

    # Plugins que não foram removidos do plugin_path_by_hash => não aparecem mais na config
    for old_hash, old_dir in plugin_path_by_hash.items():
        logger.info('\n======= Removing previously installed dynamic plugin %s', old_dir)
        shutil.rmtree(os.path.join(dynamicPluginsRoot, old_dir), ignore_errors=True)

    end_time = datetime.now()
    print(f"Total Execution Timeex: {end_time - start_time}")


if __name__ == "__main__":
    main()
