/**
 * Evidence Extractor
 *
 * Captures raw text evidence around key invoice findings for Proof Pack exports.
 * This provides the "audit trail" showing WHERE each data point was extracted from.
 *
 * Key evidence types:
 * 1. Total evidence - Lines around INVOICE TOTAL, AMOUNT DUE, etc.
 * 2. Price evidence - Lines showing unit prices and calculations
 * 3. Metadata evidence - Invoice number, date, vendor identification
 * 4. Line item evidence - Raw text showing each product line
 */

/**
 * Context window configuration
 */
const CONTEXT_CONFIG = {
  LINES_BEFORE: 2,      // Lines to capture before finding
  LINES_AFTER: 2,       // Lines to capture after finding
  MAX_LINE_LENGTH: 200, // Truncate long lines
  MAX_EVIDENCE_ITEMS: 50 // Max evidence items per category
};

/**
 * Extract evidence for invoice totals
 * Returns raw text lines showing where totals were found
 */
function extractTotalEvidence(text) {
  const lines = text.split('\n');
  const evidence = [];

  const totalPatterns = [
    { pattern: /\b(INVOICE\s*TOTAL|INV\s*TOTAL)\b/i, type: 'invoice_total', priority: 1 },
    { pattern: /\b(AMOUNT\s*DUE|AMT\s*DUE)\b/i, type: 'amount_due', priority: 2 },
    { pattern: /\b(BALANCE\s*DUE|BAL\s*DUE)\b/i, type: 'balance_due', priority: 3 },
    { pattern: /\b(GRAND\s*TOTAL)\b/i, type: 'grand_total', priority: 4 },
    { pattern: /\b(TOTAL\s*DUE)\b/i, type: 'total_due', priority: 5 },
    { pattern: /\bSUBTOTAL\b/i, type: 'subtotal', priority: 10 },
    { pattern: /\b(SALES\s*TAX|TAX\s*AMOUNT)\b/i, type: 'tax', priority: 11 }
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const { pattern, type, priority } of totalPatterns) {
      if (pattern.test(line)) {
        // Extract monetary value from this line
        const moneyMatch = line.match(/\$?\s*([\d,]+\.?\d{0,2})/);
        const valueCents = moneyMatch
          ? Math.round(parseFloat(moneyMatch[1].replace(/,/g, '')) * 100)
          : null;

        evidence.push({
          type,
          priority,
          lineIndex: i,
          lineNumber: i + 1,
          rawLine: truncateLine(line),
          valueCents,
          context: getContextLines(lines, i),
          confidence: calculateEvidenceConfidence(line, type)
        });
      }
    }
  }

  // Sort by priority (lower = better)
  evidence.sort((a, b) => a.priority - b.priority);

  return evidence.slice(0, CONTEXT_CONFIG.MAX_EVIDENCE_ITEMS);
}

/**
 * Extract evidence for invoice metadata (number, date, vendor)
 */
function extractMetadataEvidence(text) {
  const lines = text.split('\n');
  const evidence = {
    invoiceNumber: [],
    invoiceDate: [],
    vendor: [],
    customer: [],
    location: []
  };

  // Invoice number patterns
  const invoiceNumberPatterns = [
    /invoice\s*(?:#|no\.?|number)\s*:?\s*([A-Z0-9\-]+)/i,
    /inv\s*(?:#|no\.?)\s*:?\s*([A-Z0-9\-]+)/i,
    /invoice\s*([0-9]{6,})/i,
    /(?:^|\s)#\s*([0-9]{6,})/i
  ];

  // Invoice date patterns
  const datePatterns = [
    /invoice\s*date\s*:?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
    /date\s*:?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
    /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/,
    /([A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4})/i  // "January 15, 2025"
  ];

  // Location patterns (delivery address, ship-to)
  const locationPatterns = [
    /ship\s*to\s*:?\s*(.+)/i,
    /deliver\s*to\s*:?\s*(.+)/i,
    /location\s*:?\s*(.+)/i,
    /address\s*:?\s*(.+)/i
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const upperLine = line.toUpperCase();

    // Invoice numbers
    for (const pattern of invoiceNumberPatterns) {
      const match = line.match(pattern);
      if (match) {
        evidence.invoiceNumber.push({
          value: match[1],
          lineIndex: i,
          lineNumber: i + 1,
          rawLine: truncateLine(line),
          context: getContextLines(lines, i),
          pattern: pattern.source
        });
      }
    }

    // Invoice dates
    for (const pattern of datePatterns) {
      const match = line.match(pattern);
      if (match && /date|invoice/i.test(line)) {
        evidence.invoiceDate.push({
          value: match[1],
          lineIndex: i,
          lineNumber: i + 1,
          rawLine: truncateLine(line),
          context: getContextLines(lines, i),
          pattern: pattern.source
        });
      }
    }

    // Vendor identification (first few lines often contain vendor name)
    if (i < 10 && /^[A-Z][A-Z\s&,\.]+$/i.test(line.trim()) && line.trim().length > 3) {
      evidence.vendor.push({
        value: line.trim(),
        lineIndex: i,
        lineNumber: i + 1,
        rawLine: truncateLine(line),
        context: getContextLines(lines, i)
      });
    }

    // Location data
    for (const pattern of locationPatterns) {
      const match = line.match(pattern);
      if (match) {
        evidence.location.push({
          value: match[1].trim(),
          lineIndex: i,
          lineNumber: i + 1,
          rawLine: truncateLine(line),
          context: getContextLines(lines, i),
          pattern: pattern.source
        });
      }
    }

    // Customer/account
    if (/customer|account|sold\s*to|bill\s*to/i.test(line)) {
      evidence.customer.push({
        lineIndex: i,
        lineNumber: i + 1,
        rawLine: truncateLine(line),
        context: getContextLines(lines, i)
      });
    }
  }

  return evidence;
}

/**
 * Extract evidence for line items
 * Captures the raw text showing each product/service
 */
function extractLineItemEvidence(text, parsedLineItems = []) {
  const lines = text.split('\n');
  const evidence = [];

  // For each parsed line item, find its source line
  for (const item of parsedLineItems) {
    const itemEvidence = findLineItemSource(lines, item);
    if (itemEvidence) {
      evidence.push(itemEvidence);
    }
  }

  // Also capture any lines that look like line items but weren't parsed
  // (helps identify missed items)
  const lineItemPattern = /^.{10,80}\s+\d+\.?\d*\s+\$?\s*[\d,]+\.?\d{2}\s+\$?\s*[\d,]+\.?\d{2}/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (lineItemPattern.test(line)) {
      // Check if this line is already in evidence
      const alreadyCaptured = evidence.some(e => e.lineIndex === i);
      if (!alreadyCaptured) {
        evidence.push({
          type: 'potential_missed_item',
          lineIndex: i,
          lineNumber: i + 1,
          rawLine: truncateLine(line),
          context: getContextLines(lines, i),
          parsed: false
        });
      }
    }
  }

  return evidence.slice(0, CONTEXT_CONFIG.MAX_EVIDENCE_ITEMS);
}

/**
 * Find the source line for a parsed line item
 */
function findLineItemSource(lines, item) {
  const description = (item.description || '').trim();
  const sku = (item.sku || '').trim();
  const lineTotal = item.lineTotalCents || 0;

  // Try to find by SKU first (most reliable)
  if (sku) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(sku)) {
        return {
          type: 'line_item',
          lineIndex: i,
          lineNumber: i + 1,
          rawLine: truncateLine(lines[i]),
          context: getContextLines(lines, i),
          matchedBy: 'sku',
          parsedItem: {
            sku: item.sku,
            description: item.description,
            quantity: item.quantity || item.qty,
            unitPriceCents: item.unitPriceCents,
            lineTotalCents: item.lineTotalCents
          },
          parsed: true
        };
      }
    }
  }

  // Try to find by description
  if (description.length > 5) {
    const descWords = description.split(/\s+/).filter(w => w.length > 3);
    for (let i = 0; i < lines.length; i++) {
      const lineUpper = lines[i].toUpperCase();
      const matchCount = descWords.filter(w => lineUpper.includes(w.toUpperCase())).length;
      if (matchCount >= Math.min(3, descWords.length * 0.5)) {
        return {
          type: 'line_item',
          lineIndex: i,
          lineNumber: i + 1,
          rawLine: truncateLine(lines[i]),
          context: getContextLines(lines, i),
          matchedBy: 'description',
          parsedItem: {
            sku: item.sku,
            description: item.description,
            quantity: item.quantity || item.qty,
            unitPriceCents: item.unitPriceCents,
            lineTotalCents: item.lineTotalCents
          },
          parsed: true
        };
      }
    }
  }

  // Try to find by amount
  if (lineTotal > 0) {
    const formattedTotal = (lineTotal / 100).toFixed(2);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(formattedTotal)) {
        return {
          type: 'line_item',
          lineIndex: i,
          lineNumber: i + 1,
          rawLine: truncateLine(lines[i]),
          context: getContextLines(lines, i),
          matchedBy: 'amount',
          parsedItem: {
            sku: item.sku,
            description: item.description,
            quantity: item.quantity || item.qty,
            unitPriceCents: item.unitPriceCents,
            lineTotalCents: item.lineTotalCents
          },
          parsed: true
        };
      }
    }
  }

  return null;
}

/**
 * Extract price comparison evidence
 * Useful for showing price changes (requires historical data)
 */
function extractPriceEvidence(text, lineItems = [], priceHistory = {}) {
  const evidence = [];

  for (const item of lineItems) {
    const sku = item.sku;
    const currentPrice = item.unitPriceCents;

    if (sku && priceHistory[sku]) {
      const history = priceHistory[sku];
      const previousPrice = history.previousPrice;

      if (previousPrice && previousPrice !== currentPrice) {
        const delta = currentPrice - previousPrice;
        const percentChange = ((delta / previousPrice) * 100).toFixed(1);

        evidence.push({
          type: delta > 0 ? 'price_increase' : 'price_decrease',
          sku,
          description: item.description,
          currentPriceCents: currentPrice,
          previousPriceCents: previousPrice,
          deltaCents: delta,
          percentChange: parseFloat(percentChange),
          quantity: item.quantity || item.qty || 1,
          extendedDeltaCents: delta * (item.quantity || item.qty || 1),
          priceHistory: history.prices || []
        });
      }
    }
  }

  return evidence;
}

/**
 * Build complete evidence package for Proof Pack export
 */
function buildEvidencePackage(text, parseResult, options = {}) {
  const startTime = Date.now();

  const evidence = {
    version: '1.0',
    generatedAt: new Date().toISOString(),

    // Invoice metadata evidence
    metadata: extractMetadataEvidence(text),

    // Total/subtotal evidence (with context)
    totals: extractTotalEvidence(text),

    // Line item evidence
    lineItems: extractLineItemEvidence(text, parseResult.lineItems || []),

    // Math validation evidence
    mathValidation: {
      lineItemsSum: (parseResult.lineItems || []).reduce(
        (sum, item) => sum + (item.lineTotalCents || 0), 0
      ),
      subtotalCents: parseResult.totals?.subtotalCents || 0,
      taxCents: parseResult.totals?.taxCents || 0,
      totalCents: parseResult.totals?.totalCents || 0,
      reconciliationStatus: parseResult.debug?.printedTotalReconciliation || null,
      arbitration: parseResult.arbitration || null
    },

    // Price change evidence (if history provided)
    priceChanges: options.priceHistory
      ? extractPriceEvidence(text, parseResult.lineItems || [], options.priceHistory)
      : [],

    // Document statistics
    documentStats: {
      totalLines: text.split('\n').length,
      totalCharacters: text.length,
      parsedLineItems: (parseResult.lineItems || []).length,
      confidence: parseResult.confidence?.score || 0,
      needsReview: parseResult.needsReview || false,
      reviewReasons: parseResult.reviewReasons || []
    },

    // Processing metadata
    processingMeta: {
      extractionTimeMs: Date.now() - startTime,
      vendorKey: parseResult.vendorKey,
      vendorName: parseResult.vendorName,
      parserVersion: parseResult.parserVersion || '2.0.0'
    }
  };

  return evidence;
}

/**
 * Get context lines around a finding
 */
function getContextLines(lines, index) {
  const before = [];
  const after = [];

  // Lines before
  for (let i = Math.max(0, index - CONTEXT_CONFIG.LINES_BEFORE); i < index; i++) {
    before.push({
      lineNumber: i + 1,
      text: truncateLine(lines[i])
    });
  }

  // Lines after
  for (let i = index + 1; i <= Math.min(lines.length - 1, index + CONTEXT_CONFIG.LINES_AFTER); i++) {
    after.push({
      lineNumber: i + 1,
      text: truncateLine(lines[i])
    });
  }

  return { before, after };
}

/**
 * Truncate a line to max length
 */
function truncateLine(line) {
  const trimmed = (line || '').trim();
  if (trimmed.length <= CONTEXT_CONFIG.MAX_LINE_LENGTH) {
    return trimmed;
  }
  return trimmed.substring(0, CONTEXT_CONFIG.MAX_LINE_LENGTH - 3) + '...';
}

/**
 * Calculate confidence for a piece of evidence
 */
function calculateEvidenceConfidence(line, type) {
  let confidence = 50; // Base confidence

  // Higher confidence for specific labels
  if (type === 'invoice_total') confidence = 90;
  else if (type === 'amount_due') confidence = 85;
  else if (type === 'balance_due') confidence = 80;
  else if (type === 'grand_total') confidence = 75;

  // Boost if line contains currency symbol
  if (/\$/.test(line)) confidence += 5;

  // Boost if line contains a clear amount pattern
  if (/\$?\s*[\d,]+\.\d{2}/.test(line)) confidence += 5;

  return Math.min(100, confidence);
}

/**
 * Format evidence for PDF export (human-readable)
 */
function formatEvidenceForPDF(evidence) {
  const sections = [];

  // Totals section
  if (evidence.totals && evidence.totals.length > 0) {
    sections.push({
      title: 'Total Verification',
      content: evidence.totals.slice(0, 5).map(t => ({
        label: t.type.replace(/_/g, ' ').toUpperCase(),
        value: t.valueCents ? `$${(t.valueCents / 100).toFixed(2)}` : 'N/A',
        source: `Line ${t.lineNumber}: "${t.rawLine}"`,
        confidence: `${t.confidence}%`
      }))
    });
  }

  // Math validation section
  if (evidence.mathValidation) {
    const mv = evidence.mathValidation;
    sections.push({
      title: 'Math Verification',
      content: [
        { label: 'Line Items Sum', value: `$${(mv.lineItemsSum / 100).toFixed(2)}` },
        { label: 'Subtotal', value: `$${(mv.subtotalCents / 100).toFixed(2)}` },
        { label: 'Tax', value: `$${(mv.taxCents / 100).toFixed(2)}` },
        { label: 'Invoice Total', value: `$${(mv.totalCents / 100).toFixed(2)}` }
      ]
    });
  }

  // Price changes section (if any)
  if (evidence.priceChanges && evidence.priceChanges.length > 0) {
    sections.push({
      title: 'Price Changes Detected',
      content: evidence.priceChanges.map(pc => ({
        sku: pc.sku,
        description: pc.description,
        oldPrice: `$${(pc.previousPriceCents / 100).toFixed(2)}`,
        newPrice: `$${(pc.currentPriceCents / 100).toFixed(2)}`,
        change: `${pc.percentChange > 0 ? '+' : ''}${pc.percentChange}%`,
        impact: `$${(pc.extendedDeltaCents / 100).toFixed(2)}`
      }))
    });
  }

  return sections;
}

module.exports = {
  extractTotalEvidence,
  extractMetadataEvidence,
  extractLineItemEvidence,
  extractPriceEvidence,
  buildEvidencePackage,
  formatEvidenceForPDF,
  CONTEXT_CONFIG
};
