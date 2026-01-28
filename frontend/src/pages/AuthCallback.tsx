/**
 * OIDC callback page - handles the authorization code exchange
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { exchangeCodeForTokens } from '../lib/api';

export function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const errorParam = params.get('error');
    const errorDescription = params.get('error_description');

    if (errorParam) {
      // OIDC error returned
      console.error('OIDC error:', errorParam, errorDescription);
      navigate(`/login?error=${errorParam}`, { replace: true });
      return;
    }

    if (!code) {
      navigate('/login?error=no_code', { replace: true });
      return;
    }

    // Exchange code for tokens
    exchangeCodeForTokens(code)
      .then(() => {
        // Success - redirect to home
        navigate('/', { replace: true });
        window.location.reload();
      })
      .catch((err) => {
        console.error('Token exchange failed:', err);
        setError(err.message);
        setTimeout(() => {
          navigate('/login?error=token_failed', { replace: true });
        }, 2000);
      });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-600 via-rose-700 to-rose-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 md:p-10 text-center">
        {error ? (
          <>
            <div className="text-red-500 mb-4">
              <svg className="w-12 h-12 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Sign-in Failed</h2>
            <p className="text-gray-500">{error}</p>
            <p className="text-sm text-gray-400 mt-2">Redirecting to login...</p>
          </>
        ) : (
          <>
            <Loader2 className="w-12 h-12 text-rose-500 animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Completing sign-in...</h2>
            <p className="text-gray-500">Please wait while we verify your credentials.</p>
          </>
        )}
      </div>
    </div>
  );
}
