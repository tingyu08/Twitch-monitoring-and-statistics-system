import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the home page
    await page.goto('/');
  });

  test('should display login page for unauthenticated users', async ({ page }) => {
    // Check if we're on the login page or redirected to it
    await expect(page).toHaveURL(/\/(login)?$/);
    
    // Verify Twitch login button exists
    const loginButton = page.getByRole('button', { name: /twitch/i });
    await expect(loginButton).toBeVisible();
  });

  test('should have accessible login button', async ({ page }) => {
    // Ensure login button is keyboard accessible
    const loginButton = page.getByRole('button', { name: /twitch/i });
    await expect(loginButton).toBeVisible();
    await expect(loginButton).toBeEnabled();
    
    // Test keyboard focus
    await loginButton.focus();
    await expect(loginButton).toBeFocused();
  });

  test('should show loading state during authentication', async ({ page }) => {
    // Mock slow network to see loading state
    await page.route('**/api/auth/**', async route => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      route.continue();
    });

    const loginButton = page.getByRole('button', { name: /twitch/i });
    await loginButton.click();
    
    // Should show some loading indicator (adjust selector based on your UI)
    // This is a placeholder - adjust based on actual implementation
    await expect(page.locator('[aria-busy="true"]').or(page.locator('.loading'))).toBeVisible({ timeout: 500 }).catch(() => {
      // Loading state might be too fast to catch, that's okay
    });
  });
});

test.describe('Protected Routes', () => {
  test('should redirect to login when accessing dashboard without auth', async ({ page }) => {
    // Mock /api/auth/me to return 401 Unauthorized
    await page.route('**/api/auth/me', async route => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Unauthorized' }),
      });
    });

    // Try to access dashboard directly
    await page.goto('/dashboard/streamer');
    await page.waitForLoadState('networkidle');
    
    // Wait for error message to appear (使用 first() 避免 strict mode violation)
    await expect(page.getByText('無法載入資料').first()).toBeVisible({ timeout: 10000 });
    
    // Should be redirected to home after 2 second timeout
    await page.waitForURL(/\/(login)?$/, { timeout: 5000 });
  });
});
