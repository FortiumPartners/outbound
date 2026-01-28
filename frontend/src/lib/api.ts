/**
 * API client for Outbound backend
 */

// Production defaults
const PROD_API_URL = 'https://fortiumoutbound.onrender.com';
const PROD_OIDC_ISSUER = 'https://identity-api-kj1r.onrender.com/oidc';

const isProd = window.location.hostname.includes('onrender.com');
const API_URL = import.meta.env.VITE_API_URL || (isProd ? PROD_API_URL : 'http://localhost:8004');
const OIDC_ISSUER = import.meta.env.VITE_OIDC_ISSUER || (isProd ? PROD_OIDC_ISSUER : null);

const API_BASE = `${API_URL}/api/v1`;
const AUTH_BASE = `${API_URL}/auth`;

/**
 * Get the full URL for an auth endpoint.
 * Used for login flows via Identity OIDC.
 */
export function getAuthUrl(path: string): string {
  return `${AUTH_BASE}${path}`;
}

/**
 * Check if OIDC is configured
 */
export function isOidcConfigured(): boolean {
  return !!OIDC_ISSUER;
}

/**
 * PKCE helpers for secure OIDC flow
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

function base64UrlEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

/**
 * Initiate OIDC login with PKCE
 * Generates code_verifier, stores it, and redirects to Identity
 */
export async function initiateOidcLogin(): Promise<void> {
  if (!OIDC_ISSUER) {
    throw new Error('OIDC not configured');
  }

  // Generate PKCE code verifier and challenge
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Store code verifier for token exchange
  sessionStorage.setItem('oidc_code_verifier', codeVerifier);

  // Build authorization URL with PKCE
  const params = new URLSearchParams({
    client_id: 'outbound-api',
    redirect_uri: window.location.origin + '/auth/callback',
    response_type: 'code',
    scope: 'openid profile email',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  window.location.href = `${OIDC_ISSUER}/auth?${params.toString()}`;
}

/**
 * Get OIDC login URL - DEPRECATED, use initiateOidcLogin() instead
 * Returns null if OIDC is not configured
 */
export function getOidcLoginUrl(): string | null {
  // Return null - caller should use initiateOidcLogin() for PKCE support
  return OIDC_ISSUER ? 'javascript:void(0)' : null;
}

/**
 * Exchange authorization code for tokens (called from callback page)
 */
export async function exchangeCodeForTokens(code: string): Promise<boolean> {
  if (!OIDC_ISSUER) {
    throw new Error('OIDC not configured');
  }

  const codeVerifier = sessionStorage.getItem('oidc_code_verifier');
  if (!codeVerifier) {
    throw new Error('Missing code verifier - login flow corrupted');
  }

  // Exchange code for tokens via backend proxy (to keep client_secret secure)
  const response = await fetch(`${AUTH_BASE}/oidc/callback`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: codeVerifier,
      redirect_uri: window.location.origin + '/auth/callback',
    }),
  });

  // Clear stored verifier
  sessionStorage.removeItem('oidc_code_verifier');

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Token exchange failed');
  }

  return true;
}

export interface User {
  fortiumUserId: string;
  email: string;
  name: string;
}

export interface AuthResponse {
  authenticated: boolean;
  user: User | null;
}

export interface TestLoginResponse {
  success: true;
  user: User;
  token: string;
  message: string;
}

class ApiClient {
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (response.status === 401) {
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `API error ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get current authenticated user
   */
  async getCurrentUser(): Promise<User | null> {
    try {
      const response = await fetch(`${AUTH_BASE}/me`, {
        credentials: 'include'
      });
      if (!response.ok) return null;
      const data: AuthResponse = await response.json();
      return data.authenticated ? data.user : null;
    } catch {
      return null;
    }
  }

  /**
   * Test login for E2E testing / development
   * Requires ENABLE_TEST_AUTH=true and valid TEST_AUTH_KEY
   */
  async testLogin(
    email: string,
    displayName?: string,
    testKey?: string
  ): Promise<TestLoginResponse> {
    const response = await fetch(`${AUTH_BASE}/test-login`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(testKey ? { 'X-Test-Key': testKey } : {}),
      },
      body: JSON.stringify({ email, displayName }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Login failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Logout - clears session cookie
   */
  async logout(): Promise<void> {
    try {
      await fetch(`${AUTH_BASE}/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore errors, just redirect
    }
    window.location.href = '/login';
  }

  // Generic API methods for other endpoints
  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint);
  }

  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async patch<T>(endpoint: string, data: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }
}

export const api = new ApiClient();
export { API_URL, API_BASE };
