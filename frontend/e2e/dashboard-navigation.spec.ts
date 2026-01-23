import { test, expect } from "@playwright/test";

test.describe("Dashboard Navigation (with mocked auth)", () => {
  test.beforeEach(async ({ page, context }) => {
    // Mock authentication state
    // This sets cookies that simulate a logged-in user
    await context.addCookies([
      {
        name: "twitch-session",
        value: "mock-session-token",
        domain: "localhost",
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);

    // Mock the /api/auth/me endpoint to return user data
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          streamerId: "test-streamer-123",
          twitchUserId: "test-twitch-id",
          displayName: "Test Streamer",
          avatarUrl: "https://static-cdn.jtvnw.net/user-default-pictures-uv/placeholder.png",
          channelUrl: "https://twitch.tv/teststreamer",
          role: "streamer",
        }),
      });
    });

    // Mock streamer API endpoints to prevent 404s
    await page.route("**/api/streamer/summary**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalHours: 120.5,
          totalSessions: 45,
          avgViewers: 250,
          peakViewers: 850,
        }),
      });
    });

    await page.route("**/api/streamer/time-series**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/streamer/heatmap**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/streamer/subscription-trend**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          range: "30d",
          data: [],
          hasExactData: false,
          isEstimated: true,
          estimateSource: "daily_snapshot",
          minDataDays: 7,
          currentDataDays: 0,
          availableDays: 0,
        }),
      });
    });
  });

  test("should load dashboard after authentication", async ({ page }) => {
    // Start navigation and wait for API call
    const authPromise = page.waitForResponse(
      (response) => response.url().includes("/api/auth/me") && response.status() === 200
    );
    await page.goto("/dashboard/streamer");
    await authPromise;

    // Wait for network to be idle
    await page.waitForLoadState("networkidle");

    // Should be on dashboard, not redirected
    await expect(page).toHaveURL("/dashboard/streamer");

    // Should show dashboard content using data-testid
    await expect(page.getByTestId("dashboard-title")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("dashboard-title")).toHaveText("實況主儀表板");
  });

  test("should display user profile information", async ({ page }) => {
    const authPromise = page.waitForResponse(
      (response) => response.url().includes("/api/auth/me") && response.status() === 200
    );
    await page.goto("/dashboard/streamer");
    await authPromise;

    // Wait for dashboard to load
    await page.waitForLoadState("networkidle");

    // Should show username using data-testid
    await expect(page.getByTestId("user-greeting")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("user-greeting")).toContainText("Test Streamer");
  });

  test("should have working logout button", async ({ page }) => {
    // Mock logout endpoint before navigation
    await page.route("**/api/auth/logout", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    const authPromise = page.waitForResponse(
      (response) => response.url().includes("/api/auth/me") && response.status() === 200
    );
    await page.goto("/dashboard/streamer");
    await authPromise;

    // Find and click logout button using data-testid (don't use networkidle)
    const logoutButton = page.getByTestId("logout-button");
    await expect(logoutButton).toBeVisible({ timeout: 15000 });

    await logoutButton.click();

    // Should redirect to home/login
    await page.waitForURL(/\/(login)?$/, { timeout: 10000 });
  });
});
