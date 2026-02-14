/**
 * API client for Outbound backend
 */

// Production defaults
const PROD_API_URL = 'https://outbound-ikby.onrender.com';

const isProd = window.location.hostname.includes('onrender.com');
const API_URL = import.meta.env.VITE_API_URL || (isProd ? PROD_API_URL : 'http://localhost:8004');

const API_BASE = `${API_URL}/api/v1`;
const AUTH_BASE = `${API_URL}/auth`;

/**
 * Initiate login — redirects to backend /auth/login which handles OIDC
 */
export function login(): void {
  window.location.href = `${AUTH_BASE}/login`;
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
   * Logout - POST to backend, then redirect to Identity logout
   */
  async logout(): Promise<void> {
    try {
      const response = await fetch(`${AUTH_BASE}/logout`, {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        if (data.logoutUrl) {
          window.location.href = data.logoutUrl;
          return;
        }
      }
    } catch {
      // Fall through to login redirect
    }
    window.location.href = '/login';
  }

  // Generic API methods
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
