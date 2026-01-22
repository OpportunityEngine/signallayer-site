#!/usr/bin/env node

/**
 * Database Migration Runner
 * Applies SQL migrations to the database with verification
 *
 * Usage:
 *   node run-migration.js migrations/add-user-id-guardrails.sql
 *   npm run migrate migrations/add-user-id-guardrails.sql
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('better-sqlite3');

// Get migration file from command line args
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('❌ Usage: node run-migration.js <migration-file.sql>');
  console.error('   Example: node run-migration.js migrations/add-user-id-guardrails.sql');
  process.exit(1);
}

// Resolve migration file path
const migrationPath = path.isAbsolute(migrationFile)
  ? migrationFile
  : path.join(__dirname, migrationFile);

if (!fs.existsSync(migrationPath)) {
  console.error(`❌ Migration file not found: ${migrationPath}`);
  process.exit(1);
}

// Database path (same as database.js - check both env vars)
const DB_PATH = process.env.DB_PATH || process.env.DATABASE_PATH || path.join(__dirname, 'revenue-radar.db');

if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ Database not found: ${DB_PATH}`);
  process.exit(1);
}

console.log('🔧 Database Migration Runner');
console.log('============================');
console.log(`Database:  ${DB_PATH}`);
console.log(`Migration: ${migrationPath}`);
console.log('');

// Read migration SQL
const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

// Create backup before migration
const backupPath = `${DB_PATH}.backup-${Date.now()}`;
console.log(`📦 Creating backup: ${path.basename(backupPath)}`);
fs.copyFileSync(DB_PATH, backupPath);

// Connect to database
const db = sqlite3(DB_PATH);

console.log('');
console.log('🚀 Applying migration...');
console.log('');

try {
  // Run migration in a transaction
  db.transaction(() => {
    // Split SQL by semicolons and execute each statement
    // (better-sqlite3 exec() doesn't support multiple statements well with RAISE)
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    let statementCount = 0;
    for (const statement of statements) {
      // Skip comments
      if (statement.startsWith('--')) continue;

      try {
        db.exec(statement);
        statementCount++;
      } catch (error) {
        // Ignore duplicate trigger/index errors (idempotent migrations)
        if (
          error.message.includes('already exists') ||
          error.message.includes('duplicate')
        ) {
          console.log(`   ⚠️  Skipped (already exists): ${statement.substring(0, 50)}...`);
        } else {
          throw error;
        }
      }
    }

    console.log(`✅ Executed ${statementCount} statements successfully`);
  })();

  console.log('');
  console.log('✅ Migration completed successfully');
  console.log('');

  // Run verification queries
  console.log('🔍 Verification:');
  console.log('');

  // Check for NULL user_id in ingestion_runs
  const nullInvoices = db
    .prepare('SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id IS NULL')
    .get();

  if (nullInvoices.count === 0) {
    console.log(`✅ ingestion_runs.user_id: ${nullInvoices.count} NULL values (expected: 0)`);
  } else {
    console.error(
      `❌ ingestion_runs.user_id: ${nullInvoices.count} NULL values found! Migration incomplete.`
    );
  }

  // Check for NULL user_id in email_monitors
  const nullMonitors = db
    .prepare('SELECT COUNT(*) as count FROM email_monitors WHERE user_id IS NULL')
    .get();

  if (nullMonitors.count === 0) {
    console.log(`✅ email_monitors.user_id: ${nullMonitors.count} NULL values (expected: 0)`);
  } else {
    console.error(
      `❌ email_monitors.user_id: ${nullMonitors.count} NULL values found! Migration incomplete.`
    );
  }

  // Test trigger enforcement
  console.log('');
  console.log('🧪 Testing trigger enforcement:');
  try {
    db.exec(`INSERT INTO ingestion_runs (run_id, user_id) VALUES ('test-null-${Date.now()}', NULL)`);
    console.error('❌ FAIL: Trigger did not prevent NULL user_id!');
  } catch (error) {
    if (error.message.includes('user_id cannot be NULL')) {
      console.log('✅ Trigger correctly prevents NULL user_id');
    } else {
      console.error(`❌ Unexpected error: ${error.message}`);
    }
  }

  console.log('');
  console.log('============================');
  console.log(`📦 Backup saved: ${backupPath}`);
  console.log('✅ Migration complete!');
  console.log('');

  db.close();
  process.exit(0);
} catch (error) {
  console.error('');
  console.error('❌ Migration failed:', error.message);
  console.error('');
  console.error('Stack trace:');
  console.error(error.stack);
  console.error('');
  console.error('🔄 Restoring from backup...');

  db.close();

  // Restore from backup
  fs.copyFileSync(backupPath, DB_PATH);
  console.error(`✅ Database restored from backup: ${path.basename(backupPath)}`);
  console.error('');

  process.exit(1);
}
