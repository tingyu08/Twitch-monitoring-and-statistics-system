import { Logger, logger } from "../logger";

describe("Logger", () => {
  beforeEach(() => {
    jest.spyOn(console, "info").mockImplementation();
    jest.spyOn(console, "error").mockImplementation();
    jest.spyOn(console, "warn").mockImplementation();
    jest.spyOn(console, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should log info messages", () => {
    logger.info("Test", "Message", { data: 1 });
    expect(console.info).toHaveBeenCalled();
  });

  it("should log error messages", () => {
    logger.error("Test", "Fail", new Error("Boom"));
    expect(console.error).toHaveBeenCalled();
  });

  it("should log warn messages", () => {
    logger.warn("Test", "Careful");
    expect(console.warn).toHaveBeenCalled();
  });

  it("should log debug messages in development", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    // We need to re-create or force refersh isDevelopment
    (logger as any).isDevelopment = true;
    logger.debug("Test", "Debug info");
    expect(console.debug).toHaveBeenCalled();
    process.env.NODE_ENV = originalEnv;
  });

  it("should respect LOG_LEVEL threshold", () => {
    const original = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "warn";
    const testLogger = new Logger();

    testLogger.info("Test", "Info");
    testLogger.warn("Test", "Warn");

    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
    process.env.LOG_LEVEL = original;
  });

  it("should respect category log override", () => {
    const originalLevel = process.env.LOG_LEVEL;
    const originalOverrides = process.env.LOG_LEVEL_OVERRIDES;
    process.env.LOG_LEVEL = "error";
    process.env.LOG_LEVEL_OVERRIDES = "TEST:debug";

    const testLogger = new Logger();
    testLogger.debug("Test", "Debug by override");

    expect(console.debug).toHaveBeenCalled();
    process.env.LOG_LEVEL = originalLevel;
    process.env.LOG_LEVEL_OVERRIDES = originalOverrides;
  });

  it("should emit structured json logs when LOG_FORMAT=json", () => {
    const originalFormat = process.env.LOG_FORMAT;
    process.env.LOG_FORMAT = "json";

    const testLogger = new Logger();
    testLogger.error("Test", "JSON log", new Error("boom"));

    expect(console.error).toHaveBeenCalledTimes(1);
    const [serialized] = (console.error as jest.Mock).mock.calls[0];
    expect(typeof serialized).toBe("string");
    expect(serialized).toContain('"level":"error"');
    expect(serialized).toContain('"category":"Test"');
    expect(serialized).toContain('"message":"JSON log"');
    expect(serialized).toContain('"name":"Error"');

    process.env.LOG_FORMAT = originalFormat;
  });
});
