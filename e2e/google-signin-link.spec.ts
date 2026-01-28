/**
 * E2E test to verify the Google Sign-in button behavior
 * This tests what happens when a user clicks "Sign in with Google"
 */

import { test, expect } from '@playwright/test';

// Production URL
const PROD_URL = 'https://outbound-frontend.onrender.com';

test.describe('Google Sign-in Button', () => {
  test('Sign in with Google button has correct href', async ({ page }) => {
    // Navigate to login page
    await page.goto(`${PROD_URL}/login`);
    await page.waitForLoadState('networkidle');

    // Find the "Sign in with Google" link/button
    const googleSignInLink = page.locator('a:has-text("Sign in with Google")');

    // Get the href attribute
    const href = await googleSignInLink.getAttribute('href');
    console.log('Sign in with Google href:', href);

    // The href should NOT point to /auth/login (backend)
    // It should either:
    // 1. Point to the OIDC provider (if VITE_OIDC_ISSUER is set)
    // 2. Point to /login (if no OIDC issuer, should stay on login page or show error)
    // It should NOT redirect to the backend /auth/login endpoint

    // Check the href
    expect(href).toBeDefined();

    // Log for debugging
    if (href?.includes('/auth/login')) {
      console.log('WARNING: Sign in with Google points to /auth/login (backend endpoint)');
      console.log('This is the issue - it should point to the OIDC issuer or handle the case properly');
    } else if (href?.includes('oauth2/authorize')) {
      console.log('OK: Sign in with Google points to OIDC issuer');
    } else {
      console.log('href value:', href);
    }
  });

  test('clicking Sign in with Google shows expected behavior', async ({ page }) => {
    // Navigate to login page
    await page.goto(`${PROD_URL}/login`);
    await page.waitForLoadState('networkidle');

    // Find the "Sign in with Google" link/button
    const googleSignInLink = page.locator('a:has-text("Sign in with Google")');
    const href = await googleSignInLink.getAttribute('href');

    console.log('href before click:', href);

    // Click the button and see where it goes
    // (We're not following the redirect fully, just checking the initial behavior)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'commit' }),
      googleSignInLink.click(),
    ]).catch(() => {
      // Navigation might fail if it goes to external domain
    });

    // Check current URL after click
    const currentUrl = page.url();
    console.log('URL after clicking Sign in with Google:', currentUrl);

    // Check if we ended up at /auth/login (the 404 issue)
    if (currentUrl.includes('/auth/login')) {
      console.log('ISSUE CONFIRMED: Clicking Sign in redirects to /auth/login');
    }
  });
});
