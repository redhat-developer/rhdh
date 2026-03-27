#!/usr/bin/env node
/**
 * Parses NPM plugin keys (strip version, local paths, etc.).
 */
'use strict';

const NPM_ALIAS_PATTERN = /^([^@]+)@npm:((?:@[^/]+\/)?)([^@]+)(?:@(.+))?$/;

const GIT_URL_PATTERNS = [
  /^git\+https?:\/\/[^#]+(?:#(.+))?$/,
  /^git\+ssh:\/\/[^#]+(?:#(.+))?$/,
  /^git:\/\/[^#]+(?:#(.+))?$/,
  /^https:\/\/github\.com\/[^/]+\/[^/#]+(?:\.git)?(?:#(.+))?$/,
  /^git@github\.com:[^/]+\/[^/#]+(?:\.git)?(?:#(.+))?$/,
  /^github:([^/@]+)\/([^/#]+)(?:#(.+))?$/,
  /^([^/@]+)\/([^/#]+)(?:#(.+))?$/
];

function stripNpmPackageVersion(package_) {
  const m = package_.match(/^(@[^/]+\/)?([^@]+)(?:@(.+))?$/);
  if (m) {
    const scope = m[1] || '';
    const pkgName = m[2];
    return `${scope}${pkgName}`;
  }
  return package_;
}

function parsePluginKey(package_) {
  if (typeof package_ !== 'string') return '';
  if (package_.startsWith('./')) return package_;
  if (package_.endsWith('.tgz')) return package_;

  const aliasMatch = package_.match(NPM_ALIAS_PATTERN);
  if (aliasMatch) {
    const aliasName = aliasMatch[1];
    const packageScope = aliasMatch[2] || '';
    const npmPackage = aliasMatch[3];
    const npmKey = stripNpmPackageVersion(packageScope + npmPackage);
    return `${aliasName}@npm:${npmKey}`;
  }

  for (const pat of GIT_URL_PATTERNS) {
    if (pat.test(package_)) {
      return package_.split('#')[0];
    }
  }

  return stripNpmPackageVersion(package_);
}

const input = process.argv[2];
if (input === undefined) {
  console.error('usage: npm-parse-plugin-key.cjs <package>');
  process.exit(2);
}
console.log(parsePluginKey(input));
