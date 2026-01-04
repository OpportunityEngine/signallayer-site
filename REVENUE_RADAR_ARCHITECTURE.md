# Revenue Radar - Complete Architecture Documentation

## 🎯 Overview

Revenue Radar is an AI-powered sales intelligence platform that helps sales reps and managers maximize revenue by analyzing invoices, detecting opportunities, tracking ML As, and gamifying performance through SPIFs.

**Key Capabilities:**
- ✅ Dual-mode operation (Demo & Production)
- ✅ Real-time SPIF leaderboards
- ✅ Automated opportunity detection from invoices
- ✅ MLA review tracking and analytics
- ✅ Commission tracking and forecasting
- ✅ Browser extension for contextual intelligence
- ✅ Performance analytics with caching

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   BROWSER EXTENSION                          │
│  - Analyzes invoices on vendor websites                     │
│  - Finds contact info for accounts                          │
│  - Tracks user activity (MLAs reviewed, clicks)             │
│  - Sends telemetry to backend                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ HTTP POST /ingest
                     │ HTTP POST /telemetry/track
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   BACKEND API SERVER                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ server.js (Express)                                  │   │
│  │  - Invoice ingestion & parsing                       │   │
│  │  - Lead discovery (Apollo + OSM)                    │   │
│  │  - Telemetry collection                              │   │
│  └────────────┬────────────────────────────────────────┘   │
│               │                                              │
│  ┌────────────▼───────────────────────────────────────┐    │
│  │ api-routes.js (New Production API)                  │    │
│  │  GET  /api/spifs/active                             │    │
│  │  GET  /api/spifs/:id/leaderboard                    │    │
│  │  POST /api/mlas/:id/review                          │    │
│  │  GET  /api/opportunities                            │    │
│  │  GET  /api/commissions/summary                      │    │
│  │  GET  /api/dashboard/rep-summary                    │    │
│  │  POST /api/telemetry/track                          │    │
│  └────────────┬────────────────────────────────────────┘    │
│               │                                              │
│  ┌────────────▼───────────────────────────────────────┐    │
│  │ database.js (SQLite Layer)                          │    │
│  │  - User & Team management                           │    │
│  │  - SPIF tracking & leaderboards                     │    │
│  │  - Opportunity pipeline                             │    │
│  │  - Commission calculations                          │    │
│  │  - Analytics caching                                │    │
│  └────────────┬────────────────────────────────────────┘    │
│               │                                              │
│  ┌────────────▼───────────────────────────────────────┐    │
│  │ revenue-radar.db (SQLite Database)                  │    │
│  │  - 15+ tables with proper indexing                  │    │
│  │  - Real-time standings & metrics                    │    │
│  │  - Historical data for analytics                    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                     ▲
                     │ HTTP GET /api/*
                     │
┌────────────────────┴────────────────────────────────────────┐
│                   WEB DASHBOARDS                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ rep-view.html (Rep Dashboard)                        │   │
│  │  - Active SPIF leaderboard                           │   │
│  │  - Personal opportunities funnel                     │   │
│  │  - Commission tracking                               │   │
│  │  - Activity metrics                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ manager-view.html (Manager Dashboard)                │   │
│  │  - SPIF management & results                         │   │
│  │  - Team performance metrics                          │   │
│  │  - Opportunity pipeline overview                     │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ rep-dashboard-api.js (Frontend API Client)           │   │
│  │  - Dual-mode support (demo/production)              │   │
│  │  - Smart caching & data formatting                  │   │
│  │  - Event tracking                                    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 Database Schema

### Core Tables

**users** - Sales reps, managers, admins
- Stores user profiles, roles, team assignments
- Links to all activity and performance data

**teams** - Sales teams
- Hierarchical team structure
- Manager assignments

**spifs** - Sales Performance Incentive Funds
- Configurable competitive SPIFs
- Support for various metric types (MLAs reviewed, deals closed, etc.)
- Date-bound with prize amounts

**spif_standings** - Real-time SPIF leaderboards
- Auto-updating rankings
- Current metric values per rep
- Efficient for dashboard queries

**mlas** - Master Lease Agreements
- Contract details and renewal tracking
- Expiration monitoring
- Review history

**mla_reviews** - MLA review activity log
- Tracks when reps review MLAs
- Auto-increments SPIF standings
- Audit trail for manager visibility

**opportunities** - Sales opportunities
- System-detected + manually created
- Status pipeline tracking
- Commission estimates
- Urgency flags

**ingestion_runs** - Invoice upload sessions
- Links to source invoices
- Extraction metadata
- User attribution

**telemetry_events** - Extension activity tracking
- Granular user behavior data
- Session tracking
- Event-driven analytics

**commissions** - Commission records
- Historical and pending commissions
- Links to opportunities
- Payment tracking

### Performance Optimizations

- **Indexes** on all common query patterns
- **Views** for complex aggregations (leaderboards, performance summaries)
- **Analytics cache table** with TTL for expensive queries
- **WAL mode** enabled for concurrent reads/writes

---

## 🔄 End-to-End Data Flow

### Scenario: Rep Analyzes Invoice & Gets SPIF Credit

1. **Extension Activity**
   ```
   Rep visits vendor website → Views invoice → Clicks "Analyze"
   ↓
   Extension sends invoice data to backend
   POST /ingest with image/PDF
   ```

2. **Backend Processing**
   ```
   server.js receives invoice
   ↓
   OCR/parsing extracts line items, amounts, vendor
   ↓
   Creates ingestion_run record in database
   ↓
   Stores invoice_items
   ↓
   Detects opportunities (if MLA-related)
   ↓
   Creates opportunity record
   ↓
   Returns structured data + leads to extension
   ```

3. **MLA Review Tracking**
   ```
   Rep reviews extracted MLA info in extension
   ↓
   Extension calls: POST /api/mlas/{id}/review
   ↓
   database.js:
     - Creates mla_reviews record
     - Finds active MLAs-reviewed SPIFs
     - Increments spif_standings for user
     - Recalculates rankings
   ↓
   Returns updated standing to extension
   ```

4. **Dashboard Update**
   ```
   Rep opens rep-view.html
   ↓
   Dashboard loads rep-dashboard-api.js
   ↓
   Checks demo vs production mode
   ↓
   Fetches: GET /api/spifs/1/leaderboard
   ↓
   database.js queries spif_standings view
   ↓
   Returns top 10 with current values
   ↓
   Dashboard renders live leaderboard:
     1st: John (35 MLAs)  ← went up by 1
     2nd: Sarah (31 MLAs)
     3rd: You (29 MLAs)  ← went up by 1
   ```

5. **Manager Visibility**
   ```
   Manager opens manager-view.html
   ↓
   GET /api/dashboard/manager-summary
   ↓
   Returns:
     - All active SPIFs with leaderboards
     - Team performance metrics
     - Individual rep stats
   ↓
   Manager sees real-time SPIF results
   ```

---

## 🎮 Demo vs Production Modes

### Demo Mode
**Purpose:** Sales demos, testing, training

**Characteristics:**
- Hardcoded data in `rep-dashboard-api.js`
- No database queries
- Instant load times
- Consistent, polished data for demos

**Data Sources:**
- SPIF: John (34), Sarah (31), You (28)
- Pre-scripted opportunities
- Mock commissions

**Activation:**
```javascript
// Frontend
window.RevenueRadarAPI.toggleDemoMode(true);

// Or via query param
http://localhost:5050/rep-view.html?demo=1
```

### Production Mode
**Purpose:** Real operations with actual invoice data

**Characteristics:**
- Live database queries
- Real-time updates
- Actual rep performance
- Dynamic opportunity detection

**Data Sources:**
- SQLite database
- `/api/*` endpoints
- Cached analytics

**Detection:**
```javascript
// Automatically checks on page load
GET /api/demo/status
→ Returns { demo_mode: false, has_real_data: true }
```

**Toggle:**
```javascript
window.RevenueRadarAPI.toggleDemoMode(false);
```

---

## 🚀 Setup & Installation

### 1. Install Dependencies

```bash
cd /Users/taylorray/Desktop/ai-sales-backend
npm install
```

### 2. Initialize Database

```bash
# Auto-creates revenue-radar.db with demo data
node -e "require('./database').initDatabase()"
```

### 3. Integrate New API Routes

Follow instructions in `SERVER_INTEGRATION.md`:

1. Add database initialization to `server.js`
2. Mount API routes
3. Update `/ingest` endpoint
4. Update `/telemetry` endpoint

### 4. Start Server

```bash
npm start
# Server runs on http://localhost:5050
```

### 5. Test Endpoints

```bash
# SPIF leaderboard
curl http://localhost:5050/api/spifs/active

# Rep dashboard
curl -H "x-user-email: you@demo.com" \
  http://localhost:5050/api/dashboard/rep-summary

# Record MLA review (increments SPIF)
curl -X POST \
  -H "Content-Type: application/json" \
  -H "x-user-email: you@demo.com" \
  -d '{"action": "analyzed"}' \
  http://localhost:5050/api/mlas/1/review
```

### 6. Open Dashboards

- Rep: `http://localhost:5050/rep-view.html`
- Manager: `http://localhost:5050/manager-view.html`

---

## 🔧 Configuration

### Environment Variables

Create `.env` file:

```bash
# Database
DB_PATH=./revenue-radar.db

# API Keys
APOLLO_API_KEY=your_apollo_key_here

# Cache TTL
LEADS_CACHE_TTL_MS=86400000  # 24 hours
OSM_CACHE_TTL_MS=86400000

# Analytics Cache
ANALYTICS_CACHE_MINUTES=15

# Server
PORT=5050
```

### Demo Data Customization

Edit `database.js` → `seedDemoData()` function to customize:
- User names
- SPIF prizes
- MLA contracts
- Opportunity values

---

## 📈 Performance Optimizations

### 1. Analytics Caching
```javascript
// Expensive queries cached for 5-15 minutes
db.setCachedAnalytics('rep-summary:user_123', data, 5);
```

### 2. Database Indexes
```sql
-- Optimized for dashboard queries
CREATE INDEX idx_spif_standings_spif ON spif_standings(spif_id, rank);
CREATE INDEX idx_opportunities_assigned ON opportunities(assigned_to, status);
```

### 3. Prepared Statements
```javascript
// Reusable, compiled statements
const stmt = db.prepare('SELECT * FROM opportunities WHERE user_id = ?');
const results = stmt.all(userId);
```

### 4. WAL Mode
```javascript
// Allows concurrent reads during writes
db.pragma('journal_mode = WAL');
```

### 5. Frontend Batching
```javascript
// Single API call for complete dashboard
GET /api/dashboard/rep-summary
// Returns SPIFs + opportunities + commissions + stats
```

---

## 🧪 Testing Scenarios

### Test 1: SPIF Progression
```bash
# Initial standing
curl http://localhost:5050/api/spifs/1/leaderboard
# You: 28 MLAs

# Record 3 MLA reviews
for i in {1..3}; do
  curl -X POST -H "Content-Type: application/json" -H "x-user-email: you@demo.com" \
    -d "{\"action\": \"analyzed\"}" \
    http://localhost:5050/api/mlas/1/review
  sleep 1
done

# Check updated standing
curl http://localhost:5050/api/spifs/1/leaderboard
# You: 31 MLAs (tied for 2nd!)
```

### Test 2: Opportunity Detection
```bash
# Upload high-value invoice
# Will auto-create opportunity if > $5000

curl -X POST -H "Content-Type: application/json" \
  -d '{"canonical": {"total_amount_cents": 600000, "parties": {"customer": {"name": "Test Restaurant"}}}}' \
  http://localhost:5050/ingest

# Check created opportunities
curl -H "x-user-email: you@demo.com" \
  http://localhost:5050/api/opportunities
```

### Test 3: Commission Tracking
```bash
# Get commission summary
curl -H "x-user-email: you@demo.com" \
  http://localhost:5050/api/commissions/summary

# Expected response:
# {
#   "this_month": { "total_cents": 842000, "count": 12 },
#   "this_quarter": { "total_cents": 2500000, "count": 35 },
#   "pending_cents": 150000
# }
```

---

## 🎯 Next Steps & Enhancements

### Phase 1: Current Implementation ✅
- [x] Database schema & models
- [x] Production API endpoints
- [x] SPIF tracking & leaderboards
- [x] MLA review recording
- [x] Opportunity pipeline
- [x] Commission tracking
- [x] Analytics caching
- [x] Demo/production dual-mode
- [x] Frontend API client

### Phase 2: Integration (In Progress)
- [ ] Update `server.js` with database integration
- [ ] Connect extension telemetry to database
- [ ] Update dashboards to use new API
- [ ] Add demo mode toggle UI
- [ ] Test end-to-end with real invoices

### Phase 3: Advanced Features
- [ ] AI/ML opportunity detection (replace heuristics)
- [ ] Predictive commission forecasting
- [ ] Mobile-responsive dashboards
- [ ] Real-time websocket updates for leaderboards
- [ ] Email notifications for SPIF standings
- [ ] Manager SPIF creation UI
- [ ] Advanced analytics & reporting
- [ ] Multi-team support
- [ ] Role-based access control
- [ ] Export data to CSV/Excel

### Phase 4: Production Hardening
- [ ] User authentication (JWT)
- [ ] Rate limiting
- [ ] Input validation & sanitization
- [ ] Error monitoring (Sentry)
- [ ] Database backups
- [ ] Load testing
- [ ] Documentation for deployment
- [ ] Docker containerization

---

## 📚 Key Files Reference

| File | Purpose |
|------|---------|
| `database-schema.sql` | Complete database schema with 15+ tables |
| `database.js` | SQLite wrapper with business logic functions |
| `api-routes.js` | Production API endpoints (RESTful) |
| `rep-dashboard-api.js` | Frontend API client with dual-mode support |
| `server.js` | Main Express server (existing + integration points) |
| `SERVER_INTEGRATION.md` | Step-by-step integration instructions |
| `rep-view.html` | Rep dashboard HTML |
| `manager-view.html` | Manager dashboard HTML |
| `revenue-radar.db` | SQLite database file (created on first run) |

---

## 💡 Best Practices

### For Development
1. **Always check demo mode** before testing features
2. **Use demo mode for sales presentations**
3. **Clear analytics cache** when testing new queries
4. **Monitor database size** (SQLite efficient up to ~100GB)
5. **Run schema migrations** through version control

### For Production
1. **Regular database backups** (SQLite supports online backups)
2. **Monitor query performance** with EXPLAIN QUERY PLAN
3. **Set appropriate cache TTLs** (balance freshness vs load)
4. **Use connection pooling** for high concurrency
5. **Enable query logging** for debugging

### For Sales Demos
1. **Reset demo data** before presentations
2. **Use demo mode toggle** for consistent results
3. **Pre-load dashboards** to avoid loading delays
4. **Have backup data** for different scenarios
5. **Show live SPIF updates** to demonstrate real-time features

---

## 🐛 Troubleshooting

### Database locked errors
```bash
# Check for zombie processes
lsof revenue-radar.db

# Enable WAL mode (allows concurrent access)
sqlite3 revenue-radar.db "PRAGMA journal_mode=WAL;"
```

### Cache not expiring
```bash
# Clear all cached analytics
DELETE FROM analytics_cache WHERE expires_at < datetime('now', '+1 day');
```

### SPIF rankings not updating
```javascript
// Manually recalculate
const db = require('./database');
db.recalculateSPIFRanks(spifId);
```

### Demo mode stuck
```javascript
// Clear localStorage
localStorage.removeItem('revenue_radar_demo_mode');
// Reload page
```

---

## 📞 Support & Documentation

- **Architecture:** This file
- **API Reference:** `api-routes.js` JSDoc comments
- **Database Schema:** `database-schema.sql`
- **Integration Guide:** `SERVER_INTEGRATION.md`
- **Frontend API:** `rep-dashboard-api.js` inline docs

---

**Built with ❤️ for Revenue Radar**
