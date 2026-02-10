/**
 * OIDC callback page
 *
 * The backend handles the full callback flow now (GET /auth/callback)
 * and redirects to the frontend. This page only handles error params
 * passed back from the backend redirect.
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

export function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get('error');

    if (errorParam) {
      navigate(`/login?error=${errorParam}`, { replace: true });
      return;
    }

    // If we land here without an error, the backend callback succeeded
    // and we should be authenticated. Redirect to home.
    navigate('/', { replace: true });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-600 via-rose-700 to-rose-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 md:p-10 text-center">
        <Loader2 className="w-12 h-12 text-rose-500 animate-spin mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Completing sign-in...</h2>
        <p className="text-gray-500">Please wait while we verify your credentials.</p>
      </div>
    </div>
  );
}
