import { stripEmpty } from './stripEmpty';

describe('stripEmpty', () => {
  it('returns undefined for null, undefined, and empty string', () => {
    expect(stripEmpty(null)).toBeUndefined();
    expect(stripEmpty(undefined)).toBeUndefined();
    expect(stripEmpty('')).toBeUndefined();
  });

  it('keeps non-empty primitives', () => {
    expect(stripEmpty('x')).toBe('x');
    expect(stripEmpty(0)).toBe(0);
    expect(stripEmpty(false)).toBe(false);
  });

  it('drops empty arrays and empty objects', () => {
    expect(stripEmpty([])).toBeUndefined();
    expect(stripEmpty({})).toBeUndefined();
  });

  it('recursively drops empty nested fields', () => {
    expect(
      stripEmpty({
        usedExports: [],
        css: { async: [], sync: [] },
        remoteTypes: '',
        remotesInfo: {},
        keep: 'yes',
        nested: { a: [], b: '' },
      }),
    ).toEqual({ keep: 'yes' });
  });

  it('drops an object whose only children were empty', () => {
    expect(
      stripEmpty({
        assets: {
          js: { async: [], sync: [] },
          css: { async: [], sync: [] },
        },
      }),
    ).toBeUndefined();
  });

  it('keeps non-empty array/object structure after stripping siblings', () => {
    expect(
      stripEmpty({
        assets: {
          js: { async: [], sync: ['static/a.js'] },
          css: { async: [], sync: [] },
        },
        usedExports: [],
      }),
    ).toEqual({
      assets: {
        js: { sync: ['static/a.js'] },
      },
    });
  });

  it('strips empty entries inside arrays', () => {
    expect(stripEmpty(['', 'a', null, {}, []])).toEqual(['a']);
  });
});
