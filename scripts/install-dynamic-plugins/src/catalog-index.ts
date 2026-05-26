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
  const tempDir = path.join(mountDir, '.catalog-index-temp');
  await fs.mkdir(tempDir, { recursive: true });
  const tempDirAbs = path.resolve(tempDir);

  await extractCatalogIndexLayers(skopeo, image, tempDirAbs);

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

/**
 * Pull an OCI image with `skopeo copy` and untar every layer into `destDirAbs`.
 * Shared by the primary `extractCatalogIndex` and the per-image
 * `extractExtraCatalogIndex` flows. Applies the same security filter as
 * `extractCatalogIndex` (per-entry size cap, path-traversal rejection,
 * link-target containment, allowed-type whitelist).
 */
export async function extractCatalogIndexLayers(
  skopeo: Skopeo,
  image: string,
  destDirAbs: string,
): Promise<void> {
  const resolved = await resolveImage(skopeo, image);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rhdh-catalog-index-'));
  try {
    const url = resolved.startsWith(DOCKER_PROTO)
      ? resolved
      : `${DOCKER_PROTO}${resolved.replace(OCI_PROTO, '')}`;
    const localDir = path.join(workDir, 'idx');
    log('\t==> Downloading catalog index image');
    await skopeo.copy(url, `dir:${localDir}`);

    const manifestPath = path.join(localDir, 'manifest.json');
    if (!(await fileExists(manifestPath))) {
      throw new InstallException(`manifest.json not found in catalog index image ${image}`);
    }

    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as OciManifest;
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
        cwd: destDirAbs,
        preservePaths: false,
        filter: (filePath, entry) => {
          if (pending) return false;
          const stat = entry as tar.ReadEntry;

          if (stat.size > MAX_ENTRY_SIZE) {
            pending = new InstallException(`Zip bomb detected in ${filePath}`);
            return false;
          }

          if (stat.type === 'SymbolicLink' || stat.type === 'Link') {
            const linkTarget = path.resolve(destDirAbs, stat.linkpath ?? '');
            if (!isInside(linkTarget, destDirAbs)) return false;
          }

          // Reject any entry that would resolve outside destDirAbs.
          const memberPath = path.resolve(destDirAbs, filePath);
          if (!isInside(memberPath, destDirAbs)) return false;

          return isAllowedEntryType(stat.type);
        },
      });
    }
    if (pending) throw pending;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Extract an extra catalog index image (driven by `EXTRA_CATALOG_INDEX_IMAGES`).
 * Unlike `extractCatalogIndex`, this does NOT require a
 * `dynamic-plugins.default.yaml` — extra images contribute catalog entities
 * for the Extensions UI only.
 *
 * Writes catalog entities to `<parentDir>/<subdirectory>/catalog-entities`,
 * overwriting any prior content at that path. When the source image carries
 * neither `catalog-entities/extensions/` nor `catalog-entities/marketplace/`,
 * a warning is logged and the function returns without throwing.
 *
 * `previouslyUsedBy` should be the image ref that previously mapped to this
 * subdirectory name in the same `EXTRA_CATALOG_INDEX_IMAGES` invocation;
 * pass `null` on first use. When non-null, an overwrite warning is logged
 * AFTER the extraction header (matches the Python fix-up commit ordering).
 */
export async function extractExtraCatalogIndex(
  skopeo: Skopeo,
  image: string,
  subdirectory: string,
  parentDir: string,
  previouslyUsedBy: string | null,
): Promise<void> {
  if (!isSafeSubdirectoryName(subdirectory)) {
    throw new InstallException(
      `Refusing to extract extra catalog index into unsafe subdirectory '${subdirectory}'`,
    );
  }
  log(`\n======= Extracting extra catalog index '${subdirectory}' from ${image}`);
  if (previouslyUsedBy) {
    log(
      `\t==> WARNING: Subdirectory '${subdirectory}' was already used by '${previouslyUsedBy}'. ` +
        `The previous extraction will be overwritten.`,
    );
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rhdh-extra-catalog-index-'));
  try {
    const extractedDir = path.join(workDir, 'extracted');
    await fs.mkdir(extractedDir, { recursive: true });
    await extractCatalogIndexLayers(skopeo, image, extractedDir);

    const subdirParent = path.join(parentDir, subdirectory);
    log(`\t==> Extracting extensions catalog entities to ${subdirParent}`);

    let sourceDir: string | null = null;
    for (const sub of ['catalog-entities/extensions', 'catalog-entities/marketplace']) {
      const candidate = path.join(extractedDir, sub);
      if (await fileExists(candidate)) {
        sourceDir = candidate;
        break;
      }
    }

    if (!sourceDir) {
      log(
        `\t==> WARNING: Extra catalog index image ${image} does not have neither ` +
          `'catalog-entities/extensions/' nor 'catalog-entities/marketplace/' directory`,
      );
      return;
    }

    await fs.mkdir(subdirParent, { recursive: true });
    const dst = path.join(subdirParent, 'catalog-entities');
    await fs.rm(dst, { recursive: true, force: true });
    await copyDir(sourceDir, dst);
    log(
      `\t==> Successfully extracted extensions catalog entities from extra index image to ${subdirParent}`,
    );
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Convert an OCI image reference to a filesystem-safe subdirectory name by
 * replacing `/`, `:`, and `@` with `_`. Matches the Python
 * `image_ref_to_subdirectory` helper so the on-disk layout is identical
 * between the two implementations.
 */
export function imageRefToSubdirectory(imageRef: string): string {
  return imageRef.replaceAll(/[/:@]/g, '_');
}

/**
 * Parse the `EXTRA_CATALOG_INDEX_IMAGES` env var. Each comma-separated entry
 * is either a plain image reference (subdirectory auto-derived via
 * `imageRefToSubdirectory`) or `<name>=<image_ref>` (explicit subdirectory
 * name). Empty entries and empty image_refs are skipped with a warning —
 * the caller still consumes the rest of the list.
 */
export function parseExtraCatalogIndexImages(raw: string): Array<[name: string, imageRef: string]> {
  const out: Array<[string, string]> = [];
  for (const rawEntry of raw.split(',')) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    let name: string;
    let imageRef: string;
    const eq = entry.indexOf('=');
    if (eq === -1) {
      imageRef = entry;
      name = imageRefToSubdirectory(imageRef);
    } else {
      name = entry.slice(0, eq).trim();
      imageRef = entry.slice(eq + 1).trim();
    }
    if (!imageRef) {
      log(`WARNING: Skipping EXTRA_CATALOG_INDEX_IMAGES entry with empty image reference: '${entry}'`);
      continue;
    }
    if (!isSafeSubdirectoryName(name)) {
      log(
        `WARNING: Skipping EXTRA_CATALOG_INDEX_IMAGES entry with unsafe subdirectory name '${name}' in '${entry}'. ` +
          `Names must be non-empty and must not contain '/', '\\\\', or '..'.`,
      );
      continue;
    }
    out.push([name, imageRef]);
  }
  return out;
}

/**
 * Reject subdirectory names that are empty or could escape `<parentDir>` once
 * passed to `path.join` (path separators or `..` segments). Mirrors the
 * defensive check applied to plugin paths during tar extraction.
 */
function isSafeSubdirectoryName(name: string): boolean {
  if (!name || name === '.' || name === '..') return false;
  return !/[/\\]/.test(name);
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
