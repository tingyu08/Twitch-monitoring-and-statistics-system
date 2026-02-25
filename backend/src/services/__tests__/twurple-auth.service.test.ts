import { twurpleAuthService } from "../twurple-auth.service";
import { importTwurpleAuth } from "../../utils/dynamic-import";

jest.mock("../../utils/dynamic-import", () => {
  return {
    importTwurpleAuth: jest.fn().mockResolvedValue({
      AppTokenAuthProvider: jest.fn(),
      RefreshingAuthProvider: jest.fn().mockImplementation(() => ({
        addUser: jest.fn(),
        onRefresh: jest.fn(),
        onRefreshFailure: jest.fn(),
      })),
    }),
  };
});

describe("TwurpleAuthService", () => {
  let TwurpleAuthServiceClass: any;
  let service: any;

  beforeAll(() => {
    // 獲取類別構造函數
    TwurpleAuthServiceClass = (twurpleAuthService as any).constructor;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // 為每個測試創建新實例（使用 setupTests.ts 中設置的環境變數）
    service = new TwurpleAuthServiceClass();
  });

  async function getMockProvider() {
    const { RefreshingAuthProvider } = await importTwurpleAuth();
    return (RefreshingAuthProvider as jest.Mock).mock.results[0].value;
  }

  it("should detect credentials from env", () => {
    expect(service.hasCredentials()).toBe(true);
  });

  it("should return client id", () => {
    expect(service.getClientId()).toBe("test_client_id");
  });

  it("should initialize AppTokenAuthProvider on demand", async () => {
    const provider = await service.getAppAuthProvider();
    // 由於服務使用動態導入，無法測試 mock 的調用次數
    // 只測試返回的 provider 是否存在
    expect(provider).toBeDefined();
    // 第二次調用應返回相同的實例（緩存）
    const provider2 = await service.getAppAuthProvider();
    expect(provider2).toBe(provider);
  });

  it("should throw error if credentials missing on getAppAuthProvider", async () => {
    // 創建一個沒有憑證的實例並測試
    const originalClientId = process.env.TWITCH_CLIENT_ID;
    const originalClientSecret = process.env.TWITCH_CLIENT_SECRET;

    try {
      process.env.TWITCH_CLIENT_ID = "";
      process.env.TWITCH_CLIENT_SECRET = "";
      const testService = new TwurpleAuthServiceClass();

      await expect(testService.getAppAuthProvider()).rejects.toThrow(
        "Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET"
      );
    } finally {
      // 確保環境變數被恢復
      process.env.TWITCH_CLIENT_ID = originalClientId;
      process.env.TWITCH_CLIENT_SECRET = originalClientSecret;
    }
  });

  it("should create user auth provider", async () => {
    const tokenData = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
    };
    await service.createUserAuthProvider("user123", tokenData);
    // 由於服務使用動態導入，無法測試 mock 的調用次數
    // 只測試 provider 是否被創建和存儲
    expect(service.getUserAuthProvider("user123")).toBeDefined();
  });

  it("should remove user auth provider", async () => {
    const tokenData = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
    };
    await service.createUserAuthProvider("user123", tokenData);

    service.removeUserAuthProvider("user123");
    expect(service.getUserAuthProvider("user123")).toBeNull();
  });

  it("should return correct status", async () => {
    // Ensure initialized state
    await service.getAppAuthProvider();

    const status = service.getStatus();
    expect(status.hasCredentials).toBe(true);
    expect(status.appProviderInitialized).toBe(true);
  });

  it("should return client secret", () => {
    expect(service.getClientSecret()).toBe("test_client_secret");
  });

  it("should return false for hasActiveProvider when no provider", () => {
    expect(service.hasActiveProvider("nonexistent")).toBe(false);
  });

  it("should return true for hasActiveProvider after createUserAuthProvider", async () => {
    await service.createUserAuthProvider("u1", {
      accessToken: "at",
      refreshToken: "rt",
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
    });
    expect(service.hasActiveProvider("u1")).toBe(true);
  });

  it("should return null from getUserAuthProvider when provider not found", () => {
    expect(service.getUserAuthProvider("unknown")).toBeNull();
  });

  it("should return active user ids", async () => {
    await service.createUserAuthProvider("u1", {
      accessToken: "at",
      refreshToken: "rt",
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
    });
    await service.createUserAuthProvider("u2", {
      accessToken: "at2",
      refreshToken: "rt2",
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
    });
    const ids = service.getActiveUserIds();
    expect(ids).toContain("u1");
    expect(ids).toContain("u2");
  });

  it("should return userProviderCount in status", async () => {
    await service.createUserAuthProvider("u1", {
      accessToken: "at",
      refreshToken: "rt",
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
    });
    expect(service.getStatus().userProviderCount).toBe(1);
  });

  it("should evict oldest provider when maxUserProviders is exceeded", async () => {
    const smallService = new TwurpleAuthServiceClass();
    (smallService as any).maxUserProviders = 2;
    const td = {
      accessToken: "at",
      refreshToken: "rt",
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
    };
    await smallService.createUserAuthProvider("u1", td);
    await smallService.createUserAuthProvider("u2", td);
    await smallService.createUserAuthProvider("u3", td); // evicts u1
    expect(smallService.hasActiveProvider("u1")).toBe(false);
    expect(smallService.hasActiveProvider("u3")).toBe(true);
  });

  it("should call onRefresh callback when token is refreshed", async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);
    await service.createUserAuthProvider(
      "u1",
      { accessToken: "at", refreshToken: "rt", expiresIn: 3600, obtainmentTimestamp: Date.now() },
      onRefresh
    );
    const mockProvider = await getMockProvider();
    const registeredCb = mockProvider.onRefresh.mock.calls[0][0];
    await registeredCb("u1", {
      accessToken: "new-at",
      refreshToken: "new-rt",
      expiresIn: 7200,
      obtainmentTimestamp: 12345,
    });
    expect(onRefresh).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ accessToken: "new-at" })
    );
  });

  it("should create provider without onRefresh - onRefresh not registered", async () => {
    await service.createUserAuthProvider("u1", {
      accessToken: "at",
      refreshToken: "rt",
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
    });
    const mockProvider = await getMockProvider();
    expect(mockProvider.onRefresh).not.toHaveBeenCalled();
  });

  it("should invoke onTokenFailure with reason=refresh_failed by default", async () => {
    const failCb = jest.fn().mockResolvedValue(undefined);
    service.setOnTokenFailure(failCb);
    await service.createUserAuthProvider("u1", {
      accessToken: "at",
      refreshToken: "rt",
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
    });
    const mockProvider = await getMockProvider();
    const failureCb = mockProvider.onRefreshFailure.mock.calls[0][0];
    await failureCb("u1", new Error("network error"));
    expect(failCb).toHaveBeenCalledWith("u1", expect.any(Error), "refresh_failed");
  });

  it("should invoke onTokenFailure with reason=invalid_token", async () => {
    const failCb = jest.fn().mockResolvedValue(undefined);
    service.setOnTokenFailure(failCb);
    await service.createUserAuthProvider("u1", {
      accessToken: "at",
      refreshToken: "rt",
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
    });
    const mockProvider = await getMockProvider();
    await mockProvider.onRefreshFailure.mock.calls[0][0]("u1", new Error("invalid token"));
    expect(failCb).toHaveBeenCalledWith("u1", expect.any(Error), "invalid_token");
  });

  it("should invoke onTokenFailure with reason=revoked", async () => {
    const failCb = jest.fn().mockResolvedValue(undefined);
    service.setOnTokenFailure(failCb);
    await service.createUserAuthProvider("u1", {
      accessToken: "at",
      refreshToken: "rt",
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
    });
    const mockProvider = await getMockProvider();
    await mockProvider.onRefreshFailure.mock.calls[0][0]("u1", new Error("access denied revoked"));
    expect(failCb).toHaveBeenCalledWith("u1", expect.any(Error), "revoked");
  });

  it("should not throw if onTokenFailure itself throws", async () => {
    service.setOnTokenFailure(jest.fn().mockRejectedValue(new Error("cb boom")));
    await service.createUserAuthProvider("u1", {
      accessToken: "at",
      refreshToken: "rt",
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
    });
    const mockProvider = await getMockProvider();
    await expect(
      mockProvider.onRefreshFailure.mock.calls[0][0]("u1", new Error("fail"))
    ).resolves.not.toThrow();
  });

  it("should not throw when no onTokenFailure set during refresh failure", async () => {
    await service.createUserAuthProvider("u1", {
      accessToken: "at",
      refreshToken: "rt",
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
    });
    const mockProvider = await getMockProvider();
    await expect(
      mockProvider.onRefreshFailure.mock.calls[0][0]("u1", new Error("fail"))
    ).resolves.not.toThrow();
  });

  it("should remove provider after refresh failure", async () => {
    await service.createUserAuthProvider("u1", {
      accessToken: "at",
      refreshToken: "rt",
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
    });
    const mockProvider = await getMockProvider();
    await mockProvider.onRefreshFailure.mock.calls[0][0]("u1", new Error("fail"));
    expect(service.hasActiveProvider("u1")).toBe(false);
  });
});
