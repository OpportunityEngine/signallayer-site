#!/usr/bin/env node

// =====================================================
// MANUAL BACKUP SCRIPT
// =====================================================
// Creates an immediate backup of the database
// Usage: node scripts/backup-now.js
// =====================================================

const backupService = require('../backup-service');

async function runBackup() {
  console.log('\n========================================');
  console.log('  MANUAL DATABASE BACKUP');
  console.log('========================================\n');

  try {
    console.log('⏳ Starting backup...\n');

    const result = await backupService.createBackup();

    console.log('\n========================================');
    console.log('  BACKUP COMPLETE');
    console.log('========================================');
    console.log(`Filename:     ${result.filename}`);
    console.log(`Location:     ${result.path}`);
    console.log(`Size:         ${(result.size / 1024 / 1024).toFixed(2)} MB`);
    console.log('========================================\n');

  } catch (error) {
    console.error('\n❌ Backup failed:', error.message);
    process.exit(1);
  }
}

// Run
runBackup();
