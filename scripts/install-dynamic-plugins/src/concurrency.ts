import * as os from 'node:os';

/**
 * Minimal semaphore for bounding concurrent async work.
 * Matches the Python `ThreadPoolExecutor(max_workers=N)` worker model from
 * install-dynamic-plugins-fast.py — single-threaded JS means no lock needed
 * on the counter itself.
 */
export class Semaphore {
  private available: number;
  private readonly queue: Array<() => void> = [];

  constructor(max: number) {
    if (max < 1) throw new RangeError(`Semaphore max must be >= 1, got ${max}`);
    this.available = max;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    return new Promise<void>(resolve => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.available++;
  }
}

export type Outcome<T, Item> =
  | { ok: true; value: T; item: Item }
  | { ok: false; error: Error; item: Item };

/**
 * Run `fn` over `items` with at most `limit` concurrent executions.
 * Returns every outcome — errors are captured, not thrown, so one failure
 * does not cancel the others. Mirrors the behaviour of fast.py's parallel install loop.
 */
export async function mapConcurrent<Item, T>(
  items: readonly Item[],
  limit: number,
  fn: (item: Item) => Promise<T>,
): Promise<Array<Outcome<T, Item>>> {
  const sem = new Semaphore(Math.max(1, limit));
  return Promise.all(
    items.map(async item => {
      await sem.acquire();
      try {
        return { ok: true as const, value: await fn(item), item };
      } catch (err) {
        return { ok: false as const, error: err as Error, item };
      } finally {
        sem.release();
      }
    }),
  );
}

/**
 * Worker count selection, honouring `DYNAMIC_PLUGINS_WORKERS` env and cgroup
 * CPU limits (via `availableParallelism`). Conservative default for OpenShift
 * init containers: half of available CPUs, capped at 6.
 */
export function getWorkers(): number {
  const env = process.env.DYNAMIC_PLUGINS_WORKERS ?? 'auto';
  if (env !== 'auto') {
    const n = Number.parseInt(env, 10);
    if (!Number.isFinite(n) || n < 1) return 1;
    return n;
  }
  const cpus =
    typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(Math.floor(cpus / 2), 6));
}
