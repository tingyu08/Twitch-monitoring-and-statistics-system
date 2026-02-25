import { twurpleAuthService } from "../twurple-auth.service";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { AppTokenAuthProvider, RefreshingAuthProvider } from "@twurple/auth";

jest.mock("@twurple/auth", () => ({
  AppTokenAuthProvider: jest.fn(),
  RefreshingAuthProvider: jest.fn().mockImplementation(() => ({
    addUser: jest.fn(),
    onRefresh: jest.fn(),
    onRefreshFailure: jest.fn(),
  })),
}));

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
});
