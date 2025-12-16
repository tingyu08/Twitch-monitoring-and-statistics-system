import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E 測試配置
 *
 * 支援以下瀏覽器：
 * - Chromium (Chrome/Edge)
 * - Firefox
 * - WebKit (Safari)
 *
 * 執行方式：
 * - 全部瀏覽器：npx playwright test
 * - 僅 Chrome：npx playwright test --project=chromium
 * - 僅 Firefox：npx playwright test --project=firefox
 * - 僅 Safari：npx playwright test --project=webkit
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { outputFolder: "playwright-report" }], ["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // 視窗大小
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    // === 桌面瀏覽器 ===
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Chrome 特定設定
        launchOptions: {
          args: ["--disable-web-security"], // 開發環境允許跨域
        },
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
      },
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
      },
    },

    // === 行動裝置模擬（可選） ===
    // {
    //   name: 'mobile-chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'mobile-safari',
    //   use: { ...devices['iPhone 12'] },
    // },
  ],
  // webServer: {
  //   command: "npm run dev",
  //   url: "http://localhost:3000",
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120000,
  // },
});
