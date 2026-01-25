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
      // ===== PATCH 5: SPACED/SPLIT TOKEN PATTERNS =====
      // Handle OCR artifacts where "SYSCO" becomes "S Y S C O" or "S  Y  S  C  O"
      { regex: /S\s*Y\s*S\s*C\s*O/i, score: 85 },  // Spaced letters: "S Y S C O"
      { regex: /S\s*Y\s*S\s*C\s*O[\s\S]{0,40}EASTERN/i, score: 92 },  // Spaced + regional within 40 chars
      { regex: /SYSCO[\s\S]{0,40}(EASTERN|WESTERN|CORPORATION|FOOD|LLC|INC)/i, score: 92 },  // Proximity pattern

      // ===== HIGH CONFIDENCE PATTERNS (90+) =====
      { regex: /SYSCO\s+EASTERN\s+MARYLAND/i, score: 99 },  // Very specific regional
      { regex: /SYSCO\s+CORPORATION/i, score: 95 },
      { regex: /SYSCO\s+FOOD\s+SERVICES/i, score: 95 },
      { regex: /SYSCO\s+EASTERN/i, score: 95 },  // Regional Sysco
      { regex: /SYSCO\s+WESTERN/i, score: 95 },  // Regional Sysco
      { regex: /SYSCO\s+CENTRAL/i, score: 95 },  // Regional Sysco
      { regex: /SYSCO\s+METRO/i, score: 95 },    // Regional Sysco
      { regex: /SYSCO\s+\w+,?\s*(LLC|INC|CORP)/i, score: 92 },  // "SYSCO [LOCATION], LLC"
      { regex: /www\.sysco\.com/i, score: 90 },
      { regex: /800-SYSCOCS/i, score: 90 },  // Sysco phone number on invoices
      { regex: /DROP\s+SIZE\s+ALLOWANCE/i, score: 90 },  // Sysco-specific adjustment (very distinctive)

      // ===== MEDIUM CONFIDENCE PATTERNS (75-89) =====
      { regex: /\bSYSCO\b/i, score: 85 },  // Word "SYSCO" alone (increased from 70)
      { regex: /800-7\d{2}-2627/i, score: 85 },  // Sysco phone (800-7xx-2627)
      { regex: /PEACH\s+ORCHARD\s+ROAD/i, score: 85 },  // Sysco Eastern MD address
      { regex: /SHELLFISH\s+SHIPPER\s+ID/i, score: 82 },  // Sysco seafood field
      { regex: /FUEL\s+SURCHARGE/i, score: 80 },  // Sysco MISC CHARGES
      { regex: /GROUP\s+TOTAL\*{3,}/i, score: 80 },  // Sysco uses ****GROUP TOTAL**** format
      { regex: /MISC\s+CHARGES/i, score: 78 },  // Sysco section header

      // ===== LOWER CONFIDENCE PATTERNS (60-74) =====
      { regex: /T\/WT=/i, score: 72 },  // Sysco weight notation on line items
      { regex: /SYS\s+CLS/gi, score: 72, minMatches: 2 },  // "SYS CLS" in product names (Sysco Classic)
      { regex: /ONLY\/?\s*(LB|GAL|EA)/gi, score: 70, minMatches: 2 },  // "ONLY/LB" Sysco notation
      { regex: /\d+\/\d+\s*LB\s+[A-Z]{2,}/gi, score: 68, minMatches: 3 },  // "12/1 LB PRODUCT" format
      { regex: /\d+\s*CT\s+[A-Z]+.*\d+\/\d+/gi, score: 65, minMatches: 2 },  // "12 CT PRODUCT 4/5" format
      { regex: /PACKER\s+[A-Z]+\s+[A-Z]+/gi, score: 65, minMatches: 2 },  // "PACKER MAHI MAHI" format
      { regex: /DELIVERY\s+COPY/i, score: 62 },  // Common on Sysco invoices
      { regex: /INVOICE\s+TOTAL\s+[\d,]+\.\d{2}/i, score: 60 },  // Sysco invoice total format
      { regex: /CONFIDENTIAL\s+PROPERTY\s+OF\s+SYSCO/i, score: 99 }  // Distinctive header
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
 * @param {Object} options - Optional settings
 * @param {boolean} options.debug - Enable detailed debug logging
 * @returns {{ vendorKey: string, vendorName: string, confidence: number, matchedPatterns: number, matchDetails: Array }}
 */
function detectVendor(normalizedText, options = {}) {
  if (!normalizedText) {
    console.log('[VENDOR DETECT] No text provided');
    return { vendorKey: 'generic', vendorName: 'Unknown Vendor', confidence: 0 };
  }

  // Debug: Log first 300 chars to verify text is properly passed
  console.log(`[VENDOR DETECT] Analyzing ${normalizedText.length} chars of text`);
  console.log(`[VENDOR DETECT] Text sample: "${normalizedText.slice(0, 300).replace(/[\r\n]+/g, ' ')}..."`);

  const results = [];

  for (const [vendorKey, config] of Object.entries(VENDOR_PATTERNS)) {
    let totalScore = 0;
    let matchedPatterns = 0;
    const matchDetails = [];

    for (const patternConfig of config.patterns) {
      const { regex, score, minMatches = 1 } = patternConfig;

      // Handle global regex (count matches)
      if (regex.global) {
        // Reset lastIndex for global regexes
        regex.lastIndex = 0;
        const matches = normalizedText.match(regex);
        if (matches && matches.length >= minMatches) {
          totalScore += score;
          matchedPatterns++;
          matchDetails.push({ pattern: regex.source, score, matchCount: matches.length });
        }
      } else {
        if (regex.test(normalizedText)) {
          totalScore += score;
          matchedPatterns++;
          matchDetails.push({ pattern: regex.source, score, matchCount: 1 });
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
        matchedPatterns,
        totalScore,
        matchDetails
      });
    }
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);

  // Debug logging for vendor detection
  if (results.length > 0) {
    console.log(`[VENDOR DETECT] Top candidates: ${results.slice(0, 3).map(r => `${r.vendorKey}(${r.confidence}%, ${r.matchedPatterns} patterns)`).join(', ')}`);

    // Log detailed match info for top result
    const top = results[0];
    if (top.matchDetails && top.matchDetails.length > 0) {
      console.log(`[VENDOR DETECT] ${top.vendorKey} matched patterns:`);
      top.matchDetails.slice(0, 5).forEach(d => {
        console.log(`  - /${d.pattern}/ (score: ${d.score}, matches: ${d.matchCount})`);
      });
    }
  } else {
    // Log a sample of the text to help debug detection failures
    const sample = normalizedText.slice(0, 500).replace(/\n/g, ' ');
    console.log(`[VENDOR DETECT] WARNING: No vendor patterns matched!`);
    console.log(`[VENDOR DETECT] Text sample: "${sample.slice(0, 200)}..."`);

    // Check if common vendor names exist but weren't matched
    if (/sysco/i.test(normalizedText)) {
      console.log(`[VENDOR DETECT] WARNING: "SYSCO" found in text but patterns didn't match!`);
    }
    if (/cintas/i.test(normalizedText)) {
      console.log(`[VENDOR DETECT] WARNING: "CINTAS" found in text but patterns didn't match!`);
    }
  }

  if (results.length > 0 && results[0].confidence >= 50) {
    console.log(`[VENDOR DETECT] SELECTED: ${results[0].vendorName} (${results[0].confidence}% confidence, ${results[0].matchedPatterns} patterns matched)`);
    return results[0];
  }

  console.log('[VENDOR DETECT] No confident match found (threshold: 50%), using generic parser');
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
