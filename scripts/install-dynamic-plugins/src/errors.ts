/**
 * Thrown for any installer-level failure (parsing, download, extraction, integrity).
 * Kept as a named class so callers can distinguish expected failures from bugs.
 */
export class InstallException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallException';
  }
}
