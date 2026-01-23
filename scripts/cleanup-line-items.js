#!/usr/bin/env node
/**
 * Cleanup script to remove garbage line items from the database
 *
 * Run with: node scripts/cleanup-line-items.js
 * Dry run: node scripts/cleanup-line-items.js --dry-run
 *
 * This script:
 * 1. Finds line items with garbage descriptions (numeric-only, etc.)
 * 2. Finds line items with unrealistic prices (>$10,000 per unit)
 * 3. Deletes them from invoice_items table
 */

const Database = require('better-sqlite3');
const path = require('path');

// Database path - same as used in database.js
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'database.sqlite');

console.log(`[Cleanup] Using database: ${DATABASE_PATH}`);

const db = new Database(DATABASE_PATH);

/**
 * Check if a description is valid (not garbage)
 */
function isValidDescription(desc) {
  if (!desc || typeof desc !== 'string' || desc.length < 3) return false;

  // Must contain at least one letter
  if (!/[a-zA-Z]/.test(desc)) return false;

  // Must be at least 30% letters
  const letterCount = (desc.match(/[a-zA-Z]/g) || []).length;
  const nonSpaceLength = desc.replace(/\s/g, '').length;
  if (nonSpaceLength > 0 && letterCount / nonSpaceLength < 0.3) return false;

  return true;
}

// Get all line items
const items = db.prepare(`
  SELECT id, run_id, description, unit_price_cents, total_cents
  FROM invoice_items
`).all();

console.log(`[Cleanup] Found ${items.length} total line items`);

// Find garbage items
const toDelete = [];
for (const item of items) {
  const reasons = [];

  // Check description
  if (!isValidDescription(item.description)) {
    reasons.push('invalid description');
  }

  // Check unit price (>$10,000 = 1,000,000 cents)
  if (item.unit_price_cents && item.unit_price_cents > 1000000) {
    reasons.push(`unit price too high ($${(item.unit_price_cents / 100).toFixed(2)})`);
  }

  // Check total (>$100,000 = 10,000,000 cents)
  if (item.total_cents && item.total_cents > 10000000) {
    reasons.push(`total too high ($${(item.total_cents / 100).toFixed(2)})`);
  }

  if (reasons.length > 0) {
    toDelete.push({ ...item, reasons });
  }
}

console.log(`[Cleanup] ${toDelete.length} line items are garbage:`);
for (const item of toDelete.slice(0, 20)) {  // Show first 20
  console.log(`  ID ${item.id}: "${(item.description || '').substring(0, 30)}..." - ${item.reasons.join(', ')}`);
}
if (toDelete.length > 20) {
  console.log(`  ... and ${toDelete.length - 20} more`);
}

if (toDelete.length === 0) {
  console.log('[Cleanup] No cleanup needed!');
  process.exit(0);
}

// Check for dry run
if (process.argv.includes('--dry-run')) {
  console.log('[Cleanup] Dry run - no changes made');
  process.exit(0);
}

// Perform the deletes
const deleteStmt = db.prepare(`DELETE FROM invoice_items WHERE id = ?`);

let totalDeleted = 0;
for (const item of toDelete) {
  deleteStmt.run(item.id);
  totalDeleted++;
}

console.log(`[Cleanup] Complete! Deleted ${totalDeleted} garbage line items.`);

// Also recalculate invoice totals for affected runs
const affectedRuns = [...new Set(toDelete.map(i => i.run_id))];
console.log(`[Cleanup] Recalculating totals for ${affectedRuns.length} affected invoices...`);

const recalcStmt = db.prepare(`
  UPDATE ingestion_runs
  SET invoice_total_cents = (
    SELECT COALESCE(SUM(total_cents), 0) FROM invoice_items WHERE run_id = ?
  )
  WHERE id = ?
`);

for (const runId of affectedRuns) {
  recalcStmt.run(runId, runId);
}

console.log('[Cleanup] Totals recalculated.');

db.close();
