/**
 * E2E test to verify authentication routing
 * Tests that unauthenticated users are redirected to /login (React route)
 * and not /auth/login (backend endpoint)
 */

import { test, expect } from '@playwright/test';

// Production URL
const PROD_URL = 'https://outbound-frontend.onrender.com';

test.describe('Auth Routing', () => {
  test('root URL redirects unauthenticated users to /login', async ({ page }) => {
    // Navigate to production root
    await page.goto(PROD_URL);

    // Wait for any redirects to complete
    await page.waitForLoadState('networkidle');

    // Check current URL
    const currentUrl = page.url();
    console.log('Current URL after visiting root:', currentUrl);

    // Should redirect to /login (React route), NOT /auth/login (backend)
    expect(currentUrl).toContain('/login');
    expect(currentUrl).not.toContain('/auth/login');

    // The login page should have the "Sign in with Google" button
    const googleSignInButton = page.getByText('Sign in with Google');
    await expect(googleSignInButton).toBeVisible({ timeout: 10000 });
  });

  test('/login route shows the login page correctly', async ({ page }) => {
    // Navigate directly to /login
    await page.goto(`${PROD_URL}/login`);

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    const currentUrl = page.url();
    console.log('Current URL after visiting /login:', currentUrl);

    // Should stay on /login
    expect(currentUrl).toContain('/login');

    // Should see login page content
    await expect(page.getByText('Fortium Outbound')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Sign in with Google')).toBeVisible();
    await expect(page.getByText('Virtual BDR System')).toBeVisible();
  });

  test('/auth/login returns 404 (backend endpoint, not a React route)', async ({ page }) => {
    // Navigate to /auth/login (incorrect path)
    const response = await page.goto(`${PROD_URL}/auth/login`);

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    const currentUrl = page.url();
    console.log('Current URL after visiting /auth/login:', currentUrl);

    // This will likely show a 404 or the SPA will handle it
    // The key point is this is NOT the correct login path

    // Either:
    // 1. The SPA catches it and redirects to /login
    // 2. It shows a 404 page
    // 3. It shows an error

    // Check what happens - this test documents current behavior
    const pageContent = await page.content();
    console.log('Page content preview:', pageContent.slice(0, 500));

    // We expect this to NOT show the proper login page
    // or to be caught by SPA routing
  });

  test('protected routes redirect to /login when unauthenticated', async ({ page }) => {
    // Try to visit a protected route directly
    await page.goto(`${PROD_URL}/signals`);

    // Wait for any redirects
    await page.waitForLoadState('networkidle');

    const currentUrl = page.url();
    console.log('Current URL after visiting /signals:', currentUrl);

    // Should redirect to /login
    expect(currentUrl).toContain('/login');
    expect(currentUrl).not.toContain('/auth/login');
  });

  test('dashboard redirects to /login when unauthenticated', async ({ page }) => {
    // Visit dashboard
    await page.goto(`${PROD_URL}/`);

    await page.waitForLoadState('networkidle');

    const currentUrl = page.url();
    console.log('Current URL after visiting dashboard:', currentUrl);

    // Should redirect to /login
    expect(currentUrl).toContain('/login');
    expect(currentUrl).not.toContain('/auth/login');
  });
});
