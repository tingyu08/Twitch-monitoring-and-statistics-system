import type { Logger as LoggerClass } from "../logger";

type LoggerModule = {
  logger: LoggerClass;
  apiLogger: LoggerClass;
  authLogger: LoggerClass;
  chartLogger: LoggerClass;
  Logger: typeof LoggerClass;
};

describe("Logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  const loadLoggerModule = (nodeEnv: string): LoggerModule => {
    (process.env as Record<string, string | undefined>)["NODE_ENV"] = nodeEnv;
    jest.resetModules();
    return require("../logger") as LoggerModule;
  };

  beforeEach(() => {
    console.log = jest.fn();
    console.info = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
  });

  afterEach(() => {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    (process.env as Record<string, string | undefined>)["NODE_ENV"] = originalNodeEnv;
    jest.resetModules();
  });

  it("logs debug in development", () => {
    const { logger } = loadLoggerModule("development");

    logger.debug("test message", { data: "test" });

    expect(console.log).toHaveBeenCalledWith("[App] test message", { data: "test" });
  });

  it("skips debug in production", () => {
    const { logger } = loadLoggerModule("production");

    logger.debug("test message", { data: "test" });

    expect(console.log).not.toHaveBeenCalled();
  });

  it("always logs info, warn, and error", () => {
    const { logger } = loadLoggerModule("production");

    logger.info("info message", { level: "info" });
    logger.warn("warning message", { severity: "medium" });
    logger.error("error message", { code: 500 });

    expect(console.info).toHaveBeenCalledWith("[App] info message", { level: "info" });
    expect(console.warn).toHaveBeenCalledWith("[App] warning message", { severity: "medium" });
    expect(console.error).toHaveBeenCalledWith("[App] error message", { code: 500 });
  });

  it("supports all predefined prefixed loggers", () => {
    const { apiLogger, authLogger, chartLogger } = loadLoggerModule("development");

    apiLogger.info("API request");
    authLogger.warn("auth failed");
    chartLogger.error("chart load failed");

    expect(console.info).toHaveBeenCalledWith("[API] API request");
    expect(console.warn).toHaveBeenCalledWith("[Auth] auth failed");
    expect(console.error).toHaveBeenCalledWith("[Chart] chart load failed");
  });

  it("supports custom logger prefixes and variadic arguments", () => {
    const { Logger } = loadLoggerModule("development");
    const customLogger = Logger.create("Custom");

    customLogger.info("message", "arg1", { key: "value" }, [1, 2, 3]);

    expect(console.info).toHaveBeenCalledWith(
      "[Custom] message",
      "arg1",
      { key: "value" },
      [1, 2, 3],
    );
  });

  it("does not prefix messages when prefix is empty", () => {
    const { Logger } = loadLoggerModule("development");
    const plainLogger = Logger.create("");

    plainLogger.error("plain error");

    expect(console.error).toHaveBeenCalledWith("plain error");
  });

  it("uses default empty prefix when constructed without arguments", () => {
    const { Logger } = loadLoggerModule("development");
    const plainLogger = new Logger();

    plainLogger.info("plain info");

    expect(console.info).toHaveBeenCalledWith("plain info");
  });
});
