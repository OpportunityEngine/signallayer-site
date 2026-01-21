#!/usr/bin/env node

/**
 * Test script for user_id guardrails migration
 * Verifies that the database correctly prevents NULL user_id values
 */

const { initDatabase, getDatabase } = require('./database.js');

console.log('🧪 Testing user_id Guardrails Migration');
console.log('=======================================');
console.log('');

// Initialize database (will run migration if needed)
initDatabase();
const db = getDatabase();

console.log('');
console.log('📊 Current State:');
console.log('');

// Check ingestion_runs
const invoiceStats = db.prepare(`
  SELECT
    COUNT(*) as total,
    COUNT(user_id) as with_user_id,
    COUNT(*) - COUNT(user_id) as nulls
  FROM ingestion_runs
`).get();

console.log(`Ingestion Runs:`);
console.log(`  Total: ${invoiceStats.total}`);
console.log(`  With user_id: ${invoiceStats.with_user_id}`);
console.log(`  NULL user_id: ${invoiceStats.nulls} ${invoiceStats.nulls === 0 ? '✅' : '❌'}`);
console.log('');

// Check email_monitors
const monitorStats = db.prepare(`
  SELECT
    COUNT(*) as total,
    COUNT(user_id) as with_user_id,
    COUNT(*) - COUNT(user_id) as nulls
  FROM email_monitors
`).get();

console.log(`Email Monitors:`);
console.log(`  Total: ${monitorStats.total}`);
console.log(`  With user_id: ${monitorStats.with_user_id}`);
console.log(`  NULL user_id: ${monitorStats.nulls} ${monitorStats.nulls === 0 ? '✅' : '❌'}`);
console.log('');

// Check triggers exist
const triggers = db.prepare(`
  SELECT name, tbl_name
  FROM sqlite_master
  WHERE type = 'trigger'
  AND name LIKE '%enforce%user_id%'
  ORDER BY name
`).all();

console.log('Database Triggers:');
triggers.forEach(trigger => {
  console.log(`  ✅ ${trigger.name} (on ${trigger.tbl_name})`);
});
console.log('');

// Test enforcement
console.log('🔬 Testing Trigger Enforcement:');
console.log('');

let passCount = 0;
let failCount = 0;

// Test 1: Prevent NULL user_id on INSERT to ingestion_runs
console.log('Test 1: INSERT NULL user_id to ingestion_runs');
try {
  db.exec(`INSERT INTO ingestion_runs (run_id, user_id) VALUES ('test-null-${Date.now()}', NULL)`);
  console.log('  ❌ FAIL: Trigger did not prevent NULL user_id');
  failCount++;
} catch (error) {
  if (error.message.includes('user_id cannot be NULL')) {
    console.log('  ✅ PASS: Trigger correctly rejected NULL user_id');
    passCount++;
  } else {
    console.log(`  ❌ FAIL: Unexpected error: ${error.message}`);
    failCount++;
  }
}
console.log('');

// Test 2: Allow valid user_id on INSERT
console.log('Test 2: INSERT valid user_id to ingestion_runs');
try {
  const testRunId = `test-valid-${Date.now()}`;
  db.exec(`INSERT INTO ingestion_runs (run_id, user_id, status) VALUES ('${testRunId}', 1, 'completed')`);
  // Clean up
  db.exec(`DELETE FROM ingestion_runs WHERE run_id = '${testRunId}'`);
  console.log('  ✅ PASS: Valid insert succeeded');
  passCount++;
} catch (error) {
  console.log(`  ❌ FAIL: Valid insert failed: ${error.message}`);
  failCount++;
}
console.log('');

// Test 3: Prevent NULL user_id on UPDATE to ingestion_runs
console.log('Test 3: UPDATE user_id to NULL on ingestion_runs');
try {
  const testRunId = `test-update-${Date.now()}`;
  // Create a valid row
  db.exec(`INSERT INTO ingestion_runs (run_id, user_id, status) VALUES ('${testRunId}', 1, 'completed')`);
  // Try to update to NULL
  db.exec(`UPDATE ingestion_runs SET user_id = NULL WHERE run_id = '${testRunId}'`);
  console.log('  ❌ FAIL: Trigger did not prevent UPDATE to NULL user_id');
  failCount++;
  // Clean up
  db.exec(`DELETE FROM ingestion_runs WHERE run_id = '${testRunId}'`);
} catch (error) {
  if (error.message.includes('user_id cannot be NULL')) {
    console.log('  ✅ PASS: Trigger correctly rejected UPDATE to NULL user_id');
    passCount++;
    // Clean up (row should still exist with user_id = 1)
    const testRunId = `test-update-${Date.now()}`;
    db.exec(`DELETE FROM ingestion_runs WHERE run_id LIKE 'test-update-%'`);
  } else {
    console.log(`  ❌ FAIL: Unexpected error: ${error.message}`);
    failCount++;
  }
}
console.log('');

// Test 4: Prevent NULL user_id on INSERT to email_monitors
console.log('Test 4: INSERT NULL user_id to email_monitors');
try {
  db.exec(`
    INSERT INTO email_monitors (account_name, email_address, imap_host, username, encrypted_password, user_id)
    VALUES ('Test Account', 'test-${Date.now()}@example.com', 'imap.test.com', 'test', 'encrypted', NULL)
  `);
  console.log('  ❌ FAIL: Trigger did not prevent NULL user_id');
  failCount++;
} catch (error) {
  if (error.message.includes('user_id cannot be NULL')) {
    console.log('  ✅ PASS: Trigger correctly rejected NULL user_id');
    passCount++;
  } else {
    console.log(`  ❌ FAIL: Unexpected error: ${error.message}`);
    failCount++;
  }
}
console.log('');

// Summary
console.log('=======================================');
console.log(`Test Results: ${passCount} passed, ${failCount} failed`);
console.log('');

if (failCount === 0) {
  console.log('✅ All tests passed! user_id guardrails are working correctly.');
  process.exit(0);
} else {
  console.log('❌ Some tests failed. Please review the migration.');
  process.exit(1);
}
