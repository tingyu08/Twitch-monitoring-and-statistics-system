import { test, expect } from '@playwright/test';

test.describe('Display Preferences (Story 1.5)', () => {
  test.beforeEach(async ({ page, context }) => {
    // Clear localStorage to reset preferences
    await context.addInitScript(() => {
      localStorage.removeItem('bmad.streamerDashboard.uiPreferences.v1');
    });

    // Mock authentication
    await context.addCookies([
      {
        name: 'twitch-session',
        value: 'mock-session-token',
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    // Mock auth endpoint
    await page.route('**/api/auth/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          userId: 'test-user-id',
          streamerId: 'test-streamer-123',
          username: 'TestStreamer',
          displayName: 'Test Streamer',
          avatarUrl: 'https://static-cdn.jtvnw.net/user-default-pictures-uv/placeholder.png',
          channelId: 'test-channel-id',
        }),
      });
    });

    // Mock streamer summary data
    await page.route('**/api/streamer/me/summary**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          range: '30d',
          totalStreamHours: 120.5,
          totalStreamSessions: 45,
          avgStreamDurationMinutes: 161,
          isEstimated: false,
        }),
      });
    });

    // Mock time series data
    await page.route('**/api/streamer/me/time-series**', async route => {
      const mockData = Array.from({ length: 7 }, (_, i) => ({
        date: new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        totalHours: Math.random() * 8 + 2,
        sessionCount: Math.floor(Math.random() * 3) + 1,
      }));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          range: '30d',
          granularity: 'day',
          data: mockData,
          isEstimated: false,
        }),
      });
    });

    // Mock heatmap data
    await page.route('**/api/streamer/me/heatmap**', async route => {
      const mockData: Array<{ dayOfWeek: number; hour: number; value: number }> = [];
      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          mockData.push({
            dayOfWeek: day,
            hour,
            value: Math.random() > 0.7 ? Math.random() * 3 : 0,
          });
        }
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          range: '30d',
          data: mockData,
          maxValue: 3,
          minValue: 0,
          isEstimated: false,
        }),
      });
    });

    // Mock subscription trend data
    await page.route('**/api/streamer/me/subscription-trend**', async route => {
      const mockData = {
        range: '30d',
        data: Array.from({ length: 7 }, (_, i) => ({
          date: new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          subsTotal: 100 + Math.floor(Math.random() * 20),
          subsDelta: Math.floor(Math.random() * 10) - 5,
        })),
        hasExactData: false,
        isEstimated: true,
        estimateSource: 'daily_snapshot',
        minDataDays: 7,
        currentDataDays: 7,
        availableDays: 7,
      };

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockData),
      });
    });
  });

  test('should show display preferences button', async ({ page }) => {
    await page.goto('/dashboard/streamer');
    await page.waitForLoadState('networkidle');

    // Find the display preferences button
    const prefsButton = page.getByTestId('display-preferences-button');
    await expect(prefsButton).toBeVisible({ timeout: 10000 });
    await expect(prefsButton).toContainText('顯示設定');
    await expect(prefsButton).toContainText('(4/4)'); // All 4 sections visible by default
  });

  test('should open dropdown panel when clicking preferences button', async ({ page }) => {
    await page.goto('/dashboard/streamer');
    await page.waitForLoadState('networkidle');

    // Click the preferences button
    const prefsButton = page.getByTestId('display-preferences-button');
    await prefsButton.click();

    // Check that dropdown panel is visible
    const panel = page.getByTestId('display-preferences-panel');
    await expect(panel).toBeVisible({ timeout: 5000 });

    // Check panel contains toggle options (use actual labels from PREFERENCE_ITEMS)
    await expect(panel.getByText('顯示/隱藏儀表板區塊')).toBeVisible();
    await expect(panel.getByText('開台統計總覽', { exact: true })).toBeVisible();
    await expect(panel.getByText('開台時間分析', { exact: true })).toBeVisible();
    await expect(panel.getByText('開台時段分布', { exact: true })).toBeVisible();
    await expect(panel.getByText('訂閱數趨勢', { exact: true })).toBeVisible();
  });

  test('should toggle section visibility when clicking toggle', async ({ page }) => {
    await page.goto('/dashboard/streamer');
    await page.waitForLoadState('networkidle');

    // Verify summary section is visible initially
    await expect(page.getByTestId('summary-section')).toBeVisible({ timeout: 10000 });

    // Open preferences panel
    await page.getByTestId('display-preferences-button').click();
    await expect(page.getByTestId('display-preferences-panel')).toBeVisible();

    // Click the first toggle label (the input is sr-only, so click the label)
    const summaryToggle = page.locator('label[for="pref-showSummaryCards"]');
    await summaryToggle.click();

    // Summary section should be hidden
    await expect(page.getByTestId('summary-section')).not.toBeVisible({ timeout: 5000 });

    // Button should show (3/4)
    await expect(page.getByTestId('display-preferences-button')).toContainText('(3/4)');
  });

  test('should hide all sections when clicking "全部隱藏"', async ({ page }) => {
    await page.goto('/dashboard/streamer');
    await page.waitForLoadState('networkidle');

    // Open preferences panel
    await page.getByTestId('display-preferences-button').click();

    // Click "全部隱藏"
    await page.getByTestId('hide-all-button').click();

    // All sections should be hidden
    await expect(page.getByTestId('summary-section')).not.toBeVisible();
    await expect(page.getByTestId('timeseries-section')).not.toBeVisible();
    await expect(page.getByTestId('heatmap-section')).not.toBeVisible();
    await expect(page.getByTestId('subscription-section')).not.toBeVisible();

    // Should show empty state message
    await expect(page.getByText('所有圖表都被隱藏')).toBeVisible();

    // Button should show (0/4)
    await expect(page.getByTestId('display-preferences-button')).toContainText('(0/4)');
  });

  test('should show all sections when clicking "全部顯示"', async ({ page }) => {
    await page.goto('/dashboard/streamer');
    await page.waitForLoadState('networkidle');

    // First hide all
    await page.getByTestId('display-preferences-button').click();
    await page.getByTestId('hide-all-button').click();

    // Verify all hidden
    await expect(page.getByTestId('summary-section')).not.toBeVisible();

    // Click "全部顯示"
    await page.getByTestId('show-all-button').click();

    // All sections should be visible
    await expect(page.getByTestId('summary-section')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('timeseries-section')).toBeVisible();
    await expect(page.getByTestId('heatmap-section')).toBeVisible();
    await expect(page.getByTestId('subscription-section')).toBeVisible();

    // Button should show (4/4)
    await expect(page.getByTestId('display-preferences-button')).toContainText('(4/4)');
  });

  test('should close dropdown when clicking outside', async ({ page }) => {
    await page.goto('/dashboard/streamer');
    await page.waitForLoadState('networkidle');

    // Open preferences panel
    await page.getByTestId('display-preferences-button').click();
    await expect(page.getByTestId('display-preferences-panel')).toBeVisible();

    // Click outside the dropdown (on the dashboard header)
    await page.getByTestId('dashboard-header').click();

    // Panel should be closed
    await expect(page.getByTestId('display-preferences-panel')).not.toBeVisible({ timeout: 3000 });
  });

  test('should persist preferences in localStorage', async ({ page }) => {
    await page.goto('/dashboard/streamer');
    await page.waitForLoadState('networkidle');

    // Hide summary section
    await page.getByTestId('display-preferences-button').click();
    await page.locator('label[for="pref-showSummaryCards"]').click();

    // Verify it's hidden
    await expect(page.getByTestId('summary-section')).not.toBeVisible();

    // Get the localStorage value to verify it was saved
    const savedPrefs = await page.evaluate(() => {
      return localStorage.getItem('bmad.streamerDashboard.uiPreferences.v1');
    });

    // Verify localStorage was updated correctly
    expect(savedPrefs).toBeTruthy();
    const prefs = JSON.parse(savedPrefs!);
    expect(prefs.showSummaryCards).toBe(false);
    expect(prefs.showTimeSeriesChart).toBe(true);
    expect(prefs.showHeatmapChart).toBe(true);
    expect(prefs.showSubscriptionChart).toBe(true);

    // Button should show (3/4)
    await expect(page.getByTestId('display-preferences-button')).toContainText('(3/4)');
  });
});
