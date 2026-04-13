import { accessSync, constants } from 'node:fs';
import * as path from 'node:path';

/**
 * Minimal `which(1)` — returns the absolute path of `bin` if found on PATH
 * and executable, otherwise `null`. Avoids a dependency on the `which` npm package.
 */
export function which(bin: string): string | null {
  const pathEnv = process.env.PATH ?? '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts =
    process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      try {
        accessSync(full, constants.X_OK);
        return full;
      } catch {
        /* next */
      }
    }
  }
  return null;
}
