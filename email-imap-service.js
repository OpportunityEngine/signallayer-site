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
const universalInvoiceProcessor = require('./universal-invoice-processor');  // Universal invoice processing (PDF, images, OCR)
const InventoryIntelligence = require('./inventory-intelligence');  // Inventory tracking & price intelligence

// Initialize inventory intelligence for auto-processing from email invoices
const inventoryIntelligence = new InventoryIntelligence();

// Try to load OAuth service (optional - only needed if using OAuth)
let emailOAuth = null;
try {
  emailOAuth = require('./email-oauth-service');
} catch (e) {
  console.log('[EMAIL IMAP] OAuth service not available - using password auth only');
}

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
    console.log(`[EMAIL IMAP] ========== CHECK EMAILS START (Monitor ${monitorId}) ==========`);

    // Prevent duplicate processing
    const lockKey = `monitor-${monitorId}`;
    if (this.processingLocks.has(lockKey)) {
      console.log(`[EMAIL IMAP] ⏳ Monitor ${monitorId} already processing, skipping...`);
      return;
    }

    this.processingLocks.add(lockKey);

    try {
      const monitor = db.getEmailMonitor(monitorId);
      console.log(`[EMAIL IMAP] Monitor lookup result:`, monitor ? {
        id: monitor.id,
        email: monitor.email_address,
        is_active: monitor.is_active,
        oauth_provider: monitor.oauth_provider,
        has_oauth_token: !!monitor.oauth_access_token,
        require_invoice_keywords: monitor.require_invoice_keywords
      } : 'NOT FOUND');

      if (!monitor) {
        console.error(`[EMAIL IMAP] ❌ Monitor ${monitorId} not found in database`);
        this.processingLocks.delete(lockKey);
        return;
      }

      if (!monitor.is_active) {
        console.log(`[EMAIL IMAP] ⏸️ Monitor ${monitorId} is inactive, skipping`);
        this.processingLocks.delete(lockKey);
        return;
      }

      console.log(`[EMAIL IMAP] 📧 Checking emails for: ${monitor.email_address}`);

      // Build IMAP configuration based on auth type
      const imapConfig = await this.buildIMAPConfig(monitor);
      if (!imapConfig) {
        throw new Error('Failed to build IMAP configuration - no OAuth token or password. Please reconnect your email.');
      }

      console.log(`[EMAIL IMAP] 🔌 Connecting to IMAP server: ${monitor.imap_host}:${monitor.imap_port}`);
      const imap = new Imap(imapConfig);

      await this.processIMAPConnection(imap, monitor);

      // Update last checked timestamp
      db.updateEmailMonitorLastChecked(monitorId, new Date().toISOString());
      console.log(`[EMAIL IMAP] ✅ Check completed for monitor ${monitorId}`);

    } catch (error) {
      console.error(`[EMAIL IMAP] ❌ Error checking monitor ${monitorId}:`, error.message);
      console.error(`[EMAIL IMAP] Stack:`, error.stack);
      db.updateEmailMonitorError(monitorId, error.message);
    } finally {
      this.processingLocks.delete(lockKey);
      console.log(`[EMAIL IMAP] ========== CHECK EMAILS END (Monitor ${monitorId}) ==========`);
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
   * Build IMAP configuration based on authentication type (OAuth or password)
   * @param {Object} monitor - Email monitor configuration
   * @returns {Object} IMAP configuration object
   */
  async buildIMAPConfig(monitor) {
    const baseConfig = {
      user: monitor.imap_user || monitor.email_address,
      host: monitor.imap_host,
      port: monitor.imap_port || 993,
      tls: monitor.imap_secure !== 0,
      tlsOptions: { rejectUnauthorized: false }
    };

    // Check if this is an OAuth monitor
    if (monitor.oauth_provider && emailOAuth) {
      console.log(`[EMAIL IMAP] Using OAuth (${monitor.oauth_provider}) for monitor ${monitor.id}`);

      try {
        // Get valid access token (refreshes if needed)
        const accessToken = await emailOAuth.getValidAccessToken(monitor);

        if (!accessToken) {
          throw new Error('Failed to get OAuth access token');
        }

        // Use XOAUTH2 authentication
        const xoauth2Token = emailOAuth.createXOAuth2Token(
          monitor.email_address,
          accessToken
        );

        return {
          ...baseConfig,
          xoauth2: xoauth2Token
        };

      } catch (oauthError) {
        console.error(`[EMAIL IMAP] OAuth error for monitor ${monitor.id}:`, oauthError.message);
        throw oauthError;
      }
    }

    // Fall back to password authentication
    if (monitor.imap_password_encrypted) {
      console.log(`[EMAIL IMAP] Using password auth for monitor ${monitor.id}`);
      return {
        ...baseConfig,
        password: this.decryptPassword(monitor.imap_password_encrypted)
      };
    }

    // No authentication method available
    console.error(`[EMAIL IMAP] No auth method for monitor ${monitor.id}`);
    return null;
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
      console.log(`[EMAIL IMAP] Skipping email "${emailData.subject}" - no attachments`);
      return false;
    }

    // Supported file types for invoice processing (PDF and images for scanned invoices)
    const SUPPORTED_MIME_TYPES = [
      'application/pdf',
      'image/jpeg', 'image/jpg', 'image/png', 'image/tiff', 'image/webp', 'image/heic'
    ];
    const SUPPORTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp', '.heic'];

    // Check for supported invoice attachment types
    const invoiceAttachments = emailData.attachments.filter(att => {
      const ext = att.filename ? '.' + att.filename.split('.').pop().toLowerCase() : '';
      return SUPPORTED_MIME_TYPES.includes(att.contentType) || SUPPORTED_EXTENSIONS.includes(ext);
    });

    if (invoiceAttachments.length === 0) {
      console.log(`[EMAIL IMAP] Skipping email "${emailData.subject}" - no PDF/image attachments (found: ${emailData.attachments.map(a => a.filename || a.contentType).join(', ')})`);
      return false;
    }

    console.log(`[EMAIL IMAP] ✓ Email "${emailData.subject}" has ${invoiceAttachments.length} processable attachment(s): ${invoiceAttachments.map(a => a.filename).join(', ')}`);

    // Check if monitor requires keyword filtering (optional - allows processing all PDFs)
    if (monitor.require_invoice_keywords === false || monitor.require_invoice_keywords === 0) {
      // Process ALL emails with supported attachments (best for dedicated invoice email addresses)
      return true;
    }

    // Default behavior: Check subject and attachment names for invoice keywords
    const subject = (emailData.subject || '').toLowerCase();
    const attachmentNames = invoiceAttachments.map(a => (a.filename || '').toLowerCase()).join(' ');
    const searchText = subject + ' ' + attachmentNames;

    const invoiceKeywords = ['invoice', 'bill', 'statement', 'receipt', 'order', 'payment', 'purchase', 'po', 'quote', 'estimate'];
    const hasInvoiceKeyword = invoiceKeywords.some(keyword => searchText.includes(keyword));

    // Also check for common invoice file patterns in attachment names
    const invoiceFilePatterns = [/inv[-_]?\d+/i, /po[-_]?\d+/i, /\d{4,}\.pdf$/i];
    const hasInvoiceFilePattern = invoiceAttachments.some(att =>
      invoiceFilePatterns.some(pattern => pattern.test(att.filename || ''))
    );

    if (!hasInvoiceKeyword && !hasInvoiceFilePattern) {
      console.log(`[EMAIL IMAP] Skipping email "${emailData.subject}" - no invoice keywords found in subject or filenames`);
      return false;
    }

    return true;
  }

  /**
   * Process invoice attachments (PDF, images, scanned documents)
   * Uses Universal Invoice Processor for all formats including OCR for scans/images
   * @param {Object} emailData - Parsed email data
   * @param {Object} monitor - Email monitor configuration
   * @returns {Promise<Object>} Processing result
   */
  async processInvoiceAttachments(emailData, monitor) {
    const invoiceIds = [];
    let invoicesCreated = 0;

    // Supported file types for invoice processing
    const SUPPORTED_TYPES = {
      'application/pdf': 'pdf',
      'image/jpeg': 'image',
      'image/jpg': 'image',
      'image/png': 'image',
      'image/tiff': 'image',
      'image/webp': 'image',
      'image/heic': 'image'
    };

    const SUPPORTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp', '.heic'];

    try {
      for (const attachment of emailData.attachments) {
        const ext = attachment.filename ? '.' + attachment.filename.split('.').pop().toLowerCase() : '';
        const isSupported = SUPPORTED_TYPES[attachment.contentType] || SUPPORTED_EXTENSIONS.includes(ext);

        if (!isSupported) continue;

        const fileType = SUPPORTED_TYPES[attachment.contentType] || (ext === '.pdf' ? 'pdf' : 'image');
        console.log(`[EMAIL IMAP] Processing ${fileType} attachment: ${attachment.filename}`);

        try {
          // ===== USE UNIVERSAL INVOICE PROCESSOR =====
          // Handles PDFs (digital & scanned), images (phone photos, scans), with OCR
          const processorResult = await universalInvoiceProcessor.processInvoice(
            {
              buffer: attachment.content,
              mimeType: attachment.contentType,
              filename: attachment.filename
            },
            {
              source: 'email_autopilot',
              includeRawText: true,
              preprocessImages: true  // Enable mobile photo optimization
            }
          );

          if (!processorResult.ok && processorResult.rawTextLength === 0) {
            console.warn(`[EMAIL IMAP] No text extracted from ${attachment.filename}`);
            db.logEmailActivity(
              monitor.id,
              'warning',
              `No text could be extracted from ${attachment.filename}`,
              'warning',
              { fileName: attachment.filename, fileType: processorResult.fileType }
            );
            continue;
          }

          console.log(`[EMAIL IMAP] Universal processor: ${processorResult.fileType} file, ${processorResult.extractionMethod} extraction, ${processorResult.rawTextLength} chars, confidence: ${((processorResult.confidence?.overall || 0) * 100).toFixed(1)}%`);

          // Extract vendor/account info from email
          const senderDomain = emailData.from?.value?.[0]?.address?.split('@')[1] || '';
          const vendorName = this.extractVendorName(senderDomain, emailData.subject, processorResult.rawText);
          const accountName = monitor.account_name;

          // Build invoice payload for ingestInvoice
          const invoicePayload = {
            rawText: processorResult.rawText,
            vendorName: processorResult.vendor?.name || vendorName,
            accountName: processorResult.customer?.name || accountName,
            fileName: attachment.filename,
            source: 'email_autopilot',
            monitorId: monitor.id,
            emailSubject: emailData.subject,
            emailFrom: emailData.from?.value?.[0]?.address,
            emailDate: emailData.date?.toISOString(),
            // Pass processor results to avoid re-parsing
            _processorResult: processorResult
          };

          // Call internal ingest function
          const result = await this.ingestInvoice(invoicePayload, monitor);

          if (result.success) {
            invoiceIds.push(result.runId);
            invoicesCreated++;

            // Log activity with extraction details
            db.logEmailActivity(
              monitor.id,
              'invoice_processed',
              `Processed ${fileType} invoice from ${vendorName}: ${attachment.filename}`,
              'info',
              {
                runId: result.runId,
                opportunities: result.opportunitiesDetected || 0,
                fileName: attachment.filename,
                fileType: processorResult.fileType,
                extractionMethod: processorResult.extractionMethod,
                confidence: processorResult.confidence?.overall
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
        } catch (processError) {
          console.error(`[EMAIL IMAP] Processing error for ${attachment.filename}:`, processError.message);
          db.logEmailActivity(
            monitor.id,
            'error',
            `Failed to process ${attachment.filename}: ${processError.message}`,
            'warning',
            { fileName: attachment.filename, error: processError.message }
          );
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

      // ===== USE UNIVERSAL INVOICE PROCESSOR =====
      // This ensures consistent extraction across upload, email, and browser extension
      // If _processorResult is passed, use it (already processed by processInvoiceAttachments)
      let parsedInvoice;

      if (payload._processorResult && payload._processorResult.parsed) {
        // Use pre-processed result from processInvoiceAttachments
        parsedInvoice = payload._processorResult.parsed;
        console.log(`[EMAIL IMAP] Using pre-processed result: ${parsedInvoice.items?.length || 0} items`);
      } else {
        // Process from scratch using universal processor
        const processorResult = await universalInvoiceProcessor.processInvoice(
          { text: payload.rawText },
          { source: 'email_autopilot', includeRawText: true }
        );
        parsedInvoice = processorResult.parsed || {
          ok: processorResult.ok,
          items: processorResult.items || [],
          totals: processorResult.totals,
          vendor: processorResult.vendor,
          customer: processorResult.customer,
          metadata: processorResult.metadata,
          confidence: processorResult.confidence,
          opportunities: processorResult.opportunities || [],
          validation: { warnings: processorResult.warnings || [] }
        };
        console.log(`[EMAIL IMAP] Universal processor: ${parsedInvoice.items?.length || 0} items, confidence: ${((parsedInvoice.confidence?.overall || 0) * 100).toFixed(1)}%`);
      }

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

      // ===== INVENTORY INTELLIGENCE INTEGRATION =====
      // Auto-update inventory levels, track prices, detect price changes
      try {
        const vendorName = parsedInvoice.vendor?.name || payload.vendorName;
        const invoiceDate = parsedInvoice.date || parsedInvoice.invoiceDate || new Date().toISOString().split('T')[0];

        const inventoryResult = inventoryIntelligence.processInvoiceForInventory(
          user.id,
          vendorName,
          items,
          invoiceDate
        );

        console.log(`[EMAIL IMAP] ✓ Inventory intelligence: ${inventoryResult.processed} items updated, ${inventoryResult.pricesRecorded} prices tracked, ${inventoryResult.priceAlerts?.length || 0} alerts`);

        // Store any price alerts as opportunities
        if (inventoryResult.priceAlerts && inventoryResult.priceAlerts.length > 0) {
          for (const alert of inventoryResult.priceAlerts) {
            if (alert.alertType === 'price_increase' && alert.changePercent >= 10) {
              try {
                db.getDatabase().prepare(`
                  INSERT INTO opportunities (
                    account_name, vendor_name, opportunity_type, description,
                    estimated_value_cents, status, source, created_at
                  ) VALUES (?, ?, 'price_increase', ?, ?, 'new', 'inventory_intel', CURRENT_TIMESTAMP)
                `).run(
                  payload.accountName,
                  alert.vendor,
                  `Price increase detected: ${alert.sku} increased by ${alert.changePercent}% (from $${(alert.previousPriceCents/100).toFixed(2)} to $${(alert.newPriceCents/100).toFixed(2)})`,
                  Math.round((alert.newPriceCents - alert.previousPriceCents) * 10) // Estimated annual impact
                );
              } catch (oppErr) {
                console.warn('[EMAIL IMAP] Failed to store price alert:', oppErr.message);
              }
            }
          }
        }
      } catch (inventoryError) {
        console.warn('[EMAIL IMAP] Inventory intelligence skipped:', inventoryError.message);
      }
      // ===== END INVENTORY INTELLIGENCE =====

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
