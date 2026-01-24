/**
 * Totals Candidate Ranking
 *
 * Extracts and ranks potential invoice totals with confidence scoring.
 * Returns top N candidates with evidence, allowing the validator to
 * pick the best match based on reconciliation.
 *
 * Features:
 * - End-of-document position bias
 * - Label classification (INVOICE TOTAL > AMOUNT DUE > TOTAL > SUBTOTAL)
 * - GROUP TOTAL / CATEGORY TOTAL demotion
 * - Duplicate detection and deduplication
 */

const { parseMoney } = require('./utils');

/**
 * Label priority rankings (higher = more likely to be the real total)
 */
const LABEL_PRIORITIES = {
  // Highest priority - explicit invoice totals
  'INVOICE TOTAL': 100,
  'INVOICE_TOTAL': 100,
  'GRAND TOTAL': 95,
  'GRAND_TOTAL': 95,
  'AMOUNT DUE': 90,
  'AMOUNT_DUE': 90,
  'BALANCE DUE': 90,
  'BALANCE_DUE': 90,
  'TOTAL DUE': 88,
  'TOTAL_DUE': 88,
  'TOTAL AMOUNT': 85,
  'TOTAL_AMOUNT': 85,
  'NET TOTAL': 80,
  'NET_TOTAL': 80,

  // Medium priority - generic totals
  'TOTAL': 70,
  'TOTAL USD': 70,
  'TOTAL:': 70,

  // Lower priority - subtotals (not the final amount)
  'SUBTOTAL': 40,
  'SUB TOTAL': 40,
  'SUB-TOTAL': 40,
  'MERCHANDISE TOTAL': 45,

  // Lowest priority - group/section totals (definitely not invoice total)
  'GROUP TOTAL': 10,
  'GROUP_TOTAL': 10,
  'CATEGORY TOTAL': 10,
  'SECTION TOTAL': 10,
  'DEPT TOTAL': 10,
  'DEPARTMENT TOTAL': 10,

  // Default for unknown labels
  'DEFAULT': 50
};

/**
 * Patterns to identify totals in text
 */
const TOTAL_PATTERNS = [
  // Explicit invoice totals (highest priority)
  { regex: /INVOICE\s*TOTAL[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'INVOICE TOTAL', priority: 100 },
  { regex: /GRAND\s*TOTAL[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'GRAND TOTAL', priority: 95 },
  { regex: /AMOUNT\s*DUE[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'AMOUNT DUE', priority: 90 },
  { regex: /BALANCE\s*DUE[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'BALANCE DUE', priority: 90 },
  { regex: /TOTAL\s*DUE[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'TOTAL DUE', priority: 88 },
  { regex: /TOTAL\s*AMOUNT[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'TOTAL AMOUNT', priority: 85 },
  { regex: /NET\s*TOTAL[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'NET TOTAL', priority: 80 },

  // Generic totals (medium priority)
  { regex: /(?:^|\s)TOTAL\s*(?:USD)?[:\s]*\$?([\d,]+\.?\d*)(?:\s|$)/gim, label: 'TOTAL', priority: 70 },

  // Subtotals (lower priority - useful but not the final amount)
  { regex: /SUB[-\s]?TOTAL[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'SUBTOTAL', priority: 40 },
  { regex: /MERCHANDISE\s*TOTAL[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'MERCHANDISE TOTAL', priority: 45 },

  // Group/section totals (lowest priority - should be filtered out)
  { regex: /GROUP\s*TOTAL[*:\s]*\$?([\d,]+\.?\d*)/gi, label: 'GROUP TOTAL', priority: 10, isGroupTotal: true },
  { regex: /CATEGORY\s*TOTAL[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'CATEGORY TOTAL', priority: 10, isGroupTotal: true },
  { regex: /DEPT(?:ARTMENT)?\s*TOTAL[:\s]*\$?([\d,]+\.?\d*)/gi, label: 'DEPARTMENT TOTAL', priority: 10, isGroupTotal: true },
];

/**
 * Extract all total candidates from text with scoring
 * @param {string} text - Invoice text
 * @param {Object} layoutHints - Optional layout hints from layoutAnalyzer
 * @returns {Object} - { candidates: [], bestCandidate: null, debug: {} }
 */
function extractTotalCandidates(text, layoutHints = {}) {
  const lines = text.split('\n');
  const totalLines = lines.length;
  const candidates = [];
  const seen = new Set(); // Track seen values to avoid duplicates

  // FIRST: Look for multi-line totals (label on one line, value on next)
  // Critical for Sysco invoices where PDF extraction splits label and value
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    const nextLine = lines[i + 1].trim();

    // Skip if this looks like a group total
    if (/GROUP|CATEGORY|DEPT|SECTION/i.test(line)) continue;

    // Check for "INVOICE TOTAL" or "TOTAL" on its own line
    const isInvoiceTotal = /^INVOICE\s+TOTAL\s*$/i.test(line);
    const isPlainTotal = /^TOTAL\s*$/i.test(line);

    if (isInvoiceTotal || isPlainTotal) {
      // Next line should be just a money value
      const moneyMatch = nextLine.match(/^\s*\$?([\d,]+\.?\d{2})\s*$/);
      if (moneyMatch) {
        const valueCents = parseMoney(moneyMatch[1]);
        if (valueCents > 0 && valueCents < 100000000) {
          const positionScore = Math.round((i / totalLines) * 100);
          const priority = isInvoiceTotal ? 100 : 70;  // INVOICE TOTAL = highest
          let score = priority + (positionScore >= 66 ? 20 : positionScore >= 33 ? 10 : 0);

          const key = `${valueCents}-MULTI_LINE_TOTAL`;
          if (!seen.has(key)) {
            seen.add(key);
            candidates.push({
              label: isInvoiceTotal ? 'INVOICE TOTAL (multi-line)' : 'TOTAL (multi-line)',
              valueCents,
              rawValue: `${line} | ${nextLine}`,
              lineNumber: i,
              positionScore,
              score: Math.max(0, Math.min(120, score)),  // Allow higher score for multi-line
              isGroupTotal: false,
              evidence: {
                pattern: 'MULTI_LINE',
                lineText: `${line} → ${nextLine}`,
                positionPct: positionScore
              }
            });
            console.log(`[TOTALS CANDIDATES] Found multi-line: "${line}" + "${nextLine}" = $${(valueCents/100).toFixed(2)} (score: ${score})`);
          }
        }
      }
    }
  }

  // Process each pattern (same-line patterns)
  for (const patternDef of TOTAL_PATTERNS) {
    const regex = new RegExp(patternDef.regex.source, patternDef.regex.flags);
    let match;

    while ((match = regex.exec(text)) !== null) {
      const rawValue = match[1];
      const valueCents = parseMoney(rawValue);

      if (valueCents <= 0) continue;

      // Find line number for position scoring
      const matchIndex = match.index;
      let lineNumber = 0;
      let charCount = 0;
      for (let i = 0; i < lines.length; i++) {
        charCount += lines[i].length + 1; // +1 for newline
        if (charCount > matchIndex) {
          lineNumber = i;
          break;
        }
      }

      // Calculate position score (0-100, higher = closer to end)
      const positionScore = Math.round((lineNumber / totalLines) * 100);

      // Check if this is in a group total context
      const lineText = lines[lineNumber] || '';
      const isGroupContext = /GROUP|CATEGORY|DEPT|SECTION/i.test(lineText);

      // Calculate final score
      let score = patternDef.priority;

      // Position bias: +20 for bottom third, +10 for middle third
      if (positionScore >= 66) {
        score += 20;
      } else if (positionScore >= 33) {
        score += 10;
      }

      // Penalty for group context
      if (isGroupContext || patternDef.isGroupTotal) {
        score -= 40;
      }

      // Bonus if layoutHints indicates this is in totals section
      if (layoutHints.totalsSection) {
        const { startLine, endLine } = layoutHints.totalsSection;
        if (lineNumber >= startLine && lineNumber <= endLine) {
          score += 15;
        }
      }

      // Create unique key for deduplication
      const key = `${valueCents}-${patternDef.label}`;

      if (!seen.has(key)) {
        seen.add(key);
        candidates.push({
          label: patternDef.label,
          valueCents,
          rawValue: match[0].trim(),
          lineNumber,
          positionScore,
          score: Math.max(0, Math.min(100, score)),
          isGroupTotal: patternDef.isGroupTotal || isGroupContext,
          evidence: {
            pattern: patternDef.regex.source,
            lineText: lineText.trim().slice(0, 100),
            positionPct: positionScore
          }
        });
      }
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Filter out obvious group totals from top candidates
  const filteredCandidates = candidates.filter(c => !c.isGroupTotal || c.score > 50);

  // Get unique values (dedupe by value, keep highest scored)
  const uniqueByValue = [];
  const seenValues = new Set();
  for (const c of filteredCandidates) {
    if (!seenValues.has(c.valueCents)) {
      seenValues.add(c.valueCents);
      uniqueByValue.push(c);
    }
  }

  return {
    candidates: uniqueByValue.slice(0, 10), // Top 10 candidates
    allCandidates: candidates, // All found for debugging
    bestCandidate: uniqueByValue[0] || null,
    groupTotals: candidates.filter(c => c.isGroupTotal), // Separated for reference
    debug: {
      totalCandidatesFound: candidates.length,
      uniqueValuesFound: uniqueByValue.length,
      groupTotalsFiltered: candidates.filter(c => c.isGroupTotal).length
    }
  };
}

/**
 * Find the best total that reconciles with line items
 * @param {Array} candidates - Total candidates
 * @param {number} itemsSumCents - Sum of line items
 * @param {number} adjustmentsCents - Sum of adjustments (tax, fees, etc.)
 * @param {number} tolerancePct - Acceptable variance percentage (default 2%)
 * @returns {Object|null} - Best matching candidate or null
 */
function findReconcilableTotal(candidates, itemsSumCents, adjustmentsCents = 0, tolerancePct = 0.02) {
  if (!candidates || candidates.length === 0) return null;

  const expectedTotal = itemsSumCents + adjustmentsCents;

  for (const candidate of candidates) {
    const diff = Math.abs(candidate.valueCents - expectedTotal);
    const pct = expectedTotal > 0 ? diff / expectedTotal : 1;

    if (pct <= tolerancePct) {
      return {
        ...candidate,
        reconciliation: {
          itemsSumCents,
          adjustmentsCents,
          expectedTotal,
          actualTotal: candidate.valueCents,
          difference: diff,
          variancePct: pct * 100,
          isExactMatch: diff === 0
        }
      };
    }
  }

  // No exact match found, return best candidate with reconciliation info
  const best = candidates[0];
  if (best) {
    const diff = Math.abs(best.valueCents - expectedTotal);
    return {
      ...best,
      reconciliation: {
        itemsSumCents,
        adjustmentsCents,
        expectedTotal,
        actualTotal: best.valueCents,
        difference: diff,
        variancePct: expectedTotal > 0 ? (diff / expectedTotal) * 100 : 100,
        isExactMatch: false,
        warning: 'No candidate reconciles within tolerance'
      }
    };
  }

  return null;
}

/**
 * Get subtotal candidates (useful for comparison)
 * @param {Array} candidates - All candidates
 * @returns {Array} - Subtotal candidates only
 */
function getSubtotalCandidates(candidates) {
  return candidates.filter(c =>
    c.label.includes('SUBTOTAL') ||
    c.label.includes('SUB TOTAL') ||
    c.label.includes('MERCHANDISE')
  ).sort((a, b) => b.score - a.score);
}

/**
 * Validate that subtotal + adjustments = total
 * @param {number} subtotalCents
 * @param {number} adjustmentsCents
 * @param {number} totalCents
 * @param {number} toleranceCents
 * @returns {Object} - Validation result
 */
function validateTotalsEquation(subtotalCents, adjustmentsCents, totalCents, toleranceCents = 10) {
  const computed = subtotalCents + adjustmentsCents;
  const diff = Math.abs(computed - totalCents);

  return {
    isValid: diff <= toleranceCents,
    subtotalCents,
    adjustmentsCents,
    computedTotal: computed,
    printedTotal: totalCents,
    difference: diff,
    equation: `${subtotalCents} + ${adjustmentsCents} = ${computed} (printed: ${totalCents})`
  };
}

module.exports = {
  extractTotalCandidates,
  findReconcilableTotal,
  getSubtotalCandidates,
  validateTotalsEquation,
  LABEL_PRIORITIES,
  TOTAL_PATTERNS
};
