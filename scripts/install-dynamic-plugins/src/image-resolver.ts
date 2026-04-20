import { log } from './log.js';
import { type Skopeo } from './skopeo.js';
import { DOCKER_PROTO, OCI_PROTO, RHDH_FALLBACK, RHDH_REGISTRY } from './types.js';

/**
 * Resolve a (possibly oci:// / docker://) image reference. If it points at
 * `registry.access.redhat.com/rhdh/...` and that registry rejects the image,
 * fall back to `quay.io/rhdh/...` (same protocol). Mirrors fast.py `resolve_image`.
 */
export async function resolveImage(skopeo: Skopeo, image: string): Promise<string> {
  const { proto, raw } = stripProto(image);
  if (!raw.startsWith(RHDH_REGISTRY)) return image;

  const dockerUrl = `${DOCKER_PROTO}${raw}`;
  if (await skopeo.exists(dockerUrl)) return image;

  const fallback = raw.replace(RHDH_REGISTRY, RHDH_FALLBACK);
  log(`\t==> Falling back to ${RHDH_FALLBACK} for ${raw}`);
  return `${proto}${fallback}`;
}

function stripProto(image: string): { proto: string; raw: string } {
  if (image.startsWith(OCI_PROTO)) return { proto: OCI_PROTO, raw: image.slice(OCI_PROTO.length) };
  if (image.startsWith(DOCKER_PROTO))
    return { proto: DOCKER_PROTO, raw: image.slice(DOCKER_PROTO.length) };
  return { proto: '', raw: image };
}
