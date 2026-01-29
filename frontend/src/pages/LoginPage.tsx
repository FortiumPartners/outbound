/**
 * Login landing page for unauthenticated users
 *
 * Features:
 * - "Sign in with Google" button for OIDC flow via Identity
 * - Test login option in development mode for E2E testing
 * - Error message display for auth failures
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Zap, Building2, Lightbulb, Loader2 } from 'lucide-react';
import { initiateOidcLogin, isOidcConfigured, api } from '../lib/api';

// Error message mapping
const errorMessages: Record<string, string> = {
  oauth_failed: 'Google sign-in failed. Please try again.',
  invalid_state: 'Session expired. Please try again.',
  no_code: 'Authorization failed. Please try again.',
  token_failed: 'Failed to complete sign-in. Please try again.',
  userinfo_failed: 'Failed to get user info. Please try again.',
  invalid_domain: 'Only @fortiumpartners.com accounts are allowed.',
  not_authorized: 'Your account is not authorized. Contact an administrator.',
  auth_failed: 'Authentication failed. Please try again.',
  state_missing: 'Session expired. Please try again.',
  state_invalid: 'Invalid session. Please try again.',
  state_mismatch: 'Session mismatch. Please try again.',
  auth_init_failed: 'Failed to start sign-in. Please try again.',
  invalid_callback: 'Invalid response from identity provider.',
  callback_failed: 'Sign-in failed. Please try again.',
  session_expired: 'Your session expired. Please sign in again.',
};

// Check if dev mode
const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';

export function LoginPage() {
  const navigate = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');

  // Test login state (dev mode only)
  const [testEmail, setTestEmail] = useState('test@e2e.test');
  const [testKey, setTestKey] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [showTestLogin, setShowTestLogin] = useState(false);

  const handleTestLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestLoading(true);
    setTestError(null);

    try {
      await api.testLogin(testEmail, undefined, testKey || undefined);
      // Successfully logged in - redirect to dashboard
      navigate('/', { replace: true });
      // Force page reload to refresh auth state
      window.location.reload();
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-600 via-rose-700 to-rose-900 flex items-center justify-center p-4">
      {/* Subtle pattern overlay */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      <div className="relative w-full max-w-md">
        {/* Main card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8 md:p-10">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-rose-500 rounded-xl flex items-center justify-center shadow-lg">
              <span className="text-white text-3xl font-bold">O</span>
            </div>
          </div>

          {/* Title */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Fortium Outbound</h1>
            <p className="text-gray-500">Virtual BDR System</p>
          </div>

          {/* Error message */}
          {error && (
            <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-100 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">
                {errorMessages[error] || 'An error occurred. Please try again.'}
              </p>
            </div>
          )}

          {/* Sign in with Google button - only show if OIDC is configured */}
          {isOidcConfigured() ? (
            <button
              onClick={() => initiateOidcLogin()}
              className="flex items-center justify-center gap-3 w-full px-4 py-3 bg-white border-2 border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-all group"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              <span className="text-gray-700 font-medium">Sign in with Google</span>
            </button>
          ) : (
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800">Sign-in not configured</p>
                  <p className="text-sm text-amber-700 mt-1">
                    Google Sign-in is not available. Please use Test Login below (dev mode) or contact an administrator.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Dev mode: Test Login toggle */}
          {isDev && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setShowTestLogin(!showTestLogin)}
                className="w-full text-sm text-gray-500 hover:text-gray-700 py-2"
              >
                {showTestLogin ? 'Hide Test Login' : 'Show Test Login (Dev Mode)'}
              </button>

              {showTestLogin && (
                <form onSubmit={handleTestLogin} className="mt-4 p-4 bg-gray-50 rounded-lg border">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Test Login (E2E Testing)</h3>

                  {testError && (
                    <div className="mb-3 p-2 text-sm text-red-700 bg-red-50 rounded border border-red-200">
                      {testError}
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <label htmlFor="test-email" className="block text-xs text-gray-600 mb-1">
                        Test Email
                      </label>
                      <input
                        id="test-email"
                        type="email"
                        value={testEmail}
                        onChange={(e) => setTestEmail(e.target.value)}
                        className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-rose-500"
                        placeholder="test@e2e.test"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="test-key" className="block text-xs text-gray-600 mb-1">
                        Test Key (X-Test-Key header)
                      </label>
                      <input
                        id="test-key"
                        type="password"
                        value={testKey}
                        onChange={(e) => setTestKey(e.target.value)}
                        className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-rose-500"
                        placeholder="TEST_AUTH_KEY value"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={testLoading}
                      className="w-full px-4 py-2 text-sm font-medium text-white bg-rose-600 rounded-md hover:bg-rose-700 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {testLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                      {testLoading ? 'Signing in...' : 'Test Login'}
                    </button>
                  </div>

                  <p className="mt-3 text-xs text-gray-500">
                    Requires ENABLE_TEST_AUTH=true on backend
                  </p>
                </form>
              )}
            </div>
          )}

          {/* Divider */}
          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200"></div>
            </div>
            <div className="relative flex justify-center">
              <span className="px-4 bg-white text-sm text-gray-400">Fortium Partners BD Tool</span>
            </div>
          </div>

          {/* Features */}
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-rose-50 flex items-center justify-center">
                <Zap className="h-5 w-5 text-rose-600" />
              </div>
              <p className="text-xs text-gray-500">Detect Signals</p>
            </div>
            <div>
              <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-rose-50 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-rose-600" />
              </div>
              <p className="text-xs text-gray-500">Manage Universe</p>
            </div>
            <div>
              <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-rose-50 flex items-center justify-center">
                <Lightbulb className="h-5 w-5 text-rose-600" />
              </div>
              <p className="text-xs text-gray-500">Generate Plays</p>
            </div>
          </div>
        </div>

        {/* Security badge */}
        <div className="mt-6 text-center">
          <p className="text-rose-100 text-sm flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
            </svg>
            Secured by Fortium Identity
          </p>
        </div>

        {/* Footer */}
        <div className="mt-4 text-center">
          <p className="text-rose-200/60 text-xs">
            {new Date().getFullYear()} Fortium Partners
          </p>
        </div>
      </div>
    </div>
  );
}
