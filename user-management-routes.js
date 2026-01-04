// =====================================================
// USER MANAGEMENT API ROUTES
// =====================================================
// Complete user CRUD operations with role-based access
// Only admins can manage users
// =====================================================

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('./database');
const config = require('./config');
const { requireAuth, requireRole } = require('./auth-middleware');

// Generate random secure password
function generatePassword() {
  const length = 12;
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';

  // Ensure at least one of each type
  password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)];
  password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];
  password += '0123456789'[Math.floor(Math.random() * 10)];
  password += '!@#$%^&*'[Math.floor(Math.random() * 8)];

  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)];
  }

  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

// ===== GET ALL USERS =====
// Admin only - view all users with filtering and pagination
router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const database = db.getDatabase();
    const { role, active, search, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT
        id, email, name, role, account_name, team_id,
        is_active, is_email_verified, failed_login_attempts,
        last_login_at, created_at, updated_at
      FROM users
      WHERE 1=1
    `;
    const params = [];

    // Filter by role
    if (role) {
      query += ' AND role = ?';
      params.push(role);
    }

    // Filter by active status
    if (active !== undefined) {
      query += ' AND is_active = ?';
      params.push(active === 'true' ? 1 : 0);
    }

    // Search by name or email
    if (search) {
      query += ' AND (name LIKE ? OR email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const users = database.prepare(query).all(...params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM users WHERE 1=1';
    const countParams = [];
    if (role) {
      countQuery += ' AND role = ?';
      countParams.push(role);
    }
    if (active !== undefined) {
      countQuery += ' AND is_active = ?';
      countParams.push(active === 'true' ? 1 : 0);
    }
    if (search) {
      countQuery += ' AND (name LIKE ? OR email LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`);
    }

    const { total } = database.prepare(countQuery).get(...countParams);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: (parseInt(offset) + users.length) < total
        }
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

// ===== GET USER BY ID =====
router.get('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const database = db.getDatabase();
    const { id } = req.params;

    const user = database.prepare(`
      SELECT
        id, email, name, role, account_name, team_id,
        is_active, is_email_verified, failed_login_attempts,
        locked_until, last_login_at, last_login_ip,
        created_at, updated_at, last_active
      FROM users
      WHERE id = ?
    `).get(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: { user }
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user'
    });
  }
});

// ===== CREATE USER =====
// Admin creates new user with auto-generated password
router.post('/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const database = db.getDatabase();
    const { email, name, role, account_name, team_id, send_email } = req.body;

    // Validate required fields
    if (!email || !name || !role) {
      return res.status(400).json({
        success: false,
        error: 'Email, name, and role are required'
      });
    }

    // Validate role
    const validRoles = ['admin', 'manager', 'rep', 'viewer', 'customer_admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: `Invalid role. Must be one of: ${validRoles.join(', ')}`
      });
    }

    // Check if email already exists
    const existing = database.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'Email already exists'
      });
    }

    // Generate secure password
    const tempPassword = generatePassword();
    const passwordHash = await bcrypt.hash(tempPassword, config.bcryptRounds);

    // Create user
    const result = database.prepare(`
      INSERT INTO users (
        email, name, password_hash, role, account_name, team_id,
        is_active, is_email_verified, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, datetime('now'), datetime('now'))
    `).run(
      email.toLowerCase().trim(),
      name.trim(),
      passwordHash,
      role,
      account_name || null,
      team_id || null
    );

    // Audit log
    database.prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, created_at)
      VALUES (?, 'create_user', 'user', ?, ?, datetime('now'))
    `).run(
      req.user.id,
      result.lastInsertRowid,
      JSON.stringify({ created_user: email, role })
    );

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: result.lastInsertRowid,
          email,
          name,
          role,
          account_name,
          team_id
        },
        temporary_password: tempPassword,
        message: 'User created successfully. Share the temporary password securely.'
      }
    });

  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create user'
    });
  }
});

// ===== UPDATE USER =====
router.put('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const database = db.getDatabase();
    const { id } = req.params;
    const { name, role, account_name, team_id, is_active } = req.body;

    // Check if user exists
    const user = database.prepare('SELECT id, email FROM users WHERE id = ?').get(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Build update query
    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name.trim());
    }

    if (role !== undefined) {
      const validRoles = ['admin', 'manager', 'rep', 'viewer', 'customer_admin'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          error: `Invalid role. Must be one of: ${validRoles.join(', ')}`
        });
      }
      updates.push('role = ?');
      params.push(role);
    }

    if (account_name !== undefined) {
      updates.push('account_name = ?');
      params.push(account_name || null);
    }

    if (team_id !== undefined) {
      updates.push('team_id = ?');
      params.push(team_id || null);
    }

    if (is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    updates.push('updated_at = datetime(\'now\')');
    params.push(id);

    database.prepare(`
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...params);

    // Audit log
    database.prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, created_at)
      VALUES (?, 'update_user', 'user', ?, ?, datetime('now'))
    `).run(
      req.user.id,
      id,
      JSON.stringify({ updated_fields: Object.keys(req.body) })
    );

    res.json({
      success: true,
      message: 'User updated successfully'
    });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user'
    });
  }
});

// ===== DELETE USER =====
router.delete('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const database = db.getDatabase();
    const { id } = req.params;

    // Prevent deleting yourself
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete your own account'
      });
    }

    // Check if user exists
    const user = database.prepare('SELECT id, email FROM users WHERE id = ?').get(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Delete user (cascades will handle related records)
    database.prepare('DELETE FROM users WHERE id = ?').run(id);

    // Audit log
    database.prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, created_at)
      VALUES (?, 'delete_user', 'user', ?, ?, datetime('now'))
    `).run(
      req.user.id,
      id,
      JSON.stringify({ deleted_user: user.email })
    );

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user'
    });
  }
});

// ===== RESET USER PASSWORD =====
router.post('/users/:id/reset-password', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const database = db.getDatabase();
    const { id } = req.params;

    // Check if user exists
    const user = database.prepare('SELECT id, email, name FROM users WHERE id = ?').get(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Generate new password
    const newPassword = generatePassword();
    const passwordHash = await bcrypt.hash(newPassword, config.bcryptRounds);

    // Update password and unlock account
    database.prepare(`
      UPDATE users
      SET password_hash = ?,
          failed_login_attempts = 0,
          locked_until = NULL,
          password_changed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(passwordHash, id);

    // Audit log
    database.prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, created_at)
      VALUES (?, 'reset_password', 'user', ?, ?, datetime('now'))
    `).run(
      req.user.id,
      id,
      JSON.stringify({ reset_for: user.email })
    );

    res.json({
      success: true,
      data: {
        temporary_password: newPassword,
        message: `Password reset for ${user.name}. Share the temporary password securely.`
      }
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset password'
    });
  }
});

// ===== GET USER STATS =====
router.get('/users/stats/overview', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const database = db.getDatabase();

    const stats = {
      total: database.prepare('SELECT COUNT(*) as count FROM users').get().count,
      active: database.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1').get().count,
      inactive: database.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 0').get().count,
      by_role: {},
      recent_logins: database.prepare(`
        SELECT email, name, last_login_at
        FROM users
        WHERE last_login_at IS NOT NULL
        ORDER BY last_login_at DESC
        LIMIT 5
      `).all()
    };

    // Count by role
    const roles = database.prepare(`
      SELECT role, COUNT(*) as count
      FROM users
      GROUP BY role
    `).all();

    roles.forEach(r => {
      stats.by_role[r.role] = r.count;
    });

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics'
    });
  }
});

module.exports = router;
