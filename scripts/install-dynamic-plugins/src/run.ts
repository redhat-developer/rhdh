import { spawn, type SpawnOptions } from 'node:child_process';
import { InstallException } from './errors.js';

export type RunResult = {
  stdout: string;
  stderr: string;
};

/**
 * Execute a command, capturing stdout/stderr. Throws InstallException with full
 * context (exit code, stderr) on non-zero exit. Matches the Python `run()` contract.
 */
export async function run(
  cmd: string[],
  errMsg: string,
  options: SpawnOptions = {},
): Promise<RunResult> {
  if (cmd.length === 0) {
    throw new InstallException(`${errMsg}: empty command`);
  }
  const [bin, ...args] = cmd as [string, ...string[]];
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(bin, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', err => reject(new InstallException(`${errMsg}: ${err.message}`)));
    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const parts = [`${errMsg}: exit code ${code}`, `cmd: ${cmd.join(' ')}`];
        if (stderr.trim()) parts.push(`stderr: ${stderr.trim()}`);
        reject(new InstallException(parts.join('\n')));
      }
    });
  });
}
