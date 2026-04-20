import { resolveImage } from '../src/image-resolver';
import type { Skopeo } from '../src/skopeo';

function fakeSkopeo(exists: (url: string) => boolean): Skopeo {
  return { exists: async (url: string) => exists(url) } as unknown as Skopeo;
}

describe('resolveImage', () => {
  it('returns non-RHDH images unchanged', async () => {
    const sk = fakeSkopeo(() => true);
    await expect(resolveImage(sk, 'oci://quay.io/other/plugin:1.0')).resolves.toBe(
      'oci://quay.io/other/plugin:1.0',
    );
  });

  it('returns the RHDH image unchanged when it exists', async () => {
    const sk = fakeSkopeo(() => true);
    await expect(
      resolveImage(sk, 'oci://registry.access.redhat.com/rhdh/plugin:1.0'),
    ).resolves.toBe('oci://registry.access.redhat.com/rhdh/plugin:1.0');
  });

  it('falls back to quay.io/rhdh when the RHDH image is missing', async () => {
    const sk = fakeSkopeo(() => false);
    await expect(
      resolveImage(sk, 'oci://registry.access.redhat.com/rhdh/plugin:1.0'),
    ).resolves.toBe('oci://quay.io/rhdh/plugin:1.0');
  });

  it('preserves the docker:// protocol on fallback', async () => {
    const sk = fakeSkopeo(() => false);
    await expect(
      resolveImage(sk, 'docker://registry.access.redhat.com/rhdh/plugin:1.0'),
    ).resolves.toBe('docker://quay.io/rhdh/plugin:1.0');
  });
});
