/**
 * Total Arbitration Engine v2.0
 *
 * Universal invoice total finder that works across ALL vendor formats.
 * Uses 7 scoring strategies with bottom-bias and math reconciliation.
 *
 * Key principles:
 * 1. NEVER trust the first "TOTAL" found - subtotals/group totals often appear first
 * 2. Bias towards bottom of document (last page footer)
 * 3. Strong anchors: INVOICE TOTAL > AMOUNT DUE > BALANCE DUE > TOTAL
 * 4. Reject: GROUP TOTAL, SUBTOTAL, DEPT TOTAL, SECTION TOTAL, CATEGORY TOTAL
 * 5. Math validation: total should = subtotal + tax (±$0.05)
 * 6. Multi-page awareness: detect page breaks, prefer last page
 * 7. Vendor-specific patterns boost confidence
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const SCORING_CONFIG = {
  // Strong positive anchors (highest priority labels)
  INVOICE_TOTAL_LABEL: 100,
  AMOUNT_DUE_LABEL: 90,
  BALANCE_DUE_LABEL: 85,
  GRAND_TOTAL_LABEL: 80,
  TOTAL_DUE_LABEL: 75,
  PAY_THIS_AMOUNT_LABEL: 70,
  TOTAL_CURRENCY_LABEL: 60,  // "TOTAL USD", "TOTAL $"
  GENERIC_TOTAL_LABEL: 25,

  // Strong negative anchors (disqualifiers)
  SUBTOTAL_PENALTY: -150,
  GROUP_TOTAL_PENALTY: -150,
  DEPT_TOTAL_PENALTY: -150,
  SECTION_TOTAL_PENALTY: -150,
  CATEGORY_TOTAL_PENALTY: -150,
  EMPLOYEE_SUBTOTAL_PENALTY: -150,
  LINE_TOTAL_PENALTY: -120,
  TAX_LINE_PENALTY: -80,
  SHIPPING_PENALTY: -60,
  DISCOUNT_PENALTY: -50,

  // Position scoring
  BOTTOM_QUARTER_BONUS: 50,
  BOTTOM_TENTH_BONUS: 30,  // Additional bonus for very bottom
  LAST_PAGE_BONUS: 40,
  TOP_QUARTER_PENALTY: -30,

  // Math validation
  MATH_MATCH_BONUS: 50,  // total = subtotal + tax
  EXCEEDS_SUBTOTAL_BONUS: 20,
  EXCEEDS_LINE_SUM_BONUS: 15,

  // Value analysis
  NEAR_MAX_VALUE_BONUS: 20,
  SMALL_VALUE_PENALTY: -20,  // < $10
  VERY_SMALL_VALUE_PENALTY: -40,  // < $1

  // Vendor-specific patterns
  VENDOR_PATTERN_BONUS: 30,

  // Context analysis
  SURROUNDED_BY_SUMMARY_BONUS: 15,
  AFTER_TAX_LINE_BONUS: 25,
  NEAR_PAGE_BREAK_BONUS: 10,
};

// Page break patterns (common in multi-page invoices)
const PAGE_BREAK_PATTERNS = [
  /page\s*\d+\s*(of|\/)\s*\d+/i,
  /continued\s*(on\s*)?next\s*page/i,
  /--- page \d+ ---/i,
  /\f/,  // Form feed character
  /-{10,}/,  // Long dashes often indicate page breaks
  /={10,}/,  // Long equals signs
];

// Vendor-specific total patterns
const VENDOR_PATTERNS = {
  cintas: [
    /INVOICE\s+TOTAL\s*[:\s]*\$?[\d,]+\.?\d*/i,
    /TOTAL\s+DUE\s*[:\s]*\$?[\d,]+\.?\d*/i,
    /AMOUNT\s+DUE\s*[:\s]*\$?[\d,]+\.?\d*/i,
  ],
  sysco: [
    /INVOICE\s+TOTAL\s*\$?[\d,]+\.?\d*/i,
    /TOTAL\s+THIS\s+INVOICE/i,
    /BALANCE\s+DUE\s*\$?[\d,]+\.?\d*/i,
  ],
  usfoods: [
    /INVOICE\s+TOTAL\s*\$?[\d,]+\.?\d*/i,
    /TOTAL\s+DUE\s*\$?[\d,]+\.?\d*/i,
    /NET\s+AMOUNT\s+DUE/i,
  ],
  generic: [
    /GRAND\s+TOTAL\s*[:\s]*\$?[\d,]+\.?\d*/i,
    /TOTAL\s+AMOUNT\s*[:\s]*\$?[\d,]+\.?\d*/i,
    /AMOUNT\s+DUE\s*[:\s]*\$?[\d,]+\.?\d*/i,
  ]
};

// ============================================================================
// TEXT NORMALIZATION
// ============================================================================

/**
 * Normalize text for consistent parsing
 */
function normalizeText(text) {
  return (text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ============================================================================
// AMOUNT EXTRACTION
// ============================================================================

/**
 * Extract all monetary amount candidates from text
 * Returns array of { lineIndex, line, valueCents, raw, column }
 */
function extractAmountCandidates(text) {
  const candidates = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines
    if (!line.trim()) continue;

    // Match various money formats
    const patterns = [
      { regex: /\$\s*([\d,]+\.?\d*)/g, type: 'dollar_sign' },
      { regex: /(?:USD|CAD|EUR)\s*([\d,]+\.?\d*)/gi, type: 'currency_code' },
      { regex: /(?:^|[^\d])([\d,]+\.\d{2})(?:[^\d]|$)/g, type: 'decimal' },
    ];

    for (const { regex, type } of patterns) {
      let match;
      while ((match = regex.exec(line)) !== null) {
        const raw = match[0];
        const numStr = match[1].replace(/,/g, '');
        const value = parseFloat(numStr);

        if (!Number.isFinite(value) || value < 0.01) continue;

        // Convert to cents
        const valueCents = Math.round(value * 100);

        // Skip zero amounts
        if (valueCents === 0) continue;

        // Determine column position (left, center, right)
        const column = match.index < line.length / 3 ? 'left' :
                       match.index > line.length * 2 / 3 ? 'right' : 'center';

        candidates.push({
          lineIndex: i,
          line: line.trim(),
          valueCents,
          raw,
          type,
          column
        });
      }
    }
  }

  return candidates;
}

/**
 * Extract tax and subtotal amounts from text for math validation
 */
function extractTaxAndSubtotal(text) {
  const lines = text.split('\n');
  let subtotalCents = null;
  let taxCents = null;
  let subtotalLine = -1;
  let taxLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toUpperCase();

    // Look for subtotal
    if (/\bSUBTOTAL\b/.test(line) && !/\bGROUP\b|\bDEPT\b|\bEMPLOYEE\b/.test(line)) {
      const match = line.match(/\$?\s*([\d,]+\.?\d*)/);
      if (match) {
        const value = parseFloat(match[1].replace(/,/g, ''));
        if (Number.isFinite(value) && value > 0) {
          subtotalCents = Math.round(value * 100);
          subtotalLine = i;
        }
      }
    }

    // Look for tax (sales tax, state tax, tax amount)
    if (/\b(SALES\s*TAX|STATE\s*TAX|TAX\s*AMOUNT|TAX\s+\d|HST|GST|PST)\b/.test(line) && !/TOTAL/.test(line)) {
      const match = line.match(/\$?\s*([\d,]+\.?\d*)/);
      if (match) {
        const value = parseFloat(match[1].replace(/,/g, ''));
        if (Number.isFinite(value) && value >= 0) {
          taxCents = Math.round(value * 100);
          taxLine = i;
        }
      }
    }
  }

  return { subtotalCents, taxCents, subtotalLine, taxLine };
}

/**
 * Detect page breaks in the document
 */
function detectPageBreaks(text) {
  const lines = text.split('\n');
  const pageBreaks = [];

  for (let i = 0; i < lines.length; i++) {
    for (const pattern of PAGE_BREAK_PATTERNS) {
      if (pattern.test(lines[i])) {
        pageBreaks.push(i);
        break;
      }
    }
  }

  return pageBreaks;
}

/**
 * Determine which "page" a line is on based on detected page breaks
 */
function getPageNumber(lineIndex, pageBreaks) {
  let page = 1;
  for (const breakLine of pageBreaks) {
    if (lineIndex > breakLine) page++;
    else break;
  }
  return page;
}

// ============================================================================
// SCORING ENGINE
// ============================================================================

/**
 * Score a candidate based on all 7 strategies
 * Higher score = more likely to be the true invoice total
 */
function scoreCandidate(candidate, context) {
  const { line, lineIndex, valueCents, column } = candidate;
  const {
    totalLines,
    bottomWindowStart,
    maxValueCents,
    lineItemSum,
    subtotalCents,
    taxCents,
    pageBreaks,
    totalPages,
    vendorKey,
    allLines
  } = context;

  const L = line.toUpperCase();
  let score = 0;
  const reasons = [];

  // =========================================================================
  // STRATEGY 1: Label Pattern Matching (Positive Anchors)
  // =========================================================================

  // Highest priority: explicit invoice total labels
  if (/\b(INVOICE\s*TOTAL|INV\s*TOTAL|INVOICE\s+AMOUNT)\b/.test(L)) {
    score += SCORING_CONFIG.INVOICE_TOTAL_LABEL;
    reasons.push(`INVOICE_TOTAL_LABEL:+${SCORING_CONFIG.INVOICE_TOTAL_LABEL}`);
  }

  // High priority: amount due / balance due
  if (/\b(AMOUNT\s*DUE|AMT\s*DUE)\b/.test(L)) {
    score += SCORING_CONFIG.AMOUNT_DUE_LABEL;
    reasons.push(`AMOUNT_DUE_LABEL:+${SCORING_CONFIG.AMOUNT_DUE_LABEL}`);
  }

  if (/\b(BALANCE\s*DUE|BAL\s*DUE)\b/.test(L)) {
    score += SCORING_CONFIG.BALANCE_DUE_LABEL;
    reasons.push(`BALANCE_DUE_LABEL:+${SCORING_CONFIG.BALANCE_DUE_LABEL}`);
  }

  // Grand total
  if (/\bGRAND\s*TOTAL\b/.test(L)) {
    score += SCORING_CONFIG.GRAND_TOTAL_LABEL;
    reasons.push(`GRAND_TOTAL_LABEL:+${SCORING_CONFIG.GRAND_TOTAL_LABEL}`);
  }

  // Total due / pay this amount
  if (/\bTOTAL\s*DUE\b/.test(L)) {
    score += SCORING_CONFIG.TOTAL_DUE_LABEL;
    reasons.push(`TOTAL_DUE_LABEL:+${SCORING_CONFIG.TOTAL_DUE_LABEL}`);
  }

  if (/\bPAY\s*THIS\s*AMOUNT\b/.test(L)) {
    score += SCORING_CONFIG.PAY_THIS_AMOUNT_LABEL;
    reasons.push(`PAY_THIS_AMOUNT_LABEL:+${SCORING_CONFIG.PAY_THIS_AMOUNT_LABEL}`);
  }

  // TOTAL with currency indicator
  if (/\bTOTAL\s*(USD|CAD|EUR|\$)\b/.test(L)) {
    score += SCORING_CONFIG.TOTAL_CURRENCY_LABEL;
    reasons.push(`TOTAL_CURRENCY:+${SCORING_CONFIG.TOTAL_CURRENCY_LABEL}`);
  }

  // Generic TOTAL (but not if preceded by disqualifiers)
  if (/\bTOTAL\b/.test(L) && !/\b(SUB|GROUP|DEPT|SECTION|CATEGORY|EMPLOYEE|LINE|ITEM|NET|GROSS)\s*TOTAL\b/.test(L)) {
    // Only count if not already counted above
    if (!/\b(INVOICE|GRAND|BALANCE|AMOUNT)\s*/.test(L)) {
      score += SCORING_CONFIG.GENERIC_TOTAL_LABEL;
      reasons.push(`TOTAL_GENERIC:+${SCORING_CONFIG.GENERIC_TOTAL_LABEL}`);
    }
  }

  // =========================================================================
  // STRATEGY 2: Negative Pattern Rejection (Disqualifiers)
  // =========================================================================

  // Reject subtotals
  if (/\bSUBTOTAL\b/.test(L) || /\bSUB\s*-?\s*TOTAL\b/.test(L)) {
    score += SCORING_CONFIG.SUBTOTAL_PENALTY;
    reasons.push(`SUBTOTAL:${SCORING_CONFIG.SUBTOTAL_PENALTY}`);
  }

  // Reject group/section/category totals
  if (/\bGROUP\s*TOTAL\b/.test(L)) {
    score += SCORING_CONFIG.GROUP_TOTAL_PENALTY;
    reasons.push(`GROUP_TOTAL:${SCORING_CONFIG.GROUP_TOTAL_PENALTY}`);
  }

  if (/\bDEPT(ARTMENT)?\s*TOTAL\b/.test(L)) {
    score += SCORING_CONFIG.DEPT_TOTAL_PENALTY;
    reasons.push(`DEPT_TOTAL:${SCORING_CONFIG.DEPT_TOTAL_PENALTY}`);
  }

  if (/\bSECTION\s*TOTAL\b/.test(L)) {
    score += SCORING_CONFIG.SECTION_TOTAL_PENALTY;
    reasons.push(`SECTION_TOTAL:${SCORING_CONFIG.SECTION_TOTAL_PENALTY}`);
  }

  if (/\bCATEGORY\s*TOTAL\b/.test(L)) {
    score += SCORING_CONFIG.CATEGORY_TOTAL_PENALTY;
    reasons.push(`CATEGORY_TOTAL:${SCORING_CONFIG.CATEGORY_TOTAL_PENALTY}`);
  }

  // Reject employee subtotals (Cintas pattern)
  if (/\bEMPLOYEE\s*(TOTAL|SUBTOTAL)\b/.test(L) || /\b\d{4,5}\s+[A-Z]+\s+[A-Z]+\s+SUBTOTAL\b/.test(L)) {
    score += SCORING_CONFIG.EMPLOYEE_SUBTOTAL_PENALTY;
    reasons.push(`EMPLOYEE_SUBTOTAL:${SCORING_CONFIG.EMPLOYEE_SUBTOTAL_PENALTY}`);
  }

  // Reject line item totals
  if (/\b(LINE\s*TOTAL|ITEM\s*TOTAL|LINE\s*AMOUNT)\b/.test(L)) {
    score += SCORING_CONFIG.LINE_TOTAL_PENALTY;
    reasons.push(`LINE_TOTAL:${SCORING_CONFIG.LINE_TOTAL_PENALTY}`);
  }

  // Reject tax amounts (unless it's "TOTAL + TAX" or similar)
  if (/\b(SALES\s*TAX|TAX\s*AMOUNT|STATE\s*TAX|LOCAL\s*TAX|HST|GST|PST)\b/.test(L) && !/TOTAL/.test(L)) {
    score += SCORING_CONFIG.TAX_LINE_PENALTY;
    reasons.push(`TAX_LINE:${SCORING_CONFIG.TAX_LINE_PENALTY}`);
  }

  // Reject shipping/freight lines
  if (/\b(SHIPPING|FREIGHT|DELIVERY\s*FEE|HANDLING)\b/.test(L) && !/TOTAL/.test(L)) {
    score += SCORING_CONFIG.SHIPPING_PENALTY;
    reasons.push(`SHIPPING:${SCORING_CONFIG.SHIPPING_PENALTY}`);
  }

  // Reject discount lines
  if (/\b(DISCOUNT|CREDIT|ADJUSTMENT|PROMO)\b/.test(L) && !/TOTAL/.test(L)) {
    score += SCORING_CONFIG.DISCOUNT_PENALTY;
    reasons.push(`DISCOUNT:${SCORING_CONFIG.DISCOUNT_PENALTY}`);
  }

  // =========================================================================
  // STRATEGY 3: Position Bias (Bottom of Document Preferred)
  // =========================================================================

  // Strong bonus for being in bottom quarter
  if (lineIndex >= totalLines * 0.75) {
    score += SCORING_CONFIG.BOTTOM_QUARTER_BONUS;
    reasons.push(`BOTTOM_QUARTER:+${SCORING_CONFIG.BOTTOM_QUARTER_BONUS}`);

    // Additional bonus for very bottom (last 10%)
    if (lineIndex >= totalLines * 0.90) {
      score += SCORING_CONFIG.BOTTOM_TENTH_BONUS;
      reasons.push(`BOTTOM_TENTH:+${SCORING_CONFIG.BOTTOM_TENTH_BONUS}`);
    }
  }

  // Bonus for being on last page (multi-page documents)
  if (pageBreaks && pageBreaks.length > 0) {
    const pageNum = getPageNumber(lineIndex, pageBreaks);
    if (pageNum === totalPages) {
      score += SCORING_CONFIG.LAST_PAGE_BONUS;
      reasons.push(`LAST_PAGE:+${SCORING_CONFIG.LAST_PAGE_BONUS}`);
    }
  }

  // Penalty for being in top quarter of document
  if (lineIndex < totalLines * 0.25) {
    score += SCORING_CONFIG.TOP_QUARTER_PENALTY;
    reasons.push(`TOP_QUARTER:${SCORING_CONFIG.TOP_QUARTER_PENALTY}`);
  }

  // =========================================================================
  // STRATEGY 4: Math Reconciliation (total = subtotal + tax)
  // =========================================================================

  if (subtotalCents && taxCents !== null) {
    const expectedTotal = subtotalCents + taxCents;
    const tolerance = 5; // $0.05 tolerance for rounding

    if (Math.abs(valueCents - expectedTotal) <= tolerance) {
      score += SCORING_CONFIG.MATH_MATCH_BONUS;
      reasons.push(`MATH_MATCH:+${SCORING_CONFIG.MATH_MATCH_BONUS} (${valueCents} ≈ ${subtotalCents} + ${taxCents})`);
    }
  }

  // Bonus if value exceeds subtotal (expected for total with tax)
  if (subtotalCents && valueCents > subtotalCents) {
    score += SCORING_CONFIG.EXCEEDS_SUBTOTAL_BONUS;
    reasons.push(`EXCEEDS_SUBTOTAL:+${SCORING_CONFIG.EXCEEDS_SUBTOTAL_BONUS}`);
  }

  // Bonus if value exceeds sum of line items
  if (lineItemSum && valueCents >= lineItemSum) {
    score += SCORING_CONFIG.EXCEEDS_LINE_SUM_BONUS;
    reasons.push(`EXCEEDS_LINE_SUM:+${SCORING_CONFIG.EXCEEDS_LINE_SUM_BONUS}`);
  }

  // =========================================================================
  // STRATEGY 5: Value Analysis
  // =========================================================================

  // Bonus if this is close to the max value found (likely the grand total)
  if (maxValueCents && valueCents >= maxValueCents * 0.95) {
    score += SCORING_CONFIG.NEAR_MAX_VALUE_BONUS;
    reasons.push(`NEAR_MAX_VALUE:+${SCORING_CONFIG.NEAR_MAX_VALUE_BONUS}`);
  }

  // Penalty for small values (unlikely to be grand totals)
  if (valueCents < 1000) { // < $10
    score += SCORING_CONFIG.SMALL_VALUE_PENALTY;
    reasons.push(`SMALL_VALUE:${SCORING_CONFIG.SMALL_VALUE_PENALTY}`);
  }

  if (valueCents < 100) { // < $1
    score += SCORING_CONFIG.VERY_SMALL_VALUE_PENALTY;
    reasons.push(`VERY_SMALL_VALUE:${SCORING_CONFIG.VERY_SMALL_VALUE_PENALTY}`);
  }

  // =========================================================================
  // STRATEGY 6: Context Analysis
  // =========================================================================

  // Check surrounding lines for summary context
  if (allLines && lineIndex > 0 && lineIndex < allLines.length - 1) {
    const prevLine = (allLines[lineIndex - 1] || '').toUpperCase();
    const nextLine = (allLines[lineIndex + 1] || '').toUpperCase();

    // Bonus if preceded by subtotal or tax line (common pattern)
    if (/\b(SUBTOTAL|TAX|SHIPPING)\b/.test(prevLine)) {
      score += SCORING_CONFIG.AFTER_TAX_LINE_BONUS;
      reasons.push(`AFTER_TAX_LINE:+${SCORING_CONFIG.AFTER_TAX_LINE_BONUS}`);
    }

    // Bonus if in summary section (surrounded by summary-like lines)
    if (/\b(SUBTOTAL|TAX|TOTAL|AMOUNT|DUE|BALANCE)\b/.test(prevLine) ||
        /\b(SUBTOTAL|TAX|TOTAL|AMOUNT|DUE|BALANCE|THANK|REMIT)\b/.test(nextLine)) {
      score += SCORING_CONFIG.SURROUNDED_BY_SUMMARY_BONUS;
      reasons.push(`SUMMARY_CONTEXT:+${SCORING_CONFIG.SURROUNDED_BY_SUMMARY_BONUS}`);
    }
  }

  // Small bonus for being near page breaks (totals often near page boundaries)
  if (pageBreaks) {
    for (const breakLine of pageBreaks) {
      if (Math.abs(lineIndex - breakLine) <= 5) {
        score += SCORING_CONFIG.NEAR_PAGE_BREAK_BONUS;
        reasons.push(`NEAR_PAGE_BREAK:+${SCORING_CONFIG.NEAR_PAGE_BREAK_BONUS}`);
        break;
      }
    }
  }

  // =========================================================================
  // STRATEGY 7: Vendor-Specific Patterns
  // =========================================================================

  if (vendorKey) {
    const patterns = VENDOR_PATTERNS[vendorKey.toLowerCase()] || VENDOR_PATTERNS.generic;
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        score += SCORING_CONFIG.VENDOR_PATTERN_BONUS;
        reasons.push(`VENDOR_PATTERN_${vendorKey.toUpperCase()}:+${SCORING_CONFIG.VENDOR_PATTERN_BONUS}`);
        break;
      }
    }
  }

  return { score, reasons };
}

// ============================================================================
// MAIN ARBITRATION FUNCTIONS
// ============================================================================

/**
 * Find the best invoice total from the full document
 *
 * @param {string} rawText - Full invoice text
 * @param {Object} options - Configuration options
 * @returns {Object} { totalCents, confidence, source, trace, shouldOverride }
 */
function findBestTotal(rawText, options = {}) {
  const {
    bottomWindowLines = 100,
    lineItemSum = 0,
    parserTotal = 0,
    vendorKey = null
  } = options;

  const trace = [];
  const text = normalizeText(rawText);
  const lines = text.split('\n');
  const totalLines = lines.length;

  // Calculate bottom window start
  const bottomWindowStart = Math.max(0, totalLines - bottomWindowLines);

  // Detect page breaks for multi-page awareness
  const pageBreaks = detectPageBreaks(text);
  const totalPages = pageBreaks.length + 1;

  // Extract tax and subtotal for math validation
  const { subtotalCents, taxCents, subtotalLine, taxLine } = extractTaxAndSubtotal(text);

  trace.push({
    phase: 'init',
    totalLines,
    pageBreaks: pageBreaks.length,
    subtotalCents,
    taxCents,
    vendorKey
  });

  // Extract all candidates
  const candidates = extractAmountCandidates(text);

  if (candidates.length === 0) {
    return {
      totalCents: null,
      confidence: 0,
      source: 'arbitration_no_candidates',
      trace: ['no_amount_candidates_found'],
      shouldOverride: false
    };
  }

  // Find max value for context
  const maxValueCents = Math.max(...candidates.map(c => c.valueCents));

  // Score all candidates
  const context = {
    totalLines,
    bottomWindowStart,
    maxValueCents,
    lineItemSum,
    subtotalCents,
    taxCents,
    pageBreaks,
    totalPages,
    vendorKey,
    allLines: lines
  };

  const scored = candidates.map(c => {
    const { score, reasons } = scoreCandidate(c, context);
    return { ...c, score, reasons };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Build trace (top 20 candidates)
  for (const c of scored.slice(0, 20)) {
    trace.push({
      lineIndex: c.lineIndex,
      valueCents: c.valueCents,
      score: c.score,
      reasons: c.reasons,
      line: c.line.substring(0, 120)
    });
  }

  // Get best candidate
  const best = scored[0];
  const secondBest = scored[1];

  // Check if best is still a subtotal/group total (should have been penalized to negative)
  if (best.score < 0) {
    return {
      totalCents: null,
      confidence: 0,
      source: 'arbitration_all_rejected',
      trace,
      shouldOverride: false
    };
  }

  // Calculate confidence based on score AND margin over second-best
  const margin = secondBest ? best.score - secondBest.score : best.score;
  const baseConfidence = Math.min(100, Math.max(0, best.score));
  const marginBonus = Math.min(20, margin / 2);
  const confidence = Math.min(100, baseConfidence + marginBonus);

  // Validate math if possible
  const mathValidation = validateTotalMath(best.valueCents, subtotalCents, taxCents);

  // Determine if we should override the parser's total
  let shouldOverride = false;
  let overrideReason = null;

  if (!parserTotal) {
    shouldOverride = true;
    overrideReason = 'parser_total_missing';
  } else if (Math.abs(best.valueCents - parserTotal) >= 50) {
    // Differs by at least $0.50
    shouldOverride = true;
    overrideReason = `differs_by_${Math.abs(best.valueCents - parserTotal)}_cents`;
  }

  // Don't override if our confidence is low and parser had something
  if (shouldOverride && confidence < 40 && parserTotal > 0) {
    shouldOverride = false;
    overrideReason = 'low_confidence_keeping_parser';
  }

  // Don't override if math validation fails and parser passed
  if (shouldOverride && !mathValidation.valid && parserTotal > 0) {
    // Check if parser total validates
    const parserMathValid = validateTotalMath(parserTotal, subtotalCents, taxCents);
    if (parserMathValid.valid) {
      shouldOverride = false;
      overrideReason = 'parser_math_valid_arbitration_not';
    }
  }

  return {
    totalCents: best.valueCents,
    confidence: Math.round(confidence),
    source: 'arbitration_full_document',
    lineIndex: best.lineIndex,
    lineText: best.line,
    score: best.score,
    reasons: best.reasons,
    margin,
    mathValidation,
    trace,
    parserTotal,
    shouldOverride,
    overrideReason,
    metadata: {
      totalPages,
      subtotalCents,
      taxCents,
      candidatesAnalyzed: candidates.length
    }
  };
}

/**
 * Validate that total = subtotal + tax (within tolerance)
 */
function validateTotalMath(totalCents, subtotalCents, taxCents) {
  if (!subtotalCents) {
    return { valid: null, reason: 'no_subtotal_found' };
  }

  const expectedTotal = subtotalCents + (taxCents || 0);
  const tolerance = 10; // $0.10 tolerance for rounding

  if (Math.abs(totalCents - expectedTotal) <= tolerance) {
    return {
      valid: true,
      reason: 'math_matches',
      expected: expectedTotal,
      actual: totalCents,
      difference: totalCents - expectedTotal
    };
  }

  // Allow if total is greater (might include additional fees)
  if (totalCents > expectedTotal && totalCents < expectedTotal * 1.1) {
    return {
      valid: true,
      reason: 'total_slightly_higher_likely_fees',
      expected: expectedTotal,
      actual: totalCents,
      difference: totalCents - expectedTotal
    };
  }

  return {
    valid: false,
    reason: 'math_mismatch',
    expected: expectedTotal,
    actual: totalCents,
    difference: totalCents - expectedTotal
  };
}

/**
 * Run arbitration and potentially override parser result
 *
 * @param {Object} parseResult - Result from vendor parser
 * @param {string} rawText - Full invoice text
 * @returns {Object} Enhanced parse result with arbitration info
 */
function arbitrateTotals(parseResult, rawText) {
  const parserTotal = parseResult.totals?.totalCents || 0;
  const lineItemSum = (parseResult.lineItems || []).reduce(
    (sum, item) => sum + (item.lineTotalCents || 0),
    0
  );
  const vendorKey = parseResult.vendorKey || parseResult.vendor || null;

  const arbitration = findBestTotal(rawText, {
    parserTotal,
    lineItemSum,
    vendorKey
  });

  // Create enhanced result
  const enhanced = { ...parseResult };

  // Add arbitration info
  enhanced.arbitration = {
    ran: true,
    foundTotal: arbitration.totalCents,
    confidence: arbitration.confidence,
    source: arbitration.source,
    parserTotal,
    shouldOverride: arbitration.shouldOverride,
    overrideReason: arbitration.overrideReason,
    mathValidation: arbitration.mathValidation,
    metadata: arbitration.metadata,
    trace: arbitration.trace?.slice(0, 10) // Keep trace small in result
  };

  // Override if arbitration found a better total
  if (arbitration.shouldOverride && arbitration.totalCents) {
    console.log(`[ARBITRATION] Overriding parser total: $${(parserTotal/100).toFixed(2)} -> $${(arbitration.totalCents/100).toFixed(2)} (reason: ${arbitration.overrideReason}, confidence: ${arbitration.confidence}%)`);

    enhanced.totals = {
      ...enhanced.totals,
      totalCents: arbitration.totalCents,
      totalOriginal: parserTotal,
      totalSource: arbitration.source,
      totalArbitrated: true,
      arbitrationConfidence: arbitration.confidence
    };
  }

  return enhanced;
}

/**
 * Quick check if a line looks like a grand total line
 */
function isLikelyGrandTotal(line) {
  const L = (line || '').toUpperCase();

  // Positive indicators
  const hasGrandTotalLabel = /\b(INVOICE\s*TOTAL|GRAND\s*TOTAL|AMOUNT\s*DUE|BALANCE\s*DUE|TOTAL\s*DUE|TOTAL\s*USD)\b/.test(L);

  // Negative indicators
  const hasSubtotalLabel = /\b(SUBTOTAL|GROUP\s*TOTAL|DEPT\s*TOTAL|SECTION\s*TOTAL|CATEGORY\s*TOTAL|EMPLOYEE)\b/.test(L);

  return hasGrandTotalLabel && !hasSubtotalLabel;
}

/**
 * Quick check if a line looks like a subtotal line
 */
function isLikelySubtotal(line) {
  const L = (line || '').toUpperCase();
  return /\b(SUBTOTAL|GROUP\s*TOTAL|DEPT\s*TOTAL|DEPARTMENT\s*TOTAL|SECTION\s*TOTAL|CATEGORY\s*TOTAL|EMPLOYEE.*SUBTOTAL)\b/.test(L);
}

module.exports = {
  findBestTotal,
  arbitrateTotals,
  isLikelyGrandTotal,
  isLikelySubtotal,
  extractAmountCandidates,
  extractTaxAndSubtotal,
  scoreCandidate,
  normalizeText,
  validateTotalMath,
  detectPageBreaks,
  SCORING_CONFIG,
  VENDOR_PATTERNS
};
