# Database Guardrails Reference

## user_id Enforcement

### Tables with user_id Guardrails

1. **ingestion_runs** - Every invoice must have an owner
2. **email_monitors** - Every monitor must have an owner

### How It Works

The database uses triggers to enforce user_id NOT NULL at the database level:

```sql
-- Prevents NULL user_id on INSERT
CREATE TRIGGER enforce_ingestion_runs_user_id
BEFORE INSERT ON ingestion_runs
FOR EACH ROW
WHEN NEW.user_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'ingestion_runs.user_id cannot be NULL - every invoice must have an owner');
END;

-- Prevents NULL user_id on UPDATE
CREATE TRIGGER enforce_ingestion_runs_user_id_update
BEFORE UPDATE ON ingestion_runs
FOR EACH ROW
WHEN NEW.user_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'ingestion_runs.user_id cannot be NULL - every invoice must have an owner');
END;
```

### Error Messages

If you try to insert/update with NULL user_id:

```
Error: ingestion_runs.user_id cannot be NULL - every invoice must have an owner
```

### For Developers

**When creating an invoice:**
```javascript
// ❌ BAD - Will fail with trigger error
db.prepare(`
  INSERT INTO ingestion_runs (run_id, account_name, status)
  VALUES (?, ?, ?)
`).run(runId, accountName, status);

// ✅ GOOD - Always include user_id
db.prepare(`
  INSERT INTO ingestion_runs (run_id, user_id, account_name, status)
  VALUES (?, ?, ?, ?)
`).run(runId, userId, accountName, status);
```

**When creating from email monitor:**
```javascript
// Get user_id from the monitor
const monitor = db.prepare('SELECT user_id FROM email_monitors WHERE id = ?').get(monitorId);

// Use monitor.user_id for the invoice
db.prepare(`
  INSERT INTO ingestion_runs (run_id, user_id, account_name, vendor_name, status)
  VALUES (?, ?, ?, ?, ?)
`).run(runId, monitor.user_id, accountName, vendorName, 'processing');
```

**When creating from file upload:**
```javascript
// Get user_id from the authenticated user
const userId = req.user.id;  // From JWT/session

db.prepare(`
  INSERT INTO ingestion_runs (run_id, user_id, file_name, status)
  VALUES (?, ?, ?, ?)
`).run(runId, userId, fileName, 'processing');
```

### Email Monitor run_id Pattern

Email-based invoices have a special run_id format:

```
email-{monitorId}-{timestamp}
```

Example: `email-1-1769037296348`

The backfill migration extracts the monitorId and looks up the user_id:

```sql
-- Extract monitor_id from run_id
CAST(
  SUBSTR(
    ingestion_runs.run_id,
    7,  -- Start after 'email-'
    INSTR(SUBSTR(ingestion_runs.run_id, 7), '-') - 1  -- Length until next dash
  ) AS INTEGER
)
```

### Debugging NULL user_id Issues

**Check for NULL values:**
```sql
SELECT COUNT(*) FROM ingestion_runs WHERE user_id IS NULL;
SELECT COUNT(*) FROM email_monitors WHERE user_id IS NULL;
```

**Find orphaned invoices:**
```sql
SELECT id, run_id, account_name, vendor_name, created_at
FROM ingestion_runs
WHERE user_id IS NULL
ORDER BY created_at DESC
LIMIT 10;
```

**Fix orphaned email-based invoices:**
```sql
UPDATE ingestion_runs
SET user_id = (
  SELECT em.user_id
  FROM email_monitors em
  WHERE em.id = CAST(
    SUBSTR(ingestion_runs.run_id, 7, INSTR(SUBSTR(ingestion_runs.run_id, 7), '-') - 1)
  AS INTEGER)
)
WHERE user_id IS NULL
  AND run_id LIKE 'email-%';
```

**Assign orphaned uploads to admin:**
```sql
UPDATE ingestion_runs
SET user_id = 1  -- admin user
WHERE user_id IS NULL
  AND run_id LIKE 'upload-%';
```

### Testing the Guardrails

Run the test suite:
```bash
node test-user-id-guardrails.js
```

Expected output:
- ✅ All ingestion_runs have valid user_id
- ✅ All email_monitors have valid user_id
- ✅ Triggers prevent NULL on INSERT
- ✅ Triggers prevent NULL on UPDATE
- ✅ All 4 tests pass

### Common Pitfalls

1. **Forgetting to set user_id in batch operations**
   ```javascript
   // ❌ BAD
   for (const invoice of invoices) {
     db.prepare('INSERT INTO ingestion_runs ...').run(...);  // Missing user_id!
   }

   // ✅ GOOD
   const userId = getCurrentUserId();
   for (const invoice of invoices) {
     db.prepare('INSERT INTO ingestion_runs (user_id, ...) VALUES (?, ...)').run(userId, ...);
   }
   ```

2. **Copying code from old examples**
   - Old code may not include user_id
   - Always check the schema and include user_id

3. **Testing with demo data**
   - Ensure demo data includes user_id
   - Use user 1 (admin) for test data

### Future Guardrails

Consider adding similar triggers for:
- `opportunities.assigned_to` - Every opportunity must be assigned
- `email_monitors.created_by_user_id` - Track who created each monitor
- `mlas.last_reviewed_by` - Track who reviewed MLAs

### Related Files

- `/migrations/add-user-id-guardrails.sql` - The migration SQL
- `/test-user-id-guardrails.js` - Test suite
- `/run-migration.js` - Migration runner
- `/database.js` - Integrated migration (runs on startup)
