#
# Copyright (c) 2023 Red Hat, Inc.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

import copy
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

# This script is used to install dynamic plugins in the Backstage application,
# and is available in the container image to be called at container initialization,
# for example in an init container when using Kubernetes.
#
# It expects, as the only argument, the path to the root directory where
# the dynamic plugins will be installed.
#
# Additionally, the MAX_ENTRY_SIZE environment variable can be defined to set
# the maximum size of a file in the archive (default: 20MB).
#
# The SKIP_INTEGRITY_CHECK environment variable can be defined with ("true") to skip the integrity check of remote packages
#
# It expects the `dynamic-plugins.yaml` file to be present in the current directory and
# to contain the list of plugins to install along with their optional configuration.
#
# The `dynamic-plugins.yaml` file must contain:
#   - a `plugins` list of objects with the following properties:
#     - `package`: the NPM package to install (either a package name or a path to a local package)
#     - `integrity`: a string containing the integrity hash of the package (optional if package is local, as integrity check is not checked for local packages)
#     - `pluginConfig`: an optional plugin-specific configuration fragment
#     - `disabled`: an optional boolean to disable the plugin (`false` by default)
#   - an optional `includes` list of yaml files to include, each file containing a list of plugins.
#
# The plugins listed in the included files will be included in the main list of considered plugins
# and possibly overwritten by the plugins already listed in the main `plugins` list.
#
# For each enabled plugin mentioned in the main `plugins` list and the various included files,
# the script will:
#   - call `npm pack` to get the package archive and extract it in the dynamic plugins root directory
#   - if the package comes from a remote registry, verify the integrity of the package with the given integrity hash
#   - merge the plugin-specific configuration fragment in a global configuration file named `app-config.dynamic-plugins.yaml`
#

class InstallException(Exception):
    """Exception class from which every exception in this library will derive."""
    pass

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

RECOGNIZED_ALGORITHMS = (
    'sha512',
    'sha384',
    'sha256',
)

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
        rv = subprocess.run([self._skopeo] + command, check=True)
        if rv.returncode != 0:
            raise InstallException(f'Error while running skopeo command: {rv.stderr}')

    def get_plugin_tar(self, image: str) -> str:
        if image not in self.image_to_tarball:
            # run skopeo copy to copy the tar ball to the local filesystem
            print(f'\t==> Copying image {image} to local filesystem', flush=True)
            image_digest = hashlib.sha256(image.encode('utf-8'), usedforsecurity=False).hexdigest()
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
            # extract only the files in specified directory
            filesToExtract = []
            for member in tar.getmembers():
                if not member.name.startswith(plugin_path):
                    continue
                # zip bomb protection
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
        # split by ! to get the path in the image
        (image, plugin_path) = package.split('!')
        tar_file = self.get_plugin_tar(image)
        plugin_directory = os.path.join(self.destination, plugin_path)
        if os.path.exists(plugin_directory):
            print('\t==> Removing previous plugin directory', plugin_directory, flush=True)
            shutil.rmtree(plugin_directory, ignore_errors=True, onerror=None)
        self.extract_plugin(tar_file=tar_file, plugin_path=plugin_path)
        return plugin_path

def verify_package_integrity(plugin: dict, archive: str, working_directory: str) -> None:
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

    cat_process = subprocess.Popen(["cat", archive], stdout=subprocess.PIPE)
    openssl_dgst_process = subprocess.Popen(["openssl", "dgst", "-" + algorithm, "-binary"], stdin=cat_process.stdout, stdout=subprocess.PIPE)
    openssl_base64_process = subprocess.Popen(["openssl", "base64", "-A"], stdin=openssl_dgst_process.stdout, stdout=subprocess.PIPE)

    output, _ = openssl_base64_process.communicate()
    if hash_digest != output.decode('utf-8').strip():
      raise InstallException(f'{package}: The hash of the downloaded package {output.decode("utf-8").strip()} does not match the provided integrity hash {hash_digest} provided in the configuration file')

# Create the lock file, so that other instances of the script will wait for this one to finish
def create_lock(lock_file_path):
    while True:
      try:
        with open(lock_file_path, 'x'):
          print(f"======= Created lock file: {lock_file_path}")
          return
      except FileExistsError:
        wait_for_lock_release(lock_file_path)

# Remove the lock file
def remove_lock(lock_file_path):
   os.remove(lock_file_path)
   print(f"======= Removed lock file: {lock_file_path}")

# Wait for the lock file to be released
def wait_for_lock_release(lock_file_path):
   print("======= Waiting for lock release...", flush=True)
   while True:
     if not os.path.exists(lock_file_path):
       break
     time.sleep(1)
   print("======= Lock released.")

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

        # if `package` already exists in `allPlugins`, then override its fields
        if package not in allPlugins:
            allPlugins[package] = plugin
            continue

        # override the included plugins with fields in the main plugins list
        print('\n======= Overriding dynamic plugin configuration', package, flush=True)
        for key in plugin:
            if key == 'package':
                continue
            allPlugins[package][key] = plugin[key]

    # add a hash for each plugin configuration to detect changes
    for plugin in allPlugins.values():
        hash_dict = copy.deepcopy(plugin)
        hash_dict.pop('pluginConfig', None)
        hash = hashlib.sha256(json.dumps(hash_dict, sort_keys=True).encode('utf-8')).hexdigest()
        plugin['hash'] = hash

    # create a dict installed_plugins of all installed plugins in dynamicPluginsRoot
    installed_plugins = {}
    for dir_name in os.listdir(dynamicPluginsRoot):
        dir_path = os.path.join(dynamicPluginsRoot, dir_name)
        if os.path.isdir(dir_path):
            hash_file_path = os.path.join(dir_path, 'dynamic-plugin-config.hash')
            if os.path.isfile(hash_file_path):
                with open(hash_file_path, 'r') as hash_file:
                    hash_value = hash_file.read().strip()
                    installed_plugins[hash_value] = dir_name

    oci_downloader = OciDownloader(dynamicPluginsRoot)
    # iterate through the list of plugins
    for plugin in allPlugins.values():
        package = plugin['package']

        if 'disabled' in plugin and plugin['disabled'] is True:
            print('\n======= Skipping disabled dynamic plugin', package, flush=True)
            continue

        plugin_already_installed = False
        if plugin['hash'] in installed_plugins:
            force_download = plugin.get('forceDownload', False)
            if force_download:
                print('\n======= Forcing download of already installed dynamic plugin', package, flush=True)
            else:
                print('\n======= Skipping download of already installed dynamic plugin', package, flush=True)
                plugin_already_installed = True
            # remove the hash from installed_plugins so that we can detect plugins that have been removed
            installed_plugins.pop(plugin['hash'])

        if not plugin_already_installed:
            print('\n======= Installing dynamic plugin', package, flush=True)

        package_is_oci = package.startswith('oci://')
        plugin_path = ''
        if package_is_oci and not plugin_already_installed:
            try:
                plugin_path = oci_downloader.download(package)
            except Exception as e:
                raise InstallException(f"Error while adding OCI plugin {package} to downloader: {e}")
        elif not plugin_already_installed:
            package_is_local = package.startswith('./')

            # If package is not local, then integrity check is mandatory
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
                    print('\t\tSkipping directory entry', member.name, flush=True)
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

            file.close()

            print('\t==> Removing package archive', archive, flush=True)
            os.remove(archive)

        # create a hash file in the plugin directory
        if not plugin_already_installed:
            hash = plugin['hash']
            hash_file_path = os.path.join(dynamicPluginsRoot, plugin_path, 'dynamic-plugin-config.hash')
            with open(hash_file_path, 'w') as hash_file:
                hash_file.write(hash)

        if 'pluginConfig' not in plugin:
          print('\t==> Successfully installed dynamic plugin', package, flush=True)
          continue

        # if some plugin configuration is defined, merge it with the global configuration

        print('\t==> Merging plugin-specific configuration', flush=True)
        config = plugin['pluginConfig']
        if config is not None and isinstance(config, dict):
                merge(config, globalConfig)

        print('\t==> Successfully installed dynamic plugin', package, flush=True)

    yaml.safe_dump(globalConfig, open(dynamicPluginsGlobalConfigFile, 'w'))

    # remove plugins that have been removed from the configuration
    for hash_value in installed_plugins:
        plugin_directory = os.path.join(dynamicPluginsRoot, installed_plugins[hash_value])
        print('\n======= Removing previously installed dynamic plugin', installed_plugins[hash_value], flush=True)
        shutil.rmtree(plugin_directory, ignore_errors=True, onerror=None)

main()
