import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tar from 'tar';
import {
  extractExtraCatalogIndex,
  imageRefToSubdirectory,
  parseExtraCatalogIndexImages,
} from '../src/catalog-index';
import { Skopeo } from '../src/skopeo';

describe('imageRefToSubdirectory', () => {
  it('replaces /, :, and @ with _', () => {
    expect(imageRefToSubdirectory('quay.io/rhdh/plugin-catalog-index:1.10')).toBe(
      'quay.io_rhdh_plugin-catalog-index_1.10',
    );
    expect(imageRefToSubdirectory('quay.io/rhdh/index@sha256:abc123')).toBe(
      'quay.io_rhdh_index_sha256_abc123',
    );
  });

  it('returns the input unchanged when no special characters are present', () => {
    expect(imageRefToSubdirectory('plain-name')).toBe('plain-name');
  });
});

describe('parseExtraCatalogIndexImages', () => {
  it('parses a single plain image ref with auto-derived subdirectory', () => {
    expect(parseExtraCatalogIndexImages('quay.io/rhdh/index:1.0')).toEqual([
      ['quay.io_rhdh_index_1.0', 'quay.io/rhdh/index:1.0'],
    ]);
  });

  it('parses explicit name=ref entries', () => {
    expect(parseExtraCatalogIndexImages('community=quay.io/rhdh-community/index:1.10')).toEqual([
      ['community', 'quay.io/rhdh-community/index:1.10'],
    ]);
  });

  it('parses mixed explicit + auto-derived entries in order', () => {
    expect(
      parseExtraCatalogIndexImages(
        'community=quay.io/rhdh-community/index:1.10,quay.io/partner/index:latest',
      ),
    ).toEqual([
      ['community', 'quay.io/rhdh-community/index:1.10'],
      ['quay.io_partner_index_latest', 'quay.io/partner/index:latest'],
    ]);
  });

  it('trims whitespace around each entry and around name=ref', () => {
    expect(parseExtraCatalogIndexImages('  community = quay.io/x:1.0 ,  quay.io/y:2.0  ')).toEqual([
      ['community', 'quay.io/x:1.0'],
      ['quay.io_y_2.0', 'quay.io/y:2.0'],
    ]);
  });

  it('skips empty entries silently', () => {
    expect(parseExtraCatalogIndexImages(',,quay.io/x:1.0,,')).toEqual([
      ['quay.io_x_1.0', 'quay.io/x:1.0'],
    ]);
  });

  it('warns and skips entries with an empty image reference', () => {
    const warn = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(parseExtraCatalogIndexImages('community=,quay.io/x:1.0')).toEqual([
        ['quay.io_x_1.0', 'quay.io/x:1.0'],
      ]);
      const out = warn.mock.calls.map(args => String(args[0])).join('\n');
      expect(out).toMatch(/WARNING: Skipping EXTRA_CATALOG_INDEX_IMAGES entry with empty image reference/);
    } finally {
      warn.mockRestore();
    }
  });

  it('warns and skips entries whose explicit name is empty after trimming', () => {
    const warn = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(parseExtraCatalogIndexImages('=quay.io/x:1,quay.io/y:2')).toEqual([
        ['quay.io_y_2', 'quay.io/y:2'],
      ]);
      const out = warn.mock.calls.map(args => String(args[0])).join('\n');
      expect(out).toMatch(/unsafe subdirectory name ''/);
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    ['..', '..=quay.io/x:1'],
    ['.', '.=quay.io/x:1'],
    ['foo/bar', 'foo/bar=quay.io/x:1'],
    ['..\\evil', '..\\evil=quay.io/x:1'],
  ])('rejects path-traversing or separator-bearing subdirectory name %p', (_badName, entry) => {
    const warn = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const result = parseExtraCatalogIndexImages(`${entry},quay.io/safe:1`);
      expect(result).toEqual([['quay.io_safe_1', 'quay.io/safe:1']]);
      const out = warn.mock.calls.map(args => String(args[0])).join('\n');
      expect(out).toMatch(/unsafe subdirectory name/);
    } finally {
      warn.mockRestore();
    }
  });

  it('accepts URL-encoded separators without URL-decoding (character-based check)', () => {
    // %2F is the URL encoding of '/'. We intentionally do NOT decode it, so
    // a name like '..%2Fetc' is accepted as a literal directory name.
    expect(parseExtraCatalogIndexImages('..%2Fetc=quay.io/x:1')).toEqual([
      ['..%2Fetc', 'quay.io/x:1'],
    ]);
  });
});

describe('extractExtraCatalogIndex', () => {
  let workRoot: string;
  let fakeSkopeoDir: string;

  /**
   * Build a fake `skopeo` binary that, on `copy <src> dir:<dst>`, materialises
   * a manifest.json + a single layer tarball at <dst>. The layer contents are
   * packed at fixture-build time from `layerStageDir`.
   */
  async function makeFakeSkopeo(layerStageDir: string): Promise<string> {
    const layerTarPath = join(fakeSkopeoDir, 'layer.tar');
    await tar.c({ gzip: false, file: layerTarPath, cwd: layerStageDir }, ['.']);
    const binPath = join(fakeSkopeoDir, 'skopeo');
    const digest = 'sha256:fakefakefakefakefakefakefakefake';
    const digestFile = digest.split(':')[1];
    writeFileSync(
      binPath,
      `#!/bin/sh
DST=""
for arg in "$@"; do
  case "$arg" in
    dir:*) DST="\${arg#dir:}" ;;
  esac
done
mkdir -p "$DST"
cp "${layerTarPath}" "$DST/${digestFile}"
cat > "$DST/manifest.json" <<EOF
{"layers":[{"digest":"${digest}"}]}
EOF
`,
    );
    chmodSync(binPath, 0o755);
    return binPath;
  }

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'extra-cidx-'));
    fakeSkopeoDir = mkdtempSync(join(tmpdir(), 'fake-skopeo-extra-'));
  });

  afterEach(() => {
    rmSync(workRoot, { recursive: true, force: true });
    rmSync(fakeSkopeoDir, { recursive: true, force: true });
  });

  /** Stage a `catalog-entities/<sub>/<file>` tree for the fake skopeo to pack. */
  async function stageLayer(sub: 'extensions' | 'marketplace', file: string, body: string): Promise<string> {
    const stage = mkdtempSync(join(tmpdir(), 'extra-layer-stage-'));
    const dir = join(stage, 'catalog-entities', sub);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), body);
    return stage;
  }

  it("writes catalog entities to <parent>/<sub>/catalog-entities/ from 'extensions/'", async () => {
    const stage = await stageLayer('extensions', 'plugin.yaml', 'kind: Plugin\n');
    const binPath = await makeFakeSkopeo(stage);
    rmSync(stage, { recursive: true, force: true });
    const skopeo = new Skopeo(binPath);
    const parent = join(workRoot, 'extra');
    await extractExtraCatalogIndex(skopeo, 'quay.io/rhdh-community/index:1.10', 'community', parent, null);
    const dst = join(parent, 'community', 'catalog-entities');
    await expect(fs.readFile(join(dst, 'plugin.yaml'), 'utf8')).resolves.toBe('kind: Plugin\n');
  });

  it('falls back to marketplace/ when extensions/ is missing', async () => {
    const stage = await stageLayer('marketplace', 'mp.yaml', 'kind: Marketplace\n');
    const binPath = await makeFakeSkopeo(stage);
    rmSync(stage, { recursive: true, force: true });
    const skopeo = new Skopeo(binPath);
    const parent = join(workRoot, 'extra');
    await extractExtraCatalogIndex(skopeo, 'quay.io/x/index:1', 'partner', parent, null);
    await expect(
      fs.readFile(join(parent, 'partner', 'catalog-entities', 'mp.yaml'), 'utf8'),
    ).resolves.toBe('kind: Marketplace\n');
  });

  it('logs a warning and does not throw when neither extensions/ nor marketplace/ is present', async () => {
    // Stage an unrelated path so the layer extracts cleanly without writing
    // either of the two recognised directories.
    const stage = mkdtempSync(join(tmpdir(), 'extra-layer-empty-'));
    mkdirSync(join(stage, 'other'), { recursive: true });
    writeFileSync(join(stage, 'other', 'README'), 'noop');
    const binPath = await makeFakeSkopeo(stage);
    rmSync(stage, { recursive: true, force: true });
    const skopeo = new Skopeo(binPath);
    const writes: string[] = [];
    const warn = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      });
    try {
      const parent = join(workRoot, 'extra');
      await expect(
        extractExtraCatalogIndex(skopeo, 'quay.io/x/empty:1', 'empty', parent, null),
      ).resolves.toBeUndefined();
      const out = writes.join('');
      expect(out).toMatch(
        /WARNING: Extra catalog index image quay\.io\/x\/empty:1 does not have neither 'catalog-entities\/extensions\/' nor 'catalog-entities\/marketplace\/' directory/,
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("logs the duplicate-subdir warning AFTER the extraction header when previouslyUsedBy is set", async () => {
    const stage = await stageLayer('extensions', 'plugin.yaml', 'kind: Plugin\n');
    const binPath = await makeFakeSkopeo(stage);
    rmSync(stage, { recursive: true, force: true });
    const skopeo = new Skopeo(binPath);
    const writes: string[] = [];
    const warn = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      });
    try {
      const parent = join(workRoot, 'extra');
      await extractExtraCatalogIndex(
        skopeo,
        'quay.io/second/index:1',
        'community',
        parent,
        'quay.io/first/index:1',
      );
      const out = writes.join('');
      const headerIdx = out.indexOf("Extracting extra catalog index 'community'");
      const warningIdx = out.indexOf("WARNING: Subdirectory 'community' was already used by 'quay.io/first/index:1'");
      expect(headerIdx).toBeGreaterThanOrEqual(0);
      expect(warningIdx).toBeGreaterThan(headerIdx);
    } finally {
      warn.mockRestore();
    }
  });

  it.each(['', '.', '..', 'foo/bar', 'foo\\bar'])(
    'refuses to extract into unsafe subdirectory %p (defense in depth)',
    async badName => {
      const stage = await stageLayer('extensions', 'plugin.yaml', 'kind: Plugin\n');
      const binPath = await makeFakeSkopeo(stage);
      rmSync(stage, { recursive: true, force: true });
      const skopeo = new Skopeo(binPath);
      await expect(
        extractExtraCatalogIndex(skopeo, 'quay.io/x:1', badName, join(workRoot, 'extra'), null),
      ).rejects.toThrow(/unsafe subdirectory/);
    },
  );
});
