// =====================================================
// INTELLIGENT ERROR HANDLER & PLAIN ENGLISH TRANSLATOR
// =====================================================
// Captures errors, translates to 8th grade reading level
// Auto-assigns severity with reasoning
// =====================================================

const db = require('./database');

class ErrorHandler {
  /**
   * Log and translate an error to plain English
   * @param {Error} error - The error object
   * @param {Object} context - Additional context (endpoint, userId, etc.)
   */
  static async logError(error, context = {}) {
    try {
      const errorAnalysis = this.analyzeError(error, context);

      // Insert into database
      const database = db.getDatabase();
      const result = database.prepare(`
        INSERT INTO error_logs (
          error_code, error_type, technical_message, plain_english,
          severity, severity_reason, is_user_facing,
          endpoint, user_id, account_name, request_data,
          stack_trace, server_version, node_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        errorAnalysis.errorCode,
        errorAnalysis.errorType,
        errorAnalysis.technicalMessage,
        errorAnalysis.plainEnglish,
        errorAnalysis.severity,
        errorAnalysis.severityReason,
        errorAnalysis.isUserFacing ? 1 : 0,
        context.endpoint || null,
        context.userId || null,
        context.accountName || null,
        context.requestData ? JSON.stringify(context.requestData) : null,
        error.stack || null,
        process.env.npm_package_version || '1.0.0',
        process.version
      );

      const errorId = result.lastInsertRowid;

      // Save system context snapshot
      this.saveContextSnapshot(errorId, context);

      // Check for error rate spikes
      this.checkErrorRateSpike(errorAnalysis.errorType);

      // Log to console with color coding
      this.logToConsole(errorAnalysis);

      return errorId;

    } catch (err) {
      // Fallback - don't let error handler crash the app
      console.error('[ERROR HANDLER] Failed to log error:', err);
      console.error('[ORIGINAL ERROR]', error);
    }
  }

  /**
   * Analyze error and translate to plain English
   */
  static analyzeError(error, context) {
    const technicalMessage = error.message || error.toString();
    const stackTrace = error.stack || '';

    // Determine error type
    const errorType = this.categorizeError(technicalMessage, stackTrace, context);

    // Translate to plain English
    const plainEnglish = this.translateToPlainEnglish(technicalMessage, errorType, context);

    // Assign severity
    const { severity, reason } = this.assignSeverity(error, errorType, context);

    // Determine if user-facing
    const isUserFacing = context.isUserFacing || context.endpoint?.includes('/api/');

    // Extract error code
    const errorCode = error.status || error.statusCode || error.code || 'UNKNOWN';

    return {
      errorCode: String(errorCode),
      errorType,
      technicalMessage,
      plainEnglish,
      severity,
      severityReason: reason,
      isUserFacing
    };
  }

  /**
   * Categorize error type
   */
  static categorizeError(message, stack, context) {
    const lowerMessage = message.toLowerCase();
    const lowerStack = stack.toLowerCase();

    if (lowerMessage.includes('sqlite') || lowerMessage.includes('database') ||
        lowerMessage.includes('sql syntax')) {
      return 'database';
    }

    if (lowerMessage.includes('imap') || lowerMessage.includes('smtp') ||
        lowerMessage.includes('email') || lowerMessage.includes('mailparser')) {
      return 'email';
    }

    if (lowerMessage.includes('fetch') || lowerMessage.includes('axios') ||
        context.endpoint) {
      return 'api';
    }

    if (lowerMessage.includes('pdf') || lowerMessage.includes('xlsx') ||
        lowerMessage.includes('parse') || lowerMessage.includes('file')) {
      return 'file_processing';
    }

    if (lowerMessage.includes('auth') || lowerMessage.includes('permission') ||
        lowerMessage.includes('unauthorized')) {
      return 'authentication';
    }

    if (lowerMessage.includes('memory') || lowerMessage.includes('heap') ||
        lowerMessage.includes('timeout') || lowerMessage.includes('econnrefused')) {
      return 'performance';
    }

    if (lowerMessage.includes('validation') || lowerMessage.includes('required') ||
        lowerMessage.includes('invalid')) {
      return 'validation';
    }

    if (lowerMessage.includes('claude') || lowerMessage.includes('openai') ||
        lowerMessage.includes('external')) {
      return 'external_service';
    }

    return 'system';
  }

  /**
   * Translate technical error to 8th grade reading level plain English
   */
  static translateToPlainEnglish(technicalMessage, errorType, context) {
    const translations = {
      // Database errors
      'SQLITE_BUSY': 'The database is busy with another task right now. This usually fixes itself in a few seconds.',
      'SQLITE_LOCKED': 'The database is locked by another process. The system will retry automatically.',
      'SQLITE_CANTOPEN': 'The system cannot open the database file. This might mean the file is missing or the disk is full.',
      'database': 'There was a problem saving or reading data from the database.',

      // Email errors
      'IMAP': 'The system cannot connect to the email server. Check if the email password is correct or if the email service is down.',
      'Authentication': 'The email login failed. The password might be wrong or expired.',
      'No supported authentication': 'The email server does not accept the login method we are using. You may need to create an app password.',

      // API errors
      'fetch failed': 'The system could not connect to an external service. Check your internet connection.',
      'ECONNREFUSED': 'The system tried to connect to a service but it was not available. The service might be down.',
      'timeout': 'The operation took too long and was canceled. The service might be slow or overloaded.',

      // File processing
      'Failed to parse': 'The system could not read the uploaded file. The file might be corrupted or in the wrong format.',
      'File too large': 'The uploaded file is too big. Try uploading a smaller file.',
      'Invalid PDF': 'The PDF file is damaged or cannot be read. Try uploading a different file.',

      // Validation errors
      'required': 'Some required information is missing. Please check that all fields are filled in.',
      'invalid': 'The information provided is not in the correct format. Please check and try again.',

      // Memory/Performance
      'out of memory': 'The server ran out of memory. This happens when processing very large files. Contact support.',
      'heap': 'The server is using too much memory and needs to be restarted.',

      // External services
      'Claude API': 'The AI service (Claude) is not responding. This is usually temporary. Try again in a few minutes.',
      'rate limit': 'Too many requests were sent to the AI service. The system will slow down automatically.'
    };

    // Try to match known error patterns
    for (const [pattern, translation] of Object.entries(translations)) {
      if (technicalMessage.includes(pattern) || technicalMessage.includes(pattern.toLowerCase())) {
        return this.addContextToTranslation(translation, context);
      }
    }

    // Fallback: Create generic plain English based on error type
    const fallbackTranslations = {
      database: 'There was a problem with the database. Your data is safe, but the system could not complete the operation.',
      email: 'The email monitoring system had a problem. Email processing may be delayed.',
      api: 'The system encountered an error while processing your request. Please try again.',
      file_processing: 'There was a problem reading or processing the file you uploaded. Please check the file and try again.',
      authentication: 'There was a login or permission problem. Please check your credentials.',
      performance: 'The server is running slowly or is overloaded. Please wait a moment and try again.',
      validation: 'The information you provided is missing or incorrect. Please check your input and try again.',
      external_service: 'An external service is not responding. This is usually temporary. Please try again in a few minutes.',
      system: 'The system encountered an unexpected error. The technical team has been notified.'
    };

    const fallback = fallbackTranslations[errorType] || 'Something went wrong. The system is still working, but this operation failed.';
    return this.addContextToTranslation(fallback, context);
  }

  /**
   * Add context to make translation more specific
   */
  static addContextToTranslation(translation, context) {
    if (context.accountName) {
      translation += ` (Customer: ${context.accountName})`;
    }
    if (context.endpoint) {
      const action = this.endpointToAction(context.endpoint);
      if (action) {
        translation = `While ${action}: ${translation}`;
      }
    }
    return translation;
  }

  /**
   * Convert endpoint to user-friendly action
   */
  static endpointToAction(endpoint) {
    const actions = {
      '/ingest': 'uploading an invoice',
      '/api/email-monitors': 'managing email monitors',
      '/upload-mla-excel': 'uploading an Excel contract',
      '/api/rules': 'creating or editing rules',
      '/api/opportunities': 'managing opportunities'
    };

    for (const [path, action] of Object.entries(actions)) {
      if (endpoint.includes(path)) {
        return action;
      }
    }
    return null;
  }

  /**
   * Assign severity level with reasoning
   */
  static assignSeverity(error, errorType, context) {
    // Critical: System is broken, users cannot work
    if (errorType === 'database' && error.message.includes('CANTOPEN')) {
      return {
        severity: 'critical',
        reason: 'Database is not accessible. No one can use the system until this is fixed.'
      };
    }

    if (errorType === 'performance' && error.message.includes('out of memory')) {
      return {
        severity: 'critical',
        reason: 'Server ran out of memory. The system may crash or stop working.'
      };
    }

    // High: Important feature broken, affects multiple users
    if (errorType === 'email' && error.message.includes('Authentication')) {
      return {
        severity: 'high',
        reason: 'Email monitoring stopped working. Invoices will not be processed automatically.'
      };
    }

    if (errorType === 'database' && (error.message.includes('BUSY') || error.message.includes('LOCKED'))) {
      return {
        severity: 'high',
        reason: 'Database is locked. Operations are failing. This usually resolves itself, but monitor closely.'
      };
    }

    if (errorType === 'authentication') {
      return {
        severity: 'high',
        reason: 'Users cannot log in or access features. This blocks work.'
      };
    }

    // Medium: Feature partially broken or slow, workarounds exist
    if (errorType === 'api') {
      return {
        severity: 'medium',
        reason: 'An API request failed. Users can retry, but this indicates a problem that needs attention.'
      };
    }

    if (errorType === 'file_processing') {
      return {
        severity: 'medium',
        reason: 'File upload failed. Users can try again with a different file, but this should not happen often.'
      };
    }

    if (errorType === 'external_service') {
      return {
        severity: 'medium',
        reason: 'An external service (like Claude AI) is not responding. Usually temporary, but monitor if it continues.'
      };
    }

    // Low: Minor issue, does not block work
    if (errorType === 'validation') {
      return {
        severity: 'low',
        reason: 'User entered invalid data. This is normal user error, not a system problem.'
      };
    }

    // Default: Medium
    return {
      severity: 'medium',
      reason: 'An error occurred that may affect some users. Monitor to see if it happens again.'
    };
  }

  /**
   * Save system context snapshot
   */
  static saveContextSnapshot(errorId, context) {
    try {
      const database = db.getDatabase();

      // Get current memory usage
      const memUsage = process.memoryUsage();
      const memoryMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      database.prepare(`
        INSERT INTO error_context_snapshots (
          error_log_id, memory_usage_mb, user_agent, ip_address,
          request_method, request_url
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        errorId,
        memoryMB,
        context.userAgent || null,
        context.ipAddress || null,
        context.method || null,
        context.endpoint || null
      );
    } catch (err) {
      console.error('[ERROR HANDLER] Failed to save context snapshot:', err);
    }
  }

  /**
   * Check for error rate spikes
   */
  static checkErrorRateSpike(errorType) {
    try {
      const database = db.getDatabase();

      // Count errors in last 5 minutes
      const recentErrors = database.prepare(`
        SELECT COUNT(*) as count
        FROM error_logs
        WHERE error_type = ?
        AND created_at >= datetime('now', '-5 minutes')
      `).get(errorType);

      const threshold = 5; // Alert if >5 errors in 5 minutes

      if (recentErrors.count > threshold) {
        database.prepare(`
          INSERT INTO error_rate_tracking (
            error_type, time_window, error_count, threshold_exceeded
          ) VALUES (?, '5min', ?, 1)
        `).run(errorType, recentErrors.count);

        console.error(`[ERROR SPIKE] ${errorType}: ${recentErrors.count} errors in 5 minutes (threshold: ${threshold})`);
      }
    } catch (err) {
      console.error('[ERROR HANDLER] Failed to check error rate:', err);
    }
  }

  /**
   * Log to console with color coding
   */
  static logToConsole(errorAnalysis) {
    const colors = {
      critical: '\x1b[41m\x1b[37m', // Red background, white text
      high: '\x1b[31m',              // Red text
      medium: '\x1b[33m',            // Yellow text
      low: '\x1b[36m'                // Cyan text
    };
    const reset = '\x1b[0m';

    const color = colors[errorAnalysis.severity] || reset;

    console.error(`${color}[${errorAnalysis.severity.toUpperCase()}]${reset} ${errorAnalysis.plainEnglish}`);
    console.error(`  Type: ${errorAnalysis.errorType}`);
    console.error(`  Reason: ${errorAnalysis.severityReason}`);
    console.error(`  Technical: ${errorAnalysis.technicalMessage}`);
  }

  /**
   * Get recent errors for dashboard
   */
  static getRecentErrors(limit = 20, severity = null) {
    const database = db.getDatabase();

    let query = `
      SELECT
        id, error_type, plain_english, severity, severity_reason,
        is_user_facing, endpoint, account_name, created_at, status
      FROM error_logs
    `;

    const params = [];

    if (severity) {
      query += ` WHERE severity = ?`;
      params.push(severity);
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    return database.prepare(query).all(...params);
  }

  /**
   * Get error summary statistics
   */
  static getErrorSummary(hours = 24) {
    const database = db.getDatabase();

    const summary = database.prepare(`
      SELECT
        COUNT(*) as total_errors,
        SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical_count,
        SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high_count,
        SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) as medium_count,
        SUM(CASE WHEN severity = 'low' THEN 1 ELSE 0 END) as low_count,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as unresolved_count
      FROM error_logs
      WHERE created_at >= datetime('now', '-${hours} hours')
    `).get();

    const byType = database.prepare(`
      SELECT
        error_type,
        COUNT(*) as count,
        MAX(severity) as max_severity
      FROM error_logs
      WHERE created_at >= datetime('now', '-${hours} hours')
      GROUP BY error_type
      ORDER BY count DESC
    `).all();

    return {
      ...summary,
      byType
    };
  }

  /**
   * Mark error as resolved
   */
  static resolveError(errorId, resolvedBy, notes) {
    const database = db.getDatabase();

    database.prepare(`
      UPDATE error_logs
      SET status = 'resolved',
          resolved_at = CURRENT_TIMESTAMP,
          resolved_by = ?,
          resolution_notes = ?
      WHERE id = ?
    `).run(resolvedBy, notes, errorId);
  }
}

module.exports = ErrorHandler;
