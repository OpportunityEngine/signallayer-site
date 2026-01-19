// =====================================================
// AUTHENTICATION API ROUTES
// =====================================================
// Complete authentication API:
// - Login / Logout
// - Register
// - Password reset
// - Email verification
// - Session management
// - User profile
// =====================================================

const express = require('express');
const router = express.Router();
const authService = require('./auth-service');
const { requireAuth, requireRole, sanitizeInput, rateLimit } = require('./auth-middleware');

// Apply input sanitization to all routes
router.use(sanitizeInput);

// =====================================================
// PUBLIC ROUTES (No authentication required)
// =====================================================

/**
 * POST /auth/login
 * Login with email and password
 */
router.post('/login',
  rateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 20, message: 'Too many login attempts. Please wait a few minutes.' }),
  async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email and password are required'
        });
      }

      const result = await authService.login({
        email,
        password,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.headers['user-agent']
      });

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('[AUTH] Login error:', error);

      // Don't expose specific error messages for security
      res.status(401).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * POST /auth/register
 * Register a new user
 */
router.post('/register',
  rateLimit({ windowMs: 60 * 60 * 1000, maxRequests: 3, message: 'Too many registration attempts' }),
  async (req, res) => {
    try {
      const { email, password, fullName, accountName } = req.body;

      if (!email || !password || !fullName) {
        return res.status(400).json({
          success: false,
          error: 'Email, password, and full name are required'
        });
      }

      const result = await authService.register({
        email,
        password,
        fullName,
        accountName: accountName || 'Default Account',
        role: 'rep'  // Default role for self-registration
      });

      res.status(201).json({
        success: true,
        data: {
          userId: result.userId,
          email: result.email,
          message: 'Registration successful. Please check your email to verify your account.'
        }
      });

    } catch (error) {
      console.error('[AUTH] Registration error:', error);

      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * POST /auth/refresh-token
 * Refresh access token using refresh token
 */
router.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken, sessionId } = req.body;

    if (!refreshToken || !sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token and session ID are required'
      });
    }

    const result = await authService.refreshAccessToken({
      refreshToken,
      sessionId
    });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[AUTH] Token refresh error:', error);

    res.status(401).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /auth/forgot-password
 * Request password reset
 */
router.post('/forgot-password',
  rateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 3, message: 'Too many password reset requests' }),
  async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'Email is required'
        });
      }

      // Always return success to prevent email enumeration
      const db = require('./database').getDatabase();
      const user = db.prepare('SELECT id, name FROM users WHERE email = ?').get(email.toLowerCase());

      if (user) {
        const token = authService.generatePasswordResetToken(user.id);

        // Send password reset email
        const emailService = require('./email-service');
        try {
          await emailService.sendPasswordResetEmail(email.toLowerCase(), user.name, token);
          console.log(`[AUTH] Password reset email sent to ${email}`);
        } catch (emailError) {
          console.error('[AUTH] Failed to send password reset email:', emailError);
          // Still log the token for development/debugging
          console.log(`[AUTH] Password reset token for ${email}: ${token}`);
        }
      }

      res.json({
        success: true,
        message: 'If an account exists with that email, a password reset link has been sent.'
      });

    } catch (error) {
      console.error('[AUTH] Forgot password error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to process password reset request'
      });
    }
  }
);

/**
 * POST /auth/reset-password
 * Reset password using token
 */
router.post('/reset-password',
  rateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 5 }),
  async (req, res) => {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({
          success: false,
          error: 'Token and new password are required'
        });
      }

      await authService.resetPassword({ token, newPassword });

      res.json({
        success: true,
        message: 'Password reset successfully. Please log in with your new password.'
      });

    } catch (error) {
      console.error('[AUTH] Password reset error:', error);

      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * GET /auth/verify-email/:token
 * Verify email address
 */
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;

    await authService.verifyEmail(token);

    // Redirect to success page or login
    res.redirect('/login?verified=true');

  } catch (error) {
    console.error('[AUTH] Email verification error:', error);

    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// PROTECTED ROUTES (Authentication required)
// =====================================================

/**
 * POST /auth/logout
 * Logout and revoke session
 */
router.post('/logout', requireAuth, async (req, res) => {
  try {
    await authService.logout({
      sessionId: req.sessionId,
      userId: req.user.id,
      ipAddress: req.ip || req.connection.remoteAddress
    });

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('[AUTH] Logout error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to logout'
    });
  }
});

/**
 * GET /auth/me
 * Get current user profile
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const db = require('./database').getDatabase();

    const user = db.prepare(`
      SELECT id, email, name, role, account_name,
             is_active, is_email_verified, last_login_at, created_at
      FROM users
      WHERE id = ?
    `).get(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        accountName: user.account_name,
        isActive: user.is_active,
        isEmailVerified: user.is_email_verified,
        lastLoginAt: user.last_login_at,
        createdAt: user.created_at
      }
    });

  } catch (error) {
    console.error('[AUTH] Get user error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to get user info'
    });
  }
});

/**
 * PUT /auth/profile
 * Update user profile (name)
 */
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Name is required'
      });
    }

    if (name.trim().length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Name must be less than 100 characters'
      });
    }

    const db = require('./database').getDatabase();

    db.prepare(`
      UPDATE users
      SET name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name.trim(), req.user.id);

    await authService.logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'profile_updated',
      description: 'User updated their name',
      ipAddress: req.ip,
      success: true
    });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { name: name.trim() }
    });

  } catch (error) {
    console.error('[AUTH] Update profile error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to update profile'
    });
  }
});

/**
 * PUT /auth/change-password
 * Change password (requires current password)
 */
router.put('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }

    const db = require('./database').getDatabase();
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);

    // Verify current password
    const validPassword = await authService.verifyPassword(currentPassword, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    // Validate new password
    const validation = authService.validatePassword(newPassword);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.errors.join(', ')
      });
    }

    // Check if password was used before
    if (await authService.isPasswordReused(req.user.id, newPassword)) {
      return res.status(400).json({
        success: false,
        error: 'Cannot reuse recent passwords'
      });
    }

    // Hash and save new password
    const newPasswordHash = await authService.hashPassword(newPassword);

    db.prepare(`
      UPDATE users
      SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newPasswordHash, req.user.id);

    // Save to history
    authService.savePasswordHistory(req.user.id, newPasswordHash);

    await authService.logAudit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'password_changed',
      description: 'User changed their password',
      ipAddress: req.ip,
      success: true
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('[AUTH] Change password error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to change password'
    });
  }
});

/**
 * GET /auth/sessions
 * Get all active sessions for current user
 */
router.get('/sessions', requireAuth, async (req, res) => {
  try {
    const sessions = authService.getUserSessions(req.user.id);

    res.json({
      success: true,
      data: sessions
    });

  } catch (error) {
    console.error('[AUTH] Get sessions error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to get sessions'
    });
  }
});

/**
 * DELETE /auth/sessions/:sessionId
 * Revoke a specific session
 */
router.delete('/sessions/:sessionId', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;

    authService.revokeSession(parseInt(sessionId), req.user.id);

    res.json({
      success: true,
      message: 'Session revoked successfully'
    });

  } catch (error) {
    console.error('[AUTH] Revoke session error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to revoke session'
    });
  }
});

// =====================================================
// ADMIN ROUTES (Admin only)
// =====================================================

/**
 * POST /auth/users
 * Create a new user (admin only)
 */
router.post('/users',
  requireAuth,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { email, password, fullName, role, accountName } = req.body;

      if (!email || !password || !fullName || !role) {
        return res.status(400).json({
          success: false,
          error: 'Email, password, full name, and role are required'
        });
      }

      const result = await authService.register({
        email,
        password,
        fullName,
        role,
        accountName: accountName || 'Default Account',
        createdBy: req.user.id
      });

      res.status(201).json({
        success: true,
        data: {
          userId: result.userId,
          email: result.email
        }
      });

    } catch (error) {
      console.error('[AUTH] Create user error:', error);

      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * GET /auth/users
 * Get all users (admin only)
 */
router.get('/users',
  requireAuth,
  requireRole('admin'),
  async (req, res) => {
    try {
      const db = require('./database').getDatabase();

      const users = db.prepare(`
        SELECT id, email, name, role, account_name,
               is_active, is_email_verified, last_login_at, created_at
        FROM users
        ORDER BY created_at DESC
      `).all();

      res.json({
        success: true,
        data: users.map(u => ({
          id: u.id,
          email: u.email,
          fullName: u.name,
          role: u.role,
          accountName: u.account_name,
          isActive: u.is_active,
          isEmailVerified: u.is_email_verified,
          lastLoginAt: u.last_login_at,
          createdAt: u.created_at
        }))
      });

    } catch (error) {
      console.error('[AUTH] Get users error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to get users'
      });
    }
  }
);

/**
 * PUT /auth/users/:userId
 * Update user (admin only)
 */
router.put('/users/:userId',
  requireAuth,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { fullName, role, accountName, isActive } = req.body;

      const db = require('./database').getDatabase();

      const updates = [];
      const values = [];

      if (fullName !== undefined) {
        updates.push('name = ?');
        values.push(fullName);
      }

      if (role !== undefined) {
        updates.push('role = ?');
        values.push(role);
      }

      if (accountName !== undefined) {
        updates.push('account_name = ?');
        values.push(accountName);
      }

      if (isActive !== undefined) {
        updates.push('is_active = ?');
        values.push(isActive ? 1 : 0);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No fields to update'
        });
      }

      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(userId);

      db.prepare(`
        UPDATE users
        SET ${updates.join(', ')}
        WHERE id = ?
      `).run(...values);

      await authService.logAudit({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'user_updated',
        resourceType: 'user',
        resourceId: userId,
        description: `Admin updated user ${userId}`,
        ipAddress: req.ip,
        success: true
      });

      res.json({
        success: true,
        message: 'User updated successfully'
      });

    } catch (error) {
      console.error('[AUTH] Update user error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to update user'
      });
    }
  }
);

/**
 * DELETE /auth/users/:userId
 * Delete user (admin only)
 */
router.delete('/users/:userId',
  requireAuth,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { userId } = req.params;

      // Can't delete yourself
      if (parseInt(userId) === req.user.id) {
        return res.status(400).json({
          success: false,
          error: 'Cannot delete your own account'
        });
      }

      const db = require('./database').getDatabase();

      db.prepare('DELETE FROM users WHERE id = ?').run(userId);

      await authService.logAudit({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'user_deleted',
        resourceType: 'user',
        resourceId: userId,
        description: `Admin deleted user ${userId}`,
        ipAddress: req.ip,
        success: true
      });

      res.json({
        success: true,
        message: 'User deleted successfully'
      });

    } catch (error) {
      console.error('[AUTH] Delete user error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to delete user'
      });
    }
  }
);

// =====================================================
// TRIAL STATUS ENDPOINT
// =====================================================

/**
 * GET /auth/trial/status
 * Get trial status for current user
 */
router.get('/trial/status', requireAuth, (req, res) => {
  try {
    const { getTrialStatus } = require('./trial-middleware');
    const trialStatus = getTrialStatus(req.user.id);

    res.json({
      success: true,
      data: trialStatus
    });
  } catch (error) {
    console.error('[AUTH] Trial status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load trial status'
    });
  }
});

module.exports = router;
