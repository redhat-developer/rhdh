import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { InstallException } from './errors.js';
import { RECOGNIZED_ALGORITHMS, type Algorithm } from './types.js';

/**
 * Verify an NPM package archive matches the declared SRI-style integrity string.
 *
 * Uses streaming `createHash` so large archives never load into memory — safe
 * for the tight init-container memory budgets on OpenShift.
 */
export async function verifyIntegrity(
  pkg: string,
  archive: string,
  integrity: string,
): Promise<void> {
  const dash = integrity.indexOf('-');
  if (dash === -1) {
    throw new InstallException(
      `Package integrity for ${pkg} must be a string of the form <algorithm>-<hash>`,
    );
  }
  const algo = integrity.slice(0, dash);
  const expected = integrity.slice(dash + 1);

  if (!isRecognizedAlgorithm(algo)) {
    throw new InstallException(
      `${pkg}: Provided Package integrity algorithm ${algo} is not supported, ` +
        `please use one of following algorithms ${RECOGNIZED_ALGORITHMS.join(', ')} instead`,
    );
  }
  if (!isValidBase64(expected)) {
    throw new InstallException(
      `${pkg}: Provided Package integrity hash ${expected} is not a valid base64 encoding`,
    );
  }

  const hash = createHash(algo);
  await pipeline(createReadStream(archive), hash);
  const actual = hash.digest('base64');

  if (actual !== expected) {
    throw new InstallException(
      `${pkg}: integrity check failed — got ${algo}-${actual}, expected ${integrity}`,
    );
  }
}

function isRecognizedAlgorithm(value: string): value is Algorithm {
  return (RECOGNIZED_ALGORITHMS as readonly string[]).includes(value);
}

function isValidBase64(value: string): boolean {
  // Reject empty, reject strings with characters outside the base64 alphabet,
  // reject strings whose round-trip doesn't match (catches bad padding).
  if (value.length === 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    const buf = Buffer.from(value, 'base64');
    return buf.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '');
  } catch {
    return false;
  }
}
