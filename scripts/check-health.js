#!/usr/bin/env node

// =====================================================
// HEALTH CHECK SCRIPT
// =====================================================
// Checks system health locally (no auth required)
// Usage: node scripts/check-health.js
// =====================================================

const os = require('os');
const fs = require('fs');
const db = require('../database');
const config = require('../config');
const backupService = require('../backup-service');

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function checkHealth() {
  console.log('\n========================================');
  console.log('  SYSTEM HEALTH CHECK');
  console.log('========================================\n');

  let allHealthy = true;

  // 1. Database
  console.log('📊 DATABASE');
  try {
    const database = db.getDatabase();
    const start = Date.now();
    database.prepare('SELECT 1').get();
    const responseTime = Date.now() - start;

    const dbSize = fs.statSync(config.databasePath).size;

    console.log(`   Status:        ✅ Healthy`);
    console.log(`   Response Time: ${responseTime}ms`);
    console.log(`   Size:          ${formatBytes(dbSize)}`);
    console.log(`   Path:          ${config.databasePath}`);
  } catch (error) {
    console.log(`   Status:        ❌ FAILED`);
    console.log(`   Error:         ${error.message}`);
    allHealthy = false;
  }
  console.log('');

  // 2. Memory
  console.log('💾 MEMORY');
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPercent = ((usedMem / totalMem) * 100).toFixed(2);

  const processMemory = process.memoryUsage();
  const heapPercent = ((processMemory.heapUsed / processMemory.heapTotal) * 100).toFixed(2);

  const memStatus = memPercent > 90 ? '❌' : memPercent > 75 ? '⚠️' : '✅';

  console.log(`   Status:        ${memStatus} ${memPercent}% used`);
  console.log(`   Total:         ${formatBytes(totalMem)}`);
  console.log(`   Used:          ${formatBytes(usedMem)}`);
  console.log(`   Free:          ${formatBytes(freeMem)}`);
  console.log(`   Process Heap:  ${formatBytes(processMemory.heapUsed)} / ${formatBytes(processMemory.heapTotal)} (${heapPercent}%)`);

  if (memPercent > 90) allHealthy = false;
  console.log('');

  // 3. CPU
  console.log('⚡ CPU');
  const cpus = os.cpus();
  const loadAvg = os.loadavg();
  const loadPercent = ((loadAvg[0] / cpus.length) * 100).toFixed(2);

  const cpuStatus = loadPercent > 90 ? '⚠️' : '✅';

  console.log(`   Status:        ${cpuStatus} ${loadPercent}% load`);
  console.log(`   Cores:         ${cpus.length}`);
  console.log(`   Model:         ${cpus[0].model}`);
  console.log(`   Load Average:  ${loadAvg[0].toFixed(2)} (1m), ${loadAvg[1].toFixed(2)} (5m), ${loadAvg[2].toFixed(2)} (15m)`);
  console.log('');

  // 4. Backups
  console.log('💿 BACKUPS');
  try {
    const stats = backupService.getStats();
    const hasRecentBackup = stats.latestBackup && (new Date() - new Date(stats.latestBackup.created)) < (config.databaseBackupIntervalHours * 3600000 * 2);

    const backupStatus = !config.databaseBackupEnabled ? '⚠️' : hasRecentBackup ? '✅' : '⚠️';

    console.log(`   Status:        ${backupStatus} ${config.databaseBackupEnabled ? (hasRecentBackup ? 'Up to date' : 'No recent backup') : 'Disabled'}`);
    console.log(`   Total Backups: ${stats.totalBackups}`);
    console.log(`   Total Size:    ${stats.totalSizeFormatted}`);
    console.log(`   Latest:        ${stats.latestBackup ? stats.latestBackup.age : 'Never'}`);
    console.log(`   Service:       ${stats.isRunning ? 'Running' : 'Stopped'}`);

    if (!hasRecentBackup && config.databaseBackupEnabled) allHealthy = false;
  } catch (error) {
    console.log(`   Status:        ❌ FAILED`);
    console.log(`   Error:         ${error.message}`);
    allHealthy = false;
  }
  console.log('');

  // 5. Configuration
  console.log('⚙️  CONFIGURATION');
  console.log(`   Environment:   ${config.isProduction() ? 'production' : 'development'}`);
  console.log(`   HTTPS:         ${config.httpsEnabled ? 'Enabled' : 'Disabled'}`);
  console.log(`   API Key:       ${config.anthropicApiKey ? '✅ Set' : '❌ Not set'}`);
  console.log(`   Backups:       ${config.databaseBackupEnabled ? 'Enabled' : 'Disabled'}`);
  console.log('');

  // Overall status
  console.log('========================================');
  if (allHealthy) {
    console.log('  ✅ OVERALL STATUS: HEALTHY');
  } else {
    console.log('  ⚠️  OVERALL STATUS: DEGRADED');
  }
  console.log('========================================\n');

  process.exit(allHealthy ? 0 : 1);
}

// Run
checkHealth();
