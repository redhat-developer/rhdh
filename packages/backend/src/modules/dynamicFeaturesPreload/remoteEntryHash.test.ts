import { createHash } from 'node:crypto';

import {
  hashedRemoteEntryName,
  REMOTE_ENTRY_HASH_HEX_LENGTH,
} from './remoteEntryHash';

describe('hashedRemoteEntryName', () => {
  it('produces the exact remoteEntry.<16 lowercase hex>.js format', () => {
    const name = hashedRemoteEntryName(Buffer.from('some entry bytes'));

    expect(name).toMatch(/^remoteEntry\.[0-9a-f]{16}\.js$/);
    expect(REMOTE_ENTRY_HASH_HEX_LENGTH).toBe(16);
  });

  it('is the first 16 hex chars of the sha256 of the bytes', () => {
    const bytes = Buffer.from('another set of entry bytes');

    expect(hashedRemoteEntryName(bytes)).toBe(
      `remoteEntry.${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.js`,
    );
  });

  it('is deterministic: same bytes produce the same name', () => {
    const bytes = Buffer.from('identical bytes');

    expect(hashedRemoteEntryName(bytes)).toBe(hashedRemoteEntryName(bytes));
  });

  it('differs for different bytes', () => {
    expect(hashedRemoteEntryName(Buffer.from('bytes A'))).not.toBe(
      hashedRemoteEntryName(Buffer.from('bytes B')),
    );
  });
});
