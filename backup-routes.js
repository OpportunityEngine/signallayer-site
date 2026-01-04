// =====================================================
// BACKUP MANAGEMENT ROUTES (Admin Only)
// =====================================================

const express = require('express');
const router = express.Router();
const backupService = require('./backup-service');
const { requireAuth, requireRole } = require('./auth-middleware');

/**
 * GET /backups
 * List all backups
 */
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const backups = backupService.listBackups();

    res.json({
      success: true,
      data: backups
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to list backups'
    });
  }
});

/**
 * POST /backups
 * Create a new backup
 */
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await backupService.createBackup();

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /backups/stats
 * Get backup statistics
 */
router.get('/stats', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const stats = backupService.getStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get backup stats'
    });
  }
});

/**
 * POST /backups/restore
 * Restore from backup
 */
router.post('/restore', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { filename } = req.body;

    if (!filename) {
      return res.status(400).json({
        success: false,
        error: 'Backup filename is required'
      });
    }

    const result = await backupService.restoreBackup(filename);

    res.json({
      success: true,
      data: result,
      message: 'Database restored successfully. Please restart the server.'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /backups/download/:filename
 * Download a backup file
 */
router.get('/download/:filename', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { filename } = req.params;
    const backups = backupService.listBackups();
    const backup = backups.find(b => b.filename === filename);

    if (!backup) {
      return res.status(404).json({
        success: false,
        error: 'Backup not found'
      });
    }

    res.download(backup.path, filename);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to download backup'
    });
  }
});

module.exports = router;
