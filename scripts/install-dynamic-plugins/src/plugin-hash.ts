import { createHash } from 'node:crypto';
import { statSync, existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { type Plugin } from './types.js';

/**
 * Compute the config-hash for a plugin, used to detect "already installed".
 *
 * For remote packages the hash covers the plugin config sans `pluginConfig`,
 * `version` and `_level`. For local packages we additionally include
 * `package.json` contents and lock-file mtimes, so a local edit triggers a
 * reinstall even though the path string hasn't changed.
 */
export function computePluginHash(plugin: Plugin): string {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(plugin)) {
    if (k === 'pluginConfig' || k === 'version' || k === '_level' || k === 'plugin_hash') continue;
    copy[k] = v;
  }
  if (plugin.package.startsWith('./')) {
    copy['_local'] = localPackageInfo(plugin.package);
  }
  const serialized = stableStringify(copy);
  return createHash('sha256').update(serialized).digest('hex');
}

type LocalPackageInfo = {
  _pj?: unknown;
  _pj_mtime?: number;
  _mtime?: number;
  _missing?: boolean;
  _err?: string;
  [key: string]: unknown;
};

function localPackageInfo(pkgPath: string): LocalPackageInfo {
  const absPath = path.isAbsolute(pkgPath) ? pkgPath : path.join(process.cwd(), pkgPath.slice(2));
  const pj = path.join(absPath, 'package.json');
  if (!existsSync(pj)) {
    try {
      return { _mtime: statSync(absPath).mtimeMs };
    } catch {
      return { _missing: true };
    }
  }
  try {
    const info: LocalPackageInfo = {
      _pj: JSON.parse(readFileSync(pj, 'utf8')),
      _pj_mtime: statSync(pj).mtimeMs,
    };
    for (const lockFile of ['package-lock.json', 'yarn.lock']) {
      const lockPath = path.join(absPath, lockFile);
      if (existsSync(lockPath)) {
        info[`_${lockFile}_mtime`] = statSync(lockPath).mtimeMs;
      }
    }
    return info;
  } catch (err) {
    return { _err: (err as Error).message };
  }
}

/**
 * Deterministic JSON stringification — keys sorted at every level. Uses an
 * explicit code-point comparator so the hash is locale-independent (the
 * default `.sort()` is lexicographic on UTF-16 code units which is what we
 * want; the explicit form silences Sonar's "provide a compare function" rule
 * without pulling in `String.localeCompare` which varies per-locale).
 */
function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .sort(compareCodePoint)
    .map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${entries.join(',')}}`;
}
