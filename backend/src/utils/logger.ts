/**
 * Simple logger utility for backend
 * Provides environment-aware logging with consistent formatting
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private isDevelopment: boolean;

  constructor() {
    this.isDevelopment = process.env.NODE_ENV !== 'production';
  }

  private log(level: LogLevel, category: string, message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${category}]`;

    switch (level) {
      case 'debug':
        if (this.isDevelopment) {
          console.debug(prefix, message, ...args);
        }
        break;
      case 'info':
        console.info(prefix, message, ...args);
        break;
      case 'warn':
        console.warn(prefix, message, ...args);
        break;
      case 'error':
        console.error(prefix, message, ...args);
        break;
    }
  }

  debug(category: string, message: string, ...args: unknown[]): void {
    this.log('debug', category, message, ...args);
  }

  info(category: string, message: string, ...args: unknown[]): void {
    this.log('info', category, message, ...args);
  }

  warn(category: string, message: string, ...args: unknown[]): void {
    this.log('warn', category, message, ...args);
  }

  error(category: string, message: string, ...args: unknown[]): void {
    this.log('error', category, message, ...args);
  }
}

// 導出單例
export const logger = new Logger();

// 導出特定類別的 logger
export const authLogger = {
  debug: (message: string, ...args: unknown[]) => logger.debug('AUTH', message, ...args),
  info: (message: string, ...args: unknown[]) => logger.info('AUTH', message, ...args),
  warn: (message: string, ...args: unknown[]) => logger.warn('AUTH', message, ...args),
  error: (message: string, ...args: unknown[]) => logger.error('AUTH', message, ...args),
};

export const streamerLogger = {
  debug: (message: string, ...args: unknown[]) => logger.debug('STREAMER', message, ...args),
  info: (message: string, ...args: unknown[]) => logger.info('STREAMER', message, ...args),
  warn: (message: string, ...args: unknown[]) => logger.warn('STREAMER', message, ...args),
  error: (message: string, ...args: unknown[]) => logger.error('STREAMER', message, ...args),
};

export const dbLogger = {
  debug: (message: string, ...args: unknown[]) => logger.debug('DATABASE', message, ...args),
  info: (message: string, ...args: unknown[]) => logger.info('DATABASE', message, ...args),
  warn: (message: string, ...args: unknown[]) => logger.warn('DATABASE', message, ...args),
  error: (message: string, ...args: unknown[]) => logger.error('DATABASE', message, ...args),
};
