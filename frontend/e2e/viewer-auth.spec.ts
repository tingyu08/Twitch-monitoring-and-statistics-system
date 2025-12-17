import { test, expect } from '@playwright/test';

test.describe('Viewer Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display unified login button on homepage', async ({ page }) => {
    // Single unified login entry (after login, users can switch between streamer/viewer dashboard)
    const loginButton = page.getByRole('button', { name: /前往登入|登入/i });
    await expect(loginButton).toBeVisible();
    await expect(loginButton).toBeEnabled();
  });

  test('login button should be keyboard accessible', async ({ page }) => {
    const loginButton = page.getByRole('button', { name: /前往登入|登入/i });
    await loginButton.focus();
    await expect(loginButton).toBeFocused();
  });
});

test.describe('Viewer Consent Flow', () => {
  test('should redirect non-consented viewer to consent page', async ({ page }) => {
    // Mock /api/auth/me to return a viewer without consent
    await page.route('**/api/auth/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          viewerId: 'v1',
          twitchUserId: 't1',
          displayName: 'TestViewer',
          avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/test-avatar-70x70.png',
          role: 'viewer',
          consentedAt: null,
        }),
      });
    });

    // Access viewer dashboard directly
    await page.goto('/dashboard/viewer');

    // Should be redirected to consent page
    await page.waitForURL(/\/auth\/viewer\/consent/, { timeout: 5000 });

    // Verify consent page content
    await expect(page.getByText('資料使用說明與隱私同意')).toBeVisible();
    await expect(page.getByRole('button', { name: '同意並繼續' })).toBeVisible();
    await expect(page.getByRole('button', { name: /不同意/i })).toBeVisible();
  });

  test('consent page should display privacy information sections', async ({ page }) => {
    // Mock authenticated viewer without consent
    await page.route('**/api/auth/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          viewerId: 'v1',
          twitchUserId: 't1',
          displayName: 'TestViewer',
          avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/test-avatar-70x70.png',
          role: 'viewer',
          consentedAt: null,
        }),
      });
    });

    await page.goto('/auth/viewer/consent');

    // Verify all privacy sections are visible
    await expect(page.getByText('我們會收集的資料：')).toBeVisible();
    await expect(page.getByText('資料使用目的：')).toBeVisible();
    await expect(page.getByText('您的權利：')).toBeVisible();

    // Verify specific items in each section
    await expect(page.getByText(/Twitch 帳號基本資訊/)).toBeVisible();
    await expect(page.getByText(/觀看時數統計/)).toBeVisible();
    await expect(page.getByText(/隨時可以在設定中撤銷授權/)).toBeVisible();
  });

  test('clicking consent should redirect to viewer dashboard', async ({ page }) => {
    // Mock authenticated viewer without consent
    await page.route('**/api/auth/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          viewerId: 'v1',
          twitchUserId: 't1',
          displayName: 'TestViewer',
          avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/test-avatar-70x70.png',
          role: 'viewer',
          consentedAt: null,
        }),
      });
    });

    // Mock consent API
    await page.route('**/api/viewer/consent', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, consentedAt: new Date().toISOString() }),
      });
    });

    await page.goto('/auth/viewer/consent');

    // Click consent button
    const consentButton = page.getByRole('button', { name: '同意並繼續' });
    await consentButton.click();

    // Should redirect to viewer dashboard
    await page.waitForURL(/\/dashboard\/viewer/, { timeout: 5000 });
  });

  test('clicking decline should logout and redirect to home', async ({ page }) => {
    let isLoggedIn = true;

    // Mock authenticated viewer without consent (changes after logout)
    await page.route('**/api/auth/me', async route => {
      if (isLoggedIn) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            viewerId: 'v1',
            twitchUserId: 't1',
            displayName: 'TestViewer',
            avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/test-avatar-70x70.png',
            role: 'viewer',
            consentedAt: null,
          }),
        });
      } else {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Unauthorized' }),
        });
      }
    });

    // Mock logout API
    await page.route('**/api/auth/logout', async route => {
      isLoggedIn = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Logged out' }),
      });
    });

    await page.goto('/auth/viewer/consent');

    // Click decline button
    const declineButton = page.getByRole('button', { name: /不同意/i });
    await declineButton.click();

    // Should redirect to home page
    await page.waitForURL(/\/(login)?$/, { timeout: 10000 });

    // Verify unified login button is visible
    await expect(page.getByRole('button', { name: /前往登入|登入/i })).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Viewer Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authenticated viewer with consent
    await page.route('**/api/auth/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          viewerId: 'v1',
          twitchUserId: 't1',
          displayName: 'TestViewer',
          avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/test-avatar-70x70.png',
          role: 'viewer',
          isViewer: true,
          consentedAt: '2025-01-01T00:00:00Z',
        }),
      });
    });

    // Mock viewer channels API
    await page.route('**/api/viewer/channels', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'ch_1',
            channelName: 'shroud',
            displayName: 'Shroud',
            avatarUrl: 'https://ui-avatars.com/api/?name=Shroud',
            isLive: true,
            totalWatchMinutes: 210,
            messageCount: 12,
          },
        ]),
      });
    });
  });

  test('should display viewer dashboard with welcome message', async ({ page }) => {
    await page.goto('/dashboard/viewer');

    // Wait for loading to complete and check welcome message
    await expect(page.getByText(/歡迎回來/)).toBeVisible({ timeout: 5000 });
    // Check for VIEWER DASHBOARD label in top bar
    await expect(page.getByText('VIEWER DASHBOARD')).toBeVisible();
  });

  test('should display followed channels section', async ({ page }) => {
    await page.goto('/dashboard/viewer');

    // Wait for page to load
    await expect(page.getByText('已追蹤的頻道')).toBeVisible({ timeout: 5000 });

    // Verify search input exists
    const searchInput = page.getByPlaceholder('搜尋頻道...');
    await expect(searchInput).toBeVisible();
  });

  test('should filter channels by search query', async ({ page }) => {
    await page.goto('/dashboard/viewer');

    // Wait for channels to load
    await expect(page.getByText('已追蹤的頻道')).toBeVisible({ timeout: 5000 });

    // Type in search
    const searchInput = page.getByPlaceholder('搜尋頻道...');
    await searchInput.fill('不存在的頻道名稱XYZ');

    // Should show no results message
    await expect(page.getByText('找不到符合的頻道')).toBeVisible({ timeout: 3000 });
  });

  test('should have logout button in header', async ({ page }) => {
    await page.goto('/dashboard/viewer');

    // Wait for page to load
    await expect(page.getByText(/歡迎回來/)).toBeVisible({ timeout: 5000 });

    // Verify logout button exists
    const logoutButton = page.getByRole('button', { name: '登出' });
    await expect(logoutButton).toBeVisible();
  });

  test('should have settings link in header', async ({ page }) => {
    await page.goto('/dashboard/viewer');

    // Wait for page to load
    await expect(page.getByText(/歡迎回來/)).toBeVisible({ timeout: 5000 });

    // Verify settings link exists
    await expect(page.getByText('帳號設定')).toBeVisible();
  });

  test('should have dashboard switch button to streamer', async ({ page }) => {
    await page.goto('/dashboard/viewer');

    // Wait for page to load
    await expect(page.getByText(/歡迎回來/)).toBeVisible({ timeout: 5000 });

    // Verify switch button exists (the "實況主" button in the switcher, use exact match)
    const switchButton = page.getByRole('button', { name: '實況主', exact: true });
    await expect(switchButton).toBeVisible();
  });
});

test.describe('Viewer Protected Routes', () => {
  test('should redirect to login when accessing viewer dashboard without auth', async ({ page }) => {
    // Mock /api/auth/me to return 401 Unauthorized
    await page.route('**/api/auth/me', async route => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Unauthorized' }),
      });
    });

    // Try to access viewer dashboard directly
    await page.goto('/dashboard/viewer');

    // Should end up on home page
    await page.waitForURL(/\/(login)?$/, { timeout: 10000 });

    // Verify unified login button is visible
    await expect(page.getByRole('button', { name: /前往登入|登入/i })).toBeVisible();
  });

  test('streamer can access viewer dashboard and switch back', async ({ page }) => {
    // Mock /api/auth/me to return a streamer with viewer capabilities
    await page.route('**/api/auth/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          streamerId: 's1',
          viewerId: 'v1',
          twitchUserId: 't1',
          displayName: 'TestStreamer',
          avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/test-avatar-70x70.png',
          channelUrl: 'https://twitch.tv/teststreamer',
          role: 'streamer',
          isViewer: true,
          consentedAt: '2025-01-01T00:00:00Z',
        }),
      });
    });

    // Mock viewer channels API
    await page.route('**/api/viewer/channels', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    // Streamer can access viewer dashboard (unified login allows access to both)
    await page.goto('/dashboard/viewer');

    // Should be able to view the dashboard
    await expect(page.getByText(/歡迎回來/)).toBeVisible({ timeout: 5000 });

    // Switch button to go back to streamer dashboard should be visible (use exact match)
    const switchButton = page.getByRole('button', { name: '實況主', exact: true });
    await expect(switchButton).toBeVisible();
  });
});

test.describe('Dashboard Switch Feature', () => {
  test('viewer can switch to streamer dashboard', async ({ page }) => {
    // Mock authenticated viewer
    await page.route('**/api/auth/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          viewerId: 'v1',
          twitchUserId: 't1',
          displayName: 'TestViewer',
          avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/test-avatar-70x70.png',
          role: 'viewer',
          isViewer: true,
          consentedAt: '2025-01-01T00:00:00Z',
        }),
      });
    });

    // Mock viewer channels API
    await page.route('**/api/viewer/channels', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    // Mock streamer API endpoints for after navigation
    await page.route('**/api/streamer/me/summary**', async route => {
      await route.fulfill({ json: { range: '30d', totalStreamHours: 0, totalStreamSessions: 0 } });
    });
    await page.route('**/api/streamer/me/time-series**', async route => {
      await route.fulfill({ json: { range: '30d', data: [] } });
    });
    await page.route('**/api/streamer/me/heatmap**', async route => {
      await route.fulfill({ json: { range: '30d', data: [] } });
    });
    await page.route('**/api/streamer/me/subscription-trend**', async route => {
      await route.fulfill({ json: { range: '30d', data: [], hasExactData: false } });
    });

    await page.goto('/dashboard/viewer');
    await expect(page.getByText(/歡迎回來/)).toBeVisible({ timeout: 5000 });

    // Click switch button to go to streamer dashboard (use exact match)
    const switchButton = page.getByRole('button', { name: '實況主', exact: true });
    await switchButton.click();

    // Should navigate to streamer dashboard
    await page.waitForURL(/\/dashboard\/streamer/, { timeout: 10000 });
  });
});
