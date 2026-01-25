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
      { regex: /SYSCO\s+EASTERN/i, score: 95 },  // Regional Sysco (e.g., SYSCO EASTERN MARYLAND)
      { regex: /SYSCO\s+\w+,?\s*(LLC|INC|CORP)/i, score: 90 },  // Any "SYSCO [LOCATION], LLC"
      { regex: /SYSCO/i, score: 70 },
      { regex: /www\.sysco\.com/i, score: 90 },
      { regex: /800-SYSCOCS/i, score: 85 },  // Sysco phone number on invoices
      { regex: /800-7\d{2}-2627/i, score: 80 },  // Sysco phone (800-7xx-2627)
      { regex: /SHELLFISH\s+SHIPPER\s+ID/i, score: 80 },  // Sysco seafood field
      { regex: /GROUP\s+TOTAL\*{3,}/i, score: 75 },  // Sysco uses ****GROUP TOTAL**** format
      { regex: /T\/WT=/i, score: 70 },  // Sysco weight notation on line items
      { regex: /DELIVERY\s+COPY/i, score: 60 },  // Common on Sysco invoices
      { regex: /PEACH\s+ORCHARD\s+ROAD/i, score: 85 },  // Sysco Eastern MD address
      // Line item format patterns (Sysco-specific weight/pack formats)
      { regex: /\d+\/\d+\s*LB\s+[A-Z]{2,}/gi, score: 65, minMatches: 3 },  // "12/1 LB PRODUCT" format
      { regex: /ONLY\/?\s*(LB|GAL|EA)/gi, score: 70, minMatches: 2 },  // "ONLY/LB" Sysco notation
      { regex: /\d+\s*CT\s+[A-Z]+.*\d+\/\d+/gi, score: 65, minMatches: 2 },  // "12 CT PRODUCT 4/5" format
      { regex: /FUEL\s+SURCHARGE/i, score: 80 },  // Sysco MISC CHARGES
      { regex: /DROP\s+SIZE\s+ALLOWANCE/i, score: 85 },  // Sysco-specific adjustment
      { regex: /MISC\s+CHARGES/i, score: 75 },  // Sysco section header
      { regex: /INVOICE\s+TOTAL\s+[\d,]+\.\d{2}/i, score: 60 },  // Sysco invoice total format
      { regex: /SYS\s+CLS/gi, score: 70, minMatches: 2 },  // "SYS CLS" in product names (Sysco Classic)
      { regex: /PACKER\s+[A-Z]+\s+[A-Z]+/gi, score: 60, minMatches: 2 }  // "PACKER MAHI MAHI" format
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

  // Debug logging for vendor detection
  if (results.length > 0) {
    console.log(`[VENDOR DETECT] Top candidates: ${results.slice(0, 3).map(r => `${r.vendorKey}(${r.confidence}%)`).join(', ')}`);
  } else {
    // Log a sample of the text to help debug detection failures
    const sample = normalizedText.slice(0, 500).replace(/\n/g, ' ');
    console.log(`[VENDOR DETECT] No vendor patterns matched. Text sample: "${sample.slice(0, 200)}..."`);
  }

  if (results.length > 0 && results[0].confidence >= 50) {
    console.log(`[VENDOR DETECT] Selected: ${results[0].vendorName} (${results[0].confidence}% confidence)`);
    return results[0];
  }

  console.log('[VENDOR DETECT] No confident match found, using generic parser');
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
