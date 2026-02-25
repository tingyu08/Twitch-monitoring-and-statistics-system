/**
 * Tests for src/config/env.ts
 *
 * env.ts executes at import time (side effects), so each branch test
 * must use jest.isolateModules() after setting process.env to the
 * desired state. We also mock dotenv so it does not read disk files.
 */

jest.mock("dotenv", () => ({ config: jest.fn() }));

// Keep a snapshot of the original env so we can restore it after each test.
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  // Restore original environment completely.
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: load env module in isolation with given process.env overrides.
// Returns the module exports so tests can inspect env object.
// ─────────────────────────────────────────────────────────────────────────────
function loadEnvModule(envOverrides: Record<string, string | undefined>) {
  // Apply overrides before isolating so the module sees them on import.
  // Keys explicitly set to undefined must be deleted from process.env.
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  let envModule: any;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    envModule = require("../env");
  });
  return envModule;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: getRequiredEnv branches (tested indirectly via env object properties)
// ─────────────────────────────────────────────────────────────────────────────

describe("env - test environment (NODE_ENV=test)", () => {
  it("uses provided env variable value when it exists", () => {
    const { env } = loadEnvModule({
      NODE_ENV: "test",
      APP_JWT_SECRET: "my-jwt-secret",
      VIEWER_TOKEN_ENCRYPTION_KEY: "my-enc-key",
    });

    expect(env.nodeEnv).toBe("test");
  });

  it("falls back to defaultValue when env var is missing in test env", () => {
    // APP_JWT_SECRET has a default in getRequiredEnv calls inside env.ts
    // but we can verify the exported port uses process.env.PORT or 4000 default
    const { env } = loadEnvModule({
      NODE_ENV: "test",
      APP_JWT_SECRET: "any",
      VIEWER_TOKEN_ENCRYPTION_KEY: "any",
      PORT: undefined,
    });

    expect(env.port).toBe(4000);
  });

  it("returns correct port when PORT is set", () => {
    const { env } = loadEnvModule({
      NODE_ENV: "test",
      APP_JWT_SECRET: "any",
      VIEWER_TOKEN_ENCRYPTION_KEY: "any",
      PORT: "5000",
    });

    expect(env.port).toBe(5000);
  });

  it("exports twitchClientId from TWITCH_CLIENT_ID env var", () => {
    const { env } = loadEnvModule({
      NODE_ENV: "test",
      TWITCH_CLIENT_ID: "test_client_id_value",
      TWITCH_CLIENT_SECRET: "test_secret_value",
      APP_JWT_SECRET: "any",
      VIEWER_TOKEN_ENCRYPTION_KEY: "any",
    });

    expect(env.twitchClientId).toBe("test_client_id_value");
  });

  it("exports twitchClientSecret from TWITCH_CLIENT_SECRET env var", () => {
    const { env } = loadEnvModule({
      NODE_ENV: "test",
      TWITCH_CLIENT_ID: "cid",
      TWITCH_CLIENT_SECRET: "csecret",
      APP_JWT_SECRET: "any",
      VIEWER_TOKEN_ENCRYPTION_KEY: "any",
    });

    expect(env.twitchClientSecret).toBe("csecret");
  });

  it("uses default twitchRedirectUri when not set", () => {
    const { env } = loadEnvModule({
      NODE_ENV: "test",
      APP_JWT_SECRET: "any",
      VIEWER_TOKEN_ENCRYPTION_KEY: "any",
      TWITCH_REDIRECT_URI: undefined,
    });

    expect(env.twitchRedirectUri).toBe("http://localhost:3000/auth/callback");
  });

  it("uses provided TWITCH_REDIRECT_URI when set", () => {
    const { env } = loadEnvModule({
      NODE_ENV: "test",
      APP_JWT_SECRET: "any",
      VIEWER_TOKEN_ENCRYPTION_KEY: "any",
      TWITCH_REDIRECT_URI: "http://custom.host/callback",
    });

    expect(env.twitchRedirectUri).toBe("http://custom.host/callback");
  });

  it("uses default frontendUrl when FRONTEND_URL is not set", () => {
    const { env } = loadEnvModule({
      NODE_ENV: "test",
      APP_JWT_SECRET: "any",
      VIEWER_TOKEN_ENCRYPTION_KEY: "any",
      FRONTEND_URL: undefined,
    });

    expect(env.frontendUrl).toBe("http://localhost:3000");
  });

  it("does not throw when VIEWER_TOKEN_ENCRYPTION_KEY is missing in test env", () => {
    // In test env the !isTest guard prevents the throw
    expect(() => {
      loadEnvModule({
        NODE_ENV: "test",
        APP_JWT_SECRET: "any",
        VIEWER_TOKEN_ENCRYPTION_KEY: undefined,
      });
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: development environment (NODE_ENV=development)
// ─────────────────────────────────────────────────────────────────────────────

describe("env - development environment (NODE_ENV=development)", () => {
  it("emits console.warn when TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are missing", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    loadEnvModule({
      NODE_ENV: "development",
      TWITCH_CLIENT_ID: undefined,
      TWITCH_CLIENT_SECRET: undefined,
      APP_JWT_SECRET: "dev-jwt",
      VIEWER_TOKEN_ENCRYPTION_KEY: "dev-enc-key",
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("TWITCH_CLIENT_ID"));
    warnSpy.mockRestore();
  });

  it("does not emit console.warn when Twitch credentials are present", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    loadEnvModule({
      NODE_ENV: "development",
      TWITCH_CLIENT_ID: "cid",
      TWITCH_CLIENT_SECRET: "csecret",
      APP_JWT_SECRET: "dev-jwt",
      VIEWER_TOKEN_ENCRYPTION_KEY: "dev-enc-key",
    });

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("throws when VIEWER_TOKEN_ENCRYPTION_KEY is missing in development", () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => {
      loadEnvModule({
        NODE_ENV: "development",
        APP_JWT_SECRET: "dev-jwt",
        VIEWER_TOKEN_ENCRYPTION_KEY: undefined,
        TWITCH_CLIENT_ID: "cid",
        TWITCH_CLIENT_SECRET: "csecret",
      });
    }).toThrow("VIEWER_TOKEN_ENCRYPTION_KEY");

    jest.restoreAllMocks();
  });

  it("throws when APP_JWT_SECRET is missing in development", () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => {
      loadEnvModule({
        NODE_ENV: "development",
        APP_JWT_SECRET: undefined,
        VIEWER_TOKEN_ENCRYPTION_KEY: "dev-enc-key",
        TWITCH_CLIENT_ID: "cid",
        TWITCH_CLIENT_SECRET: "csecret",
      });
    }).toThrow("APP_JWT_SECRET");

    jest.restoreAllMocks();
  });

  it("returns empty string for env var with no value and no default in development", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    // Explicitly delete keys that may be set by setupTests.ts before loading module.
    delete process.env.TWITCH_CLIENT_ID;
    delete process.env.TWITCH_CLIENT_SECRET;

    const { env } = loadEnvModule({
      NODE_ENV: "development",
      APP_JWT_SECRET: "dev-jwt",
      VIEWER_TOKEN_ENCRYPTION_KEY: "dev-enc-key",
    });

    // twitchClientId has no default value in getRequiredEnv call → returns ""
    expect(env.twitchClientId).toBe("");
    warnSpy.mockRestore();
  });
});
