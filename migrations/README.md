# Database Migrations

This directory contains SQL migration files for the Revenue Radar database.

## Migration Files

### add-user-id-guardrails.sql

**Purpose:** Add database-level guardrails to prevent NULL user_id on critical tables.

**Problem Solved:**
- Invoices (ingestion_runs) and email monitors were being created with NULL user_id
- This broke visibility (users couldn't see their own invoices)
- No database-level enforcement existed to prevent this bug

**What It Does:**
1. Backfills NULL user_id values in ingestion_runs:
   - Email-based invoices: Extracts monitor_id from run_id, looks up user_id from email_monitors
   - Upload-based invoices: Assigns to user 1 (admin) for manual review
   - Any remaining NULLs: Assigns to user 1 (admin)

2. Creates triggers to enforce user_id NOT NULL:
   - `enforce_ingestion_runs_user_id` - Prevents INSERT with NULL user_id
   - `enforce_ingestion_runs_user_id_update` - Prevents UPDATE to NULL user_id
   - Same triggers for email_monitors table

3. Adds indexes for performance:
   - `idx_ingestion_runs_run_id` - For run_id pattern matching

**Running the Migration:**

The migration runs automatically on server startup (integrated into `database.js`).

To run manually:
```bash
node run-migration.js migrations/add-user-id-guardrails.sql
```

**Testing:**

```bash
node test-user-id-guardrails.js
```

Expected output:
- All ingestion_runs have valid user_id (0 NULLs)
- All email_monitors have valid user_id (0 NULLs)
- Triggers prevent NULL user_id on INSERT/UPDATE
- All tests pass (4/4)

**Rollback:**

The migration is safe and idempotent. It only adds data (backfill) and constraints (triggers).

To remove triggers (not recommended):
```sql
DROP TRIGGER IF EXISTS enforce_ingestion_runs_user_id;
DROP TRIGGER IF EXISTS enforce_ingestion_runs_user_id_update;
DROP TRIGGER IF EXISTS enforce_email_monitors_user_id;
DROP TRIGGER IF EXISTS enforce_email_monitors_user_id_update;
```

**Impact:**
- Low risk - only adds constraints, doesn't modify schema
- No performance impact - triggers are lightweight
- Prevents future bugs from NULL user_id

---

### add-invoice-total.sql

**Purpose:** Add invoice_total_cents column to store parser-extracted totals.

**What It Does:**
- Adds `invoice_total_cents` column to ingestion_runs
- Creates index for performance
- Backfills existing rows from sum of invoice_items

---

### add-signup-requests.sql

**Purpose:** Add signup_requests table for admin approval workflow.

**What It Does:**
- Creates signup_requests table
- Adds indexes for performance

---

### add-trial-limits.sql

**Purpose:** Add trial/freemium tracking fields to users table.

**What It Does:**
- Adds trial_started_at, trial_expires_at, trial_invoices_used columns
- Adds subscription_status column
- Creates indexes for trial queries

---

## Migration Best Practices

1. **Always test migrations locally first**
   ```bash
   cp revenue-radar.db revenue-radar.db.backup
   node run-migration.js migrations/your-migration.sql
   ```

2. **Migrations should be idempotent**
   - Use `IF NOT EXISTS` for tables/indexes
   - Use `DROP TRIGGER IF EXISTS` before CREATE TRIGGER
   - Check for existing data before backfilling

3. **Include verification queries**
   - Add comments showing how to verify the migration succeeded
   - Example: `SELECT COUNT(*) FROM table WHERE column IS NULL;`

4. **Document the migration**
   - What problem does it solve?
   - What changes does it make?
   - How to verify it worked?
   - How to rollback if needed?

5. **Use transactions for multi-step migrations**
   - The run-migration.js script wraps all statements in a transaction
   - If any step fails, the entire migration rolls back

6. **Create a backup before running**
   - The run-migration.js script automatically creates a timestamped backup
   - Keep backups for at least 30 days

---

## Migration Runner

The `run-migration.js` script provides:
- Automatic backup before migration
- Transaction-wrapped execution
- Error handling with rollback
- Verification queries

Usage:
```bash
node run-migration.js migrations/your-migration.sql
```

---

## Testing Migrations

Each migration should have a test script:

1. Create `test-your-migration.js`
2. Test all constraints and triggers
3. Verify data integrity
4. Check performance impact

Example:
```bash
node test-user-id-guardrails.js
```

---

## Database Schema

See the main schema files for reference:
- `database-schema.sql` - Core tables
- `database-schema-email-autopilot.sql` - Email monitoring tables
- `database-schema-business-intel.sql` - Analytics tables
- `database-schema-events-catering.sql` - Events tables
- `database-schema-intent-signals.sql` - Intent signals tables
- `database-schema-cogs-coding.sql` - COGS categorization tables
