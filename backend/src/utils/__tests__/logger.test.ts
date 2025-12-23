import { logger } from "../logger";

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
});
