# Database Migration Quick Start

## Run a Migration

```bash
# Run a specific migration
node run-migration.js migrations/add-user-id-guardrails.sql

# Test the migration
node test-user-id-guardrails.js
```

## Check Database State

```bash
# Check for NULL user_id in invoices
sqlite3 revenue-radar.db "SELECT COUNT(*) FROM ingestion_runs WHERE user_id IS NULL"

# Check for NULL user_id in monitors
sqlite3 revenue-radar.db "SELECT COUNT(*) FROM email_monitors WHERE user_id IS NULL"

# List all triggers
sqlite3 revenue-radar.db "SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger'"

# Show trigger definition
sqlite3 revenue-radar.db "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'enforce_ingestion_runs_user_id'"
```

## Manual Backfill (if needed)

```bash
# Backfill email-based invoices
sqlite3 revenue-radar.db "
UPDATE ingestion_runs
SET user_id = (
  SELECT em.user_id FROM email_monitors em
  WHERE em.id = CAST(SUBSTR(run_id, 7, INSTR(SUBSTR(run_id, 7), '-') - 1) AS INTEGER)
)
WHERE user_id IS NULL AND run_id LIKE 'email-%';
"

# Backfill upload-based invoices to admin
sqlite3 revenue-radar.db "UPDATE ingestion_runs SET user_id = 1 WHERE user_id IS NULL AND run_id LIKE 'upload-%'"
```

## Test Trigger Enforcement

```bash
# This should fail with "user_id cannot be NULL" error
sqlite3 revenue-radar.db "INSERT INTO ingestion_runs (run_id, user_id) VALUES ('test', NULL)"
```

## View Trigger Code

```bash
# Show all user_id enforcement triggers
sqlite3 revenue-radar.db ".mode line" "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%enforce%user_id%'"
```

## Backup Database

```bash
# Manual backup
cp revenue-radar.db "revenue-radar.db.backup-$(date +%Y%m%d-%H%M%S)"

# The run-migration.js script creates automatic backups
# Look for: revenue-radar.db.backup-{timestamp}
```

## Common Issues

### Issue: "no such table: ingestion_runs"
**Solution:** Make sure you're using the correct database file path
```bash
# Check which DB file exists
ls -lh *.db

# Set DB_PATH environment variable
export DB_PATH=/path/to/revenue-radar.db
```

### Issue: Migration already applied
**Solution:** Migrations are idempotent. Safe to re-run.
```bash
# Check if triggers exist
sqlite3 revenue-radar.db "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%enforce%user_id%'"
# Output: 4 (means migration already applied)
```

### Issue: NULL user_id values still present
**Solution:** Run backfill manually
```bash
# Check how many NULL values
sqlite3 revenue-radar.db "SELECT COUNT(*) FROM ingestion_runs WHERE user_id IS NULL"

# Run backfill (see "Manual Backfill" section above)

# Verify fixed
sqlite3 revenue-radar.db "SELECT COUNT(*) FROM ingestion_runs WHERE user_id IS NULL"
# Output: 0
```

## Files Reference

| File | Purpose |
|------|---------|
| `migrations/add-user-id-guardrails.sql` | Migration SQL (can be run standalone) |
| `run-migration.js` | Migration runner with backup/rollback |
| `test-user-id-guardrails.js` | Test suite (4 tests) |
| `migrations/README.md` | Full documentation |
| `migrations/GUARDRAILS.md` | Developer reference |
| `TASK-4-SUMMARY.md` | Implementation summary |

## Next Steps

After running the migration:

1. **Verify it worked:**
   ```bash
   node test-user-id-guardrails.js
   ```

2. **Check the code:**
   - All `INSERT INTO ingestion_runs` must include `user_id`
   - All `INSERT INTO email_monitors` must include `user_id`

3. **Monitor for errors:**
   - Watch logs for trigger rejection errors
   - These indicate code bugs that need fixing

4. **Update documentation:**
   - Ensure all code examples include `user_id`
   - Add comments explaining the constraint
