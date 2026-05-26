import { getNpmWorkers, getWorkers, mapConcurrent, Semaphore } from '../src/concurrency';

describe('Semaphore', () => {
  it('bounds the number of concurrent holders', async () => {
    const sem = new Semaphore(2);
    let inFlight = 0;
    let peak = 0;
    const work = async () => {
      await sem.acquire();
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      sem.release();
    };
    await Promise.all(Array.from({ length: 8 }, work));
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('rejects a max < 1', () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
  });
});

describe('mapConcurrent', () => {
  it('captures both successes and failures without cancelling peers', async () => {
    const results = await mapConcurrent([1, 2, 3, 4], 2, async n => {
      if (n === 2) throw new Error('boom');
      return n * 2;
    });
    expect(results).toHaveLength(4);
    expect(results.filter(r => r.ok).map(r => r.ok && r.value)).toEqual([2, 6, 8]);
    expect(results.filter(r => !r.ok).map(r => !r.ok && r.error.message)).toEqual(['boom']);
  });

  it('respects the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapConcurrent(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise(r => setTimeout(r, 2));
        inFlight--;
      },
    );
    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe('getWorkers', () => {
  const originalEnv = process.env.DYNAMIC_PLUGINS_WORKERS;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.DYNAMIC_PLUGINS_WORKERS;
    else process.env.DYNAMIC_PLUGINS_WORKERS = originalEnv;
  });

  it('honours an explicit worker count', () => {
    process.env.DYNAMIC_PLUGINS_WORKERS = '3';
    expect(getWorkers()).toBe(3);
  });

  it('clamps non-numeric values to 1', () => {
    process.env.DYNAMIC_PLUGINS_WORKERS = 'banana';
    expect(getWorkers()).toBe(1);
  });

  it('auto-picks a value between 1 and 6', () => {
    process.env.DYNAMIC_PLUGINS_WORKERS = 'auto';
    const w = getWorkers();
    expect(w).toBeGreaterThanOrEqual(1);
    expect(w).toBeLessThanOrEqual(6);
  });
});

describe('getNpmWorkers', () => {
  const originalEnv = process.env.DYNAMIC_PLUGINS_NPM_WORKERS;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.DYNAMIC_PLUGINS_NPM_WORKERS;
    else process.env.DYNAMIC_PLUGINS_NPM_WORKERS = originalEnv;
  });

  it('honours an explicit NPM worker count', () => {
    process.env.DYNAMIC_PLUGINS_NPM_WORKERS = '2';
    expect(getNpmWorkers()).toBe(2);
  });

  it('falls back to 1 for non-numeric values', () => {
    process.env.DYNAMIC_PLUGINS_NPM_WORKERS = 'banana';
    expect(getNpmWorkers()).toBe(1);
  });

  it('auto-picks a value between 1 and 3 (lower cap than OCI)', () => {
    process.env.DYNAMIC_PLUGINS_NPM_WORKERS = 'auto';
    const w = getNpmWorkers();
    expect(w).toBeGreaterThanOrEqual(1);
    expect(w).toBeLessThanOrEqual(3);
  });

  it('explicit NPM worker count is independent of the OCI cap', () => {
    process.env.DYNAMIC_PLUGINS_NPM_WORKERS = '8';
    expect(getNpmWorkers()).toBe(8);
  });
});
