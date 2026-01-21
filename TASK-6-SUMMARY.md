# TASK 6: User ID Attribution Observability - COMPLETED

## Summary
Added comprehensive logging at all critical points where `user_id` is determined and used for invoice ingestion. This creates an audit trail that makes it easy to debug user_id attribution issues across manual uploads and email autopilot.

## Changes Made

### 1. server.js - Manual Upload Tracing
Added `[USER_ID_TRACE]` logging at 4 locations:

**Lines 2693, 2700** - Auth method detection:
```javascript
console.log(`[USER_ID_TRACE] source=manual_upload userId=${userId} email=${userEmail} authMethod=jwt`);
console.log(`[USER_ID_TRACE] source=manual_upload userId=${userId} email=${userEmail} authMethod=header`);
```

**Line 2719** - Successful ingestion_runs insert:
```javascript
console.log(`[USER_ID_TRACE] source=manual_upload action=insert_ingestion_run runId=${run_id} userId=${userId} email=${userEmail}`);
```

**Line 2983** - Failed ingestion_runs insert:
```javascript
console.log(`[USER_ID_TRACE] source=manual_upload action=insert_failed_ingestion_run runId=${run_id} userId=${userId} email=${userEmail}`);
```

### 2. email-imap-service.js - Email Autopilot Tracing
Added `[USER_ID_TRACE]` logging at 4 locations:

**Line 752** - Monitor user_id resolution:
```javascript
console.log(`[USER_ID_TRACE] source=email_autopilot monitorId=${monitor.id} monitorUserId=${monitor.user_id} monitorCreatedBy=${monitor.created_by_user_id} resolvedUserId=${monitorUserId}`);
```

**Line 758** - User not found error:
```javascript
console.log(`[USER_ID_TRACE] source=email_autopilot error=user_not_found attemptedUserId=${monitorUserId}`);
```

**Line 763** - Final user confirmation:
```javascript
console.log(`[USER_ID_TRACE] source=email_autopilot monitorId=${monitor.id} finalUserId=${user.id} email=${user.email}`);
```

**Line 766** - Ingestion_runs insert:
```javascript
console.log(`[USER_ID_TRACE] source=email_autopilot action=insert_ingestion_run runId=${runId} userId=${user.id} email=${user.email} monitorId=${monitor.id}`);
```

### 3. email-check-service.js - Alternative Email Service Tracing
Added `[USER_ID_TRACE]` logging at 2 locations:

**Lines 1017-1018** - User context and insert:
```javascript
console.log(`[USER_ID_TRACE] source=email_check_service monitorId=${monitor.id} monitorUserId=${monitor.user_id} finalUserId=${user.id} email=${user.email}`);
console.log(`[USER_ID_TRACE] source=email_check_service action=insert_ingestion_run runId=${runIdText} userId=${user.id} email=${user.email} monitorId=${monitor.id}`);
```

### 4. api-routes.js - New Debug Endpoint
Added **`GET /api/debug/user-id-audit`** endpoint (line 950) with role-based access control (admin/manager only) that provides:

#### Response Structure:
```json
{
  "success": true,
  "summary": {
    "totalInvoices": 150,
    "uniqueUsers": 5,
    "nullUserIdCount": 0,
    "nullUserIdPercentage": "0%"
  },
  "sourceBreakdown": [
    {
      "source": "manual_upload",
      "count": 80,
      "null_user_count": 0
    },
    {
      "source": "email_autopilot",
      "count": 65,
      "null_user_count": 0
    },
    {
      "source": "browser_extension",
      "count": 5,
      "null_user_count": 0
    }
  ],
  "countsByUserId": [
    {
      "user_id": 1,
      "email": "taylor@example.com",
      "name": "Taylor",
      "count": 120,
      "first_invoice": "2026-01-15 10:30:00",
      "last_invoice": "2026-01-21 14:22:00"
    }
  ],
  "recentInserts": [
    {
      "id": 150,
      "run_id": "email-4-1737485550000",
      "user_id": 1,
      "account_name": "Acme Corp",
      "vendor_name": "Cintas",
      "file_name": "invoice.pdf",
      "status": "completed",
      "created_at": "2026-01-21 14:22:00",
      "user_email": "taylor@example.com",
      "user_name": "Taylor",
      "ingest_source": "email_autopilot"
    }
  ],
  "hint": "Use [USER_ID_TRACE] logs to debug attribution issues"
}
```

## Security Note
The `/api/debug/user-id-audit` endpoint requires `admin` or `manager` role to prevent unauthorized access to all users' invoice data. Regular users will receive a 403 Forbidden error.

## How to Use This for Debugging

### 1. Real-Time Debugging
Watch logs as invoices are processed:
```bash
# Terminal 1: Start server
node server.js

# Terminal 2: Filter for user_id traces
tail -f logs/server.log | grep USER_ID_TRACE
```

### 2. Debug a Specific Issue
If a user reports missing invoices:
```bash
# Check what the endpoint shows
curl http://localhost:5050/api/debug/user-id-audit | jq .

# Look at recent inserts for their email
curl http://localhost:5050/api/debug/user-id-audit | jq '.recentInserts[] | select(.user_email == "user@example.com")'

# Check logs for their specific monitor
grep "monitorId=4" logs/server.log | grep USER_ID_TRACE
```

### 3. Typical Log Flow

**Manual Upload:**
```
[USER_ID_TRACE] source=manual_upload userId=1 email=taylor@example.com authMethod=jwt
[USER_ID_TRACE] source=manual_upload action=insert_ingestion_run runId=1737485000000 userId=1 email=taylor@example.com
```

**Email Autopilot:**
```
[USER_ID_TRACE] source=email_autopilot monitorId=4 monitorUserId=1 monitorCreatedBy=1 resolvedUserId=1
[USER_ID_TRACE] source=email_autopilot monitorId=4 finalUserId=1 email=taylor@example.com
[USER_ID_TRACE] source=email_autopilot action=insert_ingestion_run runId=email-4-1737485550000 userId=1 email=taylor@example.com monitorId=4
```

## Common Issues This Helps Diagnose

### Issue 1: Invoices Created But Not Visible
**Symptoms:** Email monitor shows invoices_created_count > 0, but My Invoices shows 0

**Debug Steps:**
1. Call `/api/debug/user-id-audit`
2. Check `sourceBreakdown` - are email_autopilot invoices being created?
3. Check `countsByUserId` - which user owns them?
4. Look at `recentInserts` - do the email invoice run_ids map to correct user?
5. Check logs: `grep "monitorId=X" | grep USER_ID_TRACE`

### Issue 2: NULL user_id in Database
**Symptoms:** `summary.nullUserIdCount > 0` in audit endpoint

**Debug Steps:**
1. Check which source has `null_user_count > 0` in `sourceBreakdown`
2. Search logs for that source without a corresponding `action=insert_ingestion_run`
3. Look for error traces: `grep "USER_ID_TRACE.*error" logs/server.log`

### Issue 3: Wrong User Attribution
**Symptoms:** Invoices appear in wrong user's dashboard

**Debug Steps:**
1. Find the invoice in `recentInserts` from audit endpoint
2. Note the `run_id`
3. Search logs for that run_id: `grep "runId=email-4-1737485550000"`
4. Check all `[USER_ID_TRACE]` entries for that flow
5. Compare `monitorUserId` vs `finalUserId` - should match

## Testing Checklist

- [x] Syntax validation passes (node -c)
- [ ] Manual upload creates trace logs
- [ ] Email autopilot creates trace logs
- [ ] Debug endpoint returns data
- [ ] Debug endpoint shows correct source breakdown
- [ ] Debug endpoint identifies NULL user_id issues

## Files Modified
1. `/server.js` - 4 trace logs added (lines 2693, 2700, 2719, 2983)
2. `/email-imap-service.js` - 4 trace logs added (lines 752, 758, 763, 766)
3. `/email-check-service.js` - 2 trace logs added (lines 1017, 1018)
4. `/api-routes.js` - New endpoint added (line 950)

## Next Steps
1. Test the audit endpoint with real data
2. Monitor logs during next email check cycle
3. Add trace logs to browser extension if needed
4. Consider adding metrics/alerting for NULL user_id spikes
