/**
 * Invoice Parsing V2 - Vendor Detection
 * Identifies the vendor from invoice text to route to appropriate parser
 */

/**
 * Vendor detection patterns with confidence scores
 */
const VENDOR_PATTERNS = {
  cintas: {
    patterns: [
      { regex: /CINTAS\s+CORPORATION/i, score: 95 },
      { regex: /CINTAS\s+NO\.\s*\d/i, score: 90 },
      { regex: /X\d{5}/g, score: 70, minMatches: 3 },  // Multiple SKU codes
      { regex: /UNIFORM\s+ADVANTAGE/i, score: 85 },
      { regex: /EMP#\/LOCK#.*MATERIAL/i, score: 90 },
      { regex: /SUBTOTAL\s*-\s*[\d,\.]+/g, score: 60, minMatches: 2 },  // Employee subtotals
      { regex: /TOTAL\s+USD/i, score: 80 }
    ],
    name: 'Cintas Corporation'
  },

  sysco: {
    patterns: [
      { regex: /SYSCO\s+CORPORATION/i, score: 95 },
      { regex: /SYSCO\s+FOOD\s+SERVICES/i, score: 95 },
      { regex: /SYSCO/i, score: 70 },
      { regex: /www\.sysco\.com/i, score: 90 }
    ],
    name: 'Sysco Corporation'
  },

  usfoods: {
    patterns: [
      { regex: /US\s+FOODS/i, score: 95 },
      { regex: /USFOODS/i, score: 90 },
      { regex: /www\.usfoods\.com/i, score: 90 }
    ],
    name: 'US Foods'
  },

  aramark: {
    patterns: [
      { regex: /ARAMARK/i, score: 95 },
      { regex: /www\.aramark\.com/i, score: 90 }
    ],
    name: 'Aramark'
  },

  unifirst: {
    patterns: [
      { regex: /UNIFIRST/i, score: 95 },
      { regex: /UNI-?FIRST/i, score: 90 }
    ],
    name: 'UniFirst'
  }
};

/**
 * Detect vendor from normalized invoice text
 * @param {string} normalizedText - Normalized invoice text
 * @returns {{ vendorKey: string, vendorName: string, confidence: number }}
 */
function detectVendor(normalizedText) {
  if (!normalizedText) {
    return { vendorKey: 'generic', vendorName: 'Unknown Vendor', confidence: 0 };
  }

  const results = [];

  for (const [vendorKey, config] of Object.entries(VENDOR_PATTERNS)) {
    let totalScore = 0;
    let matchedPatterns = 0;

    for (const patternConfig of config.patterns) {
      const { regex, score, minMatches = 1 } = patternConfig;

      // Handle global regex (count matches)
      if (regex.global) {
        const matches = normalizedText.match(regex);
        if (matches && matches.length >= minMatches) {
          totalScore += score;
          matchedPatterns++;
        }
      } else {
        if (regex.test(normalizedText)) {
          totalScore += score;
          matchedPatterns++;
        }
      }
    }

    if (matchedPatterns > 0) {
      // Normalize score (average of matched patterns, weighted by count)
      const avgScore = totalScore / matchedPatterns;
      const confidence = Math.min(99, avgScore + (matchedPatterns - 1) * 5);

      results.push({
        vendorKey,
        vendorName: config.name,
        confidence: Math.round(confidence),
        matchedPatterns
      });
    }
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);

  if (results.length > 0 && results[0].confidence >= 50) {
    return results[0];
  }

  return { vendorKey: 'generic', vendorName: 'Unknown Vendor', confidence: 0 };
}

/**
 * Get list of supported vendors
 */
function getSupportedVendors() {
  return Object.entries(VENDOR_PATTERNS).map(([key, config]) => ({
    key,
    name: config.name
  }));
}

module.exports = {
  detectVendor,
  getSupportedVendors,
  VENDOR_PATTERNS
};
