// =====================================================
// INTENT SIGNAL SERVICE
// Background service for monitoring and generating intent signals
// =====================================================

const DemoIntentAdapter = require('./intent-signal-demo-adapter');
const ApolloIntentAdapter = require('./intent-signal-apollo-adapter');

class IntentSignalService {
  constructor(db) {
    this.db = db;
    this.adapters = new Map();
    this.syncIntervals = new Map();
    this.isRunning = false;

    // Register available adapters
    this.registerAdapter('demo', new DemoIntentAdapter());

    // Register Apollo adapter if API key is available
    const apolloApiKey = process.env.APOLLO_API_KEY;
    if (apolloApiKey) {
      const apolloAdapter = new ApolloIntentAdapter(apolloApiKey);
      this.registerAdapter('apollo', apolloAdapter);
      console.log('✅ Apollo.io adapter configured with API key');

      // Test Apollo connection on startup
      apolloAdapter.testConnection().then(result => {
        if (result.success) {
          console.log('✅ Apollo.io API connection verified');
        } else {
          console.warn('⚠️  Apollo.io API connection failed:', result.message);
        }
      }).catch(err => {
        console.warn('⚠️  Apollo.io API test failed:', err.message);
      });
    } else {
      console.log('ℹ️  Apollo.io adapter not configured (set APOLLO_API_KEY to enable)');
    }
  }

  /**
   * Register a data source adapter
   */
  registerAdapter(name, adapter) {
    this.adapters.set(name, adapter);
    console.log(`📡 Intent Signal adapter registered: ${name}`);
  }

  /**
   * Get the best available adapter
   * Prefers Apollo (real data) over demo
   */
  getPreferredAdapter(preferredSource = null) {
    // If a specific source is requested and available, use it
    if (preferredSource && this.adapters.has(preferredSource)) {
      return { name: preferredSource, adapter: this.adapters.get(preferredSource) };
    }

    // Prefer Apollo if configured
    if (this.adapters.has('apollo')) {
      return { name: 'apollo', adapter: this.adapters.get('apollo') };
    }

    // Fall back to demo
    if (this.adapters.has('demo')) {
      return { name: 'demo', adapter: this.adapters.get('demo') };
    }

    return null;
  }

  /**
   * Start the service - begins monitoring all active configs
   */
  async startAll() {
    if (this.isRunning) {
      console.log('⚠️  Intent Signal Service already running');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Intent Signal Service starting...');

    try {
      // Load all active configurations
      const configs = this.db.prepare(`
        SELECT * FROM intent_signal_configs WHERE is_active = 1
      `).all();

      console.log(`📡 Found ${configs.length} active intent signal configurations`);

      // Start sync for each config
      for (const config of configs) {
        this.startConfigSync(config);
      }

      // Start the expiration checker (runs every 15 minutes)
      this.expirationInterval = setInterval(() => {
        this.expireStaleSignals();
      }, 15 * 60 * 1000);

      // Run initial expiration check
      this.expireStaleSignals();

      console.log('✅ Intent Signal Service started successfully');
    } catch (error) {
      console.error('❌ Failed to start Intent Signal Service:', error);
      this.isRunning = false;
    }
  }

  /**
   * Stop the service
   */
  stop() {
    console.log('🛑 Stopping Intent Signal Service...');

    // Clear all sync intervals
    for (const [configId, interval] of this.syncIntervals) {
      clearInterval(interval);
    }
    this.syncIntervals.clear();

    // Clear expiration interval
    if (this.expirationInterval) {
      clearInterval(this.expirationInterval);
    }

    this.isRunning = false;
    console.log('✅ Intent Signal Service stopped');
  }

  /**
   * Start syncing for a specific config
   */
  startConfigSync(config) {
    const configId = config.id;
    const intervalMinutes = config.check_frequency_minutes || 30;

    // Clear existing interval if any
    if (this.syncIntervals.has(configId)) {
      clearInterval(this.syncIntervals.get(configId));
    }

    console.log(`📡 Starting sync for config ${configId} (${config.config_name}) every ${intervalMinutes} minutes`);

    // Run initial sync
    this.syncConfig(configId).catch(err => {
      console.error(`Error in initial sync for config ${configId}:`, err);
    });

    // Set up recurring sync
    const interval = setInterval(() => {
      this.syncConfig(configId).catch(err => {
        console.error(`Error in sync for config ${configId}:`, err);
      });
    }, intervalMinutes * 60 * 1000);

    this.syncIntervals.set(configId, interval);
  }

  /**
   * Stop syncing for a specific config
   */
  stopConfigSync(configId) {
    if (this.syncIntervals.has(configId)) {
      clearInterval(this.syncIntervals.get(configId));
      this.syncIntervals.delete(configId);
      console.log(`🛑 Stopped sync for config ${configId}`);
    }
  }

  /**
   * Sync signals for a specific configuration
   */
  async syncConfig(configId) {
    const startTime = Date.now();

    try {
      // Get the config
      const config = this.db.prepare(`
        SELECT * FROM intent_signal_configs WHERE id = ?
      `).get(configId);

      if (!config || !config.is_active) {
        console.log(`⚠️  Config ${configId} not found or inactive, skipping sync`);
        return;
      }

      const keywords = JSON.parse(config.keywords || '[]');
      const zipCodes = JSON.parse(config.zip_codes || '[]');

      if (keywords.length === 0 || zipCodes.length === 0) {
        console.log(`⚠️  Config ${configId} has no keywords or zip codes, skipping`);
        return;
      }

      // Get the preferred adapter (Apollo if available, otherwise demo)
      const { name: adapterName, adapter } = this.getPreferredAdapter(config.data_source) || {};
      if (!adapter) {
        console.error('❌ No adapter available for intent signals');
        return;
      }

      console.log(`📡 Config ${configId}: Using ${adapterName} adapter`);

      // Generate signals
      const filters = {
        company_size_min: config.company_size_min,
        company_size_max: config.company_size_max
      };

      // Generate signals - more for demo, fewer for real APIs to conserve credits
      const signalCount = adapterName === 'demo'
        ? Math.floor(Math.random() * 4) + 2  // 2-5 for demo
        : Math.min(10, config.max_results_per_sync || 10); // Up to 10 for Apollo

      let signals = [];
      let errorMessage = null;

      try {
        signals = await adapter.generateSignals(keywords, zipCodes, signalCount, filters);
      } catch (adapterError) {
        console.error(`❌ Adapter ${adapterName} failed:`, adapterError.message);
        errorMessage = adapterError.message;

        // Fall back to demo if Apollo fails
        if (adapterName === 'apollo' && this.adapters.has('demo')) {
          console.log('⚠️  Falling back to demo adapter');
          const demoAdapter = this.adapters.get('demo');
          signals = await demoAdapter.generateSignals(keywords, zipCodes, signalCount, filters);
        }
      }

      // Store signals in database
      let newCount = 0;
      const insertStmt = this.db.prepare(`
        INSERT INTO intent_signal_matches (
          user_id, config_id, company_name, company_address, company_city,
          company_state, company_zip, company_phone, company_website,
          company_industry, company_employee_count, company_revenue_cents,
          matched_keyword, keyword_match_strength, search_context,
          intent_source, intent_category, overall_score, recency_score,
          fit_score, engagement_score, priority, signal_detected_at,
          freshness_hours, expires_at, contact_name, contact_title,
          contact_email, contact_phone, decision_maker_likelihood, status
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `);

      for (const signal of signals) {
        try {
          insertStmt.run(
            config.user_id,
            configId,
            signal.company_name,
            signal.company_address,
            signal.company_city,
            signal.company_state,
            signal.company_zip,
            signal.company_phone,
            signal.company_website,
            signal.company_industry,
            signal.company_employee_count,
            signal.company_revenue_cents,
            signal.matched_keyword,
            signal.keyword_match_strength,
            signal.search_context,
            signal.intent_source || adapterName,
            signal.intent_category,
            signal.overall_score,
            signal.recency_score,
            signal.fit_score,
            signal.engagement_score,
            signal.priority,
            signal.signal_detected_at,
            signal.freshness_hours,
            signal.expires_at,
            signal.contact_name,
            signal.contact_title,
            signal.contact_email,
            signal.contact_phone,
            signal.decision_maker_likelihood,
            'new'
          );
          newCount++;
        } catch (insertError) {
          // Might be duplicate, skip
          if (!insertError.message.includes('UNIQUE')) {
            console.error('Error inserting signal:', insertError);
          }
        }
      }

      // Update config stats
      const duration = Date.now() - startTime;
      this.db.prepare(`
        UPDATE intent_signal_configs
        SET last_check_at = datetime('now'),
            last_match_at = CASE WHEN ? > 0 THEN datetime('now') ELSE last_match_at END,
            total_matches = total_matches + ?
        WHERE id = ?
      `).run(newCount, newCount, configId);

      // Log sync
      this.db.prepare(`
        INSERT INTO intent_sync_log (source_id, config_id, sync_type, status, records_fetched, records_matched, records_new, duration_ms, error_message, completed_at)
        SELECT id, ?, 'scheduled', ?, ?, ?, ?, ?, ?, datetime('now')
        FROM intent_data_sources WHERE source_name = ?
      `).run(
        configId,
        errorMessage ? 'partial' : 'completed',
        signals.length,
        signals.length,
        newCount,
        duration,
        errorMessage,
        adapterName
      );

      if (newCount > 0) {
        console.log(`✅ Config ${configId}: Generated ${newCount} new signals via ${adapterName} (${duration}ms)`);
      }

    } catch (error) {
      console.error(`❌ Error syncing config ${configId}:`, error);

      // Log failed sync
      try {
        this.db.prepare(`
          INSERT INTO intent_sync_log (source_id, config_id, sync_type, status, error_message, completed_at)
          SELECT id, ?, 'scheduled', 'failed', ?, datetime('now')
          FROM intent_data_sources WHERE source_name = 'demo'
        `).run(configId, error.message);
      } catch (logError) {
        // Ignore logging errors
      }
    }
  }

  /**
   * Mark signals older than 48 hours as expired
   */
  expireStaleSignals() {
    try {
      const result = this.db.prepare(`
        UPDATE intent_signal_matches
        SET status = 'expired'
        WHERE status IN ('new', 'viewed')
          AND expires_at < datetime('now')
      `).run();

      if (result.changes > 0) {
        console.log(`🕐 Expired ${result.changes} stale intent signals`);
      }
    } catch (error) {
      console.error('Error expiring stale signals:', error);
    }
  }

  /**
   * Manually trigger sync for a config (called from API)
   */
  async triggerSync(configId) {
    console.log(`🔄 Manual sync triggered for config ${configId}`);
    await this.syncConfig(configId);
  }

  /**
   * Handle config created/updated
   */
  onConfigChanged(config) {
    if (config.is_active) {
      this.startConfigSync(config);
    } else {
      this.stopConfigSync(config.id);
    }
  }

  /**
   * Handle config deleted
   */
  onConfigDeleted(configId) {
    this.stopConfigSync(configId);
  }

  /**
   * Get status of all adapters
   */
  getAdapterStatus() {
    const status = {};
    for (const [name, adapter] of this.adapters) {
      status[name] = {
        registered: true,
        sourceName: adapter.sourceName || name
      };
    }
    return status;
  }

  /**
   * Test a specific adapter
   */
  async testAdapter(adapterName) {
    const adapter = this.adapters.get(adapterName);
    if (!adapter) {
      return { success: false, message: `Adapter "${adapterName}" not found` };
    }

    if (typeof adapter.testConnection === 'function') {
      return await adapter.testConnection();
    }

    // For adapters without test method, do a small signal generation
    try {
      const signals = await adapter.generateSignals(['restaurant'], ['75201'], 1, {});
      return {
        success: signals.length > 0,
        message: signals.length > 0 ? 'Adapter working' : 'No signals generated'
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}

module.exports = IntentSignalService;
