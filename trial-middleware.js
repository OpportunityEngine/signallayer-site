// =====================================================
// TRIAL LIMITS MIDDLEWARE
// =====================================================
// Enforces trial limitations:
// - 30-day time limit
// - 20 invoice limit
// - Blocks access when trial expired
// - Increments invoice counter automatically
// - Sends warning emails at thresholds
// =====================================================

const db = require('./database');
const emailService = require('./email-service');

/**
 * Check if trial user has access
 * Middleware that blocks expired trials
 */
function checkTrialAccess(req, res, next) {
  try {
    const user = req.user;

    // Non-trial users always have access
    if (!user.is_trial) {
      return next();
    }

    // Check subscription status
    if (user.subscription_status === 'expired' || user.subscription_status === 'cancelled') {
      return res.status(403).json({
        success: false,
        error: 'Your trial has expired. Please contact us to upgrade to a paid plan.',
        trialExpired: true
      });
    }

    // Check time-based expiration
    const now = new Date();
    const trialExpires = new Date(user.trial_expires_at);

    if (now > trialExpires) {
      // Mark trial as expired
      db.prepare(`
        UPDATE users
        SET subscription_status = 'expired',
            is_active = 0
        WHERE id = ?
      `).run(user.id);

      return res.status(403).json({
        success: false,
        error: 'Your 30-day trial has ended. Contact us to upgrade.',
        trialExpired: true,
        reason: 'time_limit'
      });
    }

    // Check invoice limit
    if (user.trial_invoices_used >= user.trial_invoices_limit) {
      // Mark trial as expired
      db.prepare(`
        UPDATE users
        SET subscription_status = 'expired',
            is_active = 0
        WHERE id = ?
      `).run(user.id);

      return res.status(403).json({
        success: false,
        error: `You've reached your 20 invoice limit. Contact us to upgrade.`,
        trialExpired: true,
        reason: 'invoice_limit'
      });
    }

    // Add trial status to request for endpoints to use
    req.trialStatus = {
      daysLeft: Math.ceil((trialExpires - now) / (1000 * 60 * 60 * 24)),
      invoicesLeft: user.trial_invoices_limit - user.trial_invoices_used,
      invoicesUsed: user.trial_invoices_used,
      expiresAt: user.trial_expires_at
    };

    // Send warning emails at thresholds
    sendTrialWarningsIfNeeded(user, req.trialStatus);

    next();
  } catch (error) {
    console.error('[TRIAL] Access check error:', error);
    // Allow access on error to avoid blocking users
    next();
  }
}

/**
 * Increment invoice usage counter
 * Call this after successfully processing an invoice
 */
function incrementInvoiceUsage(userId) {
  try {
    const user = db.prepare('SELECT is_trial, trial_invoices_used, trial_invoices_limit FROM users WHERE id = ?').get(userId);

    if (!user || !user.is_trial) {
      return; // Not a trial user
    }

    const newCount = (user.trial_invoices_used || 0) + 1;

    db.prepare(`
      UPDATE users
      SET trial_invoices_used = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newCount, userId);

    console.log(`[TRIAL] User ${userId} invoice count: ${newCount}/${user.trial_invoices_limit}`);

    // Check if limit reached
    if (newCount >= user.trial_invoices_limit) {
      db.prepare(`
        UPDATE users
        SET subscription_status = 'expired',
            is_active = 0
        WHERE id = ?
      `).run(userId);

      console.log(`[TRIAL] User ${userId} reached invoice limit - trial expired`);
    }

  } catch (error) {
    console.error('[TRIAL] Invoice increment error:', error);
  }
}

/**
 * Send warning emails at key thresholds
 * - 3 days left
 * - 3 invoices left
 * - 1 day left
 * - Last invoice
 */
async function sendTrialWarningsIfNeeded(user, trialStatus) {
  try {
    const { daysLeft, invoicesLeft } = trialStatus;

    // Check if we've already sent this warning (to avoid spam)
    const lastWarning = db.prepare(`
      SELECT event_data FROM telemetry_events
      WHERE user_id = ? AND event_type = 'trial_warning_sent'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(user.id);

    let lastWarningData = {};
    if (lastWarning && lastWarning.event_data) {
      try {
        lastWarningData = JSON.parse(lastWarning.event_data);
      } catch (e) {
        // Invalid JSON, ignore
      }
    }

    // Send warning at 3 days left (only once)
    if (daysLeft === 3 && !lastWarningData.days_3) {
      await emailService.sendTrialExpirationWarning(user.email, user.name, daysLeft, invoicesLeft);

      db.logTelemetryEvent(user.id, 'trial_warning_sent', {
        days_3: true,
        days_left: daysLeft,
        invoices_left: invoicesLeft
      }, '/system/trial-check', 'system');
    }

    // Send warning at 3 invoices left (only once)
    if (invoicesLeft === 3 && !lastWarningData.invoices_3) {
      await emailService.sendTrialExpirationWarning(user.email, user.name, daysLeft, invoicesLeft);

      db.logTelemetryEvent(user.id, 'trial_warning_sent', {
        invoices_3: true,
        days_left: daysLeft,
        invoices_left: invoicesLeft
      }, '/system/trial-check', 'system');
    }

    // Send warning at 1 day left (only once)
    if (daysLeft === 1 && !lastWarningData.days_1) {
      await emailService.sendTrialExpirationWarning(user.email, user.name, daysLeft, invoicesLeft);

      db.logTelemetryEvent(user.id, 'trial_warning_sent', {
        days_1: true,
        days_left: daysLeft,
        invoices_left: invoicesLeft
      }, '/system/trial-check', 'system');
    }

    // Send warning at last invoice (only once)
    if (invoicesLeft === 1 && !lastWarningData.invoices_1) {
      await emailService.sendTrialExpirationWarning(user.email, user.name, daysLeft, invoicesLeft);

      db.logTelemetryEvent(user.id, 'trial_warning_sent', {
        invoices_1: true,
        days_left: daysLeft,
        invoices_left: invoicesLeft
      }, '/system/trial-check', 'system');
    }

  } catch (error) {
    console.error('[TRIAL] Warning email error:', error);
    // Non-critical - don't block request
  }
}

/**
 * Get trial status for a user
 * Returns trial info or null if not a trial user
 */
function getTrialStatus(userId) {
  try {
    const user = db.prepare(`
      SELECT
        is_trial,
        trial_started_at,
        trial_expires_at,
        trial_invoices_used,
        trial_invoices_limit,
        trial_days_limit,
        subscription_status
      FROM users
      WHERE id = ?
    `).get(userId);

    if (!user || !user.is_trial) {
      return null;
    }

    const now = new Date();
    const expiresAt = new Date(user.trial_expires_at);
    const daysLeft = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));
    const invoicesLeft = Math.max(0, user.trial_invoices_limit - user.trial_invoices_used);

    return {
      isTrial: true,
      status: user.subscription_status,
      startedAt: user.trial_started_at,
      expiresAt: user.trial_expires_at,
      daysTotal: user.trial_days_limit,
      daysLeft,
      daysUsed: user.trial_days_limit - daysLeft,
      invoicesTotal: user.trial_invoices_limit,
      invoicesUsed: user.trial_invoices_used,
      invoicesLeft,
      isExpired: user.subscription_status === 'expired' || daysLeft === 0 || invoicesLeft === 0
    };
  } catch (error) {
    console.error('[TRIAL] Get status error:', error);
    return null;
  }
}

module.exports = {
  checkTrialAccess,
  incrementInvoiceUsage,
  getTrialStatus,
  sendTrialWarningsIfNeeded
};
