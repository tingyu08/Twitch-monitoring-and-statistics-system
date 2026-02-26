import { test, expect } from "@playwright/test";

test.describe("Viewer Privacy Settings", () => {
  test.beforeEach(async ({ page }) => {
    // Mock authenticated viewer with consent
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          viewerId: "v1",
          twitchUserId: "t1",
          displayName: "TestViewer",
          avatarUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/test-avatar-70x70.png",
          role: "viewer",
          isViewer: true,
          consentedAt: "2025-01-01T00:00:00Z",
        }),
      });
    });

    // Mock initial settings
    await page.route("**/api/viewer/privacy/consent", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          json: {
            success: true,
            settings: {
              collectDailyWatchTime: true,
            },
            hasConsent: true,
          },
        });
      } else if (route.request().method() === "PATCH") {
        await route.fulfill({
          json: { success: true, message: "Settings updated" },
        });
      }
    });

    // Mock summary
    await page.route("**/api/viewer/privacy/data-summary", async (route) => {
      await route.fulfill({
        json: {
          totalMessages: 100,
          totalAggregations: 50,
          channelCount: 3,
          dateRange: { oldest: "2024-01-01", newest: "2024-02-01" },
        },
      });
    });

    // Mock deletion status
    await page.route("**/api/viewer/privacy/deletion-status", async (route) => {
      await route.fulfill({ json: { hasPendingDeletion: false } });
    });

    // Mock preference status endpoints used by settings + consent banner
    await page.route("**/api/viewer/pref/status", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { hasConsent: true } });
        return;
      }

      await route.fulfill({ json: { success: true } });
    });

    await page.route("**/api/viewer/pref/opt-all", async (route) => {
      await route.fulfill({ json: { success: true } });
    });

    await page.goto("/dashboard/viewer/settings");

    // Dismiss privacy banner if it overlays action buttons
    const acceptAllButton = page.getByRole("button", { name: "接受全部" });
    if (await acceptAllButton.isVisible().catch(() => false)) {
      await acceptAllButton.click();
    }
  });

  test("should display privacy settings sections", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    // Verify Profile section
    await expect(page.getByText("個人資料")).toBeVisible();
    await expect(page.getByText("Twitch ID: t1")).toBeVisible();

    // Verify Data Summary (Mocked to 100)
    await expect(page.getByText("100")).toBeVisible();
    await expect(page.getByText("總訊息數")).toBeVisible();
  });

  test("should toggle privacy switch", async ({ page }) => {
    // Wait for settings to load
    await expect(page.getByText("個人資料")).toBeVisible();

    // Toggle the first switch in the Privacy Section
    const switchButton = page.locator("button.rounded-full").first();
    await expect(switchButton).toBeVisible();

    // Start waiting for request before clicking
    const requestPromise = page.waitForRequest(
      (request) =>
        request.url().includes("/api/viewer/pref/status") && request.method() === "PATCH"
    );

    await switchButton.click();

    // Wait for the request to happen
    await requestPromise;
  });

  test("should handle export flow", async ({ page }) => {
    await page.route("**/api/viewer/privacy/export", async (route) => {
      await route.fulfill({
        json: { success: true, jobId: "job1", status: "pending" },
      });
    });

    await page.getByText("匯出我的資料").click(); // This is the title
    // The button says "📤 匯出資料"
    await page.getByRole("button", { name: "📤 匯出資料" }).click();

    // Verify request
    await expect(page.getByText("資料匯出完成！")).toBeVisible(); // Mocked success message
  });

  test("should handle account deletion flow", async ({ page }) => {
    await page.route("**/api/viewer/privacy/delete-account", async (route) => {
      await route.fulfill({
        json: {
          success: true,
          scheduledAt: new Date().toISOString(),
        },
      });
    });

    const deleteRequest = page.waitForRequest(
      (request) =>
        request.url().includes("/api/viewer/privacy/delete-account") && request.method() === "POST"
    );

    const acceptAllButton = page.getByRole("button", { name: "接受全部" });
    if (await acceptAllButton.isVisible().catch(() => false)) {
      await acceptAllButton.click();
      await expect(acceptAllButton).not.toBeVisible({ timeout: 3000 });
    }

    const deleteButton = page.getByRole("button", { name: /刪除帳號/ });
    await deleteButton.evaluate((el) => (el as HTMLButtonElement).click());

    const confirmButton = page.getByRole("button", { name: /確認刪除|確認/ });
    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click();
    }

    await deleteRequest;

    // Expect status update
    await expect(page.getByText(/刪除請求已建立|已安排於/)).toBeVisible();
  });
});
