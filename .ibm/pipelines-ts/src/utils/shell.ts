import { execa } from 'execa';
import type { ExecaReturnValue, Options } from 'execa';
import { createLogger } from './logger.js';

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  command: string;
}

export interface ShellOptions extends Options {
  /** Whether to log the command being executed */
  logCommand?: boolean;
  /** Whether to log stdout/stderr */
  logOutput?: boolean;
  /** Whether to throw on non-zero exit code */
  throwOnError?: boolean;
  /** Working directory for the command */
  cwd?: string;
  /** Environment variables to set */
  env?: Record<string, string>;
  /** Timeout in milliseconds */
  timeout?: number;
}

const shellLogger = createLogger({ component: 'shell' });

/**
 * Execute a shell command with proper logging and error handling
 * Replaces bash command execution with TypeScript-based implementation
 */
export async function executeCommand(
  command: string,
  args: string[] = [],
  options: ShellOptions = {}
): Promise<ShellResult> {
  const { logCommand = true, logOutput = false, throwOnError = true, ...execaOptions } = options;

  const fullCommand = `${command} ${args.join(' ')}`.trim();

  if (logCommand) {
    shellLogger.info(`Executing: ${fullCommand}`, {
      command,
      args,
      cwd: options.cwd,
    });
  }

  try {
    const result: ExecaReturnValue = await execa(command, args, {
      ...execaOptions,
      all: true, // Capture both stdout and stderr together
    });

    if (logOutput && result.stdout) {
      shellLogger.debug('Command stdout:', { stdout: result.stdout });
    }
    if (logOutput && result.stderr) {
      shellLogger.debug('Command stderr:', { stderr: result.stderr });
    }

    const shellResult: ShellResult = {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      success: result.exitCode === 0,
      command: fullCommand,
    };

    if (logCommand) {
      shellLogger.info(`Command completed with exit code ${result.exitCode}`, {
        command: fullCommand,
        exitCode: result.exitCode,
      });
    }

    return shellResult;
  } catch (error: unknown) {
    const execError = error as ExecaReturnValue;
    const shellResult: ShellResult = {
      stdout: execError.stdout || '',
      stderr: execError.stderr || '',
      exitCode: execError.exitCode || 1,
      success: false,
      command: fullCommand,
    };

    shellLogger.error(`Command failed with exit code ${shellResult.exitCode}`, {
      command: fullCommand,
      exitCode: shellResult.exitCode,
      stderr: shellResult.stderr,
    });

    if (throwOnError) {
      throw new Error(
        `Command failed: ${fullCommand}\nExit code: ${shellResult.exitCode}\nStderr: ${shellResult.stderr}`
      );
    }

    return shellResult;
  }
}

/**
 * Execute a simple shell command (equivalent to $(...) in bash)
 * Returns only stdout on success, throws on error
 */
export async function $$(
  command: string,
  args: string[] = [],
  options: ShellOptions = {}
): Promise<string> {
  const result = await executeCommand(command, args, {
    ...options,
    throwOnError: true,
  });
  return result.stdout.trim();
}

/**
 * Check if a command exists (equivalent to `which command` or `command -v`)
 */
export async function commandExists(command: string): Promise<boolean> {
  try {
    await executeCommand('which', [command], {
      logCommand: false,
      throwOnError: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute kubectl command with proper error handling
 */
export async function kubectl(args: string[], options: ShellOptions = {}): Promise<ShellResult> {
  return executeCommand('kubectl', args, {
    logCommand: true,
    ...options,
  });
}

/**
 * Execute oc command with proper error handling
 */
export async function oc(args: string[], options: ShellOptions = {}): Promise<ShellResult> {
  return executeCommand('oc', args, {
    logCommand: true,
    ...options,
  });
}

/**
 * Execute helm command with proper error handling
 */
export async function helm(args: string[], options: ShellOptions = {}): Promise<ShellResult> {
  return executeCommand('helm', args, {
    logCommand: true,
    ...options,
  });
}

/**
 * Execute a command with a timeout
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage?: string
): Promise<T> {
  return Promise.race([
    operation(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(timeoutMessage ?? `Operation timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

/**
 * Retry a command with exponential backoff
 */
export async function retry<T>(
  operation: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxAttempts) {
        break;
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      shellLogger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms`, {
        error: error instanceof Error ? error.message : String(error),
        attempt,
        maxAttempts,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

/**
 * Execute a command and stream output in real-time
 */
export function streamCommand(
  command: string,
  args: string[] = [],
  options: ShellOptions = {}
): Promise<ShellResult> {
  const fullCommand = `${command} ${args.join(' ')}`.trim();

  shellLogger.info(`Streaming: ${fullCommand}`);

  return new Promise((resolve, reject) => {
    const child = execa(command, args, {
      ...options,
      all: true,
    });

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        if (options.logOutput !== false) {
          process.stdout.write(text);
        }
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        if (options.logOutput !== false) {
          process.stderr.write(text);
        }
      });
    }

    child
      .then((result: ExecaReturnValue) => {
        resolve({
          stdout,
          stderr,
          exitCode: result.exitCode,
          success: result.exitCode === 0,
          command: fullCommand,
        });
      })
      .catch((error: unknown) => {
        const execError = error as ExecaReturnValue;
        const shellResult: ShellResult = {
          stdout,
          stderr,
          exitCode: execError.exitCode || 1,
          success: false,
          command: fullCommand,
        };

        if (options.throwOnError !== false) {
          reject(
            new Error(
              `Command failed: ${fullCommand}\nExit code: ${shellResult.exitCode}\nStderr: ${stderr}`
            )
          );
        } else {
          resolve(shellResult);
        }
      });
  });
}
