import { isPluginDisabled, parseMaxEntrySize } from '../src/types';

describe('parseMaxEntrySize', () => {
  const DEFAULT = 40_000_000;

  it('returns the default when unset', () => {
    expect(parseMaxEntrySize(undefined)).toBe(DEFAULT);
  });

  it('returns the default when empty', () => {
    expect(parseMaxEntrySize('')).toBe(DEFAULT);
  });

  it('returns the parsed value for a positive integer', () => {
    expect(parseMaxEntrySize('1000')).toBe(1000);
  });

  it('falls back to the default for a non-numeric value (no silent NaN)', () => {
    expect(parseMaxEntrySize('abc')).toBe(DEFAULT);
  });

  it('falls back to the default for zero', () => {
    expect(parseMaxEntrySize('0')).toBe(DEFAULT);
  });

  it('falls back to the default for a negative value', () => {
    expect(parseMaxEntrySize('-100')).toBe(DEFAULT);
  });

  it('falls back to the default for NaN', () => {
    expect(parseMaxEntrySize('NaN')).toBe(DEFAULT);
  });
});

describe('isPluginDisabled', () => {
  it('returns false when neither enabled nor disabled is set', () => {
    expect(isPluginDisabled({ package: 'pkg@1.0' })).toBe(false);
  });

  it('returns false when enabled: true', () => {
    expect(isPluginDisabled({ package: 'pkg@1.0', enabled: true })).toBe(false);
  });

  it('returns true when enabled: false', () => {
    expect(isPluginDisabled({ package: 'pkg@1.0', enabled: false })).toBe(true);
  });

  it('returns true when disabled: true (backward compat)', () => {
    expect(isPluginDisabled({ package: 'pkg@1.0', disabled: true })).toBe(true);
  });

  it('returns false when disabled: false (backward compat)', () => {
    expect(isPluginDisabled({ package: 'pkg@1.0', disabled: false })).toBe(false);
  });

  it('enabled takes precedence over disabled when both set (enabled: true, disabled: true)', () => {
    const warnings: string[] = [];
    const result = isPluginDisabled(
      { package: 'pkg@1.0', enabled: true, disabled: true },
      msg => warnings.push(msg),
    );
    expect(result).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/both 'enabled' and 'disabled'/);
  });

  it('enabled takes precedence over disabled when both set (enabled: false, disabled: false)', () => {
    const warnings: string[] = [];
    const result = isPluginDisabled(
      { package: 'pkg@1.0', enabled: false, disabled: false },
      msg => warnings.push(msg),
    );
    expect(result).toBe(true);
    expect(warnings).toHaveLength(1);
  });

  it('does not warn when no callback provided', () => {
    // Should not throw even when both fields are set
    expect(isPluginDisabled({ package: 'pkg@1.0', enabled: true, disabled: true })).toBe(false);
  });

  it('treats non-boolean enabled as unset', () => {
    const warnings: string[] = [];
    const result = isPluginDisabled(
      { package: 'pkg@1.0', enabled: 'false' as unknown as boolean },
      msg => warnings.push(msg),
    );
    expect(result).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/non-boolean 'enabled: false'/);
  });

  it('treats null enabled as unset', () => {
    const warnings: string[] = [];
    const result = isPluginDisabled(
      { package: 'pkg@1.0', enabled: null as unknown as boolean },
      msg => warnings.push(msg),
    );
    expect(result).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/non-boolean 'enabled: null'/);
  });

  it('treats non-boolean disabled as unset', () => {
    const warnings: string[] = [];
    const result = isPluginDisabled(
      { package: 'pkg@1.0', disabled: 'true' as unknown as boolean },
      msg => warnings.push(msg),
    );
    expect(result).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/non-boolean 'disabled: true'/);
  });

  it('falls back to valid disabled when enabled is non-boolean', () => {
    const warnings: string[] = [];
    const result = isPluginDisabled(
      { package: 'pkg@1.0', enabled: 'yes' as unknown as boolean, disabled: true },
      msg => warnings.push(msg),
    );
    // enabled is non-boolean so ignored; disabled: true is valid
    expect(result).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/non-boolean 'enabled/);
  });
});
