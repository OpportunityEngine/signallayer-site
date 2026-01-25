# Invoice 082825.pdf Total Discrepancy - Investigation Report

## Issue Summary
- **Invoice**: 082825.pdf
- **Expected Total**: $1,748.85
- **Actual Total Shown**: $1,747.30
- **Discrepancy**: $1.55 (0.09% difference)

## Investigation Steps

### Step 1: Access Production Server Logs

You need to SSH to the production server to check what the Universal Total Finder extracted.

**Option A: Direct SSH (if configured)**
```bash
# Replace with your actual server details
ssh your-user@your-production-server.com
```

**Option B: DigitalOcean Console**
1. Go to DigitalOcean Dashboard
2. Navigate to your app
3. Click "Console" tab
4. Click "Open Console"

### Step 2: Check PM2 Logs

Once connected to production:

```bash
# Search for logs related to invoice 082825
pm2 logs ai-sales-backend --lines 500 --nostream | grep -E "082825" -A 20 -B 5

# Or search for Universal Total Finder output
pm2 logs ai-sales-backend --lines 1000 --nostream | grep -E "UNIVERSAL TOTAL FINDER|SYSCO TOTALS|TOTAL FINDER" -A 10 -B 2

# Save logs to file for detailed review
pm2 logs ai-sales-backend --lines 2000 --nostream > /tmp/all_logs.txt
```

### Step 3: Look for These Specific Log Entries

The Universal Total Finder (see `universalTotalFinder.js`) logs:

```
[UNIVERSAL TOTAL FINDER] Searching N lines, M characters
[TOTAL FINDER] Strategy 1 (Label Patterns): X candidates
[TOTAL FINDER] Strategy 2 (Bottom Scan): X candidates
[TOTAL FINDER] Strategy 3 (Column/Footer): X candidates
...
[TOTAL FINDER] Top candidates by combined score:
  1. $1,748.85 - maxScore=95, totalScore=350, strategies=[...]
  2. $1,747.30 - maxScore=90, totalScore=280, strategies=[...]
[TOTAL FINDER] SELECTED: $1,747.30 with 90% confidence (3 strategies agree)
```

**Key Questions:**
1. Did the finder see both $1,748.85 and $1,747.30?
2. Which one had the higher score?
3. What strategies found each value?
4. What label/context was near each value?

### Step 4: Get the Raw Invoice Text (if needed)

If logs don't have enough detail:

```bash
# On production server
sqlite3 /path/to/database.sqlite

# Query to get the extracted text
SELECT pdf_raw_text FROM ingestion_runs 
WHERE file_name LIKE '%082825%' 
ORDER BY created_at DESC LIMIT 1;

# Save to file
.output /tmp/invoice_082825_text.txt
SELECT pdf_raw_text FROM ingestion_runs 
WHERE file_name LIKE '%082825%' 
ORDER BY created_at DESC LIMIT 1;
.quit
```

Then download the file and analyze locally.

### Step 5: Run Local Debug Script

We created a debug script at: `/Users/taylorray/Desktop/ai-sales-backend/debug-invoice-total.js`

**Usage:**
```bash
# If you have the extracted text file:
node debug-invoice-total.js /tmp/invoice_082825_text.txt

# This will show:
# - What total was selected
# - Top 5 candidate totals with scores
# - Whether $1,748.85, $1,747.30, and $1.55 appear in the text
# - Context around each amount
```

## Likely Root Causes

### Hypothesis 1: GROUP TOTAL Misidentification
**Probability**: High

Sysco invoices have department/group subtotals. The parser tries to exclude these (see `syscoParser.js:48` and `universalTotalFinder.js:69`).

**What might have happened:**
- $1,747.30 might be a "GROUP TOTAL" or department subtotal
- The exclusion pattern didn't catch it because:
  - Label format was slightly different (e.g., "DEPT TOTAL", "CATEGORY TOTAL")
  - "GROUP" and "TOTAL" were on separate lines
  - Extra spaces/formatting between words

**Fix**: Enhance GROUP TOTAL detection patterns

### Hypothesis 2: Scoring Algorithm Preference
**Probability**: Medium

The Universal Total Finder uses multiple strategies and combines scores. Maybe $1,747.30:
- Appeared earlier in the document (bottom scan scored it higher)
- Had a stronger label like "TOTAL DUE" or "AMOUNT DUE"
- Was found by more strategies (consensus bias)

While $1,748.85:
- Only appeared once with "INVOICE TOTAL" label
- Was on the very last line (position bonus not enough)

**Fix**: Increase scoring for "INVOICE TOTAL" label specifically

### Hypothesis 3: Multi-Line Pattern Failed
**Probability**: Low

Sysco sometimes splits labels and values across lines:
```
INVOICE
TOTAL
1748.85
```

If the pattern matcher failed here, it might have missed the correct total.

**Fix**: Improve multi-line regex patterns

### Hypothesis 4: Tax/Fee Included in Wrong Total
**Probability**: Low

The $1.55 difference is suspiciously specific. It might be:
- Sales tax on certain items
- Fuel surcharge
- Delivery fee

That was:
- Included in $1,748.85 (correct)
- But extracted separately, and parser used pre-tax subtotal $1,747.30

**Fix**: Ensure all adjustments are properly included in total reconciliation

## Code Locations for Fixes

| File | Lines | Purpose |
|------|-------|---------|
| `universalTotalFinder.js` | 61-73 | SUBTOTAL_LABELS - add more exclusion patterns |
| `universalTotalFinder.js` | 144-226 | findByLabelPatterns - check GROUP TOTAL exclusion |
| `universalTotalFinder.js` | 509-516 | Sysco-specific regex patterns |
| `universalTotalFinder.js` | 863-871 | Scoring/ranking logic |
| `syscoParser.js` | 628-785 | extractSyscoTotals - uses Universal Finder |

## Next Actions

1. **IMMEDIATE**: Get production logs to see what the finder actually extracted
2. **ANALYZE**: Determine which hypothesis is correct based on logs
3. **FIX**: Update the appropriate code based on root cause
4. **TEST**: Create a test fixture for invoice 082825.pdf
5. **VERIFY**: Re-run parser to confirm it now extracts $1,748.85

## Test Fixture Template

Once you have the invoice, create a test:

```javascript
// In test/fixtures/sysco/
// File: invoice_082825_total_discrepancy.txt

describe('Sysco Invoice 082825 - Total Extraction', () => {
  it('should extract correct total of $1,748.85 not $1,747.30', () => {
    const text = fs.readFileSync(__dirname + '/fixtures/082825_text.txt', 'utf8');
    const result = findInvoiceTotal(text);
    
    expect(result.totalDollars).to.equal(1748.85);
    expect(result.confidence).to.be.at.least(85);
  });
});
```

---

**Created**: 2026-01-24
**Status**: Awaiting production logs
**Priority**: High (affects invoice accuracy)
