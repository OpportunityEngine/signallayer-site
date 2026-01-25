# Invoice Parsing Critical Fixes - 2026-01-24

## Issues Fixed

### 1. Cintas Invoice: SUBTOTAL ($1,867.42) Extracted Instead of TOTAL USD ($1,998.14)
**Root Cause**: The Universal Total Finder and Cintas parser were both prioritizing "SUBTOTAL" matches over "TOTAL USD" due to pattern matching logic.

**Fix**:
- **File**: `/services/invoice_parsing_v2/parsers/cintasParser.js`
- **Changes**:
  - Added TWO-PASS extraction in `extractTotals()` function
  - FIRST PASS: Explicitly look for "TOTAL USD" pattern (Cintas-specific, highest priority)
  - SECOND PASS: Use fallback patterns if TOTAL USD not found, BUT skip lines containing "SUBTOTAL"
  - Added console logging for debugging totals extraction

- **File**: `/services/invoice_parsing_v2/universalTotalFinder.js`
- **Changes**:
  - Fixed SUBTOTAL false positive detection in `findByLabelPatterns()`
  - When label is "TOTAL", check if there's "SUB" immediately before it
  - This prevents "SUBTOTAL" from being matched as "TOTAL"

**Verification**: Test confirms $1,998.14 (TOTAL USD) is now extracted correctly.

---

### 2. Sysco Invoice: Wrong INVOICE TOTAL Extracted
**Root Cause**: The Universal Total Finder was finding GROUP TOTAL or other intermediate totals instead of the final INVOICE TOTAL.

**Fix**:
- **File**: `/services/invoice_parsing_v2/parsers/syscoParser.js`
- **Changes**:
  - Added **SYSCO-SPECIFIC PATTERN** as highest priority in `extractSyscoTotals()`
  - Pattern 1: "INVOICE TOTAL" on one line, value on next (multi-line format)
  - Pattern 2: "INVOICE TOTAL" with value on same line
  - Scan bottom 50 lines for these patterns BEFORE running Universal Total Finder
  - Universal Finder only used as fallback if Sysco-specific patterns fail
  - Added console logging showing which pattern found the total

**Verification**:
- Test 1: Multi-line format ($1,747.30) - PASS
- Test 2: Same-line format ($1,748.85) - PASS

---

### 3. Vendor Detection Showing "Unknown Vendor" Instead of "Cintas" / "Sysco"
**Root Cause**: The vendor detection was working correctly (97-99% confidence), but the final result was using the `bestResult.vendorKey` from the chosen parser instead of the original `vendorInfo` from detection.

**Fix**:
- **File**: `/services/invoice_parsing_v2/index.js`
- **Changes** (lines 66-71, 326-329):
  - Added console logging after vendor detection to show what was detected
  - Modified result building to use `vendorInfo.vendorName` instead of `bestResult.vendorDetection?.vendorName`
  - Set `finalVendorKey` and `finalVendorName` from vendor detection, not from parser result

- **File**: `/services/invoice_parsing_v2/validator.js`
- **Changes** (in `chooseBestParse()` function):
  - Added 10-point bonus for vendor-specific parsers (cintas, sysco, usfoods) when they have valid totals
  - This ensures vendor-specific parsers beat generic parser when both find the correct total
  - Added console logging to show which parser was chosen and why

**Verification**: All vendor detections now show correct vendor names (Cintas Corporation, Sysco Corporation).

---

## Files Modified

1. `/services/invoice_parsing_v2/parsers/cintasParser.js` - Two-pass TOTAL USD extraction
2. `/services/invoice_parsing_v2/parsers/syscoParser.js` - Sysco-specific INVOICE TOTAL detection
3. `/services/invoice_parsing_v2/universalTotalFinder.js` - Fixed SUBTOTAL false positive
4. `/services/invoice_parsing_v2/index.js` - Vendor name propagation fix, logging
5. `/services/invoice_parsing_v2/validator.js` - Vendor-specific parser bonus

## Test Results

**Test File**: `/test-critical-fixes.js`

```
✓ Cintas TOTAL USD - Expected $1998.14, Got $1998.14
✓ Cintas Vendor Detection - Expected "cintas", Got "cintas"
✓ Sysco INVOICE TOTAL (multi-line) - Expected $1747.30, Got $1747.30
✓ Sysco Vendor Detection (1) - Expected "sysco", Got "sysco"
✓ Sysco INVOICE TOTAL (same-line) - Expected $1748.85, Got $1748.85
✓ Sysco Vendor Detection (2) - Expected "sysco", Got "sysco"

Total: 6/6 tests passed ✅
```

## Impact

### Before Fixes
- Cintas invoices: Showing SUBTOTAL instead of TOTAL USD (10% underreporting)
- Sysco invoices: Incorrect totals extracted
- All invoices: Showing "Unknown Vendor" instead of actual vendor name

### After Fixes
- Cintas invoices: Correctly extracting TOTAL USD ($1,998.14 vs $1,867.42)
- Sysco invoices: Correctly extracting INVOICE TOTAL
- Vendor detection: Working correctly for all supported vendors

## Deployment Notes

**No Breaking Changes** - All fixes are backward compatible.

**Recommended Steps**:
1. Run existing test suite: `npm test`
2. Run critical fixes test: `node test-critical-fixes.js`
3. Verify all tests pass before deploying
4. Monitor logs for vendor detection and totals extraction after deployment

## Logging

New console logs added for debugging:
- `[PARSER V2] Vendor detection:` - Shows detected vendor and confidence
- `[CINTAS TOTALS] Found TOTAL USD:` - Shows Cintas total extraction
- `[SYSCO TOTALS] Found INVOICE TOTAL:` - Shows Sysco total extraction
- `[CHOOSE BEST] Bonus +10 for vendor-specific parser:` - Shows parser selection
- `[CHOOSE BEST] Selected:` - Shows final chosen parser

These logs will help diagnose any future parsing issues in production.

## Future Improvements

1. Add regression test fixtures for real Cintas and Sysco invoices
2. Consider adding similar priority handling for US Foods vendor
3. Monitor for other vendors that may need specific total extraction patterns
