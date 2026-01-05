// =====================================================
// EMAIL INVOICE AUTOPILOT - IMAP SERVICE
// Monitors email accounts for invoice attachments
// =====================================================

const Imap = require('imap');
const { simpleParser } = require('mailparser');
const crypto = require('crypto-js');
const db = require('./database');
const fs = require('fs').promises;
const path = require('path');

// Encryption key for storing email passwords (use environment variable in production)
const ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY || 'revenue-radar-email-key-2026';

class EmailIMAPService {
  constructor() {
    this.activeMonitors = new Map(); // monitorId -> interval
    this.processingLocks = new Set(); // Prevent duplicate processing
  }

  /**
   * Start monitoring all active email monitors
   */
  async startAll() {
    console.log('[EMAIL IMAP] Starting all active monitors...');

    try {
      const monitors = db.getActiveEmailMonitors();
      console.log(`[EMAIL IMAP] Found ${monitors.length} active monitor(s)`);

      for (const monitor of monitors) {
        this.startMonitor(monitor.id);
      }

      console.log(`[EMAIL IMAP] ✓ ${monitors.length} monitor(s) started`);
    } catch (error) {
      console.error('[EMAIL IMAP] Error starting monitors:', error.message);
    }
  }

  /**
   * Start monitoring a specific email account
   * @param {number} monitorId - ID of the email monitor
   */
  startMonitor(monitorId) {
    // Stop existing monitor if running
    this.stopMonitor(monitorId);

    const monitor = db.getEmailMonitor(monitorId);
    if (!monitor || !monitor.is_active) {
      console.log(`[EMAIL IMAP] Monitor ${monitorId} not active or not found`);
      return;
    }

    console.log(`[EMAIL IMAP] Starting monitor ${monitorId}: ${monitor.email_address}`);

    // Check emails immediately
    this.checkEmails(monitorId);

    // Set up recurring check based on frequency
    const intervalMs = monitor.check_frequency_minutes * 60 * 1000;
    const interval = setInterval(() => {
      this.checkEmails(monitorId);
    }, intervalMs);

    this.activeMonitors.set(monitorId, interval);
    console.log(`[EMAIL IMAP] ✓ Monitor ${monitorId} checking every ${monitor.check_frequency_minutes} minutes`);
  }

  /**
   * Stop monitoring an email account
   * @param {number} monitorId - ID of the email monitor
   */
  stopMonitor(monitorId) {
    const interval = this.activeMonitors.get(monitorId);
    if (interval) {
      clearInterval(interval);
      this.activeMonitors.delete(monitorId);
      console.log(`[EMAIL IMAP] ✗ Monitor ${monitorId} stopped`);
    }
  }

  /**
   * Stop all monitors
   */
  stopAll() {
    console.log('[EMAIL IMAP] Stopping all monitors...');
    for (const [monitorId, interval] of this.activeMonitors.entries()) {
      clearInterval(interval);
    }
    this.activeMonitors.clear();
    console.log('[EMAIL IMAP] ✓ All monitors stopped');
  }

  /**
   * Check emails for a specific monitor
   * @param {number} monitorId - ID of the email monitor
   */
  async checkEmails(monitorId) {
    // Prevent duplicate processing
    const lockKey = `monitor-${monitorId}`;
    if (this.processingLocks.has(lockKey)) {
      console.log(`[EMAIL IMAP] Monitor ${monitorId} already processing, skipping...`);
      return;
    }

    this.processingLocks.add(lockKey);

    try {
      const monitor = db.getEmailMonitor(monitorId);
      if (!monitor || !monitor.is_active) {
        this.processingLocks.delete(lockKey);
        return;
      }

      console.log(`[EMAIL IMAP] Checking emails for monitor ${monitorId}: ${monitor.email_address}`);

      const imap = new Imap({
        user: monitor.imap_user,
        password: this.decryptPassword(monitor.imap_password_encrypted),
        host: monitor.imap_host,
        port: monitor.imap_port,
        tls: monitor.imap_secure === 1,
        tlsOptions: { rejectUnauthorized: false }
      });

      await this.processIMAPConnection(imap, monitor);

      // Update last checked timestamp
      db.updateEmailMonitorLastChecked(monitorId, new Date().toISOString());

    } catch (error) {
      console.error(`[EMAIL IMAP] Error checking monitor ${monitorId}:`, error.message);
      db.updateEmailMonitorError(monitorId, error.message);
    } finally {
      this.processingLocks.delete(lockKey);
    }
  }

  /**
   * Process IMAP connection and fetch emails
   * @param {Imap} imap - IMAP connection object
   * @param {Object} monitor - Email monitor configuration
   */
  async processIMAPConnection(imap, monitor) {
    return new Promise((resolve, reject) => {
      imap.once('ready', () => {
        imap.openBox(monitor.folder_name || 'INBOX', false, (err, box) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          // Search for unread emails with attachments
          const searchCriteria = this.buildSearchCriteria(monitor);

          imap.search(searchCriteria, (err, results) => {
            if (err) {
              imap.end();
              return reject(err);
            }

            if (results.length === 0) {
              console.log(`[EMAIL IMAP] No new emails found for monitor ${monitor.id}`);
              imap.end();
              return resolve();
            }

            console.log(`[EMAIL IMAP] Found ${results.length} email(s) to process for monitor ${monitor.id}`);

            const fetch = imap.fetch(results, {
              bodies: '',
              markSeen: false  // Don't mark as read yet
            });

            const emailPromises = [];

            fetch.on('message', (msg, seqno) => {
              emailPromises.push(this.processEmail(msg, seqno, monitor));
            });

            fetch.once('error', (err) => {
              console.error('[EMAIL IMAP] Fetch error:', err);
              reject(err);
            });

            fetch.once('end', async () => {
              try {
                await Promise.all(emailPromises);
                console.log(`[EMAIL IMAP] ✓ Processed ${emailPromises.length} email(s) for monitor ${monitor.id}`);
                imap.end();
                resolve();
              } catch (error) {
                console.error('[EMAIL IMAP] Error processing emails:', error);
                imap.end();
                reject(error);
              }
            });
          });
        });
      });

      imap.once('error', (err) => {
        console.error('[EMAIL IMAP] IMAP connection error:', err);
        reject(err);
      });

      imap.once('end', () => {
        console.log('[EMAIL IMAP] Connection ended');
      });

      imap.connect();
    });
  }

  /**
   * Process individual email message
   * @param {Object} msg - IMAP message object
   * @param {number} seqno - Sequence number
   * @param {Object} monitor - Email monitor configuration
   */
  async processEmail(msg, seqno, monitor) {
    return new Promise((resolve, reject) => {
      let buffer = '';
      let uid = null;

      msg.on('body', (stream, info) => {
        stream.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
        });
      });

      msg.once('attributes', (attrs) => {
        uid = attrs.uid;
      });

      msg.once('end', async () => {
        try {
          const parsed = await simpleParser(buffer);

          // Extract email metadata
          const emailData = {
            uid: uid.toString(),
            subject: parsed.subject || '',
            from: parsed.from?.text || '',
            receivedDate: parsed.date || new Date(),
            attachments: parsed.attachments || []
          };

          console.log(`[EMAIL IMAP] Processing email: "${emailData.subject}" from ${emailData.from}`);

          // Check if this email was already processed
          if (db.isEmailAlreadyProcessed(monitor.id, emailData.uid)) {
            console.log(`[EMAIL IMAP] Email UID ${emailData.uid} already processed, skipping`);
            return resolve();
          }

          // Filter for invoice-related emails
          if (!this.isInvoiceEmail(emailData, monitor)) {
            console.log(`[EMAIL IMAP] Email doesn't match invoice criteria, skipping`);
            return resolve();
          }

          // Process invoice attachments
          const startTime = Date.now();
          const result = await this.processInvoiceAttachments(emailData, monitor);
          const processingTime = Date.now() - startTime;

          // Log processing result
          db.logEmailProcessing({
            monitorId: monitor.id,
            emailUid: emailData.uid,
            subject: emailData.subject,
            fromAddress: emailData.from,
            receivedDate: emailData.receivedDate,
            status: result.success ? 'success' : 'failed',
            attachmentsCount: emailData.attachments.length,
            invoicesCreated: result.invoicesCreated || 0,
            invoiceIds: result.invoiceIds ? JSON.stringify(result.invoiceIds) : null,
            processingTimeMs: processingTime,
            errorMessage: result.error || null
          });

          // Update monitor stats
          if (result.success) {
            db.incrementEmailMonitorStats(monitor.id, result.invoicesCreated || 0);
          }

          console.log(`[EMAIL IMAP] ✓ Email processed in ${processingTime}ms: ${result.invoicesCreated || 0} invoice(s) created`);

          resolve();
        } catch (error) {
          console.error('[EMAIL IMAP] Error parsing email:', error);
          reject(error);
        }
      });
    });
  }

  /**
   * Build IMAP search criteria based on monitor configuration
   * @param {Object} monitor - Email monitor configuration
   * @returns {Array} IMAP search criteria
   */
  buildSearchCriteria(monitor) {
    const criteria = ['UNSEEN']; // Only unread emails

    // Parse custom search criteria if provided
    if (monitor.search_criteria) {
      try {
        const customCriteria = JSON.parse(monitor.search_criteria);

        if (customCriteria.subject_contains) {
          criteria.push(['SUBJECT', customCriteria.subject_contains]);
        }

        if (customCriteria.from_contains) {
          criteria.push(['FROM', customCriteria.from_contains]);
        }

        if (customCriteria.since_days) {
          const sinceDate = new Date();
          sinceDate.setDate(sinceDate.getDate() - customCriteria.since_days);
          criteria.push(['SINCE', sinceDate]);
        }
      } catch (error) {
        console.error('[EMAIL IMAP] Error parsing search criteria:', error);
      }
    }

    return criteria;
  }

  /**
   * Check if email matches invoice criteria
   * @param {Object} emailData - Parsed email data
   * @param {Object} monitor - Email monitor configuration
   * @returns {boolean} True if email is invoice-related
   */
  isInvoiceEmail(emailData, monitor) {
    // Check if email has attachments
    if (emailData.attachments.length === 0) {
      return false;
    }

    // Check for PDF attachments (invoices are usually PDFs)
    const hasPDFAttachment = emailData.attachments.some(att =>
      att.contentType === 'application/pdf' || att.filename?.toLowerCase().endsWith('.pdf')
    );

    if (!hasPDFAttachment) {
      return false;
    }

    // Check subject for invoice keywords
    const subject = (emailData.subject || '').toLowerCase();
    const invoiceKeywords = ['invoice', 'bill', 'statement', 'receipt', 'order'];
    const hasInvoiceKeyword = invoiceKeywords.some(keyword => subject.includes(keyword));

    return hasInvoiceKeyword;
  }

  /**
   * Process invoice PDF attachments
   * @param {Object} emailData - Parsed email data
   * @param {Object} monitor - Email monitor configuration
   * @returns {Promise<Object>} Processing result
   */
  async processInvoiceAttachments(emailData, monitor) {
    const invoiceIds = [];
    let invoicesCreated = 0;

    try {
      for (const attachment of emailData.attachments) {
        if (attachment.contentType === 'application/pdf' || attachment.filename?.toLowerCase().endsWith('.pdf')) {
          console.log(`[EMAIL IMAP] Processing PDF attachment: ${attachment.filename}`);

          // Save PDF temporarily
          const tempDir = path.join(__dirname, 'temp-invoices');
          await fs.mkdir(tempDir, { recursive: true });

          const tempFilePath = path.join(tempDir, `${Date.now()}-${attachment.filename}`);
          await fs.writeFile(tempFilePath, attachment.content);

          // TODO: Integrate with existing invoice ingestion system
          // For now, we'll just log that we found an invoice
          console.log(`[EMAIL IMAP] ✓ Invoice PDF saved: ${tempFilePath}`);

          // Here you would call your existing invoice processing logic
          // const invoiceId = await processInvoicePDF(tempFilePath, monitor.user_id);
          // invoiceIds.push(invoiceId);
          // invoicesCreated++;

          // Clean up temp file
          await fs.unlink(tempFilePath).catch(() => {});
        }
      }

      return {
        success: true,
        invoicesCreated,
        invoiceIds
      };
    } catch (error) {
      console.error('[EMAIL IMAP] Error processing attachments:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Encrypt email password for storage
   * @param {string} password - Plain text password
   * @returns {string} Encrypted password
   */
  encryptPassword(password) {
    return crypto.AES.encrypt(password, ENCRYPTION_KEY).toString();
  }

  /**
   * Decrypt email password from storage
   * @param {string} encrypted - Encrypted password
   * @returns {string} Plain text password
   */
  decryptPassword(encrypted) {
    const bytes = crypto.AES.decrypt(encrypted, ENCRYPTION_KEY);
    return bytes.toString(crypto.enc.Utf8);
  }

  /**
   * Check if a monitor is currently active
   * @param {number} monitorId - Monitor ID
   * @returns {boolean} True if monitor is actively checking emails
   */
  isMonitorActive(monitorId) {
    return this.activeMonitors.has(monitorId);
  }

  /**
   * Get status of all active monitors
   * @returns {Object} Status object
   */
  getStatus() {
    const monitors = db.getActiveEmailMonitors();
    return {
      isRunning: this.activeMonitors.size > 0,
      activeMonitors: this.activeMonitors.size,
      totalMonitors: monitors.length,
      monitors: monitors.map(m => ({
        id: m.id,
        email: m.email_address,
        lastChecked: m.last_checked_at,
        emailsProcessed: m.emails_processed_count,
        invoicesCreated: m.invoices_created_count
      }))
    };
  }
}

// Export singleton instance
module.exports = new EmailIMAPService();
