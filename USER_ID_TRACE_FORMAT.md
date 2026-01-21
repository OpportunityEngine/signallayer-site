# User ID Trace Log Format Reference

All user_id attribution logs follow the `[USER_ID_TRACE]` prefix with structured key-value pairs.

## Log Format Pattern
```
[USER_ID_TRACE] key1=value1 key2=value2 key3=value3
```

## Common Fields

| Field | Description | Example |
|-------|-------------|---------|
| `source` | Where the invoice came from | `manual_upload`, `email_autopilot`, `email_check_service` |
| `userId` | Final user ID used | `1`, `42` |
| `email` | User email address | `taylor@example.com` |
| `authMethod` | Authentication method (manual uploads only) | `jwt`, `header` |
| `action` | Database action being performed | `insert_ingestion_run`, `insert_failed_ingestion_run` |
| `runId` | Ingestion run identifier | `1737485000000`, `email-4-1737485550000` |
| `monitorId` | Email monitor ID (email only) | `4`, `12` |
| `monitorUserId` | Email monitor's user_id field | `1`, `null` |
| `monitorCreatedBy` | Email monitor's created_by_user_id | `1` |
| `resolvedUserId` | Computed user_id from monitor | `1` |
| `finalUserId` | Final user after DB lookup | `1` |
| `error` | Error type if failed | `user_not_found` |
| `attemptedUserId` | User ID that was attempted | `99` |

## Log Examples by Source

### Manual Upload (JWT Auth)
```
[USER_ID_TRACE] source=manual_upload userId=1 email=taylor@example.com authMethod=jwt
[USER_ID_TRACE] source=manual_upload action=insert_ingestion_run runId=1737485000000 userId=1 email=taylor@example.com
```

### Manual Upload (Header Auth - Legacy)
```
[USER_ID_TRACE] source=manual_upload userId=1 email=taylor@example.com authMethod=header
[USER_ID_TRACE] source=manual_upload action=insert_ingestion_run runId=1737485123456 userId=1 email=taylor@example.com
```

### Manual Upload (Failed)
```
[USER_ID_TRACE] source=manual_upload userId=1 email=taylor@example.com authMethod=jwt
[USER_ID_TRACE] source=manual_upload action=insert_failed_ingestion_run runId=1737485999999 userId=1 email=taylor@example.com
```

### Email Autopilot (IMAP Service - Success)
```
[USER_ID_TRACE] source=email_autopilot monitorId=4 monitorUserId=1 monitorCreatedBy=1 resolvedUserId=1
[USER_ID_TRACE] source=email_autopilot monitorId=4 finalUserId=1 email=taylor@example.com
[USER_ID_TRACE] source=email_autopilot action=insert_ingestion_run runId=email-4-1737485550000 userId=1 email=taylor@example.com monitorId=4
```

### Email Autopilot (User Not Found Error)
```
[USER_ID_TRACE] source=email_autopilot monitorId=4 monitorUserId=99 monitorCreatedBy=99 resolvedUserId=99
[USER_ID_TRACE] source=email_autopilot error=user_not_found attemptedUserId=99
```

### Email Check Service
```
[USER_ID_TRACE] source=email_check_service monitorId=4 monitorUserId=1 finalUserId=1 email=taylor@example.com
[USER_ID_TRACE] source=email_check_service action=insert_ingestion_run runId=email-4-1737485550123-abc123 userId=1 email=taylor@example.com monitorId=4
```

## Grep Commands for Common Scenarios

### Find all traces for a specific user
```bash
grep "USER_ID_TRACE.*userId=1" logs/server.log
grep "USER_ID_TRACE.*email=taylor@example.com" logs/server.log
```

### Find all email autopilot traces
```bash
grep "USER_ID_TRACE.*source=email_autopilot" logs/server.log
```

### Find all manual uploads
```bash
grep "USER_ID_TRACE.*source=manual_upload" logs/server.log
```

### Find all ingestion_run inserts
```bash
grep "USER_ID_TRACE.*action=insert_ingestion_run" logs/server.log
```

### Find traces for a specific monitor
```bash
grep "USER_ID_TRACE.*monitorId=4" logs/server.log
```

### Find traces for a specific run
```bash
grep "USER_ID_TRACE.*runId=email-4-1737485550000" logs/server.log
```

### Find errors
```bash
grep "USER_ID_TRACE.*error=" logs/server.log
```

### Find JWT vs header auth usage
```bash
grep "USER_ID_TRACE.*authMethod=jwt" logs/server.log
grep "USER_ID_TRACE.*authMethod=header" logs/server.log
```

## Troubleshooting Flow

### Problem: Invoice created but not visible to user

1. **Find the invoice** - Check `/api/debug/user-id-audit` for recent inserts
2. **Get the run_id** - Note the `run_id` from the audit response
3. **Search logs** - `grep "runId=XXXXX" logs/server.log | grep USER_ID_TRACE`
4. **Verify user_id** - Check all trace logs show the correct `userId` throughout
5. **Check database** - `SELECT * FROM ingestion_runs WHERE run_id = 'XXXXX'`

### Problem: NULL user_id in database

1. **Check audit endpoint** - Look at `summary.nullUserIdCount` and `sourceBreakdown`
2. **Find affected source** - Which source has `null_user_count > 0`?
3. **Search for missing traces** - `grep "USER_ID_TRACE.*source=XXXX" | grep "action=insert"`
4. **Look for gaps** - Missing `action=insert_ingestion_run` trace means code path bypassed logging
5. **Check for errors** - `grep "USER_ID_TRACE.*error" logs/server.log`

### Problem: Wrong user attribution

1. **Identify the invoice** - Get run_id from My Invoices or audit endpoint
2. **Trace the flow** - `grep "runId=XXXXX" logs/server.log | grep USER_ID_TRACE`
3. **For email autopilot:**
   - Check `monitorUserId` matches `finalUserId`
   - Verify `monitorCreatedBy` is correct
   - Confirm `resolvedUserId` logic is working
4. **For manual upload:**
   - Check `authMethod` - is it using the right auth?
   - Verify JWT token has correct user info
   - Check if header fallback is being used unintentionally

## Integration with Debug Endpoint

The `/api/debug/user-id-audit` endpoint provides aggregated data. Use it together with trace logs:

1. **Endpoint shows WHAT** - Which users have how many invoices, NULL counts, source breakdown
2. **Logs show HOW** - Exact flow of user_id through the system for each invoice
3. **Combined view** - Endpoint identifies patterns, logs explain individual cases

Example workflow:
```bash
# Step 1: Get overview
curl http://localhost:5050/api/debug/user-id-audit | jq .summary

# Step 2: If nullUserIdCount > 0, check which source
curl http://localhost:5050/api/debug/user-id-audit | jq .sourceBreakdown

# Step 3: Look at recent inserts for that source
curl http://localhost:5050/api/debug/user-id-audit | jq '.recentInserts[] | select(.ingest_source == "email_autopilot")'

# Step 4: Find logs for that specific run
grep "runId=email-4-1737485550000" logs/server.log | grep USER_ID_TRACE
```
