// =====================================================
// ADMIN ANALYTICS API ROUTES
// =====================================================
// Real-time analytics for admin dashboard:
// - User activity and engagement metrics
// - System health and performance
// - Financial metrics and revenue tracking
// - Top customers and usage patterns
// - Error monitoring and alerts
// =====================================================

const express = require('express');
const router = express.Router();
const database = require('./database');
const db = database.getDatabase();
const { requireAuth, requireRole } = require('./auth-middleware');

// All routes require admin or demo_viewer role
router.use(requireAuth);
router.use(requireRole('admin', 'demo_viewer'));

// =====================================================
// USAGE ANALYTICS
// =====================================================

/**
 * GET /api/admin/usage-analytics
 * Get comprehensive usage statistics
 */
router.get('/usage-analytics', (req, res) => {
  try {
    // User statistics (with fallback)
    let userStats = { total_users: 0, total_reps: 0, total_managers: 0, total_admins: 0 };
    try {
      userStats = db.prepare(`
        SELECT
          COUNT(*) as total_users,
          SUM(CASE WHEN role = 'rep' THEN 1 ELSE 0 END) as total_reps,
          SUM(CASE WHEN role = 'manager' OR role = 'customer_admin' THEN 1 ELSE 0 END) as total_managers,
          SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as total_admins
        FROM users
        WHERE is_active = 1 OR is_active IS NULL
      `).get() || userStats;
    } catch (e) {
      console.log('[ADMIN] User stats query failed:', e.message);
    }

    // Active users (based on last_login_at or last_active)
    const now = new Date();
    const day24Ago = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const days7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const days30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    let activeUsers24h = 0, activeUsers7d = 0, activeUsers30d = 0;
    try {
      // Try last_login_at first, fallback to last_active
      const result24h = db.prepare('SELECT COUNT(*) as count FROM users WHERE last_login_at >= ? OR last_active >= ?').get(day24Ago, day24Ago);
      const result7d = db.prepare('SELECT COUNT(*) as count FROM users WHERE last_login_at >= ? OR last_active >= ?').get(days7Ago, days7Ago);
      const result30d = db.prepare('SELECT COUNT(*) as count FROM users WHERE last_login_at >= ? OR last_active >= ?').get(days30Ago, days30Ago);
      activeUsers24h = result24h?.count || 0;
      activeUsers7d = result7d?.count || 0;
      activeUsers30d = result30d?.count || 0;
    } catch (e) {
      console.log('[ADMIN] Active users query failed:', e.message);
    }

    // Invoice statistics (with fallback if table doesn't exist)
    let invoiceStats = { total_invoices: 0, invoices_this_month: 0, invoices_today: 0 };
    try {
      invoiceStats = db.prepare(`
        SELECT
          COUNT(*) as total_invoices,
          SUM(CASE WHEN created_at >= date('now', 'start of month') THEN 1 ELSE 0 END) as invoices_this_month,
          SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) as invoices_today
        FROM invoices
      `).get() || invoiceStats;
    } catch (e) {
      console.log('[ADMIN] Invoices table not found or query failed:', e.message);
    }

    // Opportunity statistics (with fallback)
    let oppStats = { total_opportunities: 0, opps_from_email: 0, opps_from_rules: 0 };
    try {
      oppStats = db.prepare(`
        SELECT
          COUNT(*) as total_opportunities,
          SUM(CASE WHEN source = 'email_monitor' THEN 1 ELSE 0 END) as opps_from_email,
          SUM(CASE WHEN source = 'sku_rule' THEN 1 ELSE 0 END) as opps_from_rules
        FROM opportunities
      `).get() || oppStats;
    } catch (e) {
      console.log('[ADMIN] Opportunities query failed:', e.message);
    }

    // Telemetry event statistics
    let telemetryStats = { total_events: 0, events_24h: 0, unique_users_24h: 0 };
    try {
      const telemetryTotal = db.prepare('SELECT COUNT(*) as count FROM telemetry_events').get();
      const telemetry24h = db.prepare(`
        SELECT
          COUNT(*) as events,
          COUNT(DISTINCT user_id) as unique_users
        FROM telemetry_events
        WHERE created_at >= ?
      `).get(day24Ago);

      telemetryStats = {
        total_events: telemetryTotal?.count || 0,
        events_24h: telemetry24h?.events || 0,
        unique_users_24h: telemetry24h?.unique_users || 0
      };
    } catch (e) {
      // Telemetry table may not exist
      console.log('[ADMIN] Telemetry table not found:', e.message);
    }

    res.json({
      success: true,
      data: {
        totalUsers: userStats.total_users || 0,
        totalReps: userStats.total_reps || 0,
        totalManagers: userStats.total_managers || 0,
        totalAdmins: userStats.total_admins || 0,
        activeUsers24h: activeUsers24h,
        activeUsers7d: activeUsers7d,
        activeUsers30d: activeUsers30d,
        totalInvoices: invoiceStats.total_invoices || 0,
        invoicesThisMonth: invoiceStats.invoices_this_month || 0,
        invoicesToday: invoiceStats.invoices_today || 0,
        totalOpportunities: oppStats.total_opportunities || 0,
        oppsFromEmail: oppStats.opps_from_email || 0,
        oppsFromRules: oppStats.opps_from_rules || 0,
        totalEvents: telemetryStats.total_events,
        events24h: telemetryStats.events_24h,
        uniqueUsers24h: telemetryStats.unique_users_24h
      }
    });

  } catch (error) {
    console.error('[ADMIN-ANALYTICS] Usage analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load usage analytics'
    });
  }
});

// =====================================================
// FINANCIAL METRICS
// =====================================================

/**
 * GET /api/admin/financial-metrics
 * Get financial performance metrics
 */
router.get('/financial-metrics', (req, res) => {
  try {
    // Total savings detected
    const savingsStats = db.prepare(`
      SELECT
        SUM(potential_savings_cents) as total_savings_cents,
        AVG(potential_savings_cents) as avg_savings_cents,
        COUNT(*) as total_opportunities
      FROM opportunities
      WHERE status != 'rejected'
    `).get();

    // Commission/revenue tracking
    const revenueStats = db.prepare(`
      SELECT
        SUM(commission_cents) as total_revenue_cents,
        AVG(commission_cents) as avg_commission_cents,
        COUNT(DISTINCT invoice_id) as total_deals
      FROM commissions
    `).get();

    // Calculate avg deal size and customer value
    const avgDealSize = revenueStats.total_deals > 0
      ? Math.round(revenueStats.total_revenue_cents / revenueStats.total_deals)
      : 0;

    // Customer lifetime value (avg per account)
    const customerCount = db.prepare('SELECT COUNT(DISTINCT account_name) as count FROM users WHERE is_active = 1').get().count;
    const avgCustomerValue = customerCount > 0
      ? Math.round(revenueStats.total_revenue_cents / customerCount)
      : 0;

    res.json({
      success: true,
      data: {
        totalSavingsCents: savingsStats.total_savings_cents || 0,
        avgSavingsCents: Math.round(savingsStats.avg_savings_cents || 0),
        totalRevenueCents: revenueStats.total_revenue_cents || 0,
        avgDealSizeCents: avgDealSize,
        avgCustomerValueCents: avgCustomerValue,
        totalOpportunities: savingsStats.total_opportunities || 0,
        totalDeals: revenueStats.total_deals || 0
      }
    });

  } catch (error) {
    console.error('[ADMIN-ANALYTICS] Financial metrics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load financial metrics'
    });
  }
});

// =====================================================
// TOP CUSTOMERS
// =====================================================

/**
 * GET /api/admin/top-customers
 * Get top customers by activity and value
 */
router.get('/top-customers', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const topCustomers = db.prepare(`
      SELECT
        u.account_name,
        COUNT(DISTINCT i.id) as invoices_processed,
        COUNT(DISTINCT o.id) as opportunities_created,
        SUM(o.potential_savings_cents) as savings_cents,
        MAX(u.last_login_at) as last_activity,
        COUNT(DISTINCT u.id) as user_count
      FROM users u
      LEFT JOIN invoices i ON i.user_id = u.id
      LEFT JOIN opportunities o ON o.created_by_user_id = u.id
      WHERE u.is_active = 1 AND u.account_name IS NOT NULL
      GROUP BY u.account_name
      HAVING invoices_processed > 0 OR opportunities_created > 0
      ORDER BY savings_cents DESC, invoices_processed DESC
      LIMIT ?
    `).all(limit);

    res.json({
      success: true,
      data: topCustomers
    });

  } catch (error) {
    console.error('[ADMIN-ANALYTICS] Top customers error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load top customers'
    });
  }
});

// =====================================================
// SYSTEM ALERTS
// =====================================================

/**
 * GET /api/admin/system-alerts
 * Get critical system alerts and warnings
 */
router.get('/system-alerts', (req, res) => {
  try {
    const alerts = [];

    // Check for failed email monitors
    const failedMonitors = db.prepare(`
      SELECT COUNT(*) as count
      FROM email_monitors
      WHERE is_active = 1 AND last_error IS NOT NULL
        AND datetime(last_checked_at) > datetime('now', '-1 hour')
    `).get().count;

    if (failedMonitors > 0) {
      alerts.push({
        severity: 'warning',
        title: 'Email Monitor Errors',
        message: `${failedMonitors} email monitor(s) experiencing errors`
      });
    }

    // Check for inactive users with pending opportunities
    const inactiveWithOpps = db.prepare(`
      SELECT COUNT(DISTINCT u.id) as count
      FROM users u
      INNER JOIN opportunities o ON o.assigned_to_user_id = u.id
      WHERE u.last_login_at < datetime('now', '-7 days')
        AND o.status = 'pending'
    `).get().count;

    if (inactiveWithOpps > 0) {
      alerts.push({
        severity: 'info',
        title: 'Inactive Users with Pending Opportunities',
        message: `${inactiveWithOpps} user(s) haven't logged in for 7+ days but have pending opportunities`
      });
    }

    // Check for low activity (no invoices in 48 hours)
    const recentInvoices = db.prepare(`
      SELECT COUNT(*) as count
      FROM invoices
      WHERE created_at >= datetime('now', '-48 hours')
    `).get().count;

    if (recentInvoices === 0) {
      alerts.push({
        severity: 'warning',
        title: 'Low System Activity',
        message: 'No invoices processed in the last 48 hours'
      });
    }

    // Check for high error rate in recent telemetry
    try {
      const errorEvents = db.prepare(`
        SELECT COUNT(*) as count
        FROM telemetry_events
        WHERE created_at >= datetime('now', '-1 hour')
          AND (event_type LIKE '%error%' OR event_type LIKE '%fail%')
      `).get().count;

      if (errorEvents > 10) {
        alerts.push({
          severity: 'error',
          title: 'High Error Rate',
          message: `${errorEvents} error events in the last hour`
        });
      }
    } catch (e) {
      // Telemetry table may not exist
    }

    res.json({
      success: true,
      data: alerts
    });

  } catch (error) {
    console.error('[ADMIN-ANALYTICS] System alerts error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load system alerts'
    });
  }
});

// =====================================================
// ERROR MONITORING
// =====================================================

/**
 * GET /api/admin/errors/summary
 * Get error summary for last N hours
 */
router.get('/errors/summary', (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    let errorSummary = {
      total: 0,
      critical: 0,
      warning: 0,
      info: 0
    };

    try {
      const summary = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN event_type LIKE '%critical%' OR event_type LIKE '%fatal%' THEN 1 ELSE 0 END) as critical,
          SUM(CASE WHEN event_type LIKE '%warning%' OR event_type LIKE '%warn%' THEN 1 ELSE 0 END) as warning,
          SUM(CASE WHEN event_type LIKE '%error%' AND event_type NOT LIKE '%critical%' THEN 1 ELSE 0 END) as errors
        FROM telemetry_events
        WHERE created_at >= ?
          AND (event_type LIKE '%error%' OR event_type LIKE '%fail%' OR event_type LIKE '%warn%')
      `).get(cutoff);

      errorSummary = {
        total: summary.total || 0,
        critical: summary.critical || 0,
        warning: summary.warning || 0,
        info: summary.errors || 0
      };
    } catch (e) {
      console.log('Telemetry error summary not available:', e.message);
    }

    res.json({
      success: true,
      data: errorSummary
    });

  } catch (error) {
    console.error('[ADMIN-ANALYTICS] Error summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load error summary'
    });
  }
});

/**
 * GET /api/admin/errors
 * Get recent error logs
 */
router.get('/errors', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const severity = req.query.severity; // 'error', 'warning', 'critical'

    let errors = [];

    try {
      let query = `
        SELECT
          id,
          user_id,
          event_type,
          event_data,
          page_url,
          created_at
        FROM telemetry_events
        WHERE event_type LIKE '%error%' OR event_type LIKE '%fail%' OR event_type LIKE '%warn%'
      `;

      if (severity === 'critical') {
        query += ` AND (event_type LIKE '%critical%' OR event_type LIKE '%fatal%')`;
      } else if (severity === 'warning') {
        query += ` AND event_type LIKE '%warn%'`;
      } else if (severity === 'error') {
        query += ` AND event_type LIKE '%error%' AND event_type NOT LIKE '%critical%'`;
      }

      query += ` ORDER BY created_at DESC LIMIT ?`;

      errors = db.prepare(query).all(limit);

      // Parse event_data if it's JSON string
      errors = errors.map(err => ({
        ...err,
        event_data: typeof err.event_data === 'string' ? JSON.parse(err.event_data) : err.event_data
      }));

    } catch (e) {
      console.log('Telemetry error logs not available:', e.message);
    }

    res.json({
      success: true,
      data: errors
    });

  } catch (error) {
    console.error('[ADMIN-ANALYTICS] Error logs error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load error logs'
    });
  }
});

// =====================================================
// REAL-TIME ACTIVITY FEED
// =====================================================

/**
 * GET /api/admin/recent-activity
 * Get recent system activity across all users
 */
router.get('/recent-activity', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    // Get recent telemetry events
    let activities = [];

    try {
      activities = db.prepare(`
        SELECT
          te.id,
          te.user_id,
          te.event_type,
          te.event_data,
          te.page_url,
          te.created_at,
          u.name as user_name,
          u.email as user_email
        FROM telemetry_events te
        LEFT JOIN users u ON u.id = te.user_id
        WHERE te.event_type NOT LIKE '%error%'
          AND te.event_type NOT LIKE '%fail%'
        ORDER BY te.created_at DESC
        LIMIT ?
      `).all(limit);

      // Format activities with user-friendly messages
      activities = activities.map(activity => {
        let message = activity.event_type;

        // Parse event data
        let eventData = activity.event_data;
        if (typeof eventData === 'string') {
          try {
            eventData = JSON.parse(eventData);
          } catch (e) {
            eventData = {};
          }
        }

        // Create user-friendly messages
        const userName = activity.user_name || activity.user_email || 'Unknown user';

        switch (activity.event_type) {
          case 'login':
            message = `${userName} logged in`;
            break;
          case 'invoice_uploaded':
            message = `${userName} uploaded invoice`;
            break;
          case 'opportunity_created':
            message = `${userName} created opportunity`;
            break;
          case 'email_monitor_created':
            message = `${userName} created email monitor`;
            break;
          case 'mla_uploaded':
            message = `${userName} uploaded MLA contract`;
            break;
          default:
            message = `${userName}: ${activity.event_type}`;
        }

        return {
          id: activity.id,
          user_id: activity.user_id,
          user_name: userName,
          message: message,
          event_type: activity.event_type,
          created_at: activity.created_at
        };
      });

    } catch (e) {
      console.log('Recent activity not available:', e.message);
    }

    res.json({
      success: true,
      data: activities
    });

  } catch (error) {
    console.error('[ADMIN-ANALYTICS] Recent activity error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load recent activity'
    });
  }
});

// =====================================================
// API ENDPOINT USAGE STATISTICS
// =====================================================

/**
 * GET /api/admin/endpoint-stats
 * Get real-time API endpoint usage statistics
 */
router.get('/endpoint-stats', (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // Get endpoint statistics from api_request_log
    let endpointStats = [];

    try {
      endpointStats = db.prepare(`
        SELECT
          method || ' ' || endpoint as path,
          COUNT(*) as calls,
          ROUND(AVG(response_time_ms), 0) as avg_time_ms,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count,
          COUNT(DISTINCT user_id) as unique_users,
          MAX(created_at) as last_called
        FROM api_request_log
        WHERE created_at >= ?
        GROUP BY method, endpoint
        ORDER BY calls DESC
        LIMIT 20
      `).all(cutoff);

      // Calculate error rate and format response
      endpointStats = endpointStats.map(ep => ({
        path: ep.path,
        calls: ep.calls,
        uniqueUsers: ep.unique_users || 0,
        avgTime: ep.avg_time_ms > 1000 ? `${(ep.avg_time_ms / 1000).toFixed(1)}s` : `${ep.avg_time_ms}ms`,
        errorRate: ep.calls > 0 ? `${((ep.error_count / ep.calls) * 100).toFixed(1)}%` : '0%',
        status: ep.error_count === 0 ? 'healthy' : (ep.error_count / ep.calls > 0.1 ? 'error' : 'warning'),
        lastCalled: ep.last_called
      }));

    } catch (e) {
      console.log('API request log not available:', e.message);
      // Return empty array - table may not exist yet
    }

    // Also get overall API health metrics
    let overallStats = { totalRequests: 0, avgResponseTime: 0, errorRate: 0, uniqueUsers: 0 };

    try {
      const overall = db.prepare(`
        SELECT
          COUNT(*) as total_requests,
          ROUND(AVG(response_time_ms), 0) as avg_time,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors,
          COUNT(DISTINCT user_id) as unique_users
        FROM api_request_log
        WHERE created_at >= ?
      `).get(cutoff);

      overallStats = {
        totalRequests: overall.total_requests || 0,
        avgResponseTime: overall.avg_time || 0,
        errorRate: overall.total_requests > 0 ? ((overall.errors / overall.total_requests) * 100).toFixed(1) : 0,
        uniqueUsers: overall.unique_users || 0
      };
    } catch (e) {
      // Table may not exist
    }

    res.json({
      success: true,
      data: {
        endpoints: endpointStats,
        overall: overallStats,
        periodHours: hours
      }
    });

  } catch (error) {
    console.error('[ADMIN-ANALYTICS] Endpoint stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load endpoint statistics'
    });
  }
});

/**
 * GET /api/admin/live-users
 * Get currently active users (last 5 minutes)
 */
router.get('/live-users', (req, res) => {
  try {
    const minutes = parseInt(req.query.minutes) || 5;
    const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();

    let liveUsers = [];

    try {
      liveUsers = db.prepare(`
        SELECT
          u.id,
          u.name,
          u.email,
          u.role,
          arl.endpoint as last_endpoint,
          arl.created_at as last_activity
        FROM api_request_log arl
        INNER JOIN users u ON u.id = arl.user_id
        WHERE arl.created_at >= ?
          AND arl.user_id IS NOT NULL
        GROUP BY arl.user_id
        ORDER BY arl.created_at DESC
      `).all(cutoff);
    } catch (e) {
      console.log('Live users query failed:', e.message);
    }

    res.json({
      success: true,
      data: {
        count: liveUsers.length,
        users: liveUsers,
        periodMinutes: minutes
      }
    });

  } catch (error) {
    console.error('[ADMIN-ANALYTICS] Live users error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load live users'
    });
  }
});

// =====================================================
// SYSTEM HEALTH
// =====================================================

/**
 * GET /api/admin/system-health
 * Get overall system health status
 */
router.get('/system-health', (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks: {}
    };

    // Database connectivity check
    try {
      const dbCheck = db.prepare('SELECT 1 as test').get();
      health.checks.database = {
        status: dbCheck ? 'healthy' : 'degraded',
        message: dbCheck ? 'Database connected' : 'Database query failed'
      };
    } catch (e) {
      health.checks.database = { status: 'unhealthy', message: e.message };
      health.status = 'degraded';
    }

    // User count check
    try {
      const userCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1 OR is_active IS NULL').get();
      health.checks.users = {
        status: 'healthy',
        count: userCount?.count || 0,
        message: `${userCount?.count || 0} active users`
      };
    } catch (e) {
      health.checks.users = { status: 'unknown', message: 'Could not count users' };
    }

    // Recent activity check (last 24 hours)
    const day24Ago = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let recentLogins = 0;
    try {
      const loginCheck = db.prepare('SELECT COUNT(*) as count FROM users WHERE last_login_at >= ?').get(day24Ago);
      recentLogins = loginCheck?.count || 0;
      health.checks.activity = {
        status: recentLogins > 0 ? 'healthy' : 'warning',
        recentLogins: recentLogins,
        message: recentLogins > 0 ? `${recentLogins} users logged in (24h)` : 'No recent logins'
      };
    } catch (e) {
      health.checks.activity = { status: 'unknown', message: 'Could not check activity' };
    }

    // Email monitors check
    try {
      const monitorCheck = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN last_error IS NOT NULL AND is_active = 1 THEN 1 ELSE 0 END) as with_errors
        FROM email_monitors
      `).get();

      const hasErrors = (monitorCheck?.with_errors || 0) > 0;
      health.checks.emailMonitors = {
        status: hasErrors ? 'warning' : 'healthy',
        total: monitorCheck?.total || 0,
        active: monitorCheck?.active || 0,
        withErrors: monitorCheck?.with_errors || 0,
        message: hasErrors
          ? `${monitorCheck.with_errors} monitor(s) with errors`
          : `${monitorCheck?.active || 0} active monitors`
      };

      if (hasErrors && health.status === 'healthy') {
        health.status = 'warning';
      }
    } catch (e) {
      health.checks.emailMonitors = { status: 'unknown', message: 'Could not check email monitors' };
    }

    // Pending opportunities check
    try {
      const oppCheck = db.prepare(`
        SELECT COUNT(*) as count FROM opportunities WHERE status = 'pending'
      `).get();
      health.checks.opportunities = {
        status: 'healthy',
        pending: oppCheck?.count || 0,
        message: `${oppCheck?.count || 0} pending opportunities`
      };
    } catch (e) {
      health.checks.opportunities = { status: 'unknown', message: 'Could not check opportunities' };
    }

    // Memory and uptime (Node.js process)
    const memUsage = process.memoryUsage();
    health.checks.memory = {
      status: 'healthy',
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMB: Math.round(memUsage.rss / 1024 / 1024),
      message: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB heap used`
    };

    health.checks.uptime = {
      status: 'healthy',
      seconds: Math.round(process.uptime()),
      message: `Uptime: ${formatUptime(process.uptime())}`
    };

    res.json({
      success: true,
      data: health
    });

  } catch (error) {
    console.error('[ADMIN-ANALYTICS] System health error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check system health'
    });
  }
});

// Helper function to format uptime
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

module.exports = router;
