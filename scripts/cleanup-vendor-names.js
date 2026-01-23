#!/usr/bin/env node
/**
 * Cleanup script to fix garbage vendor names in the database
 *
 * Run with: node scripts/cleanup-vendor-names.js
 *
 * This script:
 * 1. Finds all ingestion_runs with garbage vendor names
 * 2. Updates them to "Unknown Vendor" or a cleaned version
 * 3. Specifically handles known vendors (Sysco, Cintas, US Foods)
 */

const Database = require('better-sqlite3');
const path = require('path');

// Database path - same as used in database.js
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'database.sqlite');

console.log(`[Cleanup] Using database: ${DATABASE_PATH}`);

const db = new Database(DATABASE_PATH);

// Legal text keywords that indicate garbage vendor names
const LEGAL_KEYWORDS = ['TRUST', 'CLAIM', 'COMMODITY', 'RETAINS', 'PURSUANT', 'AGREEMENT',
                        'LIABILITY', 'DISCLAIMER', 'TERMS', 'CONDITIONS', 'MERCHANDISE',
                        'SELLER', 'BUYER', 'INVOICE NUMBER', 'PAGE'];

/**
 * Sanitize a vendor name
 */
function sanitizeVendorName(name) {
  if (!name || typeof name !== 'string') return "Unknown Vendor";
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 60) return "Unknown Vendor";

  const upperName = trimmed.toUpperCase();

  // Reject if it looks like legal text
  if (LEGAL_KEYWORDS.some(kw => upperName.includes(kw))) return "Unknown Vendor";

  // Reject if all caps and more than 6 words (likely legal text)
  if (trimmed === trimmed.toUpperCase() && trimmed.split(/\s+/).length > 6) return "Unknown Vendor";

  // Reject if it doesn't contain at least one letter
  if (!/[a-zA-Z]/.test(trimmed)) return "Unknown Vendor";

  // Replace known vendor patterns with clean names
  if (/SYSCO/i.test(upperName)) return "Sysco";
  if (/CINTAS/i.test(upperName)) return "Cintas";
  if (/US\s*FOODS/i.test(upperName)) return "US Foods";

  return trimmed;
}

// Get all distinct vendor names
const vendors = db.prepare(`
  SELECT DISTINCT vendor_name FROM ingestion_runs WHERE vendor_name IS NOT NULL
`).all();

console.log(`[Cleanup] Found ${vendors.length} distinct vendor names`);

// Find ones that need cleanup
const toUpdate = [];
for (const { vendor_name } of vendors) {
  const cleaned = sanitizeVendorName(vendor_name);
  if (cleaned !== vendor_name) {
    toUpdate.push({ original: vendor_name, cleaned });
  }
}

console.log(`[Cleanup] ${toUpdate.length} vendor names need cleanup:`);
for (const { original, cleaned } of toUpdate) {
  console.log(`  "${original.substring(0, 50)}..." -> "${cleaned}"`);
}

if (toUpdate.length === 0) {
  console.log('[Cleanup] No cleanup needed!');
  process.exit(0);
}

// Ask for confirmation if running interactively
if (process.argv.includes('--dry-run')) {
  console.log('[Cleanup] Dry run - no changes made');
  process.exit(0);
}

// Perform the updates
const updateStmt = db.prepare(`
  UPDATE ingestion_runs SET vendor_name = ? WHERE vendor_name = ?
`);

let totalUpdated = 0;
for (const { original, cleaned } of toUpdate) {
  const result = updateStmt.run(cleaned, original);
  console.log(`[Cleanup] Updated ${result.changes} rows: "${original.substring(0, 30)}..." -> "${cleaned}"`);
  totalUpdated += result.changes;
}

console.log(`[Cleanup] Complete! Updated ${totalUpdated} total rows.`);

db.close();
