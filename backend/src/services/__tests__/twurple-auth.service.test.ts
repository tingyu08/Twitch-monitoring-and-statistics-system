import { twurpleAuthService } from "../twurple-auth.service";
import { AppTokenAuthProvider, RefreshingAuthProvider } from "@twurple/auth";

jest.mock("@twurple/auth", () => ({
  AppTokenAuthProvider: jest.fn(),
  RefreshingAuthProvider: jest.fn().mockImplementation(() => ({
    addUser: jest.fn(),
    onRefresh: jest.fn(),
  })),
}));

describe("TwurpleAuthService", () => {
  const originalEnv = process.env;
  let service: any;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.TWITCH_CLIENT_ID = "test_client_id";
    process.env.TWITCH_CLIENT_SECRET = "test_client_secret";

    // Create a fresh instance for each test to pick up new env vars
    service = new (twurpleAuthService as any).constructor();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should detect credentials from env", () => {
    expect(service.hasCredentials()).toBe(true);
  });

  it("should return client id", () => {
    expect(service.getClientId()).toBe("test_client_id");
  });

  it("should initialize AppTokenAuthProvider on demand", () => {
    service.getAppAuthProvider(); // The variable assignment was removed as it was not directly used after the call
    expect(AppTokenAuthProvider).toHaveBeenCalledWith(
      "test_client_id",
      "test_client_secret"
    );
    expect(service.getAppAuthProvider()).toBeDefined(); // Replaced with direct call to ensure it's defined
  });

  it("should throw error if credentials missing on getAppAuthProvider", () => {
    // Reset service with missing env
    process.env.TWITCH_CLIENT_ID = "";
    service = new (twurpleAuthService as any).constructor();

    expect(() => service.getAppAuthProvider()).toThrow(
      "Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET"
    );
  });

  it("should create user auth provider", () => {
    const tokenData = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
    };
    service.createUserAuthProvider("user123", tokenData);
    expect(RefreshingAuthProvider).toHaveBeenCalled();
    expect(service.getUserAuthProvider("user123")).toBeDefined();
  });

  it("should remove user auth provider", () => {
    const tokenData = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
    };
    service.createUserAuthProvider("user123", tokenData);

    service.removeUserAuthProvider("user123");
    expect(service.getUserAuthProvider("user123")).toBeNull();
  });

  it("should return correct status", () => {
    // Ensure initialized state
    service.getAppAuthProvider();

    const status = service.getStatus();
    expect(status.hasCredentials).toBe(true);
    expect(status.appProviderInitialized).toBe(true);
  });
});
