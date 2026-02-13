/**
 * Simple logger utility for backend
 * Provides environment-aware logging with consistent formatting
 */

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFormat = "text" | "json";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function parseLogLevel(value?: string): LogLevel | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }

  return null;
}

function parseLogFormat(value?: string): LogFormat {
  const normalized = value?.trim().toLowerCase();
  return normalized === "json" ? "json" : "text";
}

function normalizeLogArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return {
      name: arg.name,
      message: arg.message,
      stack: arg.stack,
    };
  }

  if (typeof arg === "bigint") {
    return arg.toString();
  }

  return arg;
}

export class Logger {
  private isDevelopment: boolean;
  private defaultMinLevel: LogLevel;
  private categoryLevels: Map<string, LogLevel>;
  private mutedCategories: Set<string>;
  private logFormat: LogFormat;

  constructor() {
    this.isDevelopment = process.env.NODE_ENV !== "production";
    this.defaultMinLevel = parseLogLevel(process.env.LOG_LEVEL) || (this.isDevelopment ? "debug" : "info");
    this.categoryLevels = this.parseCategoryLevels(process.env.LOG_LEVEL_OVERRIDES || "");
    this.mutedCategories = new Set(
      (process.env.LOG_MUTE_CATEGORIES || "")
        .split(",")
        .map((category) => category.trim().toUpperCase())
        .filter((category) => category.length > 0)
    );
    this.logFormat = parseLogFormat(process.env.LOG_FORMAT);
  }

  private parseCategoryLevels(raw: string): Map<string, LogLevel> {
    const result = new Map<string, LogLevel>();

    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .forEach((entry) => {
        const separator = entry.includes("=") ? "=" : ":";
        const [category, levelRaw] = entry.split(separator);
        const level = parseLogLevel(levelRaw);
        if (!category || !level) {
          return;
        }
        result.set(category.trim().toUpperCase(), level);
      });

    return result;
  }

  private shouldLog(level: LogLevel, category: string): boolean {
    const normalizedCategory = category.toUpperCase();
    if (this.mutedCategories.has(normalizedCategory)) {
      return false;
    }

    const minLevel = this.categoryLevels.get(normalizedCategory) || this.defaultMinLevel;
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];
  }

  private log(level: LogLevel, category: string, message: string, ...args: unknown[]): void {
    if (!this.shouldLog(level, category)) {
      return;
    }

    if (this.logFormat === "json") {
      const payload = {
        timestamp: new Date().toISOString(),
        level,
        category,
        message,
        context: args.map((arg) => normalizeLogArg(arg)),
      };

      const serialized = JSON.stringify(payload);
      switch (level) {
        case "debug":
          console.debug(serialized);
          return;
        case "info":
          console.info(serialized);
          return;
        case "warn":
          console.warn(serialized);
          return;
        case "error":
          console.error(serialized);
          return;
      }
    }

    const prefix = `[${level.toUpperCase()}] [${category}]`;

    switch (level) {
      case "debug":
        console.debug(prefix, message, ...args);
        break;
      case "info":
        console.info(prefix, message, ...args);
        break;
      case "warn":
        console.warn(prefix, message, ...args);
        break;
      case "error":
        console.error(prefix, message, ...args);
        break;
    }
  }

  debug(category: string, message: string, ...args: unknown[]): void {
    this.log("debug", category, message, ...args);
  }

  info(category: string, message: string, ...args: unknown[]): void {
    this.log("info", category, message, ...args);
  }

  warn(category: string, message: string, ...args: unknown[]): void {
    this.log("warn", category, message, ...args);
  }

  error(category: string, message: string, ...args: unknown[]): void {
    this.log("error", category, message, ...args);
  }
}

// 導出單例
export const logger = new Logger();

// 導出特定類別的 logger
export const authLogger = {
  debug: (message: string, ...args: unknown[]) => logger.debug("AUTH", message, ...args),
  info: (message: string, ...args: unknown[]) => logger.info("AUTH", message, ...args),
  warn: (message: string, ...args: unknown[]) => logger.warn("AUTH", message, ...args),
  error: (message: string, ...args: unknown[]) => logger.error("AUTH", message, ...args),
};

export const streamerLogger = {
  debug: (message: string, ...args: unknown[]) => logger.debug("STREAMER", message, ...args),
  info: (message: string, ...args: unknown[]) => logger.info("STREAMER", message, ...args),
  warn: (message: string, ...args: unknown[]) => logger.warn("STREAMER", message, ...args),
  error: (message: string, ...args: unknown[]) => logger.error("STREAMER", message, ...args),
};

export const dbLogger = {
  debug: (message: string, ...args: unknown[]) => logger.debug("DATABASE", message, ...args),
  info: (message: string, ...args: unknown[]) => logger.info("DATABASE", message, ...args),
  warn: (message: string, ...args: unknown[]) => logger.warn("DATABASE", message, ...args),
  error: (message: string, ...args: unknown[]) => logger.error("DATABASE", message, ...args),
};
