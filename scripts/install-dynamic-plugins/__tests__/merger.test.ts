import { InstallException } from '../src/errors';
import { deepMerge, mergePlugin } from '../src/merger';
import type { PluginMap } from '../src/types';

describe('deepMerge', () => {
  it('merges disjoint keys into the destination', () => {
    const dst: Record<string, unknown> = { a: 1 };
    deepMerge({ b: 2, c: { d: 3 } }, dst);
    expect(dst).toEqual({ a: 1, b: 2, c: { d: 3 } });
  });

  it('deep-merges nested objects', () => {
    const dst: Record<string, unknown> = { a: { x: 1 }, b: 2 };
    deepMerge({ a: { y: 2 }, c: 3 }, dst);
    expect(dst).toEqual({ a: { x: 1, y: 2 }, b: 2, c: 3 });
  });

  it('is idempotent when the same scalar is merged', () => {
    const dst: Record<string, unknown> = { a: 1 };
    expect(() => deepMerge({ a: 1 }, dst)).not.toThrow();
  });

  it('throws on conflicting scalars', () => {
    const dst: Record<string, unknown> = { a: { x: 1 } };
    expect(() => deepMerge({ a: { x: 2 } }, dst)).toThrow(/Config key 'a.x' defined differently/);
  });
});

describe('mergePlugin — NPM', () => {
  it('adds a new plugin on first merge', async () => {
    const all: PluginMap = {};
    await mergePlugin({ package: 'pkg@1.0.0' }, all, 'cfg.yaml', 0);
    expect(all['pkg']).toBeDefined();
    expect(all['pkg']?.package).toBe('pkg@1.0.0');
    expect(all['pkg']?._level).toBe(0);
  });

  it('overrides a lower-level plugin from a higher level', async () => {
    const all: PluginMap = {};
    await mergePlugin({ package: 'pkg@1.0.0', disabled: false }, all, 'inc.yaml', 0);
    await mergePlugin({ package: 'pkg@2.0.0', disabled: true }, all, 'cfg.yaml', 1);
    expect(all['pkg']?.package).toBe('pkg@2.0.0');
    expect(all['pkg']?.disabled).toBe(true);
    expect(all['pkg']?._level).toBe(1);
  });

  it('raises on duplicates within the same level', async () => {
    const all: PluginMap = {};
    await mergePlugin({ package: 'pkg@1.0.0' }, all, 'cfg.yaml', 0);
    await expect(mergePlugin({ package: 'pkg@2.0.0' }, all, 'cfg.yaml', 0)).rejects.toBeInstanceOf(
      InstallException,
    );
  });

  it('rejects non-string package values', async () => {
    const all: PluginMap = {};
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mergePlugin({ package: 123 as any }, all, 'cfg.yaml', 0),
    ).rejects.toThrow(/must be a string/);
  });
});
