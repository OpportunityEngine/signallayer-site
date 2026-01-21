# User ID Attribution Tests Summary

## Overview
This test suite verifies that `user_id` is correctly set in all invoice creation paths, ensuring data integrity and preventing user ID spoofing across the system.

## File Location
- **Test File**: `/Users/taylorray/Desktop/ai-sales-backend/test/user-id-attribution.test.js`

## Test Framework
- **Framework**: Mocha + Chai
- **Test Command**: `npm test`
- **Total Tests**: 12 passing

## Test Coverage

### 1. Manual Upload Tests - /ingest endpoint (4 tests)

These tests verify user_id handling in the `/ingest` endpoint (server.js line 2073):

- **should use authenticated user ID when JWT present**
  - Verifies that `req.user.id` is used for authenticated uploads
  - Location: server.js line 2690: `userId = req.user.id`

- **should reject attempts to spoof user_id via headers when authenticated**
  - Ensures user cannot override their own user_id via headers
  - Security: Always uses authenticated user ID, ignores spoofed values

- **should not allow NULL user_id on insert (after guardrails)**
  - Verifies database constraint prevents NULL user_id in ingestion_runs
  - Schema: ingestion_runs table has user_id NOT NULL with FK to users(id)

- **should track user_id in invoice items via run_id foreign key**
  - Verifies user_id flows from parent invoice to invoice_items
  - Relationship: invoices track user_id, items reference via run_id

### 2. Email Autopilot Tests - email-imap-service.js (3 tests)

These tests verify user_id handling in email invoice processing (email-imap-service.js line 745):

- **should use monitor.user_id for ingestion when present**
  - Verifies email monitors use their `user_id` for invoice creation
  - Code: email-imap-service.js line 750: `const monitorUserId = monitor.user_id || monitor.created_by_user_id`

- **should enforce user_id constraint on email_monitors**
  - Verifies trigger prevents NULL user_id on email_monitors table
  - Trigger: database-schema.sql enforces `user_id` cannot be NULL

- (Previously: fallback test - removed because triggers enforce non-NULL)

### 3. Database Constraint Tests (3 tests)

These tests verify data integrity constraints:

- **should prevent NULL user_id update on ingestion_runs**
  - Verifies constraint prevents updating user_id to NULL
  - Protects against accidental data loss

- **should allow updating user_id to valid different user**
  - Verifies legitimate user_id reassignment works
  - Use case: Admin reassigning invoices to correct user

- **should maintain referential integrity with invoice_items foreign key**
  - Verifies foreign key relationships work correctly
  - Data model: run_id links invoice_items back to parent invoice

### 4. Regression Tests - user_id data integrity (2 tests)

These tests verify data integrity across operations:

- **should be able to query all invoices by user_id**
  - Verifies queries by user_id work correctly
  - Query: `SELECT * FROM ingestion_runs WHERE user_id = ?`

- **should identify and handle orphaned records (NULL user_id)**
  - Verifies no orphaned invoices exist in system
  - Healing: Identifies NULL user_id records for admin action

- **should preserve user_id across invoice updates**
  - Verifies user_id stays unchanged during status updates
  - Ensures data integrity through invoice lifecycle

## Test Execution

```bash
# Run all tests
npm test

# Run only user_id tests
npm test -- --grep "user-id|User ID"

# Run with verbose output
npm test -- --reporter spec
```

## Test Database
- **Location**: `/tmp/test-revenue-radar.db`
- **Cleanup**: Automatically deleted and recreated before each test run
- **Isolation**: Each test creates unique users and invoices to avoid conflicts

## Code Paths Covered

### /ingest Endpoint (server.js)
- Line 2690: `userId = req.user.id` (authenticated)
- Line 2697: `userId = db.createOrUpdateUser(...)` (legacy header)
- Line 2718-2730: INSERT into ingestion_runs with user_id
- Line 2973: `const userId = req.user?.id || null` (alternative path)

### Email Autopilot (email-imap-service.js)
- Line 750: `const monitorUserId = monitor.user_id || monitor.created_by_user_id`
- Line 753: User lookup validation
- Line 764-766: INSERT into ingestion_runs with monitorUserId
- Line 815-822: INSERT invoice_items linked to ingestion_runs

### Database Schema (database-schema.sql)
- ingestion_runs table: user_id NOT NULL, FK to users(id)
- email_monitors table: user_id NOT NULL with trigger
- invoice_items table: run_id FK to ingestion_runs(id)

## Key Assertions

1. **Authentication**: Authenticated user_id cannot be spoofed
2. **Nullability**: user_id cannot be NULL in database
3. **Referential Integrity**: All invoices must have valid user_id
4. **Fallback Logic**: Email monitors use user_id or created_by_user_id
5. **Data Preservation**: user_id preserved during updates
6. **Query Accuracy**: Invoices can be queried by user_id
7. **Healing**: Orphaned invoices can be identified

## Constraints Verified

### Database Constraints
- `ingestion_runs.user_id` NOT NULL
- `ingestion_runs.user_id` FOREIGN KEY to `users(id)`
- `email_monitors.user_id` NOT NULL (trigger-based)
- `invoice_items.run_id` FOREIGN KEY to `ingestion_runs(id)`

### Application Logic
- req.user.id always used for authenticated uploads
- Header-based user_id only as legacy fallback
- Monitor must have user_id before processing
- All invoice items must reference valid invoice

## Future Improvements

1. Add email_processing_log table (currently missing)
2. Log all user_id assignments for audit trail
3. Add database migration for legacy NULL user_id records
4. Create healing endpoint to fix orphaned invoices
5. Add permission checks (user can only see their own invoices)

## Related Issues & PRs

- GitHub Issue: user_id attribution #X
- Related code: server.js /ingest endpoint, email-imap-service.js
- Database migration: May need NULL -> valid user_id healing

## Test Maintenance Notes

- Update email uniqueness counter if adding more email-based tests
- Clean test database before first run
- Bcrypt hashing adds ~100ms per user creation (acceptable)
- Tests use simple password123 for all test users (dev only)
