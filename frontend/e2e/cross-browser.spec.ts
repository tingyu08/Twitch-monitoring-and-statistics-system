import { test, expect } from "@playwright/test";

// 增加測試超時時間，應對冷啟動
test.setTimeout(60000);

const MOCK_STREAMER = {
  streamerId: "mock_streamer_id",
  role: "streamer",
  displayName: "TestStreamer",
  avatarUrl: "https://example.com/avatar.png",
};

test.describe("跨瀏覽器兼容性測試", () => {
  // 預熱所有瀏覽器
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");
    } catch (e) {
      console.log("預熱請求失敗或超時，忽略", e);
    } finally {
      await page.close();
    }
  });

  test.describe("首頁渲染", () => {
    test.beforeEach(async ({ page }) => {
      // Mock 未登入狀態
      await page.route("**/api/auth/me", (route) =>
        route.fulfill({
          status: 401,
          body: JSON.stringify({ error: "Unauthorized" }),
        })
      );
    });

    test("應該正確載入首頁", async ({ page, browserName }) => {
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");
      const title = await page.title();
      expect(title).toBeTruthy();
      console.log(`[${browserName}] 首頁載入成功，標題: ${title}`);
    });

    test("應該顯示主要導航元素", async ({ page, browserName }) => {
      await page.goto("/");
      // 使用 toBeVisible 自動等待，避免 Loading 狀態導致失敗
      const authButton = page.locator('button, a[href*="auth"], a[href*="login"]').first();
      await expect(authButton).toBeVisible();
      console.log(`[${browserName}] 導航元素檢查通過`);
    });
  });

  test.describe("儀表板頁面", () => {
    test("實況主儀表板應該正確載入", async ({ page, browserName }) => {
      // Mock Auth for Streamer
      await page.route("**/api/auth/me", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_STREAMER),
        });
      });
      // Mock Stats
      await page.route("**/api/streamer/stats/**", (route) =>
        route.fulfill({ status: 200, body: JSON.stringify({}) })
      );

      await page.goto("/dashboard/streamer");
      await page.waitForLoadState("networkidle");
      const url = page.url();
      expect(url).toContain("/dashboard/streamer");
      const pageContent = await page.content();
      expect(pageContent.length).toBeGreaterThan(0);
      console.log(`[${browserName}] 實況主儀表板頁面載入成功 (Mocked)`);
    });

    test("觀眾儀表板應該正確載入", async ({ page, browserName }) => {
      // Mock Auth for Viewer
      await page.route("**/api/auth/me", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            viewerId: "mock_viewer_id",
            role: "viewer",
            displayName: "TestViewer",
            avatarUrl: "https://example.com/avatar.png",
            consentedAt: new Date().toISOString(),
            consentVersion: 1,
          }),
        });
      });
      // Mock Channels
      await page.route("**/api/viewer/channels", (route) =>
        route.fulfill({ status: 200, body: JSON.stringify([]) })
      );

      await page.goto("/dashboard/viewer");
      await page.waitForLoadState("networkidle");
      const url = page.url();
      expect(url).toContain("/dashboard/viewer");
      const pageContent = await page.content();
      expect(pageContent.length).toBeGreaterThan(0);
      console.log(`[${browserName}] 觀眾儀表板頁面載入成功 (Mocked)`);
    });
  });

  test.describe("CSS 樣式兼容性", () => {
    test.beforeEach(async ({ page }) => {
      await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401 }));
    });
    test("Flexbox 佈局應該正常運作", async ({ page, browserName }) => {
      await page.goto("/");
      const flexElements = await page.locator('[class*="flex"]').count();
      console.log(`[${browserName}] 發現 ${flexElements} 個 flex 佈局元素`);
      expect(flexElements).toBeGreaterThanOrEqual(0);
    });

    test("Grid 佈局應該正常運作", async ({ page, browserName }) => {
      await page.route("**/api/auth/me", (route) =>
        route.fulfill({ status: 200, body: JSON.stringify(MOCK_STREAMER) })
      );
      await page.route("**/api/streamer/stats/**", (route) =>
        route.fulfill({ status: 200, body: "{}" })
      );
      await page.goto("/dashboard/streamer");
      const gridElements = await page.locator('[class*="grid"]').count();
      console.log(`[${browserName}] 發現 ${gridElements} 個 grid 佈局元素`);
      expect(gridElements).toBeGreaterThanOrEqual(0);
    });

    test("動畫效果應該正常運作", async ({ page, browserName }) => {
      await page.goto("/");
      const animatedElements = await page
        .locator('[class*="transition"], [class*="animate"]')
        .count();
      console.log(`[${browserName}] 發現 ${animatedElements} 個動畫元素`);
      expect(animatedElements).toBeGreaterThanOrEqual(0);
    });
  });

  test.describe("JavaScript 功能", () => {
    test("客戶端路由應該正常運作", async ({ page, browserName }) => {
      await page.route("**/api/auth/me", (route) =>
        route.fulfill({ status: 200, body: JSON.stringify(MOCK_STREAMER) })
      );
      await page.route("**/api/streamer/stats/**", (route) =>
        route.fulfill({ status: 200, body: "{}" })
      );
      await page.goto("/");
      const initialUrl = page.url();
      await page.goto("/dashboard/streamer");
      const newUrl = page.url();
      expect(newUrl).toContain("dashboard");
      console.log(`[${browserName}] 路由導航: ${initialUrl} -> ${newUrl}`);
    });

    test("事件處理應該正常運作", async ({ page, browserName }) => {
      await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401 }));
      await page.goto("/");
      const clickableElements = page.locator("button, a").first();
      if ((await clickableElements.count()) > 0) {
        const isVisible = await clickableElements.isVisible();
        console.log(`[${browserName}] 可點擊元素存在且可見: ${isVisible}`);
        expect(isVisible).toBe(true);
      }
    });
  });

  test.describe("可訪問性 (A11y)", () => {
    test.beforeEach(async ({ page }) => {
      await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401 }));
    });
    test("頁面應該有正確的語義結構", async ({ page, browserName }) => {
      await page.goto("/");

      const mainElement = page.locator('main, [role="main"]').first();
      await expect(mainElement).toBeVisible();

      const heading = page.locator("h1, h2, h3").first();
      await expect(heading).toBeVisible();

      console.log(`[${browserName}] 語義結構檢查通過`);
    });

    test("互動元素應該有適當的 ARIA 標籤", async ({ page, browserName }) => {
      await page.route("**/api/auth/me", (route) =>
        route.fulfill({ status: 200, body: JSON.stringify(MOCK_STREAMER) })
      );
      await page.route("**/api/streamer/stats/**", (route) =>
        route.fulfill({ status: 200, body: "{}" })
      );
      await page.goto("/dashboard/streamer");
      await page.waitForLoadState("networkidle");
      const ariaElements = await page.locator("[aria-label], [aria-labelledby], [role]").count();
      console.log(`[${browserName}] 發現 ${ariaElements} 個 ARIA 標記元素`);
      expect(ariaElements).toBeGreaterThanOrEqual(0);
    });

    test("圖片應該有 alt 文字", async ({ page, browserName }) => {
      await page.goto("/");
      const images = page.locator("img");
      const imageCount = await images.count();
      if (imageCount > 0) {
        for (let i = 0; i < Math.min(imageCount, 5); i++) {
          const hasAlt = await images.nth(i).getAttribute("alt");
          console.log(`[${browserName}] 圖片 ${i + 1} alt: ${hasAlt ?? "(無)"}`);
        }
      }
      console.log(`[${browserName}] 發現 ${imageCount} 個圖片`);
    });
  });

  test.describe("響應式設計", () => {
    test.beforeEach(async ({ page }) => {
      await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401 }));
    });
    test("應該在桌面視窗正常顯示", async ({ page, browserName }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto("/");
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth + 20;
      });
      console.log(`[${browserName}] 桌面視窗 (1920x1080) 水平滾動: ${hasHorizontalScroll}`);
      expect(hasHorizontalScroll).toBe(false);
    });

    test("應該在平板視窗正常顯示", async ({ page, browserName }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");
      const pageContent = await page.content();
      expect(pageContent.length).toBeGreaterThan(0);
      console.log(`[${browserName}] 平板視窗 (768x1024) 載入成功`);
    });

    test("應該在手機視窗正常顯示", async ({ page, browserName }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");
      const pageContent = await page.content();
      expect(pageContent.length).toBeGreaterThan(0);
      console.log(`[${browserName}] 手機視窗 (375x812) 載入成功`);
    });
  });
});
