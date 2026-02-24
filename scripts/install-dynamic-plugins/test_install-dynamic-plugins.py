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
"""
Unit tests for install-dynamic-plugins.py

This test suite covers:
- NPMPackageMerger.parse_plugin_key() - Version stripping from NPM packages
- OciPackageMerger.parse_plugin_key() - Parsing OCI package formats
- NPMPackageMerger.merge_plugin() - Plugin config merging and override logic
- OciPackageMerger.merge_plugin() - OCI plugin merging with version inheritance
- extract_catalog_index() - Extracting plugin catalog index from OCI images

Installation:
    To install test dependencies:
    $ pip install -r ../python/requirements-dev.txt

Running tests:
    Run all tests:
    $ pytest test_install-dynamic-plugins.py -v

    Run specific test class:
    $ pytest test_install-dynamic-plugins.py::TestNPMPackageMergerParsePluginKey -v

    Run with coverage:
    $ pytest test_install-dynamic-plugins.py --cov -v
"""

import pytest
import sys
import os
import importlib.util
import json
import hashlib
import base64

# Add the current directory to path to import the module
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import from file with hyphens in name using importlib
script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'install-dynamic-plugins.py')
spec = importlib.util.spec_from_file_location("install_dynamic_plugins", script_path)
install_dynamic_plugins = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install_dynamic_plugins)

# Import the classes and exception from the loaded module
NPMPackageMerger = install_dynamic_plugins.NPMPackageMerger
OciPackageMerger = install_dynamic_plugins.OciPackageMerger
InstallException = install_dynamic_plugins.InstallException

# Test helper functions
import tarfile  # noqa: E402

def create_test_tarball(tarball_path, mode='w:gz'):  # noqa: S202
    """
    Helper function to create test tarballs.

    Note: This is safe for test code as we're creating controlled test data,
    not opening untrusted archives. The noqa: S202 suppresses security warnings
    about tarfile usage which are not applicable to test fixtures.
    """
    return tarfile.open(tarball_path, mode)  # NOSONAR

def create_mock_skopeo_copy(manifest_path, layer_tarball, mock_result):
    """
    Helper function to create mock subprocess.run for skopeo copy operations.

    Args:
        manifest_path: Path to manifest.json file to copy
        layer_tarball: Path to layer tarball file to copy
        mock_result: Mock result object to return

    Returns:
        A function that can be used as side_effect for subprocess.run mock
    """
    def mock_subprocess_run(cmd, **kwargs):
        if 'copy' in cmd:
            dest_arg = [arg for arg in cmd if arg.startswith('dir:')]
            if dest_arg:
                dest_dir = dest_arg[0].replace('dir:', '')
                os.makedirs(dest_dir, exist_ok=True)
                import shutil as sh
                sh.copy(str(manifest_path), dest_dir)
                sh.copy(str(layer_tarball), dest_dir)
        return mock_result

    return mock_subprocess_run


class TestNPMPackageMergerParsePluginKey:
    """Test cases for NPMPackageMerger.parse_plugin_key() method."""

    @pytest.fixture
    def npm_merger(self):
        """Create an NPMPackageMerger instance for testing."""
        plugin = {'package': 'test-package'}
        return NPMPackageMerger(plugin, 'test-file.yaml', {})

    @pytest.mark.parametrize("input_package,expected_output", [
        # Standard NPM packages with version stripping
        ('@npmcli/arborist@latest', '@npmcli/arborist'),
        ('@backstage/plugin-catalog@1.0.0', '@backstage/plugin-catalog'),
        ('semver@7.2.2', 'semver'),
        ('package-name@^1.0.0', 'package-name'),
        ('package-name@~2.1.0', 'package-name'),
        ('package-name@1.x', 'package-name'),

        # Packages without version (unchanged)
        ('package-name', 'package-name'),
        ('@scope/package', '@scope/package'),

        # NPM aliases with version stripping
        ('semver:@npm:semver@7.2.2', 'semver:@npm:semver'),
        ('my-alias@npm:@npmcli/semver-with-patch', 'my-alias@npm:@npmcli/semver-with-patch'),
        ('semver:@npm:@npmcli/semver-with-patch@1.0.0', 'semver:@npm:@npmcli/semver-with-patch'),
        ('alias@npm:package@1.0.0', 'alias@npm:package'),
        ('alias@npm:@scope/package@2.0.0', 'alias@npm:@scope/package'),

        # Git URLs with ref stripping
        ('npm/cli#c12ea07', 'npm/cli'),
        ('user/repo#main', 'user/repo'),
        ('github:user/repo#ref', 'github:user/repo'),
        ('git+https://github.com/user/repo.git#branch', 'git+https://github.com/user/repo.git'),
        ('git+https://github.com/user/repo#branch', 'git+https://github.com/user/repo'),
        ('git@github.com:user/repo.git#ref', 'git@github.com:user/repo.git'),
        ('git+ssh://git@github.com/user/repo.git#tag', 'git+ssh://git@github.com/user/repo.git'),
        ('git://github.com/user/repo#commit', 'git://github.com/user/repo'),
        ('https://github.com/user/repo.git#v1.0.0', 'https://github.com/user/repo.git'),

        # Local paths (unchanged)
        ('./my-local-plugin', './my-local-plugin'),
        ('./path/to/plugin', './path/to/plugin'),

        # Tarballs (unchanged)
        ('package.tgz', 'package.tgz'),
        ('my-package-1.0.0.tgz', 'my-package-1.0.0.tgz'),
        ('https://example.com/package.tgz', 'https://example.com/package.tgz'),
    ])
    def test_parse_plugin_key_success_cases(self, npm_merger, input_package, expected_output):
        """Test that parse_plugin_key correctly strips versions and refs from various package formats."""
        result = npm_merger.parse_plugin_key(input_package)
        assert result == expected_output, f"Expected {expected_output}, got {result}"


class TestOciPackageMergerParsePluginKey:
    """Test cases for OciPackageMerger.parse_plugin_key() method."""

    @pytest.fixture
    def oci_merger(self):
        """Create an OciPackageMerger instance for testing."""
        plugin = {'package': 'oci://example.com:v1.0!plugin'}
        return OciPackageMerger(plugin, 'test-file.yaml', {})

    @pytest.mark.parametrize("input_package,expected_key,expected_version,expected_inherit", [
        # Tag-based packages with explicit path
        (
            'oci://quay.io/user/plugin:v1.0!plugin-name',
            'oci://quay.io/user/plugin:!plugin-name',
            'v1.0',
            False
        ),
        (
            'oci://registry.io/plugin:latest!path/to/plugin',
            'oci://registry.io/plugin:!path/to/plugin',
            'latest',
            False
        ),
        (
            'oci://ghcr.io/org/plugin:1.2.3!my-plugin',
            'oci://ghcr.io/org/plugin:!my-plugin',
            '1.2.3',
            False
        ),
        (
            'oci://docker.io/library/plugin:v2.0.0!plugin',
            'oci://docker.io/library/plugin:!plugin',
            'v2.0.0',
            False
        ),

        # Digest-based packages with different algorithms
        (
            'oci://quay.io/user/plugin@sha256:abc123def456!plugin',
            'oci://quay.io/user/plugin:!plugin',
            'sha256:abc123def456',
            False
        ),
        (
            'oci://registry.io/plugin@sha512:fedcba987654!plugin',
            'oci://registry.io/plugin:!plugin',
            'sha512:fedcba987654',
            False
        ),
        (
            'oci://example.com/plugin@blake3:1234567890abcdef!my-plugin',
            'oci://example.com/plugin:!my-plugin',
            'blake3:1234567890abcdef',
            False
        ),

        # Inherit version pattern
        (
            'oci://quay.io/user/plugin:{{inherit}}!plugin',
            'oci://quay.io/user/plugin:!plugin',
            '{{inherit}}',
            True
        ),
        (
            'oci://registry.io/plugin:{{inherit}}!path/to/plugin',
            'oci://registry.io/plugin:!path/to/plugin',
            '{{inherit}}',
            True
        ),
    ])
    def test_parse_plugin_key_success_cases(
        self, oci_merger, input_package, expected_key, expected_version, expected_inherit
    ):
        """Test that parse_plugin_key correctly parses valid OCI package formats."""
        plugin_key, version, inherit_version, _ = oci_merger.parse_plugin_key(input_package)

        assert plugin_key == expected_key, f"Expected key {expected_key}, got {plugin_key}"
        assert version == expected_version, f"Expected version {expected_version}, got {version}"
        assert inherit_version == expected_inherit, f"Expected inherit {expected_inherit}, got {inherit_version}"

    @pytest.mark.parametrize("invalid_package,error_substring", [
        # Missing tag/digest
        ('oci://registry.io/plugin!path', 'not in the expected format'),
        ('oci://registry.io/plugin', 'not in the expected format'),

        # Invalid format - no tag or digest before !
        ('oci://registry.io!path', 'not in the expected format'),

        # Invalid digest algorithm (md5 not in RECOGNIZED_ALGORITHMS)
        ('oci://registry.io/plugin@md5:abc123!plugin', 'not in the expected format'),

        # Invalid format - multiple @ symbols
        ('oci://registry.io/plugin@@sha256:abc!plugin', 'not in the expected format'),

        # Invalid format - multiple : symbols in tag
        ('oci://registry.io/plugin:v1:v2!plugin', 'not in the expected format'),

        # Empty tag
        ('oci://registry.io/plugin:!plugin', 'not in the expected format'),
        ('oci://registry.io/plugin:', 'not in the expected format'),

        # Empty path after !
        ('oci://registry.io/plugin:v1.0!', 'not in the expected format'),

        # No oci:// prefix (but this should fail the regex)
        ('registry.io/plugin:v1.0!plugin', 'not in the expected format'),
        ('registry.io/plugin:v1.0', 'not in the expected format'),
    ])
    def test_parse_plugin_key_error_cases(self, oci_merger, invalid_package, error_substring):
        """Test that parse_plugin_key raises InstallException for invalid OCI package formats."""
        with pytest.raises(InstallException) as exc_info:
            oci_merger.parse_plugin_key(invalid_package)

        assert error_substring in str(exc_info.value), \
            f"Expected error message to contain '{error_substring}', got: {str(exc_info.value)}"

    def test_parse_plugin_key_complex_digest(self, oci_merger):
        """Test parsing OCI package with complex digest value."""
        # Note: The pattern allows any value after @ including special strings like {{inherit}}
        # though this would be semantically incorrect for digest format
        input_pkg = 'oci://registry.io/plugin@sha256:abc123def456789!plugin'
        plugin_key, version, inherit, resolved_path = oci_merger.parse_plugin_key(input_pkg)

        assert plugin_key == 'oci://registry.io/plugin:!plugin'
        assert version == 'sha256:abc123def456789'
        assert inherit is False
        assert resolved_path == 'plugin'

    def test_parse_plugin_key_strips_version_from_key(self, oci_merger):
        """Test that the plugin key does not contain version information."""
        input_pkg = 'oci://quay.io/user/plugin:v1.0.0!my-plugin'
        plugin_key, version, _, resolved_path = oci_merger.parse_plugin_key(input_pkg)

        # The key should not contain the version
        assert ':v1.0.0' not in plugin_key
        assert plugin_key == 'oci://quay.io/user/plugin:!my-plugin'
        # But the version should be returned separately
        assert version == 'v1.0.0'
        assert resolved_path == 'my-plugin'

    def test_parse_plugin_key_with_nested_path(self, oci_merger):
        """Test parsing OCI package with nested path after !."""
        input_pkg = 'oci://registry.io/plugin:v1.0!path/to/nested/plugin'
        plugin_key, version, inherit, resolved_path = oci_merger.parse_plugin_key(input_pkg)

        assert plugin_key == 'oci://registry.io/plugin:!path/to/nested/plugin'
        assert version == 'v1.0'
        assert inherit is False
        assert resolved_path == 'path/to/nested/plugin'

    def test_parse_plugin_key_auto_detect_single_plugin(self, oci_merger, mocker):
        """Test auto-detection with single plugin in OCI image."""
        # Mock get_oci_plugin_paths to return single plugin
        mock_get_paths = mocker.patch.object(install_dynamic_plugins, 'get_oci_plugin_paths')
        mock_get_paths.return_value = ['auto-detected-plugin']

        input_pkg = 'oci://registry.io/plugin:v1.0'
        plugin_key, version, inherit, resolved_path = oci_merger.parse_plugin_key(input_pkg)

        # Should resolve to the auto-detected plugin name
        assert plugin_key == 'oci://registry.io/plugin:!auto-detected-plugin'
        assert version == 'v1.0'
        assert inherit is False
        assert resolved_path == 'auto-detected-plugin'

        # Package should NOT be updated here (that happens in merge_plugin)
        # The fixture has a different initial package which should remain unchanged
        assert oci_merger.plugin['package'] == 'oci://example.com:v1.0!plugin'

        # Verify get_oci_plugin_paths was called
        mock_get_paths.assert_called_once_with('oci://registry.io/plugin:v1.0')

    def test_parse_plugin_key_auto_detect_with_digest(self, oci_merger, mocker):
        """Test auto-detection with digest-based reference."""
        mock_get_paths = mocker.patch.object(install_dynamic_plugins, 'get_oci_plugin_paths')
        mock_get_paths.return_value = ['my-plugin']

        input_pkg = 'oci://registry.io/plugin@sha256:abc123'
        plugin_key, version, inherit, resolved_path = oci_merger.parse_plugin_key(input_pkg)

        assert plugin_key == 'oci://registry.io/plugin:!my-plugin'
        assert version == 'sha256:abc123'
        assert inherit is False
        assert resolved_path == 'my-plugin'

        # Package should NOT be updated here (that happens in merge_plugin)
        # The fixture has a different initial package which should remain unchanged
        assert oci_merger.plugin['package'] == 'oci://example.com:v1.0!plugin'

    def test_parse_plugin_key_auto_detect_no_plugins_error(self, oci_merger, mocker):
        """Test error when no plugins found in OCI image."""
        mock_get_paths = mocker.patch.object(install_dynamic_plugins, 'get_oci_plugin_paths')
        mock_get_paths.return_value = []

        with pytest.raises(InstallException) as exc_info:
            oci_merger.parse_plugin_key('oci://registry.io/plugin:v1.0')

        assert 'No plugins found' in str(exc_info.value)

    def test_parse_plugin_key_auto_detect_multiple_plugins_error(self, oci_merger, mocker):
        """Test error when multiple plugins found without explicit path."""
        mock_get_paths = mocker.patch.object(install_dynamic_plugins, 'get_oci_plugin_paths')
        mock_get_paths.return_value = ['plugin-one', 'plugin-two', 'plugin-three']

        with pytest.raises(InstallException) as exc_info:
            oci_merger.parse_plugin_key('oci://registry.io/plugin:v1.0')

        error_msg = str(exc_info.value)
        assert 'Multiple plugins found' in error_msg
        assert 'plugin-one' in error_msg
        assert 'plugin-two' in error_msg
        assert 'plugin-three' in error_msg

    def test_parse_plugin_key_inherit_without_path_returns_registry(self, oci_merger):
        """Test that {{inherit}} without explicit path returns registry as key with None for path."""
        plugin_key, version, inherit_version, resolved_path = oci_merger.parse_plugin_key('oci://registry.io/plugin:{{inherit}}')

        # Should return registry as the temporary key
        assert plugin_key == 'oci://registry.io/plugin'
        assert version == '{{inherit}}'
        assert inherit_version is True
        assert resolved_path is None  # Path will be resolved during merge_plugin()

class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_npm_merger_empty_string(self):
        """Test NPM merger with empty package string."""
        plugin = {'package': ''}
        merger = NPMPackageMerger(plugin, 'test.yaml', {})
        result = merger.parse_plugin_key('')
        assert result == ''

    def test_npm_merger_special_characters_in_package(self):
        """Test NPM packages with special characters."""
        plugin = {'package': 'test'}
        merger = NPMPackageMerger(plugin, 'test.yaml', {})

        # Package name with underscores and hyphens
        result = merger.parse_plugin_key('my_special-package@1.0.0')
        assert result == 'my_special-package'

    def test_oci_merger_long_digest(self):
        """Test OCI package with realistic long SHA256 digest."""
        plugin = {'package': 'oci://example.com:v1!plugin'}
        merger = OciPackageMerger(plugin, 'test.yaml', {})

        long_digest = 'sha256:' + 'a' * 64
        input_pkg = f'oci://quay.io/user/plugin@{long_digest}!plugin'
        plugin_key, version, inherit, resolved_path = merger.parse_plugin_key(input_pkg)

        assert plugin_key == 'oci://quay.io/user/plugin:!plugin'
        assert version == long_digest
        assert inherit is False
        assert resolved_path == 'plugin'


class TestNPMPackageMergerMergePlugin:
    """Test cases for NPMPackageMerger.merge_plugin() method."""

    def test_add_new_plugin_level_0(self):
        """Test adding a new plugin at level 0."""
        all_plugins = {}
        plugin = {'package': 'test-package@1.0.0', 'disabled': False}
        merger = NPMPackageMerger(plugin, 'test-file.yaml', all_plugins)

        merger.merge_plugin(level=0)

        # Check plugin was added
        assert 'test-package' in all_plugins
        assert all_plugins['test-package']['package'] == 'test-package@1.0.0'
        assert all_plugins['test-package']['disabled'] is False
        assert all_plugins['test-package']['last_modified_level'] == 0

    def test_override_plugin_level_0_to_1(self):
        """Test overriding a plugin from level 0 to level 1."""
        all_plugins = {}

        # Add plugin at level 0
        plugin1 = {'package': 'test-package@1.0.0', 'disabled': False}
        merger1 = NPMPackageMerger(plugin1, 'included-file.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Override at level 1
        plugin2 = {'package': 'test-package@2.0.0', 'disabled': True}
        merger2 = NPMPackageMerger(plugin2, 'main-file.yaml', all_plugins)
        merger2.merge_plugin(level=1)

        # Check override succeeded
        assert all_plugins['test-package']['disabled'] is True
        assert all_plugins['test-package']['last_modified_level'] == 1
        # Package field should be overridden
        assert all_plugins['test-package']['package'] == 'test-package@2.0.0'

    def test_override_multiple_config_fields(self):
        """Test overriding multiple plugin config fields."""
        all_plugins = {}

        # Add plugin at level 0
        plugin1 = {
            'package': '@scope/plugin@1.0.0',
            'disabled': False,
            'pullPolicy': 'IfNotPresent',
            'pluginConfig': {'key1': 'value1'}
        }
        merger1 = NPMPackageMerger(plugin1, 'included-file.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Override at level 1
        plugin2 = {
            'package': '@scope/plugin@2.0.0',
            'disabled': True,
            'pullPolicy': 'Always',
            'pluginConfig': {'key2': 'value2'},
            'integrity': 'sha256-abc123'
        }
        merger2 = NPMPackageMerger(plugin2, 'main-file.yaml', all_plugins)
        merger2.merge_plugin(level=1)

        # Check all fields were updated except package
        assert all_plugins['@scope/plugin']['disabled'] is True
        assert all_plugins['@scope/plugin']['pullPolicy'] == 'Always'
        assert all_plugins['@scope/plugin']['pluginConfig'] == {'key2': 'value2'}
        assert all_plugins['@scope/plugin']['integrity'] == 'sha256-abc123'
        # Package field not overridden
        assert all_plugins['@scope/plugin']['package'] == '@scope/plugin@2.0.0'

    def test_duplicate_plugin_same_level_0_raises_error(self):
        """Test that duplicate plugin at same level 0 raises InstallException."""
        all_plugins = {}

        # Add plugin at level 0
        plugin1 = {'package': 'duplicate-package@1.0.0'}
        merger1 = NPMPackageMerger(plugin1, 'included-file.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Try to add same plugin again at level 0
        plugin2 = {'package': 'duplicate-package@2.0.0'}
        merger2 = NPMPackageMerger(plugin2, 'included-file.yaml', all_plugins)

        with pytest.raises(InstallException) as exc_info:
            merger2.merge_plugin(level=0)

        assert 'Duplicate plugin configuration' in str(exc_info.value)
        assert 'duplicate-package@2.0.0' in str(exc_info.value)

    def test_duplicate_plugin_same_level_1_raises_error(self):
        """Test that duplicate plugin at same level 1 raises InstallException."""
        all_plugins = {}

        # Add plugin at level 0
        plugin1 = {'package': 'test-package@1.0.0'}
        merger1 = NPMPackageMerger(plugin1, 'included-file.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Override at level 1
        plugin2 = {'package': 'test-package@2.0.0'}
        merger2 = NPMPackageMerger(plugin2, 'main-file.yaml', all_plugins)
        merger2.merge_plugin(level=1)

        # Try to add same plugin again at level 1
        plugin3 = {'package': 'test-package@3.0.0'}
        merger3 = NPMPackageMerger(plugin3, 'main-file.yaml', all_plugins)

        with pytest.raises(InstallException) as exc_info:
            merger3.merge_plugin(level=1)

        assert 'Duplicate plugin configuration' in str(exc_info.value)

    def test_invalid_package_field_type_raises_error(self):
        """Test that non-string package field raises InstallException."""
        all_plugins = {}
        plugin = {'package': 123}
        merger = NPMPackageMerger(plugin, 'test-file.yaml', all_plugins)

        with pytest.raises(InstallException) as exc_info:
            merger.merge_plugin(level=0)

        assert 'must be a string' in str(exc_info.value)

    def test_version_stripping_in_plugin_key(self):
        """Test that version is stripped from plugin key."""
        all_plugins = {}

        # Add plugin with version
        plugin1 = {'package': 'my-plugin@1.0.0'}
        merger1 = NPMPackageMerger(plugin1, 'test-file.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Override with different version
        plugin2 = {'package': 'my-plugin@2.0.0', 'disabled': True}
        merger2 = NPMPackageMerger(plugin2, 'test-file.yaml', all_plugins)
        merger2.merge_plugin(level=1)

        # Both should map to same key
        assert 'my-plugin' in all_plugins
        assert all_plugins['my-plugin']['disabled'] is True


class TestOciPackageMergerMergePlugin:
    """Test cases for OciPackageMerger.merge_plugin() method."""

    def test_add_new_plugin_with_tag(self):
        """Test adding a new OCI plugin with tag."""
        all_plugins = {}
        plugin = {'package': 'oci://registry.io/plugin:v1.0!path'}
        merger = OciPackageMerger(plugin, 'test-file.yaml', all_plugins)

        merger.merge_plugin(level=0)

        plugin_key = 'oci://registry.io/plugin:!path'
        assert plugin_key in all_plugins
        assert all_plugins[plugin_key]['package'] == 'oci://registry.io/plugin:v1.0!path'
        assert all_plugins[plugin_key]['version'] == 'v1.0'
        assert all_plugins[plugin_key]['last_modified_level'] == 0

    def test_add_new_plugin_with_digest(self):
        """Test adding a new OCI plugin with digest."""
        all_plugins = {}
        plugin = {'package': 'oci://registry.io/plugin@sha256:abc123!path'}
        merger = OciPackageMerger(plugin, 'test-file.yaml', all_plugins)

        merger.merge_plugin(level=0)

        plugin_key = 'oci://registry.io/plugin:!path'
        assert plugin_key in all_plugins
        assert all_plugins[plugin_key]['version'] == 'sha256:abc123'

    def test_merge_plugin_auto_detect_updates_package(self, mocker):
        """Test that merge_plugin updates package when path is auto-detected."""
        # Mock get_oci_plugin_paths to return single plugin
        mock_get_paths = mocker.patch.object(install_dynamic_plugins, 'get_oci_plugin_paths')
        mock_get_paths.return_value = ['detected-plugin']

        all_plugins = {}
        # Package without explicit path (will be auto-detected)
        plugin = {'package': 'oci://registry.io/plugin:v1.0'}
        merger = OciPackageMerger(plugin, 'test-file.yaml', all_plugins)

        merger.merge_plugin(level=0)

        # Verify the package was updated with the resolved path
        plugin_key = 'oci://registry.io/plugin:!detected-plugin'
        assert plugin_key in all_plugins
        assert all_plugins[plugin_key]['package'] == 'oci://registry.io/plugin:v1.0!detected-plugin'
        assert all_plugins[plugin_key]['version'] == 'v1.0'

        # Original plugin dict should also be updated
        assert merger.plugin['package'] == 'oci://registry.io/plugin:v1.0!detected-plugin'

    def test_merge_plugin_auto_detect_with_digest_updates_package(self, mocker):
        """Test that merge_plugin updates package with digest when path is auto-detected."""
        # Mock get_oci_plugin_paths to return single plugin
        mock_get_paths = mocker.patch.object(install_dynamic_plugins, 'get_oci_plugin_paths')
        mock_get_paths.return_value = ['my-plugin']

        all_plugins = {}
        # Package without explicit path (will be auto-detected)
        plugin = {'package': 'oci://registry.io/plugin@sha256:abc123'}
        merger = OciPackageMerger(plugin, 'test-file.yaml', all_plugins)

        merger.merge_plugin(level=0)

        # Verify the package was updated with the resolved path
        plugin_key = 'oci://registry.io/plugin:!my-plugin'
        assert plugin_key in all_plugins
        assert all_plugins[plugin_key]['package'] == 'oci://registry.io/plugin@sha256:abc123!my-plugin'
        assert all_plugins[plugin_key]['version'] == 'sha256:abc123'

        # Original plugin dict should also be updated
        assert merger.plugin['package'] == 'oci://registry.io/plugin@sha256:abc123!my-plugin'

    def test_override_plugin_version(self, capsys):
        """Test overriding OCI plugin version from level 0 to 1."""
        all_plugins = {}

        # Add plugin at level 0
        plugin1 = {'package': 'oci://registry.io/plugin:v1.0!path'}
        merger1 = OciPackageMerger(plugin1, 'included-file.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Override at level 1 with new version
        plugin2 = {'package': 'oci://registry.io/plugin:v2.0!path'}
        merger2 = OciPackageMerger(plugin2, 'main-file.yaml', all_plugins)
        merger2.merge_plugin(level=1)

        # Check version was updated
        plugin_key = 'oci://registry.io/plugin:!path'
        assert all_plugins[plugin_key]['version'] == 'v2.0'
        assert all_plugins[plugin_key]['package'] == 'oci://registry.io/plugin:v2.0!path'
        assert all_plugins[plugin_key]['last_modified_level'] == 1

        # Check that override message was printed
        captured = capsys.readouterr()
        assert 'Overriding version' in captured.out
        assert 'v1.0' in captured.out
        assert 'v2.0' in captured.out

    def test_use_inherit_to_preserve_version(self):
        """Test using {{inherit}} to preserve existing version."""
        all_plugins = {}

        # Add plugin at level 0
        plugin1 = {'package': 'oci://registry.io/plugin:v1.0!path'}
        merger1 = OciPackageMerger(plugin1, 'included-file.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Override at level 1 with {{inherit}}
        plugin2 = {'package': 'oci://registry.io/plugin:{{inherit}}!path', 'disabled': True}
        merger2 = OciPackageMerger(plugin2, 'main-file.yaml', all_plugins)
        merger2.merge_plugin(level=1)

        # Check version was preserved
        plugin_key = 'oci://registry.io/plugin:!path'
        assert all_plugins[plugin_key]['version'] == 'v1.0'
        # Package field should NOT be updated when inheriting
        assert all_plugins[plugin_key]['package'] == 'oci://registry.io/plugin:v1.0!path'
        # But other config should be updated
        assert all_plugins[plugin_key]['disabled'] is True

    def test_override_config_with_version_inheritance(self):
        """Test overriding plugin config while preserving version with {{inherit}}."""
        all_plugins = {}

        # Add plugin at level 0
        plugin1 = {
            'package': 'oci://registry.io/plugin:v1.0!path',
            'pluginConfig': {'key1': 'value1'}
        }
        merger1 = OciPackageMerger(plugin1, 'included-file.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Override config at level 1 with {{inherit}}
        plugin2 = {
            'package': 'oci://registry.io/plugin:{{inherit}}!path',
            'pluginConfig': {'key2': 'value2'}
        }
        merger2 = OciPackageMerger(plugin2, 'main-file.yaml', all_plugins)
        merger2.merge_plugin(level=1)

        # Check version preserved and config updated
        plugin_key = 'oci://registry.io/plugin:!path'
        assert all_plugins[plugin_key]['version'] == 'v1.0'
        assert all_plugins[plugin_key]['pluginConfig'] == {'key2': 'value2'}

    def test_override_config_without_version_inheritance(self):
        """Test overriding both version and config."""
        all_plugins = {}

        # Add plugin at level 0
        plugin1 = {
            'package': 'oci://registry.io/plugin:v1.0!path',
            'pluginConfig': {'key1': 'value1'}
        }
        merger1 = OciPackageMerger(plugin1, 'included-file.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Override both at level 1
        plugin2 = {
            'package': 'oci://registry.io/plugin:v2.0!path',
            'pluginConfig': {'key2': 'value2'}
        }
        merger2 = OciPackageMerger(plugin2, 'main-file.yaml', all_plugins)
        merger2.merge_plugin(level=1)

        # Check both were updated
        plugin_key = 'oci://registry.io/plugin:!path'
        assert all_plugins[plugin_key]['version'] == 'v2.0'
        assert all_plugins[plugin_key]['pluginConfig'] == {'key2': 'value2'}
        assert all_plugins[plugin_key]['package'] == 'oci://registry.io/plugin:v2.0!path'

    def test_override_from_tag_to_digest(self):
        """Test overriding from tag to digest."""
        all_plugins = {}

        # Add plugin with tag at level 0
        plugin1 = {'package': 'oci://registry.io/plugin:v1.0!path'}
        merger1 = OciPackageMerger(plugin1, 'included-file.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Override with digest at level 1
        plugin2 = {'package': 'oci://registry.io/plugin@sha256:abc123def456!path'}
        merger2 = OciPackageMerger(plugin2, 'main-file.yaml', all_plugins)
        merger2.merge_plugin(level=1)

        # Check version updated to digest format
        plugin_key = 'oci://registry.io/plugin:!path'
        assert all_plugins[plugin_key]['version'] == 'sha256:abc123def456'
        assert all_plugins[plugin_key]['package'] == 'oci://registry.io/plugin@sha256:abc123def456!path'

    def test_new_plugin_with_inherit_raises_error(self):
        """Test that using {{inherit}} on a new plugin raises InstallException."""
        all_plugins = {}
        plugin = {'package': 'oci://registry.io/plugin:{{inherit}}!path'}
        merger = OciPackageMerger(plugin, 'test-file.yaml', all_plugins)

        with pytest.raises(InstallException) as exc_info:
            merger.merge_plugin(level=0)

        assert '{{inherit}}' in str(exc_info.value)
        assert 'no resolved tag or digest' in str(exc_info.value)

    def test_duplicate_oci_plugin_same_level_0_raises_error(self):
        """Test that duplicate OCI plugin at same level 0 raises InstallException."""
        all_plugins = {}

        # Add plugin at level 0
        plugin1 = {'package': 'oci://registry.io/plugin:v1.0!path'}
        merger1 = OciPackageMerger(plugin1, 'included-file.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Try to add same plugin again at level 0
        plugin2 = {'package': 'oci://registry.io/plugin:v2.0!path'}
        merger2 = OciPackageMerger(plugin2, 'included-file.yaml', all_plugins)

        with pytest.raises(InstallException) as exc_info:
            merger2.merge_plugin(level=0)

        assert 'Duplicate plugin configuration' in str(exc_info.value)

    def test_duplicate_oci_plugin_same_level_1_raises_error(self):
        """Test that duplicate OCI plugin at same level 1 raises InstallException."""
        all_plugins = {}

        # Add plugin at level 0
        plugin1 = {'package': 'oci://registry.io/plugin:v1.0!path'}
        merger1 = OciPackageMerger(plugin1, 'included-file.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Override at level 1
        plugin2 = {'package': 'oci://registry.io/plugin:v2.0!path'}
        merger2 = OciPackageMerger(plugin2, 'main-file.yaml', all_plugins)
        merger2.merge_plugin(level=1)

        # Try to add same plugin again at level 1
        plugin3 = {'package': 'oci://registry.io/plugin:v3.0!path'}
        merger3 = OciPackageMerger(plugin3, 'main-file.yaml', all_plugins)

        with pytest.raises(InstallException) as exc_info:
            merger3.merge_plugin(level=1)

        assert 'Duplicate plugin configuration' in str(exc_info.value)

    def test_invalid_package_field_type_raises_error(self):
        """Test that non-string package field raises InstallException."""
        all_plugins = {}
        plugin = {'package': ['not', 'a', 'string']}
        merger = OciPackageMerger(plugin, 'test-file.yaml', all_plugins)

        with pytest.raises(InstallException) as exc_info:
            merger.merge_plugin(level=0)

        assert 'must be a string' in str(exc_info.value)


class TestOciInheritWithPathOmission:
    """Test cases for {{inherit}} with path omission feature."""

    def test_inherit_version_and_path_from_single_base_plugin(self, capsys):
        """Test inheriting both version and path when exactly one base plugin exists."""
        all_plugins = {}

        # Add base plugin at level 0 with explicit version and path
        plugin1 = {
            'package': 'oci://registry.io/plugin:v1.0!my-plugin',
            'disabled': False
        }

        merger1 = OciPackageMerger(plugin1, 'base.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Override at level 1 using {{inherit}} without path
        plugin2 = {
            'package': 'oci://registry.io/plugin:{{inherit}}',
            'disabled': True
        }
        merger2 = OciPackageMerger(plugin2, 'main.yaml', all_plugins)
        merger2.merge_plugin(level=1)

        # Check that version and path were inherited
        plugin_key = 'oci://registry.io/plugin:!my-plugin'
        assert plugin_key in all_plugins
        assert all_plugins[plugin_key]['version'] == 'v1.0'
        assert all_plugins[plugin_key]['package'] == 'oci://registry.io/plugin:v1.0!my-plugin'
        assert all_plugins[plugin_key]['disabled'] is True

        # Check that inheritance message was printed
        captured = capsys.readouterr()
        assert 'Inheriting version `v1.0` and plugin path `my-plugin`' in captured.out

    def test_inherit_version_and_path_with_digest(self, capsys):
        """Test inheriting version (digest) and path from base plugin."""
        all_plugins = {}

        # Add base plugin with digest
        plugin1 = {'package': 'oci://registry.io/plugin@sha256:abc123!plugin-name'}
        merger1 = OciPackageMerger(plugin1, 'base.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Inherit using {{inherit}} without path
        plugin2 = {
            'package': 'oci://registry.io/plugin:{{inherit}}',
            'pluginConfig': {'custom': 'config'}
        }
        merger2 = OciPackageMerger(plugin2, 'main.yaml', all_plugins)
        merger2.merge_plugin(level=1)

        # Check inheritance
        plugin_key = 'oci://registry.io/plugin:!plugin-name'
        assert all_plugins[plugin_key]['version'] == 'sha256:abc123'
        assert all_plugins[plugin_key]['package'] == 'oci://registry.io/plugin@sha256:abc123!plugin-name'
        assert all_plugins[plugin_key]['pluginConfig'] == {'custom': 'config'}

    def test_inherit_from_auto_detected_base_plugin(self, mocker, capsys):
        """Test inheriting from a base plugin that had its path auto-detected."""
        # Mock get_oci_plugin_paths to return single plugin
        mock_get_paths = mocker.patch.object(install_dynamic_plugins, 'get_oci_plugin_paths')
        mock_get_paths.return_value = ['auto-detected-plugin']

        all_plugins = {}

        # Add base plugin without explicit path (will auto-detect)
        plugin1 = {'package': 'oci://registry.io/plugin:v1.0'}
        merger1 = OciPackageMerger(plugin1, 'base.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Inherit both version AND the auto-detected path
        plugin2 = {'package': 'oci://registry.io/plugin:{{inherit}}'}
        merger2 = OciPackageMerger(plugin2, 'main.yaml', all_plugins)
        merger2.merge_plugin(level=1)

        # Check that auto-detected path was inherited
        plugin_key = 'oci://registry.io/plugin:!auto-detected-plugin'
        assert plugin_key in all_plugins
        assert all_plugins[plugin_key]['version'] == 'v1.0'
        assert all_plugins[plugin_key]['package'] == 'oci://registry.io/plugin:v1.0!auto-detected-plugin'

        captured = capsys.readouterr()
        assert 'Inheriting version `v1.0` and plugin path `auto-detected-plugin`' in captured.out

    def test_inherit_without_path_no_base_plugin_error(self):
        """Test error when using {{inherit}} without path but no base plugin exists."""
        all_plugins = {}

        # Try to use {{inherit}} without any base plugin
        plugin = {'package': 'oci://registry.io/plugin:{{inherit}}'}
        merger = OciPackageMerger(plugin, 'main.yaml', all_plugins)

        with pytest.raises(InstallException) as exc_info:
            merger.merge_plugin(level=0)

        error_msg = str(exc_info.value)
        assert '{{inherit}}' in error_msg
        assert 'no existing plugin configuration found' in error_msg
        assert 'oci://registry.io/plugin' in error_msg

    def test_inherit_without_path_multiple_plugins_error(self):
        """Test error when using {{inherit}} without path with multiple base plugins from same image."""
        all_plugins = {}

        # Add two plugins from same image at level 0
        plugin1 = {'package': 'oci://registry.io/bundle:v1.0!plugin-a'}
        merger1 = OciPackageMerger(plugin1, 'base.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        plugin2 = {'package': 'oci://registry.io/bundle:v1.0!plugin-b'}
        merger2 = OciPackageMerger(plugin2, 'base.yaml', all_plugins)
        merger2.merge_plugin(level=0)

        # Try to use {{inherit}} without specifying which plugin
        plugin3 = {'package': 'oci://registry.io/bundle:{{inherit}}'}
        merger3 = OciPackageMerger(plugin3, 'main.yaml', all_plugins)

        with pytest.raises(InstallException) as exc_info:
            merger3.merge_plugin(level=1)

        error_msg = str(exc_info.value)
        assert '{{inherit}}' in error_msg
        assert 'multiple plugins from this image are defined' in error_msg
        assert 'oci://registry.io/bundle:v1.0!plugin-a' in error_msg
        assert 'oci://registry.io/bundle:v1.0!plugin-b' in error_msg
        assert '{{inherit}}!<plugin_path>' in error_msg

    def test_inherit_without_path_works_with_explicit_path_too(self):
        """Test that {{inherit}} with explicit path still works alongside path omission."""
        all_plugins = {}

        # Add two plugins from same image
        plugin1 = {'package': 'oci://registry.io/bundle:v1.0!plugin-a'}
        merger1 = OciPackageMerger(plugin1, 'base.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        plugin2 = {'package': 'oci://registry.io/bundle:v1.0!plugin-b'}
        merger2 = OciPackageMerger(plugin2, 'base.yaml', all_plugins)
        merger2.merge_plugin(level=0)

        # Use {{inherit}} with explicit path for plugin-a
        plugin3 = {
            'package': 'oci://registry.io/bundle:{{inherit}}!plugin-a',
            'disabled': True
        }
        merger3 = OciPackageMerger(plugin3, 'main.yaml', all_plugins)
        merger3.merge_plugin(level=1)

        # Should successfully override plugin-a only
        assert all_plugins['oci://registry.io/bundle:!plugin-a']['disabled'] is True
        assert all_plugins['oci://registry.io/bundle:!plugin-a']['version'] == 'v1.0'
        # plugin-b should be unchanged
        assert 'disabled' not in all_plugins['oci://registry.io/bundle:!plugin-b']

    def test_inherit_path_omission_preserves_other_fields(self):
        """Test that path inheritance preserves and overrides other plugin fields correctly."""
        all_plugins = {}

        # Add base plugin with various fields
        plugin1 = {
            'package': 'oci://registry.io/plugin:v1.0!my-plugin',
            'pluginConfig': {'base': 'config'},
            'disabled': False,
            'pullPolicy': 'IfNotPresent'
        }
        merger1 = OciPackageMerger(plugin1, 'base.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Override with {{inherit}} and new config
        plugin2 = {
            'package': 'oci://registry.io/plugin:{{inherit}}',
            'pluginConfig': {'override': 'config'},
            'disabled': True
        }
        merger2 = OciPackageMerger(plugin2, 'main.yaml', all_plugins)
        merger2.merge_plugin(level=1)

        plugin_key = 'oci://registry.io/plugin:!my-plugin'
        # Version and path inherited
        assert all_plugins[plugin_key]['version'] == 'v1.0'
        assert all_plugins[plugin_key]['package'] == 'oci://registry.io/plugin:v1.0!my-plugin'
        # Fields overridden
        assert all_plugins[plugin_key]['pluginConfig'] == {'override': 'config'}
        assert all_plugins[plugin_key]['disabled'] is True
        assert all_plugins[plugin_key]['pullPolicy'] == 'IfNotPresent'

    def test_inherit_path_omission_updates_package_field(self):
        """Test that path inheritance correctly updates the plugin package field."""
        all_plugins = {}

        # Add base plugin at level 0
        plugin1 = {'package': 'oci://registry.io/plugin:v1.5.2!my-plugin-name'}
        merger1 = OciPackageMerger(plugin1, 'base.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Inherit at level 1 - package field should be updated with inherited values
        plugin2 = {'package': 'oci://registry.io/plugin:{{inherit}}'}
        merger2 = OciPackageMerger(plugin2, 'main.yaml', all_plugins)
        merger2.merge_plugin(level=1)

        plugin_key = 'oci://registry.io/plugin:!my-plugin-name'
        # The plugin package field should now have the resolved version and path
        assert all_plugins[plugin_key]['package'] == 'oci://registry.io/plugin:v1.5.2!my-plugin-name'
        # The original plugin2 object should also be updated
        assert merger2.plugin['package'] == 'oci://registry.io/plugin:v1.5.2!my-plugin-name'


class TestPluginInstallerShouldSkipInstallation:
    """Test cases for PluginInstaller.should_skip_installation() method."""

    def test_plugin_not_installed_returns_false(self, tmp_path):
        """Test that plugin not in hash dict returns False."""
        plugin = {'plugin_hash': 'abc123', 'package': 'test-pkg'}
        plugin_path_by_hash = {}  # Empty - nothing installed
        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path))

        should_skip, reason = installer.should_skip_installation(plugin, plugin_path_by_hash)

        assert should_skip is False
        assert reason == "not_installed"

    def test_plugin_installed_if_not_present_skips(self, tmp_path):
        """Test that installed plugin with IF_NOT_PRESENT policy skips."""
        plugin = {
            'plugin_hash': 'abc123',
            'package': 'test-pkg',
            'pullPolicy': 'IfNotPresent'
        }
        plugin_path_by_hash = {'abc123': 'test-pkg-1.0.0'}
        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path))

        should_skip, reason = installer.should_skip_installation(plugin, plugin_path_by_hash)

        assert should_skip is True
        assert reason == "already_installed"

    def test_plugin_installed_always_policy_forces_download(self, tmp_path):
        """Test that ALWAYS policy forces download."""
        plugin = {
            'plugin_hash': 'abc123',
            'package': 'test-pkg',
            'pullPolicy': 'Always'
        }
        plugin_path_by_hash = {'abc123': 'test-pkg-1.0.0'}
        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path))

        should_skip, reason = installer.should_skip_installation(plugin, plugin_path_by_hash)

        assert should_skip is False
        assert reason == "force_download"

    def test_plugin_installed_force_download_flag(self, tmp_path):
        """Test that forceDownload flag forces download."""
        plugin = {
            'plugin_hash': 'abc123',
            'package': 'test-pkg',
            'forceDownload': True
        }
        plugin_path_by_hash = {'abc123': 'test-pkg-1.0.0'}
        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path))

        should_skip, reason = installer.should_skip_installation(plugin, plugin_path_by_hash)

        assert should_skip is False
        assert reason == "force_download"

    def test_default_pull_policy_if_not_present(self, tmp_path):
        """Test that default pull policy is IF_NOT_PRESENT."""
        plugin = {'plugin_hash': 'abc123', 'package': 'test-pkg'}  # No pullPolicy
        plugin_path_by_hash = {'abc123': 'test-pkg-1.0.0'}
        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path))

        should_skip, reason = installer.should_skip_installation(plugin, plugin_path_by_hash)

        assert should_skip is True
        assert reason == "already_installed"


class TestOciPluginInstallerShouldSkipInstallation:
    """Test cases for OciPluginInstaller.should_skip_installation() method."""

    def test_plugin_not_installed_returns_false(self, tmp_path, mocker):
        """Test that plugin not in hash dict returns False."""
        plugin = {
            'plugin_hash': 'abc123',
            'package': 'oci://registry.io/plugin:latest!path'
        }
        plugin_path_by_hash = {}

        # Mock OciDownloader
        mock_downloader = mocker.MagicMock()
        installer = install_dynamic_plugins.OciPluginInstaller(str(tmp_path))
        installer.downloader = mock_downloader

        should_skip, reason = installer.should_skip_installation(plugin, plugin_path_by_hash)

        assert should_skip is False
        assert reason == "not_installed"

    def test_always_policy_unchanged_digest_skips(self, tmp_path, mocker):
        """Test that ALWAYS policy with unchanged digest skips download."""
        plugin_path = 'plugin-dir'
        plugin = {
            'plugin_hash': 'abc123',
            'package': 'oci://registry.io/plugin:v1.0!path',
            'pullPolicy': 'Always'
        }
        plugin_path_by_hash = {'abc123': plugin_path}

        # Create digest file with matching digest
        digest_file = tmp_path / plugin_path / 'dynamic-plugin-image.hash'
        digest_file.parent.mkdir(parents=True)
        digest_file.write_text('matching_digest')

        # Mock downloader to return same digest
        mock_downloader = mocker.MagicMock()
        mock_downloader.digest.return_value = 'matching_digest'

        installer = install_dynamic_plugins.OciPluginInstaller(str(tmp_path))
        installer.downloader = mock_downloader

        should_skip, reason = installer.should_skip_installation(plugin, plugin_path_by_hash)

        assert should_skip is True
        assert reason == "digest_unchanged"

    def test_always_policy_changed_digest_forces_download(self, tmp_path, mocker):
        """Test that ALWAYS policy with changed digest forces download."""
        plugin_path = 'plugin-dir'
        plugin = {
            'plugin_hash': 'abc123',
            'package': 'oci://registry.io/plugin:v1.0!path',
            'pullPolicy': 'Always'
        }
        plugin_path_by_hash = {'abc123': plugin_path}

        # Create digest file with old digest
        digest_file = tmp_path / plugin_path / 'dynamic-plugin-image.hash'
        digest_file.parent.mkdir(parents=True)
        digest_file.write_text('old_digest')

        # Mock downloader to return different digest
        mock_downloader = mocker.MagicMock()
        mock_downloader.digest.return_value = 'new_digest'

        installer = install_dynamic_plugins.OciPluginInstaller(str(tmp_path))
        installer.downloader = mock_downloader

        should_skip, reason = installer.should_skip_installation(plugin, plugin_path_by_hash)

        assert should_skip is False
        assert reason == "force_download"
    def test_if_not_present_policy_skips(self, tmp_path, mocker):
        """Test that IF_NOT_PRESENT policy skips."""
        plugin_path = 'plugin-dir'
        plugin = {
            'plugin_hash': 'abc123',
            'package': 'oci://registry.io/plugin:v1.0!path',
            'pullPolicy': 'IfNotPresent'
        }
        plugin_path_by_hash = {'abc123': plugin_path}

        installer = install_dynamic_plugins.OciPluginInstaller(str(tmp_path))
        should_skip, reason = installer.should_skip_installation(plugin, plugin_path_by_hash)

        assert should_skip is True
        assert reason == "already_installed"

class TestNpmPluginInstallerInstall:
    """Test cases for NpmPluginInstaller.install() method and verify_package_integrity() (mocked)."""

    def test_missing_integrity_remote_package_raises_exception(self, tmp_path):
        """Test that missing integrity for remote package raises exception."""
        plugin = {'package': 'test-package@1.0.0'}  # No integrity
        plugin_path_by_hash = {}

        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path), skip_integrity_check=False)

        with pytest.raises(InstallException) as exc_info:
            installer.install(plugin, plugin_path_by_hash)

        assert 'No integrity hash provided' in str(exc_info.value)

    def test_invalid_integrity_hash_type_raises_exception(self, tmp_path, mocker):
        """Test that invalid integrity hash type raises exception."""
        plugin = {'package': 'test-package@1.0.0', 'integrity': 1234567890}

        with pytest.raises(InstallException) as exc_info:
            install_dynamic_plugins.verify_package_integrity(plugin, "dummy-archive.tgz")
        assert 'must be a string' in str(exc_info.value)

    def test_invalid_integrity_hash_format_raises_exception(self, tmp_path, mocker):
        """Test that invalid integrity hash (not of form <algorithm>-<hash>) raises exception."""
        plugin = {'package': 'test-package@1.0.0', 'integrity': 'invalidhash'}

        with pytest.raises(InstallException) as exc_info:
            install_dynamic_plugins.verify_package_integrity(plugin, "dummy-archive.tgz")
        assert 'must be a string of the form' in str(exc_info.value)

    def test_invalid_integrity_algorithm_raises_exception(self, tmp_path, mocker):
        """Test that unrecognized integrity algorithm raises exception."""
        plugin = {'package': 'test-package@1.0.0', 'integrity': 'invalidalgo-1234567890abcdef'}

        with pytest.raises(InstallException) as exc_info:
            install_dynamic_plugins.verify_package_integrity(plugin, "dummy-archive.tgz")
        assert 'is not supported' in str(exc_info.value)

    def test_invalid_integrity_hash_base64_encoding_raises_exception(self, tmp_path, mocker):
        """Test invalid base64 encoding in hash triggers exception."""
        plugin = {'package': 'test-package@1.0.0', 'integrity': 'sha256-not@base64!'}

        with pytest.raises(InstallException) as exc_info:
            install_dynamic_plugins.verify_package_integrity(plugin, "dummy-archive.tgz")
        assert 'is not a valid base64 encoding' in str(exc_info.value)

    def test_integrity_hash_mismatch_raises_exception(self, tmp_path, mocker):
        """Test hash verification fails when computed hash does not match."""
        # Valid algorithm and fake base64, but simulated mismatch
        import base64
        plugin = {'package': 'test-package@1.0.0', 'integrity': 'sha256-' + base64.b64encode(b'wronghash').decode()}

        with pytest.raises(InstallException) as exc_info:
            install_dynamic_plugins.verify_package_integrity(plugin, "dummy-archive.tgz")
        assert 'does not match the provided integrity hash' in str(exc_info.value)
    def test_skip_integrity_check_flag_works(self, tmp_path, mocker):
        """Test that skip_integrity_check flag bypasses integrity check."""
        plugin = {'package': 'test-package@1.0.0'}  # No integrity
        plugin_path_by_hash = {}

        # Mock npm pack - use string (not bytes) since run_command uses text=True
        mock_result = mocker.MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = 'test-package-1.0.0.tgz'
        mocker.patch('subprocess.run', return_value=mock_result)

        # Mock tarball extraction
        mock_tarfile = mocker.patch('tarfile.open')
        mock_tar = mocker.MagicMock()
        mock_tar.getmembers.return_value = []
        mock_tarfile.return_value.__enter__.return_value = mock_tar

        # Mock file operations
        mocker.patch('os.path.exists', return_value=False)
        mocker.patch('os.mkdir')
        mocker.patch('os.remove')

        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path), skip_integrity_check=True)
        plugin_path = installer.install(plugin, plugin_path_by_hash)

        assert plugin_path == 'test-package-1.0.0'

@pytest.mark.integration
class TestNpmPluginInstallerIntegration:
    """Integration tests with real file operations."""

    @pytest.mark.integration
    def test_verify_package_integrity_with_real_tarball(self, tmp_path):
        """Test integrity verification with actual openssl commands."""
        import tarfile
        import subprocess
        import shutil

        # Skip if openssl not available
        if not shutil.which('openssl'):
            pytest.skip("openssl not available")

        # Create a real test tarball
        test_dir = tmp_path / "test-package"
        test_dir.mkdir()
        (test_dir / "index.js").write_text("console.log('test');")

        tarball_path = tmp_path / "test-package.tgz"
        with create_test_tarball(tarball_path) as tar:
            tar.add(test_dir, arcname="package")

        # Calculate actual integrity hash using openssl
        cat_process = subprocess.Popen(["cat", str(tarball_path)], stdout=subprocess.PIPE)
        openssl_dgst = subprocess.Popen(
            ["openssl", "dgst", "-sha256", "-binary"],
            stdin=cat_process.stdout,
            stdout=subprocess.PIPE
        )
        openssl_b64 = subprocess.Popen(
            ["openssl", "base64", "-A"],
            stdin=openssl_dgst.stdout,
            stdout=subprocess.PIPE
        )
        integrity_hash, _ = openssl_b64.communicate()
        integrity_hash = integrity_hash.decode('utf-8').strip()

        # Create plugin with real integrity
        plugin = {
            'package': 'test-package',
            'integrity': f'sha256-{integrity_hash}'
        }

        # Test verification succeeds with correct hash
        install_dynamic_plugins.verify_package_integrity(plugin, str(tarball_path))

        # Test verification fails with wrong hash (valid base64 but wrong hash)
        plugin_wrong = {
            'package': 'test-package',
            'integrity': 'sha256-YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2'
        }

        with pytest.raises(InstallException) as exc_info:
            install_dynamic_plugins.verify_package_integrity(plugin_wrong, str(tarball_path))

        assert 'does not match' in str(exc_info.value)

    @pytest.mark.integration
    def test_extract_npm_package_with_real_tarball(self, tmp_path):
        """Test tarball extraction with real tar file."""
        import tarfile

        # Create a realistic NPM package structure
        package_dir = tmp_path / "source" / "package"
        package_dir.mkdir(parents=True)
        (package_dir / "package.json").write_text('{"name": "test", "version": "1.0.0"}')
        (package_dir / "index.js").write_text("module.exports = {};")
        (package_dir / "lib").mkdir()
        (package_dir / "lib" / "helper.js").write_text("exports.helper = () => {};")

        # Create tarball following NPM format (with 'package/' prefix)
        tarball_path = tmp_path / "test-package-1.0.0.tgz"
        with create_test_tarball(tarball_path) as tar:
            tar.add(package_dir, arcname="package")

        # Test extraction
        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path))
        plugin_path = installer._extract_npm_package(str(tarball_path))

        # Verify extracted files
        extracted_dir = tmp_path / "test-package-1.0.0"
        assert extracted_dir.exists()
        assert (extracted_dir / "package.json").exists()
        assert (extracted_dir / "index.js").exists()
        assert (extracted_dir / "lib" / "helper.js").exists()

        # Verify tarball was removed
        assert not tarball_path.exists()

    @pytest.mark.integration
    def test_zip_bomb_protection_real_tarball(self, tmp_path):
        """Test that extraction rejects tarballs with oversized files."""
        import tarfile

        # Create a tarball with a file exceeding MAX_ENTRY_SIZE
        large_content = b"x" * 25_000_000  # 25MB (exceeds default 20MB)

        package_dir = tmp_path / "source" / "package"
        package_dir.mkdir(parents=True)
        (package_dir / "huge-file.bin").write_bytes(large_content)

        tarball_path = tmp_path / "malicious.tgz"
        with create_test_tarball(tarball_path) as tar:
            tar.add(package_dir / "huge-file.bin", arcname="package/huge-file.bin")

        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path))

        with pytest.raises(InstallException) as exc_info:
            installer._extract_npm_package(str(tarball_path))

        assert 'Zip bomb' in str(exc_info.value)

    @pytest.mark.integration
    def test_path_traversal_protection_real_tarball(self, tmp_path):
        """Test that extraction rejects tarballs with without package/ prefix."""
        import tarfile
        import io

        # Create tarball with path traversal attempt
        tarball_path = tmp_path / "malicious.tgz"
        with create_test_tarball(tarball_path) as tar:
            # Create a TarInfo with malicious path
            info = tarfile.TarInfo(name="test")
            info.size = 10
            tar.addfile(info, io.BytesIO(b"malicious!"))

        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path))

        with pytest.raises(InstallException) as exc_info:
            installer._extract_npm_package(str(tarball_path))

        assert 'does not start with' in str(exc_info.value)

    @pytest.mark.integration
    def test_symlink_with_invalid_linkpath_prefix(self, tmp_path):
        """Test that extraction rejects symlinks with linkpath not starting with 'package/'."""
        import tarfile
        import io

        # Create tarball with a symlink that has invalid linkpath prefix
        tarball_path = tmp_path / "malicious.tgz"
        with create_test_tarball(tarball_path) as tar:
            # First add a regular file
            info = tarfile.TarInfo(name="package/index.js")
            info.size = 10
            tar.addfile(info, io.BytesIO(b"console.log"))

            # Add a symlink with linkpath not starting with 'package/'
            link_info = tarfile.TarInfo(name="package/malicious-link")
            link_info.type = tarfile.SYMTYPE
            link_info.linkname = "../../../etc/passwd"  # Does not start with 'package/'
            tar.addfile(link_info)

        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path))

        with pytest.raises(InstallException) as exc_info:
            installer._extract_npm_package(str(tarball_path))

        assert 'contains a link outside of the archive' in str(exc_info.value)
        assert 'malicious-link' in str(exc_info.value)

    @pytest.mark.integration
    def test_symlink_resolving_outside_directory(self, tmp_path):
        """Test that extraction rejects symlinks that resolve outside the target directory."""
        import tarfile
        import io

        # Create tarball with a symlink that resolves outside the extraction directory
        tarball_path = tmp_path / "malicious.tgz"
        with create_test_tarball(tarball_path) as tar:
            # Add a regular file
            info = tarfile.TarInfo(name="package/index.js")
            info.size = 10
            tar.addfile(info, io.BytesIO(b"console.log"))

            # Add a symlink with proper prefix but resolves outside
            # Using relative path traversal that starts with package/ but goes outside
            link_info = tarfile.TarInfo(name="package/subdir/malicious-link")
            link_info.type = tarfile.SYMTYPE
            link_info.linkname = "package/../../../etc/passwd"  # Starts with 'package/' but resolves outside
            tar.addfile(link_info)

        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path))

        with pytest.raises(InstallException) as exc_info:
            installer._extract_npm_package(str(tarball_path))

        assert 'contains a link outside of the archive' in str(exc_info.value)

    @pytest.mark.integration
    def test_hardlink_resolving_outside_directory(self, tmp_path):
        """Test that extraction rejects hardlinks that resolve outside the target directory."""
        import tarfile
        import io

        # Create tarball with a hardlink that resolves outside the extraction directory
        tarball_path = tmp_path / "malicious.tgz"
        with create_test_tarball(tarball_path) as tar:
            # Add a regular file
            info = tarfile.TarInfo(name="package/index.js")
            info.size = 10
            tar.addfile(info, io.BytesIO(b"console.log"))

            # Add a hardlink with proper prefix but resolves outside
            link_info = tarfile.TarInfo(name="package/subdir/malicious-hardlink")
            link_info.type = tarfile.LNKTYPE
            link_info.linkname = "package/../../../etc/passwd"  # Starts with 'package/' but resolves outside
            tar.addfile(link_info)

        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path))

        with pytest.raises(InstallException) as exc_info:
            installer._extract_npm_package(str(tarball_path))

        assert 'contains a link outside of the archive' in str(exc_info.value)

    @pytest.mark.integration
    def test_valid_symlink_extraction(self, tmp_path):
        """Test that valid symlinks within the package are extracted correctly."""
        import tarfile
        import io

        # Create tarball with valid internal symlinks
        tarball_path = tmp_path / "valid-package.tgz"
        with create_test_tarball(tarball_path) as tar:
            # Add a regular file
            info = tarfile.TarInfo(name="package/lib/helper.js")
            content = b"module.exports = { helper: () => {} };"
            info.size = len(content)
            tar.addfile(info, io.BytesIO(content))

            # Add a valid symlink pointing to the file within package/
            link_info = tarfile.TarInfo(name="package/index.js")
            link_info.type = tarfile.SYMTYPE
            link_info.linkname = "package/lib/helper.js"
            tar.addfile(link_info)

        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path))
        plugin_path = installer._extract_npm_package(str(tarball_path))

        # Verify extraction succeeded
        extracted_dir = tmp_path / plugin_path
        assert extracted_dir.exists()
        assert (extracted_dir / "lib" / "helper.js").exists()
        assert (extracted_dir / "index.js").exists()
        assert (extracted_dir / "index.js").is_symlink()

    @pytest.mark.integration
    def test_install_real_npm_package(self, tmp_path):
        """Integration test with actual npm pack on a real package."""
        import shutil

        # Only run if npm is available
        if not shutil.which('npm'):
            pytest.skip("npm not available")

        plugin = {
            'package': 'semver@7.0.0',  # Small, stable package
            'integrity': 'sha512-+GB6zVA9LWh6zovYQLALHwv5rb2PHGlJi3lfiqIHxR0uuwCgefcOJc59v9fv1w8GbStwxuuqqAjI9NMAOOgq1A=='
        }
        plugin_path_by_hash = {}

        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path), skip_integrity_check=False)
        plugin_path = installer.install(plugin, plugin_path_by_hash)

        # Verify plugin was installed
        installed_dir = tmp_path / plugin_path
        assert installed_dir.exists()
        assert (installed_dir / "package.json").exists()

class TestOciDownloader:
    """Test cases for OciDownloader class."""

    def test_skopeo_command_execution(self, tmp_path, mocker):
        """Test that skopeo commands are executed correctly."""
        # Mock shutil.which to return a fake skopeo path
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        # Mock subprocess.run
        mock_run = mocker.patch('subprocess.run')
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = b'output'

        downloader = install_dynamic_plugins.OciDownloader(str(tmp_path))
        result = downloader.skopeo(['inspect', 'docker://example.com/image:latest'])

        # Verify skopeo was called with correct arguments
        mock_run.assert_called_once()
        call_args = mock_run.call_args[0][0]
        assert call_args[0] == '/usr/bin/skopeo'
        assert call_args[1] == 'inspect'
        assert result == b'output'

    def test_skopeo_not_found_raises_exception(self, tmp_path, mocker):
        """Test that missing skopeo raises InstallException."""
        mocker.patch('shutil.which', return_value=None)

        with pytest.raises(InstallException) as exc_info:
            install_dynamic_plugins.OciDownloader(str(tmp_path))

        assert 'skopeo executable not found' in str(exc_info.value)

    def test_get_plugin_tar_caches_downloads(self, tmp_path, mocker):
        """Test that get_plugin_tar caches downloaded images."""
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        # Mock skopeo copy
        mock_run = mocker.patch('subprocess.run')
        mock_run.return_value.returncode = 0

        # Create fake manifest
        manifest_data = {
            'layers': [{'digest': 'sha256:abc123'}]
        }

        downloader = install_dynamic_plugins.OciDownloader(str(tmp_path))

        # Mock the manifest file read
        mocker.patch('builtins.open', mocker.mock_open(read_data=json.dumps(manifest_data)))
        mocker.patch('os.path.join', side_effect=lambda *args: '/'.join(args))

        image = 'oci://registry.io/plugin:v1.0'

        # First call should execute skopeo
        tar_path1 = downloader.get_plugin_tar(image)

        # Second call should return cached result
        tar_path2 = downloader.get_plugin_tar(image)

        # Should return same path
        assert tar_path1 == tar_path2

        # Verify image is cached
        assert image in downloader.image_to_tarball

    def test_extract_plugin_with_valid_path(self, tmp_path, mocker):
        """Test extracting a plugin from a tar file."""
        import tarfile
        import io

        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        # Create a real test tarball with plugin files
        plugin_path = "internal-backstage-plugin-test"
        tarball_path = tmp_path / "test.tar.gz"

        with create_test_tarball(tarball_path) as tar:
            # Add plugin files
            for filename in ["package.json", "index.js"]:
                info = tarfile.TarInfo(name=f"{plugin_path}/{filename}")
                content = b'{"name": "test"}' if filename.endswith('.json') else b'console.log("test");'
                info.size = len(content)
                tar.addfile(info, io.BytesIO(content))

        downloader = install_dynamic_plugins.OciDownloader(str(tmp_path))
        downloader.extract_plugin(str(tarball_path), plugin_path)

        # Verify files were extracted
        extracted_dir = tmp_path / plugin_path
        assert extracted_dir.exists()
        assert (extracted_dir / "package.json").exists()
        assert (extracted_dir / "index.js").exists()

    def test_extract_plugin_rejects_oversized_files(self, tmp_path, mocker):
        """Test that extract_plugin rejects files larger than max_entry_size."""
        import tarfile
        import io

        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        plugin_path = "plugin"
        tarball_path = tmp_path / "malicious.tar.gz"

        # Create tarball with oversized file (needs actual content matching size)
        large_content = b"x" * 25_000_000  # 25MB, exceeds default 20MB

        with create_test_tarball(tarball_path) as tar:
            info = tarfile.TarInfo(name=f"{plugin_path}/huge.bin")
            info.size = len(large_content)
            tar.addfile(info, io.BytesIO(large_content))

        downloader = install_dynamic_plugins.OciDownloader(str(tmp_path))

        with pytest.raises(InstallException) as exc_info:
            downloader.extract_plugin(str(tarball_path), plugin_path)

        assert 'Zip bomb' in str(exc_info.value)

    def test_get_oci_plugin_paths_single_plugin(self, tmp_path, mocker):
        """Test get_oci_plugin_paths with a single plugin in the image."""
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        # Mock skopeo inspect --raw to return manifest with single plugin
        mock_run = mocker.patch('subprocess.run')
        mock_run.return_value.returncode = 0

        # Create test annotation data (raw manifest format)
        plugins_metadata = [{
            "backstage-plugin-events-backend-module-github": {
                "name": "@backstage/plugin-events-backend-module-github-dynamic",
                "version": "0.4.3"
            }
        }]
        annotation_value = base64.b64encode(json.dumps(plugins_metadata).encode('utf-8')).decode('utf-8')

        manifest_output = {
            "schemaVersion": 2,
            "annotations": {
                "io.backstage.dynamic-packages": annotation_value
            }
        }
        mock_run.return_value.stdout = json.dumps(manifest_output).encode('utf-8')

        paths = install_dynamic_plugins.get_oci_plugin_paths('oci://registry.io/plugin:v1.0')

        assert len(paths) == 1
        assert paths[0] == "backstage-plugin-events-backend-module-github"

        # Verify --raw flag was used
        mock_run.assert_called()
        call_args = mock_run.call_args[0][0]
        assert '--raw' in call_args

    def test_get_oci_plugin_paths_multiple_plugins(self, tmp_path, mocker):
        """Test get_oci_plugin_paths with multiple plugins in the image."""
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        mock_run = mocker.patch('subprocess.run')
        mock_run.return_value.returncode = 0

        # Create test annotation data with multiple plugins (raw manifest format)
        plugins_metadata = [
            {"plugin-one": {"name": "@scope/plugin-one", "version": "1.0.0"}},
            {"plugin-two": {"name": "@scope/plugin-two", "version": "2.0.0"}}
        ]
        annotation_value = base64.b64encode(json.dumps(plugins_metadata).encode('utf-8')).decode('utf-8')

        manifest_output = {
            "schemaVersion": 2,
            "annotations": {
                "io.backstage.dynamic-packages": annotation_value
            }
        }
        mock_run.return_value.stdout = json.dumps(manifest_output).encode('utf-8')

        paths = install_dynamic_plugins.get_oci_plugin_paths('oci://registry.io/plugin:v1.0')

        assert len(paths) == 2
        assert "plugin-one" in paths
        assert "plugin-two" in paths

    def test_get_oci_plugin_paths_no_annotation(self, tmp_path, mocker):
        """Test get_oci_plugin_paths when annotation is missing."""
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        mock_run = mocker.patch('subprocess.run')
        mock_run.return_value.returncode = 0

        # Raw manifest without the plugin annotation
        manifest_output = {
            "schemaVersion": 2,
            "annotations": {}
        }
        mock_run.return_value.stdout = json.dumps(manifest_output).encode('utf-8')

        paths = install_dynamic_plugins.get_oci_plugin_paths('oci://registry.io/plugin:v1.0')

        assert len(paths) == 0
        
    @pytest.mark.integration
    # Corresponds to the quay.io/rhdh/backstage-community-plugin-analytics-provider-segment:bcp-analytics-provider-segment-1-on-push-hv5kz-build-container image
    # Not to quay.io/rhdh/backstage-community-plugin-analytics-provider-segment:1.10.0--1.22.2 which is a manifest list
    @pytest.mark.parametrize("image", [
        'oci://quay.io/rhdh/backstage-community-plugin-analytics-provider-segment@sha256:d465b0f4f85af8a0767a84055c366cebc11c8c1f6a8488248874e3acc7f148ee',
        'oci://ghcr.io/redhat-developer/rhdh-plugin-export-overlays/backstage-community-plugin-analytics-provider-segment:bs_1.45.3__1.22.2'
    ])
    def test_get_oci_plugin_paths_real_image(self, tmp_path, image):
        """Test get_oci_plugin_paths with real OCI images."""
        import shutil

        # Skip if skopeo not available
        if not shutil.which('skopeo'):
            pytest.skip("skopeo not available")

        paths = install_dynamic_plugins.get_oci_plugin_paths(image)

        # Verify we got at least one plugin path
        assert isinstance(paths, list)
        assert len(paths) > 0

        # Verify all paths are strings
        for path in paths:
            assert isinstance(path, str)
            assert len(path) > 0
            # display path
            print(f"\nPath: {path}")
            
    def test_download_with_explicit_path(self, tmp_path, mocker):
        """Test download extracts the specified plugin path."""
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        downloader = install_dynamic_plugins.OciDownloader(str(tmp_path))

        mocker.patch.object(downloader, 'get_plugin_tar', return_value='/fake/tar/path')

        def mock_extract(tar_file, plugin_path):
            plugin_dir = tmp_path / plugin_path
            plugin_dir.mkdir(parents=True, exist_ok=True)
            (plugin_dir / "package.json").write_text('{"name": "test"}')

        mocker.patch.object(downloader, 'extract_plugin', side_effect=mock_extract)

        # download() always expects package with path (resolved by parse_plugin_key)
        package = 'oci://registry.io/plugin:v1.0!explicit-plugin'
        result = downloader.download(package)

        assert result == 'explicit-plugin'
        downloader.extract_plugin.assert_called_once_with(tar_file='/fake/tar/path', plugin_path='explicit-plugin')

    def test_download_removes_previous_installation(self, tmp_path, mocker):
        """Test that download removes previous plugin directory."""
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        # Create existing plugin directory with old content
        plugin_path = "internal-backstage-plugin-test"
        existing_dir = tmp_path / plugin_path
        existing_dir.mkdir()
        old_file = existing_dir / "old-file.txt"
        old_file.write_text("old content")
        old_subdir = existing_dir / "old-subdir"
        old_subdir.mkdir()
        (old_subdir / "old-nested.txt").write_text("old nested content")

        # Verify old content exists before
        assert existing_dir.exists()
        assert old_file.exists()
        assert old_subdir.exists()

        # Mock get_plugin_tar and extract_plugin to simulate extraction
        downloader = install_dynamic_plugins.OciDownloader(str(tmp_path))
        mocker.patch.object(downloader, 'get_plugin_tar', return_value='/fake/tar/path')

        def mock_extract(tar_file, plugin_path):
            # Simulate extraction by creating new files
            plugin_dir = tmp_path / plugin_path
            plugin_dir.mkdir(parents=True, exist_ok=True)
            (plugin_dir / "package.json").write_text('{"name": "new-plugin"}')
            (plugin_dir / "index.js").write_text("console.log('new');")

        mocker.patch.object(downloader, 'extract_plugin', side_effect=mock_extract)

        package = f'oci://registry.io/plugin:v1.0!{plugin_path}'
        result = downloader.download(package)

        # Verify extraction was called
        downloader.extract_plugin.assert_called_once()
        assert result == plugin_path

        # Verify old content was removed
        assert not old_file.exists(), "Old file should have been removed"
        assert not old_subdir.exists(), "Old subdirectory should have been removed"

        # Verify new content exists
        new_dir = tmp_path / plugin_path
        assert new_dir.exists(), "New plugin directory should exist"
        assert (new_dir / "package.json").exists(), "New package.json should exist"
        assert (new_dir / "index.js").exists(), "New index.js should exist"

        # Verify old content is definitely gone
        assert not (new_dir / "old-file.txt").exists(), "Old file should not exist in new installation"
        assert not (new_dir / "old-subdir").exists(), "Old subdirectory should not exist in new installation"

    def test_digest_returns_image_digest(self, tmp_path, mocker):
        """Test that digest() returns the correct digest from remote image."""
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        # Mock skopeo inspect output
        inspect_output = {
            'Digest': 'sha256:abc123def456789'
        }

        mock_run = mocker.patch('subprocess.run')
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = json.dumps(inspect_output).encode('utf-8')

        downloader = install_dynamic_plugins.OciDownloader(str(tmp_path))
        package = 'oci://registry.io/plugin:v1.0!path'

        digest = downloader.digest(package)

        # Should return just the hash part
        assert digest == 'abc123def456789'

        # Verify skopeo inspect was called
        mock_run.assert_called_once()
        call_args = mock_run.call_args[0][0]
        assert 'inspect' in call_args
        assert 'docker://registry.io/plugin:v1.0' in call_args


class TestOciPluginInstallerInstall:
    """Test cases for OciPluginInstaller.install() method."""

    def test_install_creates_digest_file(self, tmp_path, mocker):
        """Test that install creates a digest file for tracking."""
        plugin_path = "test-plugin"
        plugin = {
            'package': f'oci://registry.io/plugin:v1.0!{plugin_path}',
            'version': 'v1.0'
        }

        # Mock the downloader
        mock_downloader = mocker.MagicMock()
        mock_downloader.download.return_value = plugin_path
        mock_downloader.digest.return_value = 'abc123digest'

        installer = install_dynamic_plugins.OciPluginInstaller(str(tmp_path))
        installer.downloader = mock_downloader

        # Create the plugin directory that download would create
        plugin_dir = tmp_path / plugin_path
        plugin_dir.mkdir()

        result = installer.install(plugin, {})

        # Verify digest file was created
        digest_file = plugin_dir / 'dynamic-plugin-image.hash'
        assert digest_file.exists()
        assert digest_file.read_text() == 'abc123digest'
        assert result == plugin_path

    def test_install_missing_version_raises_exception(self, tmp_path, mocker):
        """Test that install raises exception when version is not set."""
        plugin = {
            'package': 'oci://registry.io/plugin:v1.0!path',
            'version': None
        }

        installer = install_dynamic_plugins.OciPluginInstaller(str(tmp_path))

        with pytest.raises(InstallException) as exc_info:
            installer.install(plugin, {})

        assert 'Tag or Digest is not set' in str(exc_info.value)

    def test_install_cleans_up_duplicate_hashes(self, tmp_path, mocker):
        """Test that install removes duplicate hash entries."""
        plugin_path = "test-plugin"
        plugin = {
            'package': f'oci://registry.io/plugin:v1.0!{plugin_path}',
            'version': 'v1.0',
            'plugin_hash': 'newhash'
        }

        plugin_path_by_hash = {
            'oldhash': plugin_path,
            'anotherhash': plugin_path
        }

        # Mock the downloader
        mock_downloader = mocker.MagicMock()
        mock_downloader.download.return_value = plugin_path
        mock_downloader.digest.return_value = 'digest123'

        installer = install_dynamic_plugins.OciPluginInstaller(str(tmp_path))
        installer.downloader = mock_downloader

        # Create plugin directory
        plugin_dir = tmp_path / plugin_path
        plugin_dir.mkdir()

        result = installer.install(plugin, plugin_path_by_hash)

        # Verify old hashes were removed
        assert 'oldhash' not in plugin_path_by_hash
        assert 'anotherhash' not in plugin_path_by_hash
        assert result == plugin_path

    def test_install_handles_download_errors(self, tmp_path, mocker):
        """Test that install properly handles download errors."""
        plugin = {
            'package': 'oci://registry.io/plugin:v1.0!path',
            'version': 'v1.0'
        }

        # Mock downloader to raise an exception
        mock_downloader = mocker.MagicMock()
        mock_downloader.download.side_effect = Exception("Network error")

        installer = install_dynamic_plugins.OciPluginInstaller(str(tmp_path))
        installer.downloader = mock_downloader

        with pytest.raises(InstallException) as exc_info:
            installer.install(plugin, {})

        assert 'Error while installing OCI plugin' in str(exc_info.value)
        assert 'Network error' in str(exc_info.value)


@pytest.mark.integration
class TestOciIntegration:
    """Integration tests with real OCI images."""

    @pytest.mark.integration
    def test_download_real_oci_image(self, tmp_path):
        """Test downloading and extracting a real OCI image."""
        import shutil

        # Skip if skopeo not available
        if not shutil.which('skopeo'):
            pytest.skip("skopeo not available")

        package = 'oci://quay.io/gashcrumb/example-root-http-middleware:latest!internal-backstage-plugin-simple-chat'

        downloader = install_dynamic_plugins.OciDownloader(str(tmp_path))
        plugin_path = downloader.download(package)

        # Verify plugin was extracted
        plugin_dir = tmp_path / plugin_path
        assert plugin_dir.exists()
        assert (plugin_dir / "package.json").exists()

        # Verify we can read package.json
        package_json = json.loads((plugin_dir / "package.json").read_text())
        assert 'name' in package_json

    @pytest.mark.integration
    def test_get_digest_from_real_image(self, tmp_path):
        """Test getting digest from a real OCI image."""
        import shutil

        if not shutil.which('skopeo'):
            pytest.skip("skopeo not available")

        package = 'oci://quay.io/gashcrumb/example-root-http-middleware:latest!internal-backstage-plugin-simple-chat'

        downloader = install_dynamic_plugins.OciDownloader(str(tmp_path))
        digest = downloader.digest(package)

        # Digest should be a hex string
        assert isinstance(digest, str)
        assert len(digest) > 0

    @pytest.mark.integration
    def test_install_oci_plugin_creates_hash_file(self, tmp_path):
        """Test full installation of OCI plugin with hash file creation."""
        import shutil

        if not shutil.which('skopeo'):
            pytest.skip("skopeo not available")

        plugin_path_name = 'internal-backstage-plugin-simple-chat'
        plugin = {
            'package': f'oci://quay.io/gashcrumb/example-root-http-middleware:latest!{plugin_path_name}',
            'version': 'latest'
        }

        installer = install_dynamic_plugins.OciPluginInstaller(str(tmp_path))
        plugin_path = installer.install(plugin, {})

        # Verify installation
        plugin_dir = tmp_path / plugin_path
        assert plugin_dir.exists()
        assert (plugin_dir / "package.json").exists()

        # Verify digest hash file was created
        hash_file = plugin_dir / 'dynamic-plugin-image.hash'
        assert hash_file.exists()
        digest = hash_file.read_text().strip()
        assert len(digest) > 0

    @pytest.mark.integration
    def test_download_multiple_plugins_from_same_image(self, tmp_path):
        """Test downloading multiple plugins from the same OCI image."""
        import shutil

        if not shutil.which('skopeo'):
            pytest.skip("skopeo not available")

        # Two plugins from the same image
        packages = [
            'oci://quay.io/gashcrumb/example-root-http-middleware:latest!internal-backstage-plugin-simple-chat',
            'oci://quay.io/gashcrumb/example-root-http-middleware:latest!internal-backstage-plugin-middleware-header-example-dynamic'
        ]

        downloader = install_dynamic_plugins.OciDownloader(str(tmp_path))

        plugin_paths = []
        for package in packages:
            plugin_path = downloader.download(package)
            plugin_paths.append(plugin_path)

            # Verify plugin was extracted
            plugin_dir = tmp_path / plugin_path
            assert plugin_dir.exists()
            assert (plugin_dir / "package.json").exists()

        # Verify both plugins were extracted
        assert len(plugin_paths) == 2
        assert plugin_paths[0] != plugin_paths[1]

    @pytest.mark.integration
    def test_oci_plugin_with_inherit_version(self, tmp_path):
        """Test that inherit version pattern works in plugin merge."""
        # This tests the version inheritance at the merge level
        all_plugins = {}

        # First add a plugin with explicit version
        plugin1 = {
            'package': 'oci://quay.io/gashcrumb/example-root-http-middleware:latest!internal-backstage-plugin-simple-chat-backend-dynamic'
        }
        merger1 = install_dynamic_plugins.OciPackageMerger(plugin1, 'test.yaml', all_plugins)
        merger1.merge_plugin(level=0)

        # Then override with {{inherit}}
        plugin2 = {
            'package': 'oci://quay.io/gashcrumb/example-root-http-middleware:{{inherit}}!internal-backstage-plugin-simple-chat-backend-dynamic',
            'disabled': False
        }
        merger2 = install_dynamic_plugins.OciPackageMerger(plugin2, 'test.yaml', all_plugins)
        merger2.merge_plugin(level=1)

        # Version should be inherited from plugin1
        plugin_key = 'oci://quay.io/gashcrumb/example-root-http-middleware:!internal-backstage-plugin-simple-chat-backend-dynamic'
        assert plugin_key in all_plugins
        assert all_plugins[plugin_key]['version'] == 'latest'
        assert all_plugins[plugin_key]['disabled'] is False


class TestGetLocalPackageInfo:
    """Test cases for get_local_package_info() function."""

    def test_package_with_valid_package_json(self, tmp_path):
        """Test getting info from a package with valid package.json."""
        # Create a package directory with package.json
        package_dir = tmp_path / "test-package"
        package_dir.mkdir()

        package_json = {
            "name": "test-package",
            "version": "1.0.0",
            "description": "A test package"
        }
        package_json_path = package_dir / "package.json"
        package_json_path.write_text(json.dumps(package_json))

        # Get package info
        info = install_dynamic_plugins.get_local_package_info(str(package_dir))

        # Verify the info contains expected fields
        assert '_package_json' in info
        assert info['_package_json'] == package_json
        assert '_package_json_mtime' in info
        assert info['_package_json_mtime'] == package_json_path.stat().st_mtime
        # Should not have lock file mtimes
        assert '_package-lock.json_mtime' not in info
        assert '_yarn.lock_mtime' not in info

    def test_package_with_relative_path(self, tmp_path, monkeypatch):
        """Test getting info from a package using relative path (./)."""
        # Create a package directory
        package_dir = tmp_path / "test-package"
        package_dir.mkdir()

        package_json = {"name": "test-package", "version": "2.0.0"}
        (package_dir / "package.json").write_text(json.dumps(package_json))

        # Change to tmp_path directory and use relative path
        monkeypatch.chdir(tmp_path)

        # Get package info with relative path
        info = install_dynamic_plugins.get_local_package_info('./test-package')

        # Verify the info is correct
        assert info['_package_json'] == package_json
        assert '_package_json_mtime' in info

    def test_package_with_package_lock_json(self, tmp_path):
        """Test getting info from a package with package-lock.json."""
        package_dir = tmp_path / "test-package"
        package_dir.mkdir()

        package_json_path = package_dir / "package.json"
        package_json_path.write_text(json.dumps({"name": "test", "version": "1.0.0"}))

        package_lock_path = package_dir / "package-lock.json"
        package_lock_path.write_text(json.dumps({"lockfileVersion": 2}))

        # Get package info
        info = install_dynamic_plugins.get_local_package_info(str(package_dir))

        # Verify lock file mtime is included
        assert '_package-lock.json_mtime' in info
        assert info['_package-lock.json_mtime'] == package_lock_path.stat().st_mtime
        assert '_yarn.lock_mtime' not in info

    def test_package_with_yarn_lock(self, tmp_path):
        """Test getting info from a package with yarn.lock."""
        package_dir = tmp_path / "test-package"
        package_dir.mkdir()

        package_json_path = package_dir / "package.json"
        package_json_path.write_text(json.dumps({"name": "test", "version": "1.0.0"}))

        yarn_lock_path = package_dir / "yarn.lock"
        yarn_lock_path.write_text("# yarn lockfile v1")

        # Get package info
        info = install_dynamic_plugins.get_local_package_info(str(package_dir))

        # Verify lock file mtime is included
        assert '_yarn.lock_mtime' in info
        assert info['_yarn.lock_mtime'] == yarn_lock_path.stat().st_mtime
        assert '_package-lock.json_mtime' not in info

    def test_package_with_both_lock_files(self, tmp_path):
        """Test getting info from a package with both package-lock.json and yarn.lock."""
        package_dir = tmp_path / "test-package"
        package_dir.mkdir()

        package_json_path = package_dir / "package.json"
        package_json_path.write_text(json.dumps({"name": "test", "version": "1.0.0"}))

        package_lock_path = package_dir / "package-lock.json"
        package_lock_path.write_text(json.dumps({"lockfileVersion": 2}))

        yarn_lock_path = package_dir / "yarn.lock"
        yarn_lock_path.write_text("# yarn lockfile v1")

        # Get package info
        info = install_dynamic_plugins.get_local_package_info(str(package_dir))

        # Verify both lock file mtimes are included
        assert '_package-lock.json_mtime' in info
        assert '_yarn.lock_mtime' in info
        assert info['_package-lock.json_mtime'] == package_lock_path.stat().st_mtime
        assert info['_yarn.lock_mtime'] == yarn_lock_path.stat().st_mtime

    def test_directory_without_package_json(self, tmp_path):
        """Test getting info from a directory without package.json (falls back to directory mtime)."""
        package_dir = tmp_path / "empty-package"
        package_dir.mkdir()

        # Get package info
        info = install_dynamic_plugins.get_local_package_info(str(package_dir))

        # Should return directory mtime
        assert '_directory_mtime' in info
        assert info['_directory_mtime'] == package_dir.stat().st_mtime
        assert '_package_json' not in info

    def test_nonexistent_path(self, tmp_path):
        """Test getting info from a non-existent path."""
        nonexistent_path = tmp_path / "does-not-exist"

        # Get package info
        info = install_dynamic_plugins.get_local_package_info(str(nonexistent_path))

        # Should return _not_found flag
        assert '_not_found' in info
        assert info['_not_found'] is True

    def test_invalid_json_in_package_json(self, tmp_path):
        """Test getting info when package.json contains invalid JSON."""
        package_dir = tmp_path / "test-package"
        package_dir.mkdir()

        # Write invalid JSON
        package_json_path = package_dir / "package.json"
        package_json_path.write_text("{ invalid json content }")

        # Get package info
        info = install_dynamic_plugins.get_local_package_info(str(package_dir))

        # Should return error information
        assert '_error' in info
        assert 'JSONDecodeError' in info['_error'] or 'Expecting' in info['_error']

    def test_package_info_detects_changes(self, tmp_path):
        """Test that package info changes when files are modified."""
        package_dir = tmp_path / "test-package"
        package_dir.mkdir()

        # Create initial package.json
        package_json_path = package_dir / "package.json"
        package_json_v1 = {"name": "test", "version": "1.0.0"}
        package_json_path.write_text(json.dumps(package_json_v1))

        # Get initial info
        info1 = install_dynamic_plugins.get_local_package_info(str(package_dir))
        initial_mtime = info1['_package_json_mtime']

        # Wait a bit and modify the file
        import time
        time.sleep(0.01)

        package_json_v2 = {"name": "test", "version": "2.0.0"}
        package_json_path.write_text(json.dumps(package_json_v2))

        # Get updated info
        info2 = install_dynamic_plugins.get_local_package_info(str(package_dir))

        # Verify that content and mtime changed
        assert info2['_package_json'] != info1['_package_json']
        assert info2['_package_json']['version'] == "2.0.0"
        assert info2['_package_json_mtime'] > initial_mtime

    def test_lock_file_mtime_detection(self, tmp_path):
        """Test that lock file changes are detected via mtime."""
        package_dir = tmp_path / "test-package"
        package_dir.mkdir()

        package_json_path = package_dir / "package.json"
        package_json_path.write_text(json.dumps({"name": "test", "version": "1.0.0"}))

        # Get info without lock file
        info1 = install_dynamic_plugins.get_local_package_info(str(package_dir))
        assert '_package-lock.json_mtime' not in info1

        # Add lock file
        import time
        time.sleep(0.01)

        package_lock_path = package_dir / "package-lock.json"
        package_lock_path.write_text(json.dumps({"lockfileVersion": 2}))

        # Get info with lock file
        info2 = install_dynamic_plugins.get_local_package_info(str(package_dir))
        assert '_package-lock.json_mtime' in info2

        # Hashes should be different due to lock file addition
        hash1 = hashlib.sha256(json.dumps(info1, sort_keys=True).encode('utf-8')).hexdigest()
        hash2 = hashlib.sha256(json.dumps(info2, sort_keys=True).encode('utf-8')).hexdigest()
        assert hash1 != hash2

class TestExtractCatalogIndex:
    """Test cases for extract_catalog_index() function."""

    @pytest.fixture
    def mock_oci_image(self, tmp_path):
        """Create a mock OCI image structure with manifest and layer."""
        import tarfile

        # Create a temporary directory for the OCI image
        oci_dir = tmp_path / "oci-image"
        oci_dir.mkdir()

        # Create manifest.json
        manifest = {
            "schemaVersion": 2,
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "config": {
                "mediaType": "application/vnd.oci.image.config.v1+json",
                "digest": "sha256:test123",
                "size": 100
            },
            "layers": [
                {
                    "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
                    "digest": "sha256:abc123def456",
                    "size": 1000
                }
            ]
        }
        manifest_path = oci_dir / "manifest.json"
        manifest_path.write_text(json.dumps(manifest))

        # Create a layer tarball with dynamic-plugins.default.yaml and catalog entities
        layer_content_dir = tmp_path / "layer-content"
        layer_content_dir.mkdir()

        yaml_file = layer_content_dir / "dynamic-plugins.default.yaml"
        yaml_content = """plugins:
  - package: '@backstage/plugin-catalog'
    integrity: sha512-test
"""
        yaml_file.write_text(yaml_content)

        # Create catalog entities directory structure (using marketplace for backward compatibility)
        catalog_entities_dir = layer_content_dir / "catalog-entities" / "marketplace"
        catalog_entities_dir.mkdir(parents=True)
        entity_file = catalog_entities_dir / "test-entity.yaml"
        entity_file.write_text("apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: test")

        # Create the layer tarball
        layer_tarball = oci_dir / "abc123def456"
        with create_test_tarball(layer_tarball) as tar:
            tar.add(str(yaml_file), arcname="dynamic-plugins.default.yaml")
            # Add catalog entities directory structure recursively
            # This ensures the directory structure is preserved in the tarball
            tar.add(str(layer_content_dir / "catalog-entities"), arcname="catalog-entities", recursive=True)

        return {
            "oci_dir": str(oci_dir),
            "manifest_path": str(manifest_path),
            "layer_tarball": str(layer_tarball),
            "yaml_content": yaml_content,
            "entity_file": str(entity_file)
        }

    @pytest.fixture
    def mock_oci_image_with_extensions(self, tmp_path):
        """Create a mock OCI image structure with extensions directory (new format)."""
        import tarfile

        # Create a temporary directory for the OCI image
        oci_dir = tmp_path / "oci-image-extensions"
        oci_dir.mkdir()

        # Create manifest.json
        manifest = {
            "schemaVersion": 2,
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "config": {
                "mediaType": "application/vnd.oci.image.config.v1+json",
                "digest": "sha256:test456",
                "size": 100
            },
            "layers": [
                {
                    "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
                    "digest": "sha256:def789ghi012",
                    "size": 1000
                }
            ]
        }
        manifest_path = oci_dir / "manifest.json"
        manifest_path.write_text(json.dumps(manifest))

        # Create a layer tarball with dynamic-plugins.default.yaml and catalog entities
        layer_content_dir = tmp_path / "layer-content-extensions"
        layer_content_dir.mkdir()

        yaml_file = layer_content_dir / "dynamic-plugins.default.yaml"
        yaml_content = """plugins:
  - package: '@backstage/plugin-catalog'
    integrity: sha512-test
"""
        yaml_file.write_text(yaml_content)

        # Create catalog entities directory structure using extensions (new format)
        catalog_entities_dir = layer_content_dir / "catalog-entities" / "extensions"
        catalog_entities_dir.mkdir(parents=True)
        entity_file = catalog_entities_dir / "test-entity.yaml"
        entity_file.write_text("apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: test-extensions")

        # Create the layer tarball
        layer_tarball = oci_dir / "def789ghi012"
        with create_test_tarball(layer_tarball) as tar:
            tar.add(str(yaml_file), arcname="dynamic-plugins.default.yaml")
            # Add catalog entities directory structure recursively
            tar.add(str(layer_content_dir / "catalog-entities"), arcname="catalog-entities", recursive=True)

        return {
            "oci_dir": str(oci_dir),
            "manifest_path": str(manifest_path),
            "layer_tarball": str(layer_tarball),
            "yaml_content": yaml_content,
            "entity_file": str(entity_file)
        }

    def test_extract_catalog_index_skopeo_not_found(self, tmp_path, mocker):
        """Test that function raises InstallException when skopeo is not available."""
        mocker.patch('shutil.which', return_value=None)

        with pytest.raises(install_dynamic_plugins.InstallException, match="skopeo executable not found in PATH"):
            install_dynamic_plugins.extract_catalog_index(
                "quay.io/test/image:latest",
                str(tmp_path),
                str(tmp_path / "m4rk3tpl4c3")
            )

    def test_extract_catalog_index_skopeo_copy_fails(self, tmp_path, mocker):
        """Test that function raises InstallException when skopeo copy fails."""
        import subprocess
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        # Mock subprocess.run to raise CalledProcessError (since run_command uses check=True)
        mock_error = subprocess.CalledProcessError(
            returncode=1,
            cmd=['/usr/bin/skopeo', 'copy', 'docker://quay.io/test/image:latest', 'dir:/tmp/...']
        )
        mock_error.stderr = "Error: image not found"
        mock_error.stdout = ""
        mocker.patch('subprocess.run', side_effect=mock_error)

        with pytest.raises(install_dynamic_plugins.InstallException) as exc_info:
            install_dynamic_plugins.extract_catalog_index(
                "quay.io/test/image:latest",
                str(tmp_path),
                str(tmp_path / "m4rk3tpl4c3")
            )
        
        # Verify the error message includes the expected content
        error_msg = str(exc_info.value)
        assert "Failed to download catalog index image" in error_msg
        assert "command failed with exit code 1" in error_msg
        assert "stderr: Error: image not found" in error_msg

    def test_extract_catalog_index_no_manifest(self, tmp_path, mocker):
        """Test that function raises InstallException when manifest.json is not found."""
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        # Mock subprocess.run to simulate successful skopeo copy
        mock_result = mocker.Mock()
        mock_result.returncode = 0
        mocker.patch('subprocess.run', return_value=mock_result)

        with pytest.raises(install_dynamic_plugins.InstallException, match="manifest.json not found in catalog index image"):
            install_dynamic_plugins.extract_catalog_index(
                "quay.io/test/image:latest",
                str(tmp_path),
                str(tmp_path / "m4rk3tpl4c3")
            )

    def test_extract_catalog_index_success(self, tmp_path, mocker, mock_oci_image, capsys):
        """Test successful extraction of catalog index with dynamic-plugins.default.yaml."""
        catalog_mount = tmp_path / "catalog-mount"
        catalog_mount.mkdir()
        catalog_entities_parent_dir = tmp_path / "m4rk3tpl4c3"

        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        # Mock subprocess.run to simulate successful skopeo copy
        mock_result = mocker.Mock()
        mock_result.returncode = 0
        mock_subprocess_run = create_mock_skopeo_copy(
            mock_oci_image['manifest_path'],
            mock_oci_image['layer_tarball'],
            mock_result
        )
        mocker.patch('subprocess.run', side_effect=mock_subprocess_run)

        result = install_dynamic_plugins.extract_catalog_index(
            "quay.io/test/catalog-index:1.9",
            str(catalog_mount),
            str(catalog_entities_parent_dir)
        )

        # Verify the function returned a path
        assert result is not None
        assert result.endswith('dynamic-plugins.default.yaml')

        # Verify the file exists and contains expected content
        assert os.path.isfile(result)
        with open(result, 'r') as f:
            content = f.read()
            assert '@backstage/plugin-catalog' in content

        # Verify catalog entities were extracted
        # Note: copytree copies the contents of marketplace into catalog-entities
        entities_dir = catalog_entities_parent_dir / "catalog-entities"
        assert entities_dir.exists()
        entity_file = entities_dir / "test-entity.yaml"
        assert entity_file.exists()
        assert "kind: Component" in entity_file.read_text()

        # Verify success messages were printed
        captured = capsys.readouterr()
        assert 'Successfully extracted dynamic-plugins.default.yaml' in captured.out
        assert 'Successfully extracted extensions catalog entities' in captured.out

    def test_extract_catalog_index_no_yaml_file(self, tmp_path, mocker):
        """Test that function returns None when dynamic-plugins.default.yaml is not found in the image."""
        import tarfile

        catalog_mount = tmp_path / "catalog-mount"
        catalog_mount.mkdir()

        # Create OCI structure without the YAML file
        oci_dir = tmp_path / "oci-no-yaml"
        oci_dir.mkdir()

        manifest = {
            "schemaVersion": 2,
            "layers": [
                {
                    "digest": "sha256:xyz789",
                    "size": 500
                }
            ]
        }
        manifest_path = oci_dir / "manifest.json"
        manifest_path.write_text(json.dumps(manifest))

        # Create empty layer tarball
        layer_tarball = oci_dir / "xyz789"
        with create_test_tarball(layer_tarball) as tar:
            # Add a different file
            readme = tmp_path / "README.md"
            readme.write_text("# Test")
            tar.add(str(readme), arcname="README.md")

        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        mock_result = mocker.Mock()
        mock_result.returncode = 0
        mock_subprocess_run = create_mock_skopeo_copy(manifest_path, layer_tarball, mock_result)
        mocker.patch('subprocess.run', side_effect=mock_subprocess_run)

        with pytest.raises(install_dynamic_plugins.InstallException, match="does not contain the expected dynamic-plugins.default.yaml file"):
            install_dynamic_plugins.extract_catalog_index(
                "quay.io/test/empty-index:latest",
                str(catalog_mount),
                str(tmp_path / "m4rk3tpl4c3")
            )

    def test_extract_catalog_index_large_file_skipped(self, tmp_path, mocker, monkeypatch):
        """Test that files larger than MAX_ENTRY_SIZE are skipped during extraction."""
        import tarfile

        catalog_mount = tmp_path / "catalog-mount"
        catalog_mount.mkdir()

        # Set a very small MAX_ENTRY_SIZE for testing
        monkeypatch.setenv('MAX_ENTRY_SIZE', '1000')

        # Create OCI structure with a "large" file (larger than our test threshold)
        oci_dir = tmp_path / "oci-large-file"
        oci_dir.mkdir()

        manifest = {
            "schemaVersion": 2,
            "layers": [
                {
                    "digest": "sha256:large123",
                    "size": 10000
                }
            ]
        }
        manifest_path = oci_dir / "manifest.json"
        manifest_path.write_text(json.dumps(manifest))

        # Create layer with files
        layer_tarball = oci_dir / "large123"
        layer_content_dir = tmp_path / "large-content"
        layer_content_dir.mkdir()

        yaml_file = layer_content_dir / "dynamic-plugins.default.yaml"
        yaml_file.write_text("plugins: []")

        # Create a "large" file that's bigger than our test threshold of 1000 bytes
        large_file = layer_content_dir / "large-file.bin"
        large_file.write_text("x" * 2000)  # 2KB - larger than our 1000 byte test limit

        with create_test_tarball(layer_tarball) as tar:
            # Add YAML with normal size (smaller than 1000 bytes)
            tar.add(str(yaml_file), arcname="dynamic-plugins.default.yaml")

            # Add "large" file (2KB, which exceeds our 1000 byte test limit)
            tar.add(str(large_file), arcname="large-file.bin")

        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        mock_result = mocker.Mock()
        mock_result.returncode = 0
        mock_subprocess_run = create_mock_skopeo_copy(manifest_path, layer_tarball, mock_result)
        mocker.patch('subprocess.run', side_effect=mock_subprocess_run)

        result = install_dynamic_plugins.extract_catalog_index(
            "quay.io/test/large-file-index:latest",
            str(catalog_mount),
            str(tmp_path / "m4rk3tpl4c3")
        )

        # Should still succeed and find the YAML file
        assert result is not None
        assert os.path.isfile(result)

        # Verify large file was not extracted
        catalog_temp_dir = catalog_mount / ".catalog-index-temp"
        large_file_path = catalog_temp_dir / "large-file.bin"
        assert not large_file_path.exists()

    def test_extract_catalog_index_exception_handling(self, tmp_path, mocker):
        """Test that unexpected exceptions during extraction propagate."""
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        # Mock subprocess.run to raise an exception
        mocker.patch('subprocess.run', side_effect=Exception("Unexpected error"))

        with pytest.raises(Exception, match="Unexpected error"):
            install_dynamic_plugins.extract_catalog_index(
                "quay.io/test/image:latest",
                str(tmp_path),
                str(tmp_path / "m4rk3tpl4c3")
            )

    def test_extract_catalog_index_extracts_catalog_entities(self, tmp_path, mocker, mock_oci_image, capsys):
        """Test that catalog entities are extracted to the specified directory."""
        catalog_mount = tmp_path / "catalog-mount"
        catalog_mount.mkdir()
        catalog_entities_parent_dir = tmp_path / "entities-dest"

        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        mock_result = mocker.Mock()
        mock_result.returncode = 0
        mock_subprocess_run = create_mock_skopeo_copy(
            mock_oci_image['manifest_path'],
            mock_oci_image['layer_tarball'],
            mock_result
        )
        mocker.patch('subprocess.run', side_effect=mock_subprocess_run)

        install_dynamic_plugins.extract_catalog_index(
            "quay.io/test/catalog-index:1.9",
            str(catalog_mount),
            str(catalog_entities_parent_dir)
        )

        # Verify catalog entities directory was created
        # Note: copytree copies the contents of marketplace into catalog-entities
        entities_dir = catalog_entities_parent_dir / "catalog-entities"
        assert entities_dir.exists(), "Catalog entities directory should exist"

        # Verify entity file was copied
        entity_file = entities_dir / "test-entity.yaml"
        assert entity_file.exists(), "Entity file should be copied"
        assert "kind: Component" in entity_file.read_text()

        # Verify success message was printed
        captured = capsys.readouterr()
        assert 'Successfully extracted extensions catalog entities' in captured.out

    def test_extract_catalog_index_creates_entities_directory(self, tmp_path, mocker, mock_oci_image):
        """Test that catalog entities parent directory is created if it doesn't exist."""
        catalog_mount = tmp_path / "catalog-mount"
        catalog_mount.mkdir()
        catalog_entities_parent_dir = tmp_path / "new-entities-dir"
        # Don't create the directory - let the function create it

        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        mock_result = mocker.Mock()
        mock_result.returncode = 0
        mock_subprocess_run = create_mock_skopeo_copy(
            mock_oci_image['manifest_path'],
            mock_oci_image['layer_tarball'],
            mock_result
        )
        mocker.patch('subprocess.run', side_effect=mock_subprocess_run)

        install_dynamic_plugins.extract_catalog_index(
            "quay.io/test/catalog-index:1.9",
            str(catalog_mount),
            str(catalog_entities_parent_dir)
        )

        # Verify directory was created
        assert catalog_entities_parent_dir.exists(), "Catalog entities parent directory should be created"
        # Note: copytree copies the contents of marketplace into catalog-entities
        entities_dir = catalog_entities_parent_dir / "catalog-entities"
        assert entities_dir.exists(), "Catalog entities directory should exist"

        # Verify entity file was copied
        entity_file = entities_dir / "test-entity.yaml"
        assert entity_file.exists(), "Entity file should be copied"

    def test_extract_catalog_index_removes_existing_destination(self, tmp_path, mocker, mock_oci_image):
        """Test that existing catalog-entities directory is removed before copying."""
        catalog_mount = tmp_path / "catalog-mount"
        catalog_mount.mkdir()
        catalog_entities_parent_dir = tmp_path / "existing-dir"
        catalog_entities_parent_dir.mkdir()

        # Create an existing catalog-entities directory with old content
        existing_entities_dir = catalog_entities_parent_dir / "catalog-entities"
        existing_entities_dir.mkdir()
        old_file = existing_entities_dir / "old-file.yaml"
        old_file.write_text("old content")
        old_subdir = existing_entities_dir / "old-subdir"
        old_subdir.mkdir()
        (old_subdir / "old-nested.yaml").write_text("old nested content")

        # Verify old content exists
        assert existing_entities_dir.exists()
        assert old_file.exists()
        assert old_subdir.exists()

        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        mock_result = mocker.Mock()
        mock_result.returncode = 0
        mock_subprocess_run = create_mock_skopeo_copy(
            mock_oci_image['manifest_path'],
            mock_oci_image['layer_tarball'],
            mock_result
        )
        mocker.patch('subprocess.run', side_effect=mock_subprocess_run)

        install_dynamic_plugins.extract_catalog_index(
            "quay.io/test/catalog-index:1.9",
            str(catalog_mount),
            str(catalog_entities_parent_dir)
        )

        # Verify old content was removed
        assert not old_file.exists(), "Old file should have been removed"
        assert not old_subdir.exists(), "Old subdirectory should have been removed"

        # Verify new content exists
        entities_dir = catalog_entities_parent_dir / "catalog-entities"
        assert entities_dir.exists(), "Catalog entities directory should exist"
        entity_file = entities_dir / "test-entity.yaml"
        assert entity_file.exists(), "New entity file should exist"
        assert "kind: Component" in entity_file.read_text()

        # Verify old content is definitely gone
        assert not (entities_dir / "old-file.yaml").exists(), "Old file should not exist"
        assert not (entities_dir / "old-subdir").exists(), "Old subdirectory should not exist"

    def test_extract_catalog_index_uses_extensions_directory(self, tmp_path, mocker, mock_oci_image_with_extensions, capsys):
        """Test that extraction prefers extensions directory over marketplace."""
        catalog_mount = tmp_path / "catalog-mount"
        catalog_mount.mkdir()
        catalog_entities_parent_dir = tmp_path / "entities-extensions"

        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        mock_result = mocker.Mock()
        mock_result.returncode = 0
        mock_subprocess_run = create_mock_skopeo_copy(
            mock_oci_image_with_extensions['manifest_path'],
            mock_oci_image_with_extensions['layer_tarball'],
            mock_result
        )
        mocker.patch('subprocess.run', side_effect=mock_subprocess_run)

        result = install_dynamic_plugins.extract_catalog_index(
            "quay.io/test/catalog-index-extensions:1.9",
            str(catalog_mount),
            str(catalog_entities_parent_dir)
        )

        # Verify the function returned a path
        assert result is not None
        assert result.endswith('dynamic-plugins.default.yaml')

        # Verify catalog entities were extracted from extensions directory
        entities_dir = catalog_entities_parent_dir / "catalog-entities"
        assert entities_dir.exists()
        entity_file = entities_dir / "test-entity.yaml"
        assert entity_file.exists()
        assert "kind: Component" in entity_file.read_text()
        assert "test-extensions" in entity_file.read_text()

        # Verify success messages were printed
        captured = capsys.readouterr()
        assert 'Successfully extracted dynamic-plugins.default.yaml' in captured.out
        assert 'Successfully extracted extensions catalog entities' in captured.out

    def test_extract_catalog_index_falls_back_to_marketplace(self, tmp_path, mocker, mock_oci_image, capsys):
        """Test that extraction falls back to marketplace directory when extensions doesn't exist."""
        catalog_mount = tmp_path / "catalog-mount"
        catalog_mount.mkdir()
        catalog_entities_parent_dir = tmp_path / "entities-marketplace"

        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        mock_result = mocker.Mock()
        mock_result.returncode = 0
        mock_subprocess_run = create_mock_skopeo_copy(
            mock_oci_image['manifest_path'],
            mock_oci_image['layer_tarball'],
            mock_result
        )
        mocker.patch('subprocess.run', side_effect=mock_subprocess_run)

        result = install_dynamic_plugins.extract_catalog_index(
            "quay.io/test/catalog-index-marketplace:1.9",
            str(catalog_mount),
            str(catalog_entities_parent_dir)
        )

        # Verify the function returned a path
        assert result is not None
        assert result.endswith('dynamic-plugins.default.yaml')

        # Verify catalog entities were extracted from marketplace directory (fallback)
        entities_dir = catalog_entities_parent_dir / "catalog-entities"
        assert entities_dir.exists()
        entity_file = entities_dir / "test-entity.yaml"
        assert entity_file.exists()
        assert "kind: Component" in entity_file.read_text()

        # Verify success messages were printed
        captured = capsys.readouterr()
        assert 'Successfully extracted dynamic-plugins.default.yaml' in captured.out
        assert 'Successfully extracted extensions catalog entities' in captured.out

    def test_extract_catalog_index_without_catalog_entities(self, tmp_path, mocker, capsys):
        """Test that extraction succeeds with warning if neither extensions nor marketplace directory exists."""
        import tarfile

        catalog_mount = tmp_path / "catalog-mount"
        catalog_mount.mkdir()
        catalog_entities_parent_dir = tmp_path / "m4rk3tpl4c3"

        # Create OCI structure without catalog-entities
        oci_dir = tmp_path / "oci-no-entities"
        oci_dir.mkdir()

        manifest = {
            "schemaVersion": 2,
            "layers": [
                {
                    "digest": "sha256:noentities123",
                    "size": 500
                }
            ]
        }
        manifest_path = oci_dir / "manifest.json"
        manifest_path.write_text(json.dumps(manifest))

        # Create layer tarball with only YAML file (no catalog-entities)
        layer_tarball = oci_dir / "noentities123"
        layer_content_dir = tmp_path / "layer-content-no-entities"
        layer_content_dir.mkdir()
        yaml_file = layer_content_dir / "dynamic-plugins.default.yaml"
        yaml_file.write_text("plugins: []")

        with create_test_tarball(layer_tarball) as tar:
            tar.add(str(yaml_file), arcname="dynamic-plugins.default.yaml")

        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')

        mock_result = mocker.Mock()
        mock_result.returncode = 0
        mock_subprocess_run = create_mock_skopeo_copy(manifest_path, layer_tarball, mock_result)
        mocker.patch('subprocess.run', side_effect=mock_subprocess_run)

        # Should succeed even without catalog-entities, but print a warning
        result = install_dynamic_plugins.extract_catalog_index(
            "quay.io/test/no-entities-index:latest",
            str(catalog_mount),
            str(catalog_entities_parent_dir)
        )

        # Verify YAML file extraction succeeded
        assert result is not None
        assert result.endswith('dynamic-plugins.default.yaml')

        # Verify warning was printed with both directory names
        captured = capsys.readouterr()
        assert 'WARNING' in captured.out
        assert 'does not have neither' in captured.out
        assert 'catalog-entities/extensions/' in captured.out
        assert 'catalog-entities/marketplace/' in captured.out

        # Verify catalog entities directory was not created
        entities_dir = catalog_entities_parent_dir / "catalog-entities"
        assert not entities_dir.exists()

class TestImageExistsInRegistry:
    """Tests for image_exists_in_registry function."""

    def test_image_exists_returns_true(self, mocker):
        """Test that image_exists_in_registry returns True when image exists."""
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')
        mock_result = mocker.Mock()
        mock_result.returncode = 0
        mocker.patch('subprocess.run', return_value=mock_result)

        result = install_dynamic_plugins.image_exists_in_registry('docker://quay.io/test/image:latest')
        assert result is True

    def test_image_not_exists_returns_false(self, mocker):
        """Test that image_exists_in_registry returns False when image doesn't exist."""
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')
        mocker.patch('subprocess.run', side_effect=install_dynamic_plugins.subprocess.CalledProcessError(1, 'skopeo'))

        result = install_dynamic_plugins.image_exists_in_registry('docker://quay.io/test/nonexistent:latest')
        assert result is False

    def test_skopeo_not_found_raises_exception(self, mocker):
        """Test that missing skopeo raises InstallException."""
        mocker.patch('shutil.which', return_value=None)

        with pytest.raises(InstallException, match='skopeo executable not found'):
            install_dynamic_plugins.image_exists_in_registry('docker://quay.io/test/image:latest')


class TestResolveImageReference:
    """Tests for resolve_image_reference function."""

    def test_non_rhdh_image_unchanged(self, mocker):
        """Test that non-RHDH images are returned unchanged."""
        # No mocking needed - should return immediately without checking
        result = install_dynamic_plugins.resolve_image_reference('oci://quay.io/other/image:v1.0')
        assert result == 'oci://quay.io/other/image:v1.0'

    def test_rhdh_image_exists_returns_original(self, mocker, capsys):
        """Test that existing RHDH image returns original reference."""
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')
        mock_result = mocker.Mock()
        mock_result.returncode = 0
        mocker.patch('subprocess.run', return_value=mock_result)

        result = install_dynamic_plugins.resolve_image_reference('oci://registry.access.redhat.com/rhdh/plugin:v1.0')
        assert result == 'oci://registry.access.redhat.com/rhdh/plugin:v1.0'

        captured = capsys.readouterr()
        assert 'Image found in registry.access.redhat.com/rhdh/' in captured.out

    def test_rhdh_image_not_exists_falls_back_to_quay(self, mocker, capsys):
        """Test that missing RHDH image falls back to quay.io/rhdh/."""
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')
        mocker.patch('subprocess.run', side_effect=install_dynamic_plugins.subprocess.CalledProcessError(1, 'skopeo'))

        result = install_dynamic_plugins.resolve_image_reference('oci://registry.access.redhat.com/rhdh/plugin:v1.0')
        assert result == 'oci://quay.io/rhdh/plugin:v1.0'

        captured = capsys.readouterr()
        assert 'falling back to quay.io/rhdh/' in captured.out
        assert 'Using fallback image: quay.io/rhdh/plugin:v1.0' in captured.out

    def test_rhdh_docker_protocol_falls_back_to_quay(self, mocker, capsys):
        """Test fallback works with docker:// protocol prefix."""
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')
        mocker.patch('subprocess.run', side_effect=install_dynamic_plugins.subprocess.CalledProcessError(1, 'skopeo'))

        result = install_dynamic_plugins.resolve_image_reference('docker://registry.access.redhat.com/rhdh/plugin:v1.0')
        assert result == 'docker://quay.io/rhdh/plugin:v1.0'

    def test_rhdh_no_protocol_falls_back_to_quay(self, mocker, capsys):
        """Test fallback works without protocol prefix."""
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')
        mocker.patch('subprocess.run', side_effect=install_dynamic_plugins.subprocess.CalledProcessError(1, 'skopeo'))

        result = install_dynamic_plugins.resolve_image_reference('registry.access.redhat.com/rhdh/plugin:v1.0')
        assert result == 'quay.io/rhdh/plugin:v1.0'

    def test_rhdh_with_digest_falls_back_to_quay(self, mocker, capsys):
        """Test fallback works with image digest format."""
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')
        mocker.patch('subprocess.run', side_effect=install_dynamic_plugins.subprocess.CalledProcessError(1, 'skopeo'))

        result = install_dynamic_plugins.resolve_image_reference('oci://registry.access.redhat.com/rhdh/plugin@sha256:abc123')
        assert result == 'oci://quay.io/rhdh/plugin@sha256:abc123'

    def test_rhdh_with_path_falls_back_preserving_path(self, mocker, capsys):
        """Test fallback preserves full path after rhdh/."""
        mocker.patch('shutil.which', return_value='/usr/bin/skopeo')
        mocker.patch('subprocess.run', side_effect=install_dynamic_plugins.subprocess.CalledProcessError(1, 'skopeo'))

        result = install_dynamic_plugins.resolve_image_reference('oci://registry.access.redhat.com/rhdh/catalog/plugin-name:v2.0')
        assert result == 'oci://quay.io/rhdh/catalog/plugin-name:v2.0'


if __name__ == '__main__':
    pytest.main([__file__, '-v'])

