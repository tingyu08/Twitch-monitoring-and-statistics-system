import { Logger, logger, authLogger, streamerLogger, dbLogger } from "../logger";

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

describe("Logger - named loggers", () => {
  beforeEach(() => {
    jest.spyOn(console, "info").mockImplementation();
    jest.spyOn(console, "error").mockImplementation();
    jest.spyOn(console, "warn").mockImplementation();
    jest.spyOn(console, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("authLogger should log with AUTH category", () => {
    authLogger.info("Auth message");
    expect(console.info).toHaveBeenCalled();
    const call = (console.info as jest.Mock).mock.calls[0];
    expect(call[0]).toContain("AUTH");
  });

  it("streamerLogger should log with STREAMER category", () => {
    streamerLogger.warn("Streamer message");
    expect(console.warn).toHaveBeenCalled();
    const call = (console.warn as jest.Mock).mock.calls[0];
    expect(call[0]).toContain("STREAMER");
  });

  it("dbLogger should log with DATABASE category", () => {
    dbLogger.error("DB error");
    expect(console.error).toHaveBeenCalled();
    const call = (console.error as jest.Mock).mock.calls[0];
    expect(call[0]).toContain("DATABASE");
  });
});

describe("Logger - muted categories", () => {
  beforeEach(() => {
    jest.spyOn(console, "info").mockImplementation();
    jest.spyOn(console, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should not log muted categories", () => {
    const originalMute = process.env.LOG_MUTE_CATEGORIES;
    process.env.LOG_MUTE_CATEGORIES = "NOISY";
    const testLogger = new Logger();
    testLogger.info("NOISY", "Should be muted");
    expect(console.info).not.toHaveBeenCalled();
    process.env.LOG_MUTE_CATEGORIES = originalMute;
  });
});

describe("Logger - JSON format all levels", () => {
  beforeEach(() => {
    jest.spyOn(console, "info").mockImplementation();
    jest.spyOn(console, "warn").mockImplementation();
    jest.spyOn(console, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should emit JSON for info level", () => {
    const originalFormat = process.env.LOG_FORMAT;
    process.env.LOG_FORMAT = "json";
    const testLogger = new Logger();
    (testLogger as any).isDevelopment = true;
    testLogger.info("Test", "Info JSON");
    const [serialized] = (console.info as jest.Mock).mock.calls[0];
    expect(JSON.parse(serialized)).toMatchObject({ level: "info", message: "Info JSON" });
    process.env.LOG_FORMAT = originalFormat;
  });

  it("should emit JSON for warn level", () => {
    const originalFormat = process.env.LOG_FORMAT;
    process.env.LOG_FORMAT = "json";
    const testLogger = new Logger();
    testLogger.warn("Test", "Warn JSON");
    const [serialized] = (console.warn as jest.Mock).mock.calls[0];
    expect(JSON.parse(serialized)).toMatchObject({ level: "warn" });
    process.env.LOG_FORMAT = originalFormat;
  });

  it("should emit JSON for debug level", () => {
    const originalFormat = process.env.LOG_FORMAT;
    process.env.LOG_FORMAT = "json";
    const testLogger = new Logger();
    (testLogger as any).isDevelopment = true;
    (testLogger as any).defaultMinLevel = "debug";
    testLogger.debug("Test", "Debug JSON");
    const [serialized] = (console.debug as jest.Mock).mock.calls[0];
    expect(JSON.parse(serialized)).toMatchObject({ level: "debug" });
    process.env.LOG_FORMAT = originalFormat;
  });

  it("should normalize bigint in JSON format", () => {
    const originalFormat = process.env.LOG_FORMAT;
    process.env.LOG_FORMAT = "json";
    const testLogger = new Logger();
    testLogger.info("Test", "BigInt test", BigInt(9007199254740991));
    const [serialized] = (console.info as jest.Mock).mock.calls[0];
    const parsed = JSON.parse(serialized);
    expect(parsed.context[0]).toBe("9007199254740991");
    process.env.LOG_FORMAT = originalFormat;
  });

  it("should support LOG_LEVEL_OVERRIDES with = separator", () => {
    jest.spyOn(console, "error").mockImplementation();
    const originalOverrides = process.env.LOG_LEVEL_OVERRIDES;
    const originalLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "error";
    process.env.LOG_LEVEL_OVERRIDES = "SPECIAL=info";
    const testLogger = new Logger();
    testLogger.info("SPECIAL", "Should appear");
    expect(console.info).toHaveBeenCalled();
    process.env.LOG_LEVEL = originalLevel;
    process.env.LOG_LEVEL_OVERRIDES = originalOverrides;
    jest.restoreAllMocks();
  });
});
