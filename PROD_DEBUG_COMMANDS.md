# Production Debug Commands

Use these curl commands to diagnose the invoice pipeline issue in production.

**Production URL:** `https://king-prawn-app-pc8hi.ondigitalocean.app`

---

## Step 1: Login and Get JWT Token

```bash
# Login as admin
curl -X POST https://king-prawn-app-pc8hi.ondigitalocean.app/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "YOUR_ADMIN_EMAIL", "password": "YOUR_PASSWORD"}'

# Response will include:
# { "success": true, "token": "eyJhbG...", "user": {...} }

# Save the token:
export TOKEN="eyJhbG..."  # Replace with actual token from response
```

---

## Step 2: Check Database Identity

This confirms which database file is being used and if persistent storage is working.

```bash
curl -s https://king-prawn-app-pc8hi.ondigitalocean.app/api/admin/db-identity \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expected good result:**
```json
{
  "success": true,
  "dbIdentity": {
    "dbPathResolved": "/data/revenue-radar.db",
    "fileExists": true,
    "dataDirectoryExists": true,
    "isPersistentStorage": true,
    "journalMode": "wal"
  }
}
```

**Bad indicators:**
- `dbPathResolved` shows `/tmp/...` or something other than `/data/...`
- `dataDirectoryExists: false`
- `isPersistentStorage: false`
- `fileExists: false`

---

## Step 3: Check Invoice Pipeline Status

This is the key diagnostic - it shows monitors, runs, and detects mismatches.

```bash
# For all users:
curl -s "https://king-prawn-app-pc8hi.ondigitalocean.app/api/admin/invoice-pipeline-status" \
  -H "Authorization: Bearer $TOKEN" | jq

# For specific user:
curl -s "https://king-prawn-app-pc8hi.ondigitalocean.app/api/admin/invoice-pipeline-status?user_id=3" \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Key fields to check:**

```json
{
  "summary": {
    "totalInvoicesCreatedByMonitors": 15,  // What monitors claim
    "ingestionRunsCount": 0,               // What DB actually has
    "completedRunsCount": 0
  },
  "mismatch": {
    "possibleDataLoss": true,              // TRUE = problem!
    "diagnosis": "CRITICAL: Monitors show invoices but no ingestion_runs found!"
  }
}
```

---

## Step 4: Check Email Monitors

```bash
curl -s https://king-prawn-app-pc8hi.ondigitalocean.app/api/email-monitors \
  -H "Authorization: Bearer $TOKEN" | jq
```

Look for:
- `invoices_created_count` - does it match what you expect?
- `last_checked_at` - when was it last checked?
- `is_active` - is it enabled?
- `last_error` - any errors?

---

## Step 5: Check User's Invoices (My Invoices API)

```bash
curl -s https://king-prawn-app-pc8hi.ondigitalocean.app/api/uploads/recent \
  -H "Authorization: Bearer $TOKEN" | jq
```

This calls the same endpoint as "My Invoices" page. If it returns empty but monitors show invoices, there's a data integrity issue.

---

## Step 6: Check Public Debug Endpoint (Temporary)

**WARNING: This endpoint should be removed after debugging!**

```bash
curl -s https://king-prawn-app-pc8hi.ondigitalocean.app/api/public-debug-invoice-status | jq
```

This shows:
- Total invoices in database
- All monitors with their counts
- Recent processing logs
- User invoice counts

---

## Interpreting Results

### Scenario A: DB Path Mismatch
**Symptoms:**
- `dbPathResolved` shows wrong path (e.g., `/tmp/...` instead of `/data/...`)
- `dataDirectoryExists: false`
- Monitors show invoices but DB has none

**Fix:**
1. Check DigitalOcean console for disk provisioning
2. Verify DATABASE_PATH env var is set to `/data/revenue-radar.db`
3. Redeploy

### Scenario B: Counter Desync
**Symptoms:**
- DB path is correct (`/data/...`)
- `email_monitors.invoices_created_count` > 0
- `ingestion_runs` table is empty or has fewer records

**Fix:**
1. Run `/api/debug/fix-all` to attempt auto-repair
2. Or manually reset counters in database

### Scenario C: Insert Failures
**Symptoms:**
- `email_processing_log` shows `status: 'error'` entries
- `skip_reason` shows `db_insert_failed` or similar

**Fix:**
1. Check error messages in processing logs
2. Review server logs for INSERT errors
3. Check disk space

---

## Reset Monitor Counters (if needed)

If monitors show phantom invoices, you can reset them:

```bash
# This would need to be done via database access
# Or create an admin endpoint for this

# SQL to reset all monitors:
# UPDATE email_monitors SET invoices_created_count = 0, emails_processed_count = 0;
```

---

## Check Server Logs

In DigitalOcean console, check Runtime Logs for:
- `[EMAIL-CHECK]` - Email processing logs
- `[USER_ID_TRACE]` - User ID attribution logs
- `CRITICAL` or `ERROR` - Any critical errors

---

*Last Updated: January 22, 2026*
