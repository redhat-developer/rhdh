/**
 * OCI registry HTTP API v2 (fetch-based; mirrors bash + curl behavior).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join as pathJoin } from 'node:path';
import { parseOciRef } from './oci-ref.js';

const DOCKER_PROTOCOL_PREFIX = 'docker://';
export const RHDH_REGISTRY_PREFIX = 'registry.access.redhat.com/rhdh/';
const RHDH_FALLBACK_PREFIX = 'quay.io/rhdh/';

const ACCEPT_HEADERS = [
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json'
];

function buildAcceptHeader(): string {
  return ACCEPT_HEADERS.join(', ');
}

export interface RegistryNormalize {
  registry: string;
  repository: string;
}

export function registryNormalize(reg: string, repo: string): RegistryNormalize {
  let r = reg;
  let p = repo;
  if (r === 'docker.io') {
    r = 'registry-1.docker.io';
    if (!p.includes('/')) {
      p = `library/${p}`;
    }
  }
  return { registry: r, repository: p };
}

function parseAuthLine(line: string): { realm: string; service: string; scope: string } {
  let realm = '';
  let service = '';
  let scope = '';
  const rm = line.match(/realm="([^"]+)"/);
  const sm = line.match(/service="([^"]+)"/);
  const scm = line.match(/scope="([^"]+)"/);
  if (rm) {
    realm = rm[1]!;
  }
  if (sm) {
    service = sm[1]!;
  }
  if (scm) {
    scope = scm[1]!;
  }
  return { realm, service, scope };
}

export function registryUrl(
  reg: string,
  repo: string,
  kind: 'manifests' | 'blobs',
  ref: string
): string {
  const { registry, repository } = registryNormalize(reg, repo);
  const rpath = encodeURIComponent(repository).replace(/%2F/g, '/');
  const base = `https://${registry}`;
  if (kind === 'manifests') {
    return `${base}/v2/${rpath}/manifests/${ref}`;
  }
  return `${base}/v2/${rpath}/blobs/${ref}`;
}

async function registryGetToken(
  realm: string,
  service: string,
  scope: string
): Promise<string> {
  const sep = realm.includes('?') ? '&' : '?';
  const u = `${realm}${sep}service=${encodeURIComponent(service)}&scope=${encodeURIComponent(scope)}`;
  const res = await fetch(u);
  if (!res.ok) {
    return '';
  }
  const j = (await res.json()) as { token?: string; access_token?: string };
  return j.token || j.access_token || '';
}

async function registryGet(
  url: string,
  outPath: string | null,
  tok?: string
): Promise<{ status: number; digest: string }> {
  const doFetch = async (authorization?: string) => {
    const headers = new Headers();
    headers.set('Accept', buildAcceptHeader());
    if (authorization) {
      headers.set('Authorization', authorization);
    }
    return fetch(url, { headers, redirect: 'follow' });
  };

  let res = await doFetch(tok ? `Bearer ${tok}` : undefined);
  let digest = (res.headers.get('docker-content-digest') || '').trim();

  if (res.status === 401 && !tok) {
    await res.arrayBuffer().catch(() => undefined);
    const www = res.headers.get('www-authenticate');
    if (!www) {
      return { status: 401, digest: '' };
    }
    const line = www.trim();
    const { realm, service, scope } = parseAuthLine(line);
    if (!realm) {
      return { status: 401, digest: '' };
    }
    const newTok = await registryGetToken(realm, service, scope);
    if (!newTok) {
      return { status: 401, digest: '' };
    }
    res = await doFetch(`Bearer ${newTok}`);
    digest = (res.headers.get('docker-content-digest') || '').trim();
  }

  if (outPath) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (outPath !== '/dev/null') {
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, buf);
    }
  } else {
    await res.arrayBuffer().catch(() => undefined);
  }

  return { status: res.status, digest };
}

export async function ociFetchManifestResolved(
  reg: string,
  repo: string,
  ref: string
): Promise<{ manifest: string; digest: string }> {
  const url = registryUrl(reg, repo, 'manifests', ref);
  const tmpd = await mkdtemp(pathJoin(tmpdir(), 'oci-mf-'));
  const bodyPath = pathJoin(tmpd, 'b');
  try {
    const { status, digest: d0 } = await registryGet(url, bodyPath);
    if (status !== 200) {
      throw new Error(`registry GET ${url} failed with HTTP ${status}`);
    }
    const body = await readFile(bodyPath, 'utf8');
    let manifestDigest = d0;
    const med = JSON.parse(body).mediaType as string | undefined;

    if (med && (med.includes('manifest.list') || med.includes('image.index'))) {
      const idx = JSON.parse(body) as {
        manifests?: Array<{
          platform?: { os?: string; architecture?: string };
          digest?: string;
        }>;
      };
      const dg = idx.manifests?.find(
        m => m.platform?.os === 'linux' && m.platform?.architecture === 'amd64'
      )?.digest;
      if (!dg) {
        throw new Error(`no linux/amd64 entry in manifest index for ${reg}/${repo}:${ref}`);
      }
      const url2 = registryUrl(reg, repo, 'manifests', dg);
      const tmpd2 = await mkdtemp(pathJoin(tmpdir(), 'oci-mf2-'));
      const bodyPath2 = pathJoin(tmpd2, 'b2');
      try {
        const { status: st2, digest: d2 } = await registryGet(url2, bodyPath2);
        if (st2 !== 200) {
          throw new Error(`registry GET manifest ${dg} failed HTTP ${st2}`);
        }
        const inner = await readFile(bodyPath2, 'utf8');
        manifestDigest = d2 || manifestDigest;
        return { manifest: inner, digest: manifestDigest };
      } finally {
        await rm(tmpd2, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    return { manifest: body, digest: manifestDigest };
  } finally {
    await rm(tmpd, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function ociFetchBlobToFile(
  reg: string,
  repo: string,
  digest: string,
  dest: string
): Promise<void> {
  const url = registryUrl(reg, repo, 'blobs', digest);
  const { status } = await registryGet(url, dest);
  if (status !== 200) {
    throw new Error(`blob download failed HTTP ${status} for ${digest}`);
  }
}

export async function resolveImageReferenceAsync(image: string): Promise<string> {
  let check = image;
  let prefix = '';
  if (check.startsWith('oci://')) {
    check = check.slice('oci://'.length);
    prefix = 'oci://';
  } else if (check.startsWith('docker://')) {
    check = check.slice('docker://'.length);
    prefix = 'docker://';
  }
  if (!check.startsWith(RHDH_REGISTRY_PREFIX)) {
    return image;
  }
  console.error(`\t==> Checking if image exists in ${RHDH_REGISTRY_PREFIX}`);
  const dockerUrl = `${DOCKER_PROTOCOL_PREFIX}${check}`;
  const exists = await imageExistsInRegistry(dockerUrl);
  if (exists) {
    console.error(`\t==> Image found in ${RHDH_REGISTRY_PREFIX}`);
    return image;
  }
  const fb = check.replace(RHDH_REGISTRY_PREFIX, RHDH_FALLBACK_PREFIX);
  console.error(
    `\t==> Image not found in ${RHDH_REGISTRY_PREFIX}, falling back to ${RHDH_FALLBACK_PREFIX}`
  );
  console.error(`\t==> Using fallback image: ${fb}`);
  return `${prefix}${fb}`;
}

async function imageExistsInRegistry(dockerUrl: string): Promise<boolean> {
  const img = dockerUrl.startsWith('docker://')
    ? dockerUrl.slice('docker://'.length)
    : dockerUrl;
  let reg: string;
  let repo: string;
  let ref: string;
  if (img.includes('@')) {
    reg = img.split('/')[0]!;
    const rest = img.slice(img.indexOf('/') + 1);
    repo = rest.split('@')[0]!;
    ref = rest.split('@')[1]!;
  } else {
    reg = img.split('/')[0]!;
    const rest = img.slice(img.indexOf('/') + 1);
    const ci = rest.indexOf(':');
    repo = rest.slice(0, ci);
    ref = rest.slice(ci + 1);
  }
  const url = registryUrl(reg, repo, 'manifests', ref);
  const tmpd = await mkdtemp(pathJoin(tmpdir(), 'oci-ie-'));
  const nullPath = pathJoin(tmpd, 'n');
  try {
    const { status } = await registryGet(url, nullPath);
    return status === 200;
  } finally {
    await rm(tmpd, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function getOciPluginPaths(image: string): Promise<string[]> {
  const resolved = await resolveImageReferenceAsync(image);
  const mj = parseOciRef(resolved);
  const { manifest } = await ociFetchManifestResolved(
    mj.registry,
    mj.repository,
    mj.reference
  );
  const ann = JSON.parse(manifest).annotations?.[
    'io.backstage.dynamic-packages'
  ] as string | undefined;
  if (!ann) {
    return [];
  }
  let dec: string;
  try {
    dec = Buffer.from(ann, 'base64').toString('utf8');
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(dec) as unknown[];
    const keys: string[] = [];
    for (const item of parsed) {
      if (item && typeof item === 'object') {
        keys.push(...Object.keys(item as object));
      }
    }
    return keys;
  } catch {
    return [];
  }
}

export async function ociImageDigestHex(image: string): Promise<string> {
  const resolved = await resolveImageReferenceAsync(image);
  const mj = parseOciRef(resolved);
  const { digest } = await ociFetchManifestResolved(mj.registry, mj.repository, mj.reference);
  const d = digest || '';
  if (!d) {
    throw new Error(`could not read manifest digest for ${image}`);
  }
  return d.startsWith('sha256:') ? d.slice('sha256:'.length) : d;
}

export async function ociCopyImageLayer0(image: string, outDir: string): Promise<void> {
  const resolved = await resolveImageReferenceAsync(image);
  console.error(`\t==> Copying image ${resolved} to local filesystem (registry API)`);
  const mj = parseOciRef(resolved);
  const { manifest } = await ociFetchManifestResolved(
    mj.registry,
    mj.repository,
    mj.reference
  );
  await mkdir(outDir, { recursive: true });
  await writeFile(pathJoin(outDir, 'manifest.json'), manifest);
  const man = JSON.parse(manifest) as { layers?: Array<{ digest?: string }> };
  const layer = man.layers?.[0]?.digest;
  if (!layer) {
    throw new Error(`OCI image has no layers: ${image}`);
  }
  const hashpart = layer.startsWith('sha256:') ? layer.slice('sha256:'.length) : layer;
  await ociFetchBlobToFile(mj.registry, mj.repository, layer, pathJoin(outDir, hashpart));
}
