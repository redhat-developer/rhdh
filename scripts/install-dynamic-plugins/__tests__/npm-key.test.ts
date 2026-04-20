import { npmPluginKey } from '../src/npm-key';

describe('npmPluginKey', () => {
  const cases: Array<[string, string]> = [
    // Standard NPM packages with version stripping
    ['@npmcli/arborist@latest', '@npmcli/arborist'],
    ['@backstage/plugin-catalog@1.0.0', '@backstage/plugin-catalog'],
    ['semver@7.2.2', 'semver'],
    ['package-name@^1.0.0', 'package-name'],
    ['package-name@~2.1.0', 'package-name'],
    ['package-name@1.x', 'package-name'],

    // Packages without version
    ['package-name', 'package-name'],
    ['@scope/package', '@scope/package'],

    // NPM aliases
    ['semver:@npm:semver@7.2.2', 'semver:@npm:semver'],
    ['my-alias@npm:@npmcli/semver-with-patch', 'my-alias@npm:@npmcli/semver-with-patch'],
    ['semver:@npm:@npmcli/semver-with-patch@1.0.0', 'semver:@npm:@npmcli/semver-with-patch'],
    ['alias@npm:package@1.0.0', 'alias@npm:package'],
    ['alias@npm:@scope/package@2.0.0', 'alias@npm:@scope/package'],

    // Git URLs with ref stripping
    ['npm/cli#c12ea07', 'npm/cli'],
    ['user/repo#main', 'user/repo'],
    ['github:user/repo#ref', 'github:user/repo'],
    ['git+https://github.com/user/repo.git#branch', 'git+https://github.com/user/repo.git'],
    ['git+https://github.com/user/repo#branch', 'git+https://github.com/user/repo'],
    ['git@github.com:user/repo.git#ref', 'git@github.com:user/repo.git'],
    ['git+ssh://git@github.com/user/repo.git#tag', 'git+ssh://git@github.com/user/repo.git'],
    ['git://github.com/user/repo#commit', 'git://github.com/user/repo'],
    ['https://github.com/user/repo.git#v1.0.0', 'https://github.com/user/repo.git'],

    // Local paths (unchanged)
    ['./my-local-plugin', './my-local-plugin'],
    ['./path/to/plugin', './path/to/plugin'],

    // Tarballs (unchanged)
    ['package.tgz', 'package.tgz'],
    ['my-package-1.0.0.tgz', 'my-package-1.0.0.tgz'],
    ['https://example.com/package.tgz', 'https://example.com/package.tgz'],
  ];

  it.each(cases)('parses %s -> %s', (input, expected) => {
    expect(npmPluginKey(input)).toBe(expected);
  });
});
