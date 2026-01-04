// =====================================================
// DATABASE BACKUP SERVICE
// =====================================================
// Automated database backups with:
// - Scheduled backups
// - Compression
// - Retention policy
// - S3 upload (optional)
// - Restore functionality
// =====================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const config = require('./config');

class BackupService {
  constructor() {
    this.backupPath = config.databaseBackupPath;
    this.databasePath = config.databasePath;
    this.retentionDays = config.databaseBackupRetentionDays;
    this.intervalHours = config.databaseBackupIntervalHours;
    this.isRunning = false;

    // Ensure backup directory exists
    if (config.databaseBackupEnabled) {
      this.ensureBackupDirectory();
    }
  }

  /**
   * Start automatic backup service
   */
  start() {
    if (!config.databaseBackupEnabled) {
      console.log('[BACKUP] Database backups disabled in configuration');
      return;
    }

    if (this.isRunning) {
      console.log('[BACKUP] Backup service already running');
      return;
    }

    console.log(`[BACKUP] Starting automated backup service (every ${this.intervalHours}h)`);

    // Initial backup
    this.createBackup().catch(err => {
      console.error('[BACKUP] Failed to create initial backup:', err.message);
    });

    // Schedule regular backups
    const intervalMs = this.intervalHours * 60 * 60 * 1000;
    this.backupInterval = setInterval(() => {
      this.createBackup().catch(err => {
        console.error('[BACKUP] Scheduled backup failed:', err.message);
      });
    }, intervalMs);

    // Schedule cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldBackups().catch(err => {
        console.error('[BACKUP] Cleanup failed:', err.message);
      });
    }, 24 * 60 * 60 * 1000);  // Daily cleanup

    this.isRunning = true;
    console.log('[BACKUP] ✓ Backup service started');
  }

  /**
   * Stop backup service
   */
  stop() {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.isRunning = false;
    console.log('[BACKUP] Backup service stopped');
  }

  /**
   * Ensure backup directory exists
   */
  ensureBackupDirectory() {
    if (!fs.existsSync(this.backupPath)) {
      fs.mkdirSync(this.backupPath, { recursive: true });
      console.log(`[BACKUP] Created backup directory: ${this.backupPath}`);
    }
  }

  /**
   * Create a backup of the database
   */
  async createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `revenue-radar-${timestamp}.db`;
    const backupFilePath = path.join(this.backupPath, backupFileName);

    try {
      console.log('[BACKUP] Creating database backup...');

      // Check if database exists
      if (!fs.existsSync(this.databasePath)) {
        throw new Error(`Database not found: ${this.databasePath}`);
      }

      // Copy database file
      fs.copyFileSync(this.databasePath, backupFilePath);

      // Get file size
      const stats = fs.statSync(backupFilePath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      console.log(`[BACKUP] ✓ Backup created: ${backupFileName} (${sizeMB} MB)`);

      // Compress backup (optional, saves space)
      if (this.shouldCompress()) {
        await this.compressBackup(backupFilePath);
      }

      // Upload to S3 (if configured)
      if (config.s3BackupEnabled) {
        await this.uploadToS3(backupFilePath);
      }

      return {
        success: true,
        filename: backupFileName,
        path: backupFilePath,
        size: stats.size
      };

    } catch (error) {
      console.error('[BACKUP] Backup failed:', error.message);
      throw error;
    }
  }

  /**
   * Compress backup using gzip
   */
  async compressBackup(filePath) {
    try {
      const compressedPath = `${filePath}.gz`;

      // Use gzip command
      execSync(`gzip -c "${filePath}" > "${compressedPath}"`);

      // Remove uncompressed file
      fs.unlinkSync(filePath);

      const stats = fs.statSync(compressedPath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      console.log(`[BACKUP] ✓ Backup compressed: ${path.basename(compressedPath)} (${sizeMB} MB)`);

      return compressedPath;
    } catch (error) {
      console.error('[BACKUP] Compression failed:', error.message);
      // Continue without compression
    }
  }

  /**
   * Upload backup to S3
   */
  async uploadToS3(filePath) {
    try {
      // Note: Requires aws-sdk package
      // const AWS = require('aws-sdk');
      // const s3 = new AWS.S3({
      //   accessKeyId: config.awsConfig.accessKeyId,
      //   secretAccessKey: config.awsConfig.secretAccessKey,
      //   region: config.awsConfig.region
      // });
      //
      // const fileContent = fs.readFileSync(filePath);
      // const fileName = path.basename(filePath);
      //
      // await s3.upload({
      //   Bucket: config.awsConfig.bucket,
      //   Key: `backups/${fileName}`,
      //   Body: fileContent
      // }).promise();
      //
      // console.log(`[BACKUP] ✓ Uploaded to S3: ${fileName}`);

      console.log('[BACKUP] S3 upload skipped (aws-sdk not installed)');
    } catch (error) {
      console.error('[BACKUP] S3 upload failed:', error.message);
    }
  }

  /**
   * Clean up old backups based on retention policy
   */
  async cleanupOldBackups() {
    try {
      console.log('[BACKUP] Cleaning up old backups...');

      const files = fs.readdirSync(this.backupPath);
      const backupFiles = files.filter(f => f.startsWith('revenue-radar-') && (f.endsWith('.db') || f.endsWith('.db.gz')));

      const now = Date.now();
      const retentionMs = this.retentionDays * 24 * 60 * 60 * 1000;

      let deletedCount = 0;

      for (const file of backupFiles) {
        const filePath = path.join(this.backupPath, file);
        const stats = fs.statSync(filePath);
        const age = now - stats.mtimeMs;

        if (age > retentionMs) {
          fs.unlinkSync(filePath);
          deletedCount++;
          console.log(`[BACKUP] Deleted old backup: ${file}`);
        }
      }

      if (deletedCount > 0) {
        console.log(`[BACKUP] ✓ Cleaned up ${deletedCount} old backup(s)`);
      } else {
        console.log('[BACKUP] No old backups to clean up');
      }

    } catch (error) {
      console.error('[BACKUP] Cleanup failed:', error.message);
    }
  }

  /**
   * List all available backups
   */
  listBackups() {
    try {
      const files = fs.readdirSync(this.backupPath);
      const backupFiles = files.filter(f => f.startsWith('revenue-radar-') && (f.endsWith('.db') || f.endsWith('.db.gz')));

      return backupFiles.map(file => {
        const filePath = path.join(this.backupPath, file);
        const stats = fs.statSync(filePath);

        return {
          filename: file,
          path: filePath,
          size: stats.size,
          sizeFormatted: this.formatBytes(stats.size),
          created: stats.mtime,
          age: this.getAge(stats.mtime)
        };
      }).sort((a, b) => b.created - a.created);

    } catch (error) {
      console.error('[BACKUP] Failed to list backups:', error.message);
      return [];
    }
  }

  /**
   * Restore database from backup
   */
  async restoreBackup(backupFileName) {
    try {
      console.log(`[BACKUP] Restoring from backup: ${backupFileName}`);

      const backupFilePath = path.join(this.backupPath, backupFileName);

      // Check if backup exists
      if (!fs.existsSync(backupFilePath)) {
        throw new Error(`Backup not found: ${backupFileName}`);
      }

      // Create backup of current database before restoring
      const currentBackup = `revenue-radar-pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
      const currentBackupPath = path.join(this.backupPath, currentBackup);

      if (fs.existsSync(this.databasePath)) {
        fs.copyFileSync(this.databasePath, currentBackupPath);
        console.log(`[BACKUP] Current database backed up to: ${currentBackup}`);
      }

      // Decompress if needed
      let restoreFilePath = backupFilePath;
      if (backupFileName.endsWith('.gz')) {
        restoreFilePath = backupFilePath.replace('.gz', '');
        execSync(`gunzip -c "${backupFilePath}" > "${restoreFilePath}"`);
      }

      // Restore backup
      fs.copyFileSync(restoreFilePath, this.databasePath);

      // Clean up decompressed file
      if (restoreFilePath !== backupFilePath && fs.existsSync(restoreFilePath)) {
        fs.unlinkSync(restoreFilePath);
      }

      console.log(`[BACKUP] ✓ Database restored from: ${backupFileName}`);

      return {
        success: true,
        restoredFrom: backupFileName,
        currentDatabaseBackup: currentBackup
      };

    } catch (error) {
      console.error('[BACKUP] Restore failed:', error.message);
      throw error;
    }
  }

  /**
   * Get backup statistics
   */
  getStats() {
    const backups = this.listBackups();

    const totalSize = backups.reduce((sum, b) => sum + b.size, 0);

    return {
      totalBackups: backups.length,
      totalSize,
      totalSizeFormatted: this.formatBytes(totalSize),
      latestBackup: backups[0] || null,
      oldestBackup: backups[backups.length - 1] || null,
      isRunning: this.isRunning,
      backupPath: this.backupPath,
      retentionDays: this.retentionDays,
      intervalHours: this.intervalHours
    };
  }

  // =====================================================
  // UTILITY METHODS
  // =====================================================

  shouldCompress() {
    // Compress if database is larger than 5MB
    try {
      const stats = fs.statSync(this.databasePath);
      return stats.size > 5 * 1024 * 1024;
    } catch {
      return false;
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getAge(date) {
    const now = new Date();
    const diff = now - new Date(date);

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  }
}

// Export singleton instance
module.exports = new BackupService();
