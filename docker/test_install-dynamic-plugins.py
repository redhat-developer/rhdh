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


class TestPluginInstallerShouldSkipInstallation:
    """Test cases for PluginInstaller.should_skip_installation() method."""
    
    def test_plugin_not_installed_returns_false(self, tmp_path):
        """Test that plugin not in hash dict returns False."""
        plugin = {'hash': 'abc123', 'package': 'test-pkg'}
        plugin_path_by_hash = {}  # Empty - nothing installed
        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path))
        
        should_skip, reason = installer.should_skip_installation(plugin, plugin_path_by_hash)
        
        assert should_skip is False
        assert reason == "not_installed"
    
    def test_plugin_installed_if_not_present_skips(self, tmp_path):
        """Test that installed plugin with IF_NOT_PRESENT policy skips."""
        plugin = {
            'hash': 'abc123',
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
            'hash': 'abc123',
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
            'hash': 'abc123',
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
        plugin = {'hash': 'abc123', 'package': 'test-pkg'}  # No pullPolicy
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
            'hash': 'abc123',
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
            'hash': 'abc123',
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
            'hash': 'abc123',
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
            'hash': 'abc123',
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
            install_dynamic_plugins.verify_package_integrity(plugin, "dummy-archive.tgz", str(tmp_path))
        assert 'must be a string' in str(exc_info.value)

    def test_invalid_integrity_hash_format_raises_exception(self, tmp_path, mocker):
        """Test that invalid integrity hash (not of form <algorithm>-<hash>) raises exception."""
        plugin = {'package': 'test-package@1.0.0', 'integrity': 'invalidhash'}

        with pytest.raises(InstallException) as exc_info:
            install_dynamic_plugins.verify_package_integrity(plugin, "dummy-archive.tgz", str(tmp_path))
        assert 'must be a string of the form' in str(exc_info.value)

    def test_invalid_integrity_algorithm_raises_exception(self, tmp_path, mocker):
        """Test that unrecognized integrity algorithm raises exception."""
        plugin = {'package': 'test-package@1.0.0', 'integrity': 'invalidalgo-1234567890abcdef'}
        
        with pytest.raises(InstallException) as exc_info:
            install_dynamic_plugins.verify_package_integrity(plugin, "dummy-archive.tgz", str(tmp_path))
        assert 'is not supported' in str(exc_info.value)

    def test_invalid_integrity_hash_base64_encoding_raises_exception(self, tmp_path, mocker):
        """Test invalid base64 encoding in hash triggers exception."""
        plugin = {'package': 'test-package@1.0.0', 'integrity': 'sha256-not@base64!'}
        
        with pytest.raises(InstallException) as exc_info:
            install_dynamic_plugins.verify_package_integrity(plugin, "dummy-archive.tgz", str(tmp_path))
        assert 'is not a valid base64 encoding' in str(exc_info.value)

    def test_integrity_hash_mismatch_raises_exception(self, tmp_path, mocker):
        """Test hash verification fails when computed hash does not match."""
        # Valid algorithm and fake base64, but simulated mismatch
        import base64
        plugin = {'package': 'test-package@1.0.0', 'integrity': 'sha256-' + base64.b64encode(b'wronghash').decode()}

        with pytest.raises(InstallException) as exc_info:
            install_dynamic_plugins.verify_package_integrity(plugin, "dummy-archive.tgz", str(tmp_path))
        assert 'does not match the provided integrity hash' in str(exc_info.value)
    def test_skip_integrity_check_flag_works(self, tmp_path, mocker):
        """Test that skip_integrity_check flag bypasses integrity check."""
        plugin = {'package': 'test-package@1.0.0'}  # No integrity
        plugin_path_by_hash = {}
        
        # Mock npm pack
        mock_result = mocker.MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = b'test-package-1.0.0.tgz'
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
        with tarfile.open(tarball_path, "w:gz") as tar:
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
        install_dynamic_plugins.verify_package_integrity(plugin, str(tarball_path), str(tmp_path))
        
        # Test verification fails with wrong hash (valid base64 but wrong hash)
        plugin_wrong = {
            'package': 'test-package',
            'integrity': 'sha256-YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2'
        }
        
        with pytest.raises(InstallException) as exc_info:
            install_dynamic_plugins.verify_package_integrity(plugin_wrong, str(tarball_path), str(tmp_path))
        
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
        with tarfile.open(tarball_path, "w:gz") as tar:
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
        with tarfile.open(tarball_path, "w:gz") as tar:
            tar.add(package_dir / "huge-file.bin", arcname="package/huge-file.bin")
        
        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path))
        
        with pytest.raises(InstallException) as exc_info:
            installer._extract_npm_package(str(tarball_path))
        
        assert 'Zip bomb' in str(exc_info.value)
    
    @pytest.mark.integration
    def test_path_traversal_protection_real_tarball(self, tmp_path):
        """Test that extraction rejects tarballs with path traversal."""
        import tarfile
        import io
        
        # Create tarball with path traversal attempt
        tarball_path = tmp_path / "malicious.tgz"
        with tarfile.open(tarball_path, "w:gz") as tar:
            # Create a TarInfo with malicious path
            info = tarfile.TarInfo(name="../../../etc/passwd")
            info.size = 10
            tar.addfile(info, io.BytesIO(b"malicious!"))
        
        installer = install_dynamic_plugins.NpmPluginInstaller(str(tmp_path))
        
        with pytest.raises(InstallException) as exc_info:
            installer._extract_npm_package(str(tarball_path))
        
        assert 'does not start with' in str(exc_info.value)
    
    @pytest.mark.integration
    @pytest.mark.slow
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

if __name__ == '__main__':
    pytest.main([__file__, '-v'])

