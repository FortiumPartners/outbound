/**
 * Fortium Identity OIDC Client
 *
 * Outbound authenticates via Fortium Identity (OIDC).
 * Identity owns: users, organizations, app entitlements.
 * Validates tokens using JWKS (no shared secrets for validation).
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { config } from './config.js';

// OIDC Discovery endpoints
const OIDC_ENDPOINTS = {
  authorization: '/oidc/auth',
  token: '/oidc/token',
  userinfo: '/oidc/me',
  jwks: '/.well-known/jwks.json',
  endSession: '/oidc/session/end',
} as const;

// Fortium Identity custom claims
export interface FortiumClaims extends JWTPayload {
  fortium_user_id: string;
  email: string;
  email_verified: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  orgs?: Array<{
    org_id: string;
    name: string;
    role: string;
  }>;
  apps?: Array<{
    app_id: string;
    permissions: string[];
  }>;
}

// Token response from /oidc/token
interface TokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

// PKCE state stored in signed cookie
export interface OIDCState {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
}

class IdentityClient {
  private issuer: string;
  private clientId: string;
  private clientSecret: string;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor() {
    this.issuer = config.IDENTITY_ISSUER;
    this.clientId = config.IDENTITY_CLIENT_ID;
    this.clientSecret = config.IDENTITY_CLIENT_SECRET;
  }

  /**
   * Get JWKS for token validation (cached)
   */
  private getJWKS() {
    if (!this.jwks) {
      // Remove /oidc suffix from issuer to get base URL for JWKS
      const baseUrl = this.issuer.replace(/\/oidc$/, '');
      const jwksUri = new URL(OIDC_ENDPOINTS.jwks, baseUrl);
      this.jwks = createRemoteJWKSet(jwksUri);
    }
    return this.jwks;
  }

  /**
   * Generate authorization URL for OIDC login
   */
  async generateAuthorizationUrl(redirectUri: string): Promise<{ url: string; state: OIDCState }> {
    const stateBytes = new Uint8Array(32);
    const nonceBytes = new Uint8Array(32);
    const verifierBytes = new Uint8Array(32);
    crypto.getRandomValues(stateBytes);
    crypto.getRandomValues(nonceBytes);
    crypto.getRandomValues(verifierBytes);

    const state = base64URLEncode(stateBytes);
    const nonce = base64URLEncode(nonceBytes);
    const codeVerifier = base64URLEncode(verifierBytes);

    // Generate code challenge (SHA-256 of verifier)
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const codeChallenge = base64URLEncode(new Uint8Array(hashBuffer));

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile email fortium offline_access',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authUrl = new URL(OIDC_ENDPOINTS.authorization, this.issuer);
    authUrl.search = params.toString();

    return {
      url: authUrl.toString(),
      state: {
        state,
        nonce,
        codeVerifier,
        redirectUri,
      },
    };
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(
    code: string,
    oidcState: OIDCState
  ): Promise<{ idToken: string; accessToken: string; refreshToken?: string; claims: FortiumClaims }> {
    const tokenUrl = new URL(OIDC_ENDPOINTS.token, this.issuer);

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: oidcState.redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code_verifier: oidcState.codeVerifier,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Token exchange failed: ${response.status} - ${errorBody}`);
    }

    const tokens = (await response.json()) as TokenResponse;

    // Validate ID token
    const claims = await this.validateIdToken(tokens.id_token, oidcState.nonce);

    return {
      idToken: tokens.id_token,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      claims,
    };
  }

  /**
   * Exchange refresh token for new tokens
   */
  async refreshToken(
    refreshToken: string
  ): Promise<{ idToken?: string; accessToken: string; refreshToken?: string }> {
    const tokenUrl = new URL(OIDC_ENDPOINTS.token, this.issuer);

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Token refresh failed: ${response.status} - ${errorBody}`);
    }

    const tokens = (await response.json()) as TokenResponse;

    return {
      idToken: tokens.id_token,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    };
  }

  /**
   * Validate ID token using JWKS
   */
  async validateIdToken(idToken: string, expectedNonce?: string): Promise<FortiumClaims> {
    const { payload } = await jwtVerify(idToken, this.getJWKS(), {
      issuer: this.issuer,
      audience: this.clientId,
    });

    const claims = payload as FortiumClaims;

    if (expectedNonce && claims.nonce !== expectedNonce) {
      throw new Error('Nonce mismatch');
    }

    if (!claims.fortium_user_id) {
      throw new Error('Missing fortium_user_id claim');
    }

    return claims;
  }

  /**
   * Get logout URL for single logout
   */
  getLogoutUrl(idTokenHint?: string, postLogoutRedirectUri?: string): string {
    const logoutUrl = new URL(OIDC_ENDPOINTS.endSession, this.issuer);
    const params = new URLSearchParams();

    if (idTokenHint) {
      params.set('id_token_hint', idTokenHint);
    }
    if (postLogoutRedirectUri) {
      params.set('post_logout_redirect_uri', postLogoutRedirectUri);
    }

    logoutUrl.search = params.toString();
    return logoutUrl.toString();
  }
}

// Base64URL encoding helper
function base64URLEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Singleton instance
export const identityClient = new IdentityClient();
