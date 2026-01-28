/**
 * Review Service
 * Handles human correction workflow for low-confidence invoice parses
 *
 * When a parse has confidence < threshold, it's flagged for review.
 * Users can approve, correct, or dismiss the parse.
 * Corrections are stored as patterns for future parsing improvements.
 */

// Database reference (will be set by init)
let db = null;

// Default confidence threshold for flagging reviews
const DEFAULT_CONFIDENCE_THRESHOLD = 70;

/**
 * Initialize the review service with database connection
 * @param {Object} database - Database connection from database.js
 */
function init(database) {
  db = database;
}

/**
 * Create a review task for a parse result
 * @param {number} runId - Ingestion run ID
 * @param {Object} parseResult - The parse result to review
 * @param {Object} options - Additional options
 * @returns {Object} Created review record
 */
function createReview(runId, parseResult, options = {}) {
  if (!db) {
    throw new Error('Review service not initialized. Call init() first.');
  }

  const confidenceScore = parseResult.confidence?.score || parseResult.confidence || 0;
  const reviewReasons = parseResult.reviewReasons || [];
  const reviewSeverity = parseResult.reviewSeverity || 'medium';

  const stmt = db.prepare(`
    INSERT INTO parse_reviews (run_id, original_result, confidence_score, review_reasons, review_severity, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `);

  const result = stmt.run(
    runId,
    JSON.stringify(parseResult),
    confidenceScore,
    JSON.stringify(reviewReasons),
    reviewSeverity
  );

  console.log(`[REVIEW] Created review #${result.lastInsertRowid} for run ${runId} (confidence: ${confidenceScore}%)`);

  return {
    id: result.lastInsertRowid,
    runId,
    confidenceScore,
    reviewReasons,
    reviewSeverity,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
}

/**
 * Check if a parse result needs review
 * @param {Object} parseResult - The parse result to check
 * @param {number} threshold - Confidence threshold (default 70)
 * @returns {boolean} Whether the result needs review
 */
function needsReview(parseResult, threshold = DEFAULT_CONFIDENCE_THRESHOLD) {
  // Check explicit flag
  if (parseResult.needsReview) return true;

  // Check confidence score
  const confidence = parseResult.confidence?.score || parseResult.confidence || 0;
  if (confidence < threshold) return true;

  // Check if guardrail was applied
  if (parseResult.guardrail?.applied) return true;

  return false;
}

/**
 * Get pending reviews
 * @param {Object} options - Query options
 * @returns {Array} List of pending reviews with invoice data
 */
function getPendingReviews(options = {}) {
  if (!db) {
    throw new Error('Review service not initialized. Call init() first.');
  }

  const limit = options.limit || 50;
  const severity = options.severity; // Filter by severity
  const userId = options.userId; // Filter by user who created the invoice

  let sql = `
    SELECT
      pr.id,
      pr.run_id,
      pr.confidence_score,
      pr.review_reasons,
      pr.review_severity,
      pr.status,
      pr.created_at,
      ir.file_name,
      ir.vendor_name,
      ir.invoice_total_cents,
      ir.user_id,
      u.name as user_name
    FROM parse_reviews pr
    JOIN ingestion_runs ir ON pr.run_id = ir.id
    LEFT JOIN users u ON ir.user_id = u.id
    WHERE pr.status = 'pending'
  `;

  const params = [];

  if (severity) {
    sql += ' AND pr.review_severity = ?';
    params.push(severity);
  }

  if (userId) {
    sql += ' AND ir.user_id = ?';
    params.push(userId);
  }

  sql += ' ORDER BY pr.review_severity DESC, pr.created_at ASC LIMIT ?';
  params.push(limit);

  const reviews = db.prepare(sql).all(...params);

  return reviews.map(r => ({
    ...r,
    review_reasons: r.review_reasons ? JSON.parse(r.review_reasons) : []
  }));
}

/**
 * Get a specific review with full details
 * @param {number} reviewId - Review ID
 * @returns {Object|null} Review details or null
 */
function getReview(reviewId) {
  if (!db) {
    throw new Error('Review service not initialized. Call init() first.');
  }

  const review = db.prepare(`
    SELECT
      pr.*,
      ir.file_name,
      ir.vendor_name,
      ir.invoice_total_cents,
      ir.user_id,
      ir.account_name
    FROM parse_reviews pr
    JOIN ingestion_runs ir ON pr.run_id = ir.id
    WHERE pr.id = ?
  `).get(reviewId);

  if (!review) return null;

  return {
    ...review,
    original_result: review.original_result ? JSON.parse(review.original_result) : null,
    corrected_result: review.corrected_result ? JSON.parse(review.corrected_result) : null,
    review_reasons: review.review_reasons ? JSON.parse(review.review_reasons) : []
  };
}

/**
 * Get review by run ID
 * @param {number} runId - Ingestion run ID
 * @returns {Object|null} Review details or null
 */
function getReviewByRunId(runId) {
  if (!db) {
    throw new Error('Review service not initialized. Call init() first.');
  }

  const review = db.prepare(`
    SELECT * FROM parse_reviews WHERE run_id = ?
  `).get(runId);

  if (!review) return null;

  return {
    ...review,
    original_result: review.original_result ? JSON.parse(review.original_result) : null,
    corrected_result: review.corrected_result ? JSON.parse(review.corrected_result) : null,
    review_reasons: review.review_reasons ? JSON.parse(review.review_reasons) : []
  };
}

/**
 * Approve a parse as-is
 * @param {number} reviewId - Review ID
 * @param {number} reviewerUserId - User ID of reviewer
 * @param {string} notes - Optional notes
 * @returns {Object} Updated review
 */
function approveReview(reviewId, reviewerUserId, notes = null) {
  if (!db) {
    throw new Error('Review service not initialized. Call init() first.');
  }

  const stmt = db.prepare(`
    UPDATE parse_reviews
    SET status = 'approved',
        reviewer_user_id = ?,
        notes = ?,
        reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  stmt.run(reviewerUserId, notes, reviewId);
  console.log(`[REVIEW] Review #${reviewId} approved by user ${reviewerUserId}`);

  return getReview(reviewId);
}

/**
 * Submit corrections for a parse
 * @param {number} reviewId - Review ID
 * @param {number} reviewerUserId - User ID of reviewer
 * @param {Object} corrections - Corrected parse result
 * @param {string} notes - Optional notes
 * @returns {Object} Updated review
 */
function submitCorrections(reviewId, reviewerUserId, corrections, notes = null) {
  if (!db) {
    throw new Error('Review service not initialized. Call init() first.');
  }

  const review = getReview(reviewId);
  if (!review) {
    throw new Error('Review not found');
  }

  // Update the review
  const stmt = db.prepare(`
    UPDATE parse_reviews
    SET status = 'corrected',
        corrected_result = ?,
        reviewer_user_id = ?,
        notes = ?,
        reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  stmt.run(JSON.stringify(corrections), reviewerUserId, notes, reviewId);

  // Update the ingestion run with corrected totals
  if (corrections.totals?.totalCents) {
    db.prepare(`
      UPDATE ingestion_runs
      SET invoice_total_cents = ?
      WHERE id = ?
    `).run(corrections.totals.totalCents, review.run_id);
  }

  // Update line items if provided
  if (corrections.lineItems && corrections.lineItems.length > 0) {
    // Delete existing items
    db.prepare('DELETE FROM invoice_items WHERE run_id = ?').run(review.run_id);

    // Insert corrected items
    const insertItem = db.prepare(`
      INSERT INTO invoice_items (run_id, sku, description, quantity, unit_price_cents, total_cents, category)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of corrections.lineItems) {
      insertItem.run(
        review.run_id,
        item.sku || null,
        item.description || '',
        item.quantity || item.qty || 1,
        item.unitPriceCents || 0,
        item.lineTotalCents || 0,
        item.category || 'item'
      );
    }
  }

  console.log(`[REVIEW] Review #${reviewId} corrected by user ${reviewerUserId}`);

  // Create correction patterns for learning
  createCorrectionPatterns(review, corrections, reviewerUserId);

  return getReview(reviewId);
}

/**
 * Dismiss a review (mark as not needing correction)
 * @param {number} reviewId - Review ID
 * @param {number} reviewerUserId - User ID of reviewer
 * @param {string} notes - Reason for dismissal
 * @returns {Object} Updated review
 */
function dismissReview(reviewId, reviewerUserId, notes) {
  if (!db) {
    throw new Error('Review service not initialized. Call init() first.');
  }

  const stmt = db.prepare(`
    UPDATE parse_reviews
    SET status = 'dismissed',
        reviewer_user_id = ?,
        notes = ?,
        reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  stmt.run(reviewerUserId, notes, reviewId);
  console.log(`[REVIEW] Review #${reviewId} dismissed by user ${reviewerUserId}`);

  return getReview(reviewId);
}

/**
 * Create correction patterns from a review for future parsing improvements
 * @param {Object} review - Original review
 * @param {Object} corrections - Corrected result
 * @param {number} userId - User who made corrections
 */
function createCorrectionPatterns(review, corrections, userId) {
  if (!review.original_result) return;

  const original = review.original_result;
  const vendorName = review.vendor_name || original.vendorKey;

  // Check for total correction
  if (corrections.totals?.totalCents !== original.totals?.totalCents) {
    db.prepare(`
      INSERT INTO correction_patterns (vendor_name, pattern_type, raw_pattern, correct_interpretation, created_from_review_id, created_by_user_id)
      VALUES (?, 'total_correction', ?, ?, ?, ?)
    `).run(
      vendorName,
      JSON.stringify({ originalTotal: original.totals?.totalCents }),
      JSON.stringify({ correctedTotal: corrections.totals?.totalCents }),
      review.id,
      userId
    );
    console.log(`[REVIEW] Created total_correction pattern for ${vendorName}`);
  }

  // Check for line item count change
  const originalCount = original.lineItems?.length || 0;
  const correctedCount = corrections.lineItems?.length || 0;
  if (correctedCount !== originalCount) {
    db.prepare(`
      INSERT INTO correction_patterns (vendor_name, pattern_type, raw_pattern, correct_interpretation, created_from_review_id, created_by_user_id)
      VALUES (?, 'line_item_count', ?, ?, ?, ?)
    `).run(
      vendorName,
      JSON.stringify({ originalCount }),
      JSON.stringify({ correctedCount }),
      review.id,
      userId
    );
    console.log(`[REVIEW] Created line_item_count pattern for ${vendorName}`);
  }
}

/**
 * Get correction patterns for a vendor
 * @param {string} vendorName - Vendor name
 * @returns {Array} List of correction patterns
 */
function getCorrectionPatterns(vendorName) {
  if (!db) {
    throw new Error('Review service not initialized. Call init() first.');
  }

  const patterns = db.prepare(`
    SELECT * FROM correction_patterns
    WHERE vendor_name = ?
    ORDER BY times_applied DESC, created_at DESC
  `).all(vendorName);

  return patterns.map(p => ({
    ...p,
    raw_pattern: p.raw_pattern ? JSON.parse(p.raw_pattern) : null,
    correct_interpretation: p.correct_interpretation ? JSON.parse(p.correct_interpretation) : null
  }));
}

/**
 * Get review statistics
 * @returns {Object} Review stats
 */
function getReviewStats() {
  if (!db) {
    throw new Error('Review service not initialized. Call init() first.');
  }

  const stats = db.prepare(`
    SELECT
      status,
      COUNT(*) as count
    FROM parse_reviews
    GROUP BY status
  `).all();

  const bySeverity = db.prepare(`
    SELECT
      review_severity,
      COUNT(*) as count
    FROM parse_reviews
    WHERE status = 'pending'
    GROUP BY review_severity
  `).all();

  const result = {
    pending: 0,
    approved: 0,
    corrected: 0,
    dismissed: 0,
    total: 0,
    bySeverity: {
      low: 0,
      medium: 0,
      high: 0
    }
  };

  for (const row of stats) {
    result[row.status] = row.count;
    result.total += row.count;
  }

  for (const row of bySeverity) {
    result.bySeverity[row.review_severity] = row.count;
  }

  return result;
}

module.exports = {
  init,
  createReview,
  needsReview,
  getPendingReviews,
  getReview,
  getReviewByRunId,
  approveReview,
  submitCorrections,
  dismissReview,
  getCorrectionPatterns,
  getReviewStats,
  DEFAULT_CONFIDENCE_THRESHOLD
};
