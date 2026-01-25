# Invoice Parsing System - Complete Analysis for Debugging

## THE PROBLEM

**Sysco Invoice 082825.pdf**:
- **Expected Total**: $1,748.85 (shown on PDF at bottom: "INVOICE TOTAL 1748.85")
- **Actual Parsed Total**: $1,747.30 (WRONG - this is GROUP TOTAL, not INVOICE TOTAL)
- **Expected Vendor**: "Sysco Corporation"
- **Actual Vendor**: "Unknown Vendor" (WRONG)

The parser is picking up the wrong total (a GROUP TOTAL or department subtotal) instead of the actual INVOICE TOTAL printed at the bottom of the PDF.

---

## SYSTEM ARCHITECTURE

### Data Flow
```
PDF Upload
    ↓
POST /ingest (server.js:2557)
    ↓
universal-invoice-processor.js → extractTextFromPDF() → raw text
    ↓
invoice-parser.js → parseInvoice()
    ↓
IF INVOICE_PARSER_V2=true:
    services/invoice_parsing_v2/index.js → parseInvoiceText()
        ↓
    vendorDetector.js → detectVendor() → "sysco" or "generic"
        ↓
    IF sysco: syscoParser.js → parseSyscoInvoice()
        ↓
    totals.js → extractTotalsByLineScan()
        ↓
    Returns: { vendorName, totals: { totalCents }, lineItems }
    ↓
server.js:3235-3276 → selectBestTotal() → invoiceTotalCents
    ↓
server.js:3202-3230 → vendorName extraction (priority chain)
    ↓
INSERT INTO ingestion_runs (invoice_total_cents, vendor_name)
```

---

## KEY FILES AND THEIR ROLES

### 1. server.js (Main Entry Point)

**Location**: `/server.js`

**POST /ingest endpoint** (line 2557):
- Receives PDF/image uploads
- Calls `universal-invoice-processor.js` for text extraction
- Calls `invoice-parser.js` for parsing
- Stores results in SQLite database

**Vendor Name Extraction** (lines 3202-3230):
```javascript
// Priority order for vendor name:
// 1. parsedInvoice.vendorName (V2 parser)
// 2. parsedInvoice.vendor.name
// 3. canonical.parties.vendor.name
// 4. canonical.parties.supplier.name
// 5. 'Unknown Vendor' (fallback)

let vendorName = 'Unknown Vendor';

if (parsedInvoice && parsedInvoice.vendorName && parsedInvoice.vendorName !== 'Unknown Vendor') {
  vendorName = parsedInvoice.vendorName;
}
// ... more fallbacks
```

**Total Selection** (lines 3235-3276):
```javascript
const { extractTotalsByLineScan, computeInvoiceMath, reconcileTotals, selectBestTotal } = require('./services/invoice_parsing_v2/totals');

// Extract totals directly from raw text using line scan
const lineScanTotals = rawText ? extractTotalsByLineScan(rawText) : null;

// Get parser and canonical totals
const parserTotalCents = parsedInvoice?.totals?.totalCents || 0;

// Select best total using priority chain
const bestTotal = selectBestTotal(lineScanTotals, computed, parserTotalCents);
invoiceTotalCents = bestTotal.totalCents;
```

---

### 2. invoice-parser.js (Parser Router)

**Location**: `/invoice-parser.js`

**V2 Parser Toggle** (line 24):
```javascript
const USE_PARSER_V2 = process.env.INVOICE_PARSER_V2 === 'true';
```

**Main Function** (line 48):
```javascript
function parseInvoice(text, options = {}) {
  // V2 Parser (if enabled)
  if (USE_PARSER_V2 || options.useV2) {
    const v2 = getParserV2();
    const v2Result = v2.parseInvoiceText(text, { debug: true });

    if (v2Result.success && v2Result.confidence?.score >= 50) {
      // Convert and return V2 result
      return { ... };
    }
  }

  // V1 Parser (fallback)
  // ...
}
```

---

### 3. services/invoice_parsing_v2/index.js (V2 Parser Main)

**Location**: `/services/invoice_parsing_v2/index.js`

**Main Function** `parseInvoiceText()` (line 45):

**Step 1**: Text Normalization
```javascript
const normalizedText = normalizeInvoiceText(rawText);
const pages = splitIntoPages(normalizedText);
```

**Step 2**: Vendor Detection (line 67-72)
```javascript
const vendorInfo = detectVendor(fullText);
// Returns: { vendorKey: 'sysco', vendorName: 'Sysco Corporation', confidence: 95 }
```

**Step 3**: Route to Vendor-Specific Parser (line 112-134)
```javascript
if (vendorInfo.vendorKey === 'sysco') {
  const syscoResult = parseSyscoInvoice(fullText, options);
  candidates.push(syscoResult);
}
```

**Step 7**: Build Final Result (lines 328-366)
```javascript
// PRIORITY ORDER for vendor name:
// 1. vendorInfo.vendorName (from vendorDetector) - HIGHEST priority
// 2. bestResult.vendorDetection?.vendorName
// 3. bestResult.header?.vendorName
// 4. Infer from vendorKey (e.g., 'sysco' → 'Sysco Corporation')

let finalVendorName = 'Unknown Vendor';

if (vendorInfo.vendorName && vendorInfo.vendorName !== 'Unknown Vendor') {
  finalVendorName = vendorInfo.vendorName;
}
// ... fallbacks
```

---

### 4. services/invoice_parsing_v2/vendorDetector.js

**Location**: `/services/invoice_parsing_v2/vendorDetector.js`

**Sysco Detection Patterns** (lines 23-48):
```javascript
sysco: {
  patterns: [
    { regex: /SYSCO\s+CORPORATION/i, score: 95 },
    { regex: /SYSCO\s+FOOD\s+SERVICES/i, score: 95 },
    { regex: /SYSCO\s+EASTERN/i, score: 95 },
    { regex: /SYSCO\s+\w+,?\s*(LLC|INC|CORP)/i, score: 90 },
    { regex: /SYSCO/i, score: 70 },
    { regex: /800-SYSCOCS/i, score: 85 },
    { regex: /GROUP\s+TOTAL\*{3,}/i, score: 75 },
    { regex: /FUEL\s+SURCHARGE/i, score: 80 },
    { regex: /DROP\s+SIZE\s+ALLOWANCE/i, score: 85 },
    // ... more patterns
  ],
  name: 'Sysco Corporation'
}
```

**Detection Function** (line 83):
```javascript
function detectVendor(normalizedText) {
  // Score each vendor based on pattern matches
  // Return highest confidence match (>= 50%)
  // Otherwise return { vendorKey: 'generic', vendorName: 'Unknown Vendor' }
}
```

---

### 5. services/invoice_parsing_v2/parsers/syscoParser.js

**Location**: `/services/invoice_parsing_v2/parsers/syscoParser.js`

**extractSyscoTotals()** (line 628) - THE CRITICAL FUNCTION:

```javascript
function extractSyscoTotals(text, lines) {
  const totals = {
    subtotalCents: 0,
    taxCents: 0,
    totalCents: 0,
    currency: 'USD',
    candidates: []
  };

  // ========== SYSCO-SPECIFIC PATTERN (HIGHEST PRIORITY) ==========
  // Sysco always uses "INVOICE TOTAL" near the bottom

  // PATTERN 1A: "INVOICE" alone, then "TOTAL value" on next line
  // Example: line N = "INVOICE", line N+1 = "TOTAL 1748.85"
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 50); i--) {
    const line = lines[i].trim();
    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';

    // Skip GROUP TOTAL lines
    if (/GROUP\s+TOTAL/i.test(line)) continue;

    if (/^INVOICE\s*$/i.test(line)) {
      const totalMatch = nextLine.match(/^TOTAL[\s:]*\$?([\d,]+\.?\d{0,3})/i);
      if (totalMatch && !/GROUP|SUBTOTAL/i.test(nextLine)) {
        const value = parseMoney(totalMatch[1]);
        if (value > 100 && value < 100000000) {
          totals.totalCents = value;
          break;
        }
      }
    }

    // PATTERN 2: "INVOICE TOTAL" with value on same line
    const sameLineMatch = line.match(/INVOICE[\s\r\n]*TOTAL[\s:]*\$?([\d,]+\.?\d{0,3})/i);
    if (sameLineMatch && !/GROUP/i.test(line)) {
      const value = parseMoney(sameLineMatch[1]);
      if (value > 100 && value < 100000000) {
        totals.totalCents = value;
        break;
      }
    }
  }

  // ========== UNIVERSAL TOTAL FINDER (FALLBACK) ==========
  if (totals.totalCents === 0) {
    const universalResult = findInvoiceTotal(text);
    // ...
  }
}
```

---

### 6. services/invoice_parsing_v2/totals.js

**Location**: `/services/invoice_parsing_v2/totals.js`

**extractTotalsByLineScan()** (line 110) - Used by server.js directly:

```javascript
function extractTotalsByLineScan(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const totalCandidates = [];

  // SPLIT-LINE PATTERNS (HIGHEST PRIORITY = -2)

  // PATTERN A: "INVOICE" alone on line N, "TOTAL value" on line N+1 (Sysco format)
  if (/^INVOICE\s*$/i.test(lineNorm)) {
    const totalValueMatch = nextLine ? nextLine.match(/^TOTAL[\s:]*\$?([\d,]+\.?\d{0,3})/i) : null;
    if (totalValueMatch && !/GROUP|SUBTOTAL/i.test(nextLine)) {
      totalCandidates.push({
        cents,
        priority: -2,  // HIGHEST priority
        name: 'INVOICE + TOTAL (split-line)',
      });
    }
  }

  // PATTERN B: "TOTAL USD" alone on line N, value on line N+1 (Cintas format)
  if (/^TOTAL\s+USD\s*$/i.test(lineNorm)) {
    // ...
  }

  // Select best candidate (lowest priority number = highest priority)
  totalCandidates.sort((a, b) => a.priority - b.priority);
  const best = totalCandidates[0];
  totalCents = best.cents;
}
```

**isGroupSubtotalLine()** (line 72):
```javascript
function isGroupSubtotalLine(line) {
  const groupPatterns = [
    /GROUP\s+TOTAL/i,
    /CATEGORY\s+TOTAL/i,
    /SECTION\s+TOTAL/i,
    /DEPT\.?\s+TOTAL/i,
    /DEPARTMENT\s+TOTAL/i,
    /^\d{4}\s+[A-Z]+\s+[A-Z]+\s+SUBTOTAL/i,  // 0001 JOHN DOE SUBTOTAL
    /^[A-Z]+\s+[A-Z]+\s+SUBTOTAL\s*-?\s*[\d,\.]+$/i,  // JOHN DOE SUBTOTAL
  ];

  return groupPatterns.some(p => p.test(line));
}
```

**selectBestTotal()** (line 519):
```javascript
function selectBestTotal(extracted, computed, parsedTotalCents = 0) {
  // Priority 1: Line-scan extracted total (printed on invoice)
  if (extracted?.totalCents > 0) {
    return { totalCents: extracted.totalCents, source: 'extracted' };
  }

  // Priority 2: Parser's total
  if (parsedTotalCents > 0) {
    return { totalCents: parsedTotalCents, source: 'parser' };
  }

  // Priority 3: Computed total (items + tax + fees)
  // ...
}
```

---

## THE LIKELY BUGS

### Bug 1: Vendor Not Being Detected
The vendorDetector.js should detect "Sysco" with high confidence because of patterns like:
- `SYSCO EASTERN MARYLAND LLC` → matches `/SYSCO\s+EASTERN/i` (score: 95)
- `SYSCO` keyword alone → matches `/SYSCO/i` (score: 70)

**Possible Issue**: The PDF text extraction might be mangling the text, so "SYSCO" isn't being found.

### Bug 2: Wrong Total Being Selected
The Sysco invoice has:
- **GROUP TOTAL**: $1,747.30 (department subtotal - WRONG)
- **INVOICE TOTAL**: $1,748.85 (actual invoice total - CORRECT)

The parser is picking up $1,747.30 because:
1. The `isGroupSubtotalLine()` function might not be filtering "GROUP TOTAL" correctly
2. The split-line pattern for "INVOICE" + "TOTAL 1748.85" might not be matching
3. The PDF text extraction might have the text in an unexpected format

### Bug 3: Production Environment Variable
The production server at `/root/app` needs `INVOICE_PARSER_V2=true` in its `.env` file. Without this, the V1 parser is used (which has worse vendor detection).

---

## HOW TO DEBUG

### Step 1: Check if V2 Parser is Active
On production server, run:
```bash
curl -s https://quietsignallayer.duckdns.org/api/public-v2-status | jq
```

Expected:
```json
{
  "v2_enabled": true,
  "v2_available": true,
  "message": "✅ V2 PARSER IS ACTIVE"
}
```

If `v2_enabled: false`, add to `/root/app/.env`:
```
INVOICE_PARSER_V2=true
```

Then restart: `pm2 restart revenue-radar`

### Step 2: Check PM2 Logs
```bash
pm2 logs revenue-radar --lines 200 | grep -E "(VENDOR|TOTALS|PARSER)"
```

Look for:
- `[VENDOR DETECT] Selected: Sysco Corporation (XX% confidence)`
- `[SYSCO TOTALS] Found INVOICE/TOTAL split: "INVOICE" + "TOTAL 1748.85"`
- `[PARSER V2 ACTIVATED]`

### Step 3: Extract Raw PDF Text
To see what the PDF text looks like after extraction:
```javascript
// In universal-invoice-processor.js, add logging:
console.log('=== RAW PDF TEXT ===');
console.log(text);
console.log('=== END RAW PDF TEXT ===');
```

---

## DATABASE SCHEMA

### ingestion_runs (invoice headers)
```sql
CREATE TABLE ingestion_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT UNIQUE,
  user_id INTEGER,
  account_name TEXT,
  vendor_name TEXT,          -- "Sysco Corporation" or "Unknown Vendor"
  file_name TEXT,
  status TEXT,               -- 'processing' | 'completed' | 'failed'
  invoice_total_cents INTEGER, -- THE TOTAL WE'RE DEBUGGING
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### invoice_items (line items)
```sql
CREATE TABLE invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER,            -- FK to ingestion_runs.id
  description TEXT,
  quantity REAL,
  unit_price_cents INTEGER,
  total_cents INTEGER,
  category TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## SYSCO INVOICE FORMAT (EXPECTED)

A typical Sysco invoice text looks like:
```
DELIVERY COPY                        CONFIDENTIAL PROPERTY OF SYSCO
                                     8/28/25
YELLOWFINS BAR&GRI  MILLSBORO
36908 SILICATO DR STE 14
MILLSBORO         DE   19966

SYSCO EASTERN MARYLAND, LLC
33300 PEACH ORCHARD ROAD
POCOMOKE CITY, MD  21851
800-737-2627 (800-SYSCOCS)

QTY  PACK  SIZE  ITEM DESCRIPTION             ITEM    UNIT    EXT
                                              CODE    PRICE   PRICE
--------------------------------------------------------------------------------
1    CS    25 LB  HSAUTRY BREADING MIX SEAFOOD  4438321  27.88   27.88
28   ONLYIGAL    SYS CLS DRESSING COLESLAW      4002499  19.39   38.78
...

GROUP TOTAL****                                              1747.30

MISC CHARGES    ALLOWANCE FOR DROP SIZE                       4.35-
                CHGS FOR FUEL SURCHARGE                       5.90

INVOICE                                         LINE ITEMS    INVOICE TOTAL
TOTAL                                           20            $1,748.85

                                    LAST PAGE
```

**Key Pattern**: "INVOICE" on one line, "TOTAL" + value on next line = $1,748.85 (CORRECT)
**Trap**: "GROUP TOTAL****" earlier = $1,747.30 (WRONG - this is a department subtotal)

---

## RECENT FIXES (Already Deployed)

1. **server.js:3202-3230** - Added priority chain for vendor name extraction
2. **totals.js:198-235** - Added split-line patterns with priority -2 (highest)
3. **syscoParser.js:637-723** - Added Sysco-specific INVOICE/TOTAL split pattern
4. **api-routes.js** - Added `/api/public-v2-status` endpoint (no auth required)

---

## QUESTIONS FOR DEBUGGING

1. **Is INVOICE_PARSER_V2=true set in production `/root/app/.env`?**
2. **What does the raw PDF text look like?** Is "SYSCO" present? Is "INVOICE" and "TOTAL 1748.85" on separate lines?
3. **What do the PM2 logs show?** Is V2 parser being activated? Is vendor being detected?
4. **Is the regex `/^INVOICE\s*$/i` matching the line?** Maybe there's trailing whitespace or non-printable characters.

---

## TEST SCRIPT

Create a test script to debug locally:

```javascript
// test-sysco-parse.js
const fs = require('fs');
const { processInvoice } = require('./universal-invoice-processor');
const { parseInvoice } = require('./invoice-parser');

async function test() {
  // Read the problematic PDF
  const pdfBuffer = fs.readFileSync('./test-invoices/Sysco082825.pdf');

  // Step 1: Extract text
  const extracted = await processInvoice(pdfBuffer, 'test.pdf');
  console.log('=== EXTRACTED TEXT (first 2000 chars) ===');
  console.log(extracted.raw_text?.slice(0, 2000));

  // Step 2: Parse
  const parsed = parseInvoice(extracted.raw_text, { useV2: true });
  console.log('=== PARSED RESULT ===');
  console.log('Vendor:', parsed.vendor?.name);
  console.log('Total:', parsed.totals?.totalCents / 100);
  console.log('Items:', parsed.items?.length);
}

test().catch(console.error);
```

Run: `INVOICE_PARSER_V2=true node test-sysco-parse.js`

---

## ENVIRONMENT VARIABLES

```bash
# Required for V2 parser
INVOICE_PARSER_V2=true

# Production server
# Location: /root/app/.env
```

---

## SUMMARY

The system has multiple layers of total extraction:
1. **Vendor-specific parser** (syscoParser.js) extracts totals
2. **Line-scan** (totals.js) also extracts totals from raw text
3. **selectBestTotal()** chooses between line-scan, parser, and computed totals

The bug is likely:
1. V2 parser not enabled (missing `INVOICE_PARSER_V2=true`)
2. OR: The PDF text extraction splits "INVOICE TOTAL" in a way the regex doesn't match
3. OR: "GROUP TOTAL" is being selected because it appears before "INVOICE TOTAL" and has higher priority somehow

The fix needs to ensure the split-line pattern `/^INVOICE\s*$/i` + next line `/^TOTAL[\s:]*\$?([\d,]+)/i` correctly captures $1,748.85.
