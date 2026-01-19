// =====================================================
// EMAIL OAUTH SERVICE
// =====================================================
// Handles OAuth 2.0 authentication for Gmail and Outlook
// Allows users to connect their email with one click
// No app passwords required!
// =====================================================

const crypto = require('crypto');
const db = require('./database');

// OAuth Configuration (set these in environment variables)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_OAUTH_CLIENT_ID || '';
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_OAUTH_CLIENT_SECRET || '';

// OAuth redirect URIs - update for production
const getBaseUrl = () => process.env.BASE_URL || 'http://localhost:5050';
const GOOGLE_REDIRECT_URI = () => `${getBaseUrl()}/api/email-oauth/google/callback`;
const MICROSOFT_REDIRECT_URI = () => `${getBaseUrl()}/api/email-oauth/microsoft/callback`;

// OAuth URLs
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MICROSOFT_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

// Scopes needed for IMAP access
const GOOGLE_SCOPES = [
  'https://mail.google.com/',  // Full IMAP access
  'https://www.googleapis.com/auth/userinfo.email',  // Get email address
  'https://www.googleapis.com/auth/userinfo.profile'  // Get name
].join(' ');

const MICROSOFT_SCOPES = [
  'https://outlook.office.com/IMAP.AccessAsUser.All',  // IMAP access
  'https://outlook.office.com/User.Read',  // Get user info
  'offline_access'  // Refresh token
].join(' ');

// State storage for OAuth flow (use Redis in production for multi-server)
const oauthStates = new Map();

/**
 * Generate OAuth authorization URL for Google
 */
function getGoogleAuthUrl(userId) {
  if (!GOOGLE_CLIENT_ID) {
    return { error: 'Google OAuth not configured. Contact administrator.' };
  }

  const state = generateState(userId, 'google');

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI(),
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',  // Get refresh token
    prompt: 'consent',  // Always show consent screen to get refresh token
    state: state
  });

  return {
    url: `${GOOGLE_AUTH_URL}?${params.toString()}`,
    state: state
  };
}

/**
 * Generate OAuth authorization URL for Microsoft
 */
function getMicrosoftAuthUrl(userId) {
  if (!MICROSOFT_CLIENT_ID) {
    return { error: 'Microsoft OAuth not configured. Contact administrator.' };
  }

  const state = generateState(userId, 'microsoft');

  const params = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    redirect_uri: MICROSOFT_REDIRECT_URI(),
    response_type: 'code',
    scope: MICROSOFT_SCOPES,
    state: state
  });

  return {
    url: `${MICROSOFT_AUTH_URL}?${params.toString()}`,
    state: state
  };
}

/**
 * Generate secure state parameter for OAuth
 */
function generateState(userId, provider) {
  const state = crypto.randomBytes(32).toString('hex');
  oauthStates.set(state, {
    userId,
    provider,
    createdAt: Date.now()
  });

  // Clean up old states (older than 10 minutes)
  cleanupOldStates();

  return state;
}

/**
 * Validate and consume OAuth state
 */
function validateState(state) {
  const data = oauthStates.get(state);
  if (!data) return null;

  // Check if state is expired (10 minutes)
  if (Date.now() - data.createdAt > 10 * 60 * 1000) {
    oauthStates.delete(state);
    return null;
  }

  oauthStates.delete(state);
  return data;
}

/**
 * Clean up expired OAuth states
 */
function cleanupOldStates() {
  const now = Date.now();
  for (const [state, data] of oauthStates.entries()) {
    if (now - data.createdAt > 10 * 60 * 1000) {
      oauthStates.delete(state);
    }
  }
}

/**
 * Exchange Google authorization code for tokens
 */
async function exchangeGoogleCode(code) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: GOOGLE_REDIRECT_URI()
    })
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type
  };
}

/**
 * Exchange Microsoft authorization code for tokens
 */
async function exchangeMicrosoftCode(code) {
  const response = await fetch(MICROSOFT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      client_secret: MICROSOFT_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: MICROSOFT_REDIRECT_URI()
    })
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type
  };
}

/**
 * Get Google user info from access token
 */
async function getGoogleUserInfo(accessToken) {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new Error('Failed to get user info from Google');
  }

  const data = await response.json();
  return {
    email: data.email,
    name: data.name,
    picture: data.picture
  };
}

/**
 * Get Microsoft user info from access token
 */
async function getMicrosoftUserInfo(accessToken) {
  const response = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new Error('Failed to get user info from Microsoft');
  }

  const data = await response.json();
  return {
    email: data.mail || data.userPrincipalName,
    name: data.displayName
  };
}

/**
 * Refresh Google access token using refresh token
 */
async function refreshGoogleToken(refreshToken) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in
  };
}

/**
 * Refresh Microsoft access token using refresh token
 */
async function refreshMicrosoftToken(refreshToken) {
  const response = await fetch(MICROSOFT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      client_secret: MICROSOFT_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,  // Microsoft may return new refresh token
    expiresIn: data.expires_in
  };
}

/**
 * Get valid access token for a monitor (refreshes if expired)
 */
async function getValidAccessToken(monitor) {
  if (!monitor.oauth_provider || !monitor.oauth_refresh_token) {
    return null;  // Not an OAuth monitor
  }

  // Check if current token is still valid (with 5 minute buffer)
  const expiresAt = new Date(monitor.oauth_token_expires_at).getTime();
  const now = Date.now();

  if (monitor.oauth_access_token && expiresAt > now + 5 * 60 * 1000) {
    return monitor.oauth_access_token;
  }

  // Token expired or about to expire - refresh it
  console.log(`[EMAIL-OAUTH] Refreshing token for monitor ${monitor.id}`);

  try {
    let newTokens;

    if (monitor.oauth_provider === 'google') {
      newTokens = await refreshGoogleToken(monitor.oauth_refresh_token);
    } else if (monitor.oauth_provider === 'microsoft') {
      newTokens = await refreshMicrosoftToken(monitor.oauth_refresh_token);
    } else {
      throw new Error(`Unknown OAuth provider: ${monitor.oauth_provider}`);
    }

    // Update tokens in database
    const expiresAt = new Date(Date.now() + newTokens.expiresIn * 1000).toISOString();

    db.getDatabase().prepare(`
      UPDATE email_monitors
      SET oauth_access_token = ?,
          oauth_token_expires_at = ?,
          oauth_refresh_token = COALESCE(?, oauth_refresh_token),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(newTokens.accessToken, expiresAt, newTokens.refreshToken || null, monitor.id);

    return newTokens.accessToken;

  } catch (error) {
    console.error(`[EMAIL-OAUTH] Failed to refresh token for monitor ${monitor.id}:`, error.message);

    // Mark monitor as having auth error
    db.getDatabase().prepare(`
      UPDATE email_monitors
      SET last_error = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(`OAuth token refresh failed: ${error.message}`, monitor.id);

    return null;
  }
}

/**
 * Create IMAP authentication for OAuth
 * Returns the XOAUTH2 token string for IMAP authentication
 */
function createXOAuth2Token(email, accessToken) {
  const authString = `user=${email}\x01auth=Bearer ${accessToken}\x01\x01`;
  return Buffer.from(authString).toString('base64');
}

/**
 * Check if OAuth is configured for a provider
 */
function isOAuthConfigured(provider) {
  if (provider === 'google') {
    return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
  }
  if (provider === 'microsoft') {
    return !!(MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET);
  }
  return false;
}

/**
 * Get OAuth configuration status
 */
function getOAuthStatus() {
  return {
    google: {
      configured: isOAuthConfigured('google'),
      clientId: GOOGLE_CLIENT_ID ? GOOGLE_CLIENT_ID.substring(0, 20) + '...' : null
    },
    microsoft: {
      configured: isOAuthConfigured('microsoft'),
      clientId: MICROSOFT_CLIENT_ID ? MICROSOFT_CLIENT_ID.substring(0, 20) + '...' : null
    }
  };
}

module.exports = {
  // Auth URL generators
  getGoogleAuthUrl,
  getMicrosoftAuthUrl,

  // State management
  validateState,

  // Token exchange
  exchangeGoogleCode,
  exchangeMicrosoftCode,

  // User info
  getGoogleUserInfo,
  getMicrosoftUserInfo,

  // Token refresh
  refreshGoogleToken,
  refreshMicrosoftToken,
  getValidAccessToken,

  // IMAP auth
  createXOAuth2Token,

  // Config status
  isOAuthConfigured,
  getOAuthStatus
};
