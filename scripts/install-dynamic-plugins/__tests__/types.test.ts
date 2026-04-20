import { parseMaxEntrySize } from '../src/types';

describe('parseMaxEntrySize', () => {
  const DEFAULT = 20_000_000;

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
