#!/usr/bin/env node

// =====================================================
// LIST BACKUPS SCRIPT
// =====================================================
// Lists all available database backups
// Usage: node scripts/list-backups.js
// =====================================================

const backupService = require('../backup-service');

function listBackups() {
  console.log('\n========================================');
  console.log('  DATABASE BACKUPS');
  console.log('========================================\n');

  try {
    const backups = backupService.listBackups();

    if (backups.length === 0) {
      console.log('No backups found.\n');
      return;
    }

    console.log(`Total backups: ${backups.length}\n`);

    backups.forEach((backup, index) => {
      console.log(`${index + 1}. ${backup.filename}`);
      console.log(`   Size:    ${backup.sizeFormatted}`);
      console.log(`   Created: ${backup.created.toISOString()}`);
      console.log(`   Age:     ${backup.age}`);
      console.log(`   Path:    ${backup.path}`);
      console.log('');
    });

    const stats = backupService.getStats();
    console.log('========================================');
    console.log('  BACKUP STATISTICS');
    console.log('========================================');
    console.log(`Total Size:         ${stats.totalSizeFormatted}`);
    console.log(`Retention Period:   ${stats.retentionDays} days`);
    console.log(`Backup Interval:    ${stats.intervalHours} hours`);
    console.log(`Service Running:    ${stats.isRunning ? 'Yes' : 'No'}`);
    console.log('========================================\n');

  } catch (error) {
    console.error('\n❌ Error listing backups:', error.message);
    process.exit(1);
  }
}

// Run
listBackups();
