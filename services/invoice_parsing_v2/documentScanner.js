/**
 * Document Scanner Guardrails
 *
 * Ensures parsers scan the ENTIRE document, not just the first section.
 * This prevents data loss when invoices have multiple item sections
 * separated by subtotals.
 *
 * Problem solved:
 * ---------------
 * Many invoices have patterns like:
 *   Items Section 1
 *   SUBTOTAL $30
 *   Items Section 2  <- These items were being MISSED
 *   INVOICE TOTAL $50
 *
 * The guardrails detect when parsing stopped early and trigger
 * extended scanning to capture all data.
 */

/**
 * Check if a parse result indicates the full document was scanned
 * @param {Object} parseResult - Result from any parser
 * @param {string} rawText - Original invoice text
 * @returns {Object} - { fullyScan: boolean, scanCompleteness: number, warnings: [] }
 */
function checkScanCompleteness(parseResult, rawText) {
  const lines = rawText.split('\n');
  const totalLines = lines.length;
  const warnings = [];

  // Get scan info from result if available
  const scanInfo = parseResult.scanInfo || parseResult.debug?.scanInfo;

  let lastParsedLine = 0;
  if (scanInfo) {
    lastParsedLine = scanInfo.lastParsedLineIndex || 0;
  } else if (parseResult.debug) {
    // Estimate from debug info
    lastParsedLine = parseResult.debug.rawLineCount || totalLines;
  } else {
    // Assume full scan if no tracking info
    lastParsedLine = totalLines;
  }

  const scanCompleteness = Math.round((lastParsedLine / totalLines) * 100);
  const fullyScan = scanCompleteness >= 70; // 70% threshold

  if (!fullyScan) {
    warnings.push(`[GUARDRAIL] Only scanned ${scanCompleteness}% of document (${lastParsedLine}/${totalLines} lines)`);
    warnings.push(`[GUARDRAIL] May have missed items after line ${lastParsedLine}`);
  }

  // Check if we found multiple totals (suggests multi-section invoice)
  const foundTotals = scanInfo?.foundTotals || [];
  const foundSubtotals = scanInfo?.foundSubtotals || [];

  if (foundSubtotals.length > 1) {
    warnings.push(`[GUARDRAIL] Found ${foundSubtotals.length} subtotals - multi-section invoice detected`);
  }

  return {
    fullyScan,
    scanCompleteness,
    lastParsedLine,
    totalLines,
    foundTotals,
    foundSubtotals,
    warnings
  };
}

/**
 * Extract monetary value from a line of text
 * @param {string} line - Line to extract from
 * @returns {number} - Value in cents, or 0 if not found
 */
function extractMoneyCents(line) {
  // Match patterns like: $1,234.56 or 1234.56 or 1,234
  const match = line.match(/\$?([\d,]+\.?\d*)/);
  if (match) {
    const value = parseFloat(match[1].replace(/,/g, ''));
    if (!isNaN(value) && value > 0) {
      // Convert to cents if it looks like dollars
      return value < 1000000 ? Math.round(value * 100) : Math.round(value);
    }
  }
  return 0;
}

/**
 * Scan remaining document for missed items
 * This is called when we detect the parser stopped early
 *
 * @param {string} rawText - Original invoice text
 * @param {Object} parseResult - Result from initial parse
 * @param {number} startLine - Line to start scanning from
 * @returns {Object} - Extended items and totals found
 */
function extendScan(rawText, parseResult, startLine) {
  const lines = rawText.split('\n');
  const extendedItems = [];
  const extendedTotals = [];

  console.log(`[GUARDRAIL] Extending scan from line ${startLine} to ${lines.length}`);

  // Simple line item pattern: description + price(s)
  // Format: text $XX.XX or text XX.XX
  const itemPattern = /^(.{10,50})\s+\$?([\d,]+\.\d{2})\s*(?:\$?([\d,]+\.\d{2}))?$/;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length < 5) continue;

    // Check for total lines
    if (/^(INVOICE\s+)?TOTAL/i.test(line)) {
      const value = extractMoneyCents(line);
      if (value > 0) {
        extendedTotals.push({
          line: i,
          label: line.split(/\s+/)[0],
          valueCents: value,
          raw: line
        });
      }
      continue;
    }

    // Check for item lines (has price pattern)
    const priceMatch = line.match(/\d+\.\d{2}/g);
    if (priceMatch && priceMatch.length >= 1) {
      // Has at least one price - might be an item
      const description = line.replace(/\$?[\d,]+\.\d{2}/g, '').trim();

      if (description.length > 5) {
        const prices = priceMatch.map(p => parseFloat(p));
        const lineTotal = prices[prices.length - 1]; // Last price is usually total
        const unitPrice = prices.length > 1 ? prices[prices.length - 2] : lineTotal;

        extendedItems.push({
          description,
          qty: 1,
          unitPriceCents: Math.round(unitPrice * 100),
          lineTotalCents: Math.round(lineTotal * 100),
          raw: line,
          lineNumber: i,
          source: 'extended_scan'
        });
      }
    }
  }

  console.log(`[GUARDRAIL] Extended scan found ${extendedItems.length} additional items, ${extendedTotals.length} totals`);

  return {
    extendedItems,
    extendedTotals,
    scannedFrom: startLine,
    scannedTo: lines.length
  };
}

/**
 * Main guardrail function - ensures full document was scanned
 * and extends the parse if needed
 *
 * @param {string} rawText - Original invoice text
 * @param {Object} parseResult - Result from parser
 * @returns {Object} - Enhanced parse result with any additional items
 */
function ensureFullDocumentScan(rawText, parseResult) {
  const scanCheck = checkScanCompleteness(parseResult, rawText);

  // Log any warnings
  for (const warning of scanCheck.warnings) {
    console.warn(warning);
  }

  // If full document was scanned, return as-is with guardrail info
  if (scanCheck.fullyScan) {
    return {
      ...parseResult,
      guardrail: {
        applied: false,
        scanCompleteness: scanCheck.scanCompleteness,
        message: 'Full document scanned'
      }
    };
  }

  // Document wasn't fully scanned - extend the scan
  const extended = extendScan(rawText, parseResult, scanCheck.lastParsedLine);

  // Merge extended items with existing items
  const existingItems = parseResult.lineItems || parseResult.items || [];
  const mergedItems = [...existingItems, ...extended.extendedItems];

  // Use extended total if it's larger than what we found
  let bestTotal = parseResult.totals?.totalCents || 0;
  for (const extTotal of extended.extendedTotals) {
    if (extTotal.valueCents > bestTotal) {
      bestTotal = extTotal.valueCents;
    }
  }

  // Update totals if we found a better one
  const updatedTotals = {
    ...parseResult.totals,
    totalCents: bestTotal
  };

  // Return enhanced result
  return {
    ...parseResult,
    lineItems: mergedItems,
    totals: updatedTotals,
    guardrail: {
      applied: true,
      scanCompleteness: scanCheck.scanCompleteness,
      extendedFrom: scanCheck.lastParsedLine,
      additionalItemsFound: extended.extendedItems.length,
      additionalTotalsFound: extended.extendedTotals.length,
      message: `Extended scan: added ${extended.extendedItems.length} items from remaining ${scanCheck.totalLines - scanCheck.lastParsedLine} lines`
    }
  };
}

/**
 * Validate that a parse result captured the true invoice total
 * Uses multiple strategies to find the correct total
 *
 * @param {Object} parseResult - Result from parser
 * @param {string} rawText - Original invoice text
 * @returns {Object} - Validated totals
 */
function validateInvoiceTotal(parseResult, rawText) {
  const lines = rawText.split('\n');
  const candidateTotals = [];

  // Strategy 1: Look for explicit INVOICE TOTAL
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/INVOICE\s+TOTAL/i.test(line)) {
      const value = extractMoneyCents(line);
      if (value > 0) {
        candidateTotals.push({
          source: 'INVOICE_TOTAL_LABEL',
          line: i,
          valueCents: value,
          confidence: 95
        });
      }
    }
  }

  // Strategy 2: Look for TOTAL USD or AMOUNT DUE
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/TOTAL\s+USD|AMOUNT\s+DUE|BALANCE\s+DUE/i.test(line)) {
      const value = extractMoneyCents(line);
      if (value > 0) {
        candidateTotals.push({
          source: 'TOTAL_USD_LABEL',
          line: i,
          valueCents: value,
          confidence: 90
        });
      }
    }
  }

  // Strategy 3: Find the largest "TOTAL" that isn't a GROUP/DEPT total
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^TOTAL\s/i.test(line) && !/GROUP|DEPT|CATEGORY|SECTION|EMPLOYEE/i.test(line)) {
      const value = extractMoneyCents(line);
      if (value > 0) {
        candidateTotals.push({
          source: 'TOTAL_GENERIC',
          line: i,
          valueCents: value,
          confidence: 70
        });
      }
    }
  }

  // Sort by confidence, then by value (larger values are more likely to be invoice total)
  candidateTotals.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.valueCents - a.valueCents;
  });

  const currentTotal = parseResult.totals?.totalCents || 0;
  const bestCandidate = candidateTotals[0];

  // If we found a better total, use it
  if (bestCandidate && bestCandidate.valueCents > currentTotal) {
    console.log(`[GUARDRAIL] Found better invoice total: $${(bestCandidate.valueCents/100).toFixed(2)} (was $${(currentTotal/100).toFixed(2)})`);
    return {
      ...parseResult.totals,
      totalCents: bestCandidate.valueCents,
      totalSource: bestCandidate.source,
      totalLine: bestCandidate.line,
      candidatesFound: candidateTotals.length
    };
  }

  return parseResult.totals;
}

/**
 * Check if parse result needs human review based on guardrail findings
 *
 * @param {Object} parseResult - Result with guardrail data
 * @returns {Object} - { needsReview: boolean, reasons: [] }
 */
function checkNeedsReview(parseResult) {
  const reasons = [];

  // Check scan completeness
  if (parseResult.guardrail?.applied) {
    reasons.push(`Extended scan was needed (only ${parseResult.guardrail.scanCompleteness}% initially scanned)`);
  }

  // Check confidence
  const confidence = parseResult.confidence?.score || parseResult.confidence || 0;
  if (confidence < 70) {
    reasons.push(`Low confidence score: ${confidence}%`);
  }

  // Check for math validation issues
  const lineItems = parseResult.lineItems || [];
  const mathValidated = lineItems.filter(i => i.mathValidated).length;
  if (lineItems.length > 0 && mathValidated / lineItems.length < 0.5) {
    reasons.push(`Low math validation rate: ${mathValidated}/${lineItems.length} items`);
  }

  // Check for suspicious patterns
  if (parseResult.scanInfo?.foundSubtotals?.length > 2) {
    reasons.push(`Multiple subtotals found (${parseResult.scanInfo.foundSubtotals.length}) - complex invoice`);
  }

  return {
    needsReview: reasons.length > 0,
    reasons,
    severity: reasons.length >= 3 ? 'high' : reasons.length >= 1 ? 'medium' : 'low'
  };
}

module.exports = {
  checkScanCompleteness,
  extendScan,
  ensureFullDocumentScan,
  validateInvoiceTotal,
  checkNeedsReview,
  extractMoneyCents
};
