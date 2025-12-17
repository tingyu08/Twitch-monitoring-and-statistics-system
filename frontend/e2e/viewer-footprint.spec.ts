import { test, expect } from "@playwright/test";

// Mock data for viewer footprint tests
const mockViewerUser = {
  id: "viewer-123",
  displayName: "測試觀眾",
  avatarUrl: "https://ui-avatars.com/api/?name=Test",
  role: "viewer",
  isViewer: true,
  viewerId: "v-123",
  consentedAt: "2025-01-01T00:00:00Z",
};

const mockLifetimeStats = {
  channelId: "ch_1",
  channelName: "shroud",
  channelDisplayName: "Shroud",
  lifetimeStats: {
    watchTime: {
      totalMinutes: 15600,
      totalHours: 260,
      avgSessionMinutes: 45,
      firstWatchedAt: "2024-01-15T10:00:00Z",
      lastWatchedAt: "2025-12-11T20:30:00Z",
    },
    messages: {
      totalMessages: 3420,
      chatMessages: 3100,
      subscriptions: 12,
      cheers: 150,
      totalBits: 15000,
    },
    loyalty: {
      trackingDays: 331,
      longestStreakDays: 45,
      currentStreakDays: 7,
    },
    activity: {
      activeDaysLast30: 18,
      activeDaysLast90: 52,
      mostActiveMonth: "2025-11",
      mostActiveMonthCount: 22,
    },
    rankings: {
      watchTimePercentile: 92.5,
      messagePercentile: 87.3,
    },
  },
  badges: [
    {
      id: "iron-fan",
      name: "鐵粉",
      icon: "💎",
      category: "watch-time",
      unlockedAt: "2025-06-01T00:00:00Z",
      progress: 100,
    },
    {
      id: "chatterbox",
      name: "話痨",
      icon: "🗣️",
      category: "messages",
      unlockedAt: "2025-03-15T00:00:00Z",
      progress: 100,
    },
  ],
  radarScores: {
    watchTime: 85,
    interaction: 78,
    loyalty: 90,
    activity: 60,
    contribution: 45,
    community: 67,
  },
};

test.describe("Viewer Footprint Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    // Mock Auth API
    await page.route("*/**/api/auth/me", async (route) => {
      await route.fulfill({ json: mockViewerUser });
    });

    // Mock Lifetime Stats API
    await page.route("*/**/api/viewer/**/channels/**/lifetime-stats", async (route) => {
      await route.fulfill({ json: mockLifetimeStats });
    });

    // Mock Dashboard Layout API (GET)
    await page.route("*/**/api/viewer/dashboard-layout/**", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { layout: null } });
      } else if (route.request().method() === "DELETE") {
        await route.fulfill({ json: { success: true } });
      } else {
        await route.fulfill({ json: { success: true } });
      }
    });

    // Mock Dashboard Layout API (POST)
    await page.route("*/**/api/viewer/dashboard-layout", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({ json: { success: true } });
      }
    });
  });

  test("should load dashboard successfully", async ({ page }) => {
    await page.goto("/dashboard/viewer/footprint/ch_1");

    // Wait for page title
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "觀眾足跡總覽",
      { timeout: 30000 }
    );

    // Check for channel name displayed (use exact match to avoid multiple elements)
    await expect(page.getByText("Shroud", { exact: true }).first()).toBeVisible();
  });

  test("should show reset button", async ({ page }) => {
    await page.goto("/dashboard/viewer/footprint/ch_1");

    // Wait for grid to load by waiting for the reset button
    await expect(page.getByRole("button", { name: "重置佈局" })).toBeVisible({
      timeout: 30000,
    });
  });

  test("should display stat cards", async ({ page }) => {
    await page.goto("/dashboard/viewer/footprint/ch_1");

    // Wait for page to load
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "觀眾足跡總覽",
      { timeout: 30000 }
    );

    // Verify stat cards are visible
    await expect(page.getByText("總觀看時數")).toBeVisible();
    await expect(page.getByText("總留言數")).toBeVisible();
  });

  test("should display radar chart", async ({ page }) => {
    await page.goto("/dashboard/viewer/footprint/ch_1");

    // Wait for page to load
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "觀眾足跡總覽",
      { timeout: 30000 }
    );

    // Verify radar chart card is visible
    await expect(page.getByText("投入分析")).toBeVisible();
  });

  test("should display badges", async ({ page }) => {
    await page.goto("/dashboard/viewer/footprint/ch_1");

    // Wait for page to load
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "觀眾足跡總覽",
      { timeout: 30000 }
    );

    // Verify badges card is visible
    await expect(page.getByText("成就徽章")).toBeVisible();
  });
});
