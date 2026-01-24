#!/usr/bin/env node
/**
 * Cleanup Duplicate Invoices Script
 *
 * This script:
 * 1. Identifies duplicate invoices (same file_name for same user)
 * 2. Keeps the oldest one, deletes the duplicates
 * 3. Also identifies invoices with garbage vendor names
 * 4. Recalculates dashboard totals after cleanup
 *
 * Run with: node scripts/cleanup-duplicate-invoices.js
 * Add --dry-run to see what would be deleted without actually deleting
 */

const path = require('path');
const Database = require('better-sqlite3');

// Connect to database
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'revenue-radar.db');
console.log(`Connecting to database: ${dbPath}`);
const db = new Database(dbPath);

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

if (DRY_RUN) {
  console.log('\n🔍 DRY RUN MODE - No changes will be made\n');
}

// =====================================================
// 1. FIND DUPLICATE INVOICES
// =====================================================
console.log('=' .repeat(60));
console.log('STEP 1: Finding Duplicate Invoices');
console.log('=' .repeat(60));

const duplicates = db.prepare(`
  SELECT
    user_id,
    file_name,
    COUNT(*) as count,
    GROUP_CONCAT(id) as ids,
    GROUP_CONCAT(invoice_total_cents) as totals,
    MIN(created_at) as first_created,
    MAX(created_at) as last_created
  FROM ingestion_runs
  WHERE status = 'completed'
    AND file_name IS NOT NULL
    AND file_name != ''
  GROUP BY user_id, file_name
  HAVING COUNT(*) > 1
  ORDER BY count DESC
`).all();

console.log(`\nFound ${duplicates.length} file names with duplicates:\n`);

let totalDuplicateCount = 0;
let idsToDelete = [];

duplicates.forEach(dup => {
  const ids = dup.ids.split(',').map(Number);
  const totals = dup.totals.split(',').map(Number);
  const keepId = ids[0]; // Keep the first (oldest) one
  const deleteIds = ids.slice(1);

  totalDuplicateCount += deleteIds.length;
  idsToDelete.push(...deleteIds);

  if (VERBOSE || duplicates.length <= 20) {
    console.log(`  📄 "${dup.file_name}" (user ${dup.user_id})`);
    console.log(`     ${dup.count} copies found, keeping ID ${keepId}, deleting ${deleteIds.length} copies`);
    console.log(`     Totals: ${totals.map(t => '$' + (t/100).toLocaleString()).join(', ')}`);
  }
});

console.log(`\n📊 Summary: ${totalDuplicateCount} duplicate invoices to delete`);

// =====================================================
// 2. FIND GARBAGE VENDOR NAMES
// =====================================================
console.log('\n' + '=' .repeat(60));
console.log('STEP 2: Finding Garbage Vendor Names');
console.log('=' .repeat(60));

// Common garbage patterns that indicate bad parsing
const garbagePatterns = [
  'THIS COMMODITY',
  'TRUST CLAIM',
  'OVER THESE',
  'THIS DOCUMENT',
  'SIGNATURE',
  'PAGE',
  'HEREBY',
  'AGREEMENT',
  'TERMS AND CONDITIONS',
  'ALL RIGHTS RESERVED'
];

const garbageVendors = db.prepare(`
  SELECT id, user_id, vendor_name, file_name, invoice_total_cents, created_at
  FROM ingestion_runs
  WHERE status = 'completed'
    AND (
      vendor_name LIKE '%THIS COMMODITY%'
      OR vendor_name LIKE '%TRUST CLAIM%'
      OR vendor_name LIKE '%THIS DOCUMENT%'
      OR vendor_name LIKE '%Signature%'
      OR vendor_name LIKE '%PAGE %'
      OR LENGTH(vendor_name) > 100
    )
  ORDER BY created_at DESC
`).all();

console.log(`\nFound ${garbageVendors.length} invoices with garbage vendor names:\n`);

garbageVendors.slice(0, 10).forEach(inv => {
  console.log(`  ID ${inv.id}: "${inv.vendor_name?.substring(0, 60)}..."`);
  console.log(`     File: ${inv.file_name}, Total: $${(inv.invoice_total_cents || 0) / 100}`);
});

if (garbageVendors.length > 10) {
  console.log(`  ... and ${garbageVendors.length - 10} more`);
}

// =====================================================
// 3. FIND SUSPICIOUSLY HIGH TOTALS
// =====================================================
console.log('\n' + '=' .repeat(60));
console.log('STEP 3: Finding Suspiciously High Invoice Totals');
console.log('=' .repeat(60));

// Invoices over $100,000 are suspicious for typical business invoices
const suspiciousInvoices = db.prepare(`
  SELECT id, user_id, vendor_name, file_name, invoice_total_cents, created_at
  FROM ingestion_runs
  WHERE status = 'completed'
    AND invoice_total_cents > 10000000
  ORDER BY invoice_total_cents DESC
  LIMIT 20
`).all();

console.log(`\nFound ${suspiciousInvoices.length} invoices with totals over $100,000:\n`);

suspiciousInvoices.forEach(inv => {
  const total = (inv.invoice_total_cents || 0) / 100;
  console.log(`  ID ${inv.id}: $${total.toLocaleString()}`);
  console.log(`     Vendor: "${inv.vendor_name?.substring(0, 50)}"`);
  console.log(`     File: ${inv.file_name}`);
});

// =====================================================
// 4. DELETE DUPLICATES
// =====================================================
if (idsToDelete.length > 0) {
  console.log('\n' + '=' .repeat(60));
  console.log('STEP 4: Deleting Duplicate Invoices');
  console.log('=' .repeat(60));

  if (DRY_RUN) {
    console.log(`\n🔍 Would delete ${idsToDelete.length} duplicate invoices`);
    console.log(`   IDs: ${idsToDelete.slice(0, 20).join(', ')}${idsToDelete.length > 20 ? '...' : ''}`);
  } else {
    // Delete associated line items first
    const deleteItems = db.prepare(`
      DELETE FROM invoice_items WHERE run_id IN (${idsToDelete.join(',')})
    `);
    const itemsResult = deleteItems.run();
    console.log(`\n✓ Deleted ${itemsResult.changes} associated line items`);

    // Delete the duplicate invoices
    const deleteRuns = db.prepare(`
      DELETE FROM ingestion_runs WHERE id IN (${idsToDelete.join(',')})
    `);
    const runsResult = deleteRuns.run();
    console.log(`✓ Deleted ${runsResult.changes} duplicate invoices`);
  }
}

// =====================================================
// 5. FIX GARBAGE VENDOR NAMES
// =====================================================
if (garbageVendors.length > 0) {
  console.log('\n' + '=' .repeat(60));
  console.log('STEP 5: Fixing Garbage Vendor Names');
  console.log('=' .repeat(60));

  if (DRY_RUN) {
    console.log(`\n🔍 Would fix ${garbageVendors.length} vendor names to "Unknown Vendor"`);
  } else {
    // Update garbage vendor names to "Unknown Vendor"
    const garbageIds = garbageVendors.map(v => v.id);
    const updateVendors = db.prepare(`
      UPDATE ingestion_runs
      SET vendor_name = 'Unknown Vendor'
      WHERE id IN (${garbageIds.join(',')})
    `);
    const updateResult = updateVendors.run();
    console.log(`\n✓ Fixed ${updateResult.changes} garbage vendor names to "Unknown Vendor"`);
  }
}

// =====================================================
// 6. SHOW FINAL STATS
// =====================================================
console.log('\n' + '=' .repeat(60));
console.log('FINAL STATISTICS');
console.log('=' .repeat(60));

const stats = db.prepare(`
  SELECT
    COUNT(*) as total_invoices,
    COUNT(DISTINCT file_name) as unique_files,
    COUNT(DISTINCT user_id) as users_with_invoices,
    SUM(invoice_total_cents) as total_value_cents
  FROM ingestion_runs
  WHERE status = 'completed'
`).get();

console.log(`\nAfter cleanup:`);
console.log(`  Total Invoices: ${stats.total_invoices}`);
console.log(`  Unique Files: ${stats.unique_files}`);
console.log(`  Users: ${stats.users_with_invoices}`);
console.log(`  Total Value: $${((stats.total_value_cents || 0) / 100).toLocaleString()}`);

// Check for any remaining duplicates
const remainingDups = db.prepare(`
  SELECT COUNT(*) as count FROM (
    SELECT file_name, user_id
    FROM ingestion_runs
    WHERE status = 'completed' AND file_name IS NOT NULL
    GROUP BY file_name, user_id
    HAVING COUNT(*) > 1
  )
`).get();

if (remainingDups.count > 0) {
  console.log(`\n⚠️ Warning: ${remainingDups.count} file names still have duplicates`);
} else {
  console.log(`\n✅ No duplicate file names remaining`);
}

console.log('\nDone!');
if (DRY_RUN) {
  console.log('\nTo apply changes, run without --dry-run');
}

db.close();
