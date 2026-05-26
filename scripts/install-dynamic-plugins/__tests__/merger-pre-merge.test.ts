import { InstallException } from '../src/errors';
import { filterDisabledOciPlugins, preMergeOciDisabledState } from '../src/merger';
import type { PluginSpec } from '../src/types';

describe('preMergeOciDisabledState — level overrides', () => {
  const cases: Array<{
    name: string;
    include: PluginSpec[];
    main: PluginSpec[];
    expectDisabled: boolean;
  }> = [
    {
      name: 'include enabled, main disabled (path-less inherit) → effectively disabled',
      include: [{ package: 'oci://registry.example.com/plugin:1.0', disabled: false }],
      main: [{ package: 'oci://registry.example.com/plugin:{{inherit}}', disabled: true }],
      expectDisabled: true,
    },
    {
      name: 'include disabled, main re-enables → not disabled',
      include: [{ package: 'oci://registry.example.com/plugin:1.0', disabled: true }],
      main: [{ package: 'oci://registry.example.com/plugin:{{inherit}}', disabled: false }],
      expectDisabled: false,
    },
    {
      name: 'include disabled, no main entry → disabled',
      include: [{ package: 'oci://registry.example.com/plugin:1.0', disabled: true }],
      main: [],
      expectDisabled: true,
    },
    {
      name: 'cross-form: path-less include enabled, explicit-path main disabled → disabled',
      include: [{ package: 'oci://registry.example.com/plugin:1.0', disabled: false }],
      main: [{ package: 'oci://registry.example.com/plugin:1.0!my-plugin', disabled: true }],
      expectDisabled: true,
    },
    {
      name: 'cross-form: explicit-path include enabled, path-less main disabled → disabled',
      include: [{ package: 'oci://registry.example.com/plugin:1.0!my-plugin', disabled: false }],
      main: [{ package: 'oci://registry.example.com/plugin:{{inherit}}', disabled: true }],
      expectDisabled: true,
    },
    {
      name: 'cross-form: explicit-path include disabled, path-less main enables → not disabled',
      include: [{ package: 'oci://registry.example.com/plugin:1.0!my-plugin', disabled: true }],
      main: [{ package: 'oci://registry.example.com/plugin:{{inherit}}', disabled: false }],
      expectDisabled: false,
    },
  ];

  for (const { name, include, main, expectDisabled } of cases) {
    it(name, () => {
      const result = preMergeOciDisabledState([['include.yaml', include]], main, 'main.yaml');
      const registry = 'oci://registry.example.com/plugin';
      if (expectDisabled) {
        expect(result.has(registry)).toBe(true);
      } else {
        expect(result.has(registry)).toBe(false);
      }
    });
  }
});

describe('preMergeOciDisabledState — path-less + multiple explicit paths', () => {
  const include: PluginSpec[] = [
    { package: 'oci://registry.example.com/plugin:1.0!pluginA' },
    { package: 'oci://registry.example.com/plugin:1.0!pluginB' },
  ];

  it('warns and skips when the path-less reference is disabled', () => {
    const warn = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const main: PluginSpec[] = [
        { package: 'oci://registry.example.com/plugin:{{inherit}}', disabled: true },
      ];
      const result = preMergeOciDisabledState([['include.yaml', include]], main, 'main.yaml');
      expect(result.has('oci://registry.example.com/plugin')).toBe(true);
      const out = warn.mock.calls.map(args => String(args[0])).join('\n');
      expect(out).toMatch(/WARNING: Skipping disabled ambiguous path-less OCI reference/);
      expect(out).toMatch(/multiple path-specific entries exist/);
      expect(out).toMatch(/Cannot use path-less syntax for multi-plugin images/);
    } finally {
      warn.mockRestore();
    }
  });

  it('throws when the path-less reference is enabled', () => {
    const main: PluginSpec[] = [
      { package: 'oci://registry.example.com/plugin:{{inherit}}', disabled: false },
    ];
    expect(() => preMergeOciDisabledState([['include.yaml', include]], main, 'main.yaml')).toThrow(
      /Ambiguous path-less OCI reference/,
    );
  });
});

describe('preMergeOciDisabledState — same-level duplicates', () => {
  it('warns and ignores duplicate disabled entries at the same level', () => {
    const warn = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const include: PluginSpec[] = [
        { package: 'oci://registry.example.com/plugin:1.0!a', disabled: true },
        { package: 'oci://registry.example.com/plugin:1.0!a', disabled: true },
      ];
      const result = preMergeOciDisabledState([['include.yaml', include]], [], 'main.yaml');
      expect(result.has('oci://registry.example.com/plugin')).toBe(false);
      const out = warn.mock.calls.map(args => String(args[0])).join('\n');
      expect(out).toMatch(/WARNING: Skipping duplicate disabled OCI plugin configuration/);
    } finally {
      warn.mockRestore();
    }
  });

  it('throws on duplicate enabled entries at the same level', () => {
    const include: PluginSpec[] = [
      { package: 'oci://registry.example.com/plugin:1.0!a' },
      { package: 'oci://registry.example.com/plugin:1.0!a' },
    ];
    expect(() => preMergeOciDisabledState([['include.yaml', include]], [], 'main.yaml')).toThrow(
      /Duplicate OCI plugin configuration/,
    );
  });
});

describe('preMergeOciDisabledState — invalid OCI strings', () => {
  it('warns and skips when an invalid OCI string is disabled', () => {
    const warn = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const main: PluginSpec[] = [{ package: 'oci://not a valid spec', disabled: true }];
      const result = preMergeOciDisabledState([], main, 'main.yaml');
      expect(result.size).toBe(0);
      const out = warn.mock.calls.map(args => String(args[0])).join('\n');
      expect(out).toMatch(/WARNING: Skipping disabled OCI plugin with invalid format/);
    } finally {
      warn.mockRestore();
    }
  });

  it('throws when an invalid OCI string is enabled', () => {
    const main: PluginSpec[] = [{ package: 'oci://not a valid spec' }];
    expect(() => preMergeOciDisabledState([], main, 'main.yaml')).toThrow(
      InstallException,
    );
  });
});

describe('filterDisabledOciPlugins', () => {
  it('removes plugins whose registry is in the disabled set', () => {
    const plugins: PluginSpec[] = [
      { package: 'oci://registry.example.com/plugin:1.0!a' },
      { package: 'oci://other.example.com/plugin:2.0!b' },
    ];
    const disabled = new Set(['oci://registry.example.com/plugin']);
    const out = filterDisabledOciPlugins(plugins, disabled);
    expect(out.map(p => p.package)).toEqual(['oci://other.example.com/plugin:2.0!b']);
  });

  it('removes invalid OCI entries that are marked disabled, keeps invalid-enabled ones (caller will surface them later)', () => {
    const plugins: PluginSpec[] = [
      { package: 'oci://bad spec', disabled: true },
      { package: 'oci://also bad' },
    ];
    const out = filterDisabledOciPlugins(plugins, new Set());
    expect(out.map(p => p.package)).toEqual(['oci://also bad']);
  });

  it('passes non-OCI entries through unchanged', () => {
    const plugins: PluginSpec[] = [
      { package: '@scope/pkg@1.0.0' },
      { package: './local-plugin' },
    ];
    const out = filterDisabledOciPlugins(plugins, new Set(['oci://something/plugin']));
    expect(out).toHaveLength(2);
  });
});
