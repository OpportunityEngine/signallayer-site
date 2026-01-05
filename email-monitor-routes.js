// =====================================================
// EMAIL MONITOR API ROUTES
// =====================================================
// Complete email monitoring API:
// - CRUD operations for email monitors
// - IMAP connection testing
// - Auto-detection of email settings
// - Processing activity logs
// - Monitor control (start/stop)
// =====================================================

const express = require('express');
const router = express.Router();
const db = require('./database');
const { requireAuth, requireRole, sanitizeInput } = require('./auth-middleware');
const emailService = require('./email-imap-service');
const { detectIMAPConfig, testIMAPConnection } = require('./imap-config-detector');

// Apply authentication and sanitization to all routes
router.use(requireAuth);
router.use(sanitizeInput);

// =====================================================
// EMAIL MONITOR CRUD OPERATIONS
// =====================================================

/**
 * GET /api/email-monitors
 * Get all email monitors for current user
 * Admins can see all monitors
 */
router.get('/', async (req, res) => {
  try {
    const user = req.user;
    let monitors;

    if (user.role === 'admin') {
      // Admin sees all monitors
      monitors = db.prepare(`
        SELECT
          em.*,
          u.name as user_name,
          u.email as user_email
        FROM email_monitors em
        LEFT JOIN users u ON em.user_id = u.id
        ORDER BY em.created_at DESC
      `).all();
    } else {
      // Non-admins see only their own monitors
      monitors = db.prepare(`
        SELECT * FROM email_monitors
        WHERE user_id = ?
        ORDER BY created_at DESC
      `).all(user.id);
    }

    // Don't expose encrypted passwords in list view
    monitors = monitors.map(m => ({
      ...m,
      imap_password_encrypted: undefined,
      has_password: !!m.imap_password_encrypted
    }));

    res.json({
      success: true,
      data: monitors
    });

  } catch (error) {
    console.error('[EMAIL-MONITORS] List error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve email monitors'
    });
  }
});

/**
 * GET /api/email-monitors/:id
 * Get specific email monitor by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const monitor = db.getEmailMonitor(id);

    if (!monitor) {
      return res.status(404).json({
        success: false,
        error: 'Email monitor not found'
      });
    }

    // Check ownership (admins can see all)
    if (user.role !== 'admin' && monitor.user_id !== user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Don't expose encrypted password
    const safeMonitor = {
      ...monitor,
      imap_password_encrypted: undefined,
      has_password: !!monitor.imap_password_encrypted
    };

    res.json({
      success: true,
      data: safeMonitor
    });

  } catch (error) {
    console.error('[EMAIL-MONITORS] Get error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve email monitor'
    });
  }
});

/**
 * POST /api/email-monitors
 * Create new email monitor
 */
router.post('/', async (req, res) => {
  try {
    const user = req.user;
    const {
      name,
      email_address,
      imap_host,
      imap_port,
      imap_secure,
      imap_user,
      imap_password,
      folder_name,
      check_frequency_minutes,
      search_criteria
    } = req.body;

    // Validation
    if (!name || !email_address || !imap_host || !imap_user || !imap_password) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, email_address, imap_host, imap_user, imap_password'
      });
    }

    // Encrypt password
    const encryptedPassword = emailService.encryptPassword(imap_password);

    // Insert monitor
    const result = db.prepare(`
      INSERT INTO email_monitors (
        user_id,
        name,
        email_address,
        provider,
        imap_host,
        imap_port,
        imap_secure,
        imap_user,
        imap_password_encrypted,
        folder_name,
        check_frequency_minutes,
        search_criteria,
        is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      name,
      email_address,
      'imap',
      imap_host,
      imap_port || 993,
      imap_secure !== false ? 1 : 0,
      imap_user,
      encryptedPassword,
      folder_name || 'INBOX',
      check_frequency_minutes || 15,
      search_criteria ? JSON.stringify(search_criteria) : null,
      1  // Active by default
    );

    const monitorId = result.lastInsertRowid;

    // Start monitoring
    try {
      emailService.startMonitor(monitorId);
      console.log(`[EMAIL-MONITORS] Started monitoring for monitor ID: ${monitorId}`);
    } catch (startError) {
      console.error('[EMAIL-MONITORS] Failed to start monitoring:', startError);
      // Don't fail the creation - monitor can be started later
    }

    // Get created monitor
    const createdMonitor = db.getEmailMonitor(monitorId);

    res.status(201).json({
      success: true,
      data: {
        ...createdMonitor,
        imap_password_encrypted: undefined,
        has_password: true
      },
      message: 'Email monitor created successfully'
    });

  } catch (error) {
    console.error('[EMAIL-MONITORS] Create error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create email monitor'
    });
  }
});

/**
 * PUT /api/email-monitors/:id
 * Update existing email monitor
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    const {
      name,
      email_address,
      imap_host,
      imap_port,
      imap_secure,
      imap_user,
      imap_password,
      folder_name,
      check_frequency_minutes,
      search_criteria,
      is_active
    } = req.body;

    // Get existing monitor
    const existingMonitor = db.getEmailMonitor(id);

    if (!existingMonitor) {
      return res.status(404).json({
        success: false,
        error: 'Email monitor not found'
      });
    }

    // Check ownership (admins can update all)
    if (user.role !== 'admin' && existingMonitor.user_id !== user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (email_address !== undefined) {
      updates.push('email_address = ?');
      values.push(email_address);
    }
    if (imap_host !== undefined) {
      updates.push('imap_host = ?');
      values.push(imap_host);
    }
    if (imap_port !== undefined) {
      updates.push('imap_port = ?');
      values.push(imap_port);
    }
    if (imap_secure !== undefined) {
      updates.push('imap_secure = ?');
      values.push(imap_secure ? 1 : 0);
    }
    if (imap_user !== undefined) {
      updates.push('imap_user = ?');
      values.push(imap_user);
    }
    if (imap_password) {
      updates.push('imap_password_encrypted = ?');
      values.push(emailService.encryptPassword(imap_password));
    }
    if (folder_name !== undefined) {
      updates.push('folder_name = ?');
      values.push(folder_name);
    }
    if (check_frequency_minutes !== undefined) {
      updates.push('check_frequency_minutes = ?');
      values.push(check_frequency_minutes);
    }
    if (search_criteria !== undefined) {
      updates.push('search_criteria = ?');
      values.push(search_criteria ? JSON.stringify(search_criteria) : null);
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(is_active ? 1 : 0);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    if (updates.length === 1) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    // Perform update
    values.push(id);
    db.prepare(`
      UPDATE email_monitors
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...values);

    // Restart monitor if active
    const wasActive = emailService.isMonitorActive(id);
    if (wasActive) {
      emailService.stopMonitor(id);
    }

    const updatedMonitor = db.getEmailMonitor(id);

    if (updatedMonitor.is_active) {
      try {
        emailService.startMonitor(id);
      } catch (startError) {
        console.error('[EMAIL-MONITORS] Failed to restart monitor:', startError);
      }
    }

    res.json({
      success: true,
      data: {
        ...updatedMonitor,
        imap_password_encrypted: undefined,
        has_password: !!updatedMonitor.imap_password_encrypted
      },
      message: 'Email monitor updated successfully'
    });

  } catch (error) {
    console.error('[EMAIL-MONITORS] Update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update email monitor'
    });
  }
});

/**
 * DELETE /api/email-monitors/:id
 * Delete email monitor
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const monitor = db.getEmailMonitor(id);

    if (!monitor) {
      return res.status(404).json({
        success: false,
        error: 'Email monitor not found'
      });
    }

    // Check ownership (admins can delete all)
    if (user.role !== 'admin' && monitor.user_id !== user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Stop monitor if running
    emailService.stopMonitor(id);

    // Delete monitor (cascade will delete processing logs)
    db.prepare('DELETE FROM email_monitors WHERE id = ?').run(id);

    res.json({
      success: true,
      message: 'Email monitor deleted successfully'
    });

  } catch (error) {
    console.error('[EMAIL-MONITORS] Delete error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete email monitor'
    });
  }
});

// =====================================================
// MONITOR CONTROL OPERATIONS
// =====================================================

/**
 * POST /api/email-monitors/:id/start
 * Start monitoring for specific monitor
 */
router.post('/:id/start', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const monitor = db.getEmailMonitor(id);

    if (!monitor) {
      return res.status(404).json({
        success: false,
        error: 'Email monitor not found'
      });
    }

    // Check ownership
    if (user.role !== 'admin' && monitor.user_id !== user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Enable and start
    db.prepare('UPDATE email_monitors SET is_active = 1 WHERE id = ?').run(id);
    emailService.startMonitor(id);

    res.json({
      success: true,
      message: 'Email monitor started successfully'
    });

  } catch (error) {
    console.error('[EMAIL-MONITORS] Start error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start email monitor'
    });
  }
});

/**
 * POST /api/email-monitors/:id/stop
 * Stop monitoring for specific monitor
 */
router.post('/:id/stop', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const monitor = db.getEmailMonitor(id);

    if (!monitor) {
      return res.status(404).json({
        success: false,
        error: 'Email monitor not found'
      });
    }

    // Check ownership
    if (user.role !== 'admin' && monitor.user_id !== user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Stop and disable
    emailService.stopMonitor(id);
    db.prepare('UPDATE email_monitors SET is_active = 0 WHERE id = ?').run(id);

    res.json({
      success: true,
      message: 'Email monitor stopped successfully'
    });

  } catch (error) {
    console.error('[EMAIL-MONITORS] Stop error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop email monitor'
    });
  }
});

/**
 * POST /api/email-monitors/:id/check-now
 * Trigger immediate email check (don't wait for next interval)
 */
router.post('/:id/check-now', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const monitor = db.getEmailMonitor(id);

    if (!monitor) {
      return res.status(404).json({
        success: false,
        error: 'Email monitor not found'
      });
    }

    // Check ownership
    if (user.role !== 'admin' && monitor.user_id !== user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Trigger immediate check (don't await - let it run in background)
    emailService.checkEmails(id).catch(err => {
      console.error('[EMAIL-MONITORS] Check now error:', err);
    });

    res.json({
      success: true,
      message: 'Email check triggered. Processing in background...'
    });

  } catch (error) {
    console.error('[EMAIL-MONITORS] Check now error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger email check'
    });
  }
});

// =====================================================
// ACTIVITY & STATS
// =====================================================

/**
 * GET /api/email-monitors/:id/activity
 * Get processing activity log for monitor
 */
router.get('/:id/activity', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    const { limit = 50, offset = 0, status } = req.query;

    const monitor = db.getEmailMonitor(id);

    if (!monitor) {
      return res.status(404).json({
        success: false,
        error: 'Email monitor not found'
      });
    }

    // Check ownership
    if (user.role !== 'admin' && monitor.user_id !== user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Build query
    let query = `
      SELECT * FROM email_processing_log
      WHERE monitor_id = ?
    `;
    const params = [id];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY processed_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const activity = db.prepare(query).all(...params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM email_processing_log WHERE monitor_id = ?';
    const countParams = [id];
    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }
    const { total } = db.prepare(countQuery).get(...countParams);

    res.json({
      success: true,
      data: {
        activity,
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: (parseInt(offset) + activity.length) < total
        }
      }
    });

  } catch (error) {
    console.error('[EMAIL-MONITORS] Activity error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve activity log'
    });
  }
});

/**
 * GET /api/email-monitors/:id/stats
 * Get statistics for specific monitor
 */
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const monitor = db.getEmailMonitor(id);

    if (!monitor) {
      return res.status(404).json({
        success: false,
        error: 'Email monitor not found'
      });
    }

    // Check ownership
    if (user.role !== 'admin' && monitor.user_id !== user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Get processing stats
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_emails,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped,
        SUM(invoices_created) as total_invoices,
        AVG(processing_time_ms) as avg_processing_time_ms,
        MAX(processed_at) as last_processed
      FROM email_processing_log
      WHERE monitor_id = ?
    `).get(id);

    res.json({
      success: true,
      data: {
        monitor: {
          id: monitor.id,
          name: monitor.name,
          email_address: monitor.email_address,
          is_active: monitor.is_active,
          last_checked_at: monitor.last_checked_at,
          last_success_at: monitor.last_success_at,
          last_error: monitor.last_error
        },
        stats: {
          total_emails: stats.total_emails || 0,
          successful: stats.successful || 0,
          errors: stats.errors || 0,
          skipped: stats.skipped || 0,
          total_invoices: stats.total_invoices || 0,
          avg_processing_time_ms: Math.round(stats.avg_processing_time_ms || 0),
          last_processed: stats.last_processed
        }
      }
    });

  } catch (error) {
    console.error('[EMAIL-MONITORS] Stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve monitor stats'
    });
  }
});

// =====================================================
// IMAP UTILITIES
// =====================================================

/**
 * POST /api/email-monitors/detect-settings
 * Auto-detect IMAP settings from email address
 */
router.post('/detect-settings', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email address is required'
      });
    }

    const config = detectIMAPConfig(email);

    res.json({
      success: true,
      data: config
    });

  } catch (error) {
    console.error('[EMAIL-MONITORS] Detect settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to detect IMAP settings'
    });
  }
});

/**
 * POST /api/email-monitors/test-connection
 * Test IMAP connection with provided credentials
 */
router.post('/test-connection', async (req, res) => {
  try {
    const { email, password, host, port, secure } = req.body;

    if (!email || !password || !host) {
      return res.status(400).json({
        success: false,
        error: 'Email, password, and host are required'
      });
    }

    const testResult = await testIMAPConnection({
      user: email,
      password: password,
      host: host,
      port: port || 993,
      secure: secure !== false
    });

    res.json({
      success: testResult.success,
      data: testResult
    });

  } catch (error) {
    console.error('[EMAIL-MONITORS] Test connection error:', error);
    res.status(500).json({
      success: false,
      error: 'Connection test failed',
      details: error.message
    });
  }
});

// =====================================================
// SYSTEM STATUS (Admin only)
// =====================================================

/**
 * GET /api/email-monitors/system/status
 * Get overall email monitoring system status
 */
router.get('/system/status', requireRole(['admin']), async (req, res) => {
  try {
    const status = emailService.getStatus();

    // Get all monitors summary
    const monitorsSummary = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive,
        SUM(emails_processed_count) as total_emails_processed,
        SUM(invoices_created_count) as total_invoices_created
      FROM email_monitors
    `).get();

    res.json({
      success: true,
      data: {
        system: status,
        monitors: monitorsSummary
      }
    });

  } catch (error) {
    console.error('[EMAIL-MONITORS] System status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve system status'
    });
  }
});

module.exports = router;
