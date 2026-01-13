// =====================================================
// AUTHENTICATION SERVICE
// =====================================================
// Production-grade authentication with:
// - bcrypt password hashing
// - JWT token generation/validation
// - Session management
// - Account lockout after failed attempts
// - Password reset tokens
// - Audit logging
// =====================================================

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./database');

// Security configuration
const AUTH_CONFIG = {
  JWT_SECRET: process.env.JWT_SECRET || 'CHANGE_THIS_IN_PRODUCTION_' + crypto.randomBytes(32).toString('hex'),
  JWT_EXPIRES_IN: '24h',
  REFRESH_TOKEN_EXPIRES_IN: '30d',
  BCRYPT_ROUNDS: 10,
  MAX_FAILED_ATTEMPTS: 5,
  LOCKOUT_DURATION_MINUTES: 15,
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_HISTORY_COUNT: 5,  // Prevent reusing last 5 passwords
  SESSION_CLEANUP_INTERVAL: 60 * 60 * 1000  // 1 hour
};

class AuthService {
  constructor() {
    // Periodically clean up expired sessions
    setInterval(() => this.cleanupExpiredSessions(), AUTH_CONFIG.SESSION_CLEANUP_INTERVAL);
  }

  // =====================================================
  // PASSWORD MANAGEMENT
  // =====================================================

  /**
   * Hash a password using bcrypt
   */
  async hashPassword(password) {
    return await bcrypt.hash(password, AUTH_CONFIG.BCRYPT_ROUNDS);
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
  }

  /**
   * Validate password strength
   */
  validatePassword(password) {
    const errors = [];

    if (password.length < AUTH_CONFIG.PASSWORD_MIN_LENGTH) {
      errors.push(`Password must be at least ${AUTH_CONFIG.PASSWORD_MIN_LENGTH} characters`);
    }

    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (!/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Check if password was used recently
   */
  async isPasswordReused(userId, newPasswordHash) {
    const database = db.getDatabase();

    const history = database.prepare(`
      SELECT password_hash
      FROM password_history
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userId, AUTH_CONFIG.PASSWORD_HISTORY_COUNT);

    for (const record of history) {
      if (await bcrypt.compare(newPasswordHash, record.password_hash)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Save password to history
   */
  savePasswordHistory(userId, passwordHash) {
    const database = db.getDatabase();

    database.prepare(`
      INSERT INTO password_history (user_id, password_hash)
      VALUES (?, ?)
    `).run(userId, passwordHash);

    // Keep only last N passwords
    database.prepare(`
      DELETE FROM password_history
      WHERE user_id = ?
      AND id NOT IN (
        SELECT id FROM password_history
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      )
    `).run(userId, userId, AUTH_CONFIG.PASSWORD_HISTORY_COUNT);
  }

  // =====================================================
  // USER AUTHENTICATION
  // =====================================================

  /**
   * Register a new user
   */
  async register({ email, password, fullName, role = 'rep', accountName, createdBy = null }) {
    const database = db.getDatabase();

    // Validate email
    email = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Invalid email address');
    }

    // Validate password
    const passwordValidation = this.validatePassword(password);
    if (!passwordValidation.valid) {
      throw new Error(passwordValidation.errors.join(', '));
    }

    // Check if user exists
    const existingUser = database.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      throw new Error('Email already registered');
    }

    // Hash password
    const passwordHash = await this.hashPassword(password);

    // Create user
    const result = database.prepare(`
      INSERT INTO users (
        email, password_hash, name, role, account_name,
        is_active, password_changed_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    `).run(email, passwordHash, fullName, role, accountName, true, createdBy);

    const userId = result.lastInsertRowid;

    // Save to password history
    this.savePasswordHistory(userId, passwordHash);

    // Create email verification token
    const verificationToken = this.generateEmailVerificationToken(userId);

    // Audit log
    this.logAudit({
      userId,
      userEmail: email,
      action: 'user_registered',
      resourceType: 'user',
      resourceId: userId,
      description: `New user registered: ${email}`,
      success: true
    });

    return {
      userId,
      email,
      verificationToken
    };
  }

  /**
   * Login user
   */
  async login({ email, password, ipAddress, userAgent }) {
    const database = db.getDatabase();

    email = email.toLowerCase().trim();

    // Get user
    const user = database.prepare(`
      SELECT id, email, password_hash, name, role, account_name,
             is_active, is_email_verified, failed_login_attempts, locked_until
      FROM users
      WHERE email = ?
    `).get(email);

    // Check if user exists
    if (!user) {
      await this.logAudit({
        userEmail: email,
        action: 'login_failed',
        description: 'User not found',
        ipAddress,
        success: false,
        errorMessage: 'Invalid credentials'
      });
      throw new Error('Invalid email or password');
    }

    // Check if account is locked
    if (user.locked_until) {
      const lockoutEnd = new Date(user.locked_until);
      if (lockoutEnd > new Date()) {
        const minutesLeft = Math.ceil((lockoutEnd - new Date()) / 60000);
        throw new Error(`Account locked. Try again in ${minutesLeft} minutes.`);
      } else {
        // Unlock account
        database.prepare(`
          UPDATE users
          SET locked_until = NULL, failed_login_attempts = 0
          WHERE id = ?
        `).run(user.id);
      }
    }

    // Check if active
    if (!user.is_active) {
      throw new Error('Account is disabled. Contact administrator.');
    }

    // Verify password
    const passwordValid = await this.verifyPassword(password, user.password_hash);

    if (!passwordValid) {
      // Increment failed attempts
      const newFailedAttempts = user.failed_login_attempts + 1;
      const updates = {
        failedAttempts: newFailedAttempts
      };

      // Skip lockout for admin@revenueradar.com (unlimited attempts for system admin)
      const isSystemAdmin = email.toLowerCase() === 'admin@revenueradar.com';

      // Lock account if too many failed attempts (except system admin)
      if (!isSystemAdmin && newFailedAttempts >= AUTH_CONFIG.MAX_FAILED_ATTEMPTS) {
        const lockoutUntil = new Date();
        lockoutUntil.setMinutes(lockoutUntil.getMinutes() + AUTH_CONFIG.LOCKOUT_DURATION_MINUTES);
        updates.lockedUntil = lockoutUntil.toISOString();

        database.prepare(`
          UPDATE users
          SET failed_login_attempts = ?, locked_until = ?
          WHERE id = ?
        `).run(newFailedAttempts, updates.lockedUntil, user.id);

        await this.logAudit({
          userId: user.id,
          userEmail: email,
          action: 'account_locked',
          description: `Account locked after ${newFailedAttempts} failed login attempts`,
          ipAddress,
          success: false
        });

        throw new Error(`Account locked after ${newFailedAttempts} failed attempts. Try again in ${AUTH_CONFIG.LOCKOUT_DURATION_MINUTES} minutes.`);
      } else {
        database.prepare(`
          UPDATE users
          SET failed_login_attempts = ?
          WHERE id = ?
        `).run(newFailedAttempts, user.id);
      }

      await this.logAudit({
        userId: user.id,
        userEmail: email,
        action: 'login_failed',
        description: `Invalid password (attempt ${newFailedAttempts}/${AUTH_CONFIG.MAX_FAILED_ATTEMPTS})`,
        ipAddress,
        success: false,
        errorMessage: 'Invalid credentials'
      });

      throw new Error('Invalid email or password');
    }

    // Reset failed attempts on successful login
    database.prepare(`
      UPDATE users
      SET failed_login_attempts = 0,
          locked_until = NULL,
          last_login_at = CURRENT_TIMESTAMP,
          last_login_ip = ?
      WHERE id = ?
    `).run(ipAddress, user.id);

    // Generate tokens
    const { accessToken, refreshToken, sessionId } = await this.generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
      accountName: user.account_name,
      ipAddress,
      userAgent
    });

    await this.logAudit({
      userId: user.id,
      userEmail: user.email,
      action: 'login_success',
      description: `User logged in successfully`,
      ipAddress,
      success: true
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        accountName: user.account_name,
        isEmailVerified: user.is_email_verified
      },
      accessToken,
      refreshToken,
      sessionId
    };
  }

  /**
   * Logout user
   */
  async logout({ sessionId, userId, ipAddress }) {
    const database = db.getDatabase();

    database.prepare(`
      UPDATE sessions
      SET is_active = FALSE,
          revoked_at = CURRENT_TIMESTAMP,
          revoked_reason = 'user_logout'
      WHERE id = ? AND user_id = ?
    `).run(sessionId, userId);

    await this.logAudit({
      userId,
      action: 'logout',
      description: 'User logged out',
      ipAddress,
      success: true
    });

    return { success: true };
  }

  // =====================================================
  // JWT TOKEN MANAGEMENT
  // =====================================================

  /**
   * Generate access and refresh tokens
   */
  async generateTokens({ userId, email, role, accountName, ipAddress, userAgent }) {
    const database = db.getDatabase();

    // Generate unique JWT ID
    const jti = crypto.randomBytes(16).toString('hex');

    // Create access token
    const accessToken = jwt.sign(
      {
        userId,
        email,
        role,
        accountName,
        type: 'access'
      },
      AUTH_CONFIG.JWT_SECRET,
      {
        expiresIn: AUTH_CONFIG.JWT_EXPIRES_IN,
        jwtid: jti
      }
    );

    // Create refresh token
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const refreshTokenHash = await this.hashPassword(refreshToken);

    // Calculate expiration dates
    const accessExpires = new Date();
    accessExpires.setHours(accessExpires.getHours() + 24);

    const refreshExpires = new Date();
    refreshExpires.setDate(refreshExpires.getDate() + 30);

    // Store session
    const result = database.prepare(`
      INSERT INTO sessions (
        user_id, token_jti, refresh_token_hash,
        ip_address, user_agent, expires_at, refresh_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      jti,
      refreshTokenHash,
      ipAddress,
      userAgent,
      accessExpires.toISOString(),
      refreshExpires.toISOString()
    );

    return {
      accessToken,
      refreshToken,
      sessionId: result.lastInsertRowid,
      expiresIn: AUTH_CONFIG.JWT_EXPIRES_IN
    };
  }

  /**
   * Verify JWT token
   */
  async verifyToken(token) {
    try {
      const decoded = jwt.verify(token, AUTH_CONFIG.JWT_SECRET);

      // Check if session is still active
      const database = db.getDatabase();
      const session = database.prepare(`
        SELECT s.*, u.email, u.role, u.account_name, u.is_active
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_jti = ? AND s.is_active = TRUE
      `).get(decoded.jti);

      if (!session) {
        throw new Error('Session not found or expired');
      }

      if (!session.is_active) {
        throw new Error('User account is disabled');
      }

      // Update last activity
      database.prepare(`
        UPDATE sessions
        SET last_activity_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(session.id);

      return {
        valid: true,
        user: {
          id: decoded.userId,
          email: session.email,
          role: session.role,
          accountName: session.account_name
        },
        sessionId: session.id
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken({ refreshToken, sessionId }) {
    const database = db.getDatabase();

    const session = database.prepare(`
      SELECT s.*, u.id as user_id, u.email, u.role, u.account_name, u.is_active
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.is_active = TRUE
    `).get(sessionId);

    if (!session) {
      throw new Error('Session not found');
    }

    if (!session.is_active) {
      throw new Error('User account is disabled');
    }

    // Verify refresh token
    const validRefreshToken = await this.verifyPassword(refreshToken, session.refresh_token_hash);
    if (!validRefreshToken) {
      throw new Error('Invalid refresh token');
    }

    // Check if refresh token expired
    if (new Date(session.refresh_expires_at) < new Date()) {
      throw new Error('Refresh token expired');
    }

    // Generate new access token (same JTI, new expiration)
    const accessToken = jwt.sign(
      {
        userId: session.user_id,
        email: session.email,
        role: session.role,
        accountName: session.account_name,
        type: 'access'
      },
      AUTH_CONFIG.JWT_SECRET,
      {
        expiresIn: AUTH_CONFIG.JWT_EXPIRES_IN,
        jwtid: session.token_jti
      }
    );

    // Update session expiration
    const newExpires = new Date();
    newExpires.setHours(newExpires.getHours() + 24);

    database.prepare(`
      UPDATE sessions
      SET expires_at = ?, last_activity_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newExpires.toISOString(), sessionId);

    return {
      accessToken,
      expiresIn: AUTH_CONFIG.JWT_EXPIRES_IN
    };
  }

  // =====================================================
  // PASSWORD RESET
  // =====================================================

  /**
   * Generate password reset token
   */
  generatePasswordResetToken(userId) {
    const database = db.getDatabase();

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setHours(expires.getHours() + 1);  // 1 hour expiration

    database.prepare(`
      UPDATE users
      SET password_reset_token = ?,
          password_reset_expires = ?
      WHERE id = ?
    `).run(token, expires.toISOString(), userId);

    return token;
  }

  /**
   * Verify password reset token
   */
  verifyPasswordResetToken(token) {
    const database = db.getDatabase();

    const user = database.prepare(`
      SELECT id, email, password_reset_expires
      FROM users
      WHERE password_reset_token = ?
    `).get(token);

    if (!user) {
      throw new Error('Invalid reset token');
    }

    if (new Date(user.password_reset_expires) < new Date()) {
      throw new Error('Reset token expired');
    }

    return user;
  }

  /**
   * Reset password using token
   */
  async resetPassword({ token, newPassword }) {
    const database = db.getDatabase();

    // Verify token
    const user = this.verifyPasswordResetToken(token);

    // Validate new password
    const validation = this.validatePassword(newPassword);
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }

    // Hash new password
    const newPasswordHash = await this.hashPassword(newPassword);

    // Check if password was used before
    if (await this.isPasswordReused(user.id, newPassword)) {
      throw new Error('Cannot reuse recent passwords');
    }

    // Update password
    database.prepare(`
      UPDATE users
      SET password_hash = ?,
          password_reset_token = NULL,
          password_reset_expires = NULL,
          password_changed_at = CURRENT_TIMESTAMP,
          failed_login_attempts = 0,
          locked_until = NULL
      WHERE id = ?
    `).run(newPasswordHash, user.id);

    // Save to history
    this.savePasswordHistory(user.id, newPasswordHash);

    // Revoke all sessions (force re-login)
    database.prepare(`
      UPDATE sessions
      SET is_active = FALSE,
          revoked_at = CURRENT_TIMESTAMP,
          revoked_reason = 'password_reset'
      WHERE user_id = ?
    `).run(user.id);

    await this.logAudit({
      userId: user.id,
      userEmail: user.email,
      action: 'password_reset',
      description: 'Password reset successfully',
      success: true
    });

    return { success: true };
  }

  // =====================================================
  // EMAIL VERIFICATION
  // =====================================================

  /**
   * Generate email verification token
   */
  generateEmailVerificationToken(userId) {
    const database = db.getDatabase();

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);  // 7 days

    database.prepare(`
      INSERT INTO email_verification_tokens (user_id, token, expires_at)
      VALUES (?, ?, ?)
    `).run(userId, token, expires.toISOString());

    return token;
  }

  /**
   * Verify email using token
   */
  async verifyEmail(token) {
    const database = db.getDatabase();

    const verification = database.prepare(`
      SELECT v.*, u.email
      FROM email_verification_tokens v
      JOIN users u ON u.id = v.user_id
      WHERE v.token = ? AND v.used_at IS NULL
    `).get(token);

    if (!verification) {
      throw new Error('Invalid verification token');
    }

    if (new Date(verification.expires_at) < new Date()) {
      throw new Error('Verification token expired');
    }

    // Mark email as verified
    database.prepare(`
      UPDATE users
      SET is_email_verified = TRUE,
          email_verified_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(verification.user_id);

    // Mark token as used
    database.prepare(`
      UPDATE email_verification_tokens
      SET used_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(verification.id);

    await this.logAudit({
      userId: verification.user_id,
      userEmail: verification.email,
      action: 'email_verified',
      description: 'Email verified successfully',
      success: true
    });

    return { success: true };
  }

  // =====================================================
  // SESSION MANAGEMENT
  // =====================================================

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions() {
    try {
      const database = db.getDatabase();

      const result = database.prepare(`
        UPDATE sessions
        SET is_active = FALSE,
            revoked_at = CURRENT_TIMESTAMP,
            revoked_reason = 'expired'
        WHERE is_active = TRUE
        AND expires_at < CURRENT_TIMESTAMP
      `).run();

      if (result.changes > 0) {
        console.log(`[AUTH] Cleaned up ${result.changes} expired sessions`);
      }
    } catch (error) {
      console.error('[AUTH] Error cleaning up sessions:', error);
    }
  }

  /**
   * Get user sessions
   */
  getUserSessions(userId) {
    const database = db.getDatabase();

    return database.prepare(`
      SELECT id, ip_address, user_agent, created_at, last_activity_at,
             expires_at, is_active
      FROM sessions
      WHERE user_id = ? AND is_active = TRUE
      ORDER BY last_activity_at DESC
    `).all(userId);
  }

  /**
   * Revoke specific session
   */
  revokeSession(sessionId, userId) {
    const database = db.getDatabase();

    database.prepare(`
      UPDATE sessions
      SET is_active = FALSE,
          revoked_at = CURRENT_TIMESTAMP,
          revoked_reason = 'user_revoked'
      WHERE id = ? AND user_id = ?
    `).run(sessionId, userId);

    return { success: true };
  }

  // =====================================================
  // AUDIT LOGGING
  // =====================================================

  async logAudit({ userId = null, userEmail = null, action, resourceType = null,
                   resourceId = null, description = '', metadata = null,
                   ipAddress = null, userAgent = null, success = true,
                   errorMessage = null }) {
    try {
      const database = db.getDatabase();

      database.prepare(`
        INSERT INTO audit_logs (
          user_id, action, resource_type, resource_id,
          details, ip_address, user_agent, success, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        userId,
        action,
        resourceType,
        resourceId,
        JSON.stringify({ description, metadata, error: errorMessage }),
        ipAddress,
        userAgent,
        success ? 1 : 0
      );
    } catch (error) {
      console.error('[AUTH] Failed to log audit:', error);
    }
  }
}

// Export singleton instance
module.exports = new AuthService();
