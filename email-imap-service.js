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
   * Integrates with the /ingest endpoint for full invoice processing
   * @param {Object} emailData - Parsed email data
   * @param {Object} monitor - Email monitor configuration
   * @returns {Promise<Object>} Processing result
   */
  async processInvoiceAttachments(emailData, monitor) {
    const invoiceIds = [];
    let invoicesCreated = 0;
    const pdfParse = require('pdf-parse');

    try {
      for (const attachment of emailData.attachments) {
        if (attachment.contentType === 'application/pdf' || attachment.filename?.toLowerCase().endsWith('.pdf')) {
          console.log(`[EMAIL IMAP] Processing PDF attachment: ${attachment.filename}`);

          try {
            // Parse PDF content
            const pdfData = await pdfParse(attachment.content);
            const pdfText = pdfData.text;

            console.log(`[EMAIL IMAP] Extracted ${pdfText.length} characters from PDF`);

            // Extract vendor/account info from email
            const senderDomain = emailData.from?.value?.[0]?.address?.split('@')[1] || '';
            const vendorName = this.extractVendorName(senderDomain, emailData.subject, pdfText);
            const accountName = monitor.account_name;

            // Build invoice payload for /ingest
            const invoicePayload = {
              rawText: pdfText,
              vendorName: vendorName,
              accountName: accountName,
              fileName: attachment.filename,
              source: 'email_autopilot',
              monitorId: monitor.id,
              emailSubject: emailData.subject,
              emailFrom: emailData.from?.value?.[0]?.address,
              emailDate: emailData.date?.toISOString()
            };

            // Call internal ingest function (no HTTP needed)
            const result = await this.ingestInvoice(invoicePayload, monitor);

            if (result.success) {
              invoiceIds.push(result.runId);
              invoicesCreated++;

              // Log activity
              db.logEmailActivity(
                monitor.id,
                'invoice_processed',
                `Processed invoice from ${vendorName}: ${attachment.filename}`,
                'info',
                {
                  runId: result.runId,
                  opportunities: result.opportunitiesDetected || 0,
                  fileName: attachment.filename
                }
              );

              // Update monitor stats
              db.updateEmailMonitorStats(monitor.id, {
                totalInvoicesFound: 1,
                totalOpportunitiesDetected: result.opportunitiesDetected || 0,
                totalSavingsDetectedCents: result.savingsDetectedCents || 0
              });

              console.log(`[EMAIL IMAP] ✓ Invoice processed successfully: ${result.runId}`);
            } else {
              console.error(`[EMAIL IMAP] Invoice processing failed: ${result.error}`);
              db.logEmailActivity(
                monitor.id,
                'error',
                `Failed to process invoice ${attachment.filename}: ${result.error}`,
                'error',
                { fileName: attachment.filename, error: result.error }
              );
            }
          } catch (pdfError) {
            console.error(`[EMAIL IMAP] PDF parsing error for ${attachment.filename}:`, pdfError.message);
            db.logEmailActivity(
              monitor.id,
              'error',
              `Failed to parse PDF ${attachment.filename}: ${pdfError.message}`,
              'warning',
              { fileName: attachment.filename, error: pdfError.message }
            );
          }
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
   * Extract vendor name from email metadata
   * @param {string} domain - Sender email domain
   * @param {string} subject - Email subject
   * @param {string} pdfText - PDF content
   * @returns {string} Vendor name
   */
  extractVendorName(domain, subject, pdfText) {
    // Try to extract from domain first
    if (domain) {
      const domainParts = domain.split('.');
      if (domainParts.length >= 2) {
        const name = domainParts[domainParts.length - 2];
        if (name && name.length > 2 && !['mail', 'email', 'smtp', 'noreply'].includes(name.toLowerCase())) {
          return name.charAt(0).toUpperCase() + name.slice(1);
        }
      }
    }

    // Try to extract from subject
    const subjectMatch = subject?.match(/invoice\s+from\s+([^\s]+)/i);
    if (subjectMatch) {
      return subjectMatch[1];
    }

    // Try to extract from PDF content (first capitalized word after "from" or company name patterns)
    const pdfMatch = pdfText?.match(/(?:from|vendor|supplier|billed by)[:\s]+([A-Z][a-zA-Z\s&]+)/i);
    if (pdfMatch) {
      return pdfMatch[1].trim().slice(0, 50);
    }

    return 'Unknown Vendor';
  }

  /**
   * Internal invoice ingestion - calls the same logic as /ingest endpoint
   * Uses the UNIFIED INVOICE PARSER for consistent extraction across all entry points
   * @param {Object} payload - Invoice data
   * @param {Object} monitor - Email monitor
   * @returns {Promise<Object>} Ingestion result
   */
  async ingestInvoice(payload, monitor) {
    try {
      const runId = `email-${monitor.id}-${Date.now()}`;

      // Get user from monitor
      const user = db.getDatabase().prepare('SELECT * FROM users WHERE id = ?').get(monitor.created_by_user_id);

      if (!user) {
        return { success: false, error: 'Monitor user not found' };
      }

      // Store ingestion run
      db.getDatabase().prepare(`
        INSERT INTO ingestion_runs (run_id, user_id, account_name, vendor_name, file_name, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'processing', CURRENT_TIMESTAMP)
      `).run(runId, user.id, payload.accountName, payload.vendorName, payload.fileName);

      // ===== USE UNIFIED INVOICE PARSER =====
      // This ensures consistent extraction across upload, email, and browser extension
      const invoiceParser = require('./invoice-parser');
      const parsedInvoice = invoiceParser.parseInvoice(payload.rawText);

      console.log(`[EMAIL IMAP] Unified parser: ${parsedInvoice.items.length} items, confidence: ${(parsedInvoice.confidence.overall * 100).toFixed(1)}%`);

      // Use parsed items, fall back to legacy extraction if parser finds nothing
      const items = parsedInvoice.items.length > 0
        ? parsedInvoice.items.map(item => ({
            description: item.description,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            totalCents: item.totalCents,
            category: item.category,
            sku: item.sku,
            confidence: item.confidence
          }))
        : this.extractInvoiceItems(payload.rawText); // Legacy fallback

      // Store invoice items
      let itemsTotalCents = 0;
      for (const item of items) {
        db.getDatabase().prepare(`
          INSERT INTO invoice_items (run_id, description, quantity, unit_price_cents, total_cents, category, created_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(runId, item.description, item.quantity, item.unitPriceCents, item.totalCents, item.category || 'general');
        itemsTotalCents += item.totalCents || 0;
      }

      // ===== PROCESS COGS CODING =====
      // Auto-categorize invoice items based on user's SKU mappings
      try {
        const { processInvoiceForCOGS } = require('./server');
        if (processInvoiceForCOGS && typeof processInvoiceForCOGS === 'function') {
          await processInvoiceForCOGS(user.id, runId, items);
          console.log(`[EMAIL IMAP] ✓ COGS coding completed for ${items.length} items`);
        }
      } catch (cogsError) {
        // Don't fail the invoice processing if COGS coding fails
        console.warn('[EMAIL IMAP] COGS coding skipped:', cogsError.message);
      }

      // Use parser's extracted total if available (more accurate for vendors like Cintas)
      // Fall back to summed items total if parser didn't find a total
      const totalCents = parsedInvoice.totals?.totalCents > 0
        ? parsedInvoice.totals.totalCents
        : itemsTotalCents;

      console.log(`[EMAIL IMAP] Invoice total: $${(totalCents/100).toFixed(2)} (parser: $${(parsedInvoice.totals?.totalCents/100 || 0).toFixed(2)}, items sum: $${(itemsTotalCents/100).toFixed(2)})`);

      // Store opportunities detected by unified parser
      const parserOpportunities = parsedInvoice.opportunities || [];
      for (const opp of parserOpportunities) {
        try {
          db.getDatabase().prepare(`
            INSERT INTO opportunities (
              account_name, vendor_name, opportunity_type, description,
              estimated_value_cents, status, source, created_at
            ) VALUES (?, ?, ?, ?, ?, 'new', 'email_autopilot', CURRENT_TIMESTAMP)
          `).run(
            payload.accountName,
            payload.vendorName,
            opp.type,
            opp.description,
            opp.amount || 0
          );
        } catch (oppErr) {
          console.warn('[EMAIL IMAP] Failed to store opportunity:', oppErr.message);
        }
      }

      // Run rules engine to detect additional opportunities
      let opportunitiesDetected = parserOpportunities.length;
      try {
        const rules = db.evaluateRulesForInvoice(payload.accountName, items);
        opportunitiesDetected += rules?.opportunitiesCreated || 0;
      } catch (rulesError) {
        console.error('[EMAIL IMAP] Rules engine error:', rulesError.message);
      }

      // Mark run as complete
      db.getDatabase().prepare(`
        UPDATE ingestion_runs
        SET status = 'completed', completed_at = CURRENT_TIMESTAMP
        WHERE run_id = ?
      `).run(runId);

      // Update user's invoice count if on trial
      if (user.is_trial) {
        db.getDatabase().prepare(`
          UPDATE users
          SET trial_invoices_used = trial_invoices_used + 1
          WHERE id = ?
        `).run(user.id);
      }

      // Use vendor name from parser if available (more accurate)
      const vendorName = parsedInvoice.vendor?.name || payload.vendorName;
      const customerName = parsedInvoice.customer?.name || payload.accountName;

      // Track vendor for future price comparisons
      db.trackVendor(monitor.id, vendorName, {
        vendorEmail: payload.emailFrom,
        invoiceAmountCents: totalCents
      });

      return {
        success: true,
        runId,
        itemsExtracted: items.length,
        totalCents,
        opportunitiesDetected,
        savingsDetectedCents: 0,
        // Include parser metadata for debugging/analytics
        parserConfidence: parsedInvoice.confidence?.overall || 0,
        extractionStrategy: parsedInvoice.items[0]?.extractionStrategy || 'unknown',
        vendorDetected: vendorName,
        customerDetected: customerName
      };
    } catch (error) {
      console.error('[EMAIL IMAP] Ingest error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Extract invoice items from raw text
   * Basic extraction - can be enhanced with AI later
   * @param {string} text - Raw invoice text
   * @returns {Array} Extracted items
   */
  extractInvoiceItems(text) {
    const items = [];

    // Common invoice line item patterns
    const patterns = [
      // Pattern: Qty  Description  Unit Price  Total
      /(\d+)\s+(.{10,50})\s+\$?([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)/g,
      // Pattern: Description  Qty  Price
      /([A-Za-z].{10,50}?)\s+(\d+)\s+\$?([\d,]+\.?\d*)/g,
      // Pattern: SKU/Item#  Description  Price
      /([A-Z0-9-]{3,15})\s+(.{10,40})\s+\$?([\d,]+\.?\d*)/g
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const quantity = parseInt(match[1]) || 1;
        const description = match[2]?.trim() || 'Item';
        const price = parseFloat((match[3] || match[4] || '0').replace(/,/g, ''));

        if (price > 0 && description.length > 3) {
          items.push({
            description: description.slice(0, 200),
            quantity,
            unitPriceCents: Math.round(price * 100 / quantity),
            totalCents: Math.round(price * 100),
            category: this.categorizeItem(description)
          });
        }
      }

      if (items.length > 0) break; // Use first successful pattern
    }

    // If no items found, create a single line item from total
    if (items.length === 0) {
      const totalMatch = text.match(/(?:total|amount due|balance)[:\s]*\$?([\d,]+\.?\d*)/i);
      if (totalMatch) {
        const total = parseFloat(totalMatch[1].replace(/,/g, ''));
        if (total > 0) {
          items.push({
            description: 'Invoice Total',
            quantity: 1,
            unitPriceCents: Math.round(total * 100),
            totalCents: Math.round(total * 100),
            category: 'general'
          });
        }
      }
    }

    return items;
  }

  /**
   * Categorize an item based on description
   * @param {string} description
   * @returns {string} Category
   */
  categorizeItem(description) {
    const desc = description.toLowerCase();

    if (desc.includes('food') || desc.includes('produce') || desc.includes('meat') || desc.includes('dairy')) {
      return 'food_supplies';
    }
    if (desc.includes('equipment') || desc.includes('machine') || desc.includes('tool')) {
      return 'equipment';
    }
    if (desc.includes('service') || desc.includes('labor') || desc.includes('maintenance')) {
      return 'services';
    }
    if (desc.includes('shipping') || desc.includes('freight') || desc.includes('delivery')) {
      return 'shipping';
    }
    if (desc.includes('license') || desc.includes('subscription') || desc.includes('software')) {
      return 'software';
    }

    return 'general';
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
