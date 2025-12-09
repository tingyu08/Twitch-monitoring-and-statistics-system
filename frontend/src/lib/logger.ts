/**
 * Logger Utility
 * 
 * 提供統一的日誌管理,可在生產環境禁用 debug logs
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

class Logger {
  private prefix: string;

  constructor(prefix: string = '') {
    this.prefix = prefix;
  }

  private formatMessage(message: string): string {
    return this.prefix ? `[${this.prefix}] ${message}` : message;
  }

  debug(message: string, ...args: any[]): void {
    if (!IS_PRODUCTION) {
      console.log(this.formatMessage(message), ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    console.info(this.formatMessage(message), ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(this.formatMessage(message), ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(this.formatMessage(message), ...args);
  }

  /**
   * 建立帶有特定前綴的 Logger 實例
   */
  static create(prefix: string): Logger {
    return new Logger(prefix);
  }
}

// 預設 logger 實例
export const logger = Logger.create('App');

// 特定功能的 logger
export const authLogger = Logger.create('Auth');
export const apiLogger = Logger.create('API');
export const chartLogger = Logger.create('Chart');

export default Logger;
