#!/usr/bin/env node
/**
 * Test script for user_id trace logging and audit endpoint
 *
 * Run: node test-user-id-trace.js
 */

const db = require('./database');

console.log('\n=== User ID Trace & Audit Endpoint Test ===\n');

// Initialize database
const database = db.getDatabase();

// Check if we have any ingestion_runs
const totalRuns = database.prepare('SELECT COUNT(*) as count FROM ingestion_runs').get();
console.log(`📊 Total ingestion_runs: ${totalRuns.count}`);

if (totalRuns.count === 0) {
  console.log('\n⚠️  No ingestion_runs found. Create some test data first.');
  console.log('   You can upload an invoice via the UI or run email monitor checks.\n');
  process.exit(0);
}

// Count by user_id
console.log('\n📋 Breakdown by user_id:');
const countsByUser = database.prepare(`
  SELECT
    user_id,
    u.email,
    u.name,
    COUNT(*) as count
  FROM ingestion_runs ir
  LEFT JOIN users u ON ir.user_id = u.id
  GROUP BY user_id
  ORDER BY count DESC
`).all();

countsByUser.forEach(row => {
  const userInfo = row.email ? `${row.email} (${row.name})` : 'NULL';
  console.log(`   User ID ${row.user_id}: ${row.count} invoices - ${userInfo}`);
});

// Check for NULL user_id
const nullCount = database.prepare('SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id IS NULL').get();
if (nullCount.count > 0) {
  console.log(`\n⚠️  WARNING: ${nullCount.count} ingestion_runs have NULL user_id!`);
  console.log('   This should not happen with the new guardrails.');
} else {
  console.log('\n✅ No NULL user_id found - guardrails are working!');
}

// Breakdown by source
console.log('\n📈 Breakdown by source:');
const sourceBreakdown = database.prepare(`
  SELECT
    CASE
      WHEN run_id LIKE 'email-%' THEN 'email_autopilot'
      WHEN run_id LIKE 'ext-%' THEN 'browser_extension'
      ELSE 'manual_upload'
    END as source,
    COUNT(*) as count,
    SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END) as null_user_count
  FROM ingestion_runs
  GROUP BY source
`).all();

sourceBreakdown.forEach(row => {
  const nullWarning = row.null_user_count > 0 ? ` ⚠️  (${row.null_user_count} with NULL user_id)` : '';
  console.log(`   ${row.source}: ${row.count} invoices${nullWarning}`);
});

// Recent inserts
console.log('\n🕒 Recent 5 inserts:');
const recentInserts = database.prepare(`
  SELECT
    ir.run_id,
    ir.user_id,
    u.email,
    ir.vendor_name,
    ir.status,
    ir.created_at,
    CASE
      WHEN ir.run_id LIKE 'email-%' THEN 'email_autopilot'
      WHEN ir.run_id LIKE 'ext-%' THEN 'browser_extension'
      ELSE 'manual_upload'
    END as source
  FROM ingestion_runs ir
  LEFT JOIN users u ON ir.user_id = u.id
  ORDER BY ir.created_at DESC
  LIMIT 5
`).all();

recentInserts.forEach(row => {
  const userInfo = row.email || 'NULL_USER';
  console.log(`   [${row.source}] ${row.run_id.substring(0, 30)}... → User ${row.user_id} (${userInfo})`);
  console.log(`      Vendor: ${row.vendor_name}, Status: ${row.status}, Created: ${row.created_at}`);
});

// Summary for endpoint
console.log('\n=== Audit Endpoint Data ===');
console.log(`Total invoices: ${totalRuns.count}`);
console.log(`Unique users: ${countsByUser.filter(r => r.user_id !== null).length}`);
console.log(`NULL user_id: ${nullCount.count} (${((nullCount.count / totalRuns.count) * 100).toFixed(2)}%)`);

console.log('\n✅ Test complete!');
console.log('\n📝 To see trace logs, check your server logs:');
console.log('   grep "USER_ID_TRACE" logs/server.log');
console.log('\n🔗 To access the audit endpoint:');
console.log('   GET http://localhost:5050/api/debug/user-id-audit');
console.log('   (Requires admin or manager role)\n');
