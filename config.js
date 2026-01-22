// =====================================================
// CONFIGURATION MANAGEMENT
// =====================================================
// Loads and validates environment variables
// Provides type-safe access to configuration
// =====================================================

require('dotenv').config();
const crypto = require('crypto');

class Config {
  constructor() {
    this.validateRequired();
    this.generateSecrets();
  }

  // =====================================================
  // VALIDATION
  // =====================================================

  validateRequired() {
    const warnings = [];
    const errors = [];

    // Check JWT secret
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('CHANGE_THIS')) {
      if (this.isProduction()) {
        errors.push('JWT_SECRET must be set in production');
      } else {
        warnings.push('JWT_SECRET not set - using auto-generated secret (development only!)');
      }
    }

    // Check allowed origins
    if (!process.env.ALLOWED_ORIGINS) {
      warnings.push('ALLOWED_ORIGINS not set - defaulting to localhost');
    }

    // Production checks
    if (this.isProduction()) {
      if (process.env.DEBUG_MODE === 'true') {
        warnings.push('DEBUG_MODE should be false in production');
      }

      if (!process.env.HTTPS_ENABLED || process.env.HTTPS_ENABLED !== 'true') {
        warnings.push('HTTPS should be enabled in production');
      }

      if (!process.env.SENTRY_DSN) {
        warnings.push('SENTRY_DSN not set - error tracking disabled');
      }
    }

    // Display warnings
    if (warnings.length > 0) {
      console.warn('\n⚠️  Configuration Warnings:');
      warnings.forEach(w => console.warn(`   - ${w}`));
    }

    // Display errors and exit if any
    if (errors.length > 0) {
      console.error('\n❌ Configuration Errors:');
      errors.forEach(e => console.error(`   - ${e}`));
      console.error('\n');
      process.exit(1);
    }
  }

  generateSecrets() {
    // Generate JWT secret if not set
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('CHANGE_THIS')) {
      this._generatedJwtSecret = crypto.randomBytes(64).toString('hex');
      if (!this.isProduction()) {
        console.log('ℹ️  Using auto-generated JWT secret (development only)');
      }
    }

    // Generate session secret if not set
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('CHANGE_THIS')) {
      this._generatedSessionSecret = crypto.randomBytes(64).toString('hex');
    }
  }

  // =====================================================
  // GETTERS
  // =====================================================

  // Environment
  isProduction() {
    return process.env.NODE_ENV === 'production';
  }

  isDevelopment() {
    return !this.isProduction();
  }

  // Server
  get port() {
    return parseInt(process.env.PORT) || 5050;
  }

  get host() {
    return process.env.HOST || 'localhost';
  }

  // Security
  get jwtSecret() {
    return process.env.JWT_SECRET || this._generatedJwtSecret;
  }

  get jwtExpiresIn() {
    return process.env.JWT_EXPIRES_IN || '24h';
  }

  get refreshTokenExpiresIn() {
    return process.env.REFRESH_TOKEN_EXPIRES_IN || '30d';
  }

  get bcryptRounds() {
    return parseInt(process.env.BCRYPT_ROUNDS) || 10;
  }

  get maxFailedLoginAttempts() {
    return parseInt(process.env.MAX_FAILED_LOGIN_ATTEMPTS) || 5;
  }

  get accountLockoutMinutes() {
    return parseInt(process.env.ACCOUNT_LOCKOUT_MINUTES) || 15;
  }

  // CORS
  get allowedOrigins() {
    if (process.env.ALLOWED_ORIGINS) {
      return process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    }
    return ['http://localhost:3000', 'http://localhost:5050', 'http://127.0.0.1:5050'];
  }

  // Database
  get databasePath() {
    return process.env.DB_PATH || process.env.DATABASE_PATH || './revenue-radar.db';
  }

  get databaseBackupEnabled() {
    return process.env.DATABASE_BACKUP_ENABLED === 'true';
  }

  get databaseBackupIntervalHours() {
    return parseInt(process.env.DATABASE_BACKUP_INTERVAL_HOURS) || 24;
  }

  get databaseBackupRetentionDays() {
    return parseInt(process.env.DATABASE_BACKUP_RETENTION_DAYS) || 30;
  }

  get databaseBackupPath() {
    return process.env.DATABASE_BACKUP_PATH || './backups';
  }

  // Rate Limiting
  get rateLimitWindowMs() {
    return parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
  }

  get rateLimitMaxRequests() {
    return parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100;
  }

  get loginRateLimitWindowMs() {
    return parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 900000;
  }

  get loginRateLimitMaxRequests() {
    return parseInt(process.env.LOGIN_RATE_LIMIT_MAX_REQUESTS) || 5;
  }

  // Email
  get emailEnabled() {
    return process.env.EMAIL_ENABLED === 'true';
  }

  get smtpConfig() {
    return {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    };
  }

  get emailFrom() {
    return {
      name: process.env.EMAIL_FROM_NAME || 'Revenue Radar',
      address: process.env.EMAIL_FROM_ADDRESS || 'noreply@revenueradar.com'
    };
  }

  // Claude AI
  get anthropicApiKey() {
    return process.env.ANTHROPIC_API_KEY;
  }

  get claudeModel() {
    return process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
  }

  get claudeMaxRetries() {
    return parseInt(process.env.CLAUDE_MAX_RETRIES) || 3;
  }

  get claudeTimeoutMs() {
    return parseInt(process.env.CLAUDE_TIMEOUT_MS) || 30000;
  }

  // Logging
  get logLevel() {
    return process.env.LOG_LEVEL || 'info';
  }

  get logFileEnabled() {
    return process.env.LOG_FILE_ENABLED === 'true';
  }

  get logFilePath() {
    return process.env.LOG_FILE_PATH || './logs/app.log';
  }

  // Features
  get features() {
    return {
      emailAutopilot: process.env.FEATURE_EMAIL_AUTOPILOT !== 'false',
      aiAnalysis: process.env.FEATURE_AI_ANALYSIS !== 'false',
      apiKeys: process.env.FEATURE_API_KEYS !== 'false',
      adminDashboard: process.env.ADMIN_DASHBOARD_ENABLED !== 'false',
      errorTracking: process.env.ERROR_TRACKING_ENABLED !== 'false'
    };
  }

  // SSL/HTTPS
  get httpsEnabled() {
    return process.env.HTTPS_ENABLED === 'true';
  }

  get sslConfig() {
    return {
      keyPath: process.env.SSL_KEY_PATH || './ssl/private-key.pem',
      certPath: process.env.SSL_CERT_PATH || './ssl/certificate.pem',
      caPath: process.env.SSL_CA_PATH || './ssl/ca-bundle.pem'
    };
  }

  get forceHttps() {
    return process.env.FORCE_HTTPS === 'true';
  }

  // Performance
  get compressionEnabled() {
    return process.env.COMPRESSION_ENABLED !== 'false';
  }

  get cacheEnabled() {
    return process.env.CACHE_ENABLED !== 'false';
  }

  get cacheTtlSeconds() {
    return parseInt(process.env.CACHE_TTL_SECONDS) || 300;
  }

  // Development
  get debugMode() {
    return process.env.DEBUG_MODE === 'true';
  }

  get verboseLogging() {
    return process.env.VERBOSE_LOGGING === 'true';
  }

  // File uploads
  get maxFileSizeMB() {
    return parseInt(process.env.MAX_FILE_SIZE_MB) || 10;
  }

  get allowedFileTypes() {
    if (process.env.ALLOWED_FILE_TYPES) {
      return process.env.ALLOWED_FILE_TYPES.split(',').map(t => t.trim());
    }
    return ['pdf', 'xlsx', 'xls', 'csv'];
  }

  // Sentry
  get sentryDsn() {
    return process.env.SENTRY_DSN;
  }

  get sentryEnvironment() {
    return process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';
  }

  // Stripe
  get stripeSecretKey() {
    return process.env.STRIPE_SECRET_KEY;
  }

  get stripePublishableKey() {
    return process.env.STRIPE_PUBLISHABLE_KEY;
  }

  get stripeWebhookSecret() {
    return process.env.STRIPE_WEBHOOK_SECRET;
  }

  // Notifications
  get slackWebhookUrl() {
    return process.env.SLACK_WEBHOOK_URL;
  }

  get slackNotificationsEnabled() {
    return process.env.SLACK_NOTIFICATIONS_ENABLED === 'true' && !!this.slackWebhookUrl;
  }

  // S3 Backups
  get s3BackupEnabled() {
    return process.env.S3_BACKUP_ENABLED === 'true';
  }

  get awsConfig() {
    return {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      bucket: process.env.AWS_S3_BUCKET,
      region: process.env.AWS_S3_REGION || 'us-east-1'
    };
  }

  // Session
  get sessionSecret() {
    return process.env.SESSION_SECRET || this._generatedSessionSecret;
  }

  get sessionTimeoutMinutes() {
    return parseInt(process.env.SESSION_TIMEOUT_MINUTES) || 1440;
  }

  // GDPR
  get gdprEnabled() {
    return process.env.GDPR_ENABLED !== 'false';
  }

  get dataRetentionDays() {
    return parseInt(process.env.DATA_RETENTION_DAYS) || 365;
  }

  // =====================================================
  // UTILITY METHODS
  // =====================================================

  /**
   * Get all configuration as object (for logging/debugging)
   * Sensitive values are masked
   */
  toJSON() {
    return {
      environment: process.env.NODE_ENV,
      port: this.port,
      host: this.host,
      database: this.databasePath,
      features: this.features,
      httpsEnabled: this.httpsEnabled,
      emailEnabled: this.emailEnabled,
      debugMode: this.debugMode,
      jwtSecret: this.jwtSecret ? '[REDACTED]' : '[NOT SET]',
      anthropicApiKey: this.anthropicApiKey ? '[REDACTED]' : '[NOT SET]'
    };
  }

  /**
   * Print configuration summary
   */
  printSummary() {
    console.log('\n📋 Configuration Summary:');
    console.log(`   Environment: ${this.isProduction() ? 'Production' : 'Development'}`);
    console.log(`   Port: ${this.port}`);
    console.log(`   Database: ${this.databasePath}`);
    console.log(`   HTTPS: ${this.httpsEnabled ? 'Enabled' : 'Disabled'}`);
    console.log(`   Email: ${this.emailEnabled ? 'Enabled' : 'Disabled'}`);
    console.log(`   Backups: ${this.databaseBackupEnabled ? 'Enabled' : 'Disabled'}`);
    console.log(`   Features:`);
    console.log(`      - Email Autopilot: ${this.features.emailAutopilot ? '✅' : '❌'}`);
    console.log(`      - AI Analysis: ${this.features.aiAnalysis ? '✅' : '❌'}`);
    console.log(`      - API Keys: ${this.features.apiKeys ? '✅' : '❌'}`);
    console.log(`      - Admin Dashboard: ${this.features.adminDashboard ? '✅' : '❌'}`);
    console.log('');
  }
}

// Export singleton instance
module.exports = new Config();
