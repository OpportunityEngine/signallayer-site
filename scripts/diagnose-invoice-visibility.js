#!/usr/bin/env node

/**
 * diagnose-invoice-visibility.js
 * 
 * Diagnostic script for invoice visibility issues.
 * When a user reports "My Invoices shows 0" or missing data, run this script
 * with their user_id or email to get detailed diagnostic information.
 * 
 * Usage:
 *   node scripts/diagnose-invoice-visibility.js <user_id>
 *   node scripts/diagnose-invoice-visibility.js --email user@example.com
 *   node scripts/diagnose-invoice-visibility.js --help
 * 
 * This script:
 *   - Counts ingestion_runs for the user
 *   - Counts email_monitors for the user
 *   - Finds orphaned/mismatched user_id records
 *   - Suggests fixes for issues
 *   - Shows recent invoice data
 */

const sqlite3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Parse arguments
const args = process.argv.slice(2);
let userId = null;
let userEmail = null;

if (args.length === 0 || args[0] === '--help') {
  console.log(`
Usage: node scripts/diagnose-invoice-visibility.js [options]

Options:
  <user_id>           Diagnose by user ID (integer)
  --email <email>     Diagnose by email address
  --help              Show this help message

Examples:
  node scripts/diagnose-invoice-visibility.js 5
  node scripts/diagnose-invoice-visibility.js --email user@example.com
  node scripts/diagnose-invoice-visibility.js --help
  `);
  process.exit(0);
}

if (args[0] === '--email' && args[1]) {
  userEmail = args[1];
} else if (!isNaN(args[0])) {
  userId = parseInt(args[0]);
} else {
  console.error(`Invalid argument: ${args[0]}`);
  console.error('Use --help for usage information');
  process.exit(1);
}

// Database path
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'revenue-radar.db');

if (!fs.existsSync(DB_PATH)) {
  console.error(`Error: Database not found at ${DB_PATH}`);
  process.exit(1);
}

const db = new sqlite3(DB_PATH);

console.log('\n' + '='.repeat(70));
console.log('INVOICE VISIBILITY DIAGNOSTIC');
console.log('='.repeat(70));
console.log(`Generated: ${new Date().toISOString()}\n`);

// ===== RESOLVE USER =====
if (userEmail) {
  const user = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(userEmail);
  if (!user) {
    console.error(`Error: No user found with email ${userEmail}`);
    db.close();
    process.exit(1);
  }
  userId = user.id;
  console.log(`User resolved: ${user.email} (ID: ${user.id}, Name: ${user.name})\n`);
} else {
  const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(userId);
  if (!user) {
    console.error(`Error: No user found with ID ${userId}`);
    db.close();
    process.exit(1);
  }
  console.log(`User: ${user.email} (ID: ${user.id}, Name: ${user.name})\n`);
}

// ===== SECTION 1: INGESTION_RUNS =====
console.log('[1] INGESTION_RUNS (Invoices)');
console.log('-'.repeat(70));

try {
  // Count total invoices for this user
  const count = db.prepare('SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id = ?').get(userId);
  console.log(`✓ Total invoices for this user: ${count.count}`);

  if (count.count === 0) {
    console.log('  → No invoices found for this user!');
  } else {
    // Show breakdown by status
    const byStatus = db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM ingestion_runs 
      WHERE user_id = ? 
      GROUP BY status
    `).all(userId);

    console.log('\n✓ Breakdown by status:');
    byStatus.forEach(row => {
      console.log(`    - ${row.status}: ${row.count}`);
    });

    // Show recent invoices
    console.log('\n✓ Recent invoices (last 5):');
    const recent = db.prepare(`
      SELECT id, run_id, vendor_name, status, invoice_total_cents, created_at 
      FROM ingestion_runs 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 5
    `).all(userId);

    recent.forEach((r, idx) => {
      const total = r.invoice_total_cents ? (r.invoice_total_cents / 100).toFixed(2) : '0.00';
      console.log(`    ${idx + 1}. ${r.created_at.split('T')[0]} - ${r.vendor_name || 'Unknown'} ($${total}) [${r.status}]`);
      console.log(`       ID: ${r.id}, run_id: ${r.run_id}`);
    });

    // Check for items per invoice
    console.log('\n✓ Invoice items distribution:');
    const itemCounts = db.prepare(`
      SELECT COUNT(*) as item_count, COUNT(DISTINCT ir.id) as invoice_count
      FROM invoice_items ii
      JOIN ingestion_runs ir ON ii.run_id = ir.id
      WHERE ir.user_id = ?
    `).get(userId);

    console.log(`    - Total items: ${itemCounts.item_count}`);
    console.log(`    - Invoices with items: ${itemCounts.invoice_count}`);
  }

} catch (error) {
  console.error(`✗ Error: ${error.message}`);
}

// ===== SECTION 2: EMAIL_MONITORS =====
console.log('\n[2] EMAIL_MONITORS');
console.log('-'.repeat(70));

try {
  // Count monitors
  const count = db.prepare('SELECT COUNT(*) as count FROM email_monitors WHERE user_id = ?').get(userId);
  console.log(`✓ Total monitors for this user: ${count.count}`);

  if (count.count > 0) {
    const monitors = db.prepare(`
      SELECT id, email_address, is_active, invoices_created_count, created_at 
      FROM email_monitors 
      WHERE user_id = ? 
      ORDER BY created_at DESC
    `).all(userId);

    console.log('\n✓ Email monitors:');
    monitors.forEach((m, idx) => {
      const status = m.is_active ? '🟢 active' : '🔴 inactive';
      console.log(`    ${idx + 1}. ${m.email_address} [${status}]`);
      console.log(`       Created: ${m.created_at}, Invoices created: ${m.invoices_created_count}`);
    });
  }

} catch (error) {
  console.error(`✗ Error: ${error.message}`);
}

// ===== SECTION 3: DATA CONSISTENCY CHECKS =====
console.log('\n[3] DATA CONSISTENCY CHECKS');
console.log('-'.repeat(70));

try {
  // Check for orphaned items (this shouldn't happen with triggers)
  const orphanedItems = db.prepare(`
    SELECT COUNT(*) as count
    FROM invoice_items ii
    WHERE ii.run_id NOT IN (SELECT id FROM ingestion_runs WHERE user_id = ?)
    AND ii.run_id IN (
      SELECT id FROM ingestion_runs
    )
  `).get(userId);

  console.log(`✓ Orphaned items (wrong run_id): ${orphanedItems.count}`);

  // Check for NULL user_id in this user's records
  const nullUserIds = db.prepare(`
    SELECT COUNT(*) as count FROM ingestion_runs WHERE id IN (
      SELECT DISTINCT ir.id 
      FROM ingestion_runs ir
      WHERE ir.user_id = ?
    ) AND user_id IS NULL
  `).get(userId);

  console.log(`✓ Records with NULL user_id: ${nullUserIds.count}`);

  // Check monitor data consistency
  const monitorConsistency = db.prepare(`
    SELECT COUNT(*) as count
    FROM email_monitors
    WHERE user_id = ? AND user_id IS NULL
  `).get(userId);

  console.log(`✓ Monitors with NULL user_id: ${monitorConsistency.count}`);

} catch (error) {
  console.error(`✗ Error: ${error.message}`);
}

// ===== SECTION 4: POTENTIAL ISSUES =====
console.log('\n[4] POTENTIAL ISSUES & SUGGESTIONS');
console.log('-'.repeat(70));

try {
  const invCount = db.prepare('SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id = ?').get(userId).count;
  const monCount = db.prepare('SELECT COUNT(*) as count FROM email_monitors WHERE user_id = ?').get(userId).count;

  let issuesFound = false;

  // Check 1: No invoices
  if (invCount === 0) {
    console.log('\n⚠ ISSUE: User has 0 invoices');
    console.log('   Possible causes:');
    console.log('   - No invoices uploaded yet');
    console.log('   - No email monitors configured');
    console.log('   - Email processing not working (check email monitors)');
    console.log('\n   Fix suggestions:');
    console.log('   1. Check if email monitors are configured: invoke email-imap-service');
    console.log('   2. Try manual upload to verify invoice parsing works');
    console.log('   3. Check email_processing_log for errors');
    issuesFound = true;
  }

  // Check 2: Monitors but no invoices
  if (monCount > 0 && invCount === 0) {
    console.log('\n⚠ ISSUE: Monitors configured but 0 invoices created');
    console.log('   This suggests email parsing/monitoring is not working.');
    console.log('\n   Debug steps:');
    console.log('   1. Check email_processing_log for this user\'s monitors');
    console.log('   2. Verify email monitor OAuth tokens are valid');
    console.log('   3. Check if monitor requires invoice keywords');
    console.log('   4. Run: SELECT * FROM email_processing_log WHERE monitor_id IN');
    console.log('      (SELECT id FROM email_monitors WHERE user_id = ' + userId + ')');
    issuesFound = true;
  }

  // Check 3: Many invoices but user can't see them
  if (invCount > 0) {
    console.log(`\n✓ User has ${invCount} invoices - visibility should work.`);
    console.log('  If user reports "My Invoices shows 0":');
    console.log('  1. Check frontend filtering logic in my-invoices.html');
    console.log('  2. Verify /api/uploads/recent endpoint returns these invoices');
    console.log('  3. Check browser console for JavaScript errors');
    console.log('  4. Clear browser cache and reload');
  }

  if (!issuesFound) {
    console.log('\n✓ No major issues detected!');
    console.log('  Data looks consistent. If user still sees 0 invoices:');
    console.log('  1. Check frontend JavaScript (my-invoices.html)');
    console.log('  2. Verify browser developer console for errors');
    console.log('  3. Check /api/uploads/recent response');
  }

} catch (error) {
  console.error(`✗ Error: ${error.message}`);
}

// ===== SECTION 5: DATABASE REPAIR COMMANDS =====
console.log('\n[5] DATABASE REPAIR (if needed)');
console.log('-'.repeat(70));

try {
  const invCount = db.prepare('SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id = ?').get(userId).count;
  
  if (invCount === 0) {
    console.log('\n📋 If you need to reassign invoices to this user, use:');
    console.log('\n   // Fix all orphaned invoices (assigned to admin/user 1)');
    console.log('   UPDATE ingestion_runs SET user_id = ' + userId + ' WHERE user_id = 1 AND vendor_name IS NOT NULL;');
    console.log('\n   // Or be more specific - fix invoices by email monitor');
    console.log('   UPDATE ingestion_runs');
    console.log('   SET user_id = ' + userId);
    console.log('   WHERE run_id LIKE \'email-%\' AND status = \'completed\';');
    console.log('\n⚠ WARNING: Only run these if you\'re sure about the reassignment!');
  }

} catch (error) {
  console.error(`✗ Error: ${error.message}`);
}

console.log('\n' + '='.repeat(70) + '\n');

db.close();
