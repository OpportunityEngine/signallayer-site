# Sysco Invoice Parsing Fixes - Summary

## Issues Addressed

### Issue 1: Vendor Detection Failing (False Alarm)
**Status**: No issue found. Vendor detection working correctly.
- Sysco patterns in `vendorDetector.js` match successfully
- Test shows 99% confidence for Sysco invoices
- Added comprehensive Sysco-specific patterns including:
  - Regional variations (SYSCO EASTERN, SYSCO CORPORATION, etc.)
  - Sysco-specific fields (FUEL SURCHARGE, DROP SIZE ALLOWANCE, MISC CHARGES)
  - Format patterns (T/WT=, GROUP TOTAL****, etc.)

### Issue 2: Universal Total Finder Selecting Wrong Total
**Root Cause**: The Universal Total Finder was selecting $1,747.30 (line items sum) instead of $1,748.85 (invoice total with adjustments).

**Why This Happened**:
1. **Tax+Subtotal validation gave wrong answer too much weight**
   - Strategy 8 computed: `SUBTOTAL ($1,747.30) + TAX ($0.00) = $1,747.30`
   - This was given score=90, competing with "INVOICE TOTAL" labels (score=100)
   - But Sysco invoices have MISC CHARGES ($6.95 fuel - $5.40 allowance = $1.55 net) that aren't in subtotal
   - Result: $1,747.30 got more combined votes than the correct $1,748.85

2. **Label pattern strategy was matching "SUBTOTAL"**
   - The generic "TOTAL" label (score=50) was matching "SUBTOTAL"
   - Context check looked for "SUB" in 20 chars before, but didn't check if "TOTAL" was part of "SUBTOTAL"
   - Result: $1,747.30 got an extra vote from label_pattern strategy

3. **Keyword proximity was also matching "SUBTOTAL"**
   - Similar issue - the "TOTAL" keyword matched within "SUBTOTAL"
   - No filtering to exclude compound labels like SUBTOTAL, GROUP TOTAL, etc.

4. **Last Page Focus was looking AFTER "LAST PAGE" marker**
   - Sysco invoices have "LAST PAGE" marker at the very end
   - Invoice total appears BEFORE this marker, not after
   - Strategy 6 was only searching text after the marker, finding nothing

## Fixes Implemented

### Fix 1: Reduce Tax+Subtotal Validation Confidence
**File**: `/services/invoice_parsing_v2/universalTotalFinder.js`
**Lines**: 599-660

Changed Strategy 8 to be a **validator** rather than a **primary finder**:
- Lowered score from 90 → 45 when explicit "INVOICE TOTAL" label exists
- Score only 75 when no explicit label (fallback behavior)
- Added detection for INVOICE TOTAL, GRAND TOTAL, TOTAL DUE labels
- Reasoning: Tax+Subtotal doesn't include fees/adjustments common in food service invoices

**Impact**: Tax+Subtotal validation can no longer override explicit "INVOICE TOTAL" labels.

### Fix 2: Exclude Subtotals from Label Pattern Matching
**File**: `/services/invoice_parsing_v2/universalTotalFinder.js`
**Lines**: 169-186

Enhanced Strategy 1 to skip "TOTAL" when it's part of a larger label:
- Added contextAround check (10 chars before + label + 10 chars after)
- Filters out: SUBTOTAL, SUB-TOTAL, SUB TOTAL, GROUP TOTAL, GROUP****TOTAL, CATEGORY TOTAL, DEPT TOTAL
- Uses regex patterns instead of simple string contains

**Impact**: $1,747.30 no longer gets false label_pattern votes.

### Fix 3: Exclude Subtotals from Keyword Proximity
**File**: `/services/invoice_parsing_v2/universalTotalFinder.js`
**Lines**: 373-408

Enhanced Strategy 4 to skip keywords that are part of subtotal labels:
- Check context before processing each keyword match
- Skip if "TOTAL" is part of SUBTOTAL, GROUP TOTAL, etc.
- Same regex patterns as label strategy

**Impact**: Keyword proximity no longer finds $1,747.30 near "SUBTOTAL".

### Fix 4: Enhance Regex Army Subtotal Filtering
**File**: `/services/invoice_parsing_v2/universalTotalFinder.js`
**Lines**: 582-600

Enhanced Strategy 7's existing subtotal filter:
- Added explicit regex checks (previously only used SUBTOTAL_LABELS array)
- Filters: SUB[\s-]?TOTAL, GROUP[\s\*]*TOTAL, CATEGORY[\s]*TOTAL, DEPT[\s]*TOTAL
- More robust pattern matching

**Impact**: Regex army doesn't create false candidates from subtotal lines.

### Fix 5: Last Page Focus - Search BEFORE Marker
**File**: `/services/invoice_parsing_v2/universalTotalFinder.js`
**Lines**: 492-530

Rewrote Strategy 6 to search before AND after "LAST PAGE":
- Extract 500 chars BEFORE "LAST PAGE" marker → run bottom scan → score +25 bonus
- Also check text AFTER marker (legacy behavior) → score +10 bonus
- Reasoning: Sysco invoices have total right before "LAST PAGE", not after

**Impact**: $1,748.85 now gets a strong boost (+25) for being right before "LAST PAGE".

## Test Results

Created comprehensive test suite (`test-sysco-debug.js`) with 6 test cases:

| Test | Scenario | Before | After |
|------|----------|--------|-------|
| 1 | Vendor Detection | ✓ PASS | ✓ PASS |
| 2 | INVOICE TOTAL (same line) | ✗ FAIL ($1,747.30) | ✓ PASS ($1,748.85) |
| 3 | INVOICE TOTAL + value (2 lines) | ✗ FAIL ($1,747.30) | ✓ PASS ($1,748.85) |
| 4 | INVOICE, TOTAL, value (3 lines) | ✗ FAIL ($1,747.30) | ✓ PASS ($1,748.85) |
| 5 | Competing values + adjustments | ✓ PASS | ✓ PASS |
| 6 | Real-world Sysco format | ✓ PASS | ✓ PASS |

**All 6 tests now pass.**

## Confidence Score Improvements

### Before Fix (Test 2):
```
Top candidates:
  1. $1747.30 - maxScore=100, totalScore=340 (3 strategies)
  2. $1748.85 - maxScore=100, totalScore=280 (3 strategies)
Winner: $1747.30 (WRONG)
```

### After Fix (Test 2):
```
Top candidates:
  1. $1748.85 - maxScore=110, totalScore=445 (4 strategies)
  2. $1747.30 - maxScore=100, totalScore=195 (2 strategies)
Winner: $1748.85 (CORRECT) ✓
```

**Key improvements**:
- $1,748.85 now found by 4 strategies (was 3)
- $1,747.30 found by only 2 strategies (was 3)
- Last Page Focus adds +25 bonus to correct total
- Tax+Subtotal validation reduced to score=45

## Strategy Scoring Summary

| Strategy | $1,748.85 (Correct) | $1,747.30 (Wrong) | Notes |
|----------|---------------------|-------------------|-------|
| Label Pattern | ✓ score=100 | ✗ excluded | Now filters SUBTOTAL |
| Bottom Scan | ✓ score=30 | ✗ excluded | Skips GROUP TOTAL |
| Keyword Proximity | ✓ score=100 | ✗ excluded | Filters compound labels |
| Last Page Focus | ✓ score=55 (30+25) | ✗ not found | Searches before marker |
| Tax+Subtotal Validation | ✗ not applicable | score=45 | Reduced from 90 |

## Files Modified

1. **`/services/invoice_parsing_v2/universalTotalFinder.js`** (5 changes)
   - Strategy 1: Enhanced subtotal filtering (line 169-186)
   - Strategy 4: Added keyword context checking (line 373-408)
   - Strategy 6: Rewrote last page search (line 492-530)
   - Strategy 7: Enhanced regex filtering (line 582-600)
   - Strategy 8: Reduced validation confidence (line 599-660)

2. **`/test-sysco-debug.js`** (NEW)
   - Comprehensive test suite for Sysco invoice parsing
   - 6 test cases covering edge cases
   - Run with: `node test-sysco-debug.js`

## Validation

- ✓ All 6 debug tests pass
- ✓ Existing test suite passes (no regressions)
- ✓ Vendor detection working at 99% confidence
- ✓ Universal Total Finder now correctly prioritizes "INVOICE TOTAL" over subtotal

## Recommendations

1. **Test with real Sysco PDFs** to verify fixes work with actual invoice data
2. **Monitor confidence scores** - should be 90%+ for Sysco invoices
3. **Add regression test fixture** if you have a Sysco PDF showing the $1,747.30 vs $1,748.85 issue
4. **Consider adding similar fixes** to other vendor parsers if they show similar issues

## Next Steps

1. Upload a Sysco invoice PDF and verify parsing output
2. Check that:
   - Vendor = "Sysco Corporation" (not "Unknown Vendor")
   - Invoice total = $1,748.85 (including MISC CHARGES adjustments)
   - Line items sum = $1,747.30
   - Adjustments show: Fuel Surcharge ($6.95) + Drop Size Allowance (-$5.40)
3. If issues persist, share the PDF or extracted text for further debugging
