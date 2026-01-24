# Revenue Radar / QuietSignal - Claude Code Guide

## IMPORTANT: Agent Usage Policy

**ALWAYS use our specialized agents for ALL tasks.** This is a core project requirement.

For every task/prompt/command:
1. **code-quality-engineer** - Run in background alongside ALL work to continuously improve code quality
2. **regression-guardian** - Run after ANY code changes to verify no breaks
3. Use the appropriate specialist agent for the task type (see table below)

This policy ensures:
- Faster development (parallel work)
- Higher accuracy (specialized agents)
- Better code quality (continuous improvement)
- Fewer bugs (regression checks)

**Never work without agents** - even simple tasks benefit from parallel quality checks.

---

## Quick Start

### Start Server Locally
```bash
npm install
node server.js
# Server runs on http://localhost:5050
```

### Run Tests
```bash
npm test                          # All tests
npm test -- --grep "invoice"      # Invoice parsing tests
npm test -- --grep "parser"       # Parser-specific tests
```

### Database
- SQLite: `database.sqlite` in project root
- Schema/migrations in `database.js`
- Key tables: `users`, `ingestion_runs`, `invoice_items`, `email_monitors`, `email_processing_log`

---

## Code Architecture

### Invoice Parsing
| Path | Purpose |
|------|---------|
| `/services/invoice_parsing_v2/` | V2 parser architecture (current) |
| `/services/invoice_parsing_v2/index.js` | Main entry point |
| `/services/invoice_parsing_v2/vendorDetector.js` | Vendor identification |
| `/services/invoice_parsing_v2/parsers/cintasParser.js` | Cintas-specific parser |
| `/services/invoice_parsing_v2/genericParser.js` | Fallback parser |
| `/services/invoice_parsing_v2/validator.js` | Validation & confidence scoring |
| `/services/invoice_parsing_v2/utils.js` | Shared utilities |
| `/invoice-parser.js` | Legacy V1 parser |
| `/universal-invoice-processor.js` | Orchestrates PDF extraction + parsing |

### Email Autopilot
| Path | Purpose |
|------|---------|
| `/email-imap-service.js` | Main IMAP service (OAuth + password) |
| `/email-check-service.js` | Alternative service with detailed logging |
| `/email-oauth-routes.js` | OAuth callback, monitor creation |
| `/email-monitor-routes.js` | Monitor management API |
| `/email-oauth-service.js` | Token refresh logic |

### API Routes
| Path | Purpose |
|------|---------|
| `/api-routes.js` | Main API (uploads, debug endpoints) |
| `/server.js` | Express server, /ingest endpoint |

### Dashboards
| Path | Purpose |
|------|---------|
| `/dashboard/my-invoices.html` | User's invoice history |
| `/dashboard/vp-view.html` | Business dashboard, email monitor status |
| `/dashboard/business-analytics.html` | Analytics dashboard |

---

## Database Schema (Key Tables)

```sql
-- Users
users(id, email, name, is_trial, trial_invoices_used)

-- Invoice records
ingestion_runs(id, run_id TEXT, user_id, account_name, vendor_name,
               file_name, status, invoice_total_cents, error_message, created_at)

-- Line items (run_id is INTEGER FK to ingestion_runs.id)
invoice_items(id, run_id INTEGER, description, quantity, unit_price_cents,
              total_cents, category)

-- Email monitors
email_monitors(id, user_id, created_by_user_id, email_address, oauth_provider,
               invoices_created_count, is_active, require_invoice_keywords)

-- Processing log
email_processing_log(id, monitor_id, email_uid, status, skip_reason,
                     invoices_created, error_message)
```

---

## Definition of Done

### Invoice Parsing Fix
- [ ] Root cause identified with specific line numbers
- [ ] Fix implemented with null-safety checks
- [ ] Math validation passes (line items → subtotal, subtotal + tax → total)
- [ ] Fixture added for the bug case
- [ ] Regression tests pass
- [ ] No new security issues (checked by regression-guardian)

### Email Autopilot Fix
- [ ] Root cause traced through data flow
- [ ] skip_reason logged for debugging
- [ ] user_id correctly set on all records
- [ ] Fix verified with /api/debug/invoices endpoint
- [ ] No invoice data loss
- [ ] Regression tests pass

---

## Workflow Playbook (Using Subagents)

### Available Agents (12 total)

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `invoice-parser-specialist` | Fix parsing bugs, improve vendor detection | Invoice showing wrong totals/items |
| `email-autopilot-debugger` | Debug email processing issues | Emails not being detected/processed |
| `test-runner` | Execute tests, report failures | After any code changes |
| `regression-guardian` | Review code for regressions/security | After significant changes |
| `data-fixture-curator` | Create test fixtures from real data | New invoice format found |
| `ui-frontend-specialist` | Update dashboard HTML/CSS/JS | UI changes needed |
| `api-architect` | Design/fix API endpoints | Backend API work |
| `database-specialist` | Schema changes, query optimization | Database issues |
| `deploy-assistant` | Git commits, deployments | Ready to commit/deploy |
| `feature-planner` | Break down features into tasks | Starting a new feature |
| `error-investigator` | Debug errors, trace code paths | Something is broken |
| `code-quality-engineer` | Improve code quality as we work | **Use alongside all tasks** |

### A) Continuous Quality Improvement (NEW)

**Always run `code-quality-engineer` alongside feature work:**

```
# Example: While fixing a bug, also improve surrounding code
"Fix the OAuth token refresh issue.
- error-investigator: find root cause
- api-architect: implement the fix
- code-quality-engineer (background): review touched files for improvements
- regression-guardian: verify no breaks"
```

### B) Debugging Email Autopilot Issues

**Parallel approach for maximum speed:**

1. **Main task** → Ask `email-autopilot-debugger` to instrument & fix
2. **Background** → Run `test-runner` to reproduce with minimal script
3. **Background** → `code-quality-engineer` reviews email service code
4. **After fix** → Have `regression-guardian` review diffs

```
# Example prompt:
"Email monitor shows 6 invoices but My Invoices shows 0.
- email-autopilot-debugger: trace the data flow and fix
- test-runner (background): query database state and check logs
- code-quality-engineer (background): review email service patterns
- regression-guardian: review the fix for regressions"
```

### C) Improving Invoice Parsing Accuracy

**Parallel approach:**

1. **Main task** → Ask `invoice-parser-specialist` to implement fix
2. **Background** → Have `data-fixture-curator` create test fixtures
3. **Background** → Run `test-runner` for parsing tests only
4. **Background** → `code-quality-engineer` reviews parser code
5. **After fix** → `regression-guardian` reviews

```
# Example prompt:
"Cintas invoice showing wrong subtotal - picking department subtotal instead of invoice total.
- invoice-parser-specialist: fix the bottom-up totals detection
- data-fixture-curator (background): create fixture for this invoice
- test-runner (background): run invoice parsing tests
- code-quality-engineer (background): check parser consistency"
```

### D) General Code Changes

After any significant changes:
```
# Run both quality and regression checks:
"Review the last commit:
- code-quality-engineer: identify improvement opportunities
- regression-guardian: check for regressions and security issues"
```

### E) New Feature Development

**Use feature-planner first, then parallel execution:**

```
# Example: Adding a new dashboard widget
"Plan and implement a cost savings chart on the analytics dashboard.
1. feature-planner: break down into tasks
2. (parallel) api-architect: create data endpoint
2. (parallel) ui-frontend-specialist: build the chart component
3. database-specialist: optimize query if needed
4. code-quality-engineer: ensure patterns match existing code
5. regression-guardian: final review
6. deploy-assistant: commit when approved"
```

---

## Background Agent Notes

When running agents in background:
- Use `run_in_background: true` in Task tool
- Check output with `Read` tool on the output file
- If agent hits permission prompt, it will pause
- Resume with the agent ID to continue

Example background usage:
```
# Start test-runner in background
Task(test-runner, "Run npm test and report failures", run_in_background=true)

# Continue working while tests run...

# Check results later
Read(output_file_path)
```

---

## Debug Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/debug/invoices` | Show all users, invoice counts, monitor assignments |
| `POST /api/debug/fix-all` | Auto-fix user_id mismatches |
| `GET /api/debug/user-id-audit` | Audit user_id attribution (admin/manager only) |
| `GET /api/email-monitors/:id/diagnose` | IMAP connection diagnostics |
| `GET /api/uploads/recent` | User's invoices (auto-heals on load) |

**Note:** All trace logs use `[USER_ID_TRACE]` prefix - see `USER_ID_TRACE_FORMAT.md` for details.

---

## Environment Variables

```bash
# Required for email OAuth (Gmail one-click connect)
GOOGLE_OAUTH_CLIENT_ID=...        # From Google Cloud Console
GOOGLE_OAUTH_CLIENT_SECRET=...    # From Google Cloud Console
BASE_URL=https://yourdomain.com   # Used to compute redirect URI

# The redirect URI sent to Google is: {BASE_URL}/api/email-oauth/google/callback
# This MUST match exactly what's configured in Google Cloud Console

# Optional
EMAIL_ENCRYPTION_KEY=...
INVOICE_PARSER_V2=true  # Enable V2 parser
```
