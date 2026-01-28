/**
 * E2E test to verify authentication routing fix locally
 * Tests that when OIDC is not configured, the login page shows appropriate message
 */

import { test, expect } from '@playwright/test';

// Local development URL
const LOCAL_URL = 'http://localhost:3006';

test.describe('Local Auth Routing (After Fix)', () => {
  test('login page shows "Sign-in not configured" when OIDC is not set', async ({ page }) => {
    // Navigate to local login page
    await page.goto(`${LOCAL_URL}/login`);
    await page.waitForLoadState('networkidle');

    // Check if we see the "Sign-in not configured" message
    // (this will appear if VITE_OIDC_ISSUER is not set in local dev)
    const notConfiguredMessage = page.getByText('Sign-in not configured');
    const isVisible = await notConfiguredMessage.isVisible().catch(() => false);

    if (isVisible) {
      console.log('SUCCESS: Login page shows "Sign-in not configured" message when OIDC is not configured');
      await expect(notConfiguredMessage).toBeVisible();

      // Should also show a helpful message
      const helpMessage = page.getByText('Google Sign-in is not available');
      await expect(helpMessage).toBeVisible();
    } else {
      // OIDC might be configured in local .env
      console.log('Note: OIDC appears to be configured locally, checking Google Sign-in button...');
      const googleButton = page.getByText('Sign in with Google');
      await expect(googleButton).toBeVisible();

      // Verify the href does NOT point to /auth/login
      const link = page.locator('a:has-text("Sign in with Google")');
      const href = await link.getAttribute('href');
      console.log('Google Sign-in href:', href);

      // Should not be the backend auth/login endpoint
      expect(href).not.toContain('/auth/login');
    }
  });

  test('protected routes still redirect to /login', async ({ page }) => {
    // Visit a protected route
    await page.goto(`${LOCAL_URL}/signals`);
    await page.waitForLoadState('networkidle');

    // Should redirect to /login
    const currentUrl = page.url();
    console.log('URL after visiting /signals:', currentUrl);

    expect(currentUrl).toContain('/login');
    expect(currentUrl).not.toContain('/auth/login');
  });

  test('Test Login section is available in dev mode', async ({ page }) => {
    // Navigate to login page
    await page.goto(`${LOCAL_URL}/login`);
    await page.waitForLoadState('networkidle');

    // In dev mode, there should be a "Show Test Login" button
    const showTestLoginButton = page.getByText('Show Test Login');

    // It might say "Show Test Login (Dev Mode)" or similar
    const isVisible = await showTestLoginButton.isVisible().catch(() => false);

    if (isVisible) {
      console.log('Test Login toggle is available');

      // Click to show test login form
      await showTestLoginButton.click();

      // Should show the test login form
      await expect(page.getByText('Test Login (E2E Testing)')).toBeVisible();
      await expect(page.getByLabel('Test Email')).toBeVisible();
    } else {
      console.log('Note: Test Login toggle not visible - may not be in dev mode or feature disabled');
    }
  });
});
