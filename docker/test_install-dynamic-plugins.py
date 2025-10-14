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

Installation:
    To install test dependencies:
    $ pip install -r requirements-dev.in

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


if __name__ == '__main__':
    pytest.main([__file__, '-v'])

