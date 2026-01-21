# User_ID Attribution Verification Guide

This guide covers the three verification scripts for ensuring proper user_id attribution in Revenue Radar.

## Overview

After the user_id guardrails migration, these scripts help verify that:
1. All invoices have a user_id (no NULL values)
2. Email monitors are properly attributed to users
3. The database triggers are enforcing the rules
4. User visibility works correctly

## Quick Start

```bash
# Check overall database health
node scripts/verify-user-id-attribution.js

# Diagnose a specific user's invoice visibility
node scripts/diagnose-invoice-visibility.js 5

# Test manual upload with auth
node scripts/test-manual-upload.js 5
```

---

## Script 1: verify-user-id-attribution.js

**Purpose**: System-wide health check for user_id attribution.

### Usage

```bash
node scripts/verify-user-id-attribution.js
```

### What It Does

1. **Ingestion_runs Analysis**
   - Counts NULL user_id values (should be 0)
   - Shows invoice distribution by user
   - Lists recent invoices with ownership

2. **Email_monitors Analysis**
   - Checks for NULL user_id (should be 0)
   - Shows monitors by user
   - Verifies monitor ownership

3. **Trigger Verification**
   - Confirms all 4 user_id enforcement triggers exist:
     - `enforce_ingestion_runs_user_id` (INSERT)
     - `enforce_ingestion_runs_user_id_update` (UPDATE)
     - `enforce_email_monitors_user_id` (INSERT)
     - `enforce_email_monitors_user_id_update` (UPDATE)

4. **Invoice Items Analysis**
   - Checks for orphaned items (missing run_id reference)
   - Verifies items are accessible through ownership chain

5. **Summary**
   - ✓ Status of all checks
   - ✓ Recommendations for fixes

### Sample Output

```
================================================================
USER_ID ATTRIBUTION VERIFICATION REPORT
================================================================
Database: /path/to/revenue-radar.db
Generated: 2026-01-21T12:00:00.000Z

[1] INGESTION_RUNS TABLE ANALYSIS
✓ Records with NULL user_id: 0
✓ Records by user_id (top 10):
    - User 1: 42 invoices (admin@example.com)
    - User 5: 18 invoices (user@example.com)

[2] EMAIL_MONITORS TABLE ANALYSIS
✓ Records with NULL user_id: 0
✓ Monitors by user_id:
    - User 1: 2 monitors
    - User 5: 1 monitor

[3] DATABASE TRIGGERS VERIFICATION
✓ Found 4 triggers:
    ✓ enforce_ingestion_runs_user_id
    ✓ enforce_ingestion_runs_user_id_update
    ✓ enforce_email_monitors_user_id
    ✓ enforce_email_monitors_user_id_update

[6] SUMMARY & RECOMMENDATIONS
✓ STATUS:
  ✓ All invoices have user_id set
  ✓ All email monitors have user_id set
  ✓ Database triggers enforcing user_id are in place

✓ NEXT STEPS:
  ✓ Database is in good shape! No fixes needed.
  ✓ User_id attribution guardrails are working correctly.
```

### When to Run

- After deploying the migration
- After any data bulk operations
- When investigating user_id related issues
- Regularly (daily/weekly) as a health check

### Success Criteria

- NULL user_id count: 0
- All 4 triggers exist
- User distribution looks reasonable (no data consolidation)

---

## Script 2: diagnose-invoice-visibility.js

**Purpose**: Detailed diagnostic for a specific user's invoice visibility.

### Usage

```bash
# By user ID
node scripts/diagnose-invoice-visibility.js 5

# By email address
node scripts/diagnose-invoice-visibility.js --email user@example.com

# Help
node scripts/diagnose-invoice-visibility.js --help
```

### What It Does

When a user reports "My Invoices shows 0" or missing data:

1. **User Verification**
   - Finds and confirms the user exists

2. **Ingestion_runs Count**
   - Total invoices for user
   - Breakdown by status (processing, completed, failed)
   - Last 5 recent invoices with details

3. **Email_monitors Check**
   - Lists monitors for the user
   - Shows activation status and success counts

4. **Data Consistency**
   - Checks for orphaned items
   - Verifies no NULL user_id records
   - Validates monitor data integrity

5. **Issue Detection**
   - Identifies common problems:
     - No invoices + monitors configured → Email parsing not working
     - Items but no invoices → Data corruption
     - NULL user_id → Trigger bypass or old data
   
6. **Suggested Fixes**
   - Specific SQL queries to run
   - Steps to verify email monitors
   - Frontend debugging advice

### Sample Output

```
======================================================================
INVOICE VISIBILITY DIAGNOSTIC
======================================================================
Generated: 2026-01-21T12:00:00.000Z

User: user@example.com (ID: 5, Name: John Doe)

[1] INGESTION_RUNS (Invoices)
✓ Total invoices for this user: 18
✓ Breakdown by status:
    - completed: 15
    - failed: 2
    - processing: 1

✓ Recent invoices (last 5):
    1. 2026-01-20 - Cintas ($1,250.00) [completed]
       ID: 42, run_id: upload-abc123
    2. 2026-01-19 - Amazon ($856.50) [completed]
       ID: 41, run_id: email-2-1234567890

[2] EMAIL_MONITORS
✓ Total monitors for this user: 1
✓ Email monitors:
    1. invoices@mycompany.com [🟢 active]
       Created: 2026-01-15, Invoices created: 8

[4] POTENTIAL ISSUES & SUGGESTIONS
✓ User has 18 invoices - visibility should work.
  If user still sees 0 invoices:
  1. Check frontend filtering logic in my-invoices.html
  2. Verify /api/uploads/recent endpoint returns these invoices
  3. Check browser console for JavaScript errors
  4. Clear browser cache and reload
```

### When to Run

- When a user reports "My Invoices shows 0"
- When investigating invoice visibility bugs
- To verify email monitor is working
- Before filing a support ticket

### Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| Invoices in DB but not visible in UI | Frontend filtering | Check my-invoices.html, clear cache |
| Monitors configured but 0 invoices | Email parsing failing | Check email_processing_log |
| User ID mismatch | Manual data operations | Run fix-user-id-attribution.js |
| Orphaned items | Database corruption | Contact support |

---

## Script 3: test-manual-upload.js

**Purpose**: End-to-end test of manual invoice upload with authentication.

### Usage

```bash
# Upload as user 1 with test fixture
node scripts/test-manual-upload.js 1

# Upload as user 5 with specific file
node scripts/test-manual-upload.js 5 /path/to/invoice.pdf

# List available test fixtures
node scripts/test-manual-upload.js --list-fixtures

# Help
node scripts/test-manual-upload.js --help
```

### What It Does

1. **User Verification**
   - Confirms user exists in database

2. **Invoice File Check**
   - Verifies PDF file exists
   - Shows file size

3. **Authentication Setup**
   - Creates test JWT token
   - Displays token for curl testing

4. **Upload Simulation**
   - Shows what parameters would be used
   - Provides curl command to use

5. **Pre-Upload Verification**
   - Shows current invoice count for user
   - Lists recent invoices

6. **Post-Upload Verification Queries**
   - SQL queries to check success
   - Debugging commands

7. **Testing Checklist**
   - Step-by-step instructions
   - curl commands to run
   - Verification steps

### Sample Output

```
======================================================================
MANUAL INVOICE UPLOAD TEST
======================================================================
Generated: 2026-01-21T12:00:00.000Z

[1] USER VERIFICATION
✓ User verified: user@example.com (ID: 5)

[2] INVOICE FILE VERIFICATION
✓ Invoice file: test-invoice.pdf
  Size: 245678 bytes
  Path: /path/to/test-invoice.pdf

[3] AUTHENTICATION TOKEN
✓ Test JWT token created
  User ID: 5
  Expires in: 1 hour

[4] INVOICE PROCESSING
✓ Simulated upload parameters:
  run_id: upload-1611234567890-test
  user_id: 5
  file: test-invoice.pdf

📝 To perform actual upload, use curl:

  curl -X POST http://localhost:5050/api/uploads \
    -H "Authorization: Bearer eyJhbGc..." \
    -F "file=@/path/to/test-invoice.pdf"

[5] CURRENT DATABASE STATE
✓ Current invoices for user 5: 18

[6] POST-UPLOAD VERIFICATION QUERIES
📋 After uploading, verify success with:

  # Check new invoice was created
  SELECT * FROM ingestion_runs WHERE user_id = 5 ORDER BY created_at DESC LIMIT 1;

  # Verify user_id is set (should be 5)
  SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id IS NULL;

[7] TESTING CHECKLIST
✓ Step 1: Start server
  node server.js

✓ Step 2: Upload invoice with token
  curl -X POST http://localhost:5050/api/uploads \
    -H "Authorization: Bearer ..." \
    -F "file=@/path/to/test-invoice.pdf"
```

### How to Use for Testing

```bash
# 1. Start server in one terminal
node server.js

# 2. In another terminal, prepare test
node scripts/test-manual-upload.js 5

# 3. Copy curl command and run it
curl -X POST http://localhost:5050/api/uploads \
  -H "Authorization: Bearer ..." \
  -F "file=@/path/to/invoice.pdf"

# 4. Verify in database
sqlite3 revenue-radar.db "SELECT * FROM ingestion_runs WHERE user_id = 5 ORDER BY created_at DESC LIMIT 1;"

# 5. Run full diagnostic
node scripts/diagnose-invoice-visibility.js 5
```

### When to Run

- After deploying authentication changes
- When testing manual upload flow
- To verify triggers are working
- During QA of invoice parsing
- For debugging upload failures

---

## Complete Testing Workflow

### Scenario 1: System-Wide Verification After Deployment

```bash
# 1. Check database health
node scripts/verify-user-id-attribution.js

# Expected: All checks pass, 0 NULL user_ids, all triggers present
```

### Scenario 2: User Reports "My Invoices Shows 0"

```bash
# 1. Get diagnostic info
node scripts/diagnose-invoice-visibility.js --email user@example.com

# 2. Follow suggestions from script output
# 3. If database issue found:
#    - Check data with: node scripts/verify-user-id-attribution.js
#    - Review my-invoices.html endpoint: /api/uploads/recent
#    - Check browser developer tools

# 4. If email monitor issue:
#    - Review email_processing_log
#    - Check IMAP credentials
#    - Verify invoice keywords filter
```

### Scenario 3: Testing New Upload Path

```bash
# 1. Prepare test
node scripts/test-manual-upload.js 5 /path/to/invoice.pdf

# 2. Start server
node server.js

# 3. Run curl command from script output

# 4. Verify success
sqlite3 revenue-radar.db "SELECT * FROM ingestion_runs WHERE user_id = 5 ORDER BY created_at DESC LIMIT 1;"

# 5. Check items were parsed
node scripts/diagnose-invoice-visibility.js 5
```

---

## Database Queries Reference

### Check NULL user_ids (should return 0)
```sql
SELECT COUNT(*) FROM ingestion_runs WHERE user_id IS NULL;
SELECT COUNT(*) FROM email_monitors WHERE user_id IS NULL;
```

### Get all invoices for a user
```sql
SELECT id, run_id, vendor_name, status, created_at 
FROM ingestion_runs 
WHERE user_id = 5 
ORDER BY created_at DESC;
```

### Get invoice items for a user
```sql
SELECT ii.id, ii.description, ii.quantity, ii.unit_price_cents, ir.vendor_name
FROM invoice_items ii
JOIN ingestion_runs ir ON ii.run_id = ir.id
WHERE ir.user_id = 5
ORDER BY ir.created_at DESC;
```

### Check monitor activity
```sql
SELECT em.id, em.email_address, epl.status, COUNT(*) as count
FROM email_monitors em
LEFT JOIN email_processing_log epl ON em.id = epl.monitor_id
WHERE em.user_id = 5
GROUP BY em.id, epl.status;
```

### Find recent failures
```sql
SELECT id, run_id, error_message, created_at
FROM ingestion_runs
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 10;
```

---

## Troubleshooting

### Script fails to connect to database

**Error**: `Error: Database not found at /path/to/revenue-radar.db`

**Fix**: 
```bash
# Check database exists
ls -la revenue-radar.db

# Or set custom path
DB_PATH=/path/to/database.sqlite3 node scripts/verify-user-id-attribution.js
```

### Trigger check shows missing triggers

**Error**: `Only X user_id triggers found (expected 4)`

**Fix**: Run the migration
```bash
node run-migration.js migrations/add-user-id-guardrails.sql
```

### Script shows NULL user_id values

**Error**: `Found N records with NULL user_id`

**Fix**:
1. Review the records shown in the output
2. Determine correct user_id for each
3. Update manually or run a bulk fix query
4. Re-run script to verify

### Diagnostic shows "No invoices found"

**Possible Causes**:
1. User has never uploaded invoices
2. Email monitors not configured
3. Email parsing is failing
4. Data corruption

**Steps**:
```bash
# Check email monitors
node scripts/diagnose-invoice-visibility.js 5

# If monitors exist, check email_processing_log
sqlite3 revenue-radar.db \
  "SELECT * FROM email_processing_log WHERE monitor_id IN (SELECT id FROM email_monitors WHERE user_id = 5);"

# Try manual upload test
node scripts/test-manual-upload.js 5
```

---

## Tips & Best Practices

1. **Run verify-user-id-attribution.js weekly** as a health check
2. **Always run diagnostic before filing a support ticket** about missing invoices
3. **Use test-manual-upload.js when troubleshooting upload flow** changes
4. **Save script output when reporting issues** (copy/paste to support)
5. **Check email_processing_log when email monitors aren't working**
6. **Clear browser cache** before debugging visibility issues
7. **Verify triggers exist** after database migrations

---

## Contact & Support

If scripts reveal issues:
1. Save full output: `node scripts/verify-user-id-attribution.js > report.txt`
2. Run diagnostic: `node scripts/diagnose-invoice-visibility.js <user_id> >> report.txt`
3. Attach report to support ticket
4. Include: Node version, database size, number of users

---

## See Also

- `/migrations/add-user-id-guardrails.sql` - The migration that added these guardrails
- `/database.js` - Database schema and setup
- `/api-routes.js` - API endpoints for invoice data
- `/dashboard/my-invoices.html` - Frontend displaying user invoices
