// =====================================================
// HEALTH CHECK & MONITORING ROUTES
// =====================================================
// System health monitoring, metrics, and status checks
// =====================================================

const express = require('express');
const router = express.Router();
const os = require('os');
const fs = require('fs');
const db = require('./database');
const config = require('./config');
const backupService = require('./backup-service');
const { requireAuth, requireRole } = require('./auth-middleware');

// =====================================================
// PUBLIC HEALTH CHECK (for load balancers, uptime monitoring)
// =====================================================

/**
 * GET /health
 * Basic health check - returns 200 if server is running
 * Used by load balancers and uptime monitors
 */
router.get('/', async (req, res) => {
  try {
    // Quick database check
    const database = db.getDatabase();
    database.prepare('SELECT 1').get();

    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: 'Database connection failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /health/ping
 * Ultra-simple ping endpoint
 */
router.get('/ping', (req, res) => {
  res.send('pong');
});

// =====================================================
// DETAILED HEALTH CHECKS (Authenticated)
// =====================================================

/**
 * GET /health/detailed
 * Comprehensive health check with all system components
 */
router.get('/detailed', requireAuth, requireRole('admin'), async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    components: {}
  };

  try {
    // 1. Database Health
    health.components.database = await checkDatabase();

    // 2. Disk Space
    health.components.disk = await checkDiskSpace();

    // 3. Memory
    health.components.memory = checkMemory();

    // 4. CPU
    health.components.cpu = checkCPU();

    // 5. Backup Service
    health.components.backups = checkBackupService();

    // 6. Email Service (if enabled)
    if (config.emailEnabled) {
      health.components.email = await checkEmailService();
    }

    // 7. External Dependencies
    health.components.dependencies = await checkDependencies();

    // Determine overall status
    const componentStatuses = Object.values(health.components).map(c => c.status);
    if (componentStatuses.includes('critical')) {
      health.status = 'critical';
    } else if (componentStatuses.includes('degraded')) {
      health.status = 'degraded';
    }

    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;

    res.status(statusCode).json(health);

  } catch (error) {
    res.status(503).json({
      status: 'critical',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /health/metrics
 * Prometheus-style metrics
 */
router.get('/metrics', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const metrics = await collectMetrics();

    // Format as Prometheus metrics
    const lines = [];

    for (const [key, value] of Object.entries(metrics)) {
      if (typeof value === 'number') {
        lines.push(`${key} ${value}`);
      }
    }

    res.set('Content-Type', 'text/plain');
    res.send(lines.join('\n'));

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to collect metrics'
    });
  }
});

/**
 * GET /health/status
 * System status dashboard data
 */
router.get('/status', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const status = {
      server: {
        uptime: formatUptime(process.uptime()),
        nodeVersion: process.version,
        platform: os.platform(),
        hostname: os.hostname(),
        pid: process.pid
      },
      memory: {
        used: formatBytes(process.memoryUsage().heapUsed),
        total: formatBytes(process.memoryUsage().heapTotal),
        percentage: ((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100).toFixed(2) + '%'
      },
      cpu: {
        model: os.cpus()[0].model,
        cores: os.cpus().length,
        loadAverage: os.loadavg().map(l => l.toFixed(2))
      },
      database: await getDatabaseStats(),
      backups: backupService.getStats(),
      environment: {
        nodeEnv: config.isProduction() ? 'production' : 'development',
        httpsEnabled: config.httpsEnabled,
        features: config.features
      }
    };

    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get system status'
    });
  }
});

// =====================================================
// COMPONENT HEALTH CHECKS
// =====================================================

async function checkDatabase() {
  try {
    const database = db.getDatabase();
    const start = Date.now();

    // Test query
    database.prepare('SELECT COUNT(*) as count FROM users').get();

    const responseTime = Date.now() - start;

    // Get database size
    const stats = fs.statSync(config.databasePath);
    const sizeBytes = stats.size;

    return {
      status: responseTime < 100 ? 'healthy' : 'degraded',
      responseTime: `${responseTime}ms`,
      size: formatBytes(sizeBytes),
      message: responseTime < 100 ? 'Database responding normally' : 'Database slow to respond'
    };
  } catch (error) {
    return {
      status: 'critical',
      error: error.message,
      message: 'Database connection failed'
    };
  }
}

async function checkDiskSpace() {
  try {
    const stats = await fs.promises.statfs(process.cwd());
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bfree * stats.bsize;
    const usedBytes = totalBytes - freeBytes;
    const usagePercent = ((usedBytes / totalBytes) * 100).toFixed(2);

    const status = usagePercent > 90 ? 'critical' : usagePercent > 75 ? 'degraded' : 'healthy';

    return {
      status,
      total: formatBytes(totalBytes),
      used: formatBytes(usedBytes),
      free: formatBytes(freeBytes),
      usagePercent: usagePercent + '%',
      message: usagePercent > 90 ? 'Disk space critically low' : usagePercent > 75 ? 'Disk space running low' : 'Sufficient disk space'
    };
  } catch (error) {
    return {
      status: 'unknown',
      error: error.message
    };
  }
}

function checkMemory() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const usagePercent = ((usedMem / totalMem) * 100).toFixed(2);

  const processMemory = process.memoryUsage();
  const heapUsagePercent = ((processMemory.heapUsed / processMemory.heapTotal) * 100).toFixed(2);

  const status = usagePercent > 90 ? 'critical' : usagePercent > 75 ? 'degraded' : 'healthy';

  return {
    status,
    system: {
      total: formatBytes(totalMem),
      used: formatBytes(usedMem),
      free: formatBytes(freeMem),
      usagePercent: usagePercent + '%'
    },
    process: {
      heapUsed: formatBytes(processMemory.heapUsed),
      heapTotal: formatBytes(processMemory.heapTotal),
      heapUsagePercent: heapUsagePercent + '%',
      rss: formatBytes(processMemory.rss)
    },
    message: usagePercent > 90 ? 'Memory critically high' : usagePercent > 75 ? 'Memory usage high' : 'Memory usage normal'
  };
}

function checkCPU() {
  const cpus = os.cpus();
  const loadAvg = os.loadavg();

  // Load average relative to CPU cores
  const loadPercent = ((loadAvg[0] / cpus.length) * 100).toFixed(2);

  const status = loadPercent > 90 ? 'degraded' : 'healthy';

  return {
    status,
    cores: cpus.length,
    model: cpus[0].model,
    speed: `${cpus[0].speed} MHz`,
    loadAverage: {
      '1min': loadAvg[0].toFixed(2),
      '5min': loadAvg[1].toFixed(2),
      '15min': loadAvg[2].toFixed(2)
    },
    loadPercent: loadPercent + '%',
    message: loadPercent > 90 ? 'High CPU load' : 'CPU load normal'
  };
}

function checkBackupService() {
  const stats = backupService.getStats();

  const hasRecentBackup = stats.latestBackup && (new Date() - new Date(stats.latestBackup.created)) < (config.databaseBackupIntervalHours * 3600000 * 2);

  return {
    status: hasRecentBackup || !config.databaseBackupEnabled ? 'healthy' : 'degraded',
    isRunning: stats.isRunning,
    totalBackups: stats.totalBackups,
    latestBackup: stats.latestBackup?.age || 'Never',
    message: !config.databaseBackupEnabled ? 'Backups disabled' : hasRecentBackup ? 'Backups up to date' : 'No recent backup found'
  };
}

async function checkEmailService() {
  // Simple check - would need actual SMTP test for real validation
  return {
    status: 'healthy',
    enabled: config.emailEnabled,
    host: config.smtpConfig.host,
    message: 'Email configuration present'
  };
}

async function checkDependencies() {
  const checks = {
    anthropicApi: await checkAnthropicAPI()
  };

  const allHealthy = Object.values(checks).every(c => c.status === 'healthy');

  return {
    status: allHealthy ? 'healthy' : 'degraded',
    checks,
    message: allHealthy ? 'All dependencies healthy' : 'Some dependencies degraded'
  };
}

async function checkAnthropicAPI() {
  if (!config.anthropicApiKey) {
    return {
      status: 'unknown',
      message: 'API key not configured'
    };
  }

  // In production, you might want to make a test API call
  return {
    status: 'healthy',
    message: 'API key configured'
  };
}

// =====================================================
// METRICS COLLECTION
// =====================================================

async function collectMetrics() {
  const database = db.getDatabase();

  const metrics = {
    // System metrics
    'system_uptime_seconds': process.uptime(),
    'system_memory_used_bytes': process.memoryUsage().heapUsed,
    'system_memory_total_bytes': process.memoryUsage().heapTotal,
    'system_cpu_load_1min': os.loadavg()[0],

    // Database metrics
    'database_size_bytes': fs.statSync(config.databasePath).size,

    // User metrics
    'users_total': database.prepare('SELECT COUNT(*) as count FROM users').get().count,
    'users_active': database.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1').get().count,

    // Session metrics
    'sessions_active': database.prepare('SELECT COUNT(*) as count FROM sessions WHERE is_active = 1').get().count,

    // Error metrics
    'errors_total_24h': database.prepare('SELECT COUNT(*) as count FROM error_logs WHERE created_at >= datetime("now", "-24 hours")').get().count,
    'errors_critical_24h': database.prepare('SELECT COUNT(*) as count FROM error_logs WHERE severity = "critical" AND created_at >= datetime("now", "-24 hours")').get().count,

    // Backup metrics
    'backups_total': backupService.getStats().totalBackups
  };

  return metrics;
}

async function getDatabaseStats() {
  const database = db.getDatabase();

  return {
    size: formatBytes(fs.statSync(config.databasePath).size),
    tables: database.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'").get().count,
    users: database.prepare('SELECT COUNT(*) as count FROM users').get().count,
    sessions: database.prepare('SELECT COUNT(*) as count FROM sessions WHERE is_active = 1').get().count,
    errors24h: database.prepare('SELECT COUNT(*) as count FROM error_logs WHERE created_at >= datetime("now", "-24 hours")').get().count
  };
}

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.join(' ') || '< 1m';
}

module.exports = router;
