#!/usr/bin/env python3
"""
Script para instalar plugins dinâmicos a partir de imagens OCI ou pacotes NPM.
Otimizado para contêineres Kubernetes com foco em confiabilidade e diagnóstico.
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
from typing import Dict, List, Any, Optional, Set, Tuple, Union
import atexit

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
                # Falha silenciosamente mas continua com logging no console
                self.logger.warning(f"Could not set up file logging: {e}")

    def info(self, msg, *args, **kwargs):
        """Log com nível INFO."""
        self.logger.info(msg, *args, **kwargs)

    def warning(self, msg, *args, **kwargs):
        """Log com nível WARNING."""
        self.logger.warning(msg, *args, **kwargs)

    def error(self, msg, *args, **kwargs):
        """Log com nível ERROR."""
        self.logger.error(msg, *args, **kwargs)

    def debug(self, msg, *args, **kwargs):
        """Log com nível DEBUG."""
        self.logger.debug(msg, *args, **kwargs)

    def critical(self, msg, *args, **kwargs):
        """Log com nível CRITICAL."""
        self.logger.critical(msg, *args, **kwargs)

    def log_system_info(self):
        """Registra informações do sistema para diagnóstico."""
        self.info("-" * 50)
        self.info("System Information:")
        self.info(f"  Hostname: {os.environ.get('HOSTNAME', 'unknown')}")
        self.info(f"  Time: {datetime.now().isoformat()}")

        # Informações específicas do Kubernetes se disponíveis
        if os.path.exists('/var/run/secrets/kubernetes.io/serviceaccount'):
            try:
                with open('/var/run/secrets/kubernetes.io/serviceaccount/namespace', 'r') as f:
                    namespace = f.read().strip()
                self.info(f"  Kubernetes namespace: {namespace}")
            except Exception:
                pass

        # Informações de sistema
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

# Inicializa logger global para uso durante importação do módulo
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

# Algoritmos de hash suportados para verificação de integridade
RECOGNIZED_ALGORITHMS = frozenset(['sha512', 'sha384', 'sha256'])

# ------------------------------------------------------------------------------
# Funções Auxiliares
# ------------------------------------------------------------------------------

def merge(source: Dict[str, Any], destination: Dict[str, Any], prefix: str = '') -> Dict[str, Any]:
    """
    Faz merge recursivo do dicionário 'source' em 'destination'.
    Se encontrar chave com valor conflitante, lança InstallException.
    """
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
    """
    Se 'config' for dict, faz merge no 'globalConfig'; caso contrário, retorna 'globalConfig' inalterado.
    """
    if config is not None and isinstance(config, dict):
        logger.info('\t==> Merging plugin-specific configuration')
        return merge(config, global_config)
    return global_config

def check_prerequisites() -> Tuple[str, ...]:
    """
    Verifica e retorna o caminho de ferramentas necessárias.
    Lança InstallException se alguma não estiver disponível.
    """
    required_tools = {
        'skopeo': "Skopeo is required for OCI image handling",
        'npm': "NPM is required for NPM package handling"
    }
    missing = []
    found_tools = {}

    for tool, description in required_tools.items():
        path = shutil.which(tool)
        if path:
            found_tools[tool] = path
        else:
            missing.append(f"- {tool}: {description}")

    if missing:
        raise InstallException(f"Required tools not found in PATH:\n" + "\n".join(missing))

    return found_tools

# ------------------------------------------------------------------------------
# Funções de Lock
# ------------------------------------------------------------------------------

def create_lock(lock_file_path: Union[str, Path]):
    """
    Cria arquivo de lock. Se já existir, aguarda até ele ser liberado.
    """
    lock_path = Path(lock_file_path)
    while True:
        try:
            lock_path.touch(exist_ok=False)
            logger.info(f"======= Created lock file: {lock_path}")
            return
        except FileExistsError:
            wait_for_lock_release(lock_path)

def remove_lock(lock_file_path: Union[str, Path]):
    """
    Remove o lock file, se existir.
    """
    lock_path = Path(lock_file_path)
    if lock_path.exists():
        try:
            lock_path.unlink()
            logger.info(f"======= Removed lock file: {lock_path}")
        except OSError as e:
            logger.warning(f"======= Failed to remove lock file: {e}")

def wait_for_lock_release(lock_file_path: Union[str, Path]):
    """
    Fica em loop até o arquivo de lock ser removido, com detecção de locks obsoletos.
    """
    lock_path = Path(lock_file_path)
    logger.info(f"======= Waiting for lock release (file: {lock_path})...")

    start_time = time.time()
    timeout = 300  # 5 minutos

    while lock_path.exists():
        time.sleep(1)

        # Verificar timeout
        if time.time() - start_time > timeout:
            logger.warning(f"Lock wait timeout after {timeout}s - may be stale, removing")
            remove_lock(lock_path)
            break

    logger.info("======= Lock released.")

# ------------------------------------------------------------------------------
# Funções para carregamento de arquivos
# ------------------------------------------------------------------------------

def load_yaml(file_path: Union[str, Path]) -> Optional[Any]:
    """
    Carrega o conteúdo YAML de 'file_path'.
    Retorna None se o arquivo não existir.
    Lança InstallException em caso de erros de parsing.
    """
    path = Path(file_path)
    if not path.is_file():
        logger.warning(f"File not found: {path}")
        return None

    try:
        with path.open('r') as file:
            return yaml.safe_load(file)
    except yaml.YAMLError as e:
        raise InstallException(f"Error parsing YAML file {path}: {e}")

# ------------------------------------------------------------------------------
# OCI Downloader com otimizações
# ------------------------------------------------------------------------------

class OciDownloader:
    def __init__(self, destination: Union[str, Path], tools: Dict[str, str]):
        """
        Inicializa o OciDownloader com ferramentas validadas.

        Args:
            destination: Diretório onde os plugins serão extraídos
            tools: Dicionário com caminhos para ferramentas necessárias
        """
        self._skopeo = tools.get('skopeo')
        if not self._skopeo:
            raise InstallException('skopeo executable not found in PATH')

        self.tmp_dir_obj = tempfile.TemporaryDirectory()
        self.tmp_dir = Path(self.tmp_dir_obj.name)
        self.image_to_tarball: Dict[str, Path] = {}
        self.destination = Path(destination)
        self._digest_cache: Dict[str, str] = {}

    def skopeo(self, command: List[str]) -> str:
        """
        Executa 'skopeo' com os argumentos especificados e retorna stdout.
        """
        try:
            result = subprocess.run(
                [self._skopeo] + command,
                check=True,
                capture_output=True,
                text=True
            )
            return result.stdout
        except subprocess.CalledProcessError as e:
            error_msg = f'Error while running skopeo command: {e.stderr}'
            logger.error(error_msg)
            raise InstallException(error_msg)

    def get_plugin_tar(self, image: str) -> Path:
        """
        Faz o download da imagem (se ainda não feito), usando skopeo, e retorna o caminho local ao tar.
        """
        if image in self.image_to_tarball:
            return self.image_to_tarball[image]

        logger.info(f'\t==> Copying image {image} to local filesystem')
        image_digest = hashlib.sha256(image.encode('utf-8'), usedforsecurity=False).hexdigest()

        local_dir = self.tmp_dir / image_digest
        image_url = image.replace('oci://', 'docker://')
        self.skopeo(['copy', image_url, f'dir:{local_dir}'])

        manifest_path = local_dir / 'manifest.json'
        with manifest_path.open('r') as f:
            manifest = json.load(f)

        layer_digest = manifest['layers'][0]['digest']
        _, filename = layer_digest.split(':')
        local_path = local_dir / filename
        self.image_to_tarball[image] = local_path
        return local_path

    def extract_plugin(self, tar_file: Path, plugin_path: str) -> None:
        """
        Extrai apenas arquivos que começam com 'plugin_path' do tar.gz,
        verificando tamanho (anti zip-bomb) e possíveis links fora do escopo.
        """
        extracted_path = self.destination.absolute()
        max_size = int(os.environ.get('MAX_ENTRY_SIZE', 20000000))

        with tarfile.open(tar_file, 'r:gz') as tar:
            members_to_extract = []
            for member in tar.getmembers():
                if not member.name.startswith(plugin_path):
                    continue

                if member.size > max_size:
                    raise InstallException(f'Zip bomb detected in {member.name}')

                if member.islnk() or member.issym():
                    realpath = Path(extracted_path / plugin_path).joinpath(
                        *Path(member.linkname).parts).resolve()

                    if not str(realpath).startswith(str(extracted_path)):
                        logger.warning(
                            f'\t==> WARNING: skipping file containing link outside of the archive: '
                            f'{member.name} -> {member.linkpath}'
                        )
                        continue

                members_to_extract.append(member)

            # Extração em batch é mais eficiente
            if members_to_extract:
                tar.extractall(extracted_path, members=members_to_extract, filter='tar')

    def download(self, package: str) -> str:
        """
        Recebe algo como 'oci://repo/img!path_no_tar' e extrai só o diretório path_no_tar no destino.
        Retorna plugin_path.
        """
        image, plugin_path = package.split('!')
        tar_file = self.get_plugin_tar(image)

        plugin_directory = self.destination / plugin_path
        if plugin_directory.exists():
            logger.info(f'\t==> Removing previous plugin directory {plugin_directory}')
            try:
                shutil.rmtree(plugin_directory)
            except OSError as e:
                logger.warning(f'\t==> Could not remove directory: {e}, trying alternative method')
                # Tentar removê-lo forçadamente se o método normal falhar
                try:
                    os.system(f'rm -rf "{plugin_directory}"')
                except Exception as e2:
                    raise InstallException(f"Failed to remove directory {plugin_directory}: {e2}")

        self.extract_plugin(tar_file=tar_file, plugin_path=plugin_path)
        return plugin_path

    def digest(self, package: str) -> str:
        """
        Retorna o digest da imagem OCI usando 'skopeo inspect' com cache.
        """
        image, _ = package.split('!')

        # Verificar cache primeiro
        if image in self._digest_cache:
            return self._digest_cache[image]


# ------------------------------------------------------------------------------
# Verificação de Integridade
# ------------------------------------------------------------------------------
def verify_package_integrity(plugin: dict, archive: str, working_directory: str, openssl_cmd: str) -> None:
    """
    Verifica integridade do arquivo 'archive' usando plugin['integrity'] no formato <alg>-<base64hash>.
    """
    package = plugin['package']
    integrity = plugin.get('integrity')
    if not integrity:
        raise InstallException(f'Package integrity for {package} is missing')

    if not isinstance(integrity, str):
        raise InstallException(f'Package integrity for {package} must be a string')

    parts = integrity.split('-')
    if len(parts) != 2:
        raise InstallException(
            f'Package integrity for {package} must be <algorithm>-<base64hash>'
        )

    algorithm, base64_digest = parts
    if algorithm not in RECOGNIZED_ALGORITHMS:
        raise InstallException(
            f'{package}: Provided Package integrity algorithm {algorithm} is not supported. '
            f'Use one of {RECOGNIZED_ALGORITHMS}.'
        )

    try:
        base64.b64decode(base64_digest, validate=True)
    except binascii.Error:
        raise InstallException(
            f'{package}: Provided Package integrity hash {base64_digest} is not valid base64'
        )

    # Lê o arquivo em Python (sem usar 'cat') e passa ao openssl
    with open(archive, 'rb') as archive_file:
        dgst_proc = subprocess.Popen(
            [openssl_cmd, 'dgst', f'-{algorithm}', '-binary'],
            stdin=archive_file, stdout=subprocess.PIPE
        )
        base64_proc = subprocess.Popen(
            [openssl_cmd, 'base64', '-A'],
            stdin=dgst_proc.stdout, stdout=subprocess.PIPE
        )
        output, _ = base64_proc.communicate()
        calculated_hash = output.decode('utf-8').strip()

    if base64_digest != calculated_hash:
        raise InstallException(
            f'{package}: Hash mismatch. Expected={base64_digest}, got={calculated_hash}'
        )

# ------------------------------------------------------------------------------
# Função Principal
# ------------------------------------------------------------------------------
def main():
    start_time = datetime.now()

    if len(sys.argv) < 2:
        raise InstallException("Usage: python script.py <dynamicPluginsRoot>")

    dynamicPluginsRoot = sys.argv[1]

    # Configura lock
    lock_file_path = os.path.join(dynamicPluginsRoot, 'install-dynamic-plugins.lock')
    atexit.register(remove_lock, lock_file_path)
    signal.signal(signal.SIGTERM, lambda *a: sys.exit(0))
    create_lock(lock_file_path)

    maxEntrySize = int(os.environ.get('MAX_ENTRY_SIZE', 20000000))
    skipIntegrityCheck = os.environ.get("SKIP_INTEGRITY_CHECK", "").lower() == "true"

    dynamicPluginsFile = 'dynamic-plugins.yaml'
    dynamicPluginsGlobalConfigFile = os.path.join(dynamicPluginsRoot, 'app-config.dynamic-plugins.yaml')

    # Checa se existe dynamic-plugins.yaml
    if not os.path.isfile(dynamicPluginsFile):
        logging.info(f"No {dynamicPluginsFile} file found. Skipping dynamic plugins installation.")
        with open(dynamicPluginsGlobalConfigFile, 'w') as f:
            f.write('')
        sys.exit(0)

    # Config global inicial
    globalConfig = {
        'dynamicPlugins': {
            'rootDirectory': 'dynamic-plugins-root'
        }
    }

    content = load_yaml(dynamicPluginsFile)
    if not content:
        logging.info(f"{dynamicPluginsFile} file is empty or invalid. Skipping dynamic plugins installation.")
        with open(dynamicPluginsGlobalConfigFile, 'w') as f:
            f.write('')
        sys.exit(0)

    if not isinstance(content, dict):
        raise InstallException(f"{dynamicPluginsFile} content must be a YAML object")

    # Se SKIP_INTEGRITY_CHECK for true
    if skipIntegrityCheck:
        logging.info(f"SKIP_INTEGRITY_CHECK={skipIntegrityCheck}, skipping package integrity checks")

    # Processa includes
    includes = content.get('includes', [])
    if not isinstance(includes, list):
        raise InstallException(f"'includes' field must be a list in {dynamicPluginsFile}")

    allPlugins = {}
    for include in includes:
        if not isinstance(include, str):
            raise InstallException(f"'includes' must be a list of strings in {dynamicPluginsFile}")
        logging.info('\n======= Including dynamic plugins from %s', include)

        includeContent = load_yaml(include)
        if includeContent is None:
            continue  # se arquivo não existe ou vazio, pula

        if not isinstance(includeContent, dict):
            raise InstallException(f"{include} content must be a YAML object")

        incPlugins = includeContent.get('plugins', [])
        if not isinstance(incPlugins, list):
            raise InstallException(f"'plugins' field must be a list in {include}")

        for plug in incPlugins:
            allPlugins[plug['package']] = plug

    # Lê lista de plugins do YAML principal
    plugins = content.get('plugins', [])
    if not isinstance(plugins, list):
        raise InstallException(f"'plugins' field must be a list in {dynamicPluginsFile}")

    # Sobrescreve configurações de plugins duplicados
    for plugin in plugins:
        package = plugin['package']
        if not isinstance(package, str):
            raise InstallException(f"'plugins.package' must be a string in {dynamicPluginsFile}")

        if package in allPlugins:
            logging.info('\n======= Overriding dynamic plugin configuration %s', package)
            for k, v in plugin.items():
                if k != 'package':
                    allPlugins[package][k] = v
        else:
            allPlugins[package] = plugin

    # Calcula hash de cada plugin
    for plugin in allPlugins.values():
        hash_dict = copy.deepcopy(plugin)
        hash_dict.pop('pluginConfig', None)
        plugin_hash = hashlib.sha256(
            json.dumps(hash_dict, sort_keys=True).encode('utf-8')
        ).hexdigest()
        plugin['hash'] = plugin_hash

    # Identifica plugins já instalados (mapeados por hash)
    plugin_path_by_hash = {}
    for dir_name in os.listdir(dynamicPluginsRoot):
        dir_path = os.path.join(dynamicPluginsRoot, dir_name)
        if os.path.isdir(dir_path):
            h_file = os.path.join(dir_path, 'dynamic-plugin-config.hash')
            if os.path.isfile(h_file):
                with open(h_file, 'r') as hf:
                    existing_hash = hf.read().strip()
                    plugin_path_by_hash[existing_hash] = dir_name

    # Prepara downloader OCI
    oci_downloader = OciDownloader(dynamicPluginsRoot)

    # Percorre plugins e instala
    for plugin in allPlugins.values():
        package = plugin['package']

        if plugin.get('disabled') is True:
            logging.info('\n======= Skipping disabled dynamic plugin %s', package)
            continue

        pull_policy = plugin.get(
            'pullPolicy',
            PullPolicy.ALWAYS if ':latest!' in package else PullPolicy.IF_NOT_PRESENT
        )
        if isinstance(pull_policy, str):
            pull_policy = PullPolicy(pull_policy)

        plugin_path = ''  # caminho relativo instalado
        if package.startswith('oci://'):
            # Instala plugin via OCI
            try:
                if (plugin['hash'] in plugin_path_by_hash
                   and pull_policy == PullPolicy.IF_NOT_PRESENT):
                    # Já instalado e policy = IfNotPresent => skip
                    logging.info('\n======= Skipping download of installed plugin %s', package)
                    plugin_path_by_hash.pop(plugin['hash'])
                    globalConfig = maybeMergeConfig(plugin.get('pluginConfig'), globalConfig)
                    continue

                # Se já instalado e policy = ALWAYS => checar se digest mudou
                if plugin['hash'] in plugin_path_by_hash and pull_policy == PullPolicy.ALWAYS:
                    old_dir = plugin_path_by_hash.pop(plugin['hash'])
                    old_digest_file = os.path.join(dynamicPluginsRoot, old_dir, 'dynamic-plugin-image.hash')
                    local_digest = None
                    if os.path.isfile(old_digest_file):
                        with open(old_digest_file, 'r') as df:
                            local_digest = df.read().strip()
                    remote_digest = oci_downloader.digest(package)
                    if remote_digest == local_digest:
                        logging.info('\n======= Skipping download of installed plugin (same digest) %s', package)
                        globalConfig = maybeMergeConfig(plugin.get('pluginConfig'), globalConfig)
                        continue
                    else:
                        logging.info('\n======= Installing dynamic plugin %s', package)
                else:
                    logging.info('\n======= Installing dynamic plugin %s', package)

                # De fato faz o download
                plugin_path = oci_downloader.download(package)

                # Salva o digest remoto
                digest_path = os.path.join(dynamicPluginsRoot, plugin_path, 'dynamic-plugin-image.hash')
                with open(digest_path, 'w') as df:
                    df.write(oci_downloader.digest(package))

                # Remove duplicatas do plugin_path_by_hash que apontem p/ mesmo plugin_path
                duplicates = [k for k, v in plugin_path_by_hash.items() if v == plugin_path]
                for dup in duplicates:
                    plugin_path_by_hash.pop(dup)
            except Exception as e:
                raise InstallException(f"Error while adding OCI plugin {package} to downloader: {e}")

        else:
            # Instala plugin via NPM
            plugin_already_installed = False

            if plugin['hash'] in plugin_path_by_hash:
                force_dl = plugin.get('forceDownload', False)
                if pull_policy == PullPolicy.ALWAYS or force_dl:
                    logging.info('\n======= Forcing download of installed dynamic plugin %s', package)
                else:
                    logging.info('\n======= Skipping download of installed dynamic plugin %s', package)
                    plugin_already_installed = True
                plugin_path_by_hash.pop(plugin['hash'])
            else:
                logging.info('\n======= Installing dynamic plugin %s', package)

            if plugin_already_installed:
                # apenas faz merge de config, se houver
                globalConfig = maybeMergeConfig(plugin.get('pluginConfig'), globalConfig)
                continue

            # Verifica se local => se for, pula check de integridade
            package_is_local = package.startswith('./')
            if (not package_is_local) and (not skipIntegrityCheck) and ('integrity' not in plugin):
                raise InstallException(f"No integrity hash provided for Package {package}")

            if package_is_local:
                package = os.path.join(os.getcwd(), package[2:])

            logging.info('\t==> Grabbing package archive through `npm pack`')
            completed = subprocess.run(
                ['npm', 'pack', package],
                capture_output=True, cwd=dynamicPluginsRoot, text=True
            )
            if completed.returncode != 0:
                raise InstallException(
                    f"Error while installing plugin {package} with 'npm pack': {completed.stderr}"
                )

            archive = os.path.join(dynamicPluginsRoot, completed.stdout.strip())

            # Verifica integridade se aplicável
            if not package_is_local and not skipIntegrityCheck:
                logging.info('\t==> Verifying package integrity')
                verify_package_integrity(
                    plugin, archive, dynamicPluginsRoot, oci_downloader.openssl_cmd
                )

            directory = archive.replace('.tgz', '')
            directoryRealpath = os.path.realpath(directory)
            plugin_path = os.path.basename(directoryRealpath)

            if os.path.exists(directory):
                logging.info('\t==> Removing previous plugin directory %s', directory)
                shutil.rmtree(directory, ignore_errors=True, onerror=None)
            os.mkdir(directory)

            logging.info('\t==> Extracting package archive %s', archive)
            with tarfile.open(archive, 'r:gz') as f:
                for member in f.getmembers():
                    if member.isreg():
                        if not member.name.startswith('package/'):
                            raise InstallException(
                                "NPM package archive doesn't start with 'package/': " + member.name
                            )
                        if member.size > maxEntrySize:
                            raise InstallException('Zip bomb detected in ' + member.name)

                        member.name = member.name.removeprefix('package/')
                        f.extract(member, path=directory, filter='tar')
                    elif member.isdir():
                        logging.info('\t\tSkipping directory entry %s', member.name)
                    elif member.islnk() or member.issym():
                        if not member.linkpath.startswith('package/'):
                            raise InstallException(
                                f'NPM package archive link outside of archive: {member.name} -> {member.linkpath}'
                            )

                        member.name = member.name.removeprefix('package/')
                        member.linkpath = member.linkpath.removeprefix('package/')

                        realpath = os.path.realpath(
                            os.path.join(directory, *os.path.split(member.linkname))
                        )
                        if not realpath.startswith(directoryRealpath):
                            raise InstallException(
                                f'NPM package archive link outside of the archive: {member.name} -> {member.linkpath}'
                            )
                        f.extract(member, path=directory, filter='tar')
                    else:
                        # Se for CHRTYPE, BLKTYPE, FIFOTYPE ou outro
                        t_str = 'unknown'
                        if member.type == tarfile.CHRTYPE:
                            t_str = 'character device'
                        elif member.type == tarfile.BLKTYPE:
                            t_str = 'block device'
                        elif member.type == tarfile.FIFOTYPE:
                            t_str = 'FIFO'
                        raise InstallException(
                            f'NPM package archive contains a non-regular file: {member.name} - {t_str}'
                        )

            logging.info('\t==> Removing package archive %s', archive)
            os.remove(archive)

        # Cria arquivo de hash no plugin
        plugin_hash_path = os.path.join(dynamicPluginsRoot, plugin_path, 'dynamic-plugin-config.hash')
        with open(plugin_hash_path, 'w') as df:
            df.write(plugin['hash'])

        # Se não há pluginConfig, já finaliza
        if 'pluginConfig' not in plugin:
            logging.info('\t==> Successfully installed dynamic plugin %s', package)
            continue

        # Faz merge de config do plugin
        globalConfig = maybeMergeConfig(plugin.get('pluginConfig'), globalConfig)

        logging.info('\t==> Successfully installed dynamic plugin %s', package)

    # Salva config global no final
    yaml.safe_dump(globalConfig, open(dynamicPluginsGlobalConfigFile, 'w'))

    # Remove plugins que ficaram sem hash no path
    for old_hash in plugin_path_by_hash:
        old_plugin_dir = plugin_path_by_hash[old_hash]
        plugin_directory = os.path.join(dynamicPluginsRoot, old_plugin_dir)
        logging.info('\n======= Removing previously installed dynamic plugin %s', old_plugin_dir)
        shutil.rmtree(plugin_directory, ignore_errors=True, onerror=None)

    # Exibe tempo total
    end_time = datetime.now()
    elapsed_time = end_time - start_time
    print(f"Total Execution Timeeeee: {elapsed_time}")

if __name__ == "__main__":
    main()
