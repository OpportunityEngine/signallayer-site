# Server Integration Instructions

## Changes needed to integrate the new database and API routes into server.js

### 1. Add Database Initialization (after line 1073)

After the middleware setup (`app.use(express.json({ limit: "25mb" }));`), add:

```javascript
// ===== Initialize Database =====
const db = require('./database');
const apiRoutes = require('./api-routes');

// Initialize database on startup
try {
  db.initDatabase();
  console.log('✅ Database initialized successfully');
} catch (error) {
  console.error('❌ Failed to initialize database:', error);
  process.exit(1);
}

// Mount API routes
app.use('/api', apiRoutes);
console.log('✅ API routes mounted at /api');
```

### 2. Update /ingest endpoint to integrate with database

Find the `/ingest` endpoint (around line 2700) and after successful ingestion, add:

```javascript
// After line: const runId = nanoid();
// And after writing to /tmp/owens-test.json

// Get or create user from request
const userEmail = req.headers['x-user-email'] || 'demo@revenueradar.com';
const userId = db.createOrUpdateUser(userEmail, userEmail.split('@')[0], 'rep');

// Store ingestion run in database
const runRecord = db.getDatabase().prepare(`
  INSERT INTO ingestion_runs (
    run_id, user_id, account_name, vendor_name,
    file_name, file_size, status, completed_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'completed', datetime('now'))
`).run(
  runId,
  userId,
  accountName || 'Unknown',
  vendorName || 'Unknown',
  fileName || 'upload',
  fileSize || 0
);

const internalRunId = runRecord.lastInsertRowid;

// Store invoice items
if (canonical && canonical.line_items && Array.isArray(canonical.line_items)) {
  const itemStmt = db.getDatabase().prepare(`
    INSERT INTO invoice_items (run_id, description, quantity, unit_price_cents, total_cents, category)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  canonical.line_items.forEach(item => {
    itemStmt.run(
      internalRunId,
      item.description || '',
      item.quantity || 0,
      item.unit_price_cents || 0,
      item.total_cents || 0,
      item.category || null
    );
  });
}

// Detect opportunities from invoice data
// This is where AI/ML would analyze the invoice and create opportunities
const opportunityDetected = detectOpportunityFromInvoice(canonical, userId, internalRunId);

if (opportunityDetected) {
  db.createOpportunity(opportunityDetected);
}
```

### 3. Add Opportunity Detection Function

Add this helper function before the /ingest endpoint:

```javascript
// Detect sales opportunities from invoice data
function detectOpportunityFromInvoice(canonical, userId, runId) {
  if (!canonical) return null;

  // Simple heuristic detection - in production, this would use ML
  const total = canonical.total_amount_cents || 0;

  // If invoice total > $5000, it might be MLA-related
  if (total > 500000) {
    const accountName = (canonical.parties && canonical.parties.customer && canonical.parties.customer.name) || 'Unknown';

    // Check if we have an existing MLA for this account
    const existingMLA = db.getDatabase().prepare(`
      SELECT * FROM mlas WHERE account_name LIKE ? LIMIT 1
    `).get(`%${accountName}%`);

    if (existingMLA) {
      // Check if MLA is expiring soon (within 90 days)
      const endDate = new Date(existingMLA.end_date);
      const now = new Date();
      const daysUntilExpiry = Math.floor((endDate - now) / (1000 * 60 * 60 * 24));

      if (daysUntilExpiry > 0 && daysUntilExpiry <= 90) {
        return {
          account_name: accountName,
          opportunity_type: 'mla_renewal',
          assigned_to: userId,
          likelihood_pct: 85,
          estimated_value_cents: existingMLA.contract_value_cents,
          estimated_commission_cents: Math.floor(existingMLA.contract_value_cents * 0.05),
          source_run_id: runId,
          mla_id: existingMLA.id,
          urgency: daysUntilExpiry <= 30 ? 'critical' : 'high',
          notes: `MLA expires in ${daysUntilExpiry} days. System detected via invoice analysis.`
        };
      }
    } else {
      // No existing MLA - potential new contract opportunity
      return {
        account_name: accountName,
        opportunity_type: 'new_service',
        assigned_to: userId,
        likelihood_pct: 65,
        estimated_value_cents: total * 12, // Assume annual value
        estimated_commission_cents: Math.floor(total * 12 * 0.03),
        source_run_id: runId,
        mla_id: null,
        urgency: 'medium',
        notes: `High-value invoice detected. Potential for new MLA or service agreement.`
      };
    }
  }

  return null;
}
```

### 4. Update Extension Telemetry Integration

Find the `/telemetry` POST endpoint and update it to use the database:

```javascript
app.post("/telemetry", (req, res) => {
  try {
    const { event_type, event_data, page_url, session_id, user_email } = req.body;

    // Get or create user
    const email = user_email || 'anonymous@revenueradar.com';
    const userId = db.createOrUpdateUser(email, email.split('@')[0], 'rep');

    // Log to database
    db.logTelemetryEvent(userId, event_type, event_data, page_url, session_id);

    // If this is an MLA review event, record it
    if (event_type === 'mla_reviewed' && event_data && event_data.mla_id) {
      db.recordMLAReview(
        event_data.mla_id,
        userId,
        'analyzed',
        event_data.notes || null
      );
    }

    res.json({ ok: true, message: 'Telemetry logged' });
  } catch (error) {
    console.error('Error logging telemetry:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});
```

## Quick Start Commands

After making these changes:

```bash
# Install dependencies (if not already installed)
npm install

# Initialize database (will create revenue-radar.db with demo data)
node -e "require('./database').initDatabase()"

# Start server
npm start
```

## Testing the New Endpoints

```bash
# Get active SPIFs
curl http://localhost:5050/api/spifs/active

# Get SPIF leaderboard (use spif ID from previous call)
curl http://localhost:5050/api/spifs/1/leaderboard

# Get rep dashboard summary
curl -H "x-user-email: you@demo.com" http://localhost:5050/api/dashboard/rep-summary

# Get opportunities for user
curl -H "x-user-email: you@demo.com" http://localhost:5050/api/opportunities

# Record MLA review (will increment SPIF standing)
curl -X POST -H "Content-Type: application/json" -H "x-user-email: you@demo.com" \
  -d '{"action": "analyzed", "notes": "Reviewed contract terms"}' \
  http://localhost:5050/api/mlas/1/review

# Check demo vs production mode
curl -H "x-user-email: you@demo.com" http://localhost:5050/api/demo/status
```

## Database File Location

The SQLite database file will be created at:
- Default: `/Users/taylorray/Desktop/ai-sales-backend/revenue-radar.db`
- Can be changed with `DB_PATH` environment variable

## Demo Data

The database automatically seeds with demo data on first initialization:
- 4 demo users (John, Sarah, You, Demo Manager)
- 1 active SPIF (Most MLAs Reviewed This Week)
- SPIF standings (John: 34, Sarah: 31, You: 28)
- 2 demo MLAs
- 3 demo opportunities

This allows immediate testing without real data.
