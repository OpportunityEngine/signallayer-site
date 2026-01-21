#!/usr/bin/env node

/**
 * verify-user-id-attribution.js
 * 
 * Verification script to check user_id attribution in the database.
 * Validates that all invoices and email monitors have proper user ownership.
 * 
 * Usage:
 *   node scripts/verify-user-id-attribution.js
 * 
 * This script:
 *   - Counts records by user_id
 *   - Finds any NULL user_id (should be 0)
 *   - Shows recent inserts
 *   - Checks that triggers exist
 *   - Generates summary report
 */

const sqlite3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Database path
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'revenue-radar.db');

if (!fs.existsSync(DB_PATH)) {
  console.error(`Error: Database not found at ${DB_PATH}`);
  process.exit(1);
}

const db = new sqlite3(DB_PATH);

console.log('\n' + '='.repeat(70));
console.log('USER_ID ATTRIBUTION VERIFICATION REPORT');
console.log('='.repeat(70));
console.log(`Database: ${DB_PATH}`);
console.log(`Generated: ${new Date().toISOString()}\n`);

// ===== SECTION 1: INGESTION_RUNS ANALYSIS =====
console.log('\n[1] INGESTION_RUNS TABLE ANALYSIS');
console.log('-'.repeat(70));

try {
  // Check for NULL user_id
  const nullCount = db.prepare('SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id IS NULL').get();
  console.log(`✓ Records with NULL user_id: ${nullCount.count}`);
  
  if (nullCount.count > 0) {
    console.log('  WARNING: Found NULL user_id values (should be 0 after migration)');
    const nullRecords = db.prepare(`
      SELECT id, run_id, user_id, created_at 
      FROM ingestion_runs 
      WHERE user_id IS NULL 
      LIMIT 5
    `).all();
    nullRecords.forEach(r => {
      console.log(`    - ID ${r.id}: ${r.run_id} (created: ${r.created_at})`);
    });
  }

  // Count records by user_id
  console.log('\n✓ Records by user_id (top 10):');
  const byUser = db.prepare(`
    SELECT user_id, COUNT(*) as count 
    FROM ingestion_runs 
    GROUP BY user_id 
    ORDER BY count DESC 
    LIMIT 10
  `).all();
  
  byUser.forEach(row => {
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(row.user_id);
    const email = user ? user.email : '(user not found)';
    console.log(`    - User ${row.user_id}: ${row.count} invoices (${email})`);
  });

  // Recent inserts
  console.log('\n✓ Recent ingestion_runs (last 5):');
  const recent = db.prepare(`
    SELECT id, run_id, user_id, vendor_name, status, created_at 
    FROM ingestion_runs 
    ORDER BY created_at DESC 
    LIMIT 5
  `).all();
  
  recent.forEach(r => {
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(r.user_id);
    const userEmail = user ? user.email : '(unknown)';
    console.log(`    - ${r.created_at}: ${r.run_id} (user: ${r.user_id} ${userEmail})`);
  });

  // Total count
  const totalCount = db.prepare('SELECT COUNT(*) as count FROM ingestion_runs').get();
  console.log(`\n✓ Total ingestion_runs: ${totalCount.count}`);

} catch (error) {
  console.error(`✗ Error querying ingestion_runs: ${error.message}`);
}

// ===== SECTION 2: EMAIL_MONITORS ANALYSIS =====
console.log('\n[2] EMAIL_MONITORS TABLE ANALYSIS');
console.log('-'.repeat(70));

try {
  // Check for NULL user_id
  const nullCount = db.prepare('SELECT COUNT(*) as count FROM email_monitors WHERE user_id IS NULL').get();
  console.log(`✓ Records with NULL user_id: ${nullCount.count}`);
  
  if (nullCount.count > 0) {
    console.log('  WARNING: Found NULL user_id values (should be 0 after migration)');
    const nullRecords = db.prepare(`
      SELECT id, email_address, user_id, created_at 
      FROM email_monitors 
      WHERE user_id IS NULL 
      LIMIT 5
    `).all();
    nullRecords.forEach(r => {
      console.log(`    - ID ${r.id}: ${r.email_address} (created: ${r.created_at})`);
    });
  }

  // Count records by user_id
  console.log('\n✓ Monitors by user_id:');
  const byUser = db.prepare(`
    SELECT user_id, COUNT(*) as count 
    FROM email_monitors 
    GROUP BY user_id 
    ORDER BY count DESC
  `).all();
  
  byUser.forEach(row => {
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(row.user_id);
    const email = user ? user.email : '(user not found)';
    console.log(`    - User ${row.user_id}: ${row.count} monitors (${email})`);
  });

  // Total count
  const totalCount = db.prepare('SELECT COUNT(*) as count FROM email_monitors').get();
  console.log(`\n✓ Total email_monitors: ${totalCount.count}`);

} catch (error) {
  console.error(`✗ Error querying email_monitors: ${error.message}`);
}

// ===== SECTION 3: TRIGGER VERIFICATION =====
console.log('\n[3] DATABASE TRIGGERS VERIFICATION');
console.log('-'.repeat(70));

try {
  const triggers = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='trigger' 
    AND (name LIKE '%user_id%' OR name LIKE '%ingestion%' OR name LIKE '%email_monitors%')
    ORDER BY name
  `).all();

  if (triggers.length === 0) {
    console.log('✗ No user_id enforcement triggers found!');
  } else {
    console.log(`✓ Found ${triggers.length} triggers:`);
    triggers.forEach(t => {
      console.log(`    - ${t.name}`);
    });
  }

  // Verify specific triggers exist
  const expectedTriggers = [
    'enforce_ingestion_runs_user_id',
    'enforce_ingestion_runs_user_id_update',
    'enforce_email_monitors_user_id',
    'enforce_email_monitors_user_id_update'
  ];

  console.log('\n✓ Trigger status:');
  expectedTriggers.forEach(triggerName => {
    const exists = triggers.some(t => t.name === triggerName);
    const status = exists ? '✓' : '✗';
    console.log(`    ${status} ${triggerName}`);
  });

} catch (error) {
  console.error(`✗ Error checking triggers: ${error.message}`);
}

// ===== SECTION 4: INVOICE_ITEMS ANALYSIS =====
console.log('\n[4] INVOICE_ITEMS TABLE ANALYSIS');
console.log('-'.repeat(70));

try {
  // Check orphaned items (run_id not in ingestion_runs)
  const orphaned = db.prepare(`
    SELECT COUNT(*) as count 
    FROM invoice_items ii
    WHERE ii.run_id NOT IN (SELECT id FROM ingestion_runs)
  `).get();

  console.log(`✓ Items with missing run_id reference: ${orphaned.count}`);

  // Check total items count
  const totalCount = db.prepare('SELECT COUNT(*) as count FROM invoice_items').get();
  console.log(`✓ Total invoice_items: ${totalCount.count}`);

  // Sample items with user ownership via run_id
  console.log('\n✓ Recent items (with user ownership):');
  const recent = db.prepare(`
    SELECT ii.id, ii.description, ir.user_id, ir.created_at
    FROM invoice_items ii
    JOIN ingestion_runs ir ON ii.run_id = ir.id
    ORDER BY ir.created_at DESC
    LIMIT 3
  `).all();
  
  recent.forEach(r => {
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(r.user_id);
    const userEmail = user ? user.email : '(unknown)';
    console.log(`    - ${r.id}: ${r.description.substring(0, 40)}... (user: ${r.user_id} ${userEmail})`);
  });

} catch (error) {
  console.error(`✗ Error querying invoice_items: ${error.message}`);
}

// ===== SECTION 5: EMAIL_PROCESSING_LOG ANALYSIS =====
console.log('\n[5] EMAIL_PROCESSING_LOG TABLE ANALYSIS');
console.log('-'.repeat(70));

try {
  // Check status distribution
  const statuses = db.prepare(`
    SELECT status, COUNT(*) as count 
    FROM email_processing_log 
    GROUP BY status 
    ORDER BY count DESC
  `).all();

  console.log(`✓ Processing log status distribution:`);
  statuses.forEach(row => {
    console.log(`    - ${row.status}: ${row.count}`);
  });

  // Total count
  const totalCount = db.prepare('SELECT COUNT(*) as count FROM email_processing_log').get();
  console.log(`\n✓ Total log entries: ${totalCount.count}`);

} catch (error) {
  // Table might not exist
  console.log(`⚠ Email processing log not available: ${error.message}`);
}

// ===== SECTION 6: SUMMARY & RECOMMENDATIONS =====
console.log('\n[6] SUMMARY & RECOMMENDATIONS');
console.log('-'.repeat(70));

try {
  const ingestionNulls = db.prepare('SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id IS NULL').get().count;
  const monitorNulls = db.prepare('SELECT COUNT(*) as count FROM email_monitors WHERE user_id IS NULL').get().count;
  const triggersExist = db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='trigger' AND name LIKE '%user_id%'").get().count;

  console.log('\n✓ STATUS:');
  
  if (ingestionNulls === 0 && monitorNulls === 0) {
    console.log('  ✓ All invoices have user_id set');
    console.log('  ✓ All email monitors have user_id set');
  } else {
    console.log(`  ✗ Found ${ingestionNulls + monitorNulls} records with NULL user_id`);
  }

  if (triggersExist >= 4) {
    console.log('  ✓ Database triggers enforcing user_id are in place');
  } else {
    console.log(`  ✗ Only ${triggersExist} user_id triggers found (expected 4)`);
  }

  console.log('\n✓ NEXT STEPS:');
  if (ingestionNulls > 0 || monitorNulls > 0) {
    console.log('  1. Run: node scripts/fix-user-id-attribution.js');
    console.log('  2. Then re-run this script to verify the fix');
  } else {
    console.log('  ✓ Database is in good shape! No fixes needed.');
    console.log('  ✓ User_id attribution guardrails are working correctly.');
  }

} catch (error) {
  console.error(`✗ Error generating summary: ${error.message}`);
}

console.log('\n' + '='.repeat(70) + '\n');

db.close();
