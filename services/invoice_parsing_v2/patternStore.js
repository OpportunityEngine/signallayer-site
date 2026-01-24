/**
 * Pattern Store
 *
 * Stores and retrieves successful parsing patterns to improve
 * accuracy over time. Uses a simple JSON file for persistence.
 *
 * Features:
 * - Store patterns by vendor fingerprint
 * - Track pattern success rates
 * - Suggest best patterns for new invoices
 * - Expire stale patterns
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Storage location
const PATTERN_FILE = path.join(__dirname, '../../data/invoice-patterns.json');

// In-memory cache
let patternCache = null;

/**
 * Default pattern store structure
 */
const DEFAULT_STORE = {
  version: 1,
  lastUpdated: null,
  vendorPatterns: {},     // Patterns by vendor
  genericPatterns: [],    // Patterns that work across vendors
  fingerprintMap: {},     // Map fingerprints to vendor/pattern
  stats: {
    totalParses: 0,
    successfulParses: 0,
    patternsLearned: 0
  }
};

/**
 * Load pattern store from disk
 */
function loadStore() {
  if (patternCache) return patternCache;

  try {
    // Ensure data directory exists
    const dataDir = path.dirname(PATTERN_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (fs.existsSync(PATTERN_FILE)) {
      const data = fs.readFileSync(PATTERN_FILE, 'utf8');
      patternCache = JSON.parse(data);
    } else {
      patternCache = { ...DEFAULT_STORE };
      saveStore();
    }
  } catch (err) {
    console.error('[PATTERN STORE] Error loading:', err.message);
    patternCache = { ...DEFAULT_STORE };
  }

  return patternCache;
}

/**
 * Save pattern store to disk
 */
function saveStore() {
  try {
    patternCache.lastUpdated = new Date().toISOString();
    fs.writeFileSync(PATTERN_FILE, JSON.stringify(patternCache, null, 2));
  } catch (err) {
    console.error('[PATTERN STORE] Error saving:', err.message);
  }
}

/**
 * Generate a fingerprint for an invoice based on its structure
 */
function generateFingerprint(text) {
  const features = [];

  // Extract structural features
  const lines = text.split('\n').filter(l => l.trim());

  // Feature: line count bucket
  const lineCount = lines.length;
  features.push(`lines:${Math.floor(lineCount / 10) * 10}`);

  // Feature: has tabs
  if (text.includes('\t')) features.push('has:tabs');

  // Feature: has pipes
  if (text.includes('|')) features.push('has:pipes');

  // Feature: price pattern
  const priceMatches = text.match(/\$?[\d,]+\.\d{2}/g) || [];
  features.push(`prices:${Math.floor(priceMatches.length / 5) * 5}`);

  // Feature: common headers
  if (/\bQTY\b/i.test(text)) features.push('hdr:qty');
  if (/\bDESCRIPTION\b/i.test(text)) features.push('hdr:desc');
  if (/\bSKU\b|\bITEM\s*#/i.test(text)) features.push('hdr:sku');
  if (/\bPRICE\b/i.test(text)) features.push('hdr:price');

  // Feature: vendor indicators
  if (/SYSCO/i.test(text)) features.push('vendor:sysco');
  if (/CINTAS/i.test(text)) features.push('vendor:cintas');
  if (/US\s*FOODS/i.test(text)) features.push('vendor:usfoods');

  // Create hash
  const featureStr = features.sort().join('|');
  const hash = crypto.createHash('md5').update(featureStr).digest('hex').slice(0, 12);

  return {
    hash,
    features,
    featureStr
  };
}

/**
 * Store a successful parse pattern
 */
function storePattern(parseResult, text, options = {}) {
  const store = loadStore();

  const fingerprint = generateFingerprint(text);
  const vendor = parseResult.vendorKey || parseResult.vendorName || 'unknown';
  const strategy = parseResult.strategy || parseResult.debug?.bestStrategy || 'unknown';
  const confidence = parseResult.confidence?.score || 50;

  // Only store high-confidence patterns
  if (confidence < 60 && !options.force) {
    return { stored: false, reason: 'Low confidence' };
  }

  // Create pattern entry
  const pattern = {
    fingerprint: fingerprint.hash,
    vendor,
    strategy,
    confidence,
    itemCount: parseResult.lineItems?.length || 0,
    totalCents: parseResult.totals?.totalCents || 0,
    features: fingerprint.features,
    createdAt: new Date().toISOString(),
    successCount: 1,
    lastUsed: new Date().toISOString()
  };

  // Store by vendor
  if (!store.vendorPatterns[vendor]) {
    store.vendorPatterns[vendor] = [];
  }

  // Check if similar pattern exists
  const existingIdx = store.vendorPatterns[vendor].findIndex(
    p => p.fingerprint === fingerprint.hash
  );

  if (existingIdx >= 0) {
    // Update existing pattern
    const existing = store.vendorPatterns[vendor][existingIdx];
    existing.successCount++;
    existing.lastUsed = new Date().toISOString();
    existing.confidence = Math.max(existing.confidence, confidence);
  } else {
    // Add new pattern
    store.vendorPatterns[vendor].push(pattern);
    store.stats.patternsLearned++;
  }

  // Map fingerprint to pattern
  store.fingerprintMap[fingerprint.hash] = {
    vendor,
    strategy,
    confidence
  };

  store.stats.totalParses++;
  if (confidence >= 70) store.stats.successfulParses++;

  saveStore();

  return {
    stored: true,
    fingerprint: fingerprint.hash,
    vendor,
    strategy,
    isNew: existingIdx < 0
  };
}

/**
 * Find matching patterns for an invoice
 */
function findPatterns(text) {
  const store = loadStore();
  const fingerprint = generateFingerprint(text);

  const matches = [];

  // Check exact fingerprint match
  if (store.fingerprintMap[fingerprint.hash]) {
    matches.push({
      type: 'exact',
      confidence: 95,
      ...store.fingerprintMap[fingerprint.hash]
    });
  }

  // Check vendor patterns with similar features
  for (const [vendor, patterns] of Object.entries(store.vendorPatterns)) {
    for (const pattern of patterns) {
      // Calculate feature overlap
      const overlap = pattern.features.filter(f => fingerprint.features.includes(f));
      const similarity = overlap.length / Math.max(pattern.features.length, fingerprint.features.length);

      if (similarity >= 0.6) {
        matches.push({
          type: 'similar',
          vendor,
          strategy: pattern.strategy,
          confidence: Math.round(similarity * pattern.confidence),
          similarity: Math.round(similarity * 100),
          successCount: pattern.successCount
        });
      }
    }
  }

  // Sort by confidence
  matches.sort((a, b) => b.confidence - a.confidence);

  return {
    fingerprint: fingerprint.hash,
    features: fingerprint.features,
    matches: matches.slice(0, 5),
    bestMatch: matches[0] || null,
    suggestion: matches[0] ? {
      useVendor: matches[0].vendor,
      useStrategy: matches[0].strategy,
      confidence: matches[0].confidence
    } : null
  };
}

/**
 * Get recommended parsing approach based on stored patterns
 */
function getRecommendation(text) {
  const result = findPatterns(text);

  if (!result.bestMatch) {
    return {
      hasRecommendation: false,
      strategies: ['adaptive', 'enhanced', 'generic'],
      reason: 'No matching patterns found'
    };
  }

  const strategies = [];

  // If we know the vendor, prioritize vendor parser
  if (result.bestMatch.vendor !== 'unknown') {
    strategies.push(result.bestMatch.vendor);
  }

  // If we know a successful strategy, prioritize it
  if (result.bestMatch.strategy) {
    strategies.push(result.bestMatch.strategy);
  }

  // Always include fallbacks
  strategies.push('adaptive', 'enhanced', 'generic');

  return {
    hasRecommendation: true,
    vendor: result.bestMatch.vendor,
    strategies: [...new Set(strategies)],
    confidence: result.bestMatch.confidence,
    fingerprint: result.fingerprint
  };
}

/**
 * Get store statistics
 */
function getStats() {
  const store = loadStore();

  const vendorCounts = {};
  for (const [vendor, patterns] of Object.entries(store.vendorPatterns)) {
    vendorCounts[vendor] = patterns.length;
  }

  return {
    version: store.version,
    lastUpdated: store.lastUpdated,
    totalPatterns: Object.values(store.vendorPatterns).reduce((sum, p) => sum + p.length, 0),
    vendorCounts,
    stats: store.stats,
    fingerprintCount: Object.keys(store.fingerprintMap).length
  };
}

/**
 * Clear old/stale patterns
 */
function cleanupPatterns(maxAgeDays = 90) {
  const store = loadStore();
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
  let removed = 0;

  for (const [vendor, patterns] of Object.entries(store.vendorPatterns)) {
    store.vendorPatterns[vendor] = patterns.filter(p => {
      const lastUsed = new Date(p.lastUsed || p.createdAt);
      if (lastUsed < cutoff && p.successCount < 5) {
        removed++;
        delete store.fingerprintMap[p.fingerprint];
        return false;
      }
      return true;
    });
  }

  if (removed > 0) {
    saveStore();
  }

  return { removed };
}

/**
 * Export patterns for backup/sharing
 */
function exportPatterns() {
  const store = loadStore();
  return JSON.stringify(store, null, 2);
}

/**
 * Import patterns from backup
 */
function importPatterns(jsonStr, options = { merge: true }) {
  try {
    const imported = JSON.parse(jsonStr);
    const store = loadStore();

    if (options.merge) {
      // Merge patterns
      for (const [vendor, patterns] of Object.entries(imported.vendorPatterns || {})) {
        if (!store.vendorPatterns[vendor]) {
          store.vendorPatterns[vendor] = [];
        }
        for (const pattern of patterns) {
          const exists = store.vendorPatterns[vendor].some(
            p => p.fingerprint === pattern.fingerprint
          );
          if (!exists) {
            store.vendorPatterns[vendor].push(pattern);
            store.fingerprintMap[pattern.fingerprint] = {
              vendor,
              strategy: pattern.strategy,
              confidence: pattern.confidence
            };
          }
        }
      }
    } else {
      // Replace entirely
      patternCache = imported;
    }

    saveStore();
    return { success: true, patterns: getStats().totalPatterns };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  generateFingerprint,
  storePattern,
  findPatterns,
  getRecommendation,
  getStats,
  cleanupPatterns,
  exportPatterns,
  importPatterns,
  loadStore,
  saveStore
};
