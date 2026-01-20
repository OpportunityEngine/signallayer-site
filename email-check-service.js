// =====================================================
// EMAIL CHECK SERVICE - Reliable Email Processing Pipeline
// =====================================================
// Implements full observability for email invoice processing:
// - Check runs with step-by-step tracing
// - Detailed logging for every email (including skips)
// - Robust MIME detection (extension + content-type)
// - Proper UID deduplication with uidvalidity
// - Concurrency locking
// =====================================================

const crypto = require('crypto');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const db = require('./database');

// Try to load OAuth service
let emailOAuth = null;
try {
  emailOAuth = require('./email-oauth-service');
} catch (e) {
  console.log('[EMAIL-CHECK] OAuth service not available');
}

// Encryption for passwords
const ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY || 'revenue-radar-email-key-2026';

// Supported attachment types (expanded)
const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/octet-stream', // Often used for PDFs!
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/tiff',
  'image/webp',
  'image/heic',
  'image/gif'
]);

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp', '.heic', '.gif'
]);

const INVOICE_KEYWORDS = [
  'invoice', 'bill', 'statement', 'receipt', 'order',
  'payment', 'purchase', 'po', 'quote', 'estimate',
  'remittance', 'credit', 'debit'
];

class EmailCheckService {
  constructor() {
    this.database = null;
  }

  /**
   * Initialize database tables for check runs
   */
  initTables() {
    const database = db.getDatabase();

    // Create email_check_runs table
    database.exec(`
      CREATE TABLE IF NOT EXISTS email_check_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER NOT NULL,
        run_uuid TEXT UNIQUE NOT NULL,
        triggered_by TEXT NOT NULL DEFAULT 'manual',
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        finished_at DATETIME,
        status TEXT NOT NULL DEFAULT 'started',

        folder_opened TEXT,
        uidvalidity INTEGER,
        search_query TEXT,

        found_messages INTEGER DEFAULT 0,
        fetched_messages INTEGER DEFAULT 0,
        attachments_total INTEGER DEFAULT 0,
        attachments_supported INTEGER DEFAULT 0,
        emails_skipped INTEGER DEFAULT 0,
        emails_processed INTEGER DEFAULT 0,
        invoices_created INTEGER DEFAULT 0,
        errors_count INTEGER DEFAULT 0,

        error_message TEXT,
        last_stage TEXT,

        connect_time_ms INTEGER,
        search_time_ms INTEGER,
        fetch_time_ms INTEGER,
        process_time_ms INTEGER,
        total_time_ms INTEGER,

        debug_json TEXT,

        FOREIGN KEY (monitor_id) REFERENCES email_monitors(id) ON DELETE CASCADE
      )
    `);

    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_email_check_runs_monitor ON email_check_runs(monitor_id);
      CREATE INDEX IF NOT EXISTS idx_email_check_runs_uuid ON email_check_runs(run_uuid);
      CREATE INDEX IF NOT EXISTS idx_email_check_runs_started ON email_check_runs(started_at DESC);
    `);

    // Create email_monitor_locks table
    database.exec(`
      CREATE TABLE IF NOT EXISTS email_monitor_locks (
        monitor_id INTEGER PRIMARY KEY,
        locked_at DATETIME NOT NULL,
        lock_owner TEXT NOT NULL,
        lock_expires_at DATETIME NOT NULL,
        FOREIGN KEY (monitor_id) REFERENCES email_monitors(id) ON DELETE CASCADE
      )
    `);

    // Create or migrate email_processing_log table
    // First check if table exists
    const tableExists = database.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='email_processing_log'
    `).get();

    if (!tableExists) {
      // Create fresh table with all columns
      database.exec(`
        CREATE TABLE email_processing_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          monitor_id INTEGER NOT NULL,
          check_run_uuid TEXT,

          uidvalidity INTEGER,
          uid INTEGER,
          message_id_header TEXT,
          email_uid TEXT,
          email_subject TEXT,
          from_address TEXT,
          received_date DATETIME,

          status TEXT NOT NULL DEFAULT 'found',
          skip_reason TEXT,

          attachments_count INTEGER DEFAULT 0,
          attachments_supported INTEGER DEFAULT 0,
          attachment_mime_list TEXT,
          attachment_name_list TEXT,

          invoices_created INTEGER DEFAULT 0,
          invoice_ids TEXT,
          processing_time_ms INTEGER DEFAULT 0,
          error_message TEXT,

          processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,

          FOREIGN KEY (monitor_id) REFERENCES email_monitors(id) ON DELETE CASCADE
        )
      `);
    } else {
      // Table exists - add missing columns via ALTER TABLE
      const columnsToAdd = [
        { name: 'check_run_uuid', type: 'TEXT' },
        { name: 'uidvalidity', type: 'INTEGER' },
        { name: 'uid', type: 'INTEGER' },
        { name: 'message_id_header', type: 'TEXT' },
        { name: 'skip_reason', type: 'TEXT' },
        { name: 'attachments_supported', type: 'INTEGER DEFAULT 0' },
        { name: 'attachment_mime_list', type: 'TEXT' },
        { name: 'attachment_name_list', type: 'TEXT' }
      ];

      // Get existing columns
      const existingColumns = database.prepare(`PRAGMA table_info(email_processing_log)`).all();
      const existingColumnNames = new Set(existingColumns.map(c => c.name));

      for (const col of columnsToAdd) {
        if (!existingColumnNames.has(col.name)) {
          try {
            database.exec(`ALTER TABLE email_processing_log ADD COLUMN ${col.name} ${col.type}`);
            console.log(`[EMAIL-CHECK] Added column ${col.name} to email_processing_log`);
          } catch (err) {
            // Column might already exist from a previous migration attempt
            if (!err.message.includes('duplicate column')) {
              console.error(`[EMAIL-CHECK] Error adding column ${col.name}:`, err.message);
            }
          }
        }
      }
    }

    // Create indexes (IF NOT EXISTS handles duplicates)
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_email_processing_log_monitor ON email_processing_log(monitor_id);
      CREATE INDEX IF NOT EXISTS idx_email_processing_log_run ON email_processing_log(check_run_uuid);
      CREATE INDEX IF NOT EXISTS idx_email_processing_log_dedupe ON email_processing_log(monitor_id, uidvalidity, uid);
      CREATE INDEX IF NOT EXISTS idx_email_processing_log_msgid ON email_processing_log(monitor_id, message_id_header);
    `);

    console.log('[EMAIL-CHECK] Tables initialized');
  }

  /**
   * Acquire lock for a monitor (prevents concurrent processing)
   */
  acquireLock(monitorId, owner) {
    const database = db.getDatabase();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minute lock

    // First, clean up expired locks
    database.prepare(`
      DELETE FROM email_monitor_locks WHERE lock_expires_at < datetime('now')
    `).run();

    // Try to acquire lock
    try {
      database.prepare(`
        INSERT INTO email_monitor_locks (monitor_id, locked_at, lock_owner, lock_expires_at)
        VALUES (?, datetime('now'), ?, ?)
      `).run(monitorId, owner, expiresAt.toISOString());
      return true;
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed') || err.message.includes('PRIMARY KEY')) {
        // Lock already held
        return false;
      }
      throw err;
    }
  }

  /**
   * Release lock for a monitor
   */
  releaseLock(monitorId, owner) {
    const database = db.getDatabase();
    database.prepare(`
      DELETE FROM email_monitor_locks WHERE monitor_id = ? AND lock_owner = ?
    `).run(monitorId, owner);
  }

  /**
   * Begin a check run
   */
  beginCheckRun(monitorId, triggeredBy = 'manual') {
    const database = db.getDatabase();
    const runUuid = crypto.randomUUID();

    database.prepare(`
      INSERT INTO email_check_runs (monitor_id, run_uuid, triggered_by, status, last_stage)
      VALUES (?, ?, ?, 'started', 'init')
    `).run(monitorId, runUuid, triggeredBy);

    const row = database.prepare(`SELECT id FROM email_check_runs WHERE run_uuid = ?`).get(runUuid);

    return { runUuid, id: row.id };
  }

  /**
   * Update check run with partial data
   */
  updateCheckRun(runUuid, patch) {
    const database = db.getDatabase();
    const updates = [];
    const values = [];

    for (const [key, value] of Object.entries(patch)) {
      // Convert camelCase to snake_case
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      updates.push(`${snakeKey} = ?`);
      values.push(value);
    }

    if (updates.length === 0) return;

    values.push(runUuid);
    database.prepare(`
      UPDATE email_check_runs SET ${updates.join(', ')} WHERE run_uuid = ?
    `).run(...values);
  }

  /**
   * Finish check run
   */
  finishCheckRun(runUuid, status, patch = {}) {
    const database = db.getDatabase();
    const updates = ['finished_at = datetime("now")', 'status = ?'];
    const values = [status];

    for (const [key, value] of Object.entries(patch)) {
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      updates.push(`${snakeKey} = ?`);
      values.push(value);
    }

    // Calculate total time
    updates.push(`total_time_ms = (julianday(datetime('now')) - julianday(started_at)) * 86400000`);

    values.push(runUuid);
    database.prepare(`
      UPDATE email_check_runs SET ${updates.join(', ')} WHERE run_uuid = ?
    `).run(...values);
  }

  /**
   * Log email processing (including skips)
   */
  logEmailProcessing(data) {
    const database = db.getDatabase();

    database.prepare(`
      INSERT INTO email_processing_log (
        monitor_id, check_run_uuid, uidvalidity, uid, message_id_header,
        email_uid, email_subject, from_address, received_date,
        status, skip_reason,
        attachments_count, attachments_supported, attachment_mime_list, attachment_name_list,
        invoices_created, invoice_ids, processing_time_ms, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.monitorId,
      data.checkRunUuid || null,
      data.uidvalidity || null,
      data.uid || null,
      data.messageIdHeader || null,
      data.emailUid || null,
      data.subject || null,
      data.fromAddress || null,
      data.receivedDate || null,
      data.status || 'found',
      data.skipReason || null,
      data.attachmentsCount || 0,
      data.attachmentsSupported || 0,
      data.attachmentMimeList ? JSON.stringify(data.attachmentMimeList.slice(0, 10)) : null,
      data.attachmentNameList ? JSON.stringify(data.attachmentNameList.slice(0, 10)) : null,
      data.invoicesCreated || 0,
      data.invoiceIds || null,
      data.processingTimeMs || 0,
      data.errorMessage || null
    );
  }

  /**
   * Check if email was already processed (proper dedupe with uidvalidity)
   */
  isEmailProcessed(monitorId, uidvalidity, uid, messageId) {
    const database = db.getDatabase();

    // Check by uidvalidity + uid first (most reliable)
    if (uidvalidity && uid) {
      const byUid = database.prepare(`
        SELECT id FROM email_processing_log
        WHERE monitor_id = ? AND uidvalidity = ? AND uid = ? AND status NOT IN ('error', 'skipped')
      `).get(monitorId, uidvalidity, uid);
      if (byUid) return { isDuplicate: true, reason: 'uid_match' };
    }

    // Fallback: check by Message-ID header
    if (messageId) {
      const byMsgId = database.prepare(`
        SELECT id FROM email_processing_log
        WHERE monitor_id = ? AND message_id_header = ? AND status NOT IN ('error', 'skipped')
      `).get(monitorId, messageId);
      if (byMsgId) return { isDuplicate: true, reason: 'message_id_match' };
    }

    return { isDuplicate: false };
  }

  /**
   * Check if attachment is supported (relaxed MIME filtering)
   */
  isSupportedAttachment(attachment) {
    const contentType = (attachment.contentType || '').toLowerCase();
    const filename = (attachment.filename || '').toLowerCase();
    const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';

    // Check by extension first (most reliable for PDFs sent as octet-stream)
    if (ext && SUPPORTED_EXTENSIONS.has(ext)) {
      return { supported: true, reason: 'extension_match', ext };
    }

    // Check by MIME type
    if (SUPPORTED_MIME_TYPES.has(contentType)) {
      return { supported: true, reason: 'mime_match', contentType };
    }

    // Special case: octet-stream with PDF-like filename
    if (contentType === 'application/octet-stream') {
      if (filename.includes('invoice') || filename.includes('bill') || filename.includes('statement')) {
        return { supported: true, reason: 'octet_stream_invoice_name', filename };
      }
    }

    return { supported: false, reason: 'unsupported_type', contentType, ext };
  }

  /**
   * Check if email matches invoice criteria
   */
  matchesInvoiceCriteria(emailData, monitor) {
    const subject = (emailData.subject || '').toLowerCase();
    const from = (emailData.from || '').toLowerCase();

    // Get filenames from attachments
    const filenames = (emailData.attachments || [])
      .map(a => (a.filename || '').toLowerCase())
      .join(' ');

    // Combine all searchable text
    const searchText = `${subject} ${filenames} ${from}`;

    // Check for invoice keywords
    const hasKeyword = INVOICE_KEYWORDS.some(kw => searchText.includes(kw));

    // Check for invoice-like patterns in filenames
    const invoicePatterns = [/inv[-_]?\d+/i, /po[-_]?\d+/i, /\d{4,}/];
    const hasPattern = invoicePatterns.some(pattern => pattern.test(filenames));

    return {
      matches: hasKeyword || hasPattern,
      hasKeyword,
      hasPattern,
      matchedKeywords: INVOICE_KEYWORDS.filter(kw => searchText.includes(kw))
    };
  }

  /**
   * Build IMAP configuration for a monitor
   */
  async buildIMAPConfig(monitor) {
    const baseConfig = {
      user: monitor.imap_user || monitor.email_address,
      host: monitor.imap_host || 'imap.gmail.com',
      port: monitor.imap_port || 993,
      tls: monitor.imap_secure !== 0,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 30000,
      authTimeout: 15000
    };

    // OAuth authentication
    if (monitor.oauth_provider && emailOAuth) {
      try {
        const accessToken = await emailOAuth.getValidAccessToken(monitor);
        if (!accessToken) {
          throw new Error('Failed to get OAuth access token - may need to reconnect');
        }

        const xoauth2Token = emailOAuth.createXOAuth2Token(
          monitor.email_address,
          accessToken
        );

        return { ...baseConfig, xoauth2: xoauth2Token, authMethod: 'oauth' };
      } catch (err) {
        throw new Error(`OAuth authentication failed: ${err.message}`);
      }
    }

    // Password authentication
    if (monitor.imap_password_encrypted) {
      const crypto = require('crypto-js');
      const bytes = crypto.AES.decrypt(monitor.imap_password_encrypted, ENCRYPTION_KEY);
      const password = bytes.toString(crypto.enc.Utf8);
      return { ...baseConfig, password, authMethod: 'password' };
    }

    throw new Error('No authentication method available');
  }

  /**
   * Run a full email check with complete tracing
   */
  async checkEmails(monitorId, triggeredBy = 'manual', options = {}) {
    const startTime = Date.now();
    const database = db.getDatabase();

    // Get monitor
    const monitor = database.prepare(`SELECT * FROM email_monitors WHERE id = ?`).get(monitorId);
    if (!monitor) {
      throw new Error(`Monitor ${monitorId} not found`);
    }

    if (!monitor.is_active) {
      throw new Error(`Monitor ${monitorId} is not active`);
    }

    // Try to acquire lock
    const lockOwner = `check-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    if (!this.acquireLock(monitorId, lockOwner)) {
      throw new Error(`Monitor ${monitorId} is already being processed`);
    }

    // Begin check run
    const { runUuid } = this.beginCheckRun(monitorId, triggeredBy);

    const results = {
      runUuid,
      monitorId,
      success: false,
      stage: 'init',
      found: 0,
      fetched: 0,
      processed: 0,
      skipped: 0,
      invoicesCreated: 0,
      errors: 0,
      emailDetails: []
    };

    let imap = null;

    try {
      // Stage: Build config
      results.stage = 'config';
      this.updateCheckRun(runUuid, { lastStage: 'config' });

      const imapConfig = await this.buildIMAPConfig(monitor);

      // Stage: Connect
      results.stage = 'connect';
      this.updateCheckRun(runUuid, { lastStage: 'connect' });
      const connectStart = Date.now();

      imap = new Imap(imapConfig);

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('IMAP connection timeout (30s)'));
        }, 30000);

        imap.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        imap.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        imap.connect();
      });

      const connectTime = Date.now() - connectStart;
      this.updateCheckRun(runUuid, { connectTimeMs: connectTime });

      // Stage: Open folder
      results.stage = 'open_folder';
      this.updateCheckRun(runUuid, { lastStage: 'open_folder' });

      const folderName = monitor.folder_name || 'INBOX';

      const box = await new Promise((resolve, reject) => {
        imap.openBox(folderName, false, (err, box) => {
          if (err) reject(err);
          else resolve(box);
        });
      });

      const uidvalidity = box.uidvalidity;
      this.updateCheckRun(runUuid, {
        folderOpened: folderName,
        uidvalidity
      });

      // Stage: Search
      results.stage = 'search';
      this.updateCheckRun(runUuid, { lastStage: 'search' });
      const searchStart = Date.now();

      // Search for emails from last 7 days
      const sinceDays = options.sinceDays || 7;
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - sinceDays);

      const searchCriteria = [['SINCE', sinceDate]];
      const searchQuery = `SINCE ${sinceDate.toISOString().split('T')[0]}`;

      const uids = await new Promise((resolve, reject) => {
        imap.search(searchCriteria, (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        });
      });

      const searchTime = Date.now() - searchStart;
      results.found = uids.length;
      this.updateCheckRun(runUuid, {
        searchTimeMs: searchTime,
        searchQuery,
        foundMessages: uids.length
      });

      if (uids.length === 0) {
        results.success = true;
        results.stage = 'complete';
        this.finishCheckRun(runUuid, 'success', { lastStage: 'complete' });
        this.releaseLock(monitorId, lockOwner);
        return results;
      }

      // Stage: Fetch and process
      results.stage = 'fetch';
      this.updateCheckRun(runUuid, { lastStage: 'fetch' });
      const fetchStart = Date.now();

      // Limit to most recent emails
      const limit = options.limit || 50;
      const uidsToFetch = uids.slice(-limit);

      // Fetch emails
      const emails = await this.fetchEmails(imap, uidsToFetch, uidvalidity);
      results.fetched = emails.length;

      const fetchTime = Date.now() - fetchStart;
      this.updateCheckRun(runUuid, {
        fetchTimeMs: fetchTime,
        fetchedMessages: emails.length
      });

      // Stage: Process each email
      results.stage = 'process';
      this.updateCheckRun(runUuid, { lastStage: 'process' });
      const processStart = Date.now();

      let totalAttachments = 0;
      let supportedAttachments = 0;

      for (const email of emails) {
        const emailResult = {
          uid: email.uid,
          subject: email.subject,
          from: email.from,
          date: email.date,
          messageId: email.messageId,
          attachmentCount: email.attachments?.length || 0,
          supportedAttachmentCount: 0,
          status: 'found',
          skipReason: null,
          invoicesCreated: 0
        };

        totalAttachments += emailResult.attachmentCount;

        try {
          // Check for duplicates
          const dupeCheck = this.isEmailProcessed(monitorId, uidvalidity, email.uid, email.messageId);
          if (dupeCheck.isDuplicate) {
            emailResult.status = 'skipped';
            emailResult.skipReason = `already_processed_${dupeCheck.reason}`;
            results.skipped++;

            this.logEmailProcessing({
              monitorId,
              checkRunUuid: runUuid,
              uidvalidity,
              uid: email.uid,
              messageIdHeader: email.messageId,
              emailUid: email.uid?.toString(),
              subject: email.subject,
              fromAddress: email.from,
              receivedDate: email.date,
              status: 'skipped',
              skipReason: emailResult.skipReason,
              attachmentsCount: emailResult.attachmentCount
            });

            results.emailDetails.push(emailResult);
            continue;
          }

          // Check attachments
          if (!email.attachments || email.attachments.length === 0) {
            emailResult.status = 'skipped';
            emailResult.skipReason = 'no_attachments';
            results.skipped++;

            this.logEmailProcessing({
              monitorId,
              checkRunUuid: runUuid,
              uidvalidity,
              uid: email.uid,
              messageIdHeader: email.messageId,
              emailUid: email.uid?.toString(),
              subject: email.subject,
              fromAddress: email.from,
              receivedDate: email.date,
              status: 'skipped',
              skipReason: 'no_attachments',
              attachmentsCount: 0
            });

            results.emailDetails.push(emailResult);
            continue;
          }

          // Check for supported attachments
          const attachmentMimes = [];
          const attachmentNames = [];
          const supportedAtts = [];

          for (const att of email.attachments) {
            attachmentMimes.push(att.contentType || 'unknown');
            attachmentNames.push(att.filename || 'unnamed');

            const support = this.isSupportedAttachment(att);
            if (support.supported) {
              supportedAtts.push(att);
            }
          }

          emailResult.supportedAttachmentCount = supportedAtts.length;
          supportedAttachments += supportedAtts.length;

          if (supportedAtts.length === 0) {
            emailResult.status = 'skipped';
            emailResult.skipReason = 'unsupported_attachment_types';
            results.skipped++;

            this.logEmailProcessing({
              monitorId,
              checkRunUuid: runUuid,
              uidvalidity,
              uid: email.uid,
              messageIdHeader: email.messageId,
              emailUid: email.uid?.toString(),
              subject: email.subject,
              fromAddress: email.from,
              receivedDate: email.date,
              status: 'skipped',
              skipReason: 'unsupported_attachment_types',
              attachmentsCount: emailResult.attachmentCount,
              attachmentsSupported: 0,
              attachmentMimeList: attachmentMimes,
              attachmentNameList: attachmentNames
            });

            results.emailDetails.push(emailResult);
            continue;
          }

          // Check keyword filter (if enabled)
          const requireKeywords = monitor.require_invoice_keywords !== 0;
          if (requireKeywords) {
            const criteria = this.matchesInvoiceCriteria(email, monitor);
            if (!criteria.matches) {
              emailResult.status = 'skipped';
              emailResult.skipReason = 'keyword_filter_miss';
              results.skipped++;

              this.logEmailProcessing({
                monitorId,
                checkRunUuid: runUuid,
                uidvalidity,
                uid: email.uid,
                messageIdHeader: email.messageId,
                emailUid: email.uid?.toString(),
                subject: email.subject,
                fromAddress: email.from,
                receivedDate: email.date,
                status: 'skipped',
                skipReason: 'keyword_filter_miss',
                attachmentsCount: emailResult.attachmentCount,
                attachmentsSupported: emailResult.supportedAttachmentCount,
                attachmentMimeList: attachmentMimes,
                attachmentNameList: attachmentNames
              });

              results.emailDetails.push(emailResult);
              continue;
            }
          }

          // Process this email's attachments
          const processResult = await this.processEmailAttachments(
            email,
            supportedAtts,
            monitor,
            runUuid,
            uidvalidity
          );

          emailResult.status = processResult.success ? 'processed' : 'error';
          emailResult.invoicesCreated = processResult.invoicesCreated || 0;
          emailResult.errorMessage = processResult.error;

          if (processResult.success) {
            results.processed++;
            results.invoicesCreated += processResult.invoicesCreated;
          } else {
            results.errors++;
          }

          // Log the processing
          this.logEmailProcessing({
            monitorId,
            checkRunUuid: runUuid,
            uidvalidity,
            uid: email.uid,
            messageIdHeader: email.messageId,
            emailUid: email.uid?.toString(),
            subject: email.subject,
            fromAddress: email.from,
            receivedDate: email.date,
            status: emailResult.status === 'processed' ? 'db_ok' : 'error',
            skipReason: processResult.error ? 'process_failed' : null,
            attachmentsCount: emailResult.attachmentCount,
            attachmentsSupported: emailResult.supportedAttachmentCount,
            attachmentMimeList: attachmentMimes,
            attachmentNameList: attachmentNames,
            invoicesCreated: emailResult.invoicesCreated,
            errorMessage: processResult.error
          });

          results.emailDetails.push(emailResult);

        } catch (emailErr) {
          emailResult.status = 'error';
          emailResult.errorMessage = emailErr.message;
          results.errors++;

          this.logEmailProcessing({
            monitorId,
            checkRunUuid: runUuid,
            uidvalidity,
            uid: email.uid,
            messageIdHeader: email.messageId,
            emailUid: email.uid?.toString(),
            subject: email.subject,
            fromAddress: email.from,
            receivedDate: email.date,
            status: 'error',
            skipReason: 'process_exception',
            attachmentsCount: email.attachments?.length || 0,
            errorMessage: emailErr.message
          });

          results.emailDetails.push(emailResult);
        }
      }

      const processTime = Date.now() - processStart;

      // Update check run with final counts
      this.updateCheckRun(runUuid, {
        processTimeMs: processTime,
        attachmentsTotal: totalAttachments,
        attachmentsSupported: supportedAttachments,
        emailsSkipped: results.skipped,
        emailsProcessed: results.processed,
        invoicesCreated: results.invoicesCreated,
        errorsCount: results.errors
      });

      // Update monitor stats
      if (results.invoicesCreated > 0) {
        database.prepare(`
          UPDATE email_monitors SET
            emails_processed_count = emails_processed_count + ?,
            invoices_created_count = invoices_created_count + ?,
            last_checked_at = datetime('now'),
            last_error = NULL
          WHERE id = ?
        `).run(results.processed, results.invoicesCreated, monitorId);
      } else {
        database.prepare(`
          UPDATE email_monitors SET
            last_checked_at = datetime('now'),
            last_error = NULL
          WHERE id = ?
        `).run(monitorId);
      }

      results.success = true;
      results.stage = 'complete';

      this.finishCheckRun(runUuid, results.errors > 0 ? 'partial' : 'success', {
        lastStage: 'complete'
      });

    } catch (err) {
      results.error = err.message;
      results.success = false;

      this.finishCheckRun(runUuid, 'error', {
        errorMessage: err.message,
        errorsCount: 1
      });

      // Update monitor with error
      database.prepare(`
        UPDATE email_monitors SET
          last_checked_at = datetime('now'),
          last_error = ?
        WHERE id = ?
      `).run(err.message, monitorId);

    } finally {
      // Close IMAP connection
      if (imap) {
        try {
          imap.end();
        } catch (e) {
          // Ignore close errors
        }
      }

      // Release lock
      this.releaseLock(monitorId, lockOwner);

      results.totalTimeMs = Date.now() - startTime;
    }

    return results;
  }

  /**
   * Fetch emails with metadata and attachments
   */
  async fetchEmails(imap, uids, uidvalidity) {
    if (!uids || uids.length === 0) return [];

    return new Promise((resolve, reject) => {
      const emails = [];

      const fetch = imap.fetch(uids, {
        bodies: '',
        struct: true
      });

      fetch.on('message', (msg, seqno) => {
        const email = { seqno, uid: null, attachments: [] };

        msg.on('body', (stream, info) => {
          let buffer = '';
          stream.on('data', chunk => buffer += chunk.toString('utf8'));
          stream.on('end', async () => {
            try {
              const parsed = await simpleParser(buffer);
              email.subject = parsed.subject || '';
              email.from = parsed.from?.text || '';
              email.date = parsed.date;
              email.messageId = parsed.messageId;
              email.attachments = parsed.attachments || [];
            } catch (parseErr) {
              email.parseError = parseErr.message;
            }
          });
        });

        msg.once('attributes', (attrs) => {
          email.uid = attrs.uid;
          email.flags = attrs.flags;
        });

        msg.once('end', () => {
          emails.push(email);
        });
      });

      fetch.once('error', reject);
      fetch.once('end', () => {
        // Wait a bit for parsing to complete
        setTimeout(() => resolve(emails), 100);
      });
    });
  }

  /**
   * Process email attachments (invoke invoice processor)
   */
  async processEmailAttachments(email, attachments, monitor, runUuid, uidvalidity) {
    // This will be implemented to call the universal invoice processor
    // For now, return a placeholder that shows the pipeline is working

    try {
      const database = db.getDatabase();

      // Get user from monitor
      const user = database.prepare('SELECT * FROM users WHERE id = ?').get(monitor.user_id || monitor.created_by_user_id);
      if (!user) {
        return { success: false, error: 'Monitor user not found' };
      }

      let invoicesCreated = 0;
      const invoiceIds = [];

      for (const attachment of attachments) {
        try {
          // Create ingestion run
          const runId = `email-${monitor.id}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

          database.prepare(`
            INSERT INTO ingestion_runs (run_id, user_id, account_name, vendor_name, file_name, file_size, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'processing', datetime('now'))
          `).run(
            runId,
            user.id,
            monitor.account_name || monitor.name || 'Email Import',
            email.from?.split('@')[1]?.split('>')[0] || 'Unknown Vendor',
            attachment.filename || 'attachment.pdf',
            attachment.size || 0
          );

          // Try to process with universal invoice processor
          let processed = false;
          try {
            const universalProcessor = require('./universal-invoice-processor');

            // Convert attachment content to base64 for processor
            const contentBase64 = attachment.content.toString('base64');

            const result = await universalProcessor.processInvoice(
              {
                base64: contentBase64,
                filename: attachment.filename,
                mimeType: attachment.contentType
              },
              { source: 'email_autopilot' }
            );

            if (result.ok && result.items && result.items.length > 0) {
              // Store invoice items
              for (const item of result.items) {
                database.prepare(`
                  INSERT INTO invoice_items (run_id, description, quantity, unit_price_cents, total_cents, category, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                `).run(
                  runId,
                  item.description || 'Item',
                  item.quantity || 1,
                  item.unitPriceCents || 0,
                  item.totalCents || 0,
                  item.category || 'general'
                );
              }
              processed = true;
            }
          } catch (procErr) {
            console.error('[EMAIL-CHECK] Invoice processor error:', procErr.message);
          }

          // Update run status
          database.prepare(`
            UPDATE ingestion_runs SET status = ?, completed_at = datetime('now') WHERE run_id = ?
          `).run(processed ? 'completed' : 'failed', runId);

          if (processed) {
            invoicesCreated++;
            invoiceIds.push(runId);
          }

        } catch (attErr) {
          console.error('[EMAIL-CHECK] Attachment processing error:', attErr.message);
        }
      }

      return {
        success: true,
        invoicesCreated,
        invoiceIds
      };

    } catch (err) {
      return {
        success: false,
        error: err.message,
        invoicesCreated: 0
      };
    }
  }

  /**
   * Run diagnostic check (read-only, returns detailed info)
   */
  async diagnose(monitorId, options = {}) {
    const database = db.getDatabase();
    const startTime = Date.now();

    // Get monitor
    const monitor = database.prepare(`SELECT * FROM email_monitors WHERE id = ?`).get(monitorId);
    if (!monitor) {
      throw new Error(`Monitor ${monitorId} not found`);
    }

    const diagnostic = {
      runUuid: crypto.randomUUID(),
      monitorId,
      timestamp: new Date().toISOString(),

      monitor: {
        id: monitor.id,
        email: monitor.email_address,
        name: monitor.name,
        provider: monitor.oauth_provider,
        folderName: monitor.folder_name || 'INBOX',
        isActive: !!monitor.is_active,
        checkFrequencyMinutes: monitor.check_frequency_minutes,
        requireKeywords: monitor.require_invoice_keywords !== 0,
        lastChecked: monitor.last_checked_at,
        lastError: monitor.last_error,
        emailsProcessed: monitor.emails_processed_count,
        invoicesCreated: monitor.invoices_created_count
      },

      oauth: {
        provider: monitor.oauth_provider,
        hasAccessToken: !!monitor.oauth_access_token,
        hasRefreshToken: !!monitor.oauth_refresh_token,
        tokenExpiresAt: monitor.oauth_token_expires_at,
        tokenValid: false,
        tokenExpiresIn: null
      },

      connection: {
        success: false,
        steps: [],
        timings: {}
      },

      mailbox: {
        name: null,
        uidvalidity: null,
        totalMessages: null,
        newMessages: null
      },

      search: {
        criteria: null,
        found: 0,
        sinceDate: null
      },

      emails: [],

      recentCheckRuns: [],
      recentProcessingLogs: []
    };

    // Check OAuth token validity
    if (monitor.oauth_token_expires_at) {
      const expiresAt = new Date(monitor.oauth_token_expires_at);
      const now = new Date();
      diagnostic.oauth.tokenValid = expiresAt > now;
      diagnostic.oauth.tokenExpiresIn = Math.round((expiresAt - now) / 1000 / 60) + ' minutes';
    }

    // Get recent check runs
    diagnostic.recentCheckRuns = database.prepare(`
      SELECT run_uuid, triggered_by, started_at, finished_at, status,
             found_messages, fetched_messages, emails_processed, invoices_created,
             errors_count, error_message, last_stage
      FROM email_check_runs
      WHERE monitor_id = ?
      ORDER BY started_at DESC
      LIMIT 10
    `).all(monitorId);

    // Get recent processing logs
    diagnostic.recentProcessingLogs = database.prepare(`
      SELECT check_run_uuid, uid, email_subject, from_address, status, skip_reason,
             attachments_count, attachments_supported, invoices_created, error_message, processed_at
      FROM email_processing_log
      WHERE monitor_id = ?
      ORDER BY processed_at DESC
      LIMIT 20
    `).all(monitorId);

    let imap = null;

    try {
      // Build config
      const configStart = Date.now();
      const imapConfig = await this.buildIMAPConfig(monitor);
      diagnostic.connection.steps.push({ step: 'build_config', success: true, authMethod: imapConfig.authMethod });
      diagnostic.connection.timings.config = Date.now() - configStart;

      // Connect
      const connectStart = Date.now();
      imap = new Imap(imapConfig);

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout (30s)'));
        }, 30000);

        imap.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        imap.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        imap.connect();
      });

      diagnostic.connection.steps.push({ step: 'connect', success: true });
      diagnostic.connection.timings.connect = Date.now() - connectStart;

      // Open folder
      const folderStart = Date.now();
      const folderName = options.folder || monitor.folder_name || 'INBOX';

      const box = await new Promise((resolve, reject) => {
        imap.openBox(folderName, true, (err, box) => {
          if (err) reject(err);
          else resolve(box);
        });
      });

      diagnostic.connection.steps.push({ step: 'open_folder', success: true, folder: folderName });
      diagnostic.connection.timings.openFolder = Date.now() - folderStart;

      diagnostic.mailbox = {
        name: folderName,
        uidvalidity: box.uidvalidity,
        totalMessages: box.messages.total,
        newMessages: box.messages.new
      };

      // Search
      const searchStart = Date.now();
      const sinceDays = options.sinceDays || 7;
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - sinceDays);

      diagnostic.search.criteria = `SINCE ${sinceDate.toISOString().split('T')[0]}`;
      diagnostic.search.sinceDate = sinceDate.toISOString();

      const uids = await new Promise((resolve, reject) => {
        imap.search([['SINCE', sinceDate]], (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        });
      });

      diagnostic.search.found = uids.length;
      diagnostic.connection.steps.push({ step: 'search', success: true, found: uids.length });
      diagnostic.connection.timings.search = Date.now() - searchStart;

      // Fetch headers for recent emails
      if (uids.length > 0) {
        const fetchStart = Date.now();
        const limit = options.limit || 20;
        const toFetch = uids.slice(-limit);

        const emails = await new Promise((resolve, reject) => {
          const results = [];

          const fetch = imap.fetch(toFetch, {
            bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)',
            struct: true
          });

          fetch.on('message', (msg, seqno) => {
            const email = { seqno };

            msg.on('body', (stream, info) => {
              let buffer = '';
              stream.on('data', chunk => buffer += chunk.toString('utf8'));
              stream.on('end', () => {
                // Parse headers
                const headers = {};
                buffer.split(/\r?\n/).forEach(line => {
                  const match = line.match(/^([^:]+):\s*(.*)$/);
                  if (match) {
                    headers[match[1].toLowerCase()] = match[2];
                  }
                });
                email.subject = headers.subject || 'No Subject';
                email.from = headers.from || 'Unknown';
                email.date = headers.date;
                email.messageId = headers['message-id'];
              });
            });

            msg.once('attributes', (attrs) => {
              email.uid = attrs.uid;
              email.flags = attrs.flags;

              // Parse structure for attachments
              if (attrs.struct) {
                email.attachments = this.parseStructureForAttachments(attrs.struct);
              }
            });

            msg.once('end', () => {
              results.push(email);
            });
          });

          fetch.once('error', reject);
          fetch.once('end', () => {
            setTimeout(() => resolve(results), 50);
          });
        });

        diagnostic.connection.timings.fetchHeaders = Date.now() - fetchStart;

        // Analyze each email
        for (const email of emails) {
          const analysis = {
            uid: email.uid,
            subject: email.subject,
            from: email.from,
            date: email.date,
            messageId: email.messageId,
            flags: email.flags,
            attachments: email.attachments || [],
            hasAttachments: (email.attachments?.length || 0) > 0,
            supportedAttachments: [],
            wouldSkip: false,
            skipReasons: []
          };

          // Check supported attachments
          for (const att of (email.attachments || [])) {
            const support = this.isSupportedAttachment(att);
            if (support.supported) {
              analysis.supportedAttachments.push({
                filename: att.filename,
                contentType: att.contentType,
                size: att.size,
                supportReason: support.reason
              });
            }
          }

          // Check if would be skipped
          const dupeCheck = this.isEmailProcessed(
            monitorId,
            box.uidvalidity,
            email.uid,
            email.messageId
          );

          if (dupeCheck.isDuplicate && !options.ignoreDedupe) {
            analysis.wouldSkip = true;
            analysis.skipReasons.push(`already_processed (${dupeCheck.reason})`);
          }

          if (analysis.attachments.length === 0) {
            analysis.wouldSkip = true;
            analysis.skipReasons.push('no_attachments');
          } else if (analysis.supportedAttachments.length === 0) {
            analysis.wouldSkip = true;
            analysis.skipReasons.push('unsupported_attachment_types');
          }

          if (!options.ignoreKeywords && monitor.require_invoice_keywords !== 0) {
            const criteria = this.matchesInvoiceCriteria(email, monitor);
            if (!criteria.matches) {
              analysis.wouldSkip = true;
              analysis.skipReasons.push('keyword_filter_miss');
            }
            analysis.keywordMatch = criteria;
          }

          diagnostic.emails.push(analysis);
        }
      }

      diagnostic.connection.success = true;

    } catch (err) {
      diagnostic.connection.success = false;
      diagnostic.connection.steps.push({
        step: diagnostic.connection.steps.length > 0 ? 'failed_at_step' : 'connect',
        success: false,
        error: err.message
      });
      diagnostic.error = err.message;

    } finally {
      if (imap) {
        try {
          imap.end();
        } catch (e) {
          // Ignore
        }
      }
    }

    diagnostic.totalTimeMs = Date.now() - startTime;

    return diagnostic;
  }

  /**
   * Parse IMAP structure for attachment info
   */
  parseStructureForAttachments(struct, attachments = []) {
    if (!struct) return attachments;

    if (Array.isArray(struct)) {
      for (const part of struct) {
        this.parseStructureForAttachments(part, attachments);
      }
    } else if (typeof struct === 'object') {
      // Check if this is an attachment
      const disposition = struct.disposition;
      const type = struct.type;
      const subtype = struct.subtype;

      if (disposition && (disposition.type === 'attachment' || disposition.type === 'inline')) {
        const att = {
          contentType: `${type}/${subtype}`.toLowerCase(),
          filename: disposition.params?.filename || struct.params?.name || 'unnamed',
          size: struct.size || 0
        };
        attachments.push(att);
      } else if (type && subtype) {
        // Check for common attachment types
        const mime = `${type}/${subtype}`.toLowerCase();
        if (mime.includes('pdf') || mime.includes('image') || mime === 'application/octet-stream') {
          const filename = struct.params?.name || disposition?.params?.filename;
          if (filename) {
            attachments.push({
              contentType: mime,
              filename,
              size: struct.size || 0
            });
          }
        }
      }
    }

    return attachments;
  }

  /**
   * Get check runs for a monitor
   */
  getCheckRuns(monitorId, limit = 20) {
    const database = db.getDatabase();
    return database.prepare(`
      SELECT * FROM email_check_runs
      WHERE monitor_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `).all(monitorId, limit);
  }

  /**
   * Get processing logs for a check run
   */
  getProcessingLogs(checkRunUuid, limit = 100) {
    const database = db.getDatabase();
    return database.prepare(`
      SELECT * FROM email_processing_log
      WHERE check_run_uuid = ?
      ORDER BY processed_at DESC
      LIMIT ?
    `).all(checkRunUuid, limit);
  }

  /**
   * Get processing logs for a monitor
   */
  getMonitorProcessingLogs(monitorId, limit = 100) {
    const database = db.getDatabase();
    return database.prepare(`
      SELECT * FROM email_processing_log
      WHERE monitor_id = ?
      ORDER BY processed_at DESC
      LIMIT ?
    `).all(monitorId, limit);
  }
}

// Export singleton
module.exports = new EmailCheckService();
