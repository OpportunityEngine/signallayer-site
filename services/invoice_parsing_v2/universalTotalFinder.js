/**
 * Universal Invoice Total Finder
 *
 * MISSION: Find the invoice total NO MATTER WHERE it is on ANY invoice.
 * This module exhaustively scans every single character, line, and pattern
 * to find the true invoice total using multiple parallel strategies.
 *
 * The invoice total is the MOST IMPORTANT number - without it, the invoice is useless.
 */

const { parseMoney, parseMoneyToDollars } = require('./utils');

/**
 * All known variations of "total" labels across vendors/industries
 */
const TOTAL_LABELS = [
  // Primary - highest confidence
  'INVOICE TOTAL',
  'INVOICE_TOTAL',
  'INVOICETOTAL',
  'INV TOTAL',
  'INV. TOTAL',
  'GRAND TOTAL',
  'GRANDTOTAL',
  'TOTAL DUE',
  'AMOUNT DUE',
  'BALANCE DUE',
  'PAY THIS AMOUNT',
  'PLEASE PAY',
  'PAYMENT DUE',

  // Secondary - high confidence
  'TOTAL AMOUNT',
  'TOTAL AMT',
  'TOTAL USD',
  'TOTAL $',
  'NET TOTAL',
  'NET AMOUNT',
  'NET DUE',
  'FINAL TOTAL',
  'ORDER TOTAL',

  // Tertiary - moderate confidence
  'TOTAL',
  'AMOUNT',
  'DUE',
  'BALANCE',

  // Vendor-specific
  'TOTAL INVOICE',
  'BILL TOTAL',
  'STATEMENT TOTAL',
  'PURCHASE TOTAL',
  'DELIVERY TOTAL'
];

/**
 * Labels that indicate a SUBTOTAL (not the final total)
 * We need to distinguish these to avoid grabbing the wrong number
 */
const SUBTOTAL_LABELS = [
  'SUBTOTAL',
  'SUB-TOTAL',
  'SUB TOTAL',
  'MERCHANDISE TOTAL',
  'PRODUCT TOTAL',
  'ITEMS TOTAL',
  'LINE ITEMS',
  'GROUP TOTAL',
  'DEPT TOTAL',
  'SECTION TOTAL',
  'CATEGORY TOTAL'
];

/**
 * Labels that indicate this is NOT a total we want
 */
const EXCLUDE_LABELS = [
  'TAX TOTAL',
  'SALES TAX',
  'TAX AMT',
  'DISCOUNT',
  'CREDIT',
  'PREVIOUS BALANCE',
  'LAST PAYMENT',
  'ACCOUNT NUMBER',
  'CUSTOMER NUMBER',
  'INVOICE NUMBER',
  'ORDER NUMBER',
  'PO NUMBER',
  'PHONE',
  'FAX',
  'ZIP',
  'CASES',
  'SPLIT',
  'PAGE',
  'DRIVER'
];

/**
 * Extract ALL monetary values from a string
 * Returns array of { value: cents, raw: string, index: position }
 */
function extractAllMonetaryValues(text) {
  const values = [];

  // Pattern matches: $1,234.56 or 1234.56 or 1,234.56 or $1234
  // Also handles: 1234.567 (3 decimal), 1234 (no decimal)
  const moneyPattern = /\$?\s*([\d,]+\.?\d{0,3})\b/g;

  let match;
  while ((match = moneyPattern.exec(text)) !== null) {
    const raw = match[1];
    const cleaned = raw.replace(/,/g, '');
    const num = parseFloat(cleaned);

    // Skip if not a valid number or too small/large
    if (isNaN(num) || num < 1 || num > 10000000) continue;

    // Skip if it looks like a year (1900-2099)
    if (num >= 1900 && num <= 2099 && !raw.includes('.')) continue;

    // Skip if it's a 7+ digit number without decimal (likely order/account number)
    if (cleaned.length >= 7 && !raw.includes('.')) continue;

    // Skip if it looks like a date (MM/DD or similar context)
    const beforeMatch = text.substring(Math.max(0, match.index - 5), match.index);
    if (/[\/\-]\s*$/.test(beforeMatch)) continue;

    values.push({
      value: Math.round(num * 100),  // Convert to cents
      dollars: num,
      raw: match[0],
      index: match.index
    });
  }

  return values;
}

/**
 * Strategy 1: Label + Value Pattern Matching
 * Look for known total labels followed by or near monetary values
 */
function findByLabelPatterns(text, lines) {
  const candidates = [];
  const upperText = text.toUpperCase();

  // Score multipliers for different label types
  const labelScores = {
    'INVOICE TOTAL': 100,
    'INVOICE_TOTAL': 100,
    'INVOICETOTAL': 100,
    'INV TOTAL': 95,
    'GRAND TOTAL': 95,
    'TOTAL DUE': 90,
    'AMOUNT DUE': 90,
    'BALANCE DUE': 85,
    'PAY THIS AMOUNT': 85,
    'TOTAL AMOUNT': 80,
    'TOTAL USD': 80,
    'NET TOTAL': 75,
    'ORDER TOTAL': 75,
    'TOTAL': 50,
    'AMOUNT': 40,
    'DUE': 30
  };

  for (const label of TOTAL_LABELS) {
    // Find all occurrences of this label
    let idx = 0;
    while ((idx = upperText.indexOf(label, idx)) !== -1) {
      // Check context - skip if preceded by subtotal indicators
      const contextBefore = upperText.substring(Math.max(0, idx - 20), idx);
      const contextAround = upperText.substring(Math.max(0, idx - 10), idx + label.length + 10);

      // CRITICAL FIX: If label is "TOTAL" (generic), check if it's actually "SUBTOTAL"
      // by looking at the character IMMEDIATELY before the match position
      let isSubtotal = false;
      if (label === 'TOTAL') {
        // Check if there's "SUB" immediately before "TOTAL"
        const charBeforeIdx = idx - 1;
        if (charBeforeIdx >= 0) {
          const twoCharsBefore = upperText.substring(Math.max(0, idx - 3), idx);
          if (twoCharsBefore === 'SUB' || twoCharsBefore.endsWith('SUB')) {
            isSubtotal = true;
          }
        }
      }

      // Also check other subtotal patterns
      if (!isSubtotal) {
        isSubtotal = SUBTOTAL_LABELS.some(sub => contextBefore.includes(sub)) ||
                     /SUB[\s-]?TOTAL/.test(contextAround) ||
                     /GROUP[\s\*]*TOTAL/.test(contextAround) ||
                     /CATEGORY[\s]*TOTAL/.test(contextAround) ||
                     /DEPT[\s]*TOTAL/.test(contextAround);
      }

      const isExcluded = EXCLUDE_LABELS.some(ex => contextBefore.includes(ex) || upperText.substring(idx, idx + 30).includes(ex));

      if (!isSubtotal && !isExcluded) {
        // Get text after label (up to 100 chars or end of line)
        const afterLabel = text.substring(idx + label.length, idx + label.length + 100);
        const lineEnd = afterLabel.indexOf('\n');
        const searchRange = lineEnd > 0 ? afterLabel.substring(0, lineEnd) : afterLabel;

        // Also check next line (for columnar layouts)
        let nextLineSearch = '';
        if (lineEnd > 0 && lineEnd < afterLabel.length) {
          const nextLine = afterLabel.substring(lineEnd + 1);
          const nextLineEnd = nextLine.indexOf('\n');
          nextLineSearch = nextLineEnd > 0 ? nextLine.substring(0, nextLineEnd) : nextLine.substring(0, 50);
        }

        // Extract values from same line
        let values = extractAllMonetaryValues(searchRange);

        // If no value on same line, check next line
        if (values.length === 0 && nextLineSearch) {
          values = extractAllMonetaryValues(nextLineSearch);
        }

        // Also look backwards (value before label)
        if (values.length === 0) {
          const beforeLabel = text.substring(Math.max(0, idx - 50), idx);
          values = extractAllMonetaryValues(beforeLabel);
        }

        if (values.length > 0) {
          // Take the largest value near this label (usually the total, not a component)
          const bestValue = values.reduce((a, b) => a.value > b.value ? a : b);

          candidates.push({
            strategy: 'label_pattern',
            label: label,
            value: bestValue.value,
            dollars: bestValue.dollars,
            score: labelScores[label] || 50,
            context: text.substring(idx, idx + 50).replace(/\n/g, ' ').trim()
          });
        }
      }

      idx += label.length;
    }
  }

  return candidates;
}

/**
 * Strategy 2: Bottom-Up Scanning
 * Invoice totals are almost always near the bottom of the document
 * Scan from bottom up, looking for the largest reasonable value
 */
function findByBottomScan(text, lines) {
  const candidates = [];

  // Take last 40 lines (or fewer if document is short)
  const bottomLines = lines.slice(-Math.min(40, lines.length));
  const startLineNum = lines.length - bottomLines.length;

  let largestValue = 0;
  let largestContext = '';
  let largestLineNum = -1;

  for (let i = bottomLines.length - 1; i >= 0; i--) {
    const line = bottomLines[i].trim();
    const lineNum = startLineNum + i;

    // Skip very short lines
    if (line.length < 3) continue;

    // Skip lines with excluded content
    const upperLine = line.toUpperCase();
    if (EXCLUDE_LABELS.some(ex => upperLine.includes(ex))) continue;
    if (SUBTOTAL_LABELS.some(sub => upperLine.includes(sub) && !upperLine.includes('INVOICE'))) continue;

    // Skip GROUP TOTAL (Sysco specific)
    if (/GROUP\s*TOTAL/i.test(line)) continue;

    // Extract monetary values
    const values = extractAllMonetaryValues(line);

    for (const val of values) {
      // Reasonable invoice total range: $1 to $100,000
      if (val.value >= 100 && val.value <= 10000000) {
        // Check if this line has "TOTAL" context
        const hasTotal = /TOTAL/i.test(line);
        const hasInvoice = /INVOICE/i.test(line);

        // Score this candidate
        let score = 30;  // Base score for bottom scan
        if (hasInvoice && hasTotal) score = 85;
        else if (hasTotal) score = 60;

        // Prefer larger values (invoice totals are usually the largest)
        if (val.value > largestValue) {
          largestValue = val.value;
          largestContext = line;
          largestLineNum = lineNum;

          candidates.push({
            strategy: 'bottom_scan',
            value: val.value,
            dollars: val.dollars,
            score: score,
            lineNum: lineNum,
            context: line.substring(0, 80)
          });
        }
      }
    }
  }

  return candidates;
}

/**
 * Strategy 3: Column/Footer Detection
 * Some invoices have totals in a footer area or specific column
 * Look for patterns like value-only lines near TOTAL labels
 */
function findByColumnFooter(text, lines) {
  const candidates = [];

  // Find lines that are JUST a monetary value (typical in columnar layouts)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Match lines that are just a number (possibly with $ and commas)
    const justValueMatch = line.match(/^\$?\s*([\d,]+\.\d{2})\s*$/);
    if (justValueMatch) {
      const value = parseMoney(justValueMatch[1]);

      // Check surrounding lines for context
      const linesBefore = lines.slice(Math.max(0, i - 5), i).join(' ').toUpperCase();
      const linesAfter = lines.slice(i + 1, Math.min(lines.length, i + 3)).join(' ').toUpperCase();

      // Look for TOTAL/INVOICE context nearby
      const hasTotal = /TOTAL/i.test(linesBefore) || /TOTAL/i.test(linesAfter);
      const hasInvoice = /INVOICE/i.test(linesBefore) || /INVOICE/i.test(linesAfter);
      const isSubtotal = SUBTOTAL_LABELS.some(sub => linesBefore.includes(sub));

      if (value > 100 && value < 10000000 && !isSubtotal) {
        let score = 25;
        if (hasInvoice && hasTotal) score = 80;
        else if (hasTotal) score = 50;

        // Bonus for being in bottom third of document
        if (i > lines.length * 0.66) score += 15;

        candidates.push({
          strategy: 'column_footer',
          value: value,
          dollars: value / 100,
          score: score,
          lineNum: i,
          context: `Line ${i}: "${line}" (nearby: ${linesBefore.substring(0, 30)}...)`
        });
      }
    }
  }

  return candidates;
}

/**
 * Strategy 4: Keyword Proximity Search
 * Find ALL instances of total-related keywords and look for nearby values
 */
function findByKeywordProximity(text, lines) {
  const candidates = [];

  // Keywords with distance tolerance (how far the value can be from keyword)
  const keywords = [
    { word: 'INVOICE TOTAL', distance: 50, score: 100 },
    { word: 'GRAND TOTAL', distance: 50, score: 95 },
    { word: 'TOTAL DUE', distance: 40, score: 90 },
    { word: 'AMOUNT DUE', distance: 40, score: 85 },
    { word: 'BALANCE DUE', distance: 40, score: 85 },
    { word: 'PAYABLE', distance: 30, score: 70 },
    { word: 'TOTAL', distance: 30, score: 50 }
  ];

  const upperText = text.toUpperCase();

  for (const kw of keywords) {
    let idx = 0;
    while ((idx = upperText.indexOf(kw.word, idx)) !== -1) {
      // Skip if this keyword is part of a SUBTOTAL or GROUP TOTAL
      const contextAround = upperText.substring(Math.max(0, idx - 10), idx + kw.word.length + 10);
      const isSubtotal = /SUB[\s-]?TOTAL/.test(contextAround) ||
                         /GROUP[\s\*]*TOTAL/.test(contextAround) ||
                         /CATEGORY[\s]*TOTAL/.test(contextAround) ||
                         /DEPT[\s]*TOTAL/.test(contextAround);

      if (!isSubtotal) {
        // Get character range around this keyword
        const start = Math.max(0, idx - kw.distance);
        const end = Math.min(text.length, idx + kw.word.length + kw.distance);
        const context = text.substring(start, end);

        // Extract values from this context
        const values = extractAllMonetaryValues(context);

        for (const val of values) {
          if (val.value >= 100 && val.value <= 10000000) {
            candidates.push({
              strategy: 'keyword_proximity',
              keyword: kw.word,
              value: val.value,
              dollars: val.dollars,
              score: kw.score,
              context: context.replace(/\n/g, ' ').trim().substring(0, 80)
            });
          }
        }
      }

      idx += kw.word.length;
    }
  }

  return candidates;
}

/**
 * Strategy 5: Largest Value Heuristic
 * The invoice total is often the largest monetary value on the document
 * (especially near the bottom)
 */
function findByLargestValue(text, lines) {
  const candidates = [];

  // Extract ALL monetary values from entire document
  const allValues = extractAllMonetaryValues(text);

  if (allValues.length === 0) return candidates;

  // Sort by value descending
  allValues.sort((a, b) => b.value - a.value);

  // Take top 5 largest values
  const topValues = allValues.slice(0, 5);

  for (let i = 0; i < topValues.length; i++) {
    const val = topValues[i];

    // Get context around this value
    const contextStart = Math.max(0, val.index - 30);
    const contextEnd = Math.min(text.length, val.index + 50);
    const context = text.substring(contextStart, contextEnd).replace(/\n/g, ' ');

    // Skip if context indicates this is not a total
    const upperContext = context.toUpperCase();
    if (EXCLUDE_LABELS.some(ex => upperContext.includes(ex))) continue;
    if (SUBTOTAL_LABELS.some(sub => upperContext.includes(sub) && !upperContext.includes('INVOICE'))) continue;

    // Higher score for #1 largest, decreasing for others
    let score = 35 - (i * 5);

    // Bonus if context has "TOTAL"
    if (/TOTAL/i.test(context)) score += 20;
    if (/INVOICE/i.test(context)) score += 20;

    // Bonus for values in reasonable invoice range ($10 - $10,000)
    if (val.value >= 1000 && val.value <= 1000000) score += 10;

    candidates.push({
      strategy: 'largest_value',
      rank: i + 1,
      value: val.value,
      dollars: val.dollars,
      score: Math.max(5, score),
      context: context.trim()
    });
  }

  return candidates;
}

/**
 * Strategy 6: Last Page / Footer Scan
 * For multi-page documents, total is usually on the last page
 * Look for page markers and focus on content after the last one
 */
function findByLastPageFocus(text, lines) {
  const candidates = [];

  // Find page markers
  const pagePattern = /(?:PAGE|PG\.?)\s*(\d+)\s*(?:OF|\/)\s*(\d+)/gi;
  let lastPageMatch = null;
  let lastPageIndex = -1;

  let match;
  while ((match = pagePattern.exec(text)) !== null) {
    const currentPage = parseInt(match[1]);
    const totalPages = parseInt(match[2]);

    if (currentPage === totalPages) {
      lastPageMatch = match;
      lastPageIndex = match.index;
    }
  }

  // Also look for "LAST PAGE" marker (common in Sysco)
  const lastPageMarker = text.match(/LAST\s+PAGE/i);
  if (lastPageMarker && lastPageMarker.index > lastPageIndex) {
    lastPageIndex = lastPageMarker.index;
  }

  // If we found a last page marker, focus search there
  if (lastPageIndex > 0) {
    // Extract text BEFORE "LAST PAGE" (the invoice total is usually just before this marker)
    // Take the last 500 chars before the marker (or less if document is short)
    const beforeLastPage = text.substring(Math.max(0, lastPageIndex - 500), lastPageIndex);
    const beforeLines = beforeLastPage.split('\n');

    // Run bottom scan on the content before "LAST PAGE"
    const beforeCandidates = findByBottomScan(beforeLastPage, beforeLines);

    for (const cand of beforeCandidates) {
      candidates.push({
        ...cand,
        strategy: 'last_page_focus',
        score: cand.score + 25  // HIGH bonus for being right before LAST PAGE marker
      });
    }

    // Also check text AFTER the marker (for cases where total comes after)
    const afterLastPage = text.substring(lastPageIndex);
    const afterLines = afterLastPage.split('\n');
    const afterCandidates = findByBottomScan(afterLastPage, afterLines);

    for (const cand of afterCandidates) {
      candidates.push({
        ...cand,
        strategy: 'last_page_focus',
        score: cand.score + 10  // Lower bonus for values after LAST PAGE
      });
    }
  }

  return candidates;
}

/**
 * Strategy 7: Regex Army
 * Throw every possible regex pattern at the text
 * ENHANCED with vendor-specific patterns
 */
function findByRegexArmy(text) {
  const candidates = [];

  const patterns = [
    // ===== SYSCO SPECIFIC PATTERNS =====
    // Sysco uses "INVOICE TOTAL" followed by value, sometimes on same line, sometimes split
    { regex: /INVOICE\s+TOTAL\s+([\d,]+\.\d{2})/gi, score: 100 },
    { regex: /INVOICE\s*\n\s*TOTAL\s*\n\s*([\d,]+\.\d{2})/gi, score: 100 },
    { regex: /TOTAL\s*\n\s*([\d,]+\.\d{2})\s*\n.*LAST\s+PAGE/gi, score: 100 },
    { regex: /([\d,]+\.\d{2})\s*\n.*LAST\s+PAGE/gi, score: 85 },
    { regex: /SYSCO.*TOTAL[:\s]*([\d,]+\.\d{2})/gi, score: 95 },

    // ===== HIGH CONFIDENCE PATTERNS =====
    { regex: /INVOICE\s*TOTAL[:\s]*\$?([\d,]+\.?\d*)/gi, score: 100 },
    { regex: /INV\.?\s*TOTAL[:\s]*\$?([\d,]+\.?\d*)/gi, score: 95 },
    { regex: /GRAND\s*TOTAL[:\s]*\$?([\d,]+\.?\d*)/gi, score: 95 },
    { regex: /TOTAL\s*DUE[:\s]*\$?([\d,]+\.?\d*)/gi, score: 90 },
    { regex: /AMOUNT\s*DUE[:\s]*\$?([\d,]+\.?\d*)/gi, score: 90 },
    { regex: /BALANCE\s*DUE[:\s]*\$?([\d,]+\.?\d*)/gi, score: 85 },
    { regex: /PAY\s*(?:THIS\s*)?AMOUNT[:\s]*\$?([\d,]+\.?\d*)/gi, score: 85 },
    { regex: /PLEASE\s*PAY[:\s]*\$?([\d,]+\.?\d*)/gi, score: 80 },
    { regex: /NET\s*(?:TOTAL|DUE|AMOUNT)[:\s]*\$?([\d,]+\.?\d*)/gi, score: 80 },

    // ===== MEDIUM CONFIDENCE PATTERNS =====
    { regex: /TOTAL\s*(?:AMOUNT|AMT)?[:\s]*\$?([\d,]+\.?\d*)/gi, score: 50 },

    // Multi-line patterns (label then value on next line)
    { regex: /INVOICE\s*\n\s*TOTAL\s*\n\s*\$?([\d,]+\.?\d*)/gi, score: 95 },
    { regex: /TOTAL\s*\n\s*\$?([\d,]+\.?\d*)/gi, score: 45 },

    // Value before label (less common)
    { regex: /\$?([\d,]+\.\d{2})\s*(?:TOTAL|DUE|AMOUNT)/gi, score: 60 },

    // Footer/end-of-document patterns
    { regex: /TOTAL\s*[:=]\s*\$?([\d,]+\.?\d*)\s*$/gim, score: 70 },
    { regex: /^\s*\$?([\d,]+\.\d{2})\s*$/gm, score: 20 }, // Standalone values

    // ===== FOOD SERVICE VENDOR PATTERNS =====
    // US Foods
    { regex: /US\s*FOODS.*TOTAL[:\s]*([\d,]+\.\d{2})/gi, score: 95 },
    // Generic food service
    { regex: /DELIVERY\s*TOTAL[:\s]*([\d,]+\.\d{2})/gi, score: 80 },
    { regex: /ORDER\s*TOTAL[:\s]*([\d,]+\.\d{2})/gi, score: 75 },

    // ===== UNIFORM/SERVICE VENDOR PATTERNS =====
    // Cintas
    { regex: /CINTAS.*TOTAL[:\s]*([\d,]+\.\d{2})/gi, score: 95 },
    { regex: /TOTAL\s*USD[:\s]*([\d,]+\.\d{2})/gi, score: 85 },

    // With currency indicator
    { regex: /(?:TOTAL|DUE|AMOUNT)\s*(?:USD)?\s*\$?([\d,]+\.?\d*)/gi, score: 70 },

    // ===== UTILITY/SERVICE PATTERNS =====
    { regex: /AMOUNT\s*ENCLOSED[:\s]*([\d,]+\.\d{2})/gi, score: 80 },
    { regex: /CURRENT\s*CHARGES[:\s]*([\d,]+\.\d{2})/gi, score: 70 },
    { regex: /NEW\s*BALANCE[:\s]*([\d,]+\.\d{2})/gi, score: 75 },
  ];

  for (const { regex, score } of patterns) {
    // Reset regex state
    regex.lastIndex = 0;

    let match;
    while ((match = regex.exec(text)) !== null) {
      // The captured group with the value
      const valueStr = match[1] || match[0];
      const value = parseMoney(valueStr);

      if (value > 0 && value < 10000000) {
        // Check if this looks like a subtotal
        const contextStart = Math.max(0, match.index - 20);
        const context = text.substring(contextStart, match.index + match[0].length + 10).toUpperCase();

        // Skip if this is a SUBTOTAL, GROUP TOTAL, etc. (not the final invoice total)
        const isSubtotal = SUBTOTAL_LABELS.some(sub => context.includes(sub) && !context.includes('INVOICE')) ||
                           /SUB[\s-]?TOTAL/.test(context) ||
                           /GROUP[\s\*]*TOTAL/.test(context) ||
                           /CATEGORY[\s]*TOTAL/.test(context) ||
                           /DEPT[\s]*TOTAL/.test(context);

        const isExcluded = EXCLUDE_LABELS.some(ex => context.includes(ex));

        if (!isSubtotal && !isExcluded) {
          candidates.push({
            strategy: 'regex_army',
            pattern: regex.source.substring(0, 40),
            value: value,
            dollars: value / 100,
            score: score,
            context: match[0].substring(0, 60)
          });
        }
      }
    }
  }

  return candidates;
}

/**
 * Strategy 8: Tax + Subtotal Validation
 * If we find subtotal and tax, the total should be subtotal + tax
 * This helps validate our total candidate
 *
 * IMPORTANT: This is a VALIDATOR, not a primary finder.
 * It should have LOWER confidence than explicit "INVOICE TOTAL" labels
 * because many invoices have fees/adjustments not included in subtotal+tax.
 */
function findByTaxSubtotalValidation(text, lines) {
  const candidates = [];

  // Find subtotal
  let subtotalCents = 0;
  const subtotalMatch = text.match(/SUB[\s-]?TOTAL[:\s]*\$?([\d,]+\.?\d*)/i);
  if (subtotalMatch) {
    subtotalCents = parseMoney(subtotalMatch[1]);
  }

  // Find tax
  let taxCents = 0;
  const taxMatch = text.match(/(?:SALES\s+)?TAX[:\s]*\$?([\d,]+\.?\d*)/i);
  if (taxMatch) {
    taxCents = parseMoney(taxMatch[1]);
  }

  // If we have both, the total should be their sum
  if (subtotalCents > 0 && taxCents >= 0) {
    const computedTotal = subtotalCents + taxCents;

    // Look for this value in the document
    const computedDollars = (computedTotal / 100).toFixed(2);
    const patterns = [
      new RegExp(`\\$?${computedDollars.replace('.', '\\.')}`, 'g'),
      new RegExp(computedDollars.replace(/,/g, '').replace('.', '\\.'), 'g')
    ];

    for (const pattern of patterns) {
      if (pattern.test(text)) {
        // Check if there's an "INVOICE TOTAL" or similar explicit label
        const hasInvoiceTotalLabel = /INVOICE[\s\r\n]*TOTAL/i.test(text) ||
                                     /GRAND[\s\r\n]*TOTAL/i.test(text) ||
                                     /TOTAL[\s\r\n]*DUE/i.test(text);

        // LOWER score if explicit total label exists (subtotal+tax might not include fees)
        // HIGHER score if no explicit label (subtotal+tax is our best guess)
        const score = hasInvoiceTotalLabel ? 45 : 75;

        candidates.push({
          strategy: 'tax_subtotal_validation',
          value: computedTotal,
          dollars: computedTotal / 100,
          score: score,
          context: `Computed from subtotal($${(subtotalCents/100).toFixed(2)}) + tax($${(taxCents/100).toFixed(2)})`
        });
        console.log(`[TOTAL FINDER] Tax+Subtotal validation: $${(subtotalCents/100).toFixed(2)} + $${(taxCents/100).toFixed(2)} = $${(computedTotal/100).toFixed(2)} (score: ${score})`);
        break;
      }
    }
  }

  return candidates;
}

/**
 * Strategy 9: Document Position Scoring
 * Values in the last 10% of the document score much higher
 * because invoice totals are almost always at the very end
 */
function findByDocumentPosition(text, lines) {
  const candidates = [];

  // Get all monetary values with their positions
  const allValues = extractAllMonetaryValues(text);

  for (const val of allValues) {
    // Calculate position as percentage of document
    const positionPct = val.index / text.length;

    // Only consider values in bottom 20% of document
    if (positionPct >= 0.80) {
      // Get context
      const contextStart = Math.max(0, val.index - 50);
      const contextEnd = Math.min(text.length, val.index + 50);
      const context = text.substring(contextStart, contextEnd);

      // Skip excluded patterns
      const upperContext = context.toUpperCase();
      if (EXCLUDE_LABELS.some(ex => upperContext.includes(ex))) continue;
      if (SUBTOTAL_LABELS.some(sub => upperContext.includes(sub) && !upperContext.includes('INVOICE'))) continue;

      // Score based on position (closer to end = higher score)
      let score = Math.round(20 + (positionPct - 0.80) * 200);  // 20-60 range

      // Bonus for "TOTAL" nearby
      if (/TOTAL/i.test(context)) score += 30;
      if (/INVOICE/i.test(context)) score += 25;

      if (val.value >= 100 && val.value <= 10000000) {
        candidates.push({
          strategy: 'document_position',
          value: val.value,
          dollars: val.dollars,
          score: Math.min(95, score),
          positionPct: Math.round(positionPct * 100),
          context: context.replace(/\n/g, ' ').trim().substring(0, 60)
        });
      }
    }
  }

  // Sort by position (closest to end first)
  candidates.sort((a, b) => b.positionPct - a.positionPct);

  return candidates.slice(0, 5);  // Return top 5 by position
}

/**
 * Strategy 10: Line Item Sum Cross-Check
 * Extract all line item prices and see if any total equals their sum
 * This validates that we found the correct total
 */
function findByLineItemSumValidation(text, lines) {
  const candidates = [];

  // Quick extraction of line item totals (prices at end of lines)
  const lineItemPrices = [];
  for (const line of lines) {
    // Skip total/subtotal lines
    if (/TOTAL|SUBTOTAL|TAX|DUE|AMOUNT/i.test(line)) continue;

    // Look for price pattern at end of line: "description... 45.99"
    const priceMatch = line.trim().match(/([\d,]+\.\d{2})\s*$/);
    if (priceMatch) {
      const price = parseMoney(priceMatch[1]);
      // Reasonable line item range: $0.50 - $5,000
      if (price >= 50 && price <= 500000) {
        lineItemPrices.push(price);
      }
    }
  }

  if (lineItemPrices.length >= 2) {
    const lineItemSum = lineItemPrices.reduce((a, b) => a + b, 0);

    // Look for this sum (or close to it) in the document
    const sumDollars = lineItemSum / 100;

    // Search for values within 10% of line items sum
    const allValues = extractAllMonetaryValues(text);
    for (const val of allValues) {
      const diff = Math.abs(val.value - lineItemSum);
      const pct = lineItemSum > 0 ? diff / lineItemSum : 1;

      // If value is within 10% of line items sum, it might be the total
      if (pct <= 0.10 && val.value >= lineItemSum * 0.9) {
        candidates.push({
          strategy: 'line_item_sum_validation',
          value: val.value,
          dollars: val.dollars,
          score: pct <= 0.01 ? 85 : pct <= 0.05 ? 70 : 55,
          lineItemCount: lineItemPrices.length,
          lineItemSum: lineItemSum,
          context: `Sum of ${lineItemPrices.length} line items: $${sumDollars.toFixed(2)}, found: $${val.dollars.toFixed(2)}`
        });
      }
    }
  }

  return candidates;
}

/**
 * MAIN FUNCTION: Find the invoice total using ALL strategies
 * Returns the best candidate with confidence score
 */
function findInvoiceTotal(text, options = {}) {
  // Pre-process text: normalize whitespace and fix common OCR issues
  const cleanedText = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/  +/g, ' ')
    .replace(/(\d),(\d{3})/g, '$1$2');  // Remove thousands separators for easier parsing

  const lines = text.split('\n');  // Use original for line-based operations
  const cleanedLines = cleanedText.split('\n');

  console.log(`[UNIVERSAL TOTAL FINDER] Searching ${lines.length} lines, ${text.length} characters`);

  // Run ALL strategies in parallel
  const allCandidates = [];

  // Strategy 1: Label patterns
  const labelCandidates = findByLabelPatterns(text, lines);
  allCandidates.push(...labelCandidates);
  console.log(`[TOTAL FINDER] Strategy 1 (Label Patterns): ${labelCandidates.length} candidates`);

  // Strategy 2: Bottom scan
  const bottomCandidates = findByBottomScan(text, lines);
  allCandidates.push(...bottomCandidates);
  console.log(`[TOTAL FINDER] Strategy 2 (Bottom Scan): ${bottomCandidates.length} candidates`);

  // Strategy 3: Column/Footer
  const columnCandidates = findByColumnFooter(text, lines);
  allCandidates.push(...columnCandidates);
  console.log(`[TOTAL FINDER] Strategy 3 (Column/Footer): ${columnCandidates.length} candidates`);

  // Strategy 4: Keyword proximity
  const proximityCandidates = findByKeywordProximity(text, lines);
  allCandidates.push(...proximityCandidates);
  console.log(`[TOTAL FINDER] Strategy 4 (Keyword Proximity): ${proximityCandidates.length} candidates`);

  // Strategy 5: Largest value
  const largestCandidates = findByLargestValue(text, lines);
  allCandidates.push(...largestCandidates);
  console.log(`[TOTAL FINDER] Strategy 5 (Largest Value): ${largestCandidates.length} candidates`);

  // Strategy 6: Last page focus
  const lastPageCandidates = findByLastPageFocus(text, lines);
  allCandidates.push(...lastPageCandidates);
  console.log(`[TOTAL FINDER] Strategy 6 (Last Page): ${lastPageCandidates.length} candidates`);

  // Strategy 7: Regex army
  const regexCandidates = findByRegexArmy(text);
  allCandidates.push(...regexCandidates);
  console.log(`[TOTAL FINDER] Strategy 7 (Regex Army): ${regexCandidates.length} candidates`);

  // Strategy 8: Tax + Subtotal Validation
  const taxSubtotalCandidates = findByTaxSubtotalValidation(text, lines);
  allCandidates.push(...taxSubtotalCandidates);
  console.log(`[TOTAL FINDER] Strategy 8 (Tax+Subtotal Validation): ${taxSubtotalCandidates.length} candidates`);

  // Strategy 9: Document Position Scoring
  const positionCandidates = findByDocumentPosition(text, lines);
  allCandidates.push(...positionCandidates);
  console.log(`[TOTAL FINDER] Strategy 9 (Document Position): ${positionCandidates.length} candidates`);

  // Strategy 10: Line Item Sum Validation
  const lineItemSumCandidates = findByLineItemSumValidation(text, lines);
  allCandidates.push(...lineItemSumCandidates);
  console.log(`[TOTAL FINDER] Strategy 10 (Line Item Sum): ${lineItemSumCandidates.length} candidates`);

  console.log(`[TOTAL FINDER] Total candidates: ${allCandidates.length}`);

  if (allCandidates.length === 0) {
    console.log(`[TOTAL FINDER] WARNING: No total candidates found!`);
    return {
      found: false,
      totalCents: 0,
      totalDollars: 0,
      confidence: 0,
      strategy: 'none',
      debug: { candidates: [] }
    };
  }

  // Group candidates by value and calculate combined score
  const valueGroups = {};
  for (const cand of allCandidates) {
    const key = cand.value;
    if (!valueGroups[key]) {
      valueGroups[key] = {
        value: cand.value,
        dollars: cand.dollars,
        totalScore: 0,
        strategies: [],
        maxScore: 0,
        candidates: []
      };
    }
    valueGroups[key].totalScore += cand.score;
    valueGroups[key].maxScore = Math.max(valueGroups[key].maxScore, cand.score);
    valueGroups[key].strategies.push(cand.strategy);
    valueGroups[key].candidates.push(cand);
  }

  // Sort by combined score
  const sortedGroups = Object.values(valueGroups).sort((a, b) => {
    // Primary: max score from any single strategy
    if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore;
    // Secondary: total combined score (agreement across strategies)
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    // Tertiary: prefer values found by more strategies
    return b.strategies.length - a.strategies.length;
  });

  // Log top candidates
  console.log(`[TOTAL FINDER] Top candidates by combined score:`);
  for (let i = 0; i < Math.min(5, sortedGroups.length); i++) {
    const g = sortedGroups[i];
    console.log(`  ${i+1}. $${g.dollars.toFixed(2)} - maxScore=${g.maxScore}, totalScore=${g.totalScore}, strategies=[${[...new Set(g.strategies)].join(', ')}]`);
  }

  const winner = sortedGroups[0];

  // Calculate confidence based on score and agreement
  let confidence = Math.min(100, winner.maxScore);

  // Bonus for multiple strategies agreeing
  const uniqueStrategies = [...new Set(winner.strategies)].length;
  if (uniqueStrategies >= 3) confidence = Math.min(100, confidence + 15);
  else if (uniqueStrategies >= 2) confidence = Math.min(100, confidence + 10);

  console.log(`[TOTAL FINDER] SELECTED: $${winner.dollars.toFixed(2)} with ${confidence}% confidence (${uniqueStrategies} strategies agree)`);

  return {
    found: true,
    totalCents: winner.value,
    totalDollars: winner.dollars,
    confidence: confidence,
    strategy: [...new Set(winner.strategies)].join('+'),
    debug: {
      candidateCount: allCandidates.length,
      uniqueValues: sortedGroups.length,
      winningStrategies: winner.strategies,
      topCandidates: sortedGroups.slice(0, 5).map(g => ({
        dollars: g.dollars,
        maxScore: g.maxScore,
        strategies: [...new Set(g.strategies)]
      }))
    }
  };
}

/**
 * Enhanced total extraction that uses the universal finder
 * and falls back to the provided existing totals if needed
 */
function extractTotalWithUniversalFinder(text, existingTotals = {}) {
  // Run universal finder
  const result = findInvoiceTotal(text);

  // If universal finder found a total with good confidence, use it
  if (result.found && result.confidence >= 40) {
    return {
      totalCents: result.totalCents,
      subtotalCents: existingTotals.subtotalCents || 0,
      taxCents: existingTotals.taxCents || 0,
      confidence: result.confidence,
      foundBy: result.strategy,
      debug: result.debug
    };
  }

  // If existing totals have a value, compare
  if (existingTotals.totalCents > 0) {
    // If universal finder found something but with low confidence,
    // and existing total is different, log a warning
    if (result.found && result.totalCents !== existingTotals.totalCents) {
      console.log(`[TOTAL FINDER] Warning: Universal finder found $${result.totalDollars.toFixed(2)} but existing parser found $${(existingTotals.totalCents/100).toFixed(2)}`);

      // Prefer the higher-scoring result
      if (result.confidence > 50) {
        return {
          totalCents: result.totalCents,
          subtotalCents: existingTotals.subtotalCents || 0,
          taxCents: existingTotals.taxCents || 0,
          confidence: result.confidence,
          foundBy: result.strategy,
          debug: result.debug
        };
      }
    }

    return existingTotals;
  }

  // Return universal finder result even with low confidence if it's all we have
  if (result.found) {
    return {
      totalCents: result.totalCents,
      subtotalCents: existingTotals.subtotalCents || 0,
      taxCents: existingTotals.taxCents || 0,
      confidence: result.confidence,
      foundBy: result.strategy,
      debug: result.debug
    };
  }

  // Nothing found
  return {
    totalCents: 0,
    subtotalCents: 0,
    taxCents: 0,
    confidence: 0,
    foundBy: 'none',
    debug: { error: 'No total found by any strategy' }
  };
}

module.exports = {
  findInvoiceTotal,
  extractTotalWithUniversalFinder,
  extractAllMonetaryValues,
  // Export individual strategies for testing
  findByLabelPatterns,
  findByBottomScan,
  findByColumnFooter,
  findByKeywordProximity,
  findByLargestValue,
  findByLastPageFocus,
  findByRegexArmy,
  findByTaxSubtotalValidation,
  findByDocumentPosition,
  findByLineItemSumValidation
};
