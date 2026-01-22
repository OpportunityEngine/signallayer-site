# Revenue Radar - Core Memory (Context Restoration)

**Copy/paste this entire file to Claude after a chat crash to restore full context.**

---

## Quick Identity

- **App Name:** Revenue Radar / QuietSignal / "King Prawn"
- **Production URL:** king-prawn-app-pc8hi.ondigitalocean.app
- **Tech Stack:** Node.js + Express 5.2.1 + SQLite (WAL mode)
- **Deployment:** DigitalOcean App Platform

---

## Critical Files (Read These First)

| File | Lines | Purpose |
|------|-------|---------|
| `server.js` | 4,569 | Main Express server, /ingest endpoint |
| `database.js` | 2,802 | SQLite init, schema, migrations |
| `email-check-service.js` | ~500 | Email processing (NEW, preferred) |
| `universal-invoice-processor.js` | ~400 | Invoice parsing entry point |
| `dashboard/vp-view.html` | 2,500+ | Business dashboard |
| `dashboard/my-invoices.html` | ~800 | User invoice history |

---

## Database Schema (Essential Tables)

```sql
users(id, email, name, role, is_trial, trial_invoices_used)
ingestion_runs(id, run_id TEXT, user_id NOT NULL, vendor_name, status, invoice_total_cents)
invoice_items(id, run_id INTEGER FK, description, quantity, total_cents)
email_monitors(id, user_id NOT NULL, email_address, oauth_provider, invoices_created_count)
email_processing_log(id, monitor_id, email_uid, status, skip_reason, invoices_created)
```

**Critical Constraint:** `user_id NOT NULL` on ingestion_runs and email_monitors prevents "invisible invoice" bugs.

---

## Current Known Issues

### CRITICAL (Must Fix)
1. **Public debug endpoint** - `/public-debug-invoice-status` in api-routes.js MUST BE REMOVED
2. **Hardcoded encryption key** - email-imap-service.js line ~45 has fallback key
3. **DigitalOcean disk** - app.yaml configured, but disk may need manual provisioning in DO console

### HIGH (Should Fix)
4. **Dashboard hardcoded values** - Fixed in code (commit 96c7b91), verify deployment worked
5. **DATABASE_PATH confusion** - Fixed (commit 0f75c40), monitor for regression

### MEDIUM (Cleanup)
6. **9 backup files** - Delete *.bak files from repo
7. **Verbose SQL logging** - Disable in production

---

## Key API Endpoints

```
POST /ingest                     - Upload invoice (multipart form)
GET  /api/uploads/recent         - User's invoices (auto-heals user_id)
GET  /api/email-monitors         - List user's email monitors
POST /api/email-monitors         - Create email monitor
GET  /api/bi/opportunities       - Business intelligence opportunities
GET  /api/debug/invoices         - Debug: all users + invoice counts
POST /api/debug/fix-all          - Debug: auto-fix user_id mismatches
```

---

## Environment Variables (Required)

```bash
DATABASE_PATH=/data/revenue-radar.db    # Persistent storage path
JWT_SECRET=<64-byte-hex>                 # Auth tokens
EMAIL_ENCRYPTION_KEY=<32-byte-hex>       # OAuth token encryption
GOOGLE_CLIENT_ID=...                     # Gmail OAuth
GOOGLE_CLIENT_SECRET=...
STRIPE_SECRET_KEY=sk_live_...            # Payments
ANTHROPIC_API_KEY=sk-ant-...             # AI parsing
```

---

## Test Commands

```bash
npm test                              # All 23 tests
npm test -- --grep "invoice"          # Invoice tests only
npm test -- --grep "email"            # Email flow tests
node scripts/dev/check-db-state.js    # Debug database state
```

---

## Invoice Parsing Flow

```
User uploads file
    ↓
universal-invoice-processor.js
    ↓
services/invoice_parsing_v2/index.js
    ↓
vendorDetector.js → identifies vendor (Cintas, Sysco, etc.)
    ↓
parsers/cintasParser.js OR genericParser.js
    ↓
validator.js → confidence scoring
    ↓
INSERT into ingestion_runs + invoice_items
```

---

## Email Autopilot Flow

```
User connects Gmail/Outlook via OAuth
    ↓
email_monitors record created with oauth_* tokens
    ↓
Cron job (every 5-15 min) triggers email-check-service.js
    ↓
IMAP fetch new emails → extract PDF/image attachments
    ↓
Process through invoice parser
    ↓
INSERT ingestion_run with VERIFIED user_id
    ↓
Update monitor.invoices_created_count
```

---

## Dashboard Data Binding

The business dashboard (`vp-view.html`) loads data via:

1. `loadMetrics()` → fetches `/api/bi/metrics` → populates tiles + command center
2. `loadFinancialCharts()` → fetches chart data → populates bottom charts
3. `loadRecentActivity()` → fetches activity feed

**Element IDs that must be updated:**
- `tileSavingsFound`, `tilePipelineTotal`, `tilePipelineCount`
- `ccTotalOverbilling`, `ccInvoicesAnalyzed`, `ccFlaggedIssues`, `ccAvgImpact`

---

## Git Workflow

```bash
# Check status
git status

# Commit (use conventional commits)
git add <specific-files>
git commit -m "Fix: description of fix"

# Push to trigger deployment
git push origin main
```

---

## Specialized Agents Available

| Agent | Use For |
|-------|---------|
| `invoice-parser-specialist` | Parsing bugs, vendor detection |
| `email-autopilot-debugger` | Email processing issues |
| `test-runner` | Run tests after changes |
| `regression-guardian` | Check for regressions |
| `code-quality-engineer` | Run alongside all work |
| `ui-frontend-specialist` | Dashboard HTML/CSS/JS |
| `api-architect` | Backend API work |
| `database-specialist` | Schema, queries |
| `deploy-assistant` | Git, deployments |
| `error-investigator` | Debug errors |

---

## Quick Debug Commands

```javascript
// In browser console on any dashboard page:
console.log(localStorage.getItem('token'));  // Check JWT
console.log(localStorage.getItem('user'));   // Check user data

// Fetch invoice debug info
fetch('/api/debug/invoices', {
  headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
}).then(r => r.json()).then(console.log);
```

---

## Recent Commits (Context)

```
180b848 Align utility scripts with DATABASE_PATH fix
0f75c40 Fix DATABASE_PATH env var mismatch - ROOT CAUSE OF INVOICE VISIBILITY
96c7b91 Add debugging and fix ccAvgImpact update in loadMetrics
b8baf7e Fix persistent storage and dashboard data binding
```

---

## Files to Read for Full Context

For comprehensive understanding, read these documents:
1. `CODEBASE_ANALYSIS.md` - Full architecture and feature documentation
2. `CLAUDE.md` - Development workflow and agent usage
3. `.do/app.yaml` - Deployment configuration

---

*Last Updated: January 21, 2026*
