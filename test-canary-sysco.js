#!/usr/bin/env node
/**
 * CANARY TEST SCRIPT - SYSCO INVOICE PARSING
 *
 * Purpose: Verify that the invoice parsing pipeline correctly:
 * 1. Detects Sysco as the vendor (not "Unknown Vendor")
 * 2. Extracts INVOICE TOTAL (not GROUP TOTAL)
 * 3. Returns vendorName at top level
 *
 * Run: node test-canary-sysco.js
 */

// Simulated Sysco invoice text (includes both GROUP TOTAL and INVOICE TOTAL)
const SYSCO_TEST_TEXT = `
SYSCO EASTERN MARYLAND LLC
123 PEACH ORCHARD ROAD
DELIVERY COPY

***************GROUP TOTAL*************  1,747.30

INVOICE
TOTAL                                    1,748.85

THANK YOU FOR YOUR BUSINESS
`;

// Test modules
const { detectVendor } = require('./services/invoice_parsing_v2/vendorDetector');
const { extractTotalsByLineScan, isGroupSubtotalLine } = require('./services/invoice_parsing_v2/totals');

console.log('='.repeat(60));
console.log('CANARY TEST: SYSCO INVOICE PARSING');
console.log('='.repeat(60));

let allPassed = true;

// ===== TEST 1: Vendor Detection =====
console.log('\n--- TEST 1: Vendor Detection ---');
const vendorResult = detectVendor(SYSCO_TEST_TEXT);
console.log(`  Detected: ${vendorResult.vendorKey} (${vendorResult.vendorName})`);
console.log(`  Confidence: ${vendorResult.confidence}%`);
console.log(`  Matched Patterns: ${vendorResult.matchedPatterns}`);

if (vendorResult.vendorKey === 'sysco' && vendorResult.vendorName === 'Sysco Corporation') {
  console.log('  PASS: Vendor correctly detected as Sysco Corporation');
} else {
  console.log('  FAIL: Expected "Sysco Corporation", got "' + vendorResult.vendorName + '"');
  allPassed = false;
}

// ===== TEST 2: GROUP TOTAL Rejection =====
console.log('\n--- TEST 2: GROUP TOTAL Rejection ---');
const groupTotalLine = '***************GROUP TOTAL*************  1,747.30';
const invoiceTotalLine = 'INVOICE TOTAL 1,748.85';

const groupIsRejected = isGroupSubtotalLine(groupTotalLine);
const invoiceIsRejected = isGroupSubtotalLine(invoiceTotalLine);

if (groupIsRejected) {
  console.log('  PASS: GROUP TOTAL line correctly rejected');
} else {
  console.log('  FAIL: GROUP TOTAL line should be rejected but was not');
  allPassed = false;
}

if (!invoiceIsRejected) {
  console.log('  PASS: INVOICE TOTAL line correctly accepted');
} else {
  console.log('  FAIL: INVOICE TOTAL line was incorrectly rejected');
  allPassed = false;
}

// ===== TEST 3: Totals Extraction =====
console.log('\n--- TEST 3: Totals Extraction ---');
const totals = extractTotalsByLineScan(SYSCO_TEST_TEXT);
console.log(`  Extracted Total: $${(totals.totalCents / 100).toFixed(2)}`);
console.log(`  Evidence: ${totals.evidence?.total?.name || 'N/A'}`);

// INVOICE TOTAL is $1,748.85 = 174885 cents
// GROUP TOTAL is $1,747.30 = 174730 cents (WRONG)
const expectedTotalCents = 174885;
const wrongTotalCents = 174730;

if (totals.totalCents === expectedTotalCents) {
  console.log('  PASS: Correctly extracted INVOICE TOTAL ($1,748.85)');
} else if (totals.totalCents === wrongTotalCents) {
  console.log('  FAIL: Extracted GROUP TOTAL ($1,747.30) instead of INVOICE TOTAL ($1,748.85)');
  allPassed = false;
} else {
  console.log(`  FAIL: Extracted unexpected total ($${(totals.totalCents/100).toFixed(2)}), expected $1,748.85`);
  allPassed = false;
}

// ===== TEST 4: vendorName in Result =====
console.log('\n--- TEST 4: vendorName Propagation ---');
if (vendorResult.vendorName) {
  console.log(`  PASS: vendorName present: "${vendorResult.vendorName}"`);
} else {
  console.log('  FAIL: vendorName missing from result');
  allPassed = false;
}

// ===== SUMMARY =====
console.log('\n' + '='.repeat(60));
if (allPassed) {
  console.log('ALL TESTS PASSED - Invoice parsing is working correctly');
  console.log('='.repeat(60));
  process.exit(0);
} else {
  console.log('SOME TESTS FAILED - Review the output above');
  console.log('='.repeat(60));
  process.exit(1);
}
