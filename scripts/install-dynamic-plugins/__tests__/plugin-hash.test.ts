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

  // The reference hashes below were produced by the Python `install-dynamic-plugins.py`
  // script via `hashlib.sha256(json.dumps(hash_dict, sort_keys=True).encode()).hexdigest()`.
  // If these break, the install hash is no longer cross-compatible with the Python
  // implementation — every existing dynamic-plugins-root will be reinstalled on upgrade.
  describe('Python compatibility', () => {
    it('matches Python hash for a simple package', () => {
      // python3 -c "import hashlib,json;
      //   print(hashlib.sha256(json.dumps({'package':'a@1'},sort_keys=True).encode()).hexdigest())"
      expect(computePluginHash({ package: 'a@1' })).toBe(
        'd2cd9f6a6952d7df2f1760af29dcf232d441be5509048d5dec5093a5bd840b5a',
      );
    });

    it('matches Python hash for an OCI plugin with last_modified_level + pullPolicy', () => {
      // python3 -c "import hashlib,json;
      //   d={'package':'oci://x/y:1!p','last_modified_level':1,'pullPolicy':'Always'};
      //   print(hashlib.sha256(json.dumps(d,sort_keys=True).encode()).hexdigest())"
      expect(
        computePluginHash({
          package: 'oci://x/y:1!p',
          pullPolicy: 'Always',
          last_modified_level: 1,
        }),
      ).toBe('0191b0eeccc1307af7f9c5d8d7e249690152b6fd2a492aa30de8f7ec2fda02c9');
    });
  });
});
