import { createHash } from 'node:crypto';
import { statSync, existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { type Plugin } from './types.js';

/**
 * Compute the config-hash for a plugin, used to detect "already installed".
 *
 * The hash is byte-compatible with the Python implementation
 * (`install-dynamic-plugins.py`): both versions
 *   - strip `pluginConfig` and `version` before hashing,
 *   - keep `last_modified_level` (the include-file precedence) inside the hash,
 *   - serialize via stable, sort-keyed JSON,
 *   - and use the same field names for local-package metadata
 *     (`_local_package_info`, `_package_json`, `_package_json_mtime`,
 *     `_directory_mtime`, `_not_found`, `_error`, `_<lockfile>_mtime`).
 *
 * Cross-compat matters because an in-place upgrade from the Python script
 * to this TS port should not trigger a full reinstall of every plugin on
 * the first run.
 */
export function computePluginHash(plugin: Plugin): string {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(plugin)) {
    if (k === 'pluginConfig' || k === 'version' || k === 'plugin_hash') continue;
    copy[k] = v;
  }
  if (plugin.package.startsWith('./')) {
    copy['_local_package_info'] = localPackageInfo(plugin.package);
  }
  const serialized = stableStringify(copy);
  return createHash('sha256').update(serialized).digest('hex');
}

type LocalPackageInfo = {
  _package_json?: unknown;
  _package_json_mtime?: number;
  _directory_mtime?: number;
  _not_found?: boolean;
  _error?: string;
  [key: string]: unknown;
};

/**
 * Inspect a local package path and return the metadata included in the
 * install hash. Field names and value formats match the Python helper
 * `get_local_package_info` so the resulting hash is identical.
 *
 * Mtime is stored in seconds-since-epoch as a float — Python's
 * `os.path.getmtime` returns float seconds, so we divide Node's
 * millisecond value by 1000.
 */
function localPackageInfo(pkgPath: string): LocalPackageInfo {
  const absPath = path.isAbsolute(pkgPath) ? pkgPath : path.join(process.cwd(), pkgPath.slice(2));
  const pj = path.join(absPath, 'package.json');
  if (!existsSync(pj)) {
    try {
      return { _directory_mtime: toSeconds(statSync(absPath).mtimeMs) };
    } catch {
      return { _not_found: true };
    }
  }
  try {
    const info: LocalPackageInfo = {
      _package_json: JSON.parse(readFileSync(pj, 'utf8')),
      _package_json_mtime: toSeconds(statSync(pj).mtimeMs),
    };
    for (const lockFile of ['package-lock.json', 'yarn.lock']) {
      const lockPath = path.join(absPath, lockFile);
      if (existsSync(lockPath)) {
        info[`_${lockFile}_mtime`] = toSeconds(statSync(lockPath).mtimeMs);
      }
    }
    return info;
  } catch (err) {
    return { _error: (err as Error).message };
  }
}

function toSeconds(mtimeMs: number): number {
  return mtimeMs / 1000;
}

/**
 * Deterministic JSON stringification — sorts keys at every level and emits
 * Python-style separators (`, ` between elements, `: ` between key/value)
 * so the resulting string is byte-identical to Python's
 * `json.dumps(..., sort_keys=True)`. Required for hash compatibility with
 * the previous Python implementation.
 *
 * Uses an explicit code-point comparator (locale-independent, matches
 * Python's default `sorted()` ordering on str keys).
 */
function compareCodePoint(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(', ')}]`;
  }
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .sort(compareCodePoint)
    .map(k => `${JSON.stringify(k)}: ${stableStringify(obj[k])}`);
  return `{${entries.join(', ')}}`;
}
