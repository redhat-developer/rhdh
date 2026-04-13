import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as tar from 'tar';
import { InstallException } from './errors.js';
import { log } from './log.js';
import { resolveImage } from './image-resolver.js';
import { type Skopeo } from './skopeo.js';
import { DOCKER_PROTO, DPDY_FILENAME, MAX_ENTRY_SIZE, OCI_PROTO } from './types.js';
import { fileExists, isAllowedEntryType, isInside } from './util.js';

type OciManifest = {
  layers?: Array<{ digest: string }>;
};

/**
 * Extract the plugin catalog index OCI image (when `CATALOG_INDEX_IMAGE` is
 * set). Produces:
 *   - `<mountDir>/.catalog-index-temp/dynamic-plugins.default.yaml`
 *   - `<entitiesDir>/catalog-entities/` (if present in the image)
 *
 * Returns the absolute path to the extracted `dynamic-plugins.default.yaml`,
 * which the caller will substitute into `includes[]`.
 */
export async function extractCatalogIndex(
  skopeo: Skopeo,
  image: string,
  mountDir: string,
  entitiesDir: string,
): Promise<string> {
  log(`\n======= Extracting catalog index from ${image}`);
  const resolved = await resolveImage(skopeo, image);
  const tempDir = path.join(mountDir, '.catalog-index-temp');
  await fs.mkdir(tempDir, { recursive: true });
  const tempDirAbs = path.resolve(tempDir);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rhdh-catalog-index-'));
  try {
    const url = resolved.startsWith(DOCKER_PROTO)
      ? resolved
      : `${DOCKER_PROTO}${resolved.replace(OCI_PROTO, '')}`;
    const localDir = path.join(workDir, 'idx');
    log('\t==> Downloading catalog index image');
    await skopeo.copy(url, `dir:${localDir}`);

    const manifest = JSON.parse(
      await fs.readFile(path.join(localDir, 'manifest.json'), 'utf8'),
    ) as OciManifest;
    const layers = manifest.layers ?? [];

    let pending: InstallException | null = null;
    for (const layer of layers) {
      if (pending) break;
      const digest = layer.digest;
      if (!digest) continue;
      const [, fname] = digest.split(':');
      if (!fname) continue;
      const layerPath = path.join(localDir, fname);
      if (!(await fileExists(layerPath))) continue;

      await tar.x({
        file: layerPath,
        cwd: tempDirAbs,
        preservePaths: false,
        filter: (filePath, entry) => {
          if (pending) return false;
          const stat = entry as tar.ReadEntry;

          if (stat.size > MAX_ENTRY_SIZE) {
            pending = new InstallException(`Zip bomb detected in ${filePath}`);
            return false;
          }

          if (stat.type === 'SymbolicLink' || stat.type === 'Link') {
            const linkTarget = path.resolve(tempDirAbs, stat.linkpath ?? '');
            if (!isInside(linkTarget, tempDirAbs)) return false;
          }

          // Reject any entry that would resolve outside tempDirAbs.
          const memberPath = path.resolve(tempDirAbs, filePath);
          if (!isInside(memberPath, tempDirAbs)) return false;

          return isAllowedEntryType(stat.type);
        },
      });
    }
    if (pending) throw pending;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }

  const dpdy = path.join(tempDir, DPDY_FILENAME);
  if (!(await fileExists(dpdy))) {
    throw new InstallException(`dynamic-plugins.default.yaml not found in ${image}`);
  }
  log('\t==> Extracted dynamic-plugins.default.yaml');

  // Also surface catalog entities if present.
  for (const sub of ['catalog-entities/extensions', 'catalog-entities/marketplace']) {
    const src = path.join(tempDir, sub);
    if (await fileExists(src)) {
      await fs.mkdir(entitiesDir, { recursive: true });
      const dst = path.join(entitiesDir, 'catalog-entities');
      await fs.rm(dst, { recursive: true, force: true });
      await copyDir(src, dst);
      log(`\t==> Extracted catalog entities from ${sub}`);
      break;
    }
  }
  return dpdy;
}

export async function cleanupCatalogIndexTemp(mountDir: string): Promise<void> {
  await fs.rm(path.join(mountDir, '.catalog-index-temp'), {
    recursive: true,
    force: true,
  });
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else if (entry.isFile()) {
      await fs.copyFile(s, d);
    }
  }
}
