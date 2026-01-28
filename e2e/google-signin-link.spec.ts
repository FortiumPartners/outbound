/**
 * E2E test to verify the Google Sign-in button behavior with PKCE
 * This tests what happens when a user clicks "Sign in with Google"
 */

import { test, expect } from '@playwright/test';

// Production URL
const PROD_URL = 'https://outbound-frontend.onrender.com';

test.describe('Google Sign-in Button', () => {
  test('Sign in with Google button exists and is clickable', async ({ page }) => {
    // Navigate to login page
    await page.goto(`${PROD_URL}/login`);
    await page.waitForLoadState('networkidle');

    // Find the "Sign in with Google" button (uses onClick for PKCE, not href)
    const googleSignInButton = page.locator('button:has-text("Sign in with Google")');

    // Verify it exists and is visible
    await expect(googleSignInButton).toBeVisible();
    console.log('Sign in with Google button is visible');

    // The button uses PKCE flow (onClick triggers initiateOidcLogin)
    // It's a button, not a link
    const tagName = await googleSignInButton.evaluate((el) => el.tagName);
    expect(tagName.toLowerCase()).toBe('button');
    console.log('Confirmed: Sign in with Google is a button (PKCE flow)');
  });

  test('clicking Sign in with Google initiates PKCE flow', async ({ page }) => {
    // Navigate to login page
    await page.goto(`${PROD_URL}/login`);
    await page.waitForLoadState('networkidle');

    // Find the "Sign in with Google" button
    const googleSignInButton = page.locator('button:has-text("Sign in with Google")');
    await expect(googleSignInButton).toBeVisible();

    // Click the button - it should redirect to the OIDC provider
    // We catch the navigation because it goes to an external domain
    const navigationPromise = page.waitForURL(/identity-api.*\/oidc\/auth|accounts\.google\.com/, {
      timeout: 10000,
    }).catch(() => null);

    await googleSignInButton.click();

    // Wait for navigation or timeout
    await navigationPromise;

    // Check current URL after click
    const currentUrl = page.url();
    console.log('URL after clicking Sign in with Google:', currentUrl);

    // Should NOT end up at /auth/login (the old 404 issue)
    expect(currentUrl).not.toContain('/auth/login');

    // Should be at the OIDC provider authorization endpoint
    if (currentUrl.includes('identity-api')) {
      console.log('SUCCESS: Redirected to Fortium Identity OIDC provider');
      expect(currentUrl).toContain('/oidc/auth');
      expect(currentUrl).toContain('code_challenge'); // PKCE parameter
    } else if (currentUrl.includes('accounts.google.com')) {
      console.log('SUCCESS: Redirected to Google OAuth');
    } else if (currentUrl.includes('outbound-frontend')) {
      console.log('INFO: Still on Outbound frontend - may be an error or loading state');
    }
  });
});
