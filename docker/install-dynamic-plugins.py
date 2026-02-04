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
import re

"""
Dynamic Plugin Installer for Backstage Application

This script is used to install dynamic plugins in the Backstage application, and is available in the container image to be called at container initialization, for example in an init container when using Kubernetes.

It expects, as the only argument, the path to the root directory where the dynamic plugins will be installed.

Environment Variables:
    MAX_ENTRY_SIZE: Maximum size of a file in the archive (default: 20MB)
    SKIP_INTEGRITY_CHECK: Set to "true" to skip integrity check of remote packages
    CATALOG_INDEX_IMAGE: OCI image reference for the plugin catalog index (e.g., quay.io/rhdh/plugin-catalog-index:1.9)

Configuration:
    The script expects the `dynamic-plugins.yaml` file to be present in the current directory and to contain the list of plugins to install along with their optional configuration.

    The `dynamic-plugins.yaml` file must contain:
    - a `plugins` list of objects with the following properties:
        - `package`: the package to install (NPM package name, local path starting with './', or OCI image starting with 'oci://')
            - For OCI packages ONLY, the tag or digest can be replaced by the `{{inherit}}` tag (requires the included configuration to contain a valid tag or digest to inherit from)
            - If the OCI image contains only a single plugin, the plugin path can be omitted and will be auto-detected from the image metadata (normally specified by !<plugin-path>)
            - When using `{{inherit}}`, the plugin path can also be omitted to inherit both version and path from a base configuration (only works if exactly one plugin from that image is defined in included files)
        - `integrity`: a string containing the integrity hash of the package (required for remote NPM packages unless SKIP_INTEGRITY_CHECK is set, optional for local packages, not used for OCI packages)
        - `pluginConfig`: an optional plugin-specific configuration fragment
        - `disabled`: an optional boolean to disable the plugin (`false` by default)
        - `pullPolicy`: download behavior control - 'IfNotPresent' (default) or 'Always' (OCI packages with ':latest!' default to 'Always')
        - `forceDownload`: an optional boolean to force download for NPM packages even if already installed (`false` by default)
    - an optional `includes` list of yaml files to include, each file containing a list of plugins

    The plugins listed in the included files will be included in the main list of considered plugins and possibly overwritten by the plugins already listed in the main `plugins` list.

    A simple empty example `dynamic-plugins.yaml` file:

    ```yaml
    includes:
      - dynamic-plugins.default.yaml
    plugins: []
    ```

Package Types:
    1. NPM packages: Standard package names (e.g., '@backstage/plugin-catalog')
    2. Local packages: Paths starting with './' (e.g., './my-local-plugin') - automatically detects changes via package.json version, modification times, and lock files
    3. OCI packages: Images starting with 'oci://' (e.g., 'oci://quay.io/user/plugin:v1.0!plugin-name')

Pull Policies:
    - IfNotPresent: Only download if not already installed (default for most packages)
    - Always: Always check for updates and download if different (default for OCI packages with ':latest!' tag)

Process:
    For each enabled plugin mentioned in the main `plugins` list and the various included files, the script will:
    - For NPM packages: call `npm pack` to get the package archive and extract it
    - For OCI packages: use `skopeo` to download and extract the specified plugin from the container image
    - For local packages: pack and extract from the local filesystem
    - Verify package integrity (for remote NPM packages only, unless skipped)
    - Track installation state using hash files to detect changes and avoid unnecessary re-downloads
    - Merge the plugin-specific configuration fragment in a global configuration file named `app-config.dynamic-plugins.yaml`

"""

class PullPolicy(StrEnum):
    IF_NOT_PRESENT = 'IfNotPresent'
    ALWAYS = 'Always'
    # NEVER = 'Never' not needed

class InstallException(Exception):
    """Exception class from which every exception in this library will derive."""
    pass

# Refer to https://github.com/opencontainers/image-spec/blob/main/descriptor.md#registered-algorithms
RECOGNIZED_ALGORITHMS = (
    'sha512',
    'sha256',
    'blake3',
)

DOCKER_PROTOCOL_PREFIX = 'docker://'
OCI_PROTOCOL_PREFIX = 'oci://'

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

def maybe_merge_config(config, global_config):
    if config is not None and isinstance(config, dict):
        print('\t==> Merging plugin-specific configuration', flush=True)
        return merge(config, global_config)
    else:
        return global_config

def merge_plugin(plugin: dict, all_plugins: dict, dynamic_plugins_file: str, level: int):
    package = plugin['package']
    if not isinstance(package, str):
        raise InstallException(f"content of the \'plugins.package\' field must be a string in {dynamic_plugins_file}")

    if package.startswith(OCI_PROTOCOL_PREFIX):
        return OciPackageMerger(plugin, dynamic_plugins_file, all_plugins).merge_plugin(level)
    else:
        # Use NPMPackageMerger for all other package types (NPM, git, local, tarball, etc.)
        return NPMPackageMerger(plugin, dynamic_plugins_file, all_plugins).merge_plugin(level)

def run_command(command: list[str], error_message: str, cwd: str = None, text: bool = True) -> subprocess.CompletedProcess:
    """
    Run a subprocess command with consistent error handling.
    
    Args:
        command: List of command arguments to execute
        error_message: Descriptive error message prefix for failures
        cwd: Working directory for the command (optional)
        text: If True, decode stdout/stderr as text (default: True)
    
    Returns:
        subprocess.CompletedProcess: The result of the command execution
    
    Raises:
        InstallException: If the command fails with detailed error information
    """
    try:
        return subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=text,
            cwd=cwd
        )
    except subprocess.CalledProcessError as e:
        def to_text(output):
            return output.strip() if isinstance(output, str) else output.decode('utf-8').strip()
        
        msg = f"{error_message}: command failed with exit code {e.returncode}"
        msg += f"\ncommand: {' '.join(e.cmd)}"
        if e.stderr:
            msg += f"\nstderr: {to_text(e.stderr)}"
        if e.stdout:
            msg += f"\nstdout: {to_text(e.stdout)}"
        raise InstallException(msg)

def get_oci_plugin_paths(image: str) -> list[str]:
    """
    Get list of plugin paths from OCI image via manifest annotation.
    
    Args:
        image: OCI image reference (e.g., 'oci://registry/path:tag')
    
    Returns:
        List of plugin paths from the manifest annotation
    """
    skopeo_path = shutil.which('skopeo')
    if not skopeo_path:
        raise InstallException('skopeo executable not found in PATH')
    
    image_url = image.replace(OCI_PROTOCOL_PREFIX, DOCKER_PROTOCOL_PREFIX)
    result = run_command(
        [skopeo_path, 'inspect', '--raw', image_url],
        f"Failed to inspect OCI image {image}"
    )
    
    try:
        manifest = json.loads(result.stdout)
        annotations = manifest.get('annotations', {})
        annotation_value = annotations.get('io.backstage.dynamic-packages')
        
        if not annotation_value:
            return []
        
        decoded = base64.b64decode(annotation_value).decode('utf-8')
        plugins_metadata = json.loads(decoded)
    except (json.JSONDecodeError, binascii.Error) as e:
        raise InstallException(f"Failed to parse plugin metadata from {image}: {e}")
    
    plugin_paths = []
    for plugin_obj in plugins_metadata:
        if isinstance(plugin_obj, dict):
            plugin_paths.extend(plugin_obj.keys())
    
    return plugin_paths

class PackageMerger:
    def __init__(self, plugin: dict, dynamic_plugins_file: str, all_plugins: dict):
        self.plugin = plugin
        self.dynamic_plugins_file = dynamic_plugins_file
        self.all_plugins = all_plugins
        
    def parse_plugin_key(self, package: str) -> str:
        """Parses the package and returns the plugin key. Must be implemented by subclasses."""
        return package
    
    def add_new_plugin(self, _version: str, _inherit_version: bool, plugin_key: str):
        """Adds a new plugin to the all_plugins dict."""
        self.all_plugins[plugin_key] = self.plugin
    def override_plugin(self, _version: str, _inherit_version: bool, plugin_key: str):
        """Overrides an existing plugin config with a new plugin config in the all_plugins dict."""
        for key in self.plugin:
            self.all_plugins[plugin_key][key] = self.plugin[key]
    def merge_plugin(self, level: int):
        plugin_key = self.plugin['package']
        if not isinstance(plugin_key, str):
            raise InstallException(f"content of the \'package\' field must be a string in {self.dynamic_plugins_file}")
        plugin_key = self.parse_plugin_key(plugin_key)
        
        if plugin_key not in self.all_plugins:
            print(f'\n======= Adding new dynamic plugin configuration for {plugin_key}', flush=True)
            # Keep track of the level of the plugin modification to know when dupe conflicts occur in `includes` and main config files
            self.plugin["last_modified_level"] = level
            self.add_new_plugin("", False, plugin_key)
        else:
            # Override the included plugins with fields in the main plugins list
            print('\n======= Overriding dynamic plugin configuration', plugin_key, flush=True)
            
            # Check for duplicate plugin configurations defined at the same level (level = 0 for `includes` and 1 for the main config file)
            if self.all_plugins[plugin_key].get("last_modified_level") == level:
                raise InstallException(f"Duplicate plugin configuration for {self.plugin['package']} found in {self.dynamic_plugins_file}.")
            
            self.all_plugins[plugin_key]["last_modified_level"] = level
            self.override_plugin("", False, plugin_key)

class NPMPackageMerger(PackageMerger):
    """Handles NPM package merging with version stripping for plugin keys."""
    # Ref: https://docs.npmjs.com/cli/v11/using-npm/package-spec
    # Pattern for standard NPM packages: [@scope/]package[@version|@tag|@version-range|] or [@scope/]package
    # Pattern for standard NPM packages: [@scope/]package[@version|@tag|@version-range|] or [@scope/]package
    NPM_PACKAGE_PATTERN = (
        r'(@[^/]+/)?' # Optional @scope
        r'([^@]+)'     # Package name
        r'(?:@(.+))?'  # Optional @version, @tag, or @version-range
        r'$'
    )

    STANDARD_NPM_PACKAGE_PATTERN = r'^' + NPM_PACKAGE_PATTERN

    # Pattern for NPM aliases: alias@npm:[@scope/]package[@version|@tag]
    NPM_ALIAS_PATTERN = r'^([^@]+)@npm:' + NPM_PACKAGE_PATTERN

    GITHUB_USERNAME_PATTERN = r'([^/@]+)/([^/#]+)'  # username/repo

    # Pattern for git URLs to strip out the #ref part for the plugin key
    GIT_URL_PATTERNS = [
        # git+https://...[#ref]
        (
            r'^git\+https?://[^#]+'   # git+http(s)://<repo>
            r'(?:#(.+))?'             # Optional #ref
            r'$'
        ),
        # git+ssh://...[#ref]
        (
            r'^git\+ssh://[^#]+'
            r'(?:#(.+))?'
            r'$'
        ),
        # git://...[#ref]
        (
            r'^git://[^#]+'
            r'(?:#(.+))?'
            r'$'
        ),
        # https://github.com/user/repo(.git)?[#ref]
        (
            r'^https://github\.com/[^/]+/[^/#]+'
            r'(?:\.git)?'
            r'(?:#(.+))?'
            r'$'
        ),
        # git@github.com:user/repo(.git)?[#ref]
        (
            r'^git@github\.com:[^/]+/[^/#]+'
            r'(?:\.git)?'
            r'(?:#(.+))?'
            r'$'
        ),
        # github:user/repo[#ref]
        (
            r'^github:' + GITHUB_USERNAME_PATTERN +
            r'(?:#(.+))?' +
            r'$'
        ),
        # user/repo[#ref]
        (
            r'^' + GITHUB_USERNAME_PATTERN +
            r'(?:#(.+))?' +
            r'$'
        )
    ]
    
    def __init__(self, plugin: dict, dynamic_plugins_file: str, all_plugins: dict):
        super().__init__(plugin, dynamic_plugins_file, all_plugins)
    
    def parse_plugin_key(self, package: str) -> str:
        """
        Parses NPM package specification and returns a version-stripped plugin key.
        
        Handles various NPM package formats specified in https://docs.npmjs.com/cli/v11/using-npm/package-spec:
        - Standard packages: [@scope/]package[@version] -> [@scope/]package
        - Aliases: alias@npm:package[@version] -> alias@npm:package
        - Git URLs: git+https://... -> git+https://... (without #ref)
        - GitHub shorthand: user/repo#ref -> user/repo
        - Local paths: ./path -> ./path (unchanged)
        - Tarballs: kept as-is since there is no standard format for them
        """
        
        # Local packages don't need version stripping
        if package.startswith('./'):
            return package
        
        # Tarballs are kept as-is since there is no standard format for them
        if package.endswith('.tgz'):
            return package
        
        # remove @version from NPM aliases: alias@npm:package[@version]
        alias_match = re.match(self.NPM_ALIAS_PATTERN, package)
        if alias_match:
            alias_name = alias_match.group(1)
            package_scope = alias_match.group(2) or ''
            npm_package = alias_match.group(3)
            # Recursively parse the npm package part to strip its version
            npm_key = self._strip_npm_package_version(package_scope + npm_package)
            return f"{alias_name}@npm:{npm_key}"
        
        # Check for git URLs
        for git_pattern in self.GIT_URL_PATTERNS:

            git_match = re.match(git_pattern, package)
    
            if git_match:
                # Remove the #ref part if present
                return package.split('#')[0]
        # Handle standard NPM packages
        return self._strip_npm_package_version(package)

    def _strip_npm_package_version(self, package: str) -> str:
        """Strip version from standard NPM package name."""
        npm_match = re.match(self.STANDARD_NPM_PACKAGE_PATTERN, package)
        if npm_match:
            scope = npm_match.group(1) or ''
            pkg_name = npm_match.group(2)
            return f"{scope}{pkg_name}"
        
        # If no pattern matches, return as-is (could be tarball URL or other format)
        return package

class PluginInstaller:
    """Base class for plugin installers with common functionality."""
    
    def __init__(self, destination: str, skip_integrity_check: bool = False):
        self.destination = destination
        self.skip_integrity_check = skip_integrity_check
        
    def should_skip_installation(self, plugin: dict, plugin_path_by_hash: dict) -> tuple[bool, str]:
        """Check if plugin installation should be skipped based on pull policy and current state."""
        plugin_hash = plugin['plugin_hash']
        pull_policy = plugin.get('pullPolicy', PullPolicy.IF_NOT_PRESENT)
        force_download = plugin.get('forceDownload', False)
        
        if plugin_hash not in plugin_path_by_hash:
            return False, "not_installed"
            
        if pull_policy == PullPolicy.ALWAYS or force_download:
            return False, "force_download"
            
        return True, "already_installed"
    
    def install(self, plugin: dict, plugin_path_by_hash: dict) -> str:
        """Install a plugin and return the plugin path. Must be implemented by subclasses."""
        raise NotImplementedError()

class OciPackageMerger(PackageMerger):
    EXPECTED_OCI_PATTERN = (
        r'^(' + OCI_PROTOCOL_PREFIX + r'[^\s:@]+)'
        r'(?:'
            r':([^\s!@:]+)'  # tag only
            r'|'
            r'@((?:sha256|sha512|blake3):[^\s!@:]+)'  # digest only
        r')'
        r'(?:!([^\s]+))?$'  # plugin path is optional for single plugin packages
    )
    def __init__(self, plugin: dict, dynamic_plugins_file: str, all_plugins: dict):
        super().__init__(plugin, dynamic_plugins_file, all_plugins)
    def parse_plugin_key(self, package: str) -> tuple[str, str, bool, str]:
        """
        Parses and validates OCI package name format.
        Generates a plugin key and version from the OCI package name.
        Also checks if the {{inherit}} tag is used correctly.
        
        Args:
            package: The OCI package name.
        Returns:
            plugin_key: plugin key generated from the OCI package name
            version: detected tag or digest of the plugin
            inherit_version: boolean indicating if the `{{inherit}}` tag is used
            resolved_path: the resolved plugin path (either explicit or auto-detected)
        """  
        match = re.match(self.EXPECTED_OCI_PATTERN, package)
        if not match:
            raise InstallException(f"oci package \'{package}\' is not in the expected format \'{OCI_PROTOCOL_PREFIX}<registry>:<tag>\' or \'{OCI_PROTOCOL_PREFIX}<registry>@sha<algo>:<digest>\' (optionally followed by \'!<path>\') in {self.dynamic_plugins_file} where <algo> is one of {RECOGNIZED_ALGORITHMS}")
        
        # Strip away the version (tag or digest) from the package string, resulting in oci://<registry>:!<path>
        # This helps ensure keys used to identify OCI plugins are independent of the version of the plugin
        registry = match.group(1)
        tag_version = match.group(2)
        digest_version = match.group(3)

        version = tag_version if tag_version else digest_version
        
        path = match.group(4)
        
        # {{inherit}} tag indicates that the version should be inherited from the included configuration. Must NOT have a SHA digest included.
        inherit_version = (tag_version == "{{inherit}}" and digest_version == None)
        
        # If {{inherit}} without path, we'll use plugin name with registry as the plugin key
        if inherit_version and not path:
            # Return None for resolved_path - will be inherited during merge_plugin()
            return registry, version, inherit_version, None
        
        # If path is None, auto-detect from OCI manifest
        if not path:
            full_image = f"{registry}:{version}" if tag_version else f"{registry}@{version}"
            print(f"\n======= No plugin path specified for {full_image}, auto-detecting from OCI manifest", flush=True)
            plugin_paths = get_oci_plugin_paths(full_image)
            
            if len(plugin_paths) == 0:
                raise InstallException(
                    f"No plugins found in OCI image {full_image}."
                    f"The image might not contain the 'io.backstage.dynamic-packages' annotation."
                    f"Please ensure this was packaged correctly using the @red-hat-developer-hub/cli plugin package command."
                )
            
            if len(plugin_paths) > 1:
                plugins_list = '\n  - '.join(plugin_paths)
                raise InstallException(
                    f"Multiple plugins found in OCI image {full_image}:\n  - {plugins_list}\n"
                    f"Please specify which plugin to install using the syntax: {full_image}!<plugin-name>"
                )
            
            path = plugin_paths[0]
            print(f'\n======= Auto-resolving OCI package {full_image} to use plugin path: {path}', flush=True)
        
        # At this point, path always exists (either explicitly provided or auto-detected)
        plugin_key = f"{registry}:!{path}"
        
        return plugin_key, version, inherit_version, path
    def add_new_plugin(self, version: str, inherit_version: bool, plugin_key: str):
        """
        Adds a new plugin to the all_plugins dict.
        """
        if inherit_version is True:
            # Cannot use {{inherit}} for the initial plugin configuration
            raise InstallException(f"ERROR: {{{{inherit}}}} tag is set and there is currently no resolved tag or digest for {self.plugin['package']} in {self.dynamic_plugins_file}.")
        else:
            self.plugin["version"] = version
        self.all_plugins[plugin_key] = self.plugin
    def override_plugin(self, version: str, inherit_version: bool, plugin_key: str):
        """
        Overrides an existing plugin config with a new plugin config in the all_plugins dict.
        If `inherit_version` is True, the version of the existing plugin config will be ignored.
        """
        if inherit_version is not True:
            self.all_plugins[plugin_key]['package'] = self.plugin['package'] # Override package since no version inheritance        
            
            if self.all_plugins[plugin_key]['version'] != version:
                print(f"INFO: Overriding version for {plugin_key} from `{self.all_plugins[plugin_key]['version']}` to `{version}`")
            
            self.all_plugins[plugin_key]["version"] = version
            
        for key in self.plugin:
            if key == 'package':
                continue
            if key == "version":
                continue
            self.all_plugins[plugin_key][key] = self.plugin[key]
            
    def merge_plugin(self, level: int):
        package = self.plugin['package']
        if not isinstance(package, str):
            raise InstallException(f"content of the \'package\' field must be a string in {self.dynamic_plugins_file}")
        plugin_key, version, inherit_version, resolved_path = self.parse_plugin_key(package)
        
        # Special case: {{inherit}} without explicit path - match on image only
        if inherit_version and resolved_path is None:
            # plugin_key is the registry (oci://registry/image) when path is omitted
            
            # Find plugins from same image (ignoring path component)
            matches = [key for key in self.all_plugins.keys() 
                      if key.startswith(f"{plugin_key}:!")]
            
            if len(matches) == 0:
                raise InstallException(
                    f"Cannot use {{{{inherit}}}} for {plugin_key}: no existing plugin configuration found. "
                    f"Ensure a plugin from this image is defined in an included file with an explicit version."
                )
            
            if len(matches) > 1:
                full_packages = []
                for m in matches:
                    base_plugin = self.all_plugins[m]
                    base_version = base_plugin.get('version', '')
                    formatted = f"{m.split(':!')[0]}:{base_version}!{m.split(':!')[-1]}"
                    full_packages.append(formatted)
                paths_formatted = '\n  - '.join(full_packages)
                raise InstallException(
                    f"Cannot use {{{{inherit}}}} for {plugin_key}: multiple plugins from this image are defined in the included files:\n  - {paths_formatted}\n"
                    f"Please specify which plugin configuration to inherit from using: {plugin_key}:{{{{inherit}}}}!<plugin_path>"
                )
            
            # inherit both version AND path from the existing plugin configuration
            plugin_key = matches[0]
            base_plugin = self.all_plugins[plugin_key]
            version = base_plugin['version']
            resolved_path = plugin_key.split(':!')[-1]
            
            registry_part = plugin_key.split(':!')[0]
            self.plugin['package'] = f"{registry_part}:{version}!{resolved_path}"
            print(f'\n======= Inheriting version `{version}` and plugin path `{resolved_path}` for {plugin_key}', flush=True)
        
        # Update package with resolved path if it was auto-detected (package didn't originally contain !path)
        elif '!' not in package:
            self.plugin['package'] = f"{package}!{resolved_path}"
        
        # If package does not already exist, add it
        if plugin_key not in self.all_plugins:
            print(f'\n======= Adding new dynamic plugin configuration for version `{version}` of {plugin_key}', flush=True)
            # Keep track of the level of the plugin modification to know when dupe conflicts occur in `includes` and main config files
            self.plugin["last_modified_level"] = level
            self.add_new_plugin(version, inherit_version, plugin_key)
        else:
            # Override the included plugins with fields in the main plugins list
            print('\n======= Overriding dynamic plugin configuration', plugin_key, flush=True)
            
            # Check for duplicate plugin configurations defined at the same level (level = 0 for `includes` and 1 for the main config file)
            if self.all_plugins[plugin_key].get("last_modified_level") == level:
                raise InstallException(f"Duplicate plugin configuration for {self.plugin['package']} found in {self.dynamic_plugins_file}.")
        
            self.all_plugins[plugin_key]["last_modified_level"] = level
            self.override_plugin(version, inherit_version, plugin_key)

class OciDownloader:
    """Helper class for downloading and extracting plugins from OCI container images."""
    
    def __init__(self, destination: str):
        self._skopeo = shutil.which('skopeo')
        if self._skopeo is None:
            raise InstallException('skopeo executable not found in PATH')

        self.tmp_dir_obj = tempfile.TemporaryDirectory()
        self.tmp_dir = self.tmp_dir_obj.name
        self.image_to_tarball = {}
        self.destination = destination
        self.max_entry_size = int(os.environ.get('MAX_ENTRY_SIZE', 20000000))

    def skopeo(self, command):
        result = run_command([self._skopeo] + command, 'skopeo command failed')
        return result.stdout

    def get_plugin_tar(self, image: str) -> str:
        if image not in self.image_to_tarball:
            # run skopeo copy to copy the tar ball to the local filesystem
            print(f'\t==> Copying image {image} to local filesystem', flush=True)
            image_digest = hashlib.sha256(image.encode('utf-8'), usedforsecurity=False).hexdigest()
            local_dir = os.path.join(self.tmp_dir, image_digest)
            # replace oci:// prefix with docker://
            image_url = image.replace(OCI_PROTOCOL_PREFIX, DOCKER_PROTOCOL_PREFIX)
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
        with tarfile.open(tar_file, 'r:*') as tar: # NOSONAR
            # extract only the files in specified directory
            files_to_extract = []
            for member in tar.getmembers():
                if not member.name.startswith(plugin_path):
                    continue
                # zip bomb protection
                if member.size > self.max_entry_size:
                    raise InstallException('Zip bomb detected in ' + member.name)

                if member.islnk() or member.issym():
                    realpath = os.path.realpath(os.path.join(plugin_path, *os.path.split(member.linkname)))
                    if not realpath.startswith(plugin_path):
                        print(f'\t==> WARNING: skipping file containing link outside of the archive: {member.name} -> {member.linkpath}', flush=True)
                        continue

                files_to_extract.append(member)
            tar.extractall(os.path.abspath(self.destination), members=files_to_extract, filter='tar')

    def download(self, package: str) -> str:
        # At this point, package always contains ! since parse_plugin_key resolved it
        (image, plugin_path) = package.split('!')
        
        tar_file = self.get_plugin_tar(image)
        plugin_directory = os.path.join(self.destination, plugin_path)
        if os.path.exists(plugin_directory):
            print('\t==> Removing previous plugin directory', plugin_directory, flush=True)
            shutil.rmtree(plugin_directory, ignore_errors=True, onerror=None)
        self.extract_plugin(tar_file=tar_file, plugin_path=plugin_path)
        return plugin_path
    
    def digest(self, package: str) -> str:
        # Extract image reference (before the ! if present)
        if '!' in package:
            (image, _) = package.split('!')
        else:
            image = package
        
        image_url = image.replace(OCI_PROTOCOL_PREFIX, DOCKER_PROTOCOL_PREFIX)
        output = self.skopeo(['inspect', image_url])
        data = json.loads(output)
        # OCI artifact digest field is defined as "hash method" ":" "hash"
        digest = data['Digest'].split(':')[1]
        return f"{digest}"

class OciPluginInstaller(PluginInstaller):
    """Handles OCI container-based plugin installation using skopeo."""
    
    def __init__(self, destination: str, skip_integrity_check: bool = False):
        super().__init__(destination, skip_integrity_check)
        self.downloader = OciDownloader(destination)
        
    def should_skip_installation(self, plugin: dict, plugin_path_by_hash: dict) -> tuple[bool, str]:
        """OCI packages have special digest-based checking for ALWAYS pull policy."""
        package = plugin['package']
        plugin_hash = plugin['plugin_hash']
        pull_policy = plugin.get('pullPolicy', PullPolicy.ALWAYS if ':latest!' in package else PullPolicy.IF_NOT_PRESENT)
        
        if plugin_hash not in plugin_path_by_hash:
            return False, "not_installed"
            
        if pull_policy == PullPolicy.IF_NOT_PRESENT:
            return True, "already_installed"
            
        if pull_policy == PullPolicy.ALWAYS:
            # Check if digest has changed
            installed_path = plugin_path_by_hash[plugin_hash]
            digest_file_path = os.path.join(self.destination, installed_path, 'dynamic-plugin-image.hash')
            
            local_digest = None
            if os.path.isfile(digest_file_path):
                with open(digest_file_path, 'r') as f:
                    local_digest = f.read().strip()
                    
            remote_digest = self.downloader.digest(package)
            if remote_digest == local_digest:
                return True, "digest_unchanged"
                
        return False, "force_download"
    
    def install(self, plugin: dict, plugin_path_by_hash: dict) -> str:
        """Install an OCI plugin package."""
        package = plugin['package']
        if plugin.get('version') is None:
            raise InstallException(f"Tag or Digest is not set for {package}. Please ensure there is at least one plugin configurations contains a valid tag or digest.")

        try:
            plugin_path = self.downloader.download(package)
            
            # Save digest for future comparison
            plugin_directory = os.path.join(self.destination, plugin_path)
            os.makedirs(plugin_directory, exist_ok=True)  # Ensure directory exists
            digest_file_path = os.path.join(plugin_directory, 'dynamic-plugin-image.hash')
            with open(digest_file_path, 'w') as f:
                f.write(self.downloader.digest(package))
                
            # Clean up duplicate hashes
            for key in [k for k, v in plugin_path_by_hash.items() if v == plugin_path]:
                plugin_path_by_hash.pop(key)
                
            return plugin_path
            
        except Exception as e:
            raise InstallException(f"Error while installing OCI plugin {package}: {e}")

class NpmPluginInstaller(PluginInstaller):
    """Handles NPM and local package installation using npm pack."""
    
    def __init__(self, destination: str, skip_integrity_check: bool = False):
        super().__init__(destination, skip_integrity_check)
        self.max_entry_size = int(os.environ.get('MAX_ENTRY_SIZE', 20000000))
    
    def install(self, plugin: dict, plugin_path_by_hash: dict) -> str:
        """Install an NPM or local plugin package."""
        package = plugin['package']
        package_is_local = package.startswith('./')
        
        if package_is_local:
            package = os.path.join(os.getcwd(), package[2:])
        
        # Verify integrity requirements
        if not package_is_local and not self.skip_integrity_check and 'integrity' not in plugin:
            raise InstallException(f"No integrity hash provided for Package {package}")
        
        # Download package
        print('\t==> Grabbing package archive through `npm pack`', flush=True)
        result = run_command(
            ['npm', 'pack', package],
            f"Error while installing plugin {package} with 'npm pack'",
            cwd=self.destination
        )
        
        archive = os.path.join(self.destination, result.stdout.strip())
        
        # Verify integrity for remote packages
        if not (package_is_local or self.skip_integrity_check):
            print('\t==> Verifying package integrity', flush=True)
            verify_package_integrity(plugin, archive)
        
        # Extract package
        plugin_path = self._extract_npm_package(archive)
        
        return plugin_path
    
    def _extract_npm_package(self, archive: str) -> str:
        """Extract NPM package archive with security protections."""
        PACKAGE_DIRECTORY_PREFIX = 'package/'
        directory = archive.replace('.tgz', '')
        directory_realpath = os.path.realpath(directory)
        plugin_path = os.path.basename(directory_realpath)
        
        if os.path.exists(directory):
            print('\t==> Removing previous plugin directory', directory, flush=True)
            shutil.rmtree(directory, ignore_errors=True)
        os.mkdir(directory)
        
        print('\t==> Extracting package archive', archive, flush=True)
        with tarfile.open(archive, 'r:*') as tar:  # NOSONAR
            for member in tar.getmembers():
                if member.isreg():
                    if not member.name.startswith(PACKAGE_DIRECTORY_PREFIX):
                        raise InstallException(f"NPM package archive does not start with 'package/' as it should: {member.name}")
                    
                    if member.size > self.max_entry_size:
                        raise InstallException(f'Zip bomb detected in {member.name}')
                    
                    member.name = member.name.removeprefix(PACKAGE_DIRECTORY_PREFIX)
                    tar.extract(member, path=directory, filter='data')
                    
                elif member.isdir():
                    print('\t\tSkipping directory entry', member.name, flush=True)
                    
                elif member.islnk() or member.issym():
                    if not member.linkpath.startswith(PACKAGE_DIRECTORY_PREFIX):
                        raise InstallException(f'NPM package archive contains a link outside of the archive: {member.name} -> {member.linkpath}')
                    
                    member.name = member.name.removeprefix(PACKAGE_DIRECTORY_PREFIX)
                    member.linkpath = member.linkpath.removeprefix(PACKAGE_DIRECTORY_PREFIX)
                    
                    realpath = os.path.realpath(os.path.join(directory, *os.path.split(member.linkname)))
                    if not realpath.startswith(directory_realpath):
                        raise InstallException(f'NPM package archive contains a link outside of the archive: {member.name} -> {member.linkpath}')
                    
                    tar.extract(member, path=directory, filter='data')
                    
                else:
                    type_mapping = {
                        tarfile.CHRTYPE: "character device",
                        tarfile.BLKTYPE: "block device", 
                        tarfile.FIFOTYPE: "FIFO"
                    }
                    type_str = type_mapping.get(member.type, "unknown")
                    raise InstallException(f'NPM package archive contains a non regular file: {member.name} - {type_str}')
        
        print('\t==> Removing package archive', archive, flush=True)
        os.remove(archive)
        
        return plugin_path

def create_plugin_installer(package: str, destination: str, skip_integrity_check: bool = False) -> PluginInstaller:
    """Factory function to create appropriate plugin installer based on package type."""
    if package.startswith(OCI_PROTOCOL_PREFIX):
        return OciPluginInstaller(destination, skip_integrity_check)
    else:
        return NpmPluginInstaller(destination, skip_integrity_check)

def install_plugin(plugin: dict, plugin_path_by_hash: dict, destination: str, skip_integrity_check: bool = False) -> tuple[str, dict]:
    """Install a single plugin and handle configuration merging."""
    package = plugin['package']
    
    # Check if plugin is disabled
    if plugin.get('disabled', False):
        print(f'\n======= Skipping disabled dynamic plugin {package}', flush=True)
        return None, {}
    
    # Create appropriate installer
    installer = create_plugin_installer(package, destination, skip_integrity_check)
    
    # Check if installation should be skipped
    should_skip, reason = installer.should_skip_installation(plugin, plugin_path_by_hash)
    if should_skip:
        print(f'\n======= Skipping download of already installed dynamic plugin {package} ({reason})', flush=True)
        # Remove from tracking dict so we don't delete it later
        if plugin['plugin_hash'] in plugin_path_by_hash:
            plugin_path_by_hash.pop(plugin['plugin_hash'])
        return None, plugin.get('pluginConfig', {})
    
    # Install the plugin
    print(f'\n======= Installing dynamic plugin {package}', flush=True)
    plugin_path = installer.install(plugin, plugin_path_by_hash)
    
    # Create hash file for tracking
    hash_file_path = os.path.join(destination, plugin_path, 'dynamic-plugin-config.hash')
    with open(hash_file_path, 'w') as f:
        f.write(plugin['plugin_hash'])
    
    print(f'\t==> Successfully installed dynamic plugin {package}', flush=True)
    
    return plugin_path, plugin.get('pluginConfig', {})

RECOGNIZED_ALGORITHMS = (
    'sha512',
    'sha384',
    'sha256',
)

def get_local_package_info(package_path: str) -> dict:
    """Get package information from a local package to include in hash calculation."""
    try:
        if package_path.startswith('./'):
            abs_package_path = os.path.join(os.getcwd(), package_path[2:])
        else:
            abs_package_path = package_path
            
        package_json_path = os.path.join(abs_package_path, 'package.json')
        
        if not os.path.isfile(package_json_path):
            # If no package.json, fall back to directory modification time
            if os.path.isdir(abs_package_path):
                mtime = os.path.getmtime(abs_package_path)
                return {'_directory_mtime': mtime}
            else:
                return {'_not_found': True}
        
        with open(package_json_path, 'r') as f:
            package_json = json.load(f)
            
        # Extract relevant fields that indicate package changes
        info = {}
        info['_package_json'] = package_json
                
        # Also include package.json modification time as additional change detection
        info['_package_json_mtime'] = os.path.getmtime(package_json_path)
        
        # Include package-lock.json or yarn.lock modification time if present
        for lock_file in ['package-lock.json', 'yarn.lock']:
            lock_path = os.path.join(abs_package_path, lock_file)
            if os.path.isfile(lock_path):
                info[f'_{lock_file}_mtime'] = os.path.getmtime(lock_path)
                
        return info
        
    except (json.JSONDecodeError, OSError, IOError) as e:
        # If we can't read the package info, include the error in hash
        # This ensures we'll try to reinstall if there are permission issues, etc.
        return {'_error': str(e)}

def verify_package_integrity(plugin: dict, archive: str) -> None:
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
   print(f"======= Waiting for lock release (file: {lock_file_path})...", flush=True)
   while True:
     if not os.path.exists(lock_file_path):
       break
     time.sleep(1)
   print("======= Lock released.")

# Clean up temporary catalog index directory
def cleanup_catalog_index_temp_dir(dynamic_plugins_root):
   """Clean up temporary catalog index directory."""
   catalog_index_temp_dir = os.path.join(dynamic_plugins_root, '.catalog-index-temp')
   if os.path.exists(catalog_index_temp_dir):
       print('\n======= Cleaning up temporary catalog index directory', flush=True)
       shutil.rmtree(catalog_index_temp_dir, ignore_errors=True, onerror=None)

def _extract_catalog_index_layers(manifest: dict, local_dir: str, catalog_index_temp_dir: str) -> None:
    """Extract layers from the catalog index OCI image."""
    max_entry_size = int(os.environ.get('MAX_ENTRY_SIZE', 20000000))
    
    for layer in manifest.get('layers', []):
        layer_digest = layer.get('digest', '')
        if not layer_digest:
            continue

        (_sha, filename) = layer_digest.split(':')
        layer_file = os.path.join(local_dir, filename)
        if not os.path.isfile(layer_file):
            print(f"\t==> WARNING: Layer file {filename} not found", flush=True)
            continue

        print(f"\t==> Extracting layer {filename}", flush=True)
        _extract_layer_tarball(layer_file, catalog_index_temp_dir, max_entry_size)

def _extract_layer_tarball(layer_file: str, catalog_index_temp_dir: str, max_entry_size: int) -> None:
    """Extract a single layer tarball with security checks."""
    with tarfile.open(layer_file, 'r:*') as tar:  # NOSONAR
        for member in tar.getmembers():
            # Security checks
            if member.size > max_entry_size:
                print(f"\t==> WARNING: Skipping large file {member.name} in catalog index", flush=True)
                continue
            if member.islnk() or member.issym():
                realpath = os.path.realpath(os.path.join(catalog_index_temp_dir, *os.path.split(member.linkname)))
                if not realpath.startswith(catalog_index_temp_dir):
                    print(f"\t==> WARNING: Skipping link outside archive: {member.name}", flush=True)
                    continue
            tar.extract(member, path=catalog_index_temp_dir, filter='data')

def extract_catalog_index(catalog_index_image: str, catalog_index_mount: str, catalog_entities_parent_dir: str) -> str:
    """Extract the catalog index OCI image and return the path to dynamic-plugins.default.yaml if found."""
    print(f"\n======= Extracting catalog index from {catalog_index_image}", flush=True)

    skopeo_path = shutil.which('skopeo')
    if skopeo_path is None:
        raise InstallException("CATALOG_INDEX_IMAGE is set but skopeo executable not found in PATH. Cannot extract catalog index.")

    catalog_index_temp_dir = os.path.join(catalog_index_mount, '.catalog-index-temp')
    os.makedirs(catalog_index_temp_dir, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp_dir:
        image_url = catalog_index_image
        if not image_url.startswith(DOCKER_PROTOCOL_PREFIX):
            image_url = f'{DOCKER_PROTOCOL_PREFIX}{image_url}'
        print("\t==> Copying catalog index image to local filesystem", flush=True)
        local_dir = os.path.join(tmp_dir, 'catalog-index-oci')

        # Download the OCI image using skopeo
        run_command(
            [skopeo_path, 'copy', image_url, f'dir:{local_dir}'],
            f"Failed to download catalog index image {catalog_index_image}"
        )

        manifest_path = os.path.join(local_dir, 'manifest.json')
        if not os.path.isfile(manifest_path):
            raise InstallException(f"manifest.json not found in catalog index image {catalog_index_image}")

        with open(manifest_path, 'r') as f:
            manifest = json.load(f)

        print("\t==> Extracting catalog index layers", flush=True)
        _extract_catalog_index_layers(manifest, local_dir, catalog_index_temp_dir)

    default_plugins_file = os.path.join(catalog_index_temp_dir, 'dynamic-plugins.default.yaml')
    if not os.path.isfile(default_plugins_file):
        raise InstallException(f"Catalog index image {catalog_index_image} does not contain the expected dynamic-plugins.default.yaml file")
    print("\t==> Successfully extracted dynamic-plugins.default.yaml from catalog index image", flush=True)

    print(f"\t==> Extracting extensions catalog entities to {catalog_entities_parent_dir}", flush=True)

    extensions_dir_from_catalog_index = os.path.join(catalog_index_temp_dir, 'catalog-entities', 'extensions')
    if not os.path.isdir(extensions_dir_from_catalog_index):
        # fallback to 'catalog-entities/marketplace' directory for backward compatibility
        extensions_dir_from_catalog_index = os.path.join(catalog_index_temp_dir, 'catalog-entities', 'marketplace')

    if os.path.isdir(extensions_dir_from_catalog_index):
        os.makedirs(catalog_entities_parent_dir, exist_ok=True)
        catalog_entities_dest = os.path.join(catalog_entities_parent_dir, 'catalog-entities')
        # Ensure the destination directory is is sync with the catalog entities from the index image
        if os.path.exists(catalog_entities_dest):
            shutil.rmtree(catalog_entities_dest, ignore_errors=True, onerror=None)
        shutil.copytree(extensions_dir_from_catalog_index, catalog_entities_dest, dirs_exist_ok=True)
        print("\t==> Successfully extracted extensions catalog entities from index image", flush=True)
    else:
        print(f"\t==> WARNING: Catalog index image {catalog_index_image} does not have neither 'catalog-entities/extensions/' nor 'catalog-entities/marketplace/' directory",
            flush=True)

    return default_plugins_file

def main():

    dynamic_plugins_root = sys.argv[1]

    lock_file_path = os.path.join(dynamic_plugins_root, 'install-dynamic-plugins.lock')
    atexit.register(remove_lock, lock_file_path)
    atexit.register(cleanup_catalog_index_temp_dir, dynamic_plugins_root)
    signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(0))
    create_lock(lock_file_path)

    # Extract catalog index if CATALOG_INDEX_IMAGE is set
    catalog_index_image = os.environ.get("CATALOG_INDEX_IMAGE", "")
    catalog_index_default_file = None
    if catalog_index_image:
        # default to a temporary directory if the env var is not set
        catalog_entities_parent_dir = os.environ.get("CATALOG_ENTITIES_EXTRACT_DIR", os.path.join(tempfile.gettempdir(), "extensions"))
        catalog_index_default_file = extract_catalog_index(catalog_index_image, dynamic_plugins_root, catalog_entities_parent_dir)

    skip_integrity_check = os.environ.get("SKIP_INTEGRITY_CHECK", "").lower() == "true"

    dynamic_plugins_file = 'dynamic-plugins.yaml'
    dynamic_plugins_global_config_file = os.path.join(dynamic_plugins_root, 'app-config.dynamic-plugins.yaml')

    # test if file dynamic-plugins.yaml exists
    if not os.path.isfile(dynamic_plugins_file):
        print(f"No {dynamic_plugins_file} file found. Skipping dynamic plugins installation.")
        with open(dynamic_plugins_global_config_file, 'w') as file:
            file.write('')
            file.close()
        exit(0)

    global_config = {
        'dynamicPlugins': {
            'rootDirectory': 'dynamic-plugins-root',
        }
    }

    with open(dynamic_plugins_file, 'r') as file:
        content = yaml.safe_load(file)

    if content == '' or content is None:
        print(f"{dynamic_plugins_file} file is empty. Skipping dynamic plugins installation.")
        with open(dynamic_plugins_global_config_file, 'w') as file:
            file.write('')
            file.close()
        exit(0)

    if not isinstance(content, dict):
        raise InstallException(f"{dynamic_plugins_file} content must be a YAML object")

    all_plugins = {}

    if skip_integrity_check:
        print(f"SKIP_INTEGRITY_CHECK has been set to {skip_integrity_check}, skipping integrity check of remote NPM packages")

    if 'includes' in content:
        includes = content['includes']
    else:
        includes = []

    if not isinstance(includes, list):
        raise InstallException(f"content of the \'includes\' field must be a list in {dynamic_plugins_file}")

    # Replace dynamic-plugins.default.yaml with catalog index if it was extracted
    if catalog_index_image:
        embedded_default = 'dynamic-plugins.default.yaml'
        if embedded_default in includes:
            print(f"\n======= Replacing {embedded_default} with catalog index: {catalog_index_default_file}", flush=True)
            # Replace the embedded default file with the catalog index at the same position
            index = includes.index(embedded_default)
            includes[index] = catalog_index_default_file

    for include in includes:
        if not isinstance(include, str):
            raise InstallException(f"content of the \'includes\' field must be a list of strings in {dynamic_plugins_file}")

        print('\n======= Including dynamic plugins from', include, flush=True)

        if not os.path.isfile(include):
            print(f"WARNING: File {include} does not exist, skipping including dynamic packages from {include}", flush=True)
            continue

        with open(include, 'r') as file:
            include_content = yaml.safe_load(file)

        if not isinstance(include_content, dict):
            raise InstallException(f"{include} content must be a YAML object")

        include_plugins = include_content['plugins']
        if not isinstance(include_plugins, list):
            raise InstallException(f"content of the \'plugins\' field must be a list in {include}")

        for plugin in include_plugins:
            merge_plugin(plugin, all_plugins, include, level=0)

    if 'plugins' in content:
        plugins = content['plugins']
    else:
        plugins = []

    if not isinstance(plugins, list):
        raise InstallException(f"content of the \'plugins\' field must be a list in {dynamic_plugins_file}")

    for plugin in plugins:
        merge_plugin(plugin, all_plugins, dynamic_plugins_file, level=1)
        
    # add a hash for each plugin configuration to detect changes and check if version field is set for OCI packages
    for plugin in all_plugins.values():
        hash_dict = copy.deepcopy(plugin)
        # remove elements that shouldn't be tracked for installation detection
        hash_dict.pop('pluginConfig', None)
        # Don't track the internal version field used to track version inheritance
        hash_dict.pop('version', None)
        
        package = plugin['package']
        if package.startswith('./'):
            local_info = get_local_package_info(package)
            hash_dict['_local_package_info'] = local_info
        
        plugin_hash = hashlib.sha256(json.dumps(hash_dict, sort_keys=True).encode('utf-8')).hexdigest()
        plugin['plugin_hash'] = plugin_hash

    # create a dict of all currently installed plugins in dynamic_plugins_root
    plugin_path_by_hash = {}
    for dir_name in os.listdir(dynamic_plugins_root):
        dir_path = os.path.join(dynamic_plugins_root, dir_name)
        if os.path.isdir(dir_path):
            hash_file_path = os.path.join(dir_path, 'dynamic-plugin-config.hash')
            if os.path.isfile(hash_file_path):
                with open(hash_file_path, 'r') as hash_file:
                    hash_value = hash_file.read().strip()
                    plugin_path_by_hash[hash_value] = dir_name
                    
    # iterate through the list of plugins
    for plugin in all_plugins.values():
        _, plugin_config = install_plugin(plugin, plugin_path_by_hash, dynamic_plugins_root, skip_integrity_check)
        
        # Merge plugin configuration if provided
        if plugin_config:
            global_config = maybe_merge_config(plugin_config, global_config)

    yaml.safe_dump(global_config, open(dynamic_plugins_global_config_file, 'w'))

    # remove plugins that have been removed from the configuration
    for hash_value in plugin_path_by_hash:
        plugin_directory = os.path.join(dynamic_plugins_root, plugin_path_by_hash[hash_value])
        print('\n======= Removing previously installed dynamic plugin', plugin_path_by_hash[hash_value], flush=True)
        shutil.rmtree(plugin_directory, ignore_errors=True, onerror=None)

if __name__ == '__main__':
    main()
