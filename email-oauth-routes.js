// =====================================================
// EMAIL OAUTH API ROUTES
// =====================================================
// Handles OAuth 2.0 flow for Gmail and Outlook
// =====================================================

const express = require('express');
const router = express.Router();
const db = require('./database');
const { requireAuth } = require('./auth-middleware');
const emailOAuth = require('./email-oauth-service');
const emailService = require('./email-imap-service');
const CryptoJS = require('crypto-js');

const ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY || 'revenue-radar-email-key-2026';

// =====================================================
// OAUTH STATUS
// =====================================================

/**
 * GET /api/email-oauth/status
 * Check which OAuth providers are configured
 */
router.get('/status', requireAuth, (req, res) => {
  try {
    const status = emailOAuth.getOAuthStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('[EMAIL-OAUTH] Status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get OAuth status'
    });
  }
});

// =====================================================
// GOOGLE OAUTH
// =====================================================

/**
 * GET /api/email-oauth/google/auth
 * Get Google OAuth authorization URL
 */
router.get('/google/auth', requireAuth, (req, res) => {
  try {
    const result = emailOAuth.getGoogleAuthUrl(req.user.id);

    if (result.error) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      data: { authUrl: result.url }
    });
  } catch (error) {
    console.error('[EMAIL-OAUTH] Google auth URL error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate Google authorization URL'
    });
  }
});

/**
 * GET /api/email-oauth/google/callback
 * Handle Google OAuth callback
 */
router.get('/google/callback', async (req, res) => {
  console.log('[EMAIL-OAUTH] ========== GOOGLE CALLBACK START ==========');
  console.log('[EMAIL-OAUTH] Query params:', {
    code: req.query.code ? `present (${req.query.code.substring(0, 20)}...)` : 'MISSING',
    state: req.query.state ? `present (${req.query.state.substring(0, 20)}...)` : 'MISSING',
    error: req.query.error || 'none'
  });

  try {
    const { code, state, error } = req.query;

    if (error) {
      console.error('[EMAIL-OAUTH] ❌ Google returned error:', error);
      return res.redirect('/dashboard/vp-view.html?oauth_error=' + encodeURIComponent(error));
    }

    if (!code || !state) {
      console.error('[EMAIL-OAUTH] ❌ Missing code or state in callback');
      return res.redirect('/dashboard/vp-view.html?oauth_error=missing_params');
    }

    // Validate state
    const stateData = emailOAuth.validateState(state);
    console.log('[EMAIL-OAUTH] State validation:', stateData ? `✓ Valid (userId: ${stateData.userId}, provider: ${stateData.provider})` : '❌ INVALID');

    if (!stateData || stateData.provider !== 'google') {
      console.error('[EMAIL-OAUTH] ❌ Invalid state - server may have restarted during OAuth flow');
      console.error('[EMAIL-OAUTH] Tip: Complete OAuth quickly. Server restarts clear OAuth state.');
      return res.redirect('/dashboard/vp-view.html?oauth_error=' + encodeURIComponent('Session expired. Please try connecting again.'));
    }

    // Exchange code for tokens
    console.log('[EMAIL-OAUTH] Exchanging code for tokens...');
    const tokens = await emailOAuth.exchangeGoogleCode(code);
    console.log('[EMAIL-OAUTH] Token exchange result:', {
      hasAccessToken: !!tokens.accessToken,
      hasRefreshToken: !!tokens.refreshToken,
      expiresIn: tokens.expiresIn
    });

    // Validate we got both tokens - refresh token is REQUIRED for long-term access
    if (!tokens.accessToken) {
      console.error('[EMAIL-OAUTH] ❌ Google did not return access_token');
      return res.redirect('/dashboard/vp-view.html?oauth_error=' + encodeURIComponent('Google authorization failed. Please try again.'));
    }

    if (!tokens.refreshToken) {
      console.error('[EMAIL-OAUTH] ❌ Google did not return refresh_token!');
      console.error('[EMAIL-OAUTH] This happens when user previously authorized. User must revoke access and try again.');
      return res.redirect('/dashboard/vp-view.html?oauth_error=' + encodeURIComponent(
        'Google did not grant offline access. Please go to https://myaccount.google.com/permissions, revoke access for this app, and try connecting again.'
      ));
    }

    // Get user info
    console.log('[EMAIL-OAUTH] Getting user info...');
    const userInfo = await emailOAuth.getGoogleUserInfo(tokens.accessToken);
    console.log('[EMAIL-OAUTH] User info:', { email: userInfo.email, name: userInfo.name });

    // Check if monitor already exists for this email
    const existingMonitor = db.getDatabase().prepare(`
      SELECT id FROM email_monitors
      WHERE user_id = ? AND email_address = ?
    `).get(stateData.userId, userInfo.email);

    if (existingMonitor) {
      // Update existing monitor with new tokens and ensure it's active
      console.log('[EMAIL-OAUTH] ✏️ Updating existing monitor ID:', existingMonitor.id);
      db.getDatabase().prepare(`
        UPDATE email_monitors
        SET oauth_provider = 'google',
            oauth_access_token = ?,
            oauth_refresh_token = ?,
            oauth_token_expires_at = datetime('now', '+' || ? || ' seconds'),
            imap_password_encrypted = NULL,
            last_error = NULL,
            is_active = 1,
            require_invoice_keywords = 0,
            check_frequency_minutes = 5,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(tokens.accessToken, tokens.refreshToken, tokens.expiresIn, existingMonitor.id);
      console.log('[EMAIL-OAUTH] ✅ Monitor updated successfully');

      // Restart the monitor with new tokens
      try {
        emailService.startMonitor(existingMonitor.id);
        console.log('[EMAIL-OAUTH] ✓ Email monitor restarted with new tokens for:', userInfo.email);
      } catch (startError) {
        console.error('[EMAIL-OAUTH] Warning: Monitor updated but failed to restart:', startError.message);
      }

      return res.redirect('/dashboard/vp-view.html?oauth_success=updated&email=' + encodeURIComponent(userInfo.email));
    }

    // Create new monitor
    console.log('[EMAIL-OAUTH] 📝 Creating new email monitor for user:', stateData.userId);
    const encryptedRefreshToken = CryptoJS.AES.encrypt(tokens.refreshToken, ENCRYPTION_KEY).toString();
    const monitorName = userInfo.name ? `${userInfo.name}'s Gmail` : 'Gmail Monitor';

    try {
      console.log('[EMAIL-OAUTH] Insert params:', {
        userId: stateData.userId,
        email: userInfo.email,
        monitorName,
        hasAccessToken: !!tokens.accessToken,
        hasRefreshToken: !!tokens.refreshToken,
        expiresIn: tokens.expiresIn
      });

      const result = db.getDatabase().prepare(`
        INSERT INTO email_monitors (
          user_id, account_name, monitor_name, name, email_address, imap_host, imap_port, imap_secure, imap_user, username,
          encrypted_password, oauth_provider, oauth_access_token, oauth_refresh_token, oauth_token_expires_at,
          folder_name, check_frequency_minutes, is_active, require_invoice_keywords, created_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'), ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(
        stateData.userId,
        monitorName,  // account_name (NOT NULL)
        monitorName,  // monitor_name
        monitorName,  // name
        userInfo.email,
        'imap.gmail.com',
        993,
        1,  // secure
        userInfo.email,  // imap_user
        userInfo.email,  // username (NOT NULL in original schema)
        'OAUTH',  // encrypted_password placeholder (NOT NULL in original schema)
        'google',
        tokens.accessToken,
        encryptedRefreshToken,
        tokens.expiresIn,
        'INBOX',
        5,  // check every 5 minutes for faster response
        1,   // active
        0,   // require_invoice_keywords = false (process ALL PDFs for dedicated invoice emails)
        stateData.userId  // created_by_user_id
      );
      console.log('[EMAIL-OAUTH] ✅ Monitor created successfully, ID:', result.lastInsertRowid);

      // Start the email monitor immediately
      try {
        emailService.startMonitor(result.lastInsertRowid);
        console.log('[EMAIL-OAUTH] ✓ Email monitor started for:', userInfo.email);
      } catch (startError) {
        console.error('[EMAIL-OAUTH] Warning: Monitor created but failed to start:', startError.message);
        // Don't fail the OAuth - monitor can be started manually or on next server restart
      }
    } catch (dbError) {
      console.error('[EMAIL-OAUTH] Database insert failed:', dbError.message);
      console.error('[EMAIL-OAUTH] Full error:', dbError);
      return res.redirect('/dashboard/vp-view.html?oauth_error=' + encodeURIComponent('Database error: ' + dbError.message));
    }

    console.log('[EMAIL-OAUTH] Redirecting with success for:', userInfo.email);
    res.redirect('/dashboard/vp-view.html?oauth_success=created&email=' + encodeURIComponent(userInfo.email));

  } catch (error) {
    console.error('[EMAIL-OAUTH] Google callback error:', error.message);
    console.error('[EMAIL-OAUTH] Full error stack:', error.stack);
    res.redirect('/dashboard/vp-view.html?oauth_error=' + encodeURIComponent(error.message || 'Unknown error'));
  }
});

// =====================================================
// MICROSOFT OAUTH
// =====================================================

/**
 * GET /api/email-oauth/microsoft/auth
 * Get Microsoft OAuth authorization URL
 */
router.get('/microsoft/auth', requireAuth, (req, res) => {
  try {
    const result = emailOAuth.getMicrosoftAuthUrl(req.user.id);

    if (result.error) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      data: { authUrl: result.url }
    });
  } catch (error) {
    console.error('[EMAIL-OAUTH] Microsoft auth URL error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate Microsoft authorization URL'
    });
  }
});

/**
 * GET /api/email-oauth/microsoft/callback
 * Handle Microsoft OAuth callback
 */
router.get('/microsoft/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      console.error('[EMAIL-OAUTH] Microsoft callback error:', error, error_description);
      return res.redirect('/dashboard/vp-view.html?oauth_error=' + encodeURIComponent(error_description || error));
    }

    if (!code || !state) {
      return res.redirect('/dashboard/vp-view.html?oauth_error=missing_params');
    }

    // Validate state
    const stateData = emailOAuth.validateState(state);
    if (!stateData || stateData.provider !== 'microsoft') {
      return res.redirect('/dashboard/vp-view.html?oauth_error=invalid_state');
    }

    // Exchange code for tokens
    const tokens = await emailOAuth.exchangeMicrosoftCode(code);

    // Get user info
    const userInfo = await emailOAuth.getMicrosoftUserInfo(tokens.accessToken);

    // Check if monitor already exists for this email
    const existingMonitor = db.getDatabase().prepare(`
      SELECT id FROM email_monitors
      WHERE user_id = ? AND email_address = ?
    `).get(stateData.userId, userInfo.email);

    if (existingMonitor) {
      // Update existing monitor with new tokens and ensure it's active
      db.getDatabase().prepare(`
        UPDATE email_monitors
        SET oauth_provider = 'microsoft',
            oauth_access_token = ?,
            oauth_refresh_token = ?,
            oauth_token_expires_at = datetime('now', '+' || ? || ' seconds'),
            imap_password_encrypted = NULL,
            last_error = NULL,
            is_active = 1,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(tokens.accessToken, tokens.refreshToken, tokens.expiresIn, existingMonitor.id);

      // Restart the monitor with new tokens
      try {
        emailService.startMonitor(existingMonitor.id);
        console.log('[EMAIL-OAUTH] ✓ Email monitor restarted with new tokens for:', userInfo.email);
      } catch (startError) {
        console.error('[EMAIL-OAUTH] Warning: Monitor updated but failed to restart:', startError.message);
      }

      return res.redirect('/dashboard/vp-view.html?oauth_success=updated&email=' + encodeURIComponent(userInfo.email));
    }

    // Create new monitor
    const encryptedRefreshToken = CryptoJS.AES.encrypt(tokens.refreshToken, ENCRYPTION_KEY).toString();
    const monitorName = userInfo.name ? `${userInfo.name}'s Outlook` : 'Outlook Monitor';

    const result = db.getDatabase().prepare(`
      INSERT INTO email_monitors (
        user_id, account_name, monitor_name, name, email_address, imap_host, imap_port, imap_secure, imap_user, username,
        encrypted_password, oauth_provider, oauth_access_token, oauth_refresh_token, oauth_token_expires_at,
        folder_name, check_frequency_minutes, is_active, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'), ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      stateData.userId,
      monitorName,  // account_name (NOT NULL)
      monitorName,  // monitor_name
      monitorName,  // name
      userInfo.email,
      'outlook.office365.com',
      993,
      1,  // secure
      userInfo.email,  // imap_user
      userInfo.email,  // username (NOT NULL in original schema)
      'OAUTH',  // encrypted_password placeholder (NOT NULL in original schema)
      'microsoft',
      tokens.accessToken,
      encryptedRefreshToken,
      tokens.expiresIn,
      'INBOX',
      15,  // check every 15 minutes
      1,   // active
      stateData.userId  // created_by_user_id
    );

    console.log('[EMAIL-OAUTH] Monitor created successfully, ID:', result.lastInsertRowid);

    // Start the email monitor immediately
    try {
      emailService.startMonitor(result.lastInsertRowid);
      console.log('[EMAIL-OAUTH] ✓ Email monitor started for:', userInfo.email);
    } catch (startError) {
      console.error('[EMAIL-OAUTH] Warning: Monitor created but failed to start:', startError.message);
    }

    res.redirect('/dashboard/vp-view.html?oauth_success=created&email=' + encodeURIComponent(userInfo.email));

  } catch (error) {
    console.error('[EMAIL-OAUTH] Microsoft callback error:', error);
    res.redirect('/dashboard/vp-view.html?oauth_error=' + encodeURIComponent(error.message));
  }
});

// =====================================================
// DISCONNECT OAUTH
// =====================================================

/**
 * POST /api/email-oauth/disconnect/:monitorId
 * Disconnect OAuth and optionally delete monitor
 */
router.post('/disconnect/:monitorId', requireAuth, async (req, res) => {
  try {
    const { monitorId } = req.params;
    const { deleteMonitor } = req.body;

    const monitor = db.getDatabase().prepare(`
      SELECT * FROM email_monitors WHERE id = ? AND user_id = ?
    `).get(monitorId, req.user.id);

    if (!monitor) {
      return res.status(404).json({
        success: false,
        error: 'Monitor not found'
      });
    }

    if (deleteMonitor) {
      // Delete the monitor entirely
      db.getDatabase().prepare(`
        DELETE FROM email_monitors WHERE id = ?
      `).run(monitorId);
    } else {
      // Just clear OAuth tokens
      db.getDatabase().prepare(`
        UPDATE email_monitors
        SET oauth_provider = NULL,
            oauth_access_token = NULL,
            oauth_refresh_token = NULL,
            oauth_token_expires_at = NULL,
            is_active = 0,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(monitorId);
    }

    res.json({
      success: true,
      message: deleteMonitor ? 'Monitor deleted' : 'OAuth disconnected'
    });

  } catch (error) {
    console.error('[EMAIL-OAUTH] Disconnect error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to disconnect OAuth'
    });
  }
});

module.exports = router;
