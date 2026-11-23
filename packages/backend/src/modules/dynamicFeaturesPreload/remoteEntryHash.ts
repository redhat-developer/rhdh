import { createHash } from 'node:crypto';

/**
 * Number of leading hex characters of the SHA-256 used in hashed remote
 * entry file names.
 */
export const REMOTE_ENTRY_HASH_HEX_LENGTH = 16;

/**
 * Content-addressed file name for a dynamic plugin remote entry: the
 * literal `remoteEntry.js` name with the first {@link
 * REMOTE_ENTRY_HASH_HEX_LENGTH} hex characters of the SHA-256 of the
 * entry's bytes spliced in (`remoteEntry.<16 hex>.js`).
 *
 * Pure function of the bytes: deterministic across restarts and workers,
 * and stable for identical bytes — the property that makes the served
 * URL safe to cache immutable and makes every plugin deployment with
 * different entry bytes get a fresh URL.
 *
 * This module is the single source of the naming contract; nothing else
 * may construct the filename format by hand.
 */
export function hashedRemoteEntryName(bytes: Buffer): string {
  return `remoteEntry.${createHash('sha256')
    .update(bytes)
    .digest('hex')
    .slice(0, REMOTE_ENTRY_HASH_HEX_LENGTH)}.js`;
}
