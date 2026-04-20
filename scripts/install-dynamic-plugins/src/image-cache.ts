import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { InstallException } from './errors.js';
import { log } from './log.js';
import { resolveImage } from './image-resolver.js';
import { type Skopeo } from './skopeo.js';
import { DOCKER_PROTO, OCI_PROTO } from './types.js';

type OciManifest = {
  layers?: Array<{ digest: string }>;
  annotations?: Record<string, string>;
};

/**
 * Shared cache that keeps each OCI image's single-layer tarball on disk and
 * returns the path. If several plugins point at the same image (very common
 * for multi-plugin overlays) we download once and extract slices from that
 * same tarball.
 *
 * The cache stores *promises*, so concurrent `getTarball` calls for the same
 * image share the in-flight `skopeo copy` rather than racing. This is the
 * JS equivalent of fast.py's `threading.Lock` guard around the cache.
 */
export class OciImageCache {
  private readonly tarballs = new Map<string, Promise<string>>();

  constructor(
    private readonly skopeo: Skopeo,
    private readonly tmpDir: string,
  ) {}

  async getTarball(image: string): Promise<string> {
    const resolved = await resolveImage(this.skopeo, image);
    let pending = this.tarballs.get(resolved);
    if (!pending) {
      pending = this.downloadAndLocateTarball(resolved);
      this.tarballs.set(resolved, pending);
      pending.catch(() => this.tarballs.delete(resolved));
    }
    return pending;
  }

  async getDigest(image: string): Promise<string> {
    const resolved = await resolveImage(this.skopeo, image);
    const dockerUrl = resolved.replace(OCI_PROTO, DOCKER_PROTO);
    const data = await this.skopeo.inspect(dockerUrl);
    const digest = data.Digest;
    if (!digest) throw new InstallException(`No digest returned for ${image}`);
    const [, hash] = digest.split(':');
    if (!hash) throw new InstallException(`Malformed digest ${digest} for ${image}`);
    return hash;
  }

  /**
   * Plugin paths are published via the `io.backstage.dynamic-packages` OCI
   * annotation (base64-encoded JSON array of `{path: {...}}` objects). An
   * image with no annotation returns an empty list.
   */
  async getPluginPaths(image: string): Promise<string[]> {
    const resolved = await resolveImage(this.skopeo, image);
    const dockerUrl = resolved.replace(OCI_PROTO, DOCKER_PROTO);
    const manifest = (await this.skopeo.inspectRaw(dockerUrl)) as OciManifest;
    const annotation = manifest.annotations?.['io.backstage.dynamic-packages'];
    if (!annotation) return [];
    const decoded = Buffer.from(annotation, 'base64').toString('utf8');
    const entries = JSON.parse(decoded) as unknown;
    if (!Array.isArray(entries)) return [];
    const paths: string[] = [];
    for (const entry of entries) {
      if (entry && typeof entry === 'object') {
        paths.push(...Object.keys(entry as Record<string, unknown>));
      }
    }
    return paths;
  }

  private async downloadAndLocateTarball(resolved: string): Promise<string> {
    const digest = createHash('sha256').update(resolved).digest('hex');
    const localDir = path.join(this.tmpDir, digest);
    await fs.mkdir(localDir, { recursive: true });
    const dockerUrl = resolved.replace(OCI_PROTO, DOCKER_PROTO);
    log(`\t==> Downloading ${resolved}`);
    await this.skopeo.copy(dockerUrl, `dir:${localDir}`);

    const manifestPath = path.join(localDir, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as OciManifest;
    const firstLayer = manifest.layers?.[0]?.digest;
    if (!firstLayer) {
      throw new InstallException(`OCI manifest for ${resolved} has no layers`);
    }
    const [, filename] = firstLayer.split(':');
    if (!filename) {
      throw new InstallException(`Malformed layer digest ${firstLayer} in ${resolved}`);
    }
    return path.join(localDir, filename);
  }
}
