# User_ID Attribution Verification Scripts

## Summary

Three comprehensive scripts have been created to verify and debug user_id attribution in the Revenue Radar database. These scripts support the user_id guardrails migration and help diagnose invoice visibility issues.

## Scripts Created

### 1. `scripts/verify-user-id-attribution.js`
**System-wide health check for user_id attribution**

```bash
node scripts/verify-user-id-attribution.js
```

Checks:
- NULL user_id counts (should be 0)
- Invoice distribution by user
- Email monitor ownership
- Database trigger existence (4 required)
- Invoice items orphan status
- Overall system health

**Use Case**: Run after deployment, or weekly as a health check.

**Output**: Formatted report with status indicators and recommendations.

---

### 2. `scripts/diagnose-invoice-visibility.js`
**Detailed diagnostic for a specific user's invoice visibility**

```bash
# By user ID
node scripts/diagnose-invoice-visibility.js 5

# By email address
node scripts/diagnose-invoice-visibility.js --email user@example.com
```

Checks:
- User verification
- Invoice count and status breakdown
- Email monitor configuration
- Data consistency (orphans, NULLs)
- Identifies common issues
- Suggests specific fixes

**Use Case**: When a user reports "My Invoices shows 0" or missing data.

**Output**: Actionable diagnostic with problem identification and remediation steps.

---

### 3. `scripts/test-manual-upload.js`
**End-to-end test for manual invoice upload with authentication**

```bash
# Upload as user 1 with test fixture
node scripts/test-manual-upload.js 1

# Upload as user 5 with specific file
node scripts/test-manual-upload.js 5 /path/to/invoice.pdf
```

Checks:
- User existence in database
- Invoice file validity
- JWT token creation
- Pre/post-upload database state
- Verification queries
- Step-by-step testing checklist

**Use Case**: Testing upload flow, verifying triggers, QA after changes.

**Output**: Upload simulation with curl commands and verification steps.

---

## Quick Start

```bash
# 1. Check overall database health
node scripts/verify-user-id-attribution.js

# 2. Diagnose specific user issue
node scripts/diagnose-invoice-visibility.js 5

# 3. Test upload flow
node scripts/test-manual-upload.js 5
```

## Files

| File | Lines | Purpose |
|------|-------|---------|
| `scripts/verify-user-id-attribution.js` | 235 | System health check |
| `scripts/diagnose-invoice-visibility.js` | 345 | User-specific diagnostic |
| `scripts/test-manual-upload.js` | 210 | Upload flow testing |
| `scripts/USER-ID-VERIFICATION-GUIDE.md` | 750+ | Comprehensive guide |
| `VERIFICATION-SCRIPTS-README.md` | This file | Quick reference |

## Key Features

### Comprehensive Reporting
- Color-coded status indicators (✓, ✗, ⚠)
- Formatted output with section headers
- Real data examples from database
- Actionable next steps

### Smart Diagnostics
- Identifies root causes (not just symptoms)
- Suggests specific SQL queries
- Provides frontend debugging tips
- Database repair command suggestions

### Error Handling
- Graceful failures with helpful messages
- Database path auto-detection
- File existence validation
- User lookup by ID or email

### Production Ready
- No side effects (read-only operations)
- Proper error messages
- Executable with proper permissions
- Works with custom database paths via `DB_PATH` env var

## Usage Examples

### Scenario 1: Post-Deployment Verification
```bash
# After deploying add-user-id-guardrails.sql migration
node scripts/verify-user-id-attribution.js

# Expected output:
# ✓ Records with NULL user_id: 0
# ✓ All 4 triggers exist
# ✓ Database is in good shape! No fixes needed.
```

### Scenario 2: User Reports Missing Invoices
```bash
# Get detailed diagnostic
node scripts/diagnose-invoice-visibility.js --email user@example.com

# Output will show:
# - Invoice count by status
# - Recent invoices with details
# - Email monitor configuration
# - Suggested debugging steps
# - Specific SQL queries to run
```

### Scenario 3: Testing After Code Changes
```bash
# Start fresh diagnostic
node scripts/verify-user-id-attribution.js

# Test upload flow for specific user
node scripts/test-manual-upload.js 5

# Follow the testing checklist provided
# Run final verification
node scripts/diagnose-invoice-visibility.js 5
```

## Database Triggers Verified

These scripts verify that 4 critical database triggers exist:

```
✓ enforce_ingestion_runs_user_id (INSERT)
✓ enforce_ingestion_runs_user_id_update (UPDATE)
✓ enforce_email_monitors_user_id (INSERT)
✓ enforce_email_monitors_user_id_update (UPDATE)
```

If triggers are missing, run the migration:
```bash
node run-migration.js migrations/add-user-id-guardrails.sql
```

## Output Examples

### verify-user-id-attribution.js Output
```
================================================================
USER_ID ATTRIBUTION VERIFICATION REPORT
================================================================

[1] INGESTION_RUNS TABLE ANALYSIS
✓ Records with NULL user_id: 0
✓ Records by user_id (top 10):
    - User 1: 42 invoices (admin@example.com)
    - User 5: 18 invoices (user@example.com)

[3] DATABASE TRIGGERS VERIFICATION
✓ Found 4 triggers:
    ✓ enforce_ingestion_runs_user_id
    ✓ enforce_ingestion_runs_user_id_update
    ...
```

### diagnose-invoice-visibility.js Output
```
======================================================================
INVOICE VISIBILITY DIAGNOSTIC
======================================================================
User: user@example.com (ID: 5, Name: John Doe)

[1] INGESTION_RUNS (Invoices)
✓ Total invoices for this user: 18
✓ Recent invoices (last 5):
    1. 2026-01-20 - Cintas ($1,250.00) [completed]
    2. 2026-01-19 - Amazon ($856.50) [completed]

[4] POTENTIAL ISSUES & SUGGESTIONS
✓ User has 18 invoices - visibility should work.
  If user still sees 0 invoices:
  1. Check frontend filtering logic
  2. Clear browser cache
  3. Verify /api/uploads/recent endpoint
```

## Troubleshooting

### Script Can't Connect to Database
```bash
# Check database exists
ls -la revenue-radar.db

# Or use custom path
DB_PATH=/path/to/db.sqlite3 node scripts/verify-user-id-attribution.js
```

### Missing Triggers
```bash
# Run the migration
node run-migration.js migrations/add-user-id-guardrails.sql

# Then verify
node scripts/verify-user-id-attribution.js
```

### User Not Found
```bash
# Check user exists in database
sqlite3 revenue-radar.db "SELECT id, email FROM users WHERE id = 5;"

# Or search by email
node scripts/diagnose-invoice-visibility.js --email user@example.com
```

## Integration with Development Workflow

### Daily Monitoring
```bash
# Add to daily checks
node scripts/verify-user-id-attribution.js > daily-health-check.log
```

### Debugging User Issues
```bash
# When user reports problem
node scripts/diagnose-invoice-visibility.js --email user@company.com

# Follow suggestions from output
# Run specific SQL queries if needed
# Share output with support team
```

### Testing After Changes
```bash
# Before deployment
node scripts/verify-user-id-attribution.js

# After feature changes
node scripts/test-manual-upload.js 5

# Verify no regressions
node scripts/verify-user-id-attribution.js
```

## Requirements

- Node.js (with better-sqlite3 support)
- better-sqlite3 package (already in project)
- jsonwebtoken package (for test-manual-upload.js)
- Read access to revenue-radar.db

## Environment Variables

```bash
# Custom database path
DB_PATH=/path/to/custom.db node scripts/verify-user-id-attribution.js

# Custom JWT secret (for test-manual-upload.js)
JWT_SECRET=your-secret node scripts/test-manual-upload.js 5
```

## Related Files

- `/migrations/add-user-id-guardrails.sql` - The migration that added guardrails
- `/database.js` - Database initialization and schema
- `/api-routes.js` - API endpoints for invoice data
- `/dashboard/my-invoices.html` - Frontend invoice display

## Support

For detailed documentation:
- See `scripts/USER-ID-VERIFICATION-GUIDE.md` for comprehensive guide
- See individual script files for inline documentation

For issues:
1. Save script output: `node scripts/verify-user-id-attribution.js > report.txt`
2. Run diagnostic: `node scripts/diagnose-invoice-visibility.js <user_id> >> report.txt`
3. Include in support ticket
