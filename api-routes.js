// API Routes for Revenue Radar
// Production API endpoints that integrate with SQLite database
const express = require('express');
const db = require('./database');
const demoData = require('./dashboard/demoData');

const router = express.Router();

// ===== TEMPORARY PUBLIC DEBUG ENDPOINT =====
// TODO: Remove after debugging production issue
router.get('/public-debug-invoice-status', (req, res) => {
  try {
    const database = db.getDatabase();

    // Get counts
    const totalInvoices = database.prepare(`SELECT COUNT(*) as count FROM ingestion_runs`).get();
    const completedInvoices = database.prepare(`SELECT COUNT(*) as count FROM ingestion_runs WHERE status = 'completed'`).get();
    const nullUserInvoices = database.prepare(`SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id IS NULL`).get();

    // Get email monitors with created_by_user_id and account_name
    const monitors = database.prepare(`
      SELECT id, email_address, user_id, created_by_user_id, account_name,
             is_active, invoices_created_count, emails_processed_count,
             last_checked_at, last_error,
             oauth_access_token IS NOT NULL as has_token
      FROM email_monitors
    `).all();

    // Get recent processing log
    const recentProcessing = database.prepare(`
      SELECT monitor_id, status, skip_reason, invoices_created, error_message, created_at
      FROM email_processing_log
      ORDER BY created_at DESC
      LIMIT 20
    `).all();

    // Get ALL ingestion_runs with their run_id patterns for debugging
    const allInvoices = database.prepare(`
      SELECT id, run_id, user_id, account_name, vendor_name, status, invoice_total_cents, created_at
      FROM ingestion_runs
      ORDER BY created_at DESC
      LIMIT 50
    `).all();

    // Get users with invoice counts
    const userCounts = database.prepare(`
      SELECT u.id, u.email, u.name,
             (SELECT COUNT(*) FROM ingestion_runs WHERE user_id = u.id) as invoice_count,
             (SELECT COUNT(*) FROM email_monitors WHERE user_id = u.id OR created_by_user_id = u.id) as monitor_count
      FROM users u
      ORDER BY invoice_count DESC
      LIMIT 20
    `).all();

    // For each monitor, show what invoices would match via run_id pattern
    const monitorMatches = monitors.map(m => {
      const pattern = `email-${m.id}-%`;
      const matchingByRunId = database.prepare(`
        SELECT COUNT(*) as count FROM ingestion_runs WHERE run_id LIKE ?
      `).get(pattern);
      const matchingByAccountName = m.account_name ? database.prepare(`
        SELECT COUNT(*) as count FROM ingestion_runs WHERE account_name = ?
      `).get(m.account_name) : { count: 0 };

      return {
        monitorId: m.id,
        email: m.email_address,
        userId: m.user_id,
        createdByUserId: m.created_by_user_id,
        accountName: m.account_name,
        runIdPattern: pattern,
        invoicesMatchingByRunId: matchingByRunId.count,
        invoicesMatchingByAccountName: matchingByAccountName.count
      };
    });

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      database: {
        totalInvoices: totalInvoices.count,
        completedInvoices: completedInvoices.count,
        nullUserIdInvoices: nullUserInvoices.count
      },
      monitors: monitors.map(m => ({
        id: m.id,
        email: m.email_address,
        userId: m.user_id,
        createdByUserId: m.created_by_user_id,
        accountName: m.account_name,
        isActive: m.is_active,
        hasToken: m.has_token,
        invoicesCreated: m.invoices_created_count,
        emailsProcessed: m.emails_processed_count,
        lastChecked: m.last_checked_at,
        lastError: m.last_error
      })),
      monitorMatches: monitorMatches,
      recentInvoices: allInvoices,
      recentProcessing: recentProcessing,
      userInvoiceCounts: userCounts
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Demo user detection
const DEMO_ROLES = ['demo_viewer', 'demo_business'];
const DEMO_EMAILS = ['demo@revenueradar.com', 'business@demo.revenueradar.com'];

function isDemoUser(user) {
  if (!user) return false;
  if (DEMO_ROLES.includes(user.role)) return true;
  if (DEMO_EMAILS.includes((user.email || '').toLowerCase())) return true;
  return false;
}

// Middleware to extract user from request
function getUserContext(req) {
  // First check if user is set by JWT auth middleware
  if (req.user && req.user.id) {
    // Get full user data from database
    const fullUser = db.getUserById(req.user.id);
    if (fullUser) {
      return fullUser;
    }
    // If user not found in DB, return the JWT user data
    return req.user;
  }

  // Fallback: check x-user-email header (for backwards compatibility)
  const userEmail = req.headers['x-user-email'];
  if (userEmail) {
    const user = db.getUserByEmail(userEmail);
    if (user) {
      return user;
    }
  }

  // Last resort: return a demo user object (read-only operations)
  return {
    id: 0,
    email: 'demo@revenueradar.com',
    name: 'Demo User',
    role: 'demo_viewer'
  };
}

// ===== SPIF ENDPOINTS =====

// GET /api/spifs/active - Get all active SPIFs
router.get('/spifs/active', (req, res) => {
  try {
    const spifs = db.getActiveSPIFs();
    res.json({ success: true, data: spifs });
  } catch (error) {
    console.error('Error fetching active SPIFs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/spifs/:spifId/leaderboard - Get SPIF leaderboard
router.get('/spifs/:spifId/leaderboard', (req, res) => {
  try {
    const { spifId } = req.params;
    const limit = parseInt(req.query.limit) || 10;

    const leaderboard = db.getSPIFLeaderboard(spifId);

    res.json({ success: true, data: leaderboard });
  } catch (error) {
    console.error('Error fetching SPIF leaderboard:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/spifs/current-standings - Get current user's SPIF standings
router.get('/spifs/current-standings', (req, res) => {
  try {
    const user = getUserContext(req);

    const standings = db.getDatabase().prepare(`
      SELECT
        s.id as spif_id,
        s.name as spif_name,
        s.end_date,
        s.prize_amount_cents,
        ss.current_value,
        ss.rank
      FROM spifs s
      JOIN spif_standings ss ON s.id = ss.spif_id
      WHERE ss.user_id = ?
      AND s.status = 'active'
      ORDER BY s.end_date ASC
    `).all(user.id);

    res.json({ success: true, data: standings });
  } catch (error) {
    console.error('Error fetching user SPIF standings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== MLA ENDPOINTS =====

// GET /api/mlas - Get MLAs by status
router.get('/mlas', (req, res) => {
  try {
    const { status } = req.query;
    const mlas = db.getMLAsByStatus(status || 'active');

    res.json({ success: true, data: mlas });
  } catch (error) {
    console.error('Error fetching MLAs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/mlas/:mlaId/review - Record MLA review
router.post('/mlas/:mlaId/review', (req, res) => {
  try {
    const user = getUserContext(req);
    const { mlaId } = req.params;
    const { action, notes } = req.body;

    const reviewId = db.recordMLAReview(
      parseInt(mlaId),
      user.id,
      action || 'viewed',
      notes
    );

    // Get updated review count for this week
    const weekStats = db.getMLAReviewsThisWeek(user.id);

    res.json({
      success: true,
      data: {
        review_id: reviewId,
        mlas_reviewed_this_week: weekStats.count
      }
    });
  } catch (error) {
    console.error('Error recording MLA review:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/mlas/review-stats - Get user's MLA review stats
router.get('/mlas/review-stats', (req, res) => {
  try {
    const user = getUserContext(req);

    const weekStats = db.getMLAReviewsThisWeek(user.id);

    const totalStats = db.getDatabase().prepare(`
      SELECT
        COUNT(*) as total_reviews,
        COUNT(DISTINCT mla_id) as unique_mlas
      FROM mla_reviews
      WHERE user_id = ?
    `).get(user.id);

    res.json({
      success: true,
      data: {
        this_week: weekStats.count,
        total_reviews: totalStats.total_reviews,
        unique_mlas: totalStats.unique_mlas
      }
    });
  } catch (error) {
    console.error('Error fetching MLA stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== OPPORTUNITY ENDPOINTS =====

// GET /api/opportunities - Get opportunities for current user
router.get('/opportunities', (req, res) => {
  try {
    const user = getUserContext(req);
    const { status, limit } = req.query;

    let opportunities = db.getOpportunitiesByUser(user.id, status);

    if (limit) {
      opportunities = opportunities.slice(0, parseInt(limit));
    }

    // Format for frontend
    const formatted = opportunities.map(opp => ({
      id: opp.id,
      accountName: opp.account_name,
      opportunityType: opp.opportunity_type,
      status: opp.status,
      likelihoodPct: opp.likelihood_pct,
      estimatedValueCents: opp.estimated_value_cents,
      estimatedCommissionCents: opp.estimated_commission_cents,
      urgency: opp.urgency,
      detectedAt: opp.detected_at,
      lastActivityAt: opp.last_activity_at,
      notes: opp.notes,
      mlaValue: opp.mla_value,
      mlaEndDate: opp.mla_end_date
    }));

    res.json({ success: true, data: formatted });
  } catch (error) {
    console.error('Error fetching opportunities:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/opportunities/:oppId/update-status - Update opportunity status
router.post('/opportunities/:oppId/update-status', (req, res) => {
  try {
    const user = getUserContext(req);
    const { oppId } = req.params;
    const { status, notes } = req.body;

    db.updateOpportunityStatus(parseInt(oppId), status, user.id, notes);

    res.json({ success: true, message: 'Opportunity status updated' });
  } catch (error) {
    console.error('Error updating opportunity:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== COMMISSION ENDPOINTS =====

// GET /api/commissions/summary - Get commission summary for user
router.get('/commissions/summary', (req, res) => {
  try {
    const user = getUserContext(req);

    const thisMonth = db.getCommissionsThisMonth(user.id);

    const thisQuarter = db.getDatabase().prepare(`
      SELECT
        SUM(amount_cents) as total_cents,
        COUNT(*) as count
      FROM commissions
      WHERE user_id = ?
      AND created_at >= date('now', 'start of month', '-2 months')
    `).get(user.id);

    const thisYear = db.getDatabase().prepare(`
      SELECT
        SUM(amount_cents) as total_cents,
        COUNT(*) as count
      FROM commissions
      WHERE user_id = ?
      AND created_at >= date('now', 'start of year')
    `).get(user.id);

    const pending = db.getDatabase().prepare(`
      SELECT SUM(amount_cents) as total_cents
      FROM commissions
      WHERE user_id = ? AND status = 'pending'
    `).get(user.id);

    res.json({
      success: true,
      data: {
        this_month: {
          total_cents: thisMonth.total_cents || 0,
          count: thisMonth.count || 0
        },
        this_quarter: {
          total_cents: thisQuarter.total_cents || 0,
          count: thisQuarter.count || 0
        },
        this_year: {
          total_cents: thisYear.total_cents || 0,
          count: thisYear.count || 0
        },
        pending_cents: pending.total_cents || 0
      }
    });
  } catch (error) {
    console.error('Error fetching commission summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/commissions/history - Get commission history
router.get('/commissions/history', (req, res) => {
  try {
    const user = getUserContext(req);
    const { period } = req.query; // 'month', 'quarter', 'year'

    let dateFilter = '';
    switch (period) {
      case 'month':
        dateFilter = "AND created_at >= date('now', 'start of month')";
        break;
      case 'quarter':
        dateFilter = "AND created_at >= date('now', 'start of month', '-2 months')";
        break;
      case 'year':
        dateFilter = "AND created_at >= date('now', 'start of year')";
        break;
    }

    const commissions = db.getDatabase().prepare(`
      SELECT * FROM commissions
      WHERE user_id = ?
      ${dateFilter}
      ORDER BY created_at DESC
      LIMIT 50
    `).all(user.id);

    res.json({ success: true, data: commissions });
  } catch (error) {
    console.error('Error fetching commission history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== DASHBOARD ANALYTICS ENDPOINTS =====

// GET /api/dashboard/rep-summary - Get comprehensive rep dashboard data
router.get('/dashboard/rep-summary', (req, res) => {
  try {
    const user = getUserContext(req);
    const { mode } = req.query; // 'demo' or 'production'

    // Check cache first
    const cacheKey = `rep-summary:${user.id}:${mode || 'production'}`;
    const cached = db.getCachedAnalytics(cacheKey);

    if (cached) {
      return res.json({ success: true, data: cached, cached: true });
    }

    // Build fresh data
    const spifs = db.getActiveSPIFs();
    const spifLeaderboard = spifs.length > 0 ? db.getSPIFLeaderboard(spifs[0].id) : [];
    const opportunities = db.getOpportunitiesByUser(user.id);
    const commissionSummary = db.getCommissionsThisMonth(user.id);
    const mlaStats = db.getMLAReviewsThisWeek(user.id);

    const summary = {
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      },
      spifs: {
        active: spifs,
        current_leaderboard: spifLeaderboard,
        user_stats: {
          mlas_reviewed_this_week: mlaStats.count
        }
      },
      opportunities: {
        total: opportunities.length,
        by_status: {
          detected: opportunities.filter(o => o.status === 'detected').length,
          contacted: opportunities.filter(o => o.status === 'contacted').length,
          in_progress: opportunities.filter(o => o.status === 'in_progress').length,
          won: opportunities.filter(o => o.status === 'won').length
        },
        by_urgency: {
          critical: opportunities.filter(o => o.urgency === 'critical').length,
          high: opportunities.filter(o => o.urgency === 'high').length,
          medium: opportunities.filter(o => o.urgency === 'medium').length,
          low: opportunities.filter(o => o.urgency === 'low').length
        },
        top_opportunities: opportunities.slice(0, 10)
      },
      commissions: {
        this_month_cents: commissionSummary.total_cents || 0,
        this_month_count: commissionSummary.count || 0
      }
    };

    // Cache for 5 minutes
    db.setCachedAnalytics(cacheKey, summary, 5);

    res.json({ success: true, data: summary, cached: false });
  } catch (error) {
    console.error('Error fetching rep summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/dashboard/manager-summary - Get manager dashboard data
router.get('/dashboard/manager-summary', (req, res) => {
  try {
    const user = getUserContext(req);

    if (user.role !== 'manager' && user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Check cache
    const cacheKey = `manager-summary:${user.team_id}`;
    const cached = db.getCachedAnalytics(cacheKey);

    if (cached) {
      return res.json({ success: true, data: cached, cached: true });
    }

    // Get team data
    const teamReps = db.getDatabase().prepare(`
      SELECT * FROM users
      WHERE team_id = ? AND role = 'rep'
    `).all(user.team_id);

    const spifs = db.getActiveSPIFs();

    const teamPerformance = teamReps.map(rep => {
      const mlaStats = db.getMLAReviewsThisWeek(rep.id);
      const opportunities = db.getOpportunitiesByUser(rep.id);
      const commissions = db.getCommissionsThisMonth(rep.id);

      return {
        user_id: rep.id,
        name: rep.name,
        email: rep.email,
        mlas_reviewed_this_week: mlaStats.count,
        opportunities_assigned: opportunities.length,
        opportunities_won: opportunities.filter(o => o.status === 'won').length,
        commissions_this_month_cents: commissions.total_cents || 0
      };
    });

    const summary = {
      team: {
        id: user.team_id,
        member_count: teamReps.length
      },
      spifs: {
        active: spifs.map(spif => ({
          ...spif,
          leaderboard: db.getSPIFLeaderboard(spif.id)
        }))
      },
      team_performance: teamPerformance
    };

    // Cache for 10 minutes
    db.setCachedAnalytics(cacheKey, summary, 10);

    res.json({ success: true, data: summary, cached: false });
  } catch (error) {
    console.error('Error fetching manager summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== TELEMETRY ENDPOINTS =====

// POST /api/telemetry/track - Track telemetry event
router.post('/telemetry/track', (req, res) => {
  try {
    const user = getUserContext(req);
    const { event_type, event_data, page_url, session_id } = req.body;

    const eventId = db.logTelemetryEvent(
      user.id,
      event_type,
      event_data,
      page_url,
      session_id
    );

    res.json({ success: true, event_id: eventId });
  } catch (error) {
    console.error('Error tracking telemetry:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/telemetry/summary - Get telemetry summary
router.get('/telemetry/summary', (req, res) => {
  try {
    const user = getUserContext(req);
    const { hours } = req.query;

    const summary = db.getTelemetrySummary(user.id, parseInt(hours) || 24);

    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('Error fetching telemetry summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== RECENT UPLOADS ENDPOINT =====

/**
 * GET /api/uploads/recent - Get user's recent invoice uploads
 * Returns the most recent ingestion runs for the authenticated user
 * Demo users receive demo invoice data
 */
router.get('/uploads/recent', (req, res) => {
  try {
    const user = getUserContext(req);
    const limit = parseInt(req.query.limit) || 10;

    console.log(`[API] /uploads/recent - User ID: ${user?.id}, Email: ${user?.email}`);

    // Demo users get demo invoice data
    if (isDemoUser(user)) {
      const demoInvoices = demoData.invoices.slice(0, limit);
      return res.json({
        success: true,
        runs: demoInvoices
      });
    }

    const database = db.getDatabase();

    // Debug: Check how many invoices exist for this user
    const debugCount = database.prepare(`SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id = ?`).get(user.id);
    const totalCount = database.prepare(`SELECT COUNT(*) as count FROM ingestion_runs`).get();
    console.log(`[API] Invoices for user ${user.id}: ${debugCount.count}, Total in DB: ${totalCount.count}`);

    // AUTO-HEAL: If user has 0 invoices but their monitors have invoices_created_count > 0,
    // automatically fix the ownership issue
    if (debugCount.count === 0 && totalCount.count > 0) {
      const monitorInvoiceCount = database.prepare(`
        SELECT COALESCE(SUM(invoices_created_count), 0) as count
        FROM email_monitors
        WHERE user_id = ? OR created_by_user_id = ?
      `).get(user.id, user.id);

      if (monitorInvoiceCount.count > 0) {
        console.log(`[API] AUTO-HEAL: User ${user.id} has 0 invoices but monitors show ${monitorInvoiceCount.count}. Fixing...`);

        // Fix email_monitors user_id if needed
        database.prepare(`
          UPDATE email_monitors
          SET user_id = created_by_user_id
          WHERE user_id IS NULL AND created_by_user_id IS NOT NULL
        `).run();

        // Get user's monitors
        const userMonitors = database.prepare(`
          SELECT id, account_name FROM email_monitors
          WHERE user_id = ? OR created_by_user_id = ?
        `).all(user.id, user.id);

        // Fix ingestion_runs
        for (const monitor of userMonitors) {
          const pattern = `email-${monitor.id}-%`;
          database.prepare(`
            UPDATE ingestion_runs
            SET user_id = ?
            WHERE run_id LIKE ? AND (user_id IS NULL OR user_id != ?)
          `).run(user.id, pattern, user.id);

          if (monitor.account_name) {
            database.prepare(`
              UPDATE ingestion_runs
              SET user_id = ?
              WHERE account_name = ? AND (user_id IS NULL OR user_id != ?)
            `).run(user.id, monitor.account_name, user.id);
          }
        }

        // Re-count after fix
        const fixedCount = database.prepare(`SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id = ?`).get(user.id);
        console.log(`[API] AUTO-HEAL: Fixed! User ${user.id} now has ${fixedCount.count} invoices`);
      }
    }

    // Get user's monitor IDs to find invoices via run_id pattern or account_name
    const userMonitors = database.prepare(`
      SELECT id, account_name FROM email_monitors
      WHERE user_id = ? OR created_by_user_id = ?
    `).all(user.id, user.id);

    const monitorIds = userMonitors.map(m => m.id);
    const accountNames = userMonitors.map(m => m.account_name).filter(Boolean);

    // Build a robust WHERE clause that finds invoices by:
    // 1. Direct user_id match
    // 2. run_id pattern matching email monitor (email-{monitor_id}-%)
    // 3. account_name matching a monitor
    let whereClause = `ir.user_id = ?`;
    const queryParams = [user.id];

    if (monitorIds.length > 0) {
      const runIdPatterns = monitorIds.map(id => `ir.run_id LIKE 'email-${id}-%'`).join(' OR ');
      whereClause = `(${whereClause} OR ${runIdPatterns})`;
    }
    if (accountNames.length > 0) {
      const accountPlaceholders = accountNames.map(() => '?').join(', ');
      whereClause = `(${whereClause} OR ir.account_name IN (${accountPlaceholders}))`;
      queryParams.push(...accountNames);
    }

    queryParams.push(limit);

    console.log(`[API] /uploads/recent - Robust query for user ${user.id}, monitors: [${monitorIds.join(',')}], accounts: [${accountNames.join(',')}]`);

    const uploads = database.prepare(`
      SELECT
        ir.id,
        ir.run_id,
        ir.account_name,
        ir.vendor_name,
        ir.file_name,
        ir.file_size,
        ir.status,
        ir.error_message,
        ir.created_at,
        ir.completed_at,
        (SELECT COUNT(*) FROM invoice_items WHERE run_id = ir.id) as line_item_count,
        -- Use stored invoice_total_cents (parser-extracted total) with fallback to sum of items
        COALESCE(
          NULLIF(ir.invoice_total_cents, 0),
          (SELECT SUM(total_cents) FROM invoice_items WHERE run_id = ir.id)
        ) as total_cents
      FROM ingestion_runs ir
      WHERE ${whereClause}
      ORDER BY ir.created_at DESC
      LIMIT ?
    `).all(...queryParams);

    // Format the uploads for frontend display
    const formattedUploads = uploads.map(u => ({
      id: u.id,
      runId: u.run_id,
      fileName: u.file_name || 'Invoice',
      accountName: u.account_name || 'Unknown',
      vendorName: u.vendor_name || 'Unknown',
      status: u.status || 'completed',
      errorMessage: u.error_message || null,
      fileSize: u.file_size,
      createdAt: u.created_at,
      completedAt: u.completed_at,
      lineItemCount: u.line_item_count || 0,
      totalCents: u.total_cents || 0
    }));

    res.json({
      success: true,
      runs: formattedUploads
    });
  } catch (error) {
    console.error('[API] Error fetching recent uploads:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== SINGLE INVOICE DETAIL ENDPOINT =====

/**
 * GET /api/invoice/:runId - Get detailed invoice information including line items
 * Used by the invoice-detail.html page to show full invoice breakdown
 */
router.get('/invoice/:runId', (req, res) => {
  try {
    const user = getUserContext(req);
    const runId = req.params.runId;

    console.log(`[API] /invoice/${runId} - User ID: ${user?.id}`);

    if (!runId) {
      return res.status(400).json({ success: false, error: 'Invoice ID required' });
    }

    const database = db.getDatabase();

    // Get the invoice run
    const invoice = database.prepare(`
      SELECT
        ir.id,
        ir.run_id,
        ir.user_id,
        ir.account_name,
        ir.vendor_name,
        ir.file_name,
        ir.file_size,
        ir.status,
        ir.error_message,
        ir.created_at,
        ir.completed_at,
        ir.invoice_total_cents
      FROM ingestion_runs ir
      WHERE ir.run_id = ?
    `).get(runId);

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    // Get user's monitors for ownership verification
    const userMonitors = database.prepare(`
      SELECT id, account_name FROM email_monitors
      WHERE user_id = ? OR created_by_user_id = ?
    `).all(user.id, user.id);

    const monitorIds = userMonitors.map(m => m.id);
    const accountNames = userMonitors.map(m => m.account_name).filter(Boolean);

    // Check if user owns this invoice (direct match, run_id pattern, or account_name)
    const isOwner = invoice.user_id === user.id ||
      monitorIds.some(id => invoice.run_id?.startsWith(`email-${id}-`)) ||
      accountNames.includes(invoice.account_name) ||
      user.role === 'admin' || user.role === 'manager';

    if (!isOwner) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Get line items for this invoice
    const lineItems = database.prepare(`
      SELECT
        id,
        description,
        quantity,
        unit_price_cents,
        total_cents,
        category
      FROM invoice_items
      WHERE run_id = ?
      ORDER BY id
    `).all(invoice.id);

    // Calculate total from line items if not stored
    const calculatedTotal = lineItems.reduce((sum, item) => sum + (item.total_cents || 0), 0);
    const totalCents = invoice.invoice_total_cents || calculatedTotal;

    res.json({
      success: true,
      invoice: {
        id: invoice.id,
        runId: invoice.run_id,
        userId: invoice.user_id,
        accountName: invoice.account_name,
        vendorName: invoice.vendor_name,
        fileName: invoice.file_name,
        fileSize: invoice.file_size,
        status: invoice.status,
        errorMessage: invoice.error_message,
        createdAt: invoice.created_at,
        completedAt: invoice.completed_at,
        totalCents: totalCents,
        lineItems: lineItems.map(item => ({
          id: item.id,
          description: item.description,
          quantity: item.quantity,
          unitPriceCents: item.unit_price_cents,
          totalCents: item.total_cents,
          category: item.category
        }))
      }
    });
  } catch (error) {
    console.error('[API] Error fetching invoice:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== DIAGNOSTIC ENDPOINT =====
// GET /api/debug/invoices - Debug invoice visibility issues (Admin/Manager only)
router.get('/debug/invoices', (req, res) => {
  try {
    const user = getUserContext(req);

    // Require admin or manager role to view all users' data
    if (user.role !== 'admin' && user.role !== 'manager') {
      return res.status(403).json({
        success: false,
        error: 'Admin or manager access required'
      });
    }

    const database = db.getDatabase();

    // Get all users and their invoice counts
    const userInvoiceCounts = database.prepare(`
      SELECT
        u.id, u.email, u.name,
        (SELECT COUNT(*) FROM ingestion_runs WHERE user_id = u.id) as invoice_count
      FROM users u
      ORDER BY invoice_count DESC
    `).all();

    // Get total invoices
    const totalInvoices = database.prepare(`SELECT COUNT(*) as count FROM ingestion_runs`).get();

    // Get invoices with null user_id
    const nullUserInvoices = database.prepare(`
      SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id IS NULL
    `).get();

    // Get recent invoices with user info
    const recentInvoices = database.prepare(`
      SELECT
        ir.id, ir.run_id, ir.user_id, ir.file_name, ir.vendor_name, ir.status, ir.created_at,
        u.email as user_email
      FROM ingestion_runs ir
      LEFT JOIN users u ON ir.user_id = u.id
      ORDER BY ir.created_at DESC
      LIMIT 10
    `).all();

    // Get email monitors with their user assignments
    const monitors = database.prepare(`
      SELECT
        em.id, em.email_address, em.user_id, em.created_by_user_id, em.invoices_created_count,
        u1.email as user_email,
        u2.email as created_by_email
      FROM email_monitors em
      LEFT JOIN users u1 ON em.user_id = u1.id
      LEFT JOIN users u2 ON em.created_by_user_id = u2.id
    `).all();

    // Get skip_reason counts from email_processing_log
    let skipReasonCounts = [];
    try {
      skipReasonCounts = database.prepare(`
        SELECT
          skip_reason,
          COUNT(*) as count,
          MAX(processed_at) as last_occurrence
        FROM email_processing_log
        WHERE skip_reason IS NOT NULL
        GROUP BY skip_reason
        ORDER BY count DESC
      `).all();
    } catch (e) {
      // Table or column might not exist yet
      skipReasonCounts = [{ error: 'skip_reason column not available yet' }];
    }

    // Get recent skipped emails with reasons
    let recentSkippedEmails = [];
    try {
      recentSkippedEmails = database.prepare(`
        SELECT
          epl.id, epl.monitor_id, epl.email_uid, epl.email_subject,
          epl.from_address, epl.skip_reason, epl.status, epl.processed_at,
          em.email_address as monitor_email
        FROM email_processing_log epl
        LEFT JOIN email_monitors em ON epl.monitor_id = em.id
        WHERE epl.status = 'skipped' OR epl.skip_reason IS NOT NULL
        ORDER BY epl.processed_at DESC
        LIMIT 20
      `).all();
    } catch (e) {
      // Table might not exist yet
      recentSkippedEmails = [];
    }

    // Get email processing summary by status
    let emailProcessingSummary = {};
    try {
      const statuses = database.prepare(`
        SELECT status, COUNT(*) as count
        FROM email_processing_log
        GROUP BY status
      `).all();
      emailProcessingSummary = statuses.reduce((acc, s) => {
        acc[s.status || 'unknown'] = s.count;
        return acc;
      }, {});
    } catch (e) {
      emailProcessingSummary = { error: 'email_processing_log table not available' };
    }

    res.json({
      success: true,
      currentUser: {
        id: user.id,
        email: user.email
      },
      summary: {
        totalInvoices: totalInvoices.count,
        invoicesWithNullUser: nullUserInvoices.count,
        yourInvoices: userInvoiceCounts.find(u => u.id === user.id)?.invoice_count || 0
      },
      userInvoiceCounts,
      recentInvoices,
      emailMonitors: monitors,
      emailProcessing: {
        statusSummary: emailProcessingSummary,
        skipReasonCounts: skipReasonCounts,
        recentSkippedEmails: recentSkippedEmails
      }
    });
  } catch (error) {
    console.error('[API] Debug invoices error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/debug/fix-all - Comprehensive fix for monitor user_id and invoice ownership
router.post('/debug/fix-all', (req, res) => {
  try {
    const user = getUserContext(req);
    const database = db.getDatabase();
    const fixes = [];

    // STEP 1: Fix email_monitors table - ensure user_id is set from created_by_user_id
    const monitorsToFix = database.prepare(`
      SELECT id, email_address, user_id, created_by_user_id
      FROM email_monitors
      WHERE user_id IS NULL AND created_by_user_id IS NOT NULL
    `).all();

    if (monitorsToFix.length > 0) {
      const fixMonitorsResult = database.prepare(`
        UPDATE email_monitors
        SET user_id = created_by_user_id
        WHERE user_id IS NULL AND created_by_user_id IS NOT NULL
      `).run();
      fixes.push({
        step: 'fix_monitors_user_id',
        fixed: fixMonitorsResult.changes,
        detail: `Set user_id from created_by_user_id for ${fixMonitorsResult.changes} monitors`
      });
    }

    // STEP 2: Fix email_monitors owned by this user that have wrong user_id
    const userMonitorsFixed = database.prepare(`
      UPDATE email_monitors
      SET user_id = ?
      WHERE (created_by_user_id = ? AND user_id IS NULL)
    `).run(user.id, user.id);
    if (userMonitorsFixed.changes > 0) {
      fixes.push({
        step: 'fix_user_monitors',
        fixed: userMonitorsFixed.changes,
        detail: `Fixed user_id for ${userMonitorsFixed.changes} of your monitors`
      });
    }

    // STEP 3: Get all monitors that belong to this user
    const userMonitors = database.prepare(`
      SELECT id, email_address, account_name FROM email_monitors
      WHERE user_id = ? OR created_by_user_id = ?
    `).all(user.id, user.id);

    // STEP 4: Fix ingestion_runs from these monitors
    let invoicesFixed = 0;
    for (const monitor of userMonitors) {
      const pattern = `email-${monitor.id}-%`;

      const result = database.prepare(`
        UPDATE ingestion_runs
        SET user_id = ?
        WHERE run_id LIKE ? AND (user_id IS NULL OR user_id != ?)
      `).run(user.id, pattern, user.id);

      if (result.changes > 0) {
        invoicesFixed += result.changes;
      }

      // Also fix by account_name if set
      if (monitor.account_name) {
        const accountResult = database.prepare(`
          UPDATE ingestion_runs
          SET user_id = ?
          WHERE account_name = ? AND (user_id IS NULL OR user_id != ?)
        `).run(user.id, monitor.account_name, user.id);
        if (accountResult.changes > 0) {
          invoicesFixed += accountResult.changes;
        }
      }
    }

    if (invoicesFixed > 0) {
      fixes.push({
        step: 'fix_invoice_ownership',
        fixed: invoicesFixed,
        detail: `Fixed user_id for ${invoicesFixed} invoices`
      });
    }

    // STEP 5: Get updated counts for verification
    const yourInvoiceCount = database.prepare(`
      SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id = ?
    `).get(user.id);

    const totalInvoices = database.prepare(`
      SELECT COUNT(*) as count FROM ingestion_runs
    `).get();

    res.json({
      success: true,
      message: fixes.length > 0
        ? `Applied ${fixes.length} fix(es). Your invoices should now appear.`
        : 'No fixes needed - data already correct.',
      fixes,
      verification: {
        yourInvoices: yourInvoiceCount.count,
        totalInvoices: totalInvoices.count,
        monitorsOwned: userMonitors.length
      }
    });
  } catch (error) {
    console.error('[API] Fix-all error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/debug/fix-invoice-ownership - Fix invoices with wrong/null user_id
router.post('/debug/fix-invoice-ownership', (req, res) => {
  try {
    const user = getUserContext(req);
    const database = db.getDatabase();

    // Find email monitors owned by this user
    const userMonitors = database.prepare(`
      SELECT id, email_address FROM email_monitors
      WHERE user_id = ? OR created_by_user_id = ?
    `).all(user.id, user.id);

    if (userMonitors.length === 0) {
      return res.json({
        success: true,
        message: 'No email monitors found for your account',
        fixed: 0
      });
    }

    const monitorIds = userMonitors.map(m => m.id);

    // Fix invoices from email autopilot that have wrong user_id
    // These have run_id starting with 'email-{monitorId}-'
    let totalFixed = 0;

    for (const monitor of userMonitors) {
      const pattern = `email-${monitor.id}-%`;

      // Count before fix
      const beforeCount = database.prepare(`
        SELECT COUNT(*) as count FROM ingestion_runs
        WHERE run_id LIKE ? AND (user_id IS NULL OR user_id != ?)
      `).get(pattern, user.id);

      if (beforeCount.count > 0) {
        // Fix the user_id
        const result = database.prepare(`
          UPDATE ingestion_runs
          SET user_id = ?
          WHERE run_id LIKE ? AND (user_id IS NULL OR user_id != ?)
        `).run(user.id, pattern, user.id);

        totalFixed += result.changes;
        console.log(`[API] Fixed ${result.changes} invoices from monitor ${monitor.id} (${monitor.email_address}) for user ${user.id}`);
      }
    }

    // Also fix any invoices where account matches user's monitors
    const accountNames = userMonitors.map(m => {
      const monitor = database.prepare('SELECT account_name FROM email_monitors WHERE id = ?').get(m.id);
      return monitor?.account_name;
    }).filter(Boolean);

    for (const accountName of accountNames) {
      const result = database.prepare(`
        UPDATE ingestion_runs
        SET user_id = ?
        WHERE account_name = ? AND (user_id IS NULL OR user_id != ?)
      `).run(user.id, accountName, user.id);

      if (result.changes > 0) {
        totalFixed += result.changes;
        console.log(`[API] Fixed ${result.changes} invoices for account "${accountName}" for user ${user.id}`);
      }
    }

    res.json({
      success: true,
      message: totalFixed > 0
        ? `Fixed ${totalFixed} invoice(s) - they should now appear in My Invoices`
        : 'All invoices already have correct ownership',
      fixed: totalFixed,
      monitors: userMonitors.map(m => m.email_address)
    });
  } catch (error) {
    console.error('[API] Fix invoice ownership error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/debug/user-id-audit - Audit user_id attribution for all ingestion_runs (Admin only)
router.get('/debug/user-id-audit', (req, res) => {
  try {
    const user = getUserContext(req);

    // Require admin role to view sensitive attribution data
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const database = db.getDatabase();

    // Count of ingestion_runs by user_id
    const countsByUserId = database.prepare(`
      SELECT
        user_id,
        u.email,
        u.name,
        COUNT(*) as count,
        MIN(ir.created_at) as first_invoice,
        MAX(ir.created_at) as last_invoice
      FROM ingestion_runs ir
      LEFT JOIN users u ON ir.user_id = u.id
      GROUP BY user_id
      ORDER BY count DESC
    `).all();

    // Count with NULL user_id
    const nullCount = database.prepare(`
      SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id IS NULL
    `).get();

    // Recent inserts with user_id info (last 50)
    const recentInserts = database.prepare(`
      SELECT
        ir.id,
        ir.run_id,
        ir.user_id,
        ir.account_name,
        ir.vendor_name,
        ir.file_name,
        ir.status,
        ir.created_at,
        u.email as user_email,
        u.name as user_name,
        CASE
          WHEN ir.run_id LIKE 'email-%' THEN 'email_autopilot'
          WHEN ir.run_id LIKE 'ext-%' THEN 'browser_extension'
          ELSE 'manual_upload'
        END as ingest_source
      FROM ingestion_runs ir
      LEFT JOIN users u ON ir.user_id = u.id
      ORDER BY ir.created_at DESC
      LIMIT 50
    `).all();

    // Summary stats
    const totalRuns = database.prepare(`SELECT COUNT(*) as count FROM ingestion_runs`).get();
    const uniqueUsers = database.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM ingestion_runs WHERE user_id IS NOT NULL`).get();

    // Breakdown by source
    const sourceBreakdown = database.prepare(`
      SELECT
        CASE
          WHEN run_id LIKE 'email-%' THEN 'email_autopilot'
          WHEN run_id LIKE 'ext-%' THEN 'browser_extension'
          ELSE 'manual_upload'
        END as source,
        COUNT(*) as count,
        SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END) as null_user_count
      FROM ingestion_runs
      GROUP BY source
    `).all();

    res.json({
      success: true,
      summary: {
        totalInvoices: totalRuns.count,
        uniqueUsers: uniqueUsers.count,
        nullUserIdCount: nullCount.count,
        nullUserIdPercentage: totalRuns.count > 0
          ? ((nullCount.count / totalRuns.count) * 100).toFixed(2) + '%'
          : '0%'
      },
      sourceBreakdown,
      countsByUserId,
      recentInserts,
      hint: 'Use [USER_ID_TRACE] logs to debug attribution issues'
    });
  } catch (error) {
    console.error('[API] User ID audit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/debug/parse-score/:runId - Detailed parse scoring breakdown for debugging
router.get('/debug/parse-score/:runId', async (req, res) => {
  try {
    const { runId } = req.params;
    const database = db.getDatabase();

    // Get the ingestion run
    const run = database.prepare(`
      SELECT * FROM ingestion_runs WHERE id = ? OR run_id = ?
    `).get(runId, runId);

    if (!run) {
      return res.status(404).json({
        success: false,
        error: 'Invoice run not found'
      });
    }

    // Get line items
    const items = database.prepare(`
      SELECT * FROM invoice_items WHERE run_id = ?
    `).all(run.id);

    // Import validator for score breakdown
    let scoreBreakdown = null;
    try {
      const { getScoreBreakdown } = require('./services/invoice_parsing_v2/validator');
      const { extractTotalCandidates } = require('./services/invoice_parsing_v2/totalsCandidates');
      const { extractAdjustments } = require('./services/invoice_parsing_v2/adjustmentsExtractor');

      // Build parse result from stored data
      const parseResult = {
        vendorKey: run.vendor_name || 'unknown',
        vendorName: run.vendor_name,
        invoiceNumber: run.invoice_number,
        invoiceDate: run.invoice_date,
        customerName: run.account_name,
        totals: {
          totalCents: run.invoice_total_cents || 0,
          subtotalCents: run.invoice_subtotal_cents || 0,
          taxCents: run.invoice_tax_cents || 0
        },
        lineItems: items.map(item => ({
          description: item.description,
          quantity: item.quantity || 1,
          qty: item.quantity || 1,
          unitPriceCents: item.unit_price_cents || 0,
          lineTotalCents: item.total_cents || 0,
          category: item.category
        }))
      };

      // Get detailed score breakdown
      scoreBreakdown = getScoreBreakdown(parseResult);

      // If we have stored raw text, also extract totals candidates
      let totalsCandidates = null;
      let adjustments = null;

      // Try to get the original PDF text if cached
      const fs = require('fs');
      const path = require('path');
      const cacheDir = path.join(__dirname, 'data', 'text-cache');
      const cacheFile = path.join(cacheDir, `${run.run_id || run.id}.txt`);

      if (fs.existsSync(cacheFile)) {
        const rawText = fs.readFileSync(cacheFile, 'utf8');
        totalsCandidates = extractTotalCandidates(rawText);
        adjustments = extractAdjustments(rawText);
      }

      res.json({
        success: true,
        run: {
          id: run.id,
          runId: run.run_id,
          vendorName: run.vendor_name,
          accountName: run.account_name,
          status: run.status,
          invoiceTotalCents: run.invoice_total_cents,
          createdAt: run.created_at
        },
        itemCount: items.length,
        itemsSum: items.reduce((sum, i) => sum + (i.total_cents || 0), 0),
        scoreBreakdown,
        totalsCandidates: totalsCandidates?.candidates?.slice(0, 5) || null,
        adjustments: adjustments?.adjustments || null,
        adjustmentsSummary: adjustments?.summary || null
      });

    } catch (parserError) {
      // If parser modules not available, return basic info
      res.json({
        success: true,
        run: {
          id: run.id,
          runId: run.run_id,
          vendorName: run.vendor_name,
          accountName: run.account_name,
          status: run.status,
          invoiceTotalCents: run.invoice_total_cents,
          createdAt: run.created_at
        },
        itemCount: items.length,
        itemsSum: items.reduce((sum, i) => sum + (i.total_cents || 0), 0),
        scoreBreakdown: null,
        error: 'Parser modules not available: ' + parserError.message
      });
    }

  } catch (error) {
    console.error('[API] Parse score debug error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== DEMO MODE ENDPOINT =====

// GET /api/demo/status - Check if we should use demo or production data
router.get('/demo/status', (req, res) => {
  try {
    const user = getUserContext(req);

    // Check if there's real data for this user
    const hasRealData = db.getDatabase().prepare(`
      SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id = ?
    `).get(user.id);

    const shouldUseDemo = hasRealData.count === 0;

    res.json({
      success: true,
      data: {
        demo_mode: shouldUseDemo,
        has_real_data: hasRealData.count > 0,
        real_data_count: hasRealData.count
      }
    });
  } catch (error) {
    console.error('Error checking demo status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== RULES ENGINE & MLA ENDPOINTS =====

// POST /api/mlas/analyze - Analyze MLA contract and load pricing
router.post('/mlas/analyze', (req, res) => {
  try {
    const { contractNumber, accountName, vendorName, products, effectiveDate, endDate } = req.body;
    const user = getUserContext(req);

    if (!contractNumber || !accountName) {
      return res.status(400).json({
        success: false,
        error: 'Contract number and account name are required'
      });
    }

    // Create MLA contract
    const mlaId = db.createMLAContract({
      contractNumber,
      accountName,
      vendorName,
      effectiveDate,
      endDate,
      createdByUserId: user.id
    });

    // Upsert products if provided
    let productsLoaded = 0;
    if (products && Array.isArray(products) && products.length > 0) {
      db.upsertMLAProducts(mlaId, products);
      productsLoaded = products.length;
    }

    res.json({
      success: true,
      data: {
        mla_id: mlaId,
        contract_number: contractNumber,
        products_loaded: productsLoaded,
        message: `MLA ${contractNumber} analyzed successfully`
      }
    });
  } catch (error) {
    console.error('[MLA] Analyze error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/mlas/by-contract/:contractNumber - Get MLA with products
router.get('/mlas/by-contract/:contractNumber', (req, res) => {
  try {
    const mla = db.getMLAByContractNumber(req.params.contractNumber);

    if (!mla) {
      return res.status(404).json({
        success: false,
        error: 'MLA contract not found'
      });
    }

    res.json({ success: true, data: mla });
  } catch (error) {
    console.error('[MLA] Get by contract error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/mlas - List MLAs by account
router.get('/mlas', (req, res) => {
  try {
    const accountName = req.query.account || '';
    const mlas = db.listMLAsByAccount(accountName);

    res.json({
      success: true,
      data: mlas,
      count: mlas.length
    });
  } catch (error) {
    console.error('[MLA] List error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/mlas/price - Get MLA product price
router.get('/mlas/price', (req, res) => {
  try {
    const { account, sku } = req.query;

    if (!account || !sku) {
      return res.status(400).json({
        success: false,
        error: 'Account and SKU parameters are required'
      });
    }

    const pricing = db.getMLAProductPrice({ accountName: account, sku });

    if (!pricing) {
      return res.status(404).json({
        success: false,
        error: 'No pricing found for this account/SKU combination'
      });
    }

    res.json({ success: true, data: pricing });
  } catch (error) {
    console.error('[MLA] Price lookup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/rules - Create new opportunity rule
router.post('/rules', (req, res) => {
  try {
    const user = getUserContext(req);

    const ruleData = {
      ...req.body,
      createdByUserId: user.id
    };

    // Validation
    if (!ruleData.name) {
      return res.status(400).json({
        success: false,
        error: 'Rule name is required'
      });
    }

    if (!ruleData.actions || ruleData.actions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one action is required'
      });
    }

    const ruleId = db.createRule(ruleData);

    res.json({
      success: true,
      data: {
        rule_id: ruleId,
        message: `Rule "${ruleData.name}" created successfully`
      }
    });
  } catch (error) {
    console.error('[RULES] Create rule error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/rules - List all rules (optionally filtered by account)
router.get('/rules', (req, res) => {
  try {
    const accountName = req.query.account || null;
    const rules = db.listRulesByAccount(accountName);

    res.json({
      success: true,
      data: rules,
      count: rules.length
    });
  } catch (error) {
    console.error('[RULES] List rules error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/rules/:id/toggle - Toggle rule active/inactive
router.post('/rules/:id/toggle', (req, res) => {
  try {
    const ruleId = parseInt(req.params.id);
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'isActive must be a boolean'
      });
    }

    db.toggleRuleActive(ruleId, isActive);

    res.json({
      success: true,
      message: `Rule ${ruleId} ${isActive ? 'activated' : 'deactivated'}`
    });
  } catch (error) {
    console.error('[RULES] Toggle rule error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/opportunities/manual - Manually create opportunity (manager override)
router.post('/opportunities/manual', (req, res) => {
  try {
    const user = getUserContext(req);

    const opportunity = {
      ...req.body,
      source_type: 'manager_manual',
      created_by_user_id: user.id,
      status: 'open'
    };

    // Validation
    if (!opportunity.account_name) {
      return res.status(400).json({
        success: false,
        error: 'Account name is required'
      });
    }

    const oppId = db.createOpportunity(opportunity);

    res.json({
      success: true,
      data: {
        opportunity_id: oppId,
        message: 'Opportunity created successfully'
      }
    });
  } catch (error) {
    console.error('[OPPORTUNITY] Manual create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===================================================================
// EMAIL AUTOPILOT API ENDPOINTS
// ===================================================================

/**
 * GET /api/email-monitors - List all email monitors
 */
router.get('/email-monitors', (req, res) => {
  try {
    const user = getUserContext(req);
    const accountName = req.query.accountName;

    let monitors;
    if (accountName) {
      monitors = db.getEmailMonitorsByAccount(accountName);
    } else {
      monitors = db.getActiveEmailMonitors().map(m => {
        // Don't expose encrypted_password
        delete m.encrypted_password;
        return m;
      });
    }

    res.json({
      success: true,
      data: monitors,
      count: monitors.length
    });
  } catch (error) {
    console.error('[EMAIL MONITORS] List error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/email-monitors - Create new email monitor
 */
router.post('/email-monitors', (req, res) => {
  try {
    const user = getUserContext(req);
    const {
      accountName,
      monitorName,
      emailAddress,
      password,
      imapHost,
      imapPort,
      username,
      industry,
      customerType,
      checkIntervalMinutes,
      enableCostSavingsDetection,
      enableDuplicateDetection,
      enablePriceIncreaseAlerts,
      enableContractValidation,
      alertEmail
    } = req.body;

    // Validation
    if (!accountName || !emailAddress || !password) {
      return res.status(400).json({
        success: false,
        error: 'Account name, email address, and password are required'
      });
    }

    // Create monitor
    const monitorId = db.createEmailMonitor({
      accountName,
      monitorName,
      emailAddress,
      password,
      imapHost: imapHost || 'imap.gmail.com',
      imapPort: imapPort || 993,
      username: username || emailAddress,
      industry,
      customerType: customerType || 'business',
      checkIntervalMinutes: checkIntervalMinutes || 5,
      enableCostSavingsDetection,
      enableDuplicateDetection,
      enablePriceIncreaseAlerts,
      enableContractValidation,
      alertEmail,
      createdByUserId: user.id
    });

    // Start monitoring
    const emailService = require('./email-monitor-service');
    emailService.startMonitor(monitorId);

    res.json({
      success: true,
      data: {
        monitor_id: monitorId,
        email_address: emailAddress,
        message: 'Email monitor created and started'
      }
    });

  } catch (error) {
    console.error('[EMAIL MONITORS] Create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/email-monitors/:id/toggle - Enable/disable monitor
 */
router.put('/email-monitors/:id/toggle', (req, res) => {
  try {
    const monitorId = parseInt(req.params.id);
    const { isActive } = req.body;

    db.toggleEmailMonitor(monitorId, isActive);

    const emailService = require('./email-monitor-service');
    if (isActive) {
      emailService.startMonitor(monitorId);
    } else {
      emailService.stopMonitor(monitorId);
    }

    res.json({
      success: true,
      data: { monitor_id: monitorId, is_active: isActive }
    });

  } catch (error) {
    console.error('[EMAIL MONITORS] Toggle error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/email-monitors/:id/activity - Get recent activity for monitor
 */
router.get('/email-monitors/:id/activity', (req, res) => {
  try {
    const monitorId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit) || 100;

    const activity = db.getRecentEmailActivity(monitorId, limit);

    res.json({
      success: true,
      data: activity,
      count: activity.length
    });

  } catch (error) {
    console.error('[EMAIL MONITORS] Activity error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/email-monitors/activity - Get recent activity across all monitors
 */
router.get('/email-monitors-activity', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const activity = db.getRecentEmailActivity(null, limit);

    res.json({
      success: true,
      data: activity,
      count: activity.length
    });

  } catch (error) {
    console.error('[EMAIL MONITORS] Activity error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/email-monitors/:id/queue - Get email processing queue
 */
router.get('/email-monitors/:id/queue', (req, res) => {
  try {
    const monitorId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit) || 50;

    const queue = db.getRecentEmailQueue(monitorId, limit);

    // Parse attachment filenames from JSON
    queue.forEach(item => {
      try {
        item.attachment_filenames = JSON.parse(item.attachment_filenames || '[]');
      } catch (e) {
        item.attachment_filenames = [];
      }
    });

    res.json({
      success: true,
      data: queue,
      count: queue.length
    });

  } catch (error) {
    console.error('[EMAIL MONITORS] Queue error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/detected-savings - Get detected cost savings
 */
router.get('/detected-savings', (req, res) => {
  try {
    const monitorId = req.query.monitorId ? parseInt(req.query.monitorId) : null;
    const days = parseInt(req.query.days) || 30;

    const summary = db.getDetectedSavingsSummary(monitorId, days);

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    console.error('[DETECTED SAVINGS] Summary error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/email-service/status - Get email service status
 */
router.get('/email-service/status', (req, res) => {
  try {
    const emailService = require('./email-monitor-service');
    const status = emailService.getStatus();

    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    console.error('[EMAIL SERVICE] Status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/email-service/start - Start email monitoring service
 */
router.post('/email-service/start', async (req, res) => {
  try {
    const emailService = require('./email-monitor-service');
    await emailService.startAll();

    res.json({
      success: true,
      message: 'Email monitoring service started'
    });

  } catch (error) {
    console.error('[EMAIL SERVICE] Start error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/email-service/stop - Stop email monitoring service
 */
router.post('/email-service/stop', (req, res) => {
  try {
    const emailService = require('./email-monitor-service');
    emailService.stopAll();

    res.json({
      success: true,
      message: 'Email monitoring service stopped'
    });

  } catch (error) {
    console.error('[EMAIL SERVICE] Stop error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===================================================================
// ADMIN OPERATIONS API ENDPOINTS
// ===================================================================

/**
 * GET /api/admin/database-stats - Database statistics (Admin only)
 */
router.get('/admin/database-stats', (req, res) => {
  try {
    const user = getUserContext(req);

    // Require admin role
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const fs = require('fs');
    const dbPath = './revenue-radar.db';

    let dbSize = '0 MB';
    let totalRecords = 0;

    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      dbSize = `${sizeMB} MB`;
    }

    // Count total records across main tables
    const tables = ['users', 'ingestion_runs', 'opportunities', 'email_monitors', 'mla_contracts'];
    tables.forEach(table => {
      try {
        const result = db.getDatabase().prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
        totalRecords += result.count || 0;
      } catch (err) {
        // Table might not exist
      }
    });

    res.json({
      success: true,
      data: {
        size: dbSize,
        totalRecords: totalRecords,
        tables: tables.length
      }
    });

  } catch (error) {
    console.error('[ADMIN] Database stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/usage-analytics - Usage analytics (Admin only)
 */
router.get('/admin/usage-analytics', (req, res) => {
  try {
    const user = getUserContext(req);

    // Require admin role
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const database = db.getDatabase();

    // User counts
    const userStats = database.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN role = 'rep' THEN 1 ELSE 0 END) as reps,
        SUM(CASE WHEN role = 'manager' THEN 1 ELSE 0 END) as managers
      FROM users
    `).get();

    // Active users (users with recent activity)
    const activeUsers24h = database.prepare(`
      SELECT COUNT(DISTINCT user_id) as count
      FROM ingestion_runs
      WHERE created_at >= datetime('now', '-1 day')
    `).get();

    const activeUsers7d = database.prepare(`
      SELECT COUNT(DISTINCT user_id) as count
      FROM ingestion_runs
      WHERE created_at >= datetime('now', '-7 days')
    `).get();

    const activeUsers30d = database.prepare(`
      SELECT COUNT(DISTINCT user_id) as count
      FROM ingestion_runs
      WHERE created_at >= datetime('now', '-30 days')
    `).get();

    // Invoice processing stats
    const invoiceStats = database.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN created_at >= datetime('now', 'start of month') THEN 1 ELSE 0 END) as this_month,
        SUM(CASE WHEN created_at >= datetime('now', 'start of day') THEN 1 ELSE 0 END) as today
      FROM ingestion_runs
    `).get();

    // Opportunity stats
    const opportunityStats = database.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN source_type = 'email_autopilot' THEN 1 ELSE 0 END) as from_email,
        SUM(CASE WHEN rule_id IS NOT NULL THEN 1 ELSE 0 END) as from_rules
      FROM opportunities
    `).get();

    res.json({
      success: true,
      data: {
        totalUsers: userStats.total || 0,
        totalReps: userStats.reps || 0,
        totalManagers: userStats.managers || 0,
        activeUsers24h: activeUsers24h.count || 0,
        activeUsers7d: activeUsers7d.count || 0,
        activeUsers30d: activeUsers30d.count || 0,
        totalInvoices: invoiceStats.total || 0,
        invoicesThisMonth: invoiceStats.this_month || 0,
        invoicesToday: invoiceStats.today || 0,
        totalOpportunities: opportunityStats.total || 0,
        oppsFromEmail: opportunityStats.from_email || 0,
        oppsFromRules: opportunityStats.from_rules || 0
      }
    });

  } catch (error) {
    console.error('[ADMIN] Usage analytics error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/financial-metrics - Financial metrics (Admin only)
 */
router.get('/admin/financial-metrics', (req, res) => {
  try {
    const user = getUserContext(req);

    // Require admin role
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const database = db.getDatabase();

    // Total savings detected
    let totalSavingsCents = 0;
    try {
      const savings = database.prepare(`
        SELECT SUM(savings_amount_cents) as total
        FROM detected_savings
      `).get();
      totalSavingsCents = savings.total || 0;
    } catch (err) {
      // Table might not exist
    }

    // Total revenue opportunities
    const revenue = database.prepare(`
      SELECT
        SUM(estimated_value_cents) as total,
        AVG(estimated_value_cents) as average
      FROM opportunities
      WHERE estimated_value_cents IS NOT NULL
    `).get();

    // Customer value (average per account)
    const customerValue = database.prepare(`
      SELECT AVG(account_value) as avg_value
      FROM (
        SELECT
          account_name,
          SUM(estimated_value_cents) as account_value
        FROM opportunities
        WHERE estimated_value_cents IS NOT NULL
        GROUP BY account_name
      )
    `).get();

    res.json({
      success: true,
      data: {
        totalSavingsCents: totalSavingsCents,
        totalRevenueCents: revenue.total || 0,
        avgDealSizeCents: Math.round(revenue.average || 0),
        avgCustomerValueCents: Math.round(customerValue.avg_value || 0)
      }
    });

  } catch (error) {
    console.error('[ADMIN] Financial metrics error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/top-customers - Top customers by usage (Admin only)
 */
router.get('/admin/top-customers', (req, res) => {
  try {
    const user = getUserContext(req);

    // Require admin role
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const database = db.getDatabase();
    const limit = parseInt(req.query.limit) || 10;

    const customers = database.prepare(`
      SELECT
        ir.account_name,
        COUNT(DISTINCT ir.id) as invoices_processed,
        COUNT(DISTINCT o.id) as opportunities_created,
        COALESCE(SUM(ds.savings_amount_cents), 0) as savings_cents,
        MAX(ir.created_at) as last_activity
      FROM ingestion_runs ir
      LEFT JOIN opportunities o ON ir.account_name = o.account_name
      LEFT JOIN detected_savings ds ON ir.account_name = ds.monitor_id
      WHERE ir.account_name IS NOT NULL
      GROUP BY ir.account_name
      ORDER BY invoices_processed DESC
      LIMIT ?
    `).all(limit);

    res.json({
      success: true,
      data: customers
    });

  } catch (error) {
    console.error('[ADMIN] Top customers error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/system-alerts - System health alerts (Admin only)
 */
router.get('/admin/system-alerts', (req, res) => {
  try {
    const user = getUserContext(req);

    // Require admin role
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const database = db.getDatabase();
    const alerts = [];

    // Check for email monitor errors
    try {
      const emailErrors = database.prepare(`
        SELECT COUNT(*) as count
        FROM email_monitor_activity
        WHERE severity = 'error'
        AND created_at >= datetime('now', '-1 hour')
      `).get();

      if (emailErrors.count > 5) {
        alerts.push({
          severity: 'warning',
          title: 'Email Monitor Issues',
          message: `${emailErrors.count} email monitor errors in the last hour`
        });
      }
    } catch (err) {
      // Table might not exist
    }

    // Check for failed ingestion runs
    const failedIngestions = database.prepare(`
      SELECT COUNT(*) as count
      FROM ingestion_runs
      WHERE status = 'failed'
      AND created_at >= datetime('now', '-1 day')
    `).get();

    if (failedIngestions.count > 10) {
      alerts.push({
        severity: 'error',
        title: 'High Ingestion Failure Rate',
        message: `${failedIngestions.count} failed invoice ingestions in the last 24 hours`
      });
    }

    // Check database size
    const fs = require('fs');
    const dbPath = './revenue-radar.db';
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      const sizeMB = stats.size / (1024 * 1024);
      if (sizeMB > 500) {
        alerts.push({
          severity: 'info',
          title: 'Database Size Warning',
          message: `Database size is ${sizeMB.toFixed(2)} MB - consider archiving old data`
        });
      }
    }

    res.json({
      success: true,
      data: alerts
    });

  } catch (error) {
    console.error('[ADMIN] System alerts error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// ERROR TRACKING ADMIN ENDPOINTS
// =====================================================

// GET /api/admin/errors - Get recent errors with plain English descriptions (Admin only)
router.get('/admin/errors', (req, res) => {
  try {
    const user = getUserContext(req);

    // Require admin role
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const ErrorHandler = require('./error-handler');
    const limit = parseInt(req.query.limit) || 20;
    const severity = req.query.severity || null;

    const errors = ErrorHandler.getRecentErrors(limit, severity);

    res.json({
      success: true,
      data: errors
    });
  } catch (error) {
    console.error('[ADMIN] Get errors failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/admin/errors/summary - Get error summary statistics (Admin only)
router.get('/admin/errors/summary', (req, res) => {
  try {
    const user = getUserContext(req);

    // Require admin role
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const ErrorHandler = require('./error-handler');
    const hours = parseInt(req.query.hours) || 24;

    const summary = ErrorHandler.getErrorSummary(hours);

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('[ADMIN] Get error summary failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/admin/errors/:id/resolve - Mark error as resolved (Admin only)
router.put('/admin/errors/:id/resolve', (req, res) => {
  try {
    const user = getUserContext(req);

    // Require admin role
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const ErrorHandler = require('./error-handler');
    const errorId = parseInt(req.params.id);
    const { resolvedBy, notes } = req.body;

    if (!resolvedBy) {
      return res.status(400).json({
        success: false,
        error: 'resolvedBy is required'
      });
    }

    ErrorHandler.resolveError(errorId, resolvedBy, notes || null);

    res.json({
      success: true,
      message: 'Error marked as resolved'
    });
  } catch (error) {
    console.error('[ADMIN] Resolve error failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== MLA BULK IMPORT ENDPOINT =====

// POST /api/mla/bulk-import - Bulk import MLA contracts from Excel/CSV
router.post('/mla/bulk-import', (req, res) => {
  try {
    const user = getUserContext(req);
    const { contracts, duplicateHandling = 'skip' } = req.body;

    if (!contracts || !Array.isArray(contracts) || contracts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No contracts provided for import'
      });
    }

    const database = db.getDatabase();
    const results = {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };

    // Prepare statements
    const findExisting = database.prepare(`
      SELECT id FROM mlas WHERE account_name = ? AND vendor_name = ?
    `);

    const insertMLA = database.prepare(`
      INSERT INTO mlas (account_name, vendor_name, contract_value_cents, start_date, end_date, status, renewal_likelihood_pct, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    const updateMLA = database.prepare(`
      UPDATE mlas SET
        contract_value_cents = ?,
        start_date = ?,
        end_date = ?,
        status = ?,
        renewal_likelihood_pct = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    // Process each contract
    for (let i = 0; i < contracts.length; i++) {
      const contract = contracts[i];

      try {
        // Validate required fields
        if (!contract.account_name) {
          results.errors.push(`Row ${i + 1}: Missing account name`);
          results.skipped++;
          continue;
        }

        // Check for existing record
        const existing = findExisting.get(contract.account_name, contract.vendor_name || null);

        if (existing) {
          if (duplicateHandling === 'skip') {
            results.skipped++;
            continue;
          } else if (duplicateHandling === 'update') {
            updateMLA.run(
              contract.contract_value_cents || null,
              contract.start_date || null,
              contract.end_date || null,
              contract.status || 'active',
              contract.renewal_likelihood_pct || null,
              existing.id
            );
            results.updated++;
          } else {
            // Create new anyway
            insertMLA.run(
              contract.account_name,
              contract.vendor_name || null,
              contract.contract_value_cents || null,
              contract.start_date || null,
              contract.end_date || null,
              contract.status || 'active',
              contract.renewal_likelihood_pct || null
            );
            results.imported++;
          }
        } else {
          // Insert new record
          insertMLA.run(
            contract.account_name,
            contract.vendor_name || null,
            contract.contract_value_cents || null,
            contract.start_date || null,
            contract.end_date || null,
            contract.status || 'active',
            contract.renewal_likelihood_pct || null
          );
          results.imported++;
        }
      } catch (rowError) {
        results.errors.push(`Row ${i + 1}: ${rowError.message}`);
        results.skipped++;
      }
    }

    // Log the import activity
    db.logTelemetryEvent(user.id, 'mla_bulk_import', {
      total_contracts: contracts.length,
      imported: results.imported,
      updated: results.updated,
      skipped: results.skipped
    });

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('[MLA] Bulk import error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== NOTIFICATION ENDPOINTS =====

// GET /api/notifications - Get user notifications
router.get('/notifications', (req, res) => {
  try {
    const user = getUserContext(req);
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const database = db.getDatabase();

    // Create notifications table if it doesn't exist
    database.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT DEFAULT 'info',
        title TEXT NOT NULL,
        message TEXT,
        value TEXT,
        data TEXT,
        read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC);
    `);

    const notifications = database.prepare(`
      SELECT id, type, title, message, value, data, read, created_at as timestamp
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(user.id, limit, offset);

    // Parse JSON data field
    const parsed = notifications.map(n => ({
      ...n,
      read: Boolean(n.read),
      data: n.data ? JSON.parse(n.data) : null
    }));

    res.json({
      success: true,
      data: parsed
    });
  } catch (error) {
    console.error('[NOTIFICATIONS] Fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/notifications/unread - Get unread notifications
router.get('/notifications/unread', (req, res) => {
  try {
    const user = getUserContext(req);

    const database = db.getDatabase();

    // Ensure table exists
    database.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT DEFAULT 'info',
        title TEXT NOT NULL,
        message TEXT,
        value TEXT,
        data TEXT,
        read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    const notifications = database.prepare(`
      SELECT id, type, title, message, value, data, read, created_at as timestamp
      FROM notifications
      WHERE user_id = ? AND read = 0
      ORDER BY created_at DESC
      LIMIT 20
    `).all(user.id);

    const parsed = notifications.map(n => ({
      ...n,
      read: false,
      data: n.data ? JSON.parse(n.data) : null
    }));

    res.json({
      success: true,
      notifications: parsed,
      unreadCount: parsed.length
    });
  } catch (error) {
    console.error('[NOTIFICATIONS] Unread fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/notifications/:id/read - Mark notification as read
router.post('/notifications/:id/read', (req, res) => {
  try {
    const user = getUserContext(req);
    const { id } = req.params;

    const database = db.getDatabase();
    database.prepare(`
      UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?
    `).run(id, user.id);

    res.json({ success: true });
  } catch (error) {
    console.error('[NOTIFICATIONS] Mark read error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/notifications/read-all - Mark all notifications as read
router.post('/notifications/read-all', (req, res) => {
  try {
    const user = getUserContext(req);

    const database = db.getDatabase();
    database.prepare(`
      UPDATE notifications SET read = 1 WHERE user_id = ?
    `).run(user.id);

    res.json({ success: true });
  } catch (error) {
    console.error('[NOTIFICATIONS] Mark all read error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/notifications - Create a notification (internal use)
router.post('/notifications', (req, res) => {
  try {
    const { userId, type, title, message, value, data } = req.body;

    if (!userId || !title) {
      return res.status(400).json({
        success: false,
        error: 'userId and title are required'
      });
    }

    const database = db.getDatabase();

    // Ensure table exists
    database.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT DEFAULT 'info',
        title TEXT NOT NULL,
        message TEXT,
        value TEXT,
        data TEXT,
        read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    const result = database.prepare(`
      INSERT INTO notifications (user_id, type, title, message, value, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      type || 'info',
      title,
      message || null,
      value || null,
      data ? JSON.stringify(data) : null
    );

    res.json({
      success: true,
      data: {
        id: result.lastInsertRowid
      }
    });
  } catch (error) {
    console.error('[NOTIFICATIONS] Create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function to create notifications (for use by other modules)
function createNotification(userId, { type, title, message, value, data }) {
  try {
    const database = db.getDatabase();

    database.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT DEFAULT 'info',
        title TEXT NOT NULL,
        message TEXT,
        value TEXT,
        data TEXT,
        read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    const result = database.prepare(`
      INSERT INTO notifications (user_id, type, title, message, value, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      type || 'info',
      title,
      message || null,
      value || null,
      data ? JSON.stringify(data) : null
    );

    return result.lastInsertRowid;
  } catch (error) {
    console.error('[NOTIFICATIONS] Create helper error:', error);
    return null;
  }
}

// Export for use by other modules
router.createNotification = createNotification;

// ===== ADMIN CLEANUP ENDPOINTS =====
// Cleanup duplicate invoices and fix data quality issues

/**
 * GET /api/admin/cleanup/preview
 * Preview what duplicates would be cleaned up (dry run)
 */
router.get('/admin/cleanup/preview', (req, res) => {
  try {
    const database = db.getDatabase();

    // Find duplicate invoices (same file_name for same user)
    const duplicates = database.prepare(`
      SELECT
        user_id,
        file_name,
        COUNT(*) as count,
        GROUP_CONCAT(id) as ids,
        GROUP_CONCAT(invoice_total_cents) as totals,
        MIN(created_at) as first_created,
        MAX(created_at) as last_created
      FROM ingestion_runs
      WHERE status = 'completed'
        AND file_name IS NOT NULL
        AND file_name != ''
      GROUP BY user_id, file_name
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `).all();

    // Calculate totals
    let totalDuplicates = 0;
    let duplicateValueCents = 0;
    const duplicateDetails = duplicates.map(dup => {
      const ids = dup.ids.split(',').map(Number);
      const totals = dup.totals.split(',').map(Number);
      const deleteCount = ids.length - 1; // Keep first one
      totalDuplicates += deleteCount;
      // Sum value of duplicates to be deleted
      for (let i = 1; i < totals.length; i++) {
        duplicateValueCents += totals[i] || 0;
      }
      return {
        fileName: dup.file_name,
        userId: dup.user_id,
        copies: dup.count,
        toDelete: deleteCount,
        keepId: ids[0],
        deleteIds: ids.slice(1)
      };
    });

    // Find garbage vendor names
    const garbageVendors = database.prepare(`
      SELECT COUNT(*) as count FROM ingestion_runs
      WHERE status = 'completed'
        AND (
          vendor_name LIKE '%THIS COMMODITY%'
          OR vendor_name LIKE '%TRUST CLAIM%'
          OR vendor_name LIKE '%THIS DOCUMENT%'
          OR vendor_name LIKE '%Signature%'
          OR LENGTH(vendor_name) > 100
        )
    `).get();

    // Find suspiciously high totals
    const suspiciousInvoices = database.prepare(`
      SELECT COUNT(*) as count, SUM(invoice_total_cents) as total_cents
      FROM ingestion_runs
      WHERE status = 'completed'
        AND invoice_total_cents > 50000000
    `).get();

    // Current stats
    const currentStats = database.prepare(`
      SELECT
        COUNT(*) as total_invoices,
        COUNT(DISTINCT file_name) as unique_files,
        SUM(invoice_total_cents) as total_value_cents
      FROM ingestion_runs
      WHERE status = 'completed'
    `).get();

    res.json({
      success: true,
      preview: {
        duplicates: {
          count: totalDuplicates,
          valueCents: duplicateValueCents,
          details: duplicateDetails.slice(0, 20) // First 20 for preview
        },
        garbageVendors: garbageVendors.count,
        suspiciousInvoices: {
          count: suspiciousInvoices.count,
          totalCents: suspiciousInvoices.total_cents
        },
        currentStats: {
          totalInvoices: currentStats.total_invoices,
          uniqueFiles: currentStats.unique_files,
          totalValueCents: currentStats.total_value_cents
        },
        estimatedAfterCleanup: {
          totalInvoices: currentStats.total_invoices - totalDuplicates,
          totalValueCents: currentStats.total_value_cents - duplicateValueCents
        }
      }
    });
  } catch (error) {
    console.error('[CLEANUP] Preview error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/cleanup/execute
 * Actually delete duplicate invoices and fix data quality
 */
router.post('/admin/cleanup/execute', (req, res) => {
  try {
    const database = db.getDatabase();
    const results = { duplicatesDeleted: 0, itemsDeleted: 0, vendorsFixed: 0 };

    // Find and delete duplicate invoices
    const duplicates = database.prepare(`
      SELECT
        user_id,
        file_name,
        GROUP_CONCAT(id) as ids
      FROM ingestion_runs
      WHERE status = 'completed'
        AND file_name IS NOT NULL
        AND file_name != ''
      GROUP BY user_id, file_name
      HAVING COUNT(*) > 1
    `).all();

    const idsToDelete = [];
    duplicates.forEach(dup => {
      const ids = dup.ids.split(',').map(Number);
      // Keep first (oldest), delete rest
      idsToDelete.push(...ids.slice(1));
    });

    if (idsToDelete.length > 0) {
      // Delete associated line items first
      const deleteItems = database.prepare(`
        DELETE FROM invoice_items WHERE run_id IN (${idsToDelete.join(',')})
      `);
      const itemsResult = deleteItems.run();
      results.itemsDeleted = itemsResult.changes;

      // Delete duplicate invoices
      const deleteRuns = database.prepare(`
        DELETE FROM ingestion_runs WHERE id IN (${idsToDelete.join(',')})
      `);
      const runsResult = deleteRuns.run();
      results.duplicatesDeleted = runsResult.changes;

      console.log(`[CLEANUP] Deleted ${results.duplicatesDeleted} duplicate invoices and ${results.itemsDeleted} line items`);
    }

    // Fix garbage vendor names
    const garbageVendorResult = database.prepare(`
      UPDATE ingestion_runs
      SET vendor_name = 'Unknown Vendor'
      WHERE status = 'completed'
        AND (
          vendor_name LIKE '%THIS COMMODITY%'
          OR vendor_name LIKE '%TRUST CLAIM%'
          OR vendor_name LIKE '%THIS DOCUMENT%'
          OR vendor_name LIKE '%Signature%'
          OR vendor_name LIKE '%AN ADDITIONAL EXPENSE%'
          OR LENGTH(vendor_name) > 100
        )
    `).run();
    results.vendorsFixed = garbageVendorResult.changes;

    // Get new stats
    const newStats = database.prepare(`
      SELECT
        COUNT(*) as total_invoices,
        COUNT(DISTINCT file_name) as unique_files,
        SUM(invoice_total_cents) as total_value_cents
      FROM ingestion_runs
      WHERE status = 'completed'
    `).get();

    res.json({
      success: true,
      results,
      newStats: {
        totalInvoices: newStats.total_invoices,
        uniqueFiles: newStats.unique_files,
        totalValueCents: newStats.total_value_cents,
        totalValueFormatted: '$' + ((newStats.total_value_cents || 0) / 100).toLocaleString()
      }
    });
  } catch (error) {
    console.error('[CLEANUP] Execute error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/cleanup/reset-totals
 * Reset suspiciously high invoice totals to $0
 */
router.post('/admin/cleanup/reset-totals', (req, res) => {
  try {
    const database = db.getDatabase();
    const threshold = req.body.threshold || 100000000; // Default $1M

    // Find and reset suspiciously high totals
    const result = database.prepare(`
      UPDATE ingestion_runs
      SET invoice_total_cents = 0
      WHERE status = 'completed'
        AND invoice_total_cents > ?
    `).run(threshold);

    res.json({
      success: true,
      invoicesReset: result.changes,
      threshold: threshold,
      thresholdFormatted: '$' + (threshold / 100).toLocaleString()
    });
  } catch (error) {
    console.error('[CLEANUP] Reset totals error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
