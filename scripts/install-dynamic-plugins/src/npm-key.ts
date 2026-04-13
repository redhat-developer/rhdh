/**
 * NPM package-spec parsing, matching install-dynamic-plugins.py
 * (`NPMPackageMerger.parse_plugin_key`).
 *
 * A "plugin key" is the package identifier with version/ref stripped, used
 * as the dedup key when merging plugins from multiple config files. Local
 * paths (`./...`) and tarball files (`*.tgz`) are returned unchanged —
 * there's no canonical version to strip.
 *
 * Spec reference: https://docs.npmjs.com/cli/v11/using-npm/package-spec
 */

// [@scope/]name[@version]
const NPM_PACKAGE_PATTERN = /^(@[^/]+\/)?([^@]+)(?:@(.+))?$/;
// alias@npm:[@scope/]name[@version]
const NPM_ALIAS_PATTERN = /^([^@]+)@npm:(@[^/]+\/)?([^@]+)(?:@(.+))?$/;
// user/repo
const GITHUB_SHORTHAND_PATTERN = /^([^/@]+)\/([^/#]+)(?:#(.+))?$/;

const GIT_URL_PATTERNS: RegExp[] = [
  /^git\+https?:\/\/[^#]+(?:#(.+))?$/,
  /^git\+ssh:\/\/[^#]+(?:#(.+))?$/,
  /^git:\/\/[^#]+(?:#(.+))?$/,
  /^https:\/\/github\.com\/[^/]+\/[^/#]+(?:\.git)?(?:#(.+))?$/,
  /^git@github\.com:[^/]+\/[^/#]+(?:\.git)?(?:#(.+))?$/,
  /^github:([^/@]+)\/([^/#]+)(?:#(.+))?$/,
];

export function npmPluginKey(pkg: string): string {
  // Local packages and tarballs have no version to strip.
  if (pkg.startsWith('./')) return pkg;
  if (pkg.endsWith('.tgz')) return pkg;

  // Aliases: "my-alias@npm:real-pkg@1.2.3" -> "my-alias@npm:real-pkg"
  const alias = NPM_ALIAS_PATTERN.exec(pkg);
  if (alias) {
    const [, aliasName, scope, name] = alias;
    return `${aliasName}@npm:${scope ?? ''}${name}`;
  }

  // Git URLs: strip `#ref` suffix (tries `git+https`, `git+ssh`, `git://`,
  // `https://github.com/...`, `git@github.com:...`, `github:user/repo`).
  for (const re of GIT_URL_PATTERNS) {
    if (re.test(pkg)) {
      const hash = pkg.indexOf('#');
      return hash >= 0 ? pkg.slice(0, hash) : pkg;
    }
  }

  // GitHub shorthand `user/repo#ref` — only match if there's no `://` or
  // leading `@` (those would be scoped packages).
  if (!pkg.includes('://') && !pkg.startsWith('@')) {
    const gh = GITHUB_SHORTHAND_PATTERN.exec(pkg);
    if (gh) {
      const hash = pkg.indexOf('#');
      return hash >= 0 ? pkg.slice(0, hash) : pkg;
    }
  }

  return stripStandardNpmVersion(pkg);
}

function stripStandardNpmVersion(pkg: string): string {
  const m = NPM_PACKAGE_PATTERN.exec(pkg);
  if (!m) return pkg;
  const [, scope, name] = m;
  return `${scope ?? ''}${name}`;
}
