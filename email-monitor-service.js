// =====================================================
// EMAIL INVOICE AUTOPILOT SERVICE
// =====================================================
// Monitors email inboxes for invoice attachments
// Automatically processes and analyzes invoices
// Detects cost savings opportunities
// =====================================================

const Imap = require('imap');
const { simpleParser } = require('mailparser');
const db = require('./database');
const fetch = require('node-fetch');
const ErrorHandler = require('./error-handler');

class EmailMonitorService {
  constructor() {
    this.activeConnections = new Map(); // monitorId -> IMAP connection
    this.checkIntervals = new Map();     // monitorId -> interval ID
    this.isRunning = false;
  }

  /**
   * Start monitoring all active email accounts
   */
  async startAll() {
    if (this.isRunning) {
      console.log('[EMAIL SERVICE] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[EMAIL SERVICE] Starting email autopilot system...');

    try {
      const monitors = db.getActiveEmailMonitors();
      console.log(`[EMAIL SERVICE] Found ${monitors.length} active monitors`);

      for (const monitor of monitors) {
        await this.startMonitor(monitor.id);
      }

      console.log('[EMAIL SERVICE] ✓ All monitors started successfully');
    } catch (error) {
      console.error('[EMAIL SERVICE] Error starting monitors:', error);
    }
  }

  /**
   * Start monitoring a specific email account
   * @param {number} monitorId
   */
  async startMonitor(monitorId) {
    try {
      const monitor = db.getEmailMonitorById(monitorId);
      if (!monitor) {
        console.error(`[EMAIL SERVICE] Monitor ${monitorId} not found`);
        return;
      }

      if (!monitor.is_active) {
        console.log(`[EMAIL SERVICE] Monitor ${monitorId} is disabled, skipping`);
        return;
      }

      // Create IMAP connection
      const imap = new Imap({
        user: monitor.username,
        password: monitor.password,
        host: monitor.imap_host,
        port: monitor.imap_port,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 30000,
        authTimeout: 10000
      });

      // Set up event handlers
      imap.once('ready', () => {
        console.log(`[EMAIL SERVICE] ✓ Connected to ${monitor.email_address}`);
        db.logEmailActivity(
          monitorId,
          'monitor_started',
          `Email monitoring started for ${monitor.email_address}`,
          'info'
        );

        // Initial check
        this.checkInbox(imap, monitor);
      });

      imap.once('error', async (err) => {
        console.error(`[EMAIL SERVICE] IMAP error for ${monitor.email_address}:`, err.message);

        // Log to error tracking system
        await ErrorHandler.logError(err, {
          endpoint: '/email-monitor',
          accountName: monitor.account_name,
          isUserFacing: false,
          emailAddress: monitor.email_address
        });

        db.logEmailActivity(
          monitorId,
          'error',
          `Connection error: ${err.message}`,
          'error'
        );

        // Try to reconnect after 5 minutes
        setTimeout(() => this.startMonitor(monitorId), 5 * 60 * 1000);
      });

      imap.once('end', () => {
        console.log(`[EMAIL SERVICE] Connection ended for ${monitor.email_address}`);
      });

      // Connect
      imap.connect();

      // Store connection
      this.activeConnections.set(monitorId, imap);

      // Set up periodic checking
      const intervalMs = (monitor.check_interval_minutes || 5) * 60 * 1000;
      const intervalId = setInterval(() => {
        console.log(`[EMAIL SERVICE] Periodic check for ${monitor.email_address}`);
        this.checkInbox(imap, monitor);
      }, intervalMs);

      this.checkIntervals.set(monitorId, intervalId);

      console.log(`[EMAIL SERVICE] Monitor ${monitorId} started (checking every ${monitor.check_interval_minutes} min)`);

    } catch (error) {
      console.error(`[EMAIL SERVICE] Error starting monitor ${monitorId}:`, error);

      // Log to error tracking system
      const monitor = db.getEmailMonitor(monitorId);
      await ErrorHandler.logError(error, {
        endpoint: '/email-monitor/start',
        accountName: monitor?.account_name,
        isUserFacing: false
      });

      db.logEmailActivity(
        monitorId,
        'error',
        `Failed to start monitor: ${error.message}`,
        'critical'
      );
    }
  }

  /**
   * Stop monitoring a specific email account
   * @param {number} monitorId
   */
  stopMonitor(monitorId) {
    const imap = this.activeConnections.get(monitorId);
    if (imap) {
      imap.end();
      this.activeConnections.delete(monitorId);
    }

    const intervalId = this.checkIntervals.get(monitorId);
    if (intervalId) {
      clearInterval(intervalId);
      this.checkIntervals.delete(monitorId);
    }

    console.log(`[EMAIL SERVICE] Monitor ${monitorId} stopped`);
  }

  /**
   * Check inbox for new invoice emails
   * @param {Imap} imap - IMAP connection
   * @param {Object} monitor - Monitor configuration
   */
  async checkInbox(imap, monitor) {
    if (!imap || imap.state !== 'authenticated') {
      console.log(`[EMAIL SERVICE] IMAP not ready for ${monitor.email_address}`);
      return;
    }

    try {
      imap.openBox('INBOX', false, async (err, box) => {
        if (err) {
          console.error(`[EMAIL SERVICE] Error opening inbox:`, err);
          db.updateEmailMonitorLastCheck(monitor.id, false);
          return;
        }

        // Calculate search date (check last 7 days to be safe)
        const searchSince = new Date();
        searchSince.setDate(searchSince.getDate() - 7);

        // Search criteria: Recent emails with attachments
        const searchCriteria = [
          ['SINCE', searchSince],
          'UNSEEN' // Only unread emails
        ];

        imap.search(searchCriteria, async (err, uids) => {
          if (err) {
            console.error(`[EMAIL SERVICE] Search error:`, err);
            db.updateEmailMonitorLastCheck(monitor.id, false);
            return;
          }

          if (!uids || uids.length === 0) {
            console.log(`[EMAIL SERVICE] No new emails for ${monitor.email_address}`);
            db.updateEmailMonitorLastCheck(monitor.id, true);
            return;
          }

          console.log(`[EMAIL SERVICE] Found ${uids.length} new emails for ${monitor.email_address}`);

          // Fetch emails
          const fetch = imap.fetch(uids, {
            bodies: '',
            struct: true,
            markSeen: false // Don't mark as read yet
          });

          fetch.on('message', (msg, seqno) => {
            let emailUid = null;

            msg.on('attributes', (attrs) => {
              emailUid = attrs.uid;
            });

            msg.on('body', (stream) => {
              simpleParser(stream, async (err, parsed) => {
                if (err) {
                  console.error('[EMAIL SERVICE] Parse error:', err);
                  return;
                }

                // Process this email
                await this.processEmail(monitor, parsed, emailUid || seqno, imap);
              });
            });
          });

          fetch.once('error', (err) => {
            console.error('[EMAIL SERVICE] Fetch error:', err);
          });

          fetch.once('end', () => {
            db.updateEmailMonitorLastCheck(monitor.id, true);
          });
        });
      });
    } catch (error) {
      console.error(`[EMAIL SERVICE] Inbox check error:`, error);
      db.updateEmailMonitorLastCheck(monitor.id, false);
    }
  }

  /**
   * Process a single email
   * @param {Object} monitor
   * @param {Object} parsed - Parsed email
   * @param {string} emailUid - Email UID
   * @param {Imap} imap - IMAP connection (to mark as read)
   */
  async processEmail(monitor, parsed, emailUid, imap) {
    try {
      const senderEmail = parsed.from?.text || parsed.from?.value?.[0]?.address || 'unknown';
      const subject = parsed.subject || '(no subject)';

      console.log(`[EMAIL SERVICE] Processing email from ${senderEmail}: ${subject}`);

      // Check if we should process this email
      if (monitor.sender_whitelist) {
        const whitelist = monitor.sender_whitelist.split(',').map(s => s.trim().toLowerCase());
        const senderLower = senderEmail.toLowerCase();
        if (!whitelist.some(w => senderLower.includes(w))) {
          console.log(`[EMAIL SERVICE] Skipping - sender not in whitelist`);
          return;
        }
      }

      // Check for attachments
      if (!parsed.attachments || parsed.attachments.length === 0) {
        console.log(`[EMAIL SERVICE] No attachments, skipping`);
        return;
      }

      // Add to queue
      const queueId = db.addEmailToQueue({
        monitorId: monitor.id,
        emailUid: String(emailUid),
        senderEmail: senderEmail,
        senderName: parsed.from?.text || null,
        subject: subject,
        receivedAt: parsed.date?.toISOString() || new Date().toISOString(),
        attachmentCount: parsed.attachments.length,
        attachmentFilenames: parsed.attachments.map(a => a.filename)
      });

      db.logEmailActivity(
        monitor.id,
        'email_received',
        `Email from ${senderEmail} with ${parsed.attachments.length} attachment(s)`,
        'info'
      );

      // Process attachments
      let processedCount = 0;
      let totalOpportunities = 0;
      let totalSavings = 0;

      for (const attachment of parsed.attachments) {
        const filename = attachment.filename.toLowerCase();

        // Check if this looks like an invoice
        const isInvoice = filename.includes('invoice') ||
                         filename.endsWith('.pdf') ||
                         filename.endsWith('.xlsx') ||
                         filename.endsWith('.xls');

        if (!isInvoice) {
          console.log(`[EMAIL SERVICE] Skipping ${filename} - doesn't look like an invoice`);
          continue;
        }

        console.log(`[EMAIL SERVICE] Processing attachment: ${filename}`);

        try {
          // Convert to base64
          const base64 = attachment.content.toString('base64');

          // Send to existing ingestion endpoint
          const response = await fetch('http://localhost:5050/ingest', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-email': `autopilot@${monitor.account_name.toLowerCase().replace(/\s+/g, '')}.com`,
              'x-source': 'email-autopilot',
              'x-monitor-id': String(monitor.id)
            },
            body: JSON.stringify({
              fileBase64: base64,
              fileName: attachment.filename,
              accountName: monitor.account_name
            })
          });

          const result = await response.json();

          if (result.ok) {
            processedCount++;
            const opps = result.revenueRadar?.rulesEngine?.opportunities_created || 0;
            totalOpportunities += opps;

            db.updateEmailQueueItem(queueId, {
              status: 'completed',
              ingestionRunId: result.revenueRadar?.ingestion?.run_id,
              opportunitiesDetected: opps
            });

            db.logEmailActivity(
              monitor.id,
              'invoice_processed',
              `Processed ${filename}: ${opps} opportunities detected`,
              opps > 0 ? 'warning' : 'info'
            );

            console.log(`[EMAIL SERVICE] ✓ Processed ${filename} - ${opps} opportunities`);

            // Track vendor
            if (result.revenueRadar?.canonical?.vendor_name) {
              db.trackVendor(monitor.id, result.revenueRadar.canonical.vendor_name, {
                vendorEmail: senderEmail,
                invoiceAmountCents: result.revenueRadar.canonical.total_amount_cents || 0
              });
            }

          } else {
            db.updateEmailQueueItem(queueId, {
              status: 'failed',
              errorMessage: result.error || 'Unknown error'
            });

            console.log(`[EMAIL SERVICE] Failed to process ${filename}: ${result.error}`);
          }

        } catch (error) {
          console.error(`[EMAIL SERVICE] Error processing ${filename}:`, error);
          db.updateEmailQueueItem(queueId, {
            status: 'failed',
            errorMessage: error.message
          });
        }
      }

      // Update monitor stats
      db.updateEmailMonitorStats(monitor.id, {
        emailsProcessed: 1,
        invoicesFound: processedCount,
        opportunitiesDetected: totalOpportunities,
        savingsCents: totalSavings
      });

      // Mark email as read if we processed it
      if (processedCount > 0 && imap) {
        try {
          imap.addFlags(emailUid, '\\Seen', (err) => {
            if (err) console.error('[EMAIL SERVICE] Error marking as read:', err);
          });
        } catch (error) {
          console.error('[EMAIL SERVICE] Error in addFlags:', error);
        }
      }

    } catch (error) {
      console.error('[EMAIL SERVICE] Error in processEmail:', error);
    }
  }

  /**
   * Stop all monitors
   */
  stopAll() {
    console.log('[EMAIL SERVICE] Stopping all monitors...');

    for (const monitorId of this.activeConnections.keys()) {
      this.stopMonitor(monitorId);
    }

    this.isRunning = false;
    console.log('[EMAIL SERVICE] All monitors stopped');
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeMonitors: this.activeConnections.size,
      monitorIds: Array.from(this.activeConnections.keys())
    };
  }
}

// Export singleton instance
module.exports = new EmailMonitorService();
