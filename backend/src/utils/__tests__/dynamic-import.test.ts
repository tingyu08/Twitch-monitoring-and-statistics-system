jest.mock("../logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  dynamicImport,
  importTwurpleAuth,
  importTwurpleApi,
  importTwurpleChat,
  importTwurpleEventSub,
} from "../dynamic-import";

describe("dynamicImport", () => {
  describe("白名單外的模組", () => {
    it("應拒絕不在白名單的外部模組", async () => {
      await expect(dynamicImport("malicious-package")).rejects.toThrow(
        'Security: Module "malicious-package" is not in the allowed list.'
      );
    });

    it("應拒絕路徑遍歷嘗試", async () => {
      await expect(dynamicImport("../../etc/passwd")).rejects.toThrow("Security:");
    });

    it("應拒絕非白名單的絕對路徑", async () => {
      await expect(dynamicImport("/etc/passwd")).rejects.toThrow("Security:");
    });

    it("應拒絕相似但不同的模組名稱", async () => {
      await expect(dynamicImport("@twurple/api-extra")).rejects.toThrow("Security:");
    });

    it("應拒絕空字串", async () => {
      await expect(dynamicImport("")).rejects.toThrow("Security:");
    });
  });

  describe("白名單內的模組（真實 import 可能成功或失敗，但不因安全原因拒絕）", () => {
    const allowedModules = [
      "@twurple/api",
      "@twurple/auth",
      "@twurple/chat",
      "@twurple/eventsub-http",
    ];

    allowedModules.forEach((mod) => {
      it(`應允許 ${mod}（安全性通過，不拋出 Security 錯誤）`, async () => {
        try {
          await dynamicImport(mod);
          // 成功導入
        } catch (error) {
          // 如果失敗，確保不是因為安全原因
          expect((error as Error).message).not.toContain("Security:");
        }
      });
    });
  });

  describe("允許的內部路徑模式", () => {
    it("應允許 file:// 開頭且包含 backend/src/services/ 的路徑", async () => {
      const path = "file:///c/Users/user/backend/src/services/some.service.js";
      try {
        await dynamicImport(path);
      } catch (error) {
        expect((error as Error).message).not.toContain("Security:");
      }
    });

    it("應允許相對路徑 ../services/", async () => {
      try {
        await dynamicImport("../services/test");
      } catch (error) {
        expect((error as Error).message).not.toContain("Security:");
      }
    });

    it("應允許相對路徑 ../utils/", async () => {
      try {
        await dynamicImport("../utils/test");
      } catch (error) {
        expect((error as Error).message).not.toContain("Security:");
      }
    });
  });
});

describe("importTwurple* helpers", () => {
  const helpers = [
    { name: "importTwurpleApi", fn: importTwurpleApi },
    { name: "importTwurpleAuth", fn: importTwurpleAuth },
    { name: "importTwurpleChat", fn: importTwurpleChat },
    { name: "importTwurpleEventSub", fn: importTwurpleEventSub },
  ];

  helpers.forEach(({ name, fn }) => {
    it(`${name} 應回傳 Promise（不因安全原因拒絕）`, async () => {
      try {
        const result = await fn();
        expect(result).toBeDefined();
      } catch (error) {
        expect((error as Error).message).not.toContain("Security:");
      }
    });
  });
});
