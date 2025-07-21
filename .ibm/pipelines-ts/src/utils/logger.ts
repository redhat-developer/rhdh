import { pino } from 'pino';

/**
 * Creates a child logger with additional context
 * Useful for adding context like component name, job name, etc.
 */
export function createLogger(context: Record<string, unknown>): pino.Logger {
  const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  });

  return logger.child(context);
}
