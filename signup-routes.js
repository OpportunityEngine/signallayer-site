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
const dbModule = require('./database');
const emailService = require('./email-service');
const authService = require('./auth-service');
const { sanitizeInput } = require('./auth-middleware');

// Helper to get raw database for direct queries
const getDb = () => dbModule.getDatabase();

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
    const existingUser = getDb().prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());

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
    const result = getDb().prepare(`
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
    const user = getDb().prepare(`
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
    getDb().prepare(`
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

    const user = getDb().prepare(`
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
      getDb().prepare(`
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

// =====================================================
// ACCESS REQUEST FLOW (Admin Approval Required)
// =====================================================

// Rate limiting for access requests
const accessRequestLimits = new Map(); // email -> { count, firstRequest }

function checkAccessRequestLimit(email) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const limit = accessRequestLimits.get(email);

  if (!limit || (now - limit.firstRequest) > dayMs) {
    accessRequestLimits.set(email, { count: 1, firstRequest: now });
    return true;
  }

  if (limit.count >= 3) {
    return false;
  }

  limit.count++;
  return true;
}

/**
 * POST /signup/request-access
 * Submit a request for dashboard access (requires admin approval)
 */
router.post('/request-access', async (req, res) => {
  try {
    const { email, name, companyName, requestedRole, reason, linkedinUrl, password } = req.body;

    // Validation
    if (!email || !name) {
      return res.status(400).json({
        success: false,
        error: 'Email and name are required'
      });
    }

    // Password validation
    if (!password || password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters'
      });
    }

    // Validate password requirements
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);

    if (!hasUpper || !hasLower || !hasNumber) {
      return res.status(400).json({
        success: false,
        error: 'Password must contain uppercase, lowercase, and number'
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

    const normalizedEmail = email.toLowerCase().trim();

    // Rate limit check
    if (!checkAccessRequestLimit(normalizedEmail)) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please try again tomorrow.'
      });
    }

    // Check if user already exists
    const existingUser = getDb().prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'An account with this email already exists. Please log in or reset your password.'
      });
    }

    // Check if there's already a pending request
    const existingRequest = getDb().prepare(`
      SELECT id, status FROM signup_requests WHERE email = ?
    `).get(normalizedEmail);

    if (existingRequest) {
      if (existingRequest.status === 'pending') {
        return res.status(409).json({
          success: false,
          error: 'You already have a pending access request. We\'ll be in touch soon!'
        });
      }
      if (existingRequest.status === 'denied') {
        // Allow resubmission after denial - delete old request
        getDb().prepare('DELETE FROM signup_requests WHERE id = ?').run(existingRequest.id);
      }
    }

    // Validate requested role
    const validRoles = ['rep', 'manager', 'viewer'];
    const role = validRoles.includes(requestedRole) ? requestedRole : 'rep';

    // Hash the password for secure storage
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate approval/denial tokens
    const approvalToken = emailService.generateToken(32);
    const denialToken = emailService.generateToken(32);
    const tokenExpires = new Date();
    tokenExpires.setDate(tokenExpires.getDate() + 7); // 7 days

    // Create the request with hashed password
    const result = getDb().prepare(`
      INSERT INTO signup_requests (
        email, name, company_name, requested_role, reason, linkedin_url,
        password_hash, status, approval_token, denial_token, token_expires_at,
        ip_address, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      normalizedEmail,
      name.trim(),
      companyName ? companyName.trim() : null,
      role,
      reason ? reason.trim() : null,
      linkedinUrl ? linkedinUrl.trim() : null,
      passwordHash,
      approvalToken,
      denialToken,
      tokenExpires.toISOString(),
      req.ip || req.connection?.remoteAddress || 'unknown',
      req.headers['user-agent'] || 'unknown'
    );

    // Send admin notification email
    try {
      await emailService.sendAccessRequestNotification({
        requestId: result.lastInsertRowid,
        email: normalizedEmail,
        name: name.trim(),
        companyName: companyName ? companyName.trim() : 'Not provided',
        requestedRole: role,
        reason: reason || 'Not provided',
        linkedinUrl: linkedinUrl || null,
        approvalToken,
        denialToken,
        createdAt: new Date().toISOString()
      });
    } catch (emailError) {
      console.error('[SIGNUP] Failed to send admin notification:', emailError);
      // Don't fail the request - admin can still see it in dashboard
    }

    // Send confirmation to requester
    try {
      await emailService.sendAccessRequestConfirmation(normalizedEmail, name.trim());
    } catch (emailError) {
      console.error('[SIGNUP] Failed to send confirmation:', emailError);
    }

    res.status(201).json({
      success: true,
      message: 'Access request submitted! You\'ll receive an email once your request is reviewed.'
    });

  } catch (error) {
    console.error('[SIGNUP] Access request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit request. Please try again.'
    });
  }
});

/**
 * GET /signup/approve/:token
 * One-click approval from email
 */
router.get('/approve/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { role } = req.query; // Optional role override

    const request = getDb().prepare(`
      SELECT * FROM signup_requests
      WHERE approval_token = ? AND status = 'pending'
    `).get(token);

    if (!request) {
      return res.status(404).send(renderApprovalPage({
        success: false,
        title: 'Invalid or Expired Link',
        message: 'This approval link is invalid, expired, or has already been used.',
        showLogin: true
      }));
    }

    // Check token expiration
    if (new Date(request.token_expires_at) < new Date()) {
      return res.status(410).send(renderApprovalPage({
        success: false,
        title: 'Link Expired',
        message: 'This approval link has expired. Please review requests in the admin dashboard.',
        showLogin: true
      }));
    }

    // Use the password the user set during signup, or generate one if not set (legacy requests)
    let passwordHash = request.password_hash;
    let userSetPassword = true;
    if (!passwordHash) {
      const temporaryPassword = generateSecurePassword();
      passwordHash = await bcrypt.hash(temporaryPassword, 10);
      userSetPassword = false;
    }

    // Determine final role (query param overrides request, default to requested)
    const validRoles = ['rep', 'manager', 'viewer', 'admin'];
    const finalRole = validRoles.includes(role) ? role : request.requested_role;

    // Create the user
    const userResult = getDb().prepare(`
      INSERT INTO users (
        email, name, password_hash, role, account_name,
        is_active, is_email_verified, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      request.email,
      request.name,
      passwordHash,
      finalRole,
      request.company_name || `${request.name}'s Account`
    );

    // Update the request
    getDb().prepare(`
      UPDATE signup_requests
      SET status = 'approved',
          reviewed_at = CURRENT_TIMESTAMP,
          created_user_id = ?,
          approval_token = NULL,
          denial_token = NULL
      WHERE id = ?
    `).run(userResult.lastInsertRowid, request.id);

    // Send welcome email (different message if user set their own password)
    try {
      await emailService.sendAccessApprovedEmailSimple({
        email: request.email,
        name: request.name,
        role: finalRole,
        userSetPassword: userSetPassword
      });
    } catch (emailError) {
      console.error('[SIGNUP] Failed to send welcome email:', emailError);
    }

    // Log audit event
    try {
      getDb().prepare(`
        INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, created_at)
        VALUES (NULL, 'approve_access_request', 'signup_request', ?, ?, CURRENT_TIMESTAMP)
      `).run(request.id, JSON.stringify({
        approved_email: request.email,
        role: finalRole,
        method: 'email_link',
        userSetPassword: userSetPassword
      }));
    } catch (auditError) {
      console.error('[SIGNUP] Audit log error:', auditError);
    }

    const approvalMessage = userSetPassword
      ? `${request.name} (${request.email}) now has ${finalRole} access. They can log in using the password they created during signup.`
      : `${request.name} (${request.email}) now has ${finalRole} access. A welcome email with temporary credentials has been sent.`;

    return res.send(renderApprovalPage({
      success: true,
      title: 'Access Approved!',
      message: approvalMessage,
      userInfo: {
        name: request.name,
        email: request.email,
        role: finalRole,
        company: request.company_name
      }
    }));

  } catch (error) {
    console.error('[SIGNUP] Approval error:', error);
    return res.status(500).send(renderApprovalPage({
      success: false,
      title: 'Approval Failed',
      message: 'Something went wrong. Please try again from the admin dashboard.',
      showLogin: true
    }));
  }
});

/**
 * GET /signup/deny/:token
 * One-click denial from email
 */
router.get('/deny/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { reason } = req.query;

    const request = getDb().prepare(`
      SELECT * FROM signup_requests
      WHERE denial_token = ? AND status = 'pending'
    `).get(token);

    if (!request) {
      return res.status(404).send(renderApprovalPage({
        success: false,
        title: 'Invalid or Expired Link',
        message: 'This denial link is invalid, expired, or has already been used.',
        showLogin: true
      }));
    }

    // Update the request
    getDb().prepare(`
      UPDATE signup_requests
      SET status = 'denied',
          reviewed_at = CURRENT_TIMESTAMP,
          admin_notes = ?,
          approval_token = NULL,
          denial_token = NULL
      WHERE id = ?
    `).run(reason || 'Denied via email link', request.id);

    // Send denial email
    try {
      await emailService.sendAccessDeniedEmail({
        email: request.email,
        name: request.name,
        reason: reason || null
      });
    } catch (emailError) {
      console.error('[SIGNUP] Failed to send denial email:', emailError);
    }

    // Log audit event
    try {
      getDb().prepare(`
        INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, created_at)
        VALUES (NULL, 'deny_access_request', 'signup_request', ?, ?, CURRENT_TIMESTAMP)
      `).run(request.id, JSON.stringify({
        denied_email: request.email,
        reason: reason || 'No reason provided',
        method: 'email_link'
      }));
    } catch (auditError) {
      console.error('[SIGNUP] Audit log error:', auditError);
    }

    return res.send(renderApprovalPage({
      success: true,
      title: 'Request Denied',
      message: `Access request from ${request.name} (${request.email}) has been denied. They have been notified.`,
      isDenial: true
    }));

  } catch (error) {
    console.error('[SIGNUP] Denial error:', error);
    return res.status(500).send(renderApprovalPage({
      success: false,
      title: 'Denial Failed',
      message: 'Something went wrong. Please try again from the admin dashboard.',
      showLogin: true
    }));
  }
});

/**
 * GET /signup/request-status/:email
 * Check the status of an access request (public)
 */
router.get('/request-status/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase().trim();

    const request = getDb().prepare(`
      SELECT status, created_at FROM signup_requests WHERE email = ?
    `).get(email);

    if (!request) {
      return res.json({
        success: true,
        status: 'not_found',
        message: 'No access request found for this email.'
      });
    }

    const messages = {
      pending: 'Your request is being reviewed. We\'ll notify you by email.',
      approved: 'Your request was approved! Check your email for login details.',
      denied: 'Your request was not approved at this time.'
    };

    res.json({
      success: true,
      status: request.status,
      message: messages[request.status],
      requestedAt: request.created_at
    });

  } catch (error) {
    console.error('[SIGNUP] Status check error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check request status'
    });
  }
});

// =====================================================
// ADMIN API ENDPOINTS (Require Auth)
// =====================================================

const { requireAuth, requireRole } = require('./auth-middleware');

/**
 * GET /api/signup-requests
 * List all signup requests (admin only)
 */
router.get('/api/requests', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT sr.*, u.name as reviewer_name
      FROM signup_requests sr
      LEFT JOIN users u ON sr.reviewed_by = u.id
    `;
    const params = [];

    if (status && ['pending', 'approved', 'denied'].includes(status)) {
      query += ' WHERE sr.status = ?';
      params.push(status);
    }

    query += ' ORDER BY sr.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const requests = getDb().prepare(query).all(...params);

    // Get counts
    const counts = getDb().prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END) as denied
      FROM signup_requests
    `).get();

    res.json({
      success: true,
      data: {
        requests: requests.map(r => ({
          ...r,
          approval_token: undefined,
          denial_token: undefined
        })),
        counts
      }
    });

  } catch (error) {
    console.error('[SIGNUP] List requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch requests'
    });
  }
});

/**
 * POST /api/signup-requests/:id/approve
 * Approve a request from dashboard (admin only)
 */
router.post('/api/requests/:id/approve', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role, notes } = req.body;

    const request = getDb().prepare(`
      SELECT * FROM signup_requests WHERE id = ? AND status = 'pending'
    `).get(id);

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Request not found or already processed'
      });
    }

    // Use the password the user set during signup, or generate one if not set (legacy requests)
    let passwordHash = request.password_hash;
    let temporaryPassword = null;
    let userSetPassword = true;

    if (!passwordHash) {
      // Legacy request without password - generate temporary one
      temporaryPassword = generateSecurePassword();
      passwordHash = await bcrypt.hash(temporaryPassword, 10);
      userSetPassword = false;
    }

    // Determine role
    const validRoles = ['rep', 'manager', 'viewer', 'admin'];
    const finalRole = validRoles.includes(role) ? role : request.requested_role;

    // Create the user
    const userResult = getDb().prepare(`
      INSERT INTO users (
        email, name, password_hash, role, account_name,
        is_active, is_email_verified, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      request.email,
      request.name,
      passwordHash,
      finalRole,
      request.company_name || `${request.name}'s Account`
    );

    // Update the request
    getDb().prepare(`
      UPDATE signup_requests
      SET status = 'approved',
          reviewed_by = ?,
          reviewed_at = CURRENT_TIMESTAMP,
          admin_notes = ?,
          created_user_id = ?,
          approval_token = NULL,
          denial_token = NULL
      WHERE id = ?
    `).run(req.user.id, notes || null, userResult.lastInsertRowid, id);

    // Try to send welcome email
    let emailSent = false;
    let emailError = null;
    try {
      if (userSetPassword) {
        // User set their own password - send simple welcome email
        await emailService.sendAccessApprovedEmailSimple({
          email: request.email,
          name: request.name,
          role: finalRole,
          userSetPassword: true
        });
      } else {
        // Legacy request - send email with temp password
        await emailService.sendAccessApprovedEmail({
          email: request.email,
          name: request.name,
          role: finalRole,
          temporaryPassword
        });
      }
      emailSent = true;
    } catch (err) {
      console.error('[SIGNUP] Failed to send welcome email:', err);
      emailError = err.message;
    }

    // Log audit event
    getDb().prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, created_at)
      VALUES (?, 'approve_access_request', 'signup_request', ?, ?, CURRENT_TIMESTAMP)
    `).run(req.user.id, id, JSON.stringify({
      approved_email: request.email,
      role: finalRole,
      method: 'dashboard',
      userSetPassword: userSetPassword
    }));

    // Response message depends on whether user set their own password
    let message;
    if (userSetPassword) {
      message = emailSent
        ? `Access approved for ${request.name}. They can log in with the password they created during signup.`
        : `Access approved for ${request.name}. Email delivery failed, but they can log in with the password they created.`;
    } else {
      message = emailSent
        ? `Access approved for ${request.name}. Welcome email with credentials sent.`
        : `Access approved for ${request.name}. Email delivery failed - please share credentials manually.`;
    }

    res.json({
      success: true,
      message: message,
      data: {
        userId: userResult.lastInsertRowid,
        email: request.email,
        name: request.name,
        role: finalRole,
        userSetPassword: userSetPassword,
        temporaryPassword: temporaryPassword,  // Only set for legacy requests
        emailSent: emailSent,
        emailError: emailError
      }
    });

  } catch (error) {
    console.error('[SIGNUP] Dashboard approval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve request'
    });
  }
});

/**
 * POST /api/signup-requests/:id/deny
 * Deny a request from dashboard (admin only)
 */
router.post('/api/requests/:id/deny', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const request = getDb().prepare(`
      SELECT * FROM signup_requests WHERE id = ? AND status = 'pending'
    `).get(id);

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Request not found or already processed'
      });
    }

    // Update the request
    getDb().prepare(`
      UPDATE signup_requests
      SET status = 'denied',
          reviewed_by = ?,
          reviewed_at = CURRENT_TIMESTAMP,
          admin_notes = ?,
          approval_token = NULL,
          denial_token = NULL
      WHERE id = ?
    `).run(req.user.id, reason || 'Denied by administrator', id);

    // Send denial email
    try {
      await emailService.sendAccessDeniedEmail({
        email: request.email,
        name: request.name,
        reason: reason || null
      });
    } catch (emailError) {
      console.error('[SIGNUP] Failed to send denial email:', emailError);
    }

    // Log audit event
    getDb().prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, created_at)
      VALUES (?, 'deny_access_request', 'signup_request', ?, ?, CURRENT_TIMESTAMP)
    `).run(req.user.id, id, JSON.stringify({
      denied_email: request.email,
      reason: reason || 'No reason provided',
      method: 'dashboard'
    }));

    res.json({
      success: true,
      message: `Access denied for ${request.name}. Notification email sent.`
    });

  } catch (error) {
    console.error('[SIGNUP] Dashboard denial error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to deny request'
    });
  }
});

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Generate a secure temporary password
 */
function generateSecurePassword() {
  const length = 12;
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*';
  let password = '';

  // Ensure at least one of each required type
  password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)];
  password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];
  password += '0123456789'[Math.floor(Math.random() * 10)];
  password += '!@#$%&*'[Math.floor(Math.random() * 7)];

  // Fill the rest
  for (let i = password.length; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)];
  }

  // Shuffle
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Render the approval/denial confirmation page
 */
function renderApprovalPage({ success, title, message, userInfo, isDenial, showLogin }) {
  const bgColor = success ? (isDenial ? '#fef3c7' : '#d1fae5') : '#fee2e2';
  const titleColor = success ? (isDenial ? '#92400e' : '#065f46') : '#991b1b';
  const icon = success ? (isDenial ? '🚫' : '✅') : '❌';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${title} - Revenue Radar</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #0a0f1a 0%, #1a1a2e 100%);
          margin: 0;
          padding: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
        }
        .container {
          background: white;
          border-radius: 16px;
          padding: 50px;
          max-width: 500px;
          text-align: center;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .icon { font-size: 64px; margin-bottom: 20px; }
        h1 { color: ${titleColor}; margin: 20px 0; font-size: 28px; }
        p { color: #666; line-height: 1.6; margin: 20px 0; font-size: 16px; }
        .info-box {
          background: ${bgColor};
          border-radius: 12px;
          padding: 20px;
          margin: 30px 0;
          text-align: left;
        }
        .info-box strong { color: #1a1a1a; }
        .info-row { margin: 10px 0; }
        .button {
          display: inline-block;
          margin-top: 20px;
          padding: 14px 32px;
          background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
          color: #1a1a1a;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 700;
          font-size: 15px;
        }
        .button:hover { opacity: 0.9; }
        .logo {
          font-size: 48px;
          font-weight: 900;
          color: #fbbf24;
          margin-bottom: 10px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">$</div>
        <div class="icon">${icon}</div>
        <h1>${title}</h1>
        <p>${message}</p>
        ${userInfo ? `
          <div class="info-box">
            <div class="info-row"><strong>Name:</strong> ${userInfo.name}</div>
            <div class="info-row"><strong>Email:</strong> ${userInfo.email}</div>
            <div class="info-row"><strong>Role:</strong> ${userInfo.role}</div>
            ${userInfo.company ? `<div class="info-row"><strong>Company:</strong> ${userInfo.company}</div>` : ''}
          </div>
        ` : ''}
        ${showLogin ? `<a href="/dashboard/login.html" class="button">Go to Dashboard</a>` : `<a href="/dashboard/admin-ops.html" class="button">View All Requests</a>`}
      </div>
    </body>
    </html>
  `;
}

module.exports = router;
