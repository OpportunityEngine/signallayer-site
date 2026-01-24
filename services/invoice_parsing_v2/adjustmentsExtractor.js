/**
 * Adjustments Extractor
 *
 * Extracts and normalizes invoice adjustments including:
 * - Tax (sales tax, VAT, GST)
 * - Fees (fuel surcharge, delivery fee, service charge)
 * - Discounts (promotional, volume, early payment)
 * - Credits (returns, refunds)
 * - Shipping/freight charges
 *
 * All amounts normalized to cents. Discounts/credits are negative.
 */

const { parseMoney, scanFromBottom } = require('./utils');

/**
 * Adjustment type definitions with patterns
 */
const ADJUSTMENT_TYPES = {
  tax: {
    patterns: [
      { regex: /SALES\s*TAX[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'Sales Tax' },
      { regex: /STATE\s*TAX[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'State Tax' },
      { regex: /LOCAL\s*TAX[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'Local Tax' },
      { regex: /COUNTY\s*TAX[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'County Tax' },
      { regex: /(?:^|\s)TAX[:\s]*\$?([\d,]+\.?\d*)(?:\s|$)/gim, label: 'Tax' },
      { regex: /VAT[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'VAT' },
      { regex: /GST[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'GST' },
      { regex: /HST[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'HST' },
    ],
    sign: 1, // Positive (adds to total)
    category: 'tax'
  },

  fee: {
    patterns: [
      { regex: /FUEL\s*(?:SUR)?CHARGE[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'Fuel Surcharge' },
      { regex: /DELIVERY\s*(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'Delivery Fee' },
      { regex: /SERVICE\s*(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'Service Fee' },
      { regex: /HANDLING\s*(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'Handling Fee' },
      { regex: /PROCESSING\s*FEE[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'Processing Fee' },
      { regex: /ENVIRONMENTAL\s*(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'Environmental Fee' },
      { regex: /RESTOCKING\s*FEE[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'Restocking Fee' },
      { regex: /LATE\s*FEE[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'Late Fee' },
      { regex: /RUSH\s*(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'Rush Fee' },
    ],
    sign: 1,
    category: 'fee'
  },

  shipping: {
    patterns: [
      { regex: /SHIPPING[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'Shipping' },
      { regex: /FREIGHT[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'Freight' },
      { regex: /S\s*&\s*H[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'Shipping & Handling' },
      { regex: /SHIPPING\s*(?:&|AND)\s*HANDLING[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'Shipping & Handling' },
      { regex: /POSTAGE[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'Postage' },
    ],
    sign: 1,
    category: 'shipping'
  },

  discount: {
    patterns: [
      { regex: /DISCOUNT[:\s]*[-]?\$?([\d,]+\.?\d*)/gi, label: 'Discount' },
      { regex: /PROMO(?:TIONAL)?\s*(?:CODE|DISCOUNT)?[:\s]*[-]?\$?([\d,]+\.?\d*)/gi, label: 'Promotional Discount' },
      { regex: /VOLUME\s*DISCOUNT[:\s]*[-]?\$?([\d,]+\.?\d*)/gi, label: 'Volume Discount' },
      { regex: /EARLY\s*PAY(?:MENT)?\s*DISCOUNT[:\s]*[-]?\$?([\d,]+\.?\d*)/gi, label: 'Early Payment Discount' },
      { regex: /TRADE\s*DISCOUNT[:\s]*[-]?\$?([\d,]+\.?\d*)/gi, label: 'Trade Discount' },
      { regex: /LOYALTY\s*DISCOUNT[:\s]*[-]?\$?([\d,]+\.?\d*)/gi, label: 'Loyalty Discount' },
      { regex: /COUPON[:\s]*[-]?\$?([\d,]+\.?\d*)/gi, label: 'Coupon' },
      { regex: /SAVINGS[:\s]*[-]?\$?([\d,]+\.?\d*)/gi, label: 'Savings' },
    ],
    sign: -1, // Negative (reduces total)
    category: 'discount'
  },

  credit: {
    patterns: [
      { regex: /CREDIT[:\s]*[-]?\$?([\d,]+\.?\d*)/gi, label: 'Credit' },
      { regex: /RETURN(?:S)?\s*CREDIT[:\s]*[-]?\$?([\d,]+\.?\d*)/gi, label: 'Return Credit' },
      { regex: /REFUND[:\s]*[-]?\$?([\d,]+\.?\d*)/gi, label: 'Refund' },
      { regex: /ADJUSTMENT[:\s]*[-]?\$?([\d,]+\.?\d*)/gi, label: 'Adjustment' },
      { regex: /ALLOWANCE[:\s]*[-]?\$?([\d,]+\.?\d*)/gi, label: 'Allowance' },
      { regex: /REBATE[:\s]*[-]?\$?([\d,]+\.?\d*)/gi, label: 'Rebate' },
    ],
    sign: -1, // Negative (reduces total)
    category: 'credit'
  },

  deposit: {
    patterns: [
      { regex: /DEPOSIT[:\s]*[-]?\$?([\d,]+\.?\d*)/gi, label: 'Deposit' },
      { regex: /PREPAID[:\s]*[-]?\$?([\d,]+\.?\d*)/gi, label: 'Prepaid' },
      { regex: /ADVANCE\s*PAYMENT[:\s]*[-]?\$?([\d,]+\.?\d*)/gi, label: 'Advance Payment' },
    ],
    sign: -1, // Typically reduces amount due
    category: 'deposit'
  }
};

/**
 * Extract all adjustments from text
 * @param {string} text - Invoice text
 * @param {Object} layoutHints - Optional layout hints
 * @returns {Object} - { adjustments: [], summary: {}, debug: {} }
 */
function extractAdjustments(text, layoutHints = {}) {
  const lines = text.split('\n');
  const adjustments = [];
  const seen = new Set();

  // Focus on bottom portion for adjustments (usually near totals)
  const searchText = layoutHints.totalsSection
    ? lines.slice(Math.max(0, layoutHints.totalsSection.startLine - 10)).join('\n')
    : text;

  // Process each adjustment type
  for (const [type, config] of Object.entries(ADJUSTMENT_TYPES)) {
    for (const patternDef of config.patterns) {
      const regex = new RegExp(patternDef.regex.source, patternDef.regex.flags);
      let match;

      while ((match = regex.exec(searchText)) !== null) {
        const rawValue = match[1];
        let valueCents = parseMoney(rawValue);

        if (valueCents <= 0) continue;

        // Check if the line contains a negative indicator
        const matchLine = match[0];
        const hasNegativeIndicator = /[-−]\s*\$|CR\b|CREDIT|LESS|MINUS/i.test(matchLine);

        // Apply sign based on type and negative indicators
        if (config.sign === -1 || hasNegativeIndicator) {
          valueCents = -Math.abs(valueCents);
        }

        // Create unique key for deduplication
        const key = `${type}-${Math.abs(valueCents)}-${patternDef.label}`;

        if (!seen.has(key)) {
          seen.add(key);

          // Find the line number
          let lineNumber = -1;
          const matchIndex = searchText.indexOf(match[0]);
          let charCount = 0;
          const searchLines = searchText.split('\n');
          for (let i = 0; i < searchLines.length; i++) {
            charCount += searchLines[i].length + 1;
            if (charCount > matchIndex) {
              lineNumber = i;
              break;
            }
          }

          adjustments.push({
            type: config.category,
            label: patternDef.label,
            amountCents: valueCents,
            rawValue: match[0].trim(),
            lineNumber,
            isNegative: valueCents < 0,
            evidence: {
              pattern: patternDef.regex.source,
              fullMatch: match[0].trim().slice(0, 80)
            }
          });
        }
      }
    }
  }

  // Calculate summary
  const summary = calculateAdjustmentsSummary(adjustments);

  return {
    adjustments,
    summary,
    debug: {
      totalAdjustmentsFound: adjustments.length,
      byType: groupByType(adjustments)
    }
  };
}

/**
 * Calculate summary of adjustments
 * @param {Array} adjustments
 * @returns {Object}
 */
function calculateAdjustmentsSummary(adjustments) {
  const summary = {
    taxCents: 0,
    feesCents: 0,
    shippingCents: 0,
    discountsCents: 0,
    creditsCents: 0,
    depositsCents: 0,
    totalPositiveCents: 0,
    totalNegativeCents: 0,
    netAdjustmentsCents: 0
  };

  for (const adj of adjustments) {
    switch (adj.type) {
      case 'tax':
        summary.taxCents += adj.amountCents;
        break;
      case 'fee':
        summary.feesCents += adj.amountCents;
        break;
      case 'shipping':
        summary.shippingCents += adj.amountCents;
        break;
      case 'discount':
        summary.discountsCents += adj.amountCents; // Already negative
        break;
      case 'credit':
        summary.creditsCents += adj.amountCents; // Already negative
        break;
      case 'deposit':
        summary.depositsCents += adj.amountCents; // Already negative
        break;
    }

    if (adj.amountCents > 0) {
      summary.totalPositiveCents += adj.amountCents;
    } else {
      summary.totalNegativeCents += adj.amountCents;
    }
  }

  summary.netAdjustmentsCents = summary.totalPositiveCents + summary.totalNegativeCents;

  return summary;
}

/**
 * Group adjustments by type
 * @param {Array} adjustments
 * @returns {Object}
 */
function groupByType(adjustments) {
  const grouped = {};
  for (const adj of adjustments) {
    if (!grouped[adj.type]) {
      grouped[adj.type] = [];
    }
    grouped[adj.type].push(adj);
  }
  return grouped;
}

/**
 * Extract tax specifically (common operation)
 * @param {string} text
 * @returns {Object} - { taxCents, taxItems, confidence }
 */
function extractTax(text) {
  const result = extractAdjustments(text);
  const taxItems = result.adjustments.filter(a => a.type === 'tax');

  // If multiple tax items, sum them
  const taxCents = taxItems.reduce((sum, t) => sum + t.amountCents, 0);

  return {
    taxCents,
    taxItems,
    confidence: taxItems.length > 0 ? 90 : 0
  };
}

/**
 * Validate adjustments make sense
 * @param {Array} adjustments
 * @param {number} subtotalCents
 * @param {number} totalCents
 * @returns {Object}
 */
function validateAdjustments(adjustments, subtotalCents, totalCents) {
  const summary = calculateAdjustmentsSummary(adjustments);
  const computedTotal = subtotalCents + summary.netAdjustmentsCents;
  const diff = Math.abs(computedTotal - totalCents);

  const issues = [];
  const warnings = [];

  // Check if adjustments explain the difference
  if (diff > 10) {
    if (diff / totalCents > 0.05) {
      issues.push(`Large discrepancy: computed ${computedTotal} vs printed ${totalCents}`);
    } else {
      warnings.push(`Small discrepancy of ${diff} cents`);
    }
  }

  // Check for suspicious values
  if (summary.taxCents > subtotalCents * 0.15) {
    warnings.push('Tax seems unusually high (>15% of subtotal)');
  }

  if (Math.abs(summary.discountsCents) > subtotalCents * 0.5) {
    warnings.push('Discount seems unusually high (>50% of subtotal)');
  }

  return {
    isValid: issues.length === 0,
    computedTotal,
    printedTotal: totalCents,
    difference: diff,
    issues,
    warnings,
    breakdown: {
      subtotal: subtotalCents,
      adjustments: summary.netAdjustmentsCents,
      computed: computedTotal,
      printed: totalCents
    }
  };
}

/**
 * Normalize adjustments for storage
 * @param {Array} adjustments
 * @returns {Array}
 */
function normalizeForStorage(adjustments) {
  return adjustments.map(adj => ({
    type: adj.type,
    label: adj.label,
    amountCents: adj.amountCents,
    isCredit: adj.amountCents < 0
  }));
}

module.exports = {
  extractAdjustments,
  calculateAdjustmentsSummary,
  extractTax,
  validateAdjustments,
  normalizeForStorage,
  groupByType,
  ADJUSTMENT_TYPES
};
