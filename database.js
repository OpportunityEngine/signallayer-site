// Database module for Revenue Radar
// Handles SQLite database initialization and common queries
const sqlite3 = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Database file location
// Support both DB_PATH and DATABASE_PATH (DigitalOcean uses DATABASE_PATH in app.yaml)
const DB_PATH = process.env.DB_PATH || process.env.DATABASE_PATH || path.join(__dirname, 'revenue-radar.db');
const SCHEMA_PATH = path.join(__dirname, 'database-schema.sql');

// Initialize database
let db;

function initDatabase() {
  try {
    // Create database connection (verbose logging only in development)
    const options = process.env.NODE_ENV === 'production' ? {} : { verbose: console.log };
    db = new sqlite3(DB_PATH, options);

    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');

    // Read and execute schema
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);

    // Extend opportunities table with rules engine fields (safe to run multiple times)
    try {
      db.exec(`
        -- Add new fields for rules engine
        ALTER TABLE opportunities ADD COLUMN source_type TEXT DEFAULT 'invoice';
        ALTER TABLE opportunities ADD COLUMN rule_id INTEGER;
        ALTER TABLE opportunities ADD COLUMN trigger_sku TEXT;
        ALTER TABLE opportunities ADD COLUMN recommended_sku TEXT;
        ALTER TABLE opportunities ADD COLUMN contract_price_cents INTEGER;
        ALTER TABLE opportunities ADD COLUMN commission_rate_used REAL;
        ALTER TABLE opportunities ADD COLUMN explainability_json TEXT;
        ALTER TABLE opportunities ADD COLUMN confidence_score REAL;
        ALTER TABLE opportunities ADD COLUMN talk_track TEXT;
        ALTER TABLE opportunities ADD COLUMN created_by_user_id INTEGER;
        ALTER TABLE opportunities ADD COLUMN dedupe_key TEXT;
        ALTER TABLE opportunities ADD COLUMN supersedes_opportunity_id INTEGER;
      `);
      console.log('✅ Opportunities table extended with rules engine fields');
    } catch (alterError) {
      // Columns may already exist, which is fine
      if (!alterError.message.includes('duplicate column')) {
        console.log('⚠️  Some opportunity columns may already exist (safe to ignore)');
      }
    }

    // Add trial/freemium tracking fields (safe to run multiple times)
    try {
      db.exec(`
        -- Trial status tracking
        ALTER TABLE users ADD COLUMN is_trial INTEGER DEFAULT 0;
        ALTER TABLE users ADD COLUMN trial_started_at DATETIME;
        ALTER TABLE users ADD COLUMN trial_expires_at DATETIME;
        ALTER TABLE users ADD COLUMN trial_invoices_used INTEGER DEFAULT 0;
        ALTER TABLE users ADD COLUMN trial_invoices_limit INTEGER DEFAULT 20;
        ALTER TABLE users ADD COLUMN trial_days_limit INTEGER DEFAULT 30;
        ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'trial' CHECK(subscription_status IN ('trial', 'active', 'expired', 'cancelled'));
        ALTER TABLE users ADD COLUMN signup_source TEXT DEFAULT 'manual';
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_users_trial_expires ON users(trial_expires_at) WHERE is_trial = 1;
        CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);
      `);
      console.log('✅ Users table extended with trial tracking fields');
    } catch (alterError) {
      // Columns may already exist, which is fine
      if (!alterError.message.includes('duplicate column')) {
        console.log('⚠️  Some trial columns may already exist (safe to ignore)');
      }
    }

    // Create signup_requests table for admin approval workflow
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS signup_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            company_name TEXT,
            requested_role TEXT DEFAULT 'rep' CHECK(requested_role IN ('rep', 'manager', 'viewer')),
            reason TEXT,
            linkedin_url TEXT,
            password_hash TEXT,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'denied')),
            admin_notes TEXT,
            reviewed_by INTEGER,
            reviewed_at DATETIME,
            created_user_id INTEGER,
            approval_token TEXT UNIQUE,
            denial_token TEXT UNIQUE,
            token_expires_at DATETIME,
            ip_address TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (reviewed_by) REFERENCES users(id),
            FOREIGN KEY (created_user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_signup_requests_status ON signup_requests(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_signup_requests_email ON signup_requests(email);
        CREATE INDEX IF NOT EXISTS idx_signup_requests_approval_token ON signup_requests(approval_token);
        CREATE INDEX IF NOT EXISTS idx_signup_requests_denial_token ON signup_requests(denial_token);
      `);
      console.log('✅ Signup requests table created for admin approval workflow');
    } catch (tableError) {
      // Table may already exist, which is fine
      if (!tableError.message.includes('already exists')) {
        console.log('⚠️  Signup requests table may already exist (safe to ignore)');
      }
    }

    // Add password_hash column to signup_requests if it doesn't exist
    try {
      db.exec(`ALTER TABLE signup_requests ADD COLUMN password_hash TEXT`);
      console.log('✅ Added password_hash column to signup_requests');
    } catch (alterError) {
      // Column may already exist
      if (!alterError.message.includes('duplicate column')) {
        console.log('⚠️  password_hash column may already exist (safe to ignore)');
      }
    }

    // Migrate users table to add demo roles to CHECK constraint
    migrateUsersTableForDemoRoles(db);

    // Create API request log table for real-time analytics
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS api_request_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            endpoint TEXT NOT NULL,
            method TEXT NOT NULL,
            status_code INTEGER,
            response_time_ms INTEGER,
            user_id INTEGER,
            ip_address TEXT,
            user_agent TEXT,
            error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_api_log_endpoint ON api_request_log(endpoint, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_api_log_created ON api_request_log(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_api_log_status ON api_request_log(status_code);
      `);
      console.log('✅ API request log table created for real-time analytics');
    } catch (tableError) {
      if (!tableError.message.includes('already exists')) {
        console.log('⚠️  API request log table may already exist (safe to ignore)');
      }
    }

    // Load Email Autopilot schema
    try {
      const emailAutopilotSchemaPath = path.join(__dirname, 'database-schema-email-autopilot.sql');
      if (fs.existsSync(emailAutopilotSchemaPath)) {
        const emailSchema = fs.readFileSync(emailAutopilotSchemaPath, 'utf8');
        db.exec(emailSchema);
        console.log('✅ Email Autopilot schema loaded');
      }
    } catch (emailSchemaError) {
      // Tables may already exist
      if (!emailSchemaError.message.includes('already exists')) {
        console.log('⚠️  Email Autopilot schema may already exist (safe to ignore)');
      }
    }

    // Load Business Intelligence schema (inventory, opportunities, payroll, etc.)
    try {
      const businessIntelSchemaPath = path.join(__dirname, 'database-schema-business-intel.sql');
      if (fs.existsSync(businessIntelSchemaPath)) {
        const businessIntelSchema = fs.readFileSync(businessIntelSchemaPath, 'utf8');
        db.exec(businessIntelSchema);
        console.log('✅ Business Intelligence schema loaded');
      }
    } catch (biSchemaError) {
      if (!biSchemaError.message.includes('already exists')) {
        console.log('⚠️  Business Intelligence schema may already exist (safe to ignore)');
      }
    }

    // Load Events & Catering schema
    try {
      const eventsCateringSchemaPath = path.join(__dirname, 'database-schema-events-catering.sql');
      if (fs.existsSync(eventsCateringSchemaPath)) {
        const eventsCateringSchema = fs.readFileSync(eventsCateringSchemaPath, 'utf8');
        db.exec(eventsCateringSchema);
        console.log('✅ Events & Catering schema loaded');
      }
    } catch (eventsSchemaError) {
      if (!eventsSchemaError.message.includes('already exists')) {
        console.log('⚠️  Events & Catering schema may already exist (safe to ignore)');
      }
    }

    // Run BI schema migrations (for existing databases with old schema)
    try {
      // Check if reorder_recommendations needs migration (add title, description columns if missing)
      const recTableInfo = db.prepare("PRAGMA table_info(reorder_recommendations)").all();
      const hasTitle = recTableInfo.some(col => col.name === 'title');
      const hasDescription = recTableInfo.some(col => col.name === 'description');

      if (!hasTitle && recTableInfo.length > 0) {
        db.exec(`ALTER TABLE reorder_recommendations ADD COLUMN title TEXT`);
        console.log('✅ Migration: Added title column to reorder_recommendations');
      }
      if (!hasDescription && recTableInfo.length > 0) {
        db.exec(`ALTER TABLE reorder_recommendations ADD COLUMN description TEXT`);
        console.log('✅ Migration: Added description column to reorder_recommendations');
      }

      // Add SKU column to invoice_items for inventory tracking
      const invoiceItemsInfo = db.prepare("PRAGMA table_info(invoice_items)").all();
      const hasSku = invoiceItemsInfo.some(col => col.name === 'sku');
      if (!hasSku && invoiceItemsInfo.length > 0) {
        db.exec(`ALTER TABLE invoice_items ADD COLUMN sku TEXT`);
        console.log('✅ Migration: Added sku column to invoice_items');
      }

      // Add indexes for Smart Ordering analytics (SKU-based queries)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_invoice_items_sku ON invoice_items(sku)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_invoice_items_run_id ON invoice_items(run_id)`);

      // Check if inventory_usage needs migration (convert from period-based to daily)
      const usageTableInfo = db.prepare("PRAGMA table_info(inventory_usage)").all();
      const hasDateColumn = usageTableInfo.some(col => col.name === 'date');

      if (!hasDateColumn && usageTableInfo.length > 0) {
        // Old schema exists, need to recreate table
        db.exec(`
          CREATE TABLE IF NOT EXISTS inventory_usage_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inventory_item_id INTEGER NOT NULL,
            date DATE NOT NULL,
            daily_usage REAL NOT NULL DEFAULT 0,
            quantity_received REAL DEFAULT 0,
            quantity_wasted REAL DEFAULT 0,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id),
            UNIQUE(inventory_item_id, date)
          );
          DROP TABLE IF EXISTS inventory_usage;
          ALTER TABLE inventory_usage_new RENAME TO inventory_usage;
          CREATE INDEX IF NOT EXISTS idx_usage_item_date ON inventory_usage(inventory_item_id, date DESC);
        `);
        console.log('✅ Migration: Upgraded inventory_usage table schema');
      }
    } catch (migrationError) {
      console.log('⚠️  BI schema migration check (safe to ignore):', migrationError.message);
    }

    // Create subscriptions table for Stripe integration
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            stripe_customer_id TEXT UNIQUE,
            stripe_subscription_id TEXT UNIQUE,
            plan_id TEXT NOT NULL,
            plan_name TEXT NOT NULL,
            status TEXT DEFAULT 'active' CHECK(status IN ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete')),
            current_period_start DATETIME,
            current_period_end DATETIME,
            cancel_at_period_end INTEGER DEFAULT 0,
            canceled_at DATETIME,
            trial_end DATETIME,
            quantity INTEGER DEFAULT 1,
            amount_cents INTEGER,
            currency TEXT DEFAULT 'usd',
            interval TEXT DEFAULT 'month' CHECK(interval IN ('month', 'year')),
            metadata_json TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
        CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
      `);
      console.log('✅ Subscriptions table created for Stripe integration');
    } catch (subError) {
      if (!subError.message.includes('already exists')) {
        console.log('⚠️  Subscriptions table may already exist (safe to ignore)');
      }
    }

    // Create payment_history table for tracking all payments
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS payment_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            subscription_id INTEGER,
            stripe_payment_intent_id TEXT UNIQUE,
            stripe_invoice_id TEXT,
            amount_cents INTEGER NOT NULL,
            currency TEXT DEFAULT 'usd',
            status TEXT DEFAULT 'succeeded' CHECK(status IN ('pending', 'succeeded', 'failed', 'refunded')),
            description TEXT,
            receipt_url TEXT,
            failure_reason TEXT,
            refund_reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_payment_history_user ON payment_history(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_payment_history_status ON payment_history(status);
      `);
      console.log('✅ Payment history table created');
    } catch (payError) {
      if (!payError.message.includes('already exists')) {
        console.log('⚠️  Payment history table may already exist (safe to ignore)');
      }
    }

    // Migrate email_monitors table - add missing columns for error tracking
    try {
      const emailMonitorsInfo = db.prepare("PRAGMA table_info(email_monitors)").all();

      // Add missing columns if table exists
      if (emailMonitorsInfo.length > 0) {
        const hasLastError = emailMonitorsInfo.some(col => col.name === 'last_error');
        const hasLastCheckedAt = emailMonitorsInfo.some(col => col.name === 'last_checked_at');
        const hasLastSuccessAt = emailMonitorsInfo.some(col => col.name === 'last_success_at');
        const hasCheckFreqMins = emailMonitorsInfo.some(col => col.name === 'check_frequency_minutes');
        const hasImapUser = emailMonitorsInfo.some(col => col.name === 'imap_user');
        const hasImapPasswordEncrypted = emailMonitorsInfo.some(col => col.name === 'imap_password_encrypted');
        const hasImapSecure = emailMonitorsInfo.some(col => col.name === 'imap_secure');
        const hasFolderName = emailMonitorsInfo.some(col => col.name === 'folder_name');
        const hasEmailsProcessedCount = emailMonitorsInfo.some(col => col.name === 'emails_processed_count');
        const hasInvoicesCreatedCount = emailMonitorsInfo.some(col => col.name === 'invoices_created_count');
        const hasName = emailMonitorsInfo.some(col => col.name === 'name');

        if (!hasLastError) {
          db.exec(`ALTER TABLE email_monitors ADD COLUMN last_error TEXT`);
          console.log('✅ Migration: Added last_error column to email_monitors');
        }
        if (!hasLastCheckedAt) {
          db.exec(`ALTER TABLE email_monitors ADD COLUMN last_checked_at DATETIME`);
          console.log('✅ Migration: Added last_checked_at column to email_monitors');
        }
        if (!hasLastSuccessAt) {
          db.exec(`ALTER TABLE email_monitors ADD COLUMN last_success_at DATETIME`);
          console.log('✅ Migration: Added last_success_at column to email_monitors');
        }
        if (!hasCheckFreqMins) {
          db.exec(`ALTER TABLE email_monitors ADD COLUMN check_frequency_minutes INTEGER DEFAULT 15`);
          console.log('✅ Migration: Added check_frequency_minutes column to email_monitors');
        }
        if (!hasImapUser) {
          db.exec(`ALTER TABLE email_monitors ADD COLUMN imap_user TEXT`);
          // Copy username to imap_user for existing records
          db.exec(`UPDATE email_monitors SET imap_user = username WHERE imap_user IS NULL`);
          console.log('✅ Migration: Added imap_user column to email_monitors');
        }
        if (!hasImapPasswordEncrypted) {
          db.exec(`ALTER TABLE email_monitors ADD COLUMN imap_password_encrypted TEXT`);
          // Copy encrypted_password to imap_password_encrypted for existing records
          db.exec(`UPDATE email_monitors SET imap_password_encrypted = encrypted_password WHERE imap_password_encrypted IS NULL`);
          console.log('✅ Migration: Added imap_password_encrypted column to email_monitors');
        }
        if (!hasImapSecure) {
          db.exec(`ALTER TABLE email_monitors ADD COLUMN imap_secure INTEGER DEFAULT 1`);
          console.log('✅ Migration: Added imap_secure column to email_monitors');
        }
        if (!hasFolderName) {
          db.exec(`ALTER TABLE email_monitors ADD COLUMN folder_name TEXT DEFAULT 'INBOX'`);
          console.log('✅ Migration: Added folder_name column to email_monitors');
        }
        if (!hasEmailsProcessedCount) {
          db.exec(`ALTER TABLE email_monitors ADD COLUMN emails_processed_count INTEGER DEFAULT 0`);
          console.log('✅ Migration: Added emails_processed_count column to email_monitors');
        }
        if (!hasInvoicesCreatedCount) {
          db.exec(`ALTER TABLE email_monitors ADD COLUMN invoices_created_count INTEGER DEFAULT 0`);
          console.log('✅ Migration: Added invoices_created_count column to email_monitors');
        }
        if (!hasName) {
          db.exec(`ALTER TABLE email_monitors ADD COLUMN name TEXT`);
          // Copy monitor_name to name for existing records
          db.exec(`UPDATE email_monitors SET name = monitor_name WHERE name IS NULL`);
          console.log('✅ Migration: Added name column to email_monitors');
        }

        // user_id column (new column to link monitors to users properly)
        const hasUserId = emailMonitorsInfo.some(col => col.name === 'user_id');
        if (!hasUserId) {
          db.exec(`ALTER TABLE email_monitors ADD COLUMN user_id INTEGER`);
          // Copy created_by_user_id to user_id for existing records
          db.exec(`UPDATE email_monitors SET user_id = created_by_user_id WHERE user_id IS NULL AND created_by_user_id IS NOT NULL`);
          console.log('✅ Migration: Added user_id column to email_monitors');
        }

        // OAuth columns for Google/Microsoft authentication
        const hasOAuthProvider = emailMonitorsInfo.some(col => col.name === 'oauth_provider');
        const hasOAuthAccessToken = emailMonitorsInfo.some(col => col.name === 'oauth_access_token');
        const hasOAuthRefreshToken = emailMonitorsInfo.some(col => col.name === 'oauth_refresh_token');
        const hasOAuthTokenExpires = emailMonitorsInfo.some(col => col.name === 'oauth_token_expires_at');

        if (!hasOAuthProvider) {
          db.exec(`ALTER TABLE email_monitors ADD COLUMN oauth_provider TEXT`);
          console.log('✅ Migration: Added oauth_provider column to email_monitors');
        }
        if (!hasOAuthAccessToken) {
          db.exec(`ALTER TABLE email_monitors ADD COLUMN oauth_access_token TEXT`);
          console.log('✅ Migration: Added oauth_access_token column to email_monitors');
        }
        if (!hasOAuthRefreshToken) {
          db.exec(`ALTER TABLE email_monitors ADD COLUMN oauth_refresh_token TEXT`);
          console.log('✅ Migration: Added oauth_refresh_token column to email_monitors');
        }
        if (!hasOAuthTokenExpires) {
          db.exec(`ALTER TABLE email_monitors ADD COLUMN oauth_token_expires_at DATETIME`);
          console.log('✅ Migration: Added oauth_token_expires_at column to email_monitors');
        }

        // Check for require_invoice_keywords column
        const hasRequireInvoiceKeywords = emailMonitorsInfo.some(col => col.name === 'require_invoice_keywords');
        if (!hasRequireInvoiceKeywords) {
          db.exec(`ALTER TABLE email_monitors ADD COLUMN require_invoice_keywords INTEGER DEFAULT 1`);
          console.log('✅ Migration: Added require_invoice_keywords column to email_monitors');
        }

        // Disable demo email monitor that has invalid credentials
        db.exec(`UPDATE email_monitors SET is_active = 0 WHERE encrypted_password = 'ENCRYPTED_DEMO_PASSWORD'`);
        console.log('✅ Migration: Disabled demo email monitor with invalid credentials');
      }
    } catch (emailMigrationError) {
      console.log('⚠️  Email monitors migration (safe to ignore):', emailMigrationError.message);
    }

    // Initialize Intent Signals schema
    try {
      const intentSignalsSchemaPath = path.join(__dirname, 'database-schema-intent-signals.sql');
      if (fs.existsSync(intentSignalsSchemaPath)) {
        const intentSignalsSchema = fs.readFileSync(intentSignalsSchemaPath, 'utf8');
        db.exec(intentSignalsSchema);
        console.log('✅ Intent Signals schema initialized');
      }
    } catch (intentError) {
      // Tables may already exist
      if (!intentError.message.includes('already exists')) {
        console.log('⚠️  Intent Signals schema (safe to ignore):', intentError.message);
      }
    }

    // Initialize COGS Coding schema (invoice expense categorization)
    try {
      const cogsSchemaPath = path.join(__dirname, 'database-schema-cogs-coding.sql');
      if (fs.existsSync(cogsSchemaPath)) {
        const cogsSchema = fs.readFileSync(cogsSchemaPath, 'utf8');
        db.exec(cogsSchema);
        console.log('✅ COGS Coding schema initialized');
      }
    } catch (cogsError) {
      // Tables may already exist
      if (!cogsError.message.includes('already exists')) {
        console.log('⚠️  COGS Coding schema (safe to ignore):', cogsError.message);
      }
    }

    // Initialize parsing jobs queue table (for background PDF processing)
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS parsing_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id TEXT UNIQUE NOT NULL,
          user_id INTEGER NOT NULL,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
          file_path TEXT NOT NULL,
          file_name TEXT,
          file_size INTEGER,
          options TEXT,
          result TEXT,
          error_message TEXT,
          priority INTEGER DEFAULT 0,
          retries INTEGER DEFAULT 0,
          max_retries INTEGER DEFAULT 3,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          started_at DATETIME,
          completed_at DATETIME,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_parsing_jobs_status ON parsing_jobs(status, priority DESC, created_at ASC);
        CREATE INDEX IF NOT EXISTS idx_parsing_jobs_user ON parsing_jobs(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_parsing_jobs_job_id ON parsing_jobs(job_id);
      `);
      console.log('✅ Parsing jobs queue table created');
    } catch (jobsError) {
      if (!jobsError.message.includes('already exists')) {
        console.log('⚠️  Parsing jobs table may already exist (safe to ignore)');
      }
    }

    // Initialize parse reviews table (for human correction workflow)
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS parse_reviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER NOT NULL,
          original_result TEXT,
          corrected_result TEXT,
          reviewer_user_id INTEGER,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'corrected', 'dismissed')),
          confidence_score INTEGER,
          review_reasons TEXT,
          review_severity TEXT CHECK(review_severity IN ('low', 'medium', 'high')),
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          reviewed_at DATETIME,
          FOREIGN KEY (run_id) REFERENCES ingestion_runs(id),
          FOREIGN KEY (reviewer_user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_parse_reviews_status ON parse_reviews(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_parse_reviews_run ON parse_reviews(run_id);

        CREATE TABLE IF NOT EXISTS correction_patterns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          vendor_name TEXT,
          pattern_type TEXT,
          raw_pattern TEXT,
          correct_interpretation TEXT,
          confidence_boost INTEGER DEFAULT 5,
          times_applied INTEGER DEFAULT 0,
          created_from_review_id INTEGER,
          created_by_user_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_from_review_id) REFERENCES parse_reviews(id),
          FOREIGN KEY (created_by_user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_correction_patterns_vendor ON correction_patterns(vendor_name, pattern_type);
      `);
      console.log('✅ Parse reviews and correction patterns tables created');
    } catch (reviewsError) {
      if (!reviewsError.message.includes('already exists')) {
        console.log('⚠️  Parse reviews tables may already exist (safe to ignore)');
      }
    }

    // Initialize SKU mappings table (for canonical SKU normalization)
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sku_mappings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          canonical_sku TEXT NOT NULL,
          vendor_name TEXT NOT NULL,
          vendor_sku TEXT NOT NULL,
          product_name TEXT,
          product_category TEXT,
          standard_uom TEXT,
          case_size INTEGER,
          unit_weight_lbs REAL,
          conversion_factor REAL DEFAULT 1.0,
          times_matched INTEGER DEFAULT 0,
          last_matched_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, vendor_name, vendor_sku),
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_sku_mappings_lookup ON sku_mappings(user_id, vendor_name, vendor_sku);
        CREATE INDEX IF NOT EXISTS idx_sku_mappings_canonical ON sku_mappings(canonical_sku);
        CREATE INDEX IF NOT EXISTS idx_sku_mappings_product ON sku_mappings(product_name);
      `);
      console.log('✅ SKU mappings table created');
    } catch (skuError) {
      if (!skuError.message.includes('already exists')) {
        console.log('⚠️  SKU mappings table may already exist (safe to ignore)');
      }
    }

    // Migration: Add user_id guardrails (prevent NULL user_id on ingestion_runs)
    try {
      // Check if migration is needed by checking for NULL user_id values
      const nullUserIds = db.prepare('SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id IS NULL').get();

      if (nullUserIds.count > 0) {
        console.log(`🔄 Running user_id backfill migration (${nullUserIds.count} NULL values found)...`);

        // Backfill email-based ingestion runs
        const emailBackfilled = db.prepare(`
          UPDATE ingestion_runs
          SET user_id = (
            SELECT em.user_id
            FROM email_monitors em
            WHERE em.id = CAST(
              SUBSTR(
                ingestion_runs.run_id,
                7,
                INSTR(SUBSTR(ingestion_runs.run_id, 7), '-') - 1
              ) AS INTEGER
            )
            AND ingestion_runs.run_id LIKE 'email-%'
          )
          WHERE user_id IS NULL
            AND run_id LIKE 'email-%'
        `).run();

        if (emailBackfilled.changes > 0) {
          console.log(`   ✅ Backfilled ${emailBackfilled.changes} email-based invoice(s)`);
        }

        // Backfill upload-based ingestion runs to admin (user 1)
        const uploadBackfilled = db.prepare(`
          UPDATE ingestion_runs
          SET user_id = 1
          WHERE user_id IS NULL
            AND run_id LIKE 'upload-%'
        `).run();

        if (uploadBackfilled.changes > 0) {
          console.log(`   ✅ Backfilled ${uploadBackfilled.changes} upload-based invoice(s) to admin`);
        }

        // Catch-all: assign remaining NULL to admin
        const remainingBackfilled = db.prepare(`
          UPDATE ingestion_runs
          SET user_id = 1
          WHERE user_id IS NULL
        `).run();

        if (remainingBackfilled.changes > 0) {
          console.log(`   ✅ Backfilled ${remainingBackfilled.changes} remaining invoice(s) to admin`);
        }
      }

      // Check if triggers already exist
      const triggers = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'trigger'
        AND name IN ('enforce_ingestion_runs_user_id', 'enforce_ingestion_runs_user_id_update')
      `).all();

      if (triggers.length < 2) {
        // Create triggers to enforce user_id NOT NULL
        db.exec(`
          DROP TRIGGER IF EXISTS enforce_ingestion_runs_user_id;
          CREATE TRIGGER enforce_ingestion_runs_user_id
          BEFORE INSERT ON ingestion_runs
          FOR EACH ROW
          WHEN NEW.user_id IS NULL
          BEGIN
            SELECT RAISE(ABORT, 'ingestion_runs.user_id cannot be NULL - every invoice must have an owner');
          END;
        `);

        db.exec(`
          DROP TRIGGER IF EXISTS enforce_ingestion_runs_user_id_update;
          CREATE TRIGGER enforce_ingestion_runs_user_id_update
          BEFORE UPDATE ON ingestion_runs
          FOR EACH ROW
          WHEN NEW.user_id IS NULL
          BEGIN
            SELECT RAISE(ABORT, 'ingestion_runs.user_id cannot be NULL - every invoice must have an owner');
          END;
        `);

        console.log('✅ Migration: Added user_id guardrail triggers on ingestion_runs');
      }

      // Verify migration success
      const remainingNulls = db.prepare('SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id IS NULL').get();
      if (remainingNulls.count === 0) {
        console.log('✅ Migration: All ingestion_runs have valid user_id');
      } else {
        console.log(`⚠️  Warning: ${remainingNulls.count} ingestion_runs still have NULL user_id`);
      }

      // Also backfill email_monitors.user_id if needed
      const nullMonitorUserIds = db.prepare('SELECT COUNT(*) as count FROM email_monitors WHERE user_id IS NULL').get();
      if (nullMonitorUserIds.count > 0) {
        db.prepare(`
          UPDATE email_monitors
          SET user_id = COALESCE(created_by_user_id, 1)
          WHERE user_id IS NULL
        `).run();
        console.log(`✅ Migration: Backfilled ${nullMonitorUserIds.count} email_monitors with user_id`);
      }

      // Add email_monitors guardrail triggers
      const monitorTriggers = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'trigger'
        AND name IN ('enforce_email_monitors_user_id', 'enforce_email_monitors_user_id_update')
      `).all();

      if (monitorTriggers.length < 2) {
        db.exec(`
          DROP TRIGGER IF EXISTS enforce_email_monitors_user_id;
          CREATE TRIGGER enforce_email_monitors_user_id
          BEFORE INSERT ON email_monitors
          FOR EACH ROW
          WHEN NEW.user_id IS NULL
          BEGIN
            SELECT RAISE(ABORT, 'email_monitors.user_id cannot be NULL - every monitor must have an owner');
          END;
        `);

        db.exec(`
          DROP TRIGGER IF EXISTS enforce_email_monitors_user_id_update;
          CREATE TRIGGER enforce_email_monitors_user_id_update
          BEFORE UPDATE ON email_monitors
          FOR EACH ROW
          WHEN NEW.user_id IS NULL
          BEGIN
            SELECT RAISE(ABORT, 'email_monitors.user_id cannot be NULL - every monitor must have an owner');
          END;
        `);

        console.log('✅ Migration: Added user_id guardrail triggers on email_monitors');
      }

    } catch (userIdMigrationError) {
      console.log('⚠️  User ID guardrail migration (safe to ignore):', userIdMigrationError.message);
    }

    console.log(`✅ Database initialized at ${DB_PATH}`);

    // Seed demo data if database is empty (only in development)
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    if (userCount.count === 0 && process.env.NODE_ENV !== 'production') {
      console.log('⚠️  Skipping demo data seeding - not supported in production (use create-admin.js instead)');
      // seedDemoData(); // Disabled - demo users don't have passwords
    }

    // Always ensure demo users exist (safe to run on every startup)
    seedDemoUsers();

    return db;
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

function getDatabase() {
  if (!db) {
    db = initDatabase();
  }
  return db;
}

// =====================================================
// DEMO USER SEEDING
// =====================================================

/**
 * Seed demo users for sharing with potential customers and partners
 * These are READ-ONLY accounts safe to share publicly
 *
 * 1. demo_business - "Business Demo" - Shows only VP/Business dashboard
 *    For: Mom & pop shops, local businesses evaluating the product
 *    Email: business@demo.revenueradar.com / Password: DemoShop2026!
 *
 * 2. demo_business - "Demo User" - Full demo of Business Dashboard
 *    For: Anyone evaluating the business owner experience
 *    Email: demo@revenueradar.com / Password: Demo123!
 *
 * FOUNDER ACCOUNTS (always exist):
 * 3. admin@revenueradar.com / Admin123! - System admin
 * 4. taylor@revenueradar.com / Taylor123! - Founder
 * 5. victorianj23@gmail.com / Victoria123! - Founder
 */
function seedDemoUsers() {
  const bcrypt = require('bcryptjs');

  // Demo accounts (read-only, safe to share)
  const demoUsers = [
    {
      email: 'business@demo.revenueradar.com',
      name: 'Business Demo',
      password: 'DemoShop2026!',
      role: 'demo_business',
      accountName: 'Demo Business Account'
    },
    {
      email: 'demo@revenueradar.com',
      name: 'Demo User',
      password: 'Demo123!',
      role: 'demo_business',
      accountName: 'Revenue Radar Demo'
    }
  ];

  // Founder accounts (MUST always exist)
  const founderAccounts = [
    {
      email: 'admin@revenueradar.com',
      name: 'Admin',
      password: 'Admin123!',
      role: 'admin',
      accountName: 'System'
    },
    {
      email: 'taylor@revenueradar.com',
      name: 'Taylor',
      password: 'Taylor123!',
      role: 'admin',
      accountName: 'Revenue Radar'
    },
    {
      email: 'victorianj23@gmail.com',
      name: 'Victoria',
      password: 'Victoria123!',
      role: 'admin',
      accountName: 'Revenue Radar Admin'
    }
  ];

  // Combine all accounts to seed
  const allUsers = [...demoUsers, ...founderAccounts];

  for (const user of allUsers) {
    try {
      // Check if user already exists
      const existing = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(user.email);

      if (existing) {
        // Update password hash in case it changed
        const passwordHash = bcrypt.hashSync(user.password, 10);
        db.prepare(`
          UPDATE users
          SET password_hash = ?, name = ?, role = ?, account_name = ?, is_active = 1
          WHERE email = ?
        `).run(passwordHash, user.name, user.role, user.accountName, user.email);
        console.log(`✅ Demo user updated: ${user.email}`);
      } else {
        // Create new demo user
        const passwordHash = bcrypt.hashSync(user.password, 10);
        db.prepare(`
          INSERT INTO users (email, name, password_hash, role, account_name, is_active, created_at)
          VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
        `).run(user.email, user.name, passwordHash, user.role, user.accountName);
        console.log(`✅ Demo user created: ${user.email}`);
      }
    } catch (error) {
      // Ignore errors if role constraint fails (means we need to migrate)
      if (error.message.includes('CHECK constraint failed')) {
        console.log(`⚠️  Demo user ${user.email} role not yet supported, will be created after schema update`);
      } else {
        console.error(`❌ Error seeding demo user ${user.email}:`, error.message);
      }
    }
  }
}

/**
 * Migrate users table to add demo roles to the CHECK constraint
 * SQLite doesn't support ALTER CHECK constraint, so we need to recreate the table
 */
function migrateUsersTableForDemoRoles(database) {
  try {
    // Check if migration is needed by looking at the current schema
    const tableInfo = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();

    if (!tableInfo || !tableInfo.sql) {
      console.log('⚠️  Users table not found, skipping demo role migration');
      return;
    }

    // Check if demo roles already exist in the constraint
    if (tableInfo.sql.includes('demo_business') && tableInfo.sql.includes('demo_viewer')) {
      console.log('✅ Users table already has demo roles in CHECK constraint');
      return;
    }

    console.log('🔄 Migrating users table to add demo roles to CHECK constraint...');

    // Disable foreign key checks during migration
    database.exec('PRAGMA foreign_keys = OFF');

    // Perform migration in a transaction
    database.transaction(() => {
      // Step 0: Drop dependent views first (they reference users table)
      database.exec(`DROP VIEW IF EXISTS active_spif_leaderboards`);
      database.exec(`DROP VIEW IF EXISTS rep_performance`);

      // Step 1: Get existing columns from current users table
      const existingCols = database.prepare("PRAGMA table_info(users)").all().map(c => c.name);
      console.log('   Existing columns:', existingCols.length);

      // Step 2: Create new users table with updated CHECK constraint
      database.exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          password_hash TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL CHECK(role IN ('rep', 'manager', 'admin', 'viewer', 'customer_admin', 'business', 'demo_business', 'demo_viewer')) DEFAULT 'rep',
          account_name TEXT,
          team_id INTEGER,
          is_active INTEGER DEFAULT 1,
          is_email_verified INTEGER DEFAULT 0,
          email_verification_token TEXT,
          failed_login_attempts INTEGER DEFAULT 0,
          locked_until DATETIME,
          last_login_at DATETIME,
          last_login_ip TEXT,
          password_reset_token TEXT,
          password_reset_expires DATETIME,
          password_changed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_active DATETIME,
          is_trial INTEGER DEFAULT 0,
          trial_started_at DATETIME,
          trial_expires_at DATETIME,
          trial_invoices_used INTEGER DEFAULT 0,
          trial_invoices_limit INTEGER DEFAULT 20,
          trial_days_limit INTEGER DEFAULT 30,
          subscription_status TEXT DEFAULT 'trial' CHECK(subscription_status IN ('trial', 'active', 'expired', 'cancelled')),
          signup_source TEXT DEFAULT 'manual',
          created_by INTEGER,
          FOREIGN KEY (team_id) REFERENCES teams(id)
        )
      `);

      // Step 3: Build dynamic column list based on what exists in source table
      const targetCols = [
        'id', 'email', 'name', 'password_hash', 'role', 'account_name', 'team_id',
        'is_active', 'is_email_verified', 'email_verification_token',
        'failed_login_attempts', 'locked_until', 'last_login_at', 'last_login_ip',
        'password_reset_token', 'password_reset_expires', 'password_changed_at',
        'created_at', 'updated_at', 'last_active', 'is_trial', 'trial_started_at',
        'trial_expires_at', 'trial_invoices_used', 'trial_invoices_limit',
        'trial_days_limit', 'subscription_status', 'signup_source'
      ];

      // Only copy columns that exist in source
      const colsToCopy = targetCols.filter(c => existingCols.includes(c));
      const colList = colsToCopy.join(', ');
      console.log('   Copying', colsToCopy.length, 'columns');

      // Step 4: Copy data from old table to new table
      database.exec(`INSERT INTO users_new (${colList}) SELECT ${colList} FROM users`);

      // Step 5: Drop old table
      database.exec(`DROP TABLE users`);

      // Step 6: Rename new table to users
      database.exec(`ALTER TABLE users_new RENAME TO users`);

      // Step 7: Recreate indexes
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_id);
        CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      `);

      // Step 8: Recreate the views that depend on users table
      database.exec(`
        CREATE VIEW IF NOT EXISTS active_spif_leaderboards AS
        SELECT
            s.id as spif_id,
            s.name as spif_name,
            s.spif_type,
            s.prize_amount_cents,
            s.end_date,
            ss.user_id,
            u.name as user_name,
            u.email as user_email,
            ss.current_value,
            ss.rank
        FROM spifs s
        JOIN spif_standings ss ON s.id = ss.spif_id
        JOIN users u ON ss.user_id = u.id
        WHERE s.status = 'active'
            AND ss.rank <= s.top_n_winners
        ORDER BY s.id, ss.rank
      `);

      database.exec(`
        CREATE VIEW IF NOT EXISTS rep_performance AS
        SELECT
            u.id as user_id,
            u.name,
            u.email,
            COUNT(DISTINCT mr.id) as mlas_reviewed_count,
            COUNT(DISTINCT o.id) as opportunities_assigned_count,
            COUNT(DISTINCT CASE WHEN o.status = 'won' THEN o.id END) as opportunities_won_count,
            SUM(CASE WHEN o.status = 'won' THEN o.estimated_commission_cents ELSE 0 END) as total_commission_cents,
            MAX(mr.created_at) as last_activity_at
        FROM users u
        LEFT JOIN mla_reviews mr ON u.id = mr.user_id
        LEFT JOIN opportunities o ON u.id = o.assigned_to
        WHERE u.role = 'rep'
        GROUP BY u.id, u.name, u.email
      `);
    })();

    // Re-enable foreign key checks
    database.exec('PRAGMA foreign_keys = ON');

    console.log('✅ Users table migrated with demo roles in CHECK constraint');

  } catch (error) {
    console.error('❌ Failed to migrate users table for demo roles:', error.message);
    // Re-enable foreign key checks even on error
    try {
      database.exec('PRAGMA foreign_keys = ON');
    } catch (e) { /* ignore */ }
    // Don't throw - allow server to continue even if migration fails
  }
}

// Seed demo data for testing
function seedDemoData() {
  const db = getDatabase();

  try {
    db.transaction(() => {
      // Create demo team
      const teamStmt = db.prepare('INSERT INTO teams (name) VALUES (?)');
      const teamResult = teamStmt.run('Demo Sales Team');
      const teamId = teamResult.lastInsertRowid;

      // Create demo users
      const userStmt = db.prepare(`
        INSERT INTO users (email, name, role, team_id)
        VALUES (?, ?, ?, ?)
      `);

      const johnId = userStmt.run('john@demo.com', 'John', 'rep', teamId).lastInsertRowid;
      const sarahId = userStmt.run('sarah@demo.com', 'Sarah', 'rep', teamId).lastInsertRowid;
      const youId = userStmt.run('you@demo.com', 'You', 'rep', teamId).lastInsertRowid;
      const managerId = userStmt.run('manager@demo.com', 'Demo Manager', 'manager', teamId).lastInsertRowid;

      // Update team manager
      db.prepare('UPDATE teams SET manager_id = ? WHERE id = ?').run(managerId, teamId);

      // Create active SPIF for MLA reviews
      const spifStmt = db.prepare(`
        INSERT INTO spifs (
          name, description, spif_type, metric_name,
          prize_amount_cents, start_date, end_date,
          status, top_n_winners, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay()); // Start of week
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6); // End of week
      weekEnd.setHours(23, 59, 59);

      const spifId = spifStmt.run(
        'Most MLAs Reviewed This Week',
        'Top 3 reps win $100 bonus',
        'mla_review_count',
        'mlas_reviewed',
        10000, // $100.00
        weekStart.toISOString(),
        weekEnd.toISOString(),
        'active',
        3,
        managerId
      ).lastInsertRowid;

      // Create SPIF standings
      const standingStmt = db.prepare(`
        INSERT INTO spif_standings (spif_id, user_id, current_value, rank)
        VALUES (?, ?, ?, ?)
      `);

      standingStmt.run(spifId, johnId, 34, 1);
      standingStmt.run(spifId, sarahId, 31, 2);
      standingStmt.run(spifId, youId, 28, 3);

      // Create demo MLAs
      const mlaStmt = db.prepare(`
        INSERT INTO mlas (
          account_name, vendor_name, contract_value_cents,
          start_date, end_date, status, renewal_likelihood_pct
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const mlaId1 = mlaStmt.run(
        "Bella's Italian Kitchen",
        'Commercial Equipment Co',
        3250000, // $32,500
        '2024-01-15',
        '2026-01-15',
        'expiring',
        92
      ).lastInsertRowid;

      const mlaId2 = mlaStmt.run(
        'Sunset Bistro',
        'Restaurant Supply Plus',
        2800000, // $28,000
        '2023-12-01',
        '2025-12-01',
        'active',
        88
      ).lastInsertRowid;

      // Create demo opportunities
      const oppStmt = db.prepare(`
        INSERT INTO opportunities (
          account_name, opportunity_type, status, assigned_to,
          likelihood_pct, estimated_value_cents, estimated_commission_cents,
          mla_id, urgency, detected_at, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      oppStmt.run(
        "Bella's Italian Kitchen",
        'mla_renewal',
        'detected',
        youId,
        92,
        3250000,
        162500, // 5% commission
        mlaId1,
        'critical',
        new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(), // 12 days ago
        'MLA expires in 45 days. High likelihood to renew with equipment upgrade.'
      );

      oppStmt.run(
        'Sunset Bistro',
        'mla_renewal',
        'contacted',
        youId,
        88,
        2800000,
        140000,
        mlaId2,
        'high',
        new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8 days ago
        'Strong payment history. Last contact: 8 days ago. Requested pricing info.'
      );

      oppStmt.run(
        'Downtown Diner',
        'equipment_upgrade',
        'in_progress',
        youId,
        85,
        1850000,
        92500,
        null,
        'medium',
        new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        'Equipment analysis flagged 8-year-old oven. Meeting scheduled Jan 15, 10am.'
      );

      console.log('✅ Demo data seeded successfully');
    })();
  } catch (error) {
    console.error('❌ Error seeding demo data:', error);
    throw error;
  }
}

// ===== SPIF Functions =====

function getActiveSPIFs() {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM spifs
    WHERE status = 'active'
    AND datetime('now') BETWEEN start_date AND end_date
    ORDER BY end_date ASC
  `).all();
}

function getSPIFLeaderboard(spifId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT
      ss.rank,
      ss.current_value,
      u.id as user_id,
      u.name as user_name,
      u.email as user_email,
      s.prize_amount_cents,
      s.end_date
    FROM spif_standings ss
    JOIN users u ON ss.user_id = u.id
    JOIN spifs s ON ss.spif_id = s.id
    WHERE ss.spif_id = ?
    ORDER BY ss.rank ASC
    LIMIT ?
  `).all(spifId, 10);
}

function incrementSPIFMetric(spifId, userId, incrementBy = 1) {
  const db = getDatabase();

  // Upsert the standing
  db.prepare(`
    INSERT INTO spif_standings (spif_id, user_id, current_value, last_updated)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(spif_id, user_id)
    DO UPDATE SET
      current_value = current_value + ?,
      last_updated = datetime('now')
  `).run(spifId, userId, incrementBy, incrementBy);

  // Recalculate ranks
  recalculateSPIFRanks(spifId);
}

function recalculateSPIFRanks(spifId) {
  const db = getDatabase();

  // Get all standings for this SPIF sorted by value
  const standings = db.prepare(`
    SELECT id, current_value
    FROM spif_standings
    WHERE spif_id = ?
    ORDER BY current_value DESC
  `).all(spifId);

  // Update ranks
  const updateStmt = db.prepare('UPDATE spif_standings SET rank = ? WHERE id = ?');
  standings.forEach((standing, index) => {
    updateStmt.run(index + 1, standing.id);
  });
}

// ===== MLA Functions =====

function recordMLAReview(mlaId, userId, action = 'viewed', notes = null) {
  const db = getDatabase();

  const result = db.prepare(`
    INSERT INTO mla_reviews (mla_id, user_id, action, notes, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(mlaId, userId, action, notes);

  // Update MLA last_reviewed fields
  db.prepare(`
    UPDATE mlas
    SET last_reviewed_at = datetime('now'), last_reviewed_by = ?
    WHERE id = ?
  `).run(userId, mlaId);

  // Increment SPIF metric for active MLA review SPIFs
  const activeMLASPIFs = db.prepare(`
    SELECT id FROM spifs
    WHERE status = 'active'
    AND spif_type = 'mla_review_count'
    AND datetime('now') BETWEEN start_date AND end_date
  `).all();

  activeMLASPIFs.forEach(spif => {
    incrementSPIFMetric(spif.id, userId, 1);
  });

  return result.lastInsertRowid;
}

function getMLAsByStatus(status = 'active') {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM mlas
    WHERE status = ?
    ORDER BY end_date ASC
  `).all(status);
}

function getMLAReviewsThisWeek(userId) {
  const db = getDatabase();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  return db.prepare(`
    SELECT COUNT(*) as count
    FROM mla_reviews
    WHERE user_id = ?
    AND created_at >= ?
  `).get(userId, weekStart.toISOString());
}

// ===== Opportunity Functions =====

function createOpportunity(data) {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO opportunities (
      account_name, opportunity_type, status, assigned_to,
      likelihood_pct, estimated_value_cents, estimated_commission_cents,
      source_run_id, mla_id, urgency, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return stmt.run(
    data.account_name,
    data.opportunity_type,
    data.status || 'detected',
    data.assigned_to,
    data.likelihood_pct,
    data.estimated_value_cents,
    data.estimated_commission_cents,
    data.source_run_id || null,
    data.mla_id || null,
    data.urgency || 'medium',
    data.notes || null
  ).lastInsertRowid;
}

function getOpportunitiesByUser(userId, status = null) {
  const db = getDatabase();

  let query = `
    SELECT
      o.*,
      m.contract_value_cents as mla_value,
      m.end_date as mla_end_date
    FROM opportunities o
    LEFT JOIN mlas m ON o.mla_id = m.id
    WHERE o.assigned_to = ?
  `;

  const params = [userId];

  if (status) {
    query += ' AND o.status = ?';
    params.push(status);
  }

  query += ' ORDER BY o.detected_at DESC';

  return db.prepare(query).all(...params);
}

function updateOpportunityStatus(opportunityId, status, userId, notes = null) {
  const db = getDatabase();

  db.prepare(`
    UPDATE opportunities
    SET status = ?, last_activity_at = datetime('now')
    WHERE id = ?
  `).run(status, opportunityId);

  // Log activity
  db.prepare(`
    INSERT INTO opportunity_activities (opportunity_id, user_id, activity_type, notes)
    VALUES (?, ?, 'status_changed', ?)
  `).run(opportunityId, userId, notes || `Status changed to ${status}`);
}

// ===== Telemetry Functions =====

function logTelemetryEvent(userId, eventType, eventData, pageUrl = null, sessionId = null) {
  const db = getDatabase();

  return db.prepare(`
    INSERT INTO telemetry_events (user_id, event_type, event_data, page_url, session_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    userId,
    eventType,
    typeof eventData === 'string' ? eventData : JSON.stringify(eventData),
    pageUrl,
    sessionId
  ).lastInsertRowid;
}

function getTelemetrySummary(userId = null, hours = 24) {
  const db = getDatabase();

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  let query = `
    SELECT
      event_type,
      COUNT(*) as count,
      MAX(created_at) as last_event
    FROM telemetry_events
    WHERE created_at >= ?
  `;

  const params = [since];

  if (userId) {
    query += ' AND user_id = ?';
    params.push(userId);
  }

  query += ' GROUP BY event_type ORDER BY count DESC';

  return db.prepare(query).all(...params);
}

// ===== Analytics Cache Functions =====

function getCachedAnalytics(cacheKey) {
  const db = getDatabase();

  const result = db.prepare(`
    SELECT cache_value
    FROM analytics_cache
    WHERE cache_key = ?
    AND expires_at > datetime('now')
  `).get(cacheKey);

  if (result) {
    return JSON.parse(result.cache_value);
  }

  return null;
}

function setCachedAnalytics(cacheKey, value, expiresInMinutes = 15) {
  const db = getDatabase();

  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO analytics_cache (cache_key, cache_value, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(cache_key)
    DO UPDATE SET
      cache_value = ?,
      expires_at = ?
  `).run(
    cacheKey,
    JSON.stringify(value),
    expiresAt,
    JSON.stringify(value),
    expiresAt
  );
}

// ===== User Functions =====

function getUserByEmail(email) {
  const db = getDatabase();
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getUserById(id) {
  const db = getDatabase();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function createOrUpdateUser(email, name, role = 'rep') {
  const db = getDatabase();

  const existing = getUserByEmail(email);

  if (existing) {
    db.prepare(`
      UPDATE users
      SET last_active = datetime('now'), name = ?
      WHERE email = ?
    `).run(name, email);
    return existing.id;
  } else {
    return db.prepare(`
      INSERT INTO users (email, name, role, last_active)
      VALUES (?, ?, ?, datetime('now'))
    `).run(email, name, role).lastInsertRowid;
  }
}

// ===== Commission Functions =====

function getCommissionsByUser(userId, status = null) {
  const db = getDatabase();

  let query = 'SELECT * FROM commissions WHERE user_id = ?';
  const params = [userId];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC';

  return db.prepare(query).all(...params);
}

function getCommissionsThisMonth(userId) {
  const db = getDatabase();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return db.prepare(`
    SELECT
      SUM(amount_cents) as total_cents,
      COUNT(*) as count
    FROM commissions
    WHERE user_id = ?
    AND created_at BETWEEN ? AND ?
  `).get(userId, monthStart.toISOString(), monthEnd.toISOString());
}

// ============================================
// RULES ENGINE & MLA MANAGEMENT FUNCTIONS
// ============================================

/**
 * Create or get MLA contract by contract number
 * @param {Object} data - {contractNumber, accountName, vendorName, effectiveDate, endDate, createdByUserId}
 * @returns {number} mla_id
 */
function createMLAContract(data) {
  const existing = db.prepare(`
    SELECT id FROM mla_contracts WHERE contract_number = ?
  `).get(data.contractNumber);

  if (existing) {
    console.log(`[MLA] Contract ${data.contractNumber} already exists (ID: ${existing.id})`);
    return existing.id;
  }

  const result = db.prepare(`
    INSERT INTO mla_contracts (
      contract_number, account_name, vendor_name,
      effective_date, end_date, created_by_user_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'active')
  `).run(
    data.contractNumber,
    data.accountName,
    data.vendorName || null,
    data.effectiveDate || new Date().toISOString().split('T')[0],
    data.endDate || null,
    data.createdByUserId
  );

  console.log(`[MLA] Created contract ${data.contractNumber} (ID: ${result.lastInsertRowid})`);
  return result.lastInsertRowid;
}

/**
 * Upsert MLA products (contract pricing) - BATCH OPTIMIZED
 * @param {number} mlaId
 * @param {Array} products - [{sku, description, priceCents, uom, minQty, maxQty}]
 */
function upsertMLAProducts(mlaId, products) {
  const stmt = db.prepare(`
    INSERT INTO mla_products (
      mla_id, sku, description, price_cents, uom, min_qty, max_qty, approved
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mla_id, sku) DO UPDATE SET
      description = excluded.description,
      price_cents = excluded.price_cents,
      uom = excluded.uom,
      min_qty = excluded.min_qty,
      max_qty = excluded.max_qty
  `);

  const insertMany = db.transaction((products) => {
    for (const product of products) {
      stmt.run(
        mlaId,
        product.sku,
        product.description || null,
        product.priceCents,
        product.uom || 'EA',
        product.minQty || null,
        product.maxQty || null,
        product.approved === false ? 0 : 1 // Convert boolean to 0/1
      );
    }
  });

  insertMany(products);
  console.log(`[MLA] Upserted ${products.length} products for MLA ID ${mlaId}`);
}

/**
 * List MLAs by account with product counts
 * @param {string} accountName
 * @returns {Array} MLAs with product counts
 */
function listMLAsByAccount(accountName) {
  return db.prepare(`
    SELECT
      m.*,
      COUNT(p.id) as product_count
    FROM mla_contracts m
    LEFT JOIN mla_products p ON m.id = p.mla_id AND p.approved = TRUE
    WHERE m.account_name LIKE ?
    GROUP BY m.id
    ORDER BY m.effective_date DESC
  `).all(`%${accountName}%`);
}

/**
 * Get MLA contract by number with all products
 * @param {string} contractNumber
 * @returns {Object|null} MLA with products array
 */
function getMLAByContractNumber(contractNumber) {
  const mla = db.prepare(`
    SELECT * FROM mla_contracts WHERE contract_number = ?
  `).get(contractNumber);

  if (!mla) return null;

  const products = db.prepare(`
    SELECT * FROM mla_products
    WHERE mla_id = ? AND approved = TRUE
    ORDER BY sku
  `).all(mla.id);

  return { ...mla, products };
}

/**
 * Get best MLA product price (most recent MLA, lowest price)
 * PERFORMANCE: Indexed query, sub-10ms response
 * @param {Object} params - {accountName, sku}
 * @returns {Object|null} {priceCents, mlaId, contractNumber, uom}
 */
function getMLAProductPrice({ accountName, sku }) {
  const result = db.prepare(`
    SELECT
      p.price_cents,
      p.uom,
      p.min_qty,
      p.max_qty,
      m.id as mla_id,
      m.contract_number,
      m.effective_date
    FROM mla_products p
    JOIN mla_contracts m ON p.mla_id = m.id
    WHERE m.account_name LIKE ?
      AND p.sku = ?
      AND p.approved = TRUE
      AND m.status = 'active'
    ORDER BY m.effective_date DESC, p.price_cents ASC
    LIMIT 1
  `).get(`%${accountName}%`, sku);

  return result;
}

/**
 * Create opportunity rule with triggers, conditions, and actions
 * EXPERT FEATURE: Full rule creation with validation
 * @param {Object} rule - Complete rule definition
 * @returns {number} rule_id
 */
function createRule(rule) {
  const ruleResult = db.prepare(`
    INSERT INTO opportunity_rules (
      account_name, industry, name, description,
      created_by_user_id, is_active, priority
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    rule.accountName || null,
    rule.industry || null,
    rule.name,
    rule.description || null,
    rule.createdByUserId,
    rule.isActive !== false, // Default true
    rule.priority || 100
  );

  const ruleId = ruleResult.lastInsertRowid;

  // Add triggers
  if (rule.triggers && rule.triggers.length > 0) {
    const triggerStmt = db.prepare(`
      INSERT INTO opportunity_rule_triggers (rule_id, trigger_sku)
      VALUES (?, ?)
    `);
    for (const sku of rule.triggers) {
      triggerStmt.run(ruleId, sku);
    }
  }

  // Add conditions
  if (rule.conditions && rule.conditions.length > 0) {
    const condStmt = db.prepare(`
      INSERT INTO opportunity_rule_conditions (
        rule_id, condition_group, left_operand_type, left_operand_value,
        operator, right_value, logic
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const cond of rule.conditions) {
      condStmt.run(
        ruleId,
        cond.group || 1,
        cond.leftOperandType,
        cond.leftOperandValue || null,
        cond.operator,
        cond.rightValue,
        cond.logic || 'AND'
      );
    }
  }

  // Add actions
  if (rule.actions && rule.actions.length > 0) {
    const actionStmt = db.prepare(`
      INSERT INTO opportunity_rule_actions (
        rule_id, action_type, recommended_sku, recommended_qty_target,
        recommended_qty_min, notes_talk_track, auto_create_opportunity
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const action of rule.actions) {
      actionStmt.run(
        ruleId,
        action.actionType,
        action.recommendedSku || null,
        action.recommendedQtyTarget || null,
        action.recommendedQtyMin || null,
        action.notesTalkTrack || null,
        action.autoCreateOpportunity !== false
      );
    }
  }

  console.log(`[RULES] Created rule "${rule.name}" (ID: ${ruleId})`);
  return ruleId;
}

/**
 * List rules with full details (triggers, conditions, actions)
 * @param {string|null} accountName - Filter by account or get all
 * @returns {Array} Enriched rules
 */
function listRulesByAccount(accountName) {
  const query = accountName
    ? `SELECT * FROM opportunity_rules WHERE (account_name = ? OR account_name IS NULL) ORDER BY priority, id`
    : `SELECT * FROM opportunity_rules ORDER BY priority, id`;

  const rules = accountName
    ? db.prepare(query).all(accountName)
    : db.prepare(query).all();

  // Enrich with triggers, conditions, actions
  for (const rule of rules) {
    rule.triggers = db.prepare(`
      SELECT trigger_sku FROM opportunity_rule_triggers WHERE rule_id = ?
    `).all(rule.id).map(r => r.trigger_sku);

    rule.conditions = db.prepare(`
      SELECT * FROM opportunity_rule_conditions WHERE rule_id = ? ORDER BY id
    `).all(rule.id);

    rule.actions = db.prepare(`
      SELECT * FROM opportunity_rule_actions WHERE rule_id = ? ORDER BY id
    `).all(rule.id);
  }

  return rules;
}

/**
 * Toggle rule active/inactive
 * @param {number} ruleId
 * @param {boolean} isActive
 */
function toggleRuleActive(ruleId, isActive) {
  db.prepare(`
    UPDATE opportunity_rules SET is_active = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(isActive ? 1 : 0, ruleId);
  console.log(`[RULES] Rule ${ruleId} set to ${isActive ? 'active' : 'inactive'}`);
}

/**
 * Update rule performance metrics
 * @param {number} ruleId
 * @param {Object} metrics - {timesFired, opportunitiesCreated, revenueGeneratedCents}
 */
function updateRulePerformance(ruleId, metrics) {
  db.prepare(`
    UPDATE opportunity_rules SET
      times_fired = times_fired + ?,
      opportunities_created = opportunities_created + ?,
      revenue_generated_cents = revenue_generated_cents + ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    metrics.timesFired || 0,
    metrics.opportunitiesCreated || 0,
    metrics.revenueGeneratedCents || 0,
    ruleId
  );
}

/**
 * CORE RULES ENGINE: Evaluate all active rules against invoice data
 * EXPERT ALGORITHM: Supports complex conditions, OR/AND logic, qty comparisons
 * @param {Object} params - {accountName, qtyBySku, invoiceTotal, runId}
 * @returns {Array} Fired rules with actions
 */
function evaluateRulesForInvoice({ accountName, qtyBySku, invoiceTotal, runId }) {
  const rules = listRulesByAccount(accountName);
  const firedRules = [];

  for (const rule of rules) {
    if (!rule.is_active) continue;

    // Check if any trigger SKU is present (or no triggers = always evaluate)
    const triggerPresent = rule.triggers.length === 0 ||
      rule.triggers.some(sku => qtyBySku[sku] !== undefined);

    if (!triggerPresent) continue;

    // Evaluate conditions
    let conditionsMet = true;
    const triggerValues = {};

    for (const condition of rule.conditions) {
      let leftValue;

      switch (condition.left_operand_type) {
        case 'invoice_qty':
          leftValue = qtyBySku[condition.left_operand_value] || 0;
          triggerValues[condition.left_operand_value] = leftValue;
          break;
        case 'invoice_total':
          leftValue = invoiceTotal || 0;
          break;
        case 'sku_present':
          leftValue = qtyBySku[condition.left_operand_value] ? 1 : 0;
          break;
        case 'sku_absent':
          leftValue = qtyBySku[condition.left_operand_value] ? 0 : 1;
          break;
        default:
          leftValue = 0;
      }

      const rightValue = parseFloat(condition.right_value);
      let met = false;

      switch (condition.operator) {
        case '>': met = leftValue > rightValue; break;
        case '<': met = leftValue < rightValue; break;
        case '>=': met = leftValue >= rightValue; break;
        case '<=': met = leftValue <= rightValue; break;
        case '==': met = leftValue === rightValue; break;
        case '!=': met = leftValue !== rightValue; break;
      }

      // AND logic (all must be true)
      if (!met && condition.logic === 'AND') {
        conditionsMet = false;
        break;
      }
    }

    if (!conditionsMet) continue;

    // Rule fired! Collect actions
    for (const action of rule.actions) {
      if (!action.auto_create_opportunity) continue;

      firedRules.push({
        ruleId: rule.id,
        ruleName: rule.name,
        action,
        triggerValues,
        accountName
      });

      // Log performance
      db.prepare(`
        INSERT INTO rule_performance_log (
          rule_id, account_name, trigger_values_json, invoice_run_id
        ) VALUES (?, ?, ?, ?)
      `).run(
        rule.id,
        accountName,
        JSON.stringify(triggerValues),
        runId || null
      );
    }
  }

  console.log(`[RULES] Evaluated ${rules.length} rules for ${accountName}, ${firedRules.length} fired`);
  return firedRules;
}

/**
 * Create contract-approved opportunity from rule fire
 * EXPERT FEATURES: Deduplication, explainability, commission calculation
 * @param {Object} params - Complete opportunity context
 * @returns {number|null} opportunity_id or null if dedupe
 */
function createOpportunityFromRule(params) {
  const {
    ruleId,
    ruleName,
    accountName,
    recommendedSku,
    triggerSku,
    triggerValues,
    contractPriceCents,
    estimatedValueCents,
    commissionRate,
    assignedUserId,
    runId,
    talkTrack
  } = params;

  // DEDUPLICATION: Check if open opportunity exists for same account + recommended SKU today
  const dedupeKey = `${accountName}:${recommendedSku}:${new Date().toISOString().split('T')[0]}`;
  const existing = db.prepare(`
    SELECT id FROM opportunities
    WHERE dedupe_key = ? AND status IN ('detected', 'contacted', 'in_progress')
  `).get(dedupeKey);

  if (existing) {
    console.log(`[OPPORTUNITY] Dedupe: opportunity already exists for ${accountName} / ${recommendedSku}`);
    return null;
  }

  const estimatedCommission = estimatedValueCents && commissionRate
    ? Math.floor(estimatedValueCents * commissionRate)
    : null;

  // EXPLAINABILITY: Track why this opportunity was created
  const explainability = {
    rule_id: ruleId,
    rule_name: ruleName,
    trigger_sku: triggerSku,
    trigger_values: triggerValues,
    recommended_sku: recommendedSku,
    contract_price_cents: contractPriceCents,
    confidence_score: 0.85, // High confidence for rule-based
    source: 'rules_engine',
    created_at: new Date().toISOString()
  };

  const result = db.prepare(`
    INSERT INTO opportunities (
      account_name, opportunity_type, status, assigned_to,
      source_type, rule_id, trigger_sku, recommended_sku,
      contract_price_cents, estimated_value_cents,
      commission_rate_used, estimated_commission_cents,
      explainability_json, confidence_score, talk_track,
      dedupe_key, source_run_id, urgency, likelihood_pct
    ) VALUES (?, 'contract_approved', 'detected', ?, 'rule', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'medium', 85)
  `).run(
    accountName,
    assignedUserId,
    ruleId,
    triggerSku || null,
    recommendedSku,
    contractPriceCents || null,
    estimatedValueCents || null,
    commissionRate || 0.05,
    estimatedCommission,
    JSON.stringify(explainability),
    0.85,
    talkTrack || null,
    dedupeKey,
    runId || null
  );

  // Update rule performance
  updateRulePerformance(ruleId, {
    timesFired: 1,
    opportunitiesCreated: 1,
    revenueGeneratedCents: 0 // Will update when won
  });

  console.log(`[OPPORTUNITY] Created contract-approved opportunity from rule "${ruleName}" (ID: ${result.lastInsertRowid})`);
  return result.lastInsertRowid;
}

// ===================================================================
// EMAIL INVOICE AUTOPILOT FUNCTIONS
// ===================================================================

/**
 * Create or update email monitor
 * @param {Object} data - Monitor configuration
 * @returns {number} Monitor ID
 */
function createEmailMonitor(data) {
  const CryptoJS = require('crypto-js');
  const ENCRYPTION_KEY = process.env.EMAIL_PASSWORD_KEY || 'revenue-radar-email-key-2026';

  // Encrypt password
  const encryptedPassword = CryptoJS.AES.encrypt(
    data.password,
    ENCRYPTION_KEY
  ).toString();

  const result = db.prepare(`
    INSERT INTO email_monitors (
      user_id, account_name, monitor_name, email_address, imap_host, imap_port,
      username, encrypted_password, industry, customer_type,
      check_interval_minutes, enable_cost_savings_detection,
      enable_duplicate_detection, enable_price_increase_alerts,
      enable_contract_validation, alert_email, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.createdByUserId,  // user_id (primary owner)
    data.accountName,
    data.monitorName || null,
    data.emailAddress,
    data.imapHost || 'imap.gmail.com',
    data.imapPort || 993,
    data.username || data.emailAddress,
    encryptedPassword,
    data.industry || null,
    data.customerType || 'business',
    data.checkIntervalMinutes || 5,
    data.enableCostSavingsDetection !== false ? 1 : 0,
    data.enableDuplicateDetection !== false ? 1 : 0,
    data.enablePriceIncreaseAlerts !== false ? 1 : 0,
    data.enableContractValidation || 0,
    data.alertEmail || null,
    data.createdByUserId  // created_by_user_id (for audit trail)
  );

  console.log(`[EMAIL MONITOR] Created monitor for ${data.emailAddress} (ID: ${result.lastInsertRowid})`);
  return result.lastInsertRowid;
}

/**
 * Get all active email monitors
 * @returns {Array} Active monitors
 */
function getActiveEmailMonitors() {
  const database = getDatabase();
  const monitors = database.prepare(`
    SELECT * FROM email_monitors
    WHERE is_active = 1
    ORDER BY id
  `).all();

  return monitors;
}

/**
 * Get email monitor by ID (with decrypted password)
 * @param {number} monitorId
 * @returns {Object|null} Monitor with decrypted password
 */
function getEmailMonitorById(monitorId) {
  const database = getDatabase();
  const CryptoJS = require('crypto-js');
  const ENCRYPTION_KEY = process.env.EMAIL_PASSWORD_KEY || 'revenue-radar-email-key-2026';

  const monitor = database.prepare(`
    SELECT * FROM email_monitors WHERE id = ?
  `).get(monitorId);

  if (!monitor) return null;

  // Decrypt password
  try {
    const bytes = CryptoJS.AES.decrypt(monitor.encrypted_password, ENCRYPTION_KEY);
    monitor.password = bytes.toString(CryptoJS.enc.Utf8);
    delete monitor.encrypted_password;
  } catch (error) {
    console.error('[EMAIL MONITOR] Failed to decrypt password:', error);
    monitor.password = null;
  }

  return monitor;
}

/**
 * Get monitors by account
 * @param {string} accountName
 * @returns {Array} Monitors (without passwords)
 */
function getEmailMonitorsByAccount(accountName) {
  const database = getDatabase();
  const monitors = database.prepare(`
    SELECT
      id, account_name, monitor_name, email_address, imap_host,
      is_active, check_interval_minutes, industry, customer_type,
      last_check_at, total_invoices_found, total_opportunities_detected,
      total_savings_detected_cents, created_at
    FROM email_monitors
    WHERE account_name = ?
    ORDER BY created_at DESC
  `).all(accountName);

  return monitors;
}

/**
 * Update monitor last check time
 * @param {number} monitorId
 */
function updateEmailMonitorLastCheck(monitorId, success = true) {
  const database = getDatabase();
  database.prepare(`
    UPDATE email_monitors
    SET
      last_check_at = CURRENT_TIMESTAMP,
      last_successful_check = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_successful_check END
    WHERE id = ?
  `).run(success ? 1 : 0, monitorId);
}

/**
 * Update monitor statistics
 * @param {number} monitorId
 * @param {Object} stats - {emailsProcessed, invoicesFound, opportunitiesDetected, savingsCents}
 */
function updateEmailMonitorStats(monitorId, stats) {
  const database = getDatabase();
  database.prepare(`
    UPDATE email_monitors
    SET
      total_emails_processed = total_emails_processed + ?,
      total_invoices_found = total_invoices_found + ?,
      total_opportunities_detected = total_opportunities_detected + ?,
      total_savings_detected_cents = total_savings_detected_cents + ?
    WHERE id = ?
  `).run(
    stats.emailsProcessed || 0,
    stats.invoicesFound || 0,
    stats.opportunitiesDetected || 0,
    stats.savingsCents || 0,
    monitorId
  );
}

/**
 * Toggle monitor active status
 * @param {number} monitorId
 * @param {boolean} isActive
 */
function toggleEmailMonitor(monitorId, isActive) {
  const database = getDatabase();
  database.prepare(`
    UPDATE email_monitors SET is_active = ? WHERE id = ?
  `).run(isActive ? 1 : 0, monitorId);

  console.log(`[EMAIL MONITOR] ${isActive ? 'Enabled' : 'Disabled'} monitor ID ${monitorId}`);
}

/**
 * Add email to processing queue
 * @param {Object} data - Email metadata
 * @returns {number} Queue ID
 */
function addEmailToQueue(data) {
  const database = getDatabase();
  const result = database.prepare(`
    INSERT INTO email_invoice_queue (
      monitor_id, email_uid, sender_email, sender_name, subject,
      received_at, attachment_count, attachment_filenames
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.monitorId,
    data.emailUid,
    data.senderEmail || null,
    data.senderName || null,
    data.subject || null,
    data.receivedAt || new Date().toISOString(),
    data.attachmentCount || 0,
    JSON.stringify(data.attachmentFilenames || [])
  );

  return result.lastInsertRowid;
}

/**
 * Update email queue item status
 * @param {number} queueId
 * @param {Object} updates
 */
function updateEmailQueueItem(queueId, updates) {
  const database = getDatabase();
  const fields = [];
  const values = [];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.ingestionRunId !== undefined) {
    fields.push('ingestion_run_id = ?');
    values.push(updates.ingestionRunId);
  }
  if (updates.opportunitiesDetected !== undefined) {
    fields.push('opportunities_detected = ?');
    values.push(updates.opportunitiesDetected);
  }
  if (updates.savingsDetectedCents !== undefined) {
    fields.push('savings_detected_cents = ?');
    values.push(updates.savingsDetectedCents);
  }
  if (updates.errorMessage !== undefined) {
    fields.push('error_message = ?');
    values.push(updates.errorMessage);
  }
  if (updates.skippedReason !== undefined) {
    fields.push('skipped_reason = ?');
    values.push(updates.skippedReason);
  }

  fields.push('processed_at = CURRENT_TIMESTAMP');
  values.push(queueId);

  database.prepare(`
    UPDATE email_invoice_queue
    SET ${fields.join(', ')}
    WHERE id = ?
  `).run(...values);
}

/**
 * Get recent email queue items
 * @param {number} monitorId - Optional monitor filter
 * @param {number} limit
 * @returns {Array} Recent emails
 */
function getRecentEmailQueue(monitorId = null, limit = 50) {
  const database = getDatabase();
  if (monitorId) {
    return database.prepare(`
      SELECT * FROM email_invoice_queue
      WHERE monitor_id = ?
      ORDER BY received_at DESC
      LIMIT ?
    `).all(monitorId, limit);
  } else {
    return database.prepare(`
      SELECT eq.*, em.account_name, em.email_address
      FROM email_invoice_queue eq
      JOIN email_monitors em ON eq.monitor_id = em.id
      ORDER BY eq.received_at DESC
      LIMIT ?
    `).all(limit);
  }
}

/**
 * Record detected cost savings
 * @param {Object} data - Savings details
 * @returns {number} Savings ID
 */
function recordDetectedSavings(data) {
  const database = getDatabase();
  const result = database.prepare(`
    INSERT INTO detected_savings (
      monitor_id, ingestion_run_id, invoice_date, vendor_name,
      savings_type, description, amount_charged_cents, correct_amount_cents,
      savings_amount_cents, sku, quantity, unit_price_cents, expected_price_cents,
      evidence_json, severity, alerted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.monitorId,
    data.ingestionRunId,
    data.invoiceDate || new Date().toISOString().split('T')[0],
    data.vendorName || null,
    data.savingsType,
    data.description,
    data.amountChargedCents || null,
    data.correctAmountCents || null,
    data.savingsAmountCents,
    data.sku || null,
    data.quantity || null,
    data.unitPriceCents || null,
    data.expectedPriceCents || null,
    JSON.stringify(data.evidence || {}),
    data.severity || 'medium',
    data.alerted || 0
  );

  console.log(`[SAVINGS] Detected ${data.savingsType}: $${(data.savingsAmountCents / 100).toFixed(2)} for ${data.vendorName || 'unknown vendor'}`);
  return result.lastInsertRowid;
}

/**
 * Get detected savings summary
 * @param {number} monitorId - Optional monitor filter
 * @param {number} days - Days to look back
 * @returns {Object} Summary statistics
 */
function getDetectedSavingsSummary(monitorId = null, days = 30) {
  const database = getDatabase();
  const whereClause = monitorId ? 'WHERE monitor_id = ? AND' : 'WHERE';
  const params = monitorId ? [monitorId] : [];

  const summary = database.prepare(`
    SELECT
      COUNT(*) as total_findings,
      SUM(savings_amount_cents) as total_savings_cents,
      COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_count,
      COUNT(CASE WHEN severity = 'high' THEN 1 END) as high_count,
      COUNT(CASE WHEN status = 'detected' THEN 1 END) as unreviewed_count
    FROM detected_savings
    ${whereClause} detected_at >= datetime('now', '-${days} days')
  `).get(...params);

  const byType = database.prepare(`
    SELECT
      savings_type,
      COUNT(*) as count,
      SUM(savings_amount_cents) as total_cents
    FROM detected_savings
    ${whereClause} detected_at >= datetime('now', '-${days} days')
    GROUP BY savings_type
    ORDER BY total_cents DESC
  `).all(...params);

  return {
    ...summary,
    byType
  };
}

/**
 * Log activity for real-time feed
 * @param {number} monitorId
 * @param {string} activityType
 * @param {string} message
 * @param {string} severity
 * @param {Object} metadata
 */
function logEmailActivity(monitorId, activityType, message, severity = 'info', metadata = {}) {
  const database = getDatabase();
  database.prepare(`
    INSERT INTO email_monitor_activity (
      monitor_id, activity_type, message, severity, metadata_json
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    monitorId,
    activityType,
    message,
    severity,
    JSON.stringify(metadata)
  );
}

/**
 * Get recent activity feed
 * @param {number} monitorId - Optional filter
 * @param {number} limit
 * @returns {Array} Recent activities
 */
function getRecentEmailActivity(monitorId = null, limit = 100) {
  const database = getDatabase();
  if (monitorId) {
    return database.prepare(`
      SELECT * FROM email_monitor_activity
      WHERE monitor_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(monitorId, limit);
  } else {
    return database.prepare(`
      SELECT ea.*, em.account_name, em.email_address
      FROM email_monitor_activity ea
      JOIN email_monitors em ON ea.monitor_id = em.id
      ORDER BY ea.created_at DESC
      LIMIT ?
    `).all(limit);
  }
}

/**
 * Track or update vendor
 * @param {number} monitorId
 * @param {string} vendorName
 * @param {Object} data - {vendorEmail, invoiceAmountCents, skus}
 */
function trackVendor(monitorId, vendorName, data) {
  const database = getDatabase();
  const existing = database.prepare(`
    SELECT * FROM auto_detected_vendors
    WHERE monitor_id = ? AND vendor_name = ?
  `).get(monitorId, vendorName);

  if (existing) {
    // Update existing vendor
    database.prepare(`
      UPDATE auto_detected_vendors
      SET
        last_seen_at = CURRENT_TIMESTAMP,
        invoice_count = invoice_count + 1,
        total_spend_cents = total_spend_cents + ?,
        avg_invoice_amount_cents = (total_spend_cents + ?) / (invoice_count + 1)
      WHERE id = ?
    `).run(data.invoiceAmountCents || 0, data.invoiceAmountCents || 0, existing.id);
  } else {
    // Create new vendor
    database.prepare(`
      INSERT INTO auto_detected_vendors (
        monitor_id, vendor_name, vendor_email, invoice_count,
        total_spend_cents, avg_invoice_amount_cents
      ) VALUES (?, ?, ?, 1, ?, ?)
    `).run(
      monitorId,
      vendorName,
      data.vendorEmail || null,
      data.invoiceAmountCents || 0,
      data.invoiceAmountCents || 0
    );
  }
}

// =====================================================
// EMAIL MONITOR HELPER FUNCTIONS (NEW SCHEMA)
// =====================================================

function getEmailMonitor(monitorId) {
  const database = getDatabase();
  return database.prepare('SELECT * FROM email_monitors WHERE id = ?').get(monitorId);
}

function updateEmailMonitorLastChecked(monitorId, timestamp) {
  const database = getDatabase();
  database.prepare(`
    UPDATE email_monitors
    SET last_checked_at = ?, last_success_at = ?
    WHERE id = ?
  `).run(timestamp, timestamp, monitorId);
}

function updateEmailMonitorError(monitorId, errorMessage) {
  const database = getDatabase();
  database.prepare(`
    UPDATE email_monitors
    SET last_error = ?, last_checked_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(errorMessage, monitorId);
}

function isEmailAlreadyProcessed(monitorId, emailUid) {
  const database = getDatabase();
  const exists = database.prepare(`
    SELECT id FROM email_processing_log
    WHERE monitor_id = ? AND email_uid = ?
  `).get(monitorId, emailUid);
  return !!exists;
}

function logEmailProcessing(data) {
  const database = getDatabase();
  // Ensure skip_reason column exists (migration)
  try {
    const columns = database.prepare(`PRAGMA table_info(email_processing_log)`).all();
    const hasSkipReason = columns.some(c => c.name === 'skip_reason');
    if (!hasSkipReason) {
      database.exec(`ALTER TABLE email_processing_log ADD COLUMN skip_reason TEXT`);
      console.log('[DB] Added skip_reason column to email_processing_log');
    }
  } catch (e) {
    // Column might already exist or table doesn't exist yet
  }

  database.prepare(`
    INSERT INTO email_processing_log (
      monitor_id, email_uid, email_subject, from_address, received_date,
      status, attachments_count, invoices_created, invoice_ids,
      processing_time_ms, error_message, skip_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.monitorId,
    data.emailUid,
    data.subject,
    data.fromAddress,
    data.receivedDate,
    data.status,
    data.attachmentsCount || 0,
    data.invoicesCreated || 0,
    Array.isArray(data.invoiceIds) ? JSON.stringify(data.invoiceIds) : (data.invoiceIds || null),
    data.processingTimeMs || 0,
    data.errorMessage || null,
    data.skipReason || null
  );
}

function incrementEmailMonitorStats(monitorId, invoicesCreated) {
  const database = getDatabase();
  database.prepare(`
    UPDATE email_monitors
    SET
      emails_processed_count = emails_processed_count + 1,
      invoices_created_count = invoices_created_count + ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(invoicesCreated, monitorId);
}

// =====================================================
// SUBSCRIPTION & PAYMENT FUNCTIONS
// =====================================================

/**
 * Create a new subscription
 * @param {Object} data - Subscription data
 * @returns {number} Subscription ID
 */
function createSubscription(data) {
  const result = db.prepare(`
    INSERT INTO subscriptions (
      user_id, stripe_customer_id, stripe_subscription_id,
      plan_id, plan_name, status,
      current_period_start, current_period_end,
      trial_end, quantity, amount_cents, currency, interval,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.userId,
    data.stripeCustomerId,
    data.stripeSubscriptionId,
    data.planId,
    data.planName,
    data.status || 'active',
    data.currentPeriodStart,
    data.currentPeriodEnd,
    data.trialEnd || null,
    data.quantity || 1,
    data.amountCents,
    data.currency || 'usd',
    data.interval || 'month',
    JSON.stringify(data.metadata || {})
  );

  // Update user's subscription status
  db.prepare(`
    UPDATE users
    SET subscription_status = ?, is_trial = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(data.status || 'active', data.userId);

  console.log(`[SUBSCRIPTION] Created subscription for user ${data.userId}: ${data.planName}`);
  return result.lastInsertRowid;
}

/**
 * Get subscription by user ID
 * @param {number} userId
 * @returns {Object|null} Subscription
 */
function getSubscriptionByUserId(userId) {
  return db.prepare(`
    SELECT * FROM subscriptions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId);
}

/**
 * Get subscription by Stripe subscription ID
 * @param {string} stripeSubscriptionId
 * @returns {Object|null} Subscription
 */
function getSubscriptionByStripeId(stripeSubscriptionId) {
  return db.prepare(`
    SELECT * FROM subscriptions
    WHERE stripe_subscription_id = ?
  `).get(stripeSubscriptionId);
}

/**
 * Update subscription
 * @param {string} stripeSubscriptionId
 * @param {Object} updates
 */
function updateSubscription(stripeSubscriptionId, updates) {
  const fields = [];
  const values = [];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.currentPeriodStart !== undefined) {
    fields.push('current_period_start = ?');
    values.push(updates.currentPeriodStart);
  }
  if (updates.currentPeriodEnd !== undefined) {
    fields.push('current_period_end = ?');
    values.push(updates.currentPeriodEnd);
  }
  if (updates.cancelAtPeriodEnd !== undefined) {
    fields.push('cancel_at_period_end = ?');
    values.push(updates.cancelAtPeriodEnd ? 1 : 0);
  }
  if (updates.canceledAt !== undefined) {
    fields.push('canceled_at = ?');
    values.push(updates.canceledAt);
  }
  if (updates.quantity !== undefined) {
    fields.push('quantity = ?');
    values.push(updates.quantity);
  }
  if (updates.amountCents !== undefined) {
    fields.push('amount_cents = ?');
    values.push(updates.amountCents);
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(stripeSubscriptionId);

  db.prepare(`
    UPDATE subscriptions
    SET ${fields.join(', ')}
    WHERE stripe_subscription_id = ?
  `).run(...values);

  // Update user's subscription status if changed
  if (updates.status) {
    const sub = getSubscriptionByStripeId(stripeSubscriptionId);
    if (sub) {
      db.prepare(`
        UPDATE users
        SET subscription_status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(updates.status, sub.user_id);
    }
  }
}

/**
 * Cancel subscription
 * @param {string} stripeSubscriptionId
 * @param {boolean} immediate - Cancel immediately or at period end
 */
function cancelSubscription(stripeSubscriptionId, immediate = false) {
  const updates = {
    canceledAt: new Date().toISOString(),
    status: immediate ? 'canceled' : undefined,
    cancelAtPeriodEnd: !immediate
  };

  updateSubscription(stripeSubscriptionId, updates);
  console.log(`[SUBSCRIPTION] Subscription ${stripeSubscriptionId} canceled (immediate: ${immediate})`);
}

/**
 * Record a payment
 * @param {Object} data - Payment data
 * @returns {number} Payment ID
 */
function recordPayment(data) {
  const result = db.prepare(`
    INSERT INTO payment_history (
      user_id, subscription_id, stripe_payment_intent_id, stripe_invoice_id,
      amount_cents, currency, status, description, receipt_url, failure_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.userId,
    data.subscriptionId || null,
    data.stripePaymentIntentId,
    data.stripeInvoiceId || null,
    data.amountCents,
    data.currency || 'usd',
    data.status || 'succeeded',
    data.description || null,
    data.receiptUrl || null,
    data.failureReason || null
  );

  console.log(`[PAYMENT] Recorded payment of $${(data.amountCents / 100).toFixed(2)} for user ${data.userId}`);
  return result.lastInsertRowid;
}

/**
 * Get payment history for a user
 * @param {number} userId
 * @param {number} limit
 * @returns {Array} Payment history
 */
function getPaymentHistory(userId, limit = 20) {
  return db.prepare(`
    SELECT * FROM payment_history
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit);
}

/**
 * Update user subscription status directly
 * @param {number} userId
 * @param {string} status - trial, active, expired, cancelled
 */
function updateUserSubscriptionStatus(userId, status) {
  db.prepare(`
    UPDATE users
    SET subscription_status = ?, is_trial = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, status === 'trial' ? 1 : 0, userId);
}

// =====================================================
// DATABASE IDENTITY HELPER (for debugging DB path issues)
// =====================================================

/**
 * Get comprehensive database identity information for debugging
 * Helps identify DB path mismatches between processes/environments
 * @returns {Object} Database identity information
 */
function getDbIdentity() {
  const crypto = require('crypto');

  // Resolve the actual DB path being used
  const dbPathResolved = path.resolve(DB_PATH);
  const fileExists = fs.existsSync(dbPathResolved);
  let fileSize = 0;
  let fileModified = null;

  if (fileExists) {
    try {
      const stats = fs.statSync(dbPathResolved);
      fileSize = stats.size;
      fileModified = stats.mtime.toISOString();
    } catch (e) {
      // Ignore stat errors
    }
  }

  // Get SQLite PRAGMA info
  let databaseList = [];
  let journalMode = 'unknown';
  let walMode = false;

  try {
    if (db) {
      databaseList = db.prepare('PRAGMA database_list').all();
      const journalResult = db.prepare('PRAGMA journal_mode').get();
      journalMode = journalResult?.journal_mode || 'unknown';
      walMode = journalMode === 'wal';
    }
  } catch (e) {
    // DB not initialized yet
  }

  // Create a stable hash for this DB path (for comparison across processes)
  const pathHash = crypto.createHash('sha1').update(dbPathResolved).digest('hex').substring(0, 12);

  // Check if /data directory exists (critical for production persistent storage)
  const dataDirectoryExists = fs.existsSync('/data');
  let dataDirectoryWritable = false;
  if (dataDirectoryExists) {
    try {
      fs.accessSync('/data', fs.constants.W_OK);
      dataDirectoryWritable = true;
    } catch (e) {
      dataDirectoryWritable = false;
    }
  }

  return {
    // Path information
    dbPathResolved,
    dbPathEnvVar: process.env.DB_PATH || process.env.DATABASE_PATH || '(not set - using default)',
    dbPathSource: process.env.DB_PATH ? 'DB_PATH' : (process.env.DATABASE_PATH ? 'DATABASE_PATH' : 'default'),
    pathHash,

    // File information
    fileExists,
    fileSizeBytes: fileSize,
    fileSizeHuman: fileSize > 1024*1024 ? `${(fileSize/(1024*1024)).toFixed(2)} MB` : `${(fileSize/1024).toFixed(2)} KB`,
    fileModified,

    // Production storage check
    dataDirectoryExists,
    dataDirectoryWritable,
    isPersistentStorage: dbPathResolved.startsWith('/data/'),

    // SQLite information
    databaseList,
    journalMode,
    walMode,

    // Process information
    processId: process.pid,
    nodeEnv: process.env.NODE_ENV || 'development',
    cwd: process.cwd(),

    // Timestamp
    checkedAt: new Date().toISOString()
  };
}

/**
 * Get raw database state for debugging
 * @returns {Object} Database state including counts and recent records
 */
function getDbState() {
  if (!db) {
    return { error: 'Database not initialized' };
  }

  try {
    // Get counts
    const monitorCount = db.prepare('SELECT COUNT(*) as count FROM email_monitors').get()?.count || 0;
    const ingestionRunCount = db.prepare('SELECT COUNT(*) as count FROM ingestion_runs').get()?.count || 0;
    const processingLogCount = db.prepare('SELECT COUNT(*) as count FROM email_processing_log').get()?.count || 0;

    // Get recent monitors
    const recentMonitors = db.prepare(`
      SELECT id, email_address, user_id, is_active, invoices_created_count,
             emails_processed_count, last_checked_at, last_error
      FROM email_monitors
      ORDER BY id DESC
      LIMIT 10
    `).all();

    // Get recent ingestion runs
    const recentRuns = db.prepare(`
      SELECT id, run_id, user_id, vendor_name, file_name, status,
             invoice_total_cents, created_at
      FROM ingestion_runs
      ORDER BY id DESC
      LIMIT 10
    `).all();

    // Get recent processing log entries
    let recentProcessing = [];
    try {
      recentProcessing = db.prepare(`
        SELECT id, monitor_id, email_uid, status, skip_reason,
               invoices_created, error_message
        FROM email_processing_log
        ORDER BY id DESC
        LIMIT 10
      `).all();
    } catch (e) {
      recentProcessing = [{ error: e.message }];
    }

    return {
      dbIdentity: getDbIdentity(),
      counts: {
        monitors: monitorCount,
        ingestionRuns: ingestionRunCount,
        processingLog: processingLogCount
      },
      recentMonitors,
      recentRuns,
      recentProcessing
    };
  } catch (error) {
    return { error: error.message };
  }
}

module.exports = {
  initDatabase,
  getDatabase,
  seedDemoData,

  // Database identity/debugging functions
  getDbIdentity,
  getDbState,

  // SPIF functions
  getActiveSPIFs,
  getSPIFLeaderboard,
  incrementSPIFMetric,
  recalculateSPIFRanks,

  // MLA functions
  recordMLAReview,
  getMLAsByStatus,
  getMLAReviewsThisWeek,

  // Opportunity functions
  createOpportunity,
  getOpportunitiesByUser,
  updateOpportunityStatus,

  // Telemetry functions
  logTelemetryEvent,
  getTelemetrySummary,

  // Analytics cache
  getCachedAnalytics,
  setCachedAnalytics,

  // User functions
  getUserByEmail,
  getUserById,
  createOrUpdateUser,

  // Commission functions
  getCommissionsByUser,
  getCommissionsThisMonth,

  // Rules Engine functions
  createMLAContract,
  upsertMLAProducts,
  listMLAsByAccount,
  getMLAByContractNumber,
  getMLAProductPrice,
  createRule,
  listRulesByAccount,
  toggleRuleActive,
  updateRulePerformance,
  evaluateRulesForInvoice,
  createOpportunityFromRule,

  // Email Autopilot functions
  createEmailMonitor,
  getActiveEmailMonitors,
  getEmailMonitorById,
  getEmailMonitorsByAccount,
  updateEmailMonitorLastCheck,
  updateEmailMonitorStats,
  toggleEmailMonitor,
  addEmailToQueue,
  updateEmailQueueItem,
  getRecentEmailQueue,
  recordDetectedSavings,
  getDetectedSavingsSummary,
  logEmailActivity,
  getRecentEmailActivity,
  trackVendor,

  // Email Monitor helpers (new schema)
  getEmailMonitor,
  updateEmailMonitorLastChecked,
  updateEmailMonitorError,
  isEmailAlreadyProcessed,
  logEmailProcessing,
  incrementEmailMonitorStats,

  // Subscription & Payment functions
  createSubscription,
  getSubscriptionByUserId,
  getSubscriptionByStripeId,
  updateSubscription,
  cancelSubscription,
  recordPayment,
  getPaymentHistory,
  updateUserSubscriptionStatus
};
