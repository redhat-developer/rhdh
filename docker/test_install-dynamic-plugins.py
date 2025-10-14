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
        # Tag-based packages
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
        plugin_key, version, inherit_version = oci_merger.parse_plugin_key(input_package)
        
        assert plugin_key == expected_key, f"Expected key {expected_key}, got {plugin_key}"
        assert version == expected_version, f"Expected version {expected_version}, got {version}"
        assert inherit_version == expected_inherit, f"Expected inherit {expected_inherit}, got {inherit_version}"
    
    @pytest.mark.parametrize("invalid_package,error_substring", [
        # Missing ! separator
        ('oci://registry.io/plugin:v1.0', 'not in the expected format'),
        
        # Missing tag/digest
        ('oci://registry.io/plugin!path', 'not in the expected format'),
        
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
        
        # Empty path after !
        ('oci://registry.io/plugin:v1.0!', 'not in the expected format'),
        
        # No oci:// prefix (but this should fail the regex)
        ('registry.io/plugin:v1.0!plugin', 'not in the expected format'),
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
        plugin_key, version, inherit = oci_merger.parse_plugin_key(input_pkg)
        
        assert plugin_key == 'oci://registry.io/plugin:!plugin'
        assert version == 'sha256:abc123def456789'
        assert inherit is False
    
    def test_parse_plugin_key_strips_version_from_key(self, oci_merger):
        """Test that the plugin key does not contain version information."""
        input_pkg = 'oci://quay.io/user/plugin:v1.0.0!my-plugin'
        plugin_key, version, _ = oci_merger.parse_plugin_key(input_pkg)
        
        # The key should not contain the version
        assert ':v1.0.0' not in plugin_key
        assert plugin_key == 'oci://quay.io/user/plugin:!my-plugin'
        # But the version should be returned separately
        assert version == 'v1.0.0'
    
    def test_parse_plugin_key_with_nested_path(self, oci_merger):
        """Test parsing OCI package with nested path after !."""
        input_pkg = 'oci://registry.io/plugin:v1.0!path/to/nested/plugin'
        plugin_key, version, inherit = oci_merger.parse_plugin_key(input_pkg)
        
        assert plugin_key == 'oci://registry.io/plugin:!path/to/nested/plugin'
        assert version == 'v1.0'
        assert inherit is False


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
        plugin_key, version, inherit = merger.parse_plugin_key(input_pkg)
        
        assert plugin_key == 'oci://quay.io/user/plugin:!plugin'
        assert version == long_digest
        assert inherit is False


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


if __name__ == '__main__':
    pytest.main([__file__, '-v'])

