// =====================================================
// SELF-SERVICE SIGNUP ROUTES
// =====================================================
// Public signup flow with email verification and trial limits:
// - Anyone can sign up
// - Email verification required
// - 30-day trial OR 20 invoices (whichever comes first)
// - Automatic account isolation (users only see their own data)
// - VP dashboard access only for trial users
// =====================================================

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('./database');
const emailService = require('./email-service');
const authService = require('./auth-service');
const { sanitizeInput } = require('./auth-middleware');

// Apply input sanitization to all routes
router.use(sanitizeInput);

// =====================================================
// PUBLIC SIGNUP
// =====================================================

/**
 * POST /signup/register
 * Public self-service signup (no authentication required)
 */
router.post('/register', async (req, res) => {
  try {
    const { email, name, companyName } = req.body;

    // Validation
    if (!email || !name) {
      return res.status(400).json({
        success: false,
        error: 'Email and name are required'
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    // Check if email already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'An account with this email already exists'
      });
    }

    // Generate temporary password (user will reset later)
    const temporaryPassword = emailService.generateToken(8);
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    // Generate email verification token
    const verificationToken = emailService.generateToken(32);

    // Calculate trial expiration (30 days from now)
    const trialStartDate = new Date();
    const trialExpireDate = new Date();
    trialExpireDate.setDate(trialExpireDate.getDate() + 30);

    // Create user with trial status
    const result = db.prepare(`
      INSERT INTO users (
        email,
        name,
        password_hash,
        role,
        account_name,
        is_active,
        is_email_verified,
        email_verification_token,
        is_trial,
        trial_started_at,
        trial_expires_at,
        trial_invoices_used,
        trial_invoices_limit,
        trial_days_limit,
        subscription_status,
        signup_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      email.toLowerCase().trim(),
      name.trim(),
      passwordHash,
      'customer_admin',  // VP dashboard access
      companyName ? companyName.trim() : `${name.trim()}'s Account`,
      0,  // Not active until email verified
      0,  // Not verified
      verificationToken,
      1,  // Is trial
      trialStartDate.toISOString(),
      trialExpireDate.toISOString(),
      0,  // No invoices used yet
      20, // 20 invoice limit
      30, // 30 day limit
      'trial',
      'self_service'
    );

    const userId = result.lastInsertRowid;

    // Send verification email
    try {
      await emailService.sendVerificationEmail(email, name, verificationToken);
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError);
      // Don't fail the signup - user can request resend
    }

    // Log telemetry
    try {
      db.logTelemetryEvent(userId, 'signup_completed', {
        signup_source: 'self_service',
        trial_expires_at: trialExpireDate.toISOString()
      }, req.path, req.headers['x-session-id'] || 'unknown');
    } catch (telemetryError) {
      // Non-critical
    }

    res.status(201).json({
      success: true,
      message: 'Account created! Please check your email to verify your account and start your free trial.',
      data: {
        userId,
        email,
        name,
        trialExpiresAt: trialExpireDate.toISOString(),
        trialInvoicesLimit: 20
      }
    });

  } catch (error) {
    console.error('[SIGNUP] Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create account. Please try again.'
    });
  }
});

/**
 * GET /signup/verify-email
 * Verify email with token (redirect from email link)
 */
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: #ef4444;">❌ Invalid Verification Link</h1>
          <p>This verification link is invalid or expired.</p>
          <a href="/dashboard/login.html" style="color: #3b82f6;">Go to Login</a>
        </body></html>
      `);
    }

    // Find user with this token
    const user = db.prepare(`
      SELECT id, email, name, is_email_verified
      FROM users
      WHERE email_verification_token = ?
    `).get(token);

    if (!user) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: #ef4444;">❌ Invalid Token</h1>
          <p>This verification link is invalid or has already been used.</p>
          <a href="/dashboard/login.html" style="color: #3b82f6;">Go to Login</a>
        </body></html>
      `);
    }

    if (user.is_email_verified) {
      return res.status(200).send(`
        <!DOCTYPE html>
        <html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: #10b981;">✅ Already Verified</h1>
          <p>Your email is already verified. You can log in now.</p>
          <a href="/dashboard/login.html" style="display: inline-block; margin-top: 20px; padding: 12px 30px; background: #fbbf24; color: #1a1a1a; text-decoration: none; border-radius: 6px; font-weight: 600;">Go to Login</a>
        </body></html>
      `);
    }

    // Mark email as verified and activate account
    db.prepare(`
      UPDATE users
      SET is_email_verified = 1,
          is_active = 1,
          email_verification_token = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(user.id);

    // Log verification event
    try {
      db.logTelemetryEvent(user.id, 'email_verified', {
        verified_at: new Date().toISOString()
      }, req.path, req.headers['x-session-id'] || 'unknown');
    } catch (telemetryError) {
      // Non-critical
    }

    // Redirect to login with success message
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); margin: 0; padding: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
          .container { background: white; border-radius: 12px; padding: 50px; max-width: 500px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.3); }
          .logo { font-size: 64px; margin-bottom: 20px; }
          h1 { color: #10b981; margin: 20px 0; }
          p { color: #666; line-height: 1.6; margin: 20px 0; }
          .button { display: inline-block; margin-top: 30px; padding: 16px 40px; background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%); color: #1a1a1a; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 16px; }
          .button:hover { opacity: 0.9; }
          .trial-info { background: #f0fdf4; border: 2px solid #10b981; border-radius: 8px; padding: 20px; margin-top: 30px; }
          .trial-info strong { color: #10b981; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo">$</div>
          <h1>✅ Email Verified!</h1>
          <p>Welcome to Revenue Radar, ${user.name}!</p>
          <div class="trial-info">
            <strong>Your FREE Trial is Now Active</strong><br>
            <p style="margin: 10px 0; color: #333;">
              ✅ 30 days of full access<br>
              ✅ Process up to 20 invoices<br>
              ✅ AI-powered savings detection
            </p>
          </div>
          <a href="/dashboard/login.html" class="button">Log In to Dashboard</a>
          <p style="font-size: 14px; color: #999; margin-top: 30px;">
            Use the email <strong>${user.email}</strong> to log in
          </p>
        </div>
        <script>
          // Auto-redirect after 5 seconds
          setTimeout(() => {
            window.location.href = '/dashboard/login.html?verified=true';
          }, 5000);
        </script>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('[SIGNUP] Email verification error:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h1 style="color: #ef4444;">❌ Verification Failed</h1>
        <p>Something went wrong. Please try again or contact support.</p>
        <a href="/dashboard/login.html" style="color: #3b82f6;">Go to Login</a>
      </body></html>
    `);
  }
});

/**
 * POST /signup/resend-verification
 * Resend verification email
 */
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const user = db.prepare(`
      SELECT id, email, name, is_email_verified, email_verification_token
      FROM users
      WHERE email = ?
    `).get(email.toLowerCase().trim());

    if (!user) {
      // Don't reveal if email exists or not (security)
      return res.json({
        success: true,
        message: 'If an account exists with this email, a verification link has been sent.'
      });
    }

    if (user.is_email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email is already verified. You can log in now.'
      });
    }

    // Generate new token if needed
    let token = user.email_verification_token;
    if (!token) {
      token = emailService.generateToken(32);
      db.prepare(`
        UPDATE users
        SET email_verification_token = ?
        WHERE id = ?
      `).run(token, user.id);
    }

    // Send verification email
    await emailService.sendVerificationEmail(user.email, user.name, token);

    res.json({
      success: true,
      message: 'Verification email sent! Please check your inbox.'
    });

  } catch (error) {
    console.error('[SIGNUP] Resend verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send verification email'
    });
  }
});

module.exports = router;
