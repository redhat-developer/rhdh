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
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

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

def merge(source, destination, prefix = ''):
    for key, value in source.items():
        if isinstance(value, dict):
            # get node or create one
            node = destination.setdefault(key, {})
            merge(value, node, key + '.')
        else:
            # if key exists in destination trigger an error
            if key in destination and destination[key] != value:
                raise InstallException(f"Config key '{ prefix + key }' defined differently for 2 dynamic plugins")

            destination[key] = value

    return destination

def maybeMergeConfig(config, globalConfig):
    if config is not None and isinstance(config, dict):
        logging.info('\t==> Merging plugin-specific configuration')
        return merge(config, globalConfig)
    else:
        return globalConfig

class OciDownloader:
    def __init__(self, destination: str):
        self._skopeo = shutil.which('skopeo')
        if self._skopeo is None:
            raise InstallException('skopeo executable not found in PATH')

        self.tmp_dir_obj = tempfile.TemporaryDirectory()
        self.tmp_dir = self.tmp_dir_obj.name
        self.image_to_tarball = {}
        self.destination = destination
        self.cat_cmd = shutil.which('cat')
        self.openssl_cmd = shutil.which('openssl')

        if not self.cat_cmd or not self.openssl_cmd:
            raise InstallException("Required utilities 'cat' and 'openssl' not found in PATH.")

    def skopeo(self, command):
        rv = subprocess.run([self._skopeo] + command, check=True, capture_output=True, text=True)
        if rv.returncode != 0:
            raise InstallException(f'Error while running skopeo command: {rv.stderr}')
        return rv.stdout

    def get_plugin_tar(self, image: str) -> str:
        if image not in self.image_to_tarball:
            # run skopeo copy to copy the tar ball to the local filesystem
            logging.info(f'\t==> Copying image {image} to local filesystem')
            image_digest = hashlib.sha256(image.encode('utf-8'), usedforsecurity=False).hexdigest()
            local_dir = os.path.join(self.tmp_dir, image_digest)
            # replace oci:// prefix with docker://
            image_url = image.replace('oci://', 'docker://')
            self.skopeo(['copy', image_url, f'dir:{local_dir}'])
            manifest_path = os.path.join(local_dir, 'manifest.json')
            with open(manifest_path, 'r') as f:
                manifest = json.load(f)

            # get the first layer of the image
            layer = manifest['layers'][0]['digest']
            (_sha, filename) = layer.split(':')
            local_path = os.path.join(local_dir, filename)
            self.image_to_tarball[image] = local_path

        return self.image_to_tarball[image]

    def extract_plugin(self, tar_file: str, plugin_path: str) -> None:
        extracted_path = os.path.abspath(self.destination)
        with tarfile.open(tar_file, 'r:gz') as tar:
            members = []
            for member in tar.getmembers():
                if not member.name.startswith(plugin_path):
                    continue

                if member.size > int(os.environ.get('MAX_ENTRY_SIZE', 20000000)):
                    raise InstallException(f'Zip bomb detected in {member.name}')

                if member.islnk() or member.issym():
                    realpath = os.path.realpath(os.path.join(extracted_path, plugin_path, *os.path.split(member.linkname)))
                    if not realpath.startswith(extracted_path):
                        logging.warning(f'\t==> WARNING: skipping file containing link outside of the archive: {member.name} -> {member.linkpath}')
                        continue
                members.append(member)

            tar.extractall(extracted_path, members=members, filter='tar')


    def download(self, package: str) -> str:
        # split by ! to get the path in the image
        (image, plugin_path) = package.split('!')
        tar_file = self.get_plugin_tar(image)
        plugin_directory = os.path.join(self.destination, plugin_path)
        if os.path.exists(plugin_directory):
            logging.info(f'\t==> Removing previous plugin directory {plugin_directory}')
            shutil.rmtree(plugin_directory, ignore_errors=True, onerror=None)
        self.extract_plugin(tar_file=tar_file, plugin_path=plugin_path)
        return plugin_path

    def digest(self, package: str) -> str:
        (image, plugin_path) = package.split('!')
        image_url = image.replace('oci://', 'docker://')
        output = self.skopeo(['inspect', image_url])
        data = json.loads(output)
        # OCI artifact digest field is defined as "hash method" ":" "hash"
        digest = data['Digest'].split(':')[1]
        return f"{digest}"

def verify_package_integrity(plugin: dict, archive: str, working_directory: str, cat_cmd, openssl_cmd) -> None:
    package = plugin['package']
    if 'integrity' not in plugin:
        raise InstallException(f'Package integrity for {package} is missing')

    integrity = plugin['integrity']
    if not isinstance(integrity, str):
        raise InstallException(f'Package integrity for {package} must be a string')

    integrity = integrity.split('-')
    if len(integrity) != 2:
        raise InstallException(f'Package integrity for {package} must be a string of the form <algorithm>-<hash>')

    algorithm = integrity[0]
    if algorithm not in RECOGNIZED_ALGORITHMS:
        raise InstallException(f'{package}: Provided Package integrity algorithm {algorithm} is not supported, please use one of following algorithms {RECOGNIZED_ALGORITHMS} instead')

    hash_digest = integrity[1]
    try:
      base64.b64decode(hash_digest, validate=True)
    except binascii.Error:
      raise InstallException(f'{package}: Provided Package integrity hash {hash_digest} is not a valid base64 encoding')

    # Use pre-validated commands from OciDownloader
    cat_process = subprocess.Popen([cat_cmd, archive], stdout=subprocess.PIPE)
    openssl_dgst_process = subprocess.Popen([openssl_cmd, "dgst", "-" + algorithm, "-binary"], stdin=cat_process.stdout, stdout=subprocess.PIPE)
    openssl_base64_process = subprocess.Popen([openssl_cmd, "base64", "-A"], stdin=openssl_dgst_process.stdout, stdout=subprocess.PIPE)

    output, _ = openssl_base64_process.communicate()
    if hash_digest != output.decode('utf-8').strip():
      raise InstallException(f'{package}: The hash of the downloaded package {output.decode("utf-8").strip()} does not match the provided integrity hash {hash_digest} provided in the configuration file')

# Create the lock file, so that other instances of the script will wait for this one to finish
def create_lock(lock_file_path):
    while True:
      try:
        with open(lock_file_path, 'x'):
          logging.info(f"======= Created lock file: {lock_file_path}")
          return
      except FileExistsError:
        wait_for_lock_release(lock_file_path)

# Remove the lock file
def remove_lock(lock_file_path):
   os.remove(lock_file_path)
   logging.info(f"======= Removed lock file: {lock_file_path}")

# Wait for the lock file to be released
def wait_for_lock_release(lock_file_path):
   logging.info(f"======= Waiting for lock release (file: {lock_file_path})...")
   while True:
     if not os.path.exists(lock_file_path):
       break
     time.sleep(1)
   logging.info("======= Lock released.")

def load_yaml(file_path):
    """Load YAML content from a file."""
    try:
        with open(file_path, 'r') as file:
            return yaml.safe_load(file)
    except FileNotFoundError:
        logging.warning(f"File not found: {file_path}")
        return None
    except yaml.YAMLError as e:
        raise InstallException(f"Error parsing YAML file {file_path}: {e}")

def main():

    dynamicPluginsRoot = sys.argv[1]

    lock_file_path = os.path.join(dynamicPluginsRoot, 'install-dynamic-plugins.lock')
    atexit.register(remove_lock, lock_file_path)
    signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(0))
    create_lock(lock_file_path)

    maxEntrySize = int(os.environ.get('MAX_ENTRY_SIZE', 20000000))
    skipIntegrityCheck = os.environ.get("SKIP_INTEGRITY_CHECK", "").lower() == "true"

    dynamicPluginsFile = 'dynamic-plugins.yaml'
    dynamicPluginsGlobalConfigFile = os.path.join(dynamicPluginsRoot, 'app-config.dynamic-plugins.yaml')

    # test if file dynamic-plugins.yaml exists
    if not os.path.isfile(dynamicPluginsFile):
        logging.info(f"No {dynamicPluginsFile} file found. Skipping dynamic plugins installation.")
        with open(dynamicPluginsGlobalConfigFile, 'w') as file:
            file.write('')
            file.close()
        exit(0)

    globalConfig = {
      'dynamicPlugins': {
            'rootDirectory': 'dynamic-plugins-root'
      }
    }

    content = load_yaml(dynamicPluginsFile)

    if content == '' or content is None:
        logging.info(f"{dynamicPluginsFile} file is empty. Skipping dynamic plugins installation.")
        with open(dynamicPluginsGlobalConfigFile, 'w') as file:
            file.write('')
            file.close()
        exit(0)

    if not isinstance(content, dict):
        raise InstallException(f"{dynamicPluginsFile} content must be a YAML object")

    allPlugins = {}

    if skipIntegrityCheck:
        logging.info(f"SKIP_INTEGRITY_CHECK has been set to {skipIntegrityCheck}, skipping integrity check of packages")

    includes = content.get('includes', [])

    if not isinstance(includes, list):
        raise InstallException(f"content of the \'includes\' field must be a list in {dynamicPluginsFile}")

    for include in includes:
        if not isinstance(include, str):
            raise InstallException(f"content of the \'includes\' field must be a list of strings in {dynamicPluginsFile}")

        logging.info('\n======= Including dynamic plugins from %s', include)

        includeContent = load_yaml(include)

        if includeContent is None:
            continue

        if not isinstance(includeContent, dict):
            raise InstallException(f"{include} content must be a YAML object")

        includePlugins = includeContent.get('plugins', [])
        if not isinstance(includePlugins, list):
            raise InstallException(f"content of the \'plugins\' field must be a list in {include}")

        for plugin in includePlugins:
            allPlugins[plugin['package']] = plugin

    plugins = content.get('plugins', [])

    if not isinstance(plugins, list):
        raise InstallException(f"content of the \'plugins\' field must be a list in {dynamicPluginsFile}")

    for plugin in plugins:
        package = plugin['package']
        if not isinstance(package, str):
            raise InstallException(f"content of the \'plugins.package\' field must be a string in {dynamicPluginsFile}")

        # if `package` already exists in `allPlugins`, then override its fields
        if package not in allPlugins:
            allPlugins[package] = plugin
            continue

        # override the included plugins with fields in the main plugins list
        logging.info('\n======= Overriding dynamic plugin configuration %s', package)
        for key in plugin:
            if key == 'package':
                continue
            allPlugins[package][key] = plugin[key]

    # add a hash for each plugin configuration to detect changes
    for plugin in allPlugins.values():
        hash_dict = copy.deepcopy(plugin)
        # remove elements that shouldn't be tracked for installation detection
        hash_dict.pop('pluginConfig', None)
        hash = hashlib.sha256(json.dumps(hash_dict, sort_keys=True).encode('utf-8')).hexdigest()
        plugin['hash'] = hash

    # create a dict of all currently installed plugins in dynamicPluginsRoot
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

    # iterate through the list of plugins
    for plugin in allPlugins.values():
        package = plugin['package']

        if 'disabled' in plugin and plugin['disabled'] is True:
            logging.info('\n======= Skipping disabled dynamic plugin %s', package)
            continue

        # Stores the relative path of the plugin directory once downloaded
        plugin_path = ''
        if package.startswith('oci://'):
            # The OCI downloader
            try:
                pull_policy = plugin.get('pullPolicy', PullPolicy.ALWAYS if ':latest!' in package else PullPolicy.IF_NOT_PRESENT)

                if plugin['hash'] in plugin_path_by_hash and pull_policy == PullPolicy.IF_NOT_PRESENT:
                    logging.info('\n======= Skipping download of already installed dynamic plugin %s', package)
                    plugin_path_by_hash.pop(plugin['hash'])
                    globalConfig = maybeMergeConfig(plugin.get('pluginConfig'), globalConfig)
                    continue

                if plugin['hash'] in plugin_path_by_hash and pull_policy == PullPolicy.ALWAYS:
                    digest_file_path = os.path.join(dynamicPluginsRoot, plugin_path_by_hash.pop(plugin['hash']), 'dynamic-plugin-image.hash')
                    local_image_digest = None
                    if os.path.isfile(digest_file_path):
                        with open(digest_file_path, 'r') as digest_file:
                            digest_value = digest_file.read().strip()
                            local_image_digest = digest_value
                    remote_image_digest = oci_downloader.digest(package)
                    if remote_image_digest == local_image_digest:
                        logging.info('\n======= Skipping download of already installed dynamic plugin %s', package)
                        globalConfig = maybeMergeConfig(plugin.get('pluginConfig'), globalConfig)
                        continue
                    else:
                        logging.info('\n======= Installing dynamic plugin %s', package)

                else:
                    logging.info('\n======= Installing dynamic plugin %s', package)

                plugin_path = oci_downloader.download(package)
                digest_file_path = os.path.join(dynamicPluginsRoot, plugin_path, 'dynamic-plugin-image.hash')
                with open(digest_file_path, 'w') as digest_file:
                    digest_file.write(oci_downloader.digest(package))
                # remove any duplicate hashes which can occur when only the version is updated
                for key in [k for k, v in plugin_path_by_hash.items() if v == plugin_path]:
                    plugin_path_by_hash.pop(key)
            except Exception as e:
                raise InstallException(f"Error while adding OCI plugin {package} to downloader: {e}")
        else:
            # The NPM downloader
            plugin_already_installed = False
            pull_policy = plugin.get('pullPolicy', PullPolicy.IF_NOT_PRESENT)

            if plugin['hash'] in plugin_path_by_hash:
                force_download = plugin.get('forceDownload', False)
                if pull_policy == PullPolicy.ALWAYS or force_download:
                    logging.info('\n======= Forcing download of already installed dynamic plugin %s', package)
                else:
                    logging.info('\n======= Skipping download of already installed dynamic plugin %s', package)
                    plugin_already_installed = True
                # remove the hash from plugin_path_by_hash so that we can detect plugins that have been removed
                plugin_path_by_hash.pop(plugin['hash'])
            else:
                logging.info('\n======= Installing dynamic plugin %s', package)

            if plugin_already_installed:
                globalConfig = maybeMergeConfig(plugin.get('pluginConfig'), globalConfig)
                continue

            package_is_local = package.startswith('./')

            # If package is not local, then integrity check is mandatory
            if not package_is_local and not skipIntegrityCheck and not 'integrity' in plugin:
                raise InstallException(f"No integrity hash provided for Package {package}")

            if package_is_local:
                package = os.path.join(os.getcwd(), package[2:])

            logging.info('\t==> Grabbing package archive through `npm pack`')
            completed = subprocess.run(['npm', 'pack', package], capture_output=True, cwd=dynamicPluginsRoot, text=True)
            if completed.returncode != 0:
                raise InstallException(f'Error while installing plugin { package } with \'npm pack\' : ' + completed.stderr)

            archive = os.path.join(dynamicPluginsRoot, completed.stdout.strip())

            if not (package_is_local or skipIntegrityCheck):
                logging.info('\t==> Verifying package integrity')
                verify_package_integrity(plugin, archive, dynamicPluginsRoot, oci_downloader.cat_cmd, oci_downloader.openssl_cmd)

            directory = archive.replace('.tgz', '')
            directoryRealpath = os.path.realpath(directory)
            plugin_path = os.path.basename(directoryRealpath)

            if os.path.exists(directory):
                logging.info('\t==> Removing previous plugin directory %s', directory)
                shutil.rmtree(directory, ignore_errors=True, onerror=None)
            os.mkdir(directory)

            logging.info('\t==> Extracting package archive %s', archive)
            with tarfile.open(archive, 'r:gz') as file:
                # extract the archive content but take care of zip bombs
                for member in file.getmembers():
                    if member.isreg():
                        if not member.name.startswith('package/'):
                            raise InstallException("NPM package archive archive does not start with 'package/' as it should: " + member.name)

                        if member.size > maxEntrySize:
                            raise InstallException('Zip bomb detected in ' + member.name)

                        member.name = member.name.removeprefix('package/')
                        file.extract(member, path=directory, filter='tar')
                    elif member.isdir():
                        logging.info('\t\tSkipping directory entry %s', member.name)
                    elif member.islnk() or member.issym():
                        if not member.linkpath.startswith('package/'):
                            raise InstallException('NPM package archive contains a link outside of the archive: ' + member.name + ' -> ' + member.linkpath)

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

            logging.info('\t==> Removing package archive %s', archive)
            os.remove(archive)

        # create a hash file in the plugin directory
        hash = plugin['hash']
        hash_file_path = os.path.join(dynamicPluginsRoot, plugin_path, 'dynamic-plugin-config.hash')
        with open(hash_file_path, 'w') as digest_file:
            digest_file.write(hash)

        if 'pluginConfig' not in plugin:
          logging.info('\t==> Successfully installed dynamic plugin %s', package)
          continue

        # if some plugin configuration is defined, merge it with the global configuration
        globalConfig = maybeMergeConfig(plugin.get('pluginConfig'), globalConfig)

        logging.info('\t==> Successfully installed dynamic plugin %s', package)

    yaml.safe_dump(globalConfig, open(dynamicPluginsGlobalConfigFile, 'w'))

    # remove plugins that have been removed from the configuration
    for hash_value in plugin_path_by_hash:
        plugin_directory = os.path.join(dynamicPluginsRoot, plugin_path_by_hash[hash_value])
        logging.info('\n======= Removing previously installed dynamic plugin %s', plugin_path_by_hash[hash_value])
        shutil.rmtree(plugin_directory, ignore_errors=True, onerror=None)

if __name__ == "__main__":
    main()
