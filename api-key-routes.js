// =====================================================
// API KEY MANAGEMENT ROUTES
// =====================================================
// Secure API key generation and management for external integrations
// =====================================================

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./database');
const { requireAuth, requireRole, requirePermission } = require('./auth-middleware');
const authService = require('./auth-service');

/**
 * Generate a secure API key
 */
function generateAPIKey() {
  const prefix = 'sk_live_';  // Standard prefix
  const randomPart = crypto.randomBytes(24).toString('hex');
  return `${prefix}${randomPart}`;
}

/**
 * GET /api-keys
 * List all API keys for current user/account
 */
router.get('/',
  requireAuth,
  requirePermission('api_keys.read'),
  async (req, res) => {
    try {
      const database = db.getDatabase();

      const keys = database.prepare(`
        SELECT id, key_name, key_prefix, scopes, rate_limit_per_hour,
               is_active, expires_at, last_used_at, created_at
        FROM api_keys
        WHERE user_id = ? AND is_active = TRUE
        ORDER BY created_at DESC
      `).all(req.user.id);

      res.json({
        success: true,
        data: keys.map(k => ({
          id: k.id,
          name: k.key_name,
          prefix: k.key_prefix,
          scopes: JSON.parse(k.scopes),
          rateLimit: k.rate_limit_per_hour,
          isActive: k.is_active,
          expiresAt: k.expires_at,
          lastUsedAt: k.last_used_at,
          createdAt: k.created_at
        }))
      });

    } catch (error) {
      console.error('[API KEYS] List error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to list API keys'
      });
    }
  }
);

/**
 * POST /api-keys
 * Create a new API key
 */
router.post('/',
  requireAuth,
  requirePermission('api_keys.create'),
  async (req, res) => {
    try {
      const { name, scopes = ['read'], rateLimit = 1000, expiresInDays = null } = req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          error: 'API key name is required'
        });
      }

      // Generate key
      const apiKey = generateAPIKey();
      const keyPrefix = apiKey.substring(0, 16);  // First 16 chars for identification
      const keyHash = await bcrypt.hash(apiKey, 10);

      // Calculate expiration
      let expiresAt = null;
      if (expiresInDays) {
        const expires = new Date();
        expires.setDate(expires.getDate() + expiresInDays);
        expiresAt = expires.toISOString();
      }

      // Store in database
      const database = db.getDatabase();
      const result = database.prepare(`
        INSERT INTO api_keys (
          user_id, account_name, key_name, key_prefix, key_hash,
          scopes, rate_limit_per_hour, expires_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.user.id,
        req.user.accountName,
        name,
        keyPrefix,
        keyHash,
        JSON.stringify(scopes),
        rateLimit,
        expiresAt,
        req.user.id
      );

      await authService.logAudit({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'api_key_created',
        resourceType: 'api_key',
        resourceId: result.lastInsertRowid,
        description: `Created API key: ${name}`,
        ipAddress: req.ip,
        success: true
      });

      res.status(201).json({
        success: true,
        data: {
          id: result.lastInsertRowid,
          name,
          apiKey,  // Only shown once at creation!
          prefix: keyPrefix,
          scopes,
          rateLimit,
          expiresAt,
          message: 'IMPORTANT: Save this API key now. You will not be able to see it again!'
        }
      });

    } catch (error) {
      console.error('[API KEYS] Create error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to create API key'
      });
    }
  }
);

/**
 * PUT /api-keys/:keyId
 * Update API key (name, scopes, rate limit only - not the key itself)
 */
router.put('/:keyId',
  requireAuth,
  requirePermission('api_keys.create'),
  async (req, res) => {
    try {
      const { keyId } = req.params;
      const { name, scopes, rateLimit } = req.body;

      const database = db.getDatabase();

      // Verify ownership
      const key = database.prepare('SELECT user_id FROM api_keys WHERE id = ?').get(keyId);
      if (!key) {
        return res.status(404).json({
          success: false,
          error: 'API key not found'
        });
      }

      if (key.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to update this API key'
        });
      }

      const updates = [];
      const values = [];

      if (name) {
        updates.push('key_name = ?');
        values.push(name);
      }

      if (scopes) {
        updates.push('scopes = ?');
        values.push(JSON.stringify(scopes));
      }

      if (rateLimit) {
        updates.push('rate_limit_per_hour = ?');
        values.push(rateLimit);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No fields to update'
        });
      }

      values.push(keyId);

      database.prepare(`
        UPDATE api_keys
        SET ${updates.join(', ')}
        WHERE id = ?
      `).run(...values);

      res.json({
        success: true,
        message: 'API key updated successfully'
      });

    } catch (error) {
      console.error('[API KEYS] Update error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to update API key'
      });
    }
  }
);

/**
 * DELETE /api-keys/:keyId
 * Revoke an API key
 */
router.delete('/:keyId',
  requireAuth,
  requirePermission('api_keys.revoke'),
  async (req, res) => {
    try {
      const { keyId } = req.params;

      const database = db.getDatabase();

      // Verify ownership
      const key = database.prepare('SELECT user_id, key_name FROM api_keys WHERE id = ?').get(keyId);
      if (!key) {
        return res.status(404).json({
          success: false,
          error: 'API key not found'
        });
      }

      if (key.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to revoke this API key'
        });
      }

      // Soft delete (keep for audit trail)
      database.prepare(`
        UPDATE api_keys
        SET is_active = FALSE,
            revoked_at = CURRENT_TIMESTAMP,
            revoked_by = ?,
            revoked_reason = 'user_requested'
        WHERE id = ?
      `).run(req.user.id, keyId);

      await authService.logAudit({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'api_key_revoked',
        resourceType: 'api_key',
        resourceId: keyId,
        description: `Revoked API key: ${key.key_name}`,
        ipAddress: req.ip,
        success: true
      });

      res.json({
        success: true,
        message: 'API key revoked successfully'
      });

    } catch (error) {
      console.error('[API KEYS] Revoke error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to revoke API key'
      });
    }
  }
);

/**
 * Middleware to authenticate API key instead of JWT
 * Usage: router.get('/endpoint', authenticateAPIKey, (req, res) => {...})
 */
async function authenticateAPIKey(req, res, next) {
  try {
    // Get API key from header
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API key required',
        code: 'NO_API_KEY'
      });
    }

    if (!apiKey.startsWith('sk_live_')) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key format',
        code: 'INVALID_FORMAT'
      });
    }

    const keyPrefix = apiKey.substring(0, 16);

    // Find key by prefix
    const database = db.getDatabase();
    const keyRecord = database.prepare(`
      SELECT k.*, u.email, u.role, u.account_name, u.is_active as user_active
      FROM api_keys k
      JOIN users u ON u.id = k.user_id
      WHERE k.key_prefix = ? AND k.is_active = TRUE
    `).get(keyPrefix);

    if (!keyRecord) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key',
        code: 'INVALID_KEY'
      });
    }

    // Verify full key hash
    const validKey = await bcrypt.compare(apiKey, keyRecord.key_hash);
    if (!validKey) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key',
        code: 'INVALID_KEY'
      });
    }

    // Check if user account is active
    if (!keyRecord.user_active) {
      return res.status(401).json({
        success: false,
        error: 'User account is disabled',
        code: 'USER_DISABLED'
      });
    }

    // Check expiration
    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      return res.status(401).json({
        success: false,
        error: 'API key expired',
        code: 'KEY_EXPIRED'
      });
    }

    // Check rate limit
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    if (keyRecord.last_request_at && new Date(keyRecord.last_request_at) > oneHourAgo) {
      if (keyRecord.requests_count >= keyRecord.rate_limit_per_hour) {
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          limit: keyRecord.rate_limit_per_hour,
          resetAt: new Date(new Date(keyRecord.last_request_at).getTime() + 60 * 60 * 1000).toISOString()
        });
      }
    }

    // Update usage stats
    const isNewHour = !keyRecord.last_request_at || new Date(keyRecord.last_request_at) <= oneHourAgo;

    database.prepare(`
      UPDATE api_keys
      SET last_used_at = CURRENT_TIMESTAMP,
          last_used_ip = ?,
          requests_count = ${isNewHour ? 1 : 'requests_count + 1'},
          last_request_at = ${isNewHour ? 'CURRENT_TIMESTAMP' : 'last_request_at'}
      WHERE id = ?
    `).run(req.ip || req.connection.remoteAddress, keyRecord.id);

    // Attach user info to request (like JWT auth)
    req.user = {
      id: keyRecord.user_id,
      email: keyRecord.email,
      role: keyRecord.role,
      accountName: keyRecord.account_name
    };

    req.apiKey = {
      id: keyRecord.id,
      name: keyRecord.key_name,
      scopes: JSON.parse(keyRecord.scopes)
    };

    next();

  } catch (error) {
    console.error('[API KEY AUTH] Error:', error);

    res.status(500).json({
      success: false,
      error: 'API key authentication failed',
      code: 'AUTH_ERROR'
    });
  }
}

module.exports = router;
module.exports.authenticateAPIKey = authenticateAPIKey;
