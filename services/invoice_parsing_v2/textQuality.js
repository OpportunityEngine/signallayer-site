/**
 * Text Quality Analysis and Cleanup
 *
 * Detects OCR quality issues and cleans up extracted text
 * to improve parsing accuracy.
 */

/**
 * Common OCR errors and their corrections
 */
const OCR_CORRECTIONS = {
  // Number/letter confusion
  '0': ['O', 'o'],
  '1': ['l', 'I', '|'],
  '5': ['S', 's'],
  '8': ['B'],
  // Common word errors in invoices
  'QUANTITY': ['OUANTITY', 'QUANTITV'],
  'DESCRIPTION': ['DESCR1PTION', 'DESCRIPT1ON'],
  'TOTAL': ['T0TAL', 'TQTAL'],
  'SUBTOTAL': ['SUBT0TAL', 'SUBTQTAL'],
  'INVOICE': ['INV0ICE', '1NVOICE'],
  'PRICE': ['PR1CE', 'PRIC3']
};

/**
 * Patterns that indicate garbage/noise lines
 */
const GARBAGE_PATTERNS = [
  // Too many special characters
  /^[^a-zA-Z0-9]{5,}$/,
  // Just dots or dashes
  /^[\.\-_=]{10,}$/,
  // Random character sequences
  /^[A-Z]{20,}$/,  // No spaces, all caps, very long
  // Page artifacts
  /^Page\s+\d+\s+of\s+\d+$/i,
  /^-+\s*\d+\s*-+$/,
  // Form field markers
  /^_{10,}$/,
  // Empty brackets/parens
  /^\[\s*\]$|^\(\s*\)$/,
  // Just numbers with no context
  /^\d{1,3}$(?!\s)/,
  // Repeated single character
  /^(.)\1{5,}$/
];

/**
 * Patterns that indicate valid invoice content
 */
const VALID_CONTENT_PATTERNS = [
  // Has price-like number
  /\$?[\d,]+\.\d{2}/,
  // Has quantity indicator
  /\b\d+\s*(CS|EA|LB|OZ|GAL|CT|PK|BOX|DOZ)\b/i,
  // Has SKU-like code
  /\b[A-Z]?\d{5,8}\b/,
  // Has descriptive text
  /\b(CHICKEN|BEEF|PORK|CHEESE|MILK|BREAD|SAUCE|OIL|UNIFORM|SHIRT|PANTS)\b/i
];

/**
 * Calculate quality score for a line of text
 * @param {string} line - Text line to analyze
 * @returns {Object} Quality analysis result
 */
function analyzeLineQuality(line) {
  if (!line) return { score: 0, isGarbage: true, reasons: ['Empty line'] };

  const trimmed = line.trim();
  const result = {
    score: 50,  // Start neutral
    isGarbage: false,
    reasons: [],
    cleanedLine: trimmed
  };

  // Check length
  if (trimmed.length < 3) {
    result.score -= 30;
    result.reasons.push('Too short');
  }

  if (trimmed.length > 500) {
    result.score -= 20;
    result.reasons.push('Suspiciously long');
  }

  // Check for garbage patterns
  for (const pattern of GARBAGE_PATTERNS) {
    if (pattern.test(trimmed)) {
      result.score -= 40;
      result.reasons.push('Matches garbage pattern');
      break;
    }
  }

  // Check for valid content
  for (const pattern of VALID_CONTENT_PATTERNS) {
    if (pattern.test(trimmed)) {
      result.score += 20;
      result.reasons.push('Contains valid invoice content');
      break;
    }
  }

  // Calculate character composition
  const alphaCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
  const digitCount = (trimmed.match(/\d/g) || []).length;
  const spaceCount = (trimmed.match(/\s/g) || []).length;
  const specialCount = trimmed.length - alphaCount - digitCount - spaceCount;

  const specialRatio = specialCount / trimmed.length;
  const alphaNumRatio = (alphaCount + digitCount) / trimmed.length;

  // Too many special characters is suspicious
  if (specialRatio > 0.3) {
    result.score -= 20;
    result.reasons.push('High special character ratio');
  }

  // Good alphanumeric ratio
  if (alphaNumRatio > 0.7) {
    result.score += 10;
  }

  // Check for readable words (at least some 3+ letter words)
  const words = trimmed.split(/\s+/).filter(w => /^[a-zA-Z]{3,}$/.test(w));
  if (words.length >= 2) {
    result.score += 15;
    result.reasons.push('Contains readable words');
  }

  // Final determination
  result.isGarbage = result.score < 30;
  result.score = Math.max(0, Math.min(100, result.score));

  return result;
}

/**
 * Analyze overall text quality
 * @param {string} text - Full text to analyze
 * @returns {Object} Quality analysis
 */
function analyzeTextQuality(text) {
  if (!text) return { score: 0, quality: 'poor', issues: ['Empty text'] };

  const lines = text.split('\n');
  const lineAnalyses = lines.map(analyzeLineQuality);

  const validLines = lineAnalyses.filter(a => !a.isGarbage);
  const garbageLines = lineAnalyses.filter(a => a.isGarbage);

  const avgScore = validLines.length > 0
    ? validLines.reduce((sum, a) => sum + a.score, 0) / validLines.length
    : 0;

  const garbageRatio = garbageLines.length / lines.length;

  const issues = [];
  if (garbageRatio > 0.5) issues.push('More than 50% of lines are garbage');
  if (avgScore < 50) issues.push('Low average line quality');
  if (validLines.length < 5) issues.push('Very few valid lines');

  // Check for common OCR problems
  const hasPrices = /\$?[\d,]+\.\d{2}/.test(text);
  const hasHeaders = /DESCRIPTION|QTY|QUANTITY|PRICE|TOTAL/i.test(text);

  if (!hasPrices) issues.push('No price-like values found');
  if (!hasHeaders) issues.push('No standard invoice headers found');

  let quality = 'good';
  if (avgScore < 40 || garbageRatio > 0.5) quality = 'poor';
  else if (avgScore < 60 || garbageRatio > 0.3) quality = 'fair';

  return {
    score: Math.round(avgScore),
    quality,
    totalLines: lines.length,
    validLineCount: validLines.length,
    garbageLineCount: garbageLines.length,
    garbageRatio: Math.round(garbageRatio * 100),
    issues,
    hasPrices,
    hasHeaders
  };
}

/**
 * Clean and filter text, removing garbage lines
 * @param {string} text - Text to clean
 * @param {Object} options - Cleaning options
 * @returns {Object} Cleaned text and metadata
 */
function cleanText(text, options = {}) {
  const { aggressive = false, minLineScore = 30 } = options;

  const lines = text.split('\n');
  const cleanedLines = [];
  const removedLines = [];

  for (const line of lines) {
    const analysis = analyzeLineQuality(line);

    if (analysis.isGarbage && aggressive) {
      removedLines.push({ line, reason: analysis.reasons.join(', ') });
      continue;
    }

    if (analysis.score < minLineScore && aggressive) {
      removedLines.push({ line, reason: `Low score: ${analysis.score}` });
      continue;
    }

    // Apply basic cleanup
    let cleaned = line
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .replace(/^\s+|\s+$/g, '');  // Trim

    // Fix common OCR errors in numbers (only in specific contexts)
    cleaned = cleaned
      .replace(/(\d)O(\d)/g, '$10$2')  // O -> 0 between digits
      .replace(/(\d)l(\d)/g, '$11$2')  // l -> 1 between digits
      .replace(/\|(\d)/g, '1$1')       // | -> 1 before digit
      .replace(/(\d)\|/g, '$11');      // | -> 1 after digit

    cleanedLines.push(cleaned);
  }

  return {
    text: cleanedLines.join('\n'),
    originalLineCount: lines.length,
    cleanedLineCount: cleanedLines.length,
    removedLineCount: removedLines.length,
    removedLines: aggressive ? removedLines : []
  };
}

/**
 * Detect if text appears to be from a scanned/OCR'd document
 * vs native digital PDF
 * @param {string} text - Text to analyze
 * @returns {Object} Detection result
 */
function detectOCRSource(text) {
  const indicators = {
    isOCR: false,
    confidence: 50,
    reasons: []
  };

  if (!text) return indicators;

  // Check for common OCR artifacts
  const ocrArtifacts = [
    /[|l1]{3,}/,  // Repeated l/1/|
    /\b[A-Z][a-z][A-Z][a-z]\b/,  // Mixed case in middle of word
    /\d{2,}\s+\d{2,}\s+\d{2,}/,  // Numbers that should be together
    /[^\s]{30,}/  // Very long strings without spaces
  ];

  for (const pattern of ocrArtifacts) {
    if (pattern.test(text)) {
      indicators.confidence += 10;
      indicators.reasons.push('Contains OCR artifacts');
      break;
    }
  }

  // Check for consistent spacing (native PDFs often have clean spacing)
  const irregularSpacing = /[a-zA-Z]  [a-zA-Z]/g;  // Double space in middle of text
  const matches = text.match(irregularSpacing) || [];
  if (matches.length > 5) {
    indicators.confidence += 15;
    indicators.reasons.push('Irregular spacing patterns');
  }

  // Check for letter substitutions
  const possibleSubstitutions = /[0O5S8B]{2,}/;  // Likely OCR confusion
  if (possibleSubstitutions.test(text.toUpperCase())) {
    indicators.confidence += 10;
    indicators.reasons.push('Possible letter/number substitutions');
  }

  indicators.isOCR = indicators.confidence > 60;

  return indicators;
}

/**
 * Merge multi-line items that were split by OCR
 * @param {Array<string>} lines - Array of text lines
 * @returns {Array<string>} Merged lines
 */
function mergeMultiLineItems(lines) {
  const merged = [];
  let buffer = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (buffer) {
        merged.push(buffer);
        buffer = '';
      }
      continue;
    }

    // Check if this line looks like a continuation
    const isContinuation =
      !line.match(/^\d/) &&  // Doesn't start with number
      !line.match(/^[CFPD]\s+\d/i) &&  // Doesn't start with category code
      !line.match(/\$?[\d,]+\.\d{2}\s*$/);  // Doesn't end with price

    const endsWithPrice = /\$?[\d,]+\.\d{2}\s*$/.test(line);
    const startsWithCode = /^(\d{5,8}|[CFPD]\s+\d)/i.test(line);

    if (buffer && isContinuation && !startsWithCode) {
      // This is a continuation of the previous line
      buffer += ' ' + line;
    } else {
      // This is a new item
      if (buffer) {
        merged.push(buffer);
      }
      buffer = line;
    }

    // If line ends with price, it's complete
    if (endsWithPrice) {
      if (buffer) {
        merged.push(buffer);
        buffer = '';
      }
    }
  }

  if (buffer) {
    merged.push(buffer);
  }

  return merged;
}

/**
 * Normalize unit of measure abbreviations
 * @param {string} unit - Unit abbreviation
 * @returns {string} Normalized unit
 */
function normalizeUnit(unit) {
  if (!unit) return '';

  const normalized = unit.toUpperCase().trim();

  const unitMap = {
    // Cases
    'CS': 'CS', 'CASE': 'CS', 'CASES': 'CS', 'CSE': 'CS',
    // Each
    'EA': 'EA', 'EACH': 'EA', 'PC': 'EA', 'PCS': 'EA', 'PIECE': 'EA', 'PIECES': 'EA',
    // Pounds
    'LB': 'LB', 'LBS': 'LB', 'POUND': 'LB', 'POUNDS': 'LB', '#': 'LB',
    // Ounces
    'OZ': 'OZ', 'OUNCE': 'OZ', 'OUNCES': 'OZ',
    // Gallons
    'GAL': 'GAL', 'GALLON': 'GAL', 'GALLONS': 'GAL', 'GL': 'GAL',
    // Count
    'CT': 'CT', 'COUNT': 'CT',
    // Pack
    'PK': 'PK', 'PACK': 'PK', 'PKG': 'PK', 'PACKAGE': 'PK',
    // Box
    'BX': 'BX', 'BOX': 'BX', 'BOXES': 'BX',
    // Dozen
    'DZ': 'DZ', 'DOZ': 'DZ', 'DOZEN': 'DZ',
    // Quart/Pint
    'QT': 'QT', 'QUART': 'QT', 'PT': 'PT', 'PINT': 'PT',
    // Bag
    'BG': 'BG', 'BAG': 'BG', 'BAGS': 'BG'
  };

  return unitMap[normalized] || normalized;
}

/**
 * Extract and normalize pack size
 * @param {string} text - Text containing pack size
 * @returns {Object|null} Normalized pack size
 */
function extractPackSize(text) {
  if (!text) return null;

  // Pattern: 4/10LB, 12/16OZ, 6-1GAL, etc.
  const patterns = [
    /(\d+)\s*[\/\-x]\s*(\d+\.?\d*)\s*(LB|LBS|OZ|GAL|CT|PK|EA|QT|PT|ML|L|KG|G)/i,
    /(\d+)\s*(LB|LBS|OZ|GAL|CT|PK|EA)\s*(CS|CASE|BX|BOX)?/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        count: parseInt(match[1], 10),
        size: match[2] ? parseFloat(match[2]) : null,
        unit: normalizeUnit(match[3] || match[2]),
        raw: match[0]
      };
    }
  }

  return null;
}

module.exports = {
  analyzeLineQuality,
  analyzeTextQuality,
  cleanText,
  detectOCRSource,
  mergeMultiLineItems,
  normalizeUnit,
  extractPackSize,
  GARBAGE_PATTERNS,
  VALID_CONTENT_PATTERNS
};
