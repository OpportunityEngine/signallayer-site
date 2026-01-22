#!/usr/bin/env node
/**
 * check-db-state.js - Database state inspection tool
 *
 * Prints comprehensive database state for debugging invoice visibility issues.
 * Run locally or in production to verify DB path consistency and data integrity.
 *
 * Usage:
 *   node scripts/dev/check-db-state.js
 *   DATABASE_PATH=/data/revenue-radar.db node scripts/dev/check-db-state.js
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Resolve DB path the same way database.js does
const DB_PATH = process.env.DB_PATH || process.env.DATABASE_PATH || path.join(__dirname, '../../revenue-radar.db');
const dbPathResolved = path.resolve(DB_PATH);

console.log('='.repeat(60));
console.log('DATABASE STATE CHECK');
console.log('='.repeat(60));
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Node.js: ${process.version}`);
console.log(`PID: ${process.pid}`);
console.log(`CWD: ${process.cwd()}`);
console.log('');

// ========== DB PATH INFO ==========
console.log('--- DATABASE PATH ---');
console.log(`DB_PATH env: ${process.env.DB_PATH || '(not set)'}`);
console.log(`DATABASE_PATH env: ${process.env.DATABASE_PATH || '(not set)'}`);
console.log(`Resolved path: ${dbPathResolved}`);

const pathHash = crypto.createHash('sha1').update(dbPathResolved).digest('hex').substring(0, 12);
console.log(`Path hash: ${pathHash}`);

const fileExists = fs.existsSync(dbPathResolved);
console.log(`File exists: ${fileExists}`);

if (fileExists) {
  const stats = fs.statSync(dbPathResolved);
  console.log(`File size: ${stats.size} bytes (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`Last modified: ${stats.mtime.toISOString()}`);
} else {
  console.log('WARNING: Database file does not exist!');
  process.exit(1);
}

console.log('');

// ========== CONNECT TO DB ==========
let sqlite3;
try {
  sqlite3 = require('better-sqlite3');
} catch (e) {
  console.error('ERROR: better-sqlite3 not installed. Run: npm install');
  process.exit(1);
}

const db = new sqlite3(dbPathResolved, { readonly: true });

// Get PRAGMA info
console.log('--- SQLITE PRAGMAS ---');
const journalMode = db.prepare('PRAGMA journal_mode').get();
console.log(`Journal mode: ${journalMode?.journal_mode}`);

const dbList = db.prepare('PRAGMA database_list').all();
console.log(`Database list:`, JSON.stringify(dbList, null, 2));

console.log('');

// ========== TABLE COUNTS ==========
console.log('--- TABLE COUNTS ---');

const tables = [
  'users',
  'email_monitors',
  'ingestion_runs',
  'invoice_items',
  'email_processing_log'
];

for (const table of tables) {
  try {
    const count = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
    console.log(`${table}: ${count.count} rows`);
  } catch (e) {
    console.log(`${table}: ERROR - ${e.message}`);
  }
}

console.log('');

// ========== EMAIL MONITORS ==========
console.log('--- EMAIL MONITORS ---');
try {
  const monitors = db.prepare(`
    SELECT id, user_id, email_address, is_active, invoices_created_count,
           emails_processed_count, last_checked_at, last_error
    FROM email_monitors
    ORDER BY id DESC
    LIMIT 10
  `).all();

  if (monitors.length === 0) {
    console.log('No email monitors found.');
  } else {
    monitors.forEach(m => {
      console.log(`  [${m.id}] ${m.email_address}`);
      console.log(`      user_id: ${m.user_id}, active: ${m.is_active}`);
      console.log(`      invoices_created: ${m.invoices_created_count}, emails_processed: ${m.emails_processed_count}`);
      console.log(`      last_checked: ${m.last_checked_at || 'never'}`);
      if (m.last_error) {
        console.log(`      last_error: ${m.last_error}`);
      }
    });
  }
} catch (e) {
  console.log(`ERROR: ${e.message}`);
}

console.log('');

// ========== INGESTION RUNS ==========
console.log('--- RECENT INGESTION RUNS (last 10) ---');
try {
  const runs = db.prepare(`
    SELECT id, run_id, user_id, vendor_name, file_name, status,
           invoice_total_cents, created_at
    FROM ingestion_runs
    ORDER BY id DESC
    LIMIT 10
  `).all();

  if (runs.length === 0) {
    console.log('No ingestion runs found.');
  } else {
    runs.forEach(r => {
      console.log(`  [${r.id}] ${r.run_id}`);
      console.log(`      user_id: ${r.user_id}, status: ${r.status}`);
      console.log(`      vendor: ${r.vendor_name}, file: ${r.file_name}`);
      console.log(`      total: ${r.invoice_total_cents || 0} cents, created: ${r.created_at}`);
    });
  }
} catch (e) {
  console.log(`ERROR: ${e.message}`);
}

console.log('');

// ========== INGESTION RUNS BY STATUS ==========
console.log('--- INGESTION RUNS BY STATUS ---');
try {
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM ingestion_runs
    GROUP BY status
  `).all();

  byStatus.forEach(s => {
    console.log(`  ${s.status || 'NULL'}: ${s.count}`);
  });
} catch (e) {
  console.log(`ERROR: ${e.message}`);
}

console.log('');

// ========== NULL USER_ID CHECK ==========
console.log('--- USER_ID AUDIT ---');
try {
  const nullUserRuns = db.prepare(`
    SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id IS NULL
  `).get();
  console.log(`Ingestion runs with NULL user_id: ${nullUserRuns.count}`);

  const nullUserMonitors = db.prepare(`
    SELECT COUNT(*) as count FROM email_monitors WHERE user_id IS NULL
  `).get();
  console.log(`Email monitors with NULL user_id: ${nullUserMonitors.count}`);

  if (nullUserRuns.count > 0 || nullUserMonitors.count > 0) {
    console.log('WARNING: Found records with NULL user_id - these may be invisible to users!');
  }
} catch (e) {
  console.log(`ERROR: ${e.message}`);
}

console.log('');

// ========== EMAIL PROCESSING LOG ==========
console.log('--- RECENT EMAIL PROCESSING LOG (last 10) ---');
try {
  const logs = db.prepare(`
    SELECT id, monitor_id, email_uid, status, skip_reason,
           invoices_created, error_message
    FROM email_processing_log
    ORDER BY id DESC
    LIMIT 10
  `).all();

  if (logs.length === 0) {
    console.log('No processing log entries found.');
  } else {
    logs.forEach(l => {
      console.log(`  [${l.id}] monitor=${l.monitor_id}, uid=${l.email_uid}`);
      console.log(`      status: ${l.status}, skip_reason: ${l.skip_reason || 'none'}`);
      console.log(`      invoices_created: ${l.invoices_created}`);
      if (l.error_message) {
        console.log(`      error: ${l.error_message.substring(0, 100)}`);
      }
    });
  }
} catch (e) {
  console.log(`ERROR: ${e.message}`);
}

console.log('');

// ========== PROCESSING LOG BY STATUS ==========
console.log('--- PROCESSING LOG BY STATUS ---');
try {
  const logByStatus = db.prepare(`
    SELECT status, skip_reason, COUNT(*) as count
    FROM email_processing_log
    GROUP BY status, skip_reason
    ORDER BY count DESC
    LIMIT 20
  `).all();

  logByStatus.forEach(s => {
    console.log(`  ${s.status}/${s.skip_reason || 'none'}: ${s.count}`);
  });
} catch (e) {
  console.log(`ERROR: ${e.message}`);
}

console.log('');

// ========== COUNTER CONSISTENCY CHECK ==========
console.log('--- COUNTER CONSISTENCY CHECK ---');
try {
  // Check if invoices_created_count matches actual ingestion_runs
  const monitors = db.prepare(`
    SELECT id, email_address, user_id, invoices_created_count
    FROM email_monitors
    WHERE invoices_created_count > 0
  `).all();

  for (const m of monitors) {
    // Count actual completed runs for this user (email autopilot source)
    const actualRuns = db.prepare(`
      SELECT COUNT(*) as count
      FROM ingestion_runs
      WHERE user_id = ? AND status = 'completed' AND run_id LIKE 'email-%'
    `).get(m.user_id);

    const mismatch = m.invoices_created_count !== actualRuns.count;
    const status = mismatch ? 'MISMATCH!' : 'OK';

    console.log(`  Monitor ${m.id} (${m.email_address}):`);
    console.log(`      invoices_created_count: ${m.invoices_created_count}`);
    console.log(`      actual completed runs: ${actualRuns.count}`);
    console.log(`      status: ${status}`);

    if (mismatch) {
      console.log(`      WARNING: Counter mismatch detected! UI may show wrong number.`);
    }
  }
} catch (e) {
  console.log(`ERROR: ${e.message}`);
}

console.log('');
console.log('='.repeat(60));
console.log('CHECK COMPLETE');
console.log('='.repeat(60));

db.close();
