import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as tar from 'tar';
import { InstallException } from './errors.js';
import { log } from './log.js';
import { MAX_ENTRY_SIZE } from './types.js';

const PACKAGE_PREFIX = 'package/';

/**
 * Extract a slice of an OCI layer tarball into `destination/pluginPath`.
 *
 * Mirrors the Python `extract_oci_plugin` with the same security guards:
 *   - reject absolute or `..`-containing plugin paths
 *   - enforce per-entry size limit (MAX_ENTRY_SIZE) against zip bombs
 *   - skip sym/hard links whose targets would escape `destination`
 *   - reject device files / FIFOs (`tar` `filter` only emits regular types)
 *
 * Uses streaming via `node-tar` — no full-archive read into memory.
 */
export async function extractOciPlugin(
  tarball: string,
  pluginPath: string,
  destination: string,
): Promise<void> {
  assertSafePluginPath(pluginPath);

  const destAbs = path.resolve(destination);
  const pluginDir = path.join(destAbs, pluginPath);
  await fs.rm(pluginDir, { recursive: true, force: true });
  await fs.mkdir(destAbs, { recursive: true });

  // Boundary-safe path prefix — prevents `plugin-one` from matching sibling
  // directories with the same prefix (e.g., `plugin-one-evil/`).
  const pluginPathBoundary = pluginPath.endsWith('/') ? pluginPath : pluginPath + '/';

  // Errors thrown inside `tar` filter callbacks are sometimes swallowed by the
  // parser; capture them in a closure and re-throw after extraction completes.
  let pending: InstallException | null = null;

  await tar.x({
    file: tarball,
    cwd: destAbs,
    preservePaths: false,
    filter: (filePath, entry) => {
      if (pending) return false;
      const stat = entry as tar.ReadEntry;
      if (filePath !== pluginPath && !filePath.startsWith(pluginPathBoundary)) return false;

      if (stat.size > MAX_ENTRY_SIZE) {
        pending = new InstallException(`Zip bomb detected in ${filePath}`);
        return false;
      }
      if (stat.type === 'SymbolicLink' || stat.type === 'Link') {
        const linkName = stat.linkpath ?? '';
        const linkTarget = path.resolve(destAbs, linkName);
        if (!isInside(linkTarget, destAbs)) {
          log(
            `\t==> WARNING: skipping file containing link outside of the archive: ${filePath} -> ${linkName}`,
          );
          return false;
        }
      }
      if (!isAllowedEntryType(stat.type)) {
        pending = new InstallException(`Disallowed tar entry type ${stat.type} for ${filePath}`);
        return false;
      }
      return true;
    },
  });

  if (pending) throw pending;
}

/**
 * Extract an NPM tarball (`npm pack` output). Entries all start with `package/`
 * which is stripped. Matches `extract_npm_package` in fast.py, including the
 * realpath-based escape check for symlinks inside the archive.
 *
 * Returns the directory name (basename) the package was extracted into.
 */
export async function extractNpmPackage(archive: string): Promise<string> {
  if (!archive.endsWith('.tgz')) {
    throw new InstallException(`Expected .tgz archive, got ${archive}`);
  }
  const pkgDir = archive.slice(0, -'.tgz'.length);
  const pkgDirReal = path.resolve(pkgDir);
  await fs.rm(pkgDir, { recursive: true, force: true });
  await fs.mkdir(pkgDir, { recursive: true });

  let pending: InstallException | null = null;

  await tar.x({
    file: archive,
    cwd: pkgDir,
    preservePaths: false,
    filter: (filePath, entry) => {
      if (pending) return false;
      const stat = entry as tar.ReadEntry;
      if (stat.type === 'Directory') return false;

      if (stat.type === 'File') {
        if (!filePath.startsWith(PACKAGE_PREFIX)) {
          pending = new InstallException(
            `NPM package archive does not start with 'package/' as it should: ${filePath}`,
          );
          return false;
        }
        if (stat.size > MAX_ENTRY_SIZE) {
          pending = new InstallException(`Zip bomb detected in ${filePath}`);
          return false;
        }
        stat.path = filePath.slice(PACKAGE_PREFIX.length);
        return true;
      }

      if (stat.type === 'SymbolicLink' || stat.type === 'Link') {
        const linkPath = stat.linkpath ?? '';
        if (!linkPath.startsWith(PACKAGE_PREFIX)) {
          pending = new InstallException(
            `NPM package archive contains a link outside of the archive: ${filePath} -> ${linkPath}`,
          );
          return false;
        }
        stat.path = filePath.slice(PACKAGE_PREFIX.length);
        stat.linkpath = linkPath.slice(PACKAGE_PREFIX.length);
        const linkTarget = path.resolve(pkgDir, stat.linkpath);
        if (!isInside(linkTarget, pkgDirReal)) {
          pending = new InstallException(
            `NPM package archive contains a link outside of the archive: ${stat.path} -> ${stat.linkpath}`,
          );
          return false;
        }
        return true;
      }

      pending = new InstallException(
        `NPM package archive contains a non-regular file: ${filePath}`,
      );
      return false;
    },
  });

  if (pending) throw pending;

  await fs.rm(archive, { force: true });
  return path.basename(pkgDirReal);
}

function assertSafePluginPath(pluginPath: string): void {
  if (pluginPath.includes('..') || path.isAbsolute(pluginPath)) {
    throw new InstallException(`Invalid plugin path (path traversal detected): ${pluginPath}`);
  }
}

function isInside(childAbs: string, parentAbs: string): boolean {
  const normalizedParent = parentAbs.endsWith(path.sep) ? parentAbs : parentAbs + path.sep;
  return childAbs === parentAbs || childAbs.startsWith(normalizedParent);
}

function isAllowedEntryType(type: tar.ReadEntry['type']): boolean {
  // `tar` exposes these entry types — we allow the regular file/dir/link kinds
  // and reject anything exotic (CharacterDevice, BlockDevice, FIFO, etc.).
  return (
    type === 'File' ||
    type === 'Directory' ||
    type === 'SymbolicLink' ||
    type === 'Link' ||
    type === 'OldFile' ||
    type === 'ContiguousFile'
  );
}
