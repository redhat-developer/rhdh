declare module 'proper-lockfile' {
  export function lock(
    path: string,
    options?: { stale?: number; retries?: number; realpath?: boolean }
  ): Promise<() => Promise<void>>
  export function unlock(path: string): Promise<void>
}
