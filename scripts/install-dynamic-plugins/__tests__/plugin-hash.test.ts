import { computePluginHash } from '../src/plugin-hash';
import type { Plugin } from '../src/types';

describe('computePluginHash', () => {
  it('produces a deterministic hash for the same plugin', () => {
    const plugin: Plugin = {
      package: 'oci://host/img:v1.0!pkg',
      disabled: false,
      pluginConfig: { a: 1 },
      version: 'v1.0',
    };
    const h1 = computePluginHash({ ...plugin });
    const h2 = computePluginHash({ ...plugin, pluginConfig: { a: 2 } });
    // pluginConfig and version do not participate in the hash.
    expect(h1).toBe(h2);
  });

  it('changes the hash when package changes', () => {
    const a = computePluginHash({ package: 'a@1' });
    const b = computePluginHash({ package: 'b@1' });
    expect(a).not.toBe(b);
  });

  it('changes the hash when pullPolicy changes', () => {
    const a = computePluginHash({ package: 'x@1' });
    const b = computePluginHash({ package: 'x@1', pullPolicy: 'Always' });
    expect(a).not.toBe(b);
  });
});
