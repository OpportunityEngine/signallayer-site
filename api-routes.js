// API Routes for Revenue Radar
// Production API endpoints that integrate with SQLite database
const express = require('express');
const db = require('./database');

const router = express.Router();

// Middleware to extract user from request (for now, use demo user or header)
function getUserContext(req) {
  // In production, this would extract from JWT token or session
  // For now, check header or default to demo user
  const userEmail = req.headers['x-user-email'] || 'you@demo.com';
  let user = db.getUserByEmail(userEmail);

  if (!user) {
    // Create user if doesn't exist
    const userId = db.createOrUpdateUser(userEmail, userEmail.split('@')[0], 'rep');
    user = db.getUserById(userId);
  }

  return user;
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
 * GET /api/admin/database-stats - Database statistics
 */
router.get('/admin/database-stats', (req, res) => {
  try {
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
 * GET /api/admin/usage-analytics - Usage analytics
 */
router.get('/admin/usage-analytics', (req, res) => {
  try {
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
 * GET /api/admin/financial-metrics - Financial metrics
 */
router.get('/admin/financial-metrics', (req, res) => {
  try {
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
 * GET /api/admin/top-customers - Top customers by usage
 */
router.get('/admin/top-customers', (req, res) => {
  try {
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
 * GET /api/admin/system-alerts - System health alerts
 */
router.get('/admin/system-alerts', (req, res) => {
  try {
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

// GET /api/admin/errors - Get recent errors with plain English descriptions
router.get('/admin/errors', (req, res) => {
  try {
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

// GET /api/admin/errors/summary - Get error summary statistics
router.get('/admin/errors/summary', (req, res) => {
  try {
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

// PUT /api/admin/errors/:id/resolve - Mark error as resolved
router.put('/admin/errors/:id/resolve', (req, res) => {
  try {
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

module.exports = router;
