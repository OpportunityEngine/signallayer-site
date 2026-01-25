#!/usr/bin/env node
/**
 * END-TO-END TEST - SYSCO INVOICE PARSING
 *
 * This tests the EXACT same code path as production:
 * 1. invoice-parser.parseInvoice() with { useV2: true }
 * 2. extractTotalsByLineScan() from totals.js
 * 3. Vendor name extraction logic from server.js
 *
 * Run: node test-e2e-sysco.js
 */

// Test text that matches real Sysco invoice format
const SYSCO_PDF_TEXT = `
SYSCO EASTERN MARYLAND LLC
123 PEACH ORCHARD ROAD
HAGERSTOWN, MD 21740

DELIVERY COPY

SOLD TO: ABC RESTAURANT
         456 MAIN ST
         BALTIMORE MD 21201

INVOICE NO: 1234567890
INVOICE DATE: 01/20/2026
PO NUMBER: ABC-001
ROUTE: R123

ITEM    DESCRIPTION                      QTY    PRICE    EXTENSION
======================================================================
123456  CHICKEN BREAST 6OZ               12     8.99     107.88
234567  BEEF GROUND 80/20               24     6.50     156.00
345678  MIXED VEGETABLES FROZEN         36     3.25     117.00

***************GROUP TOTAL*************  1,747.30

INVOICE
TOTAL                                    1,748.85

THANK YOU FOR YOUR BUSINESS
`;

console.log('='.repeat(70));
console.log('END-TO-END TEST: SYSCO INVOICE PARSING');
console.log('Tests the EXACT production code path');
console.log('='.repeat(70));
console.log();

let allPassed = true;

// ===== TEST 1: invoice-parser with useV2: true =====
console.log('--- TEST 1: invoice-parser.parseInvoice() with useV2: true ---');
const invoiceParser = require('./invoice-parser');
const parseResult = invoiceParser.parseInvoice(SYSCO_PDF_TEXT, { useV2: true, debug: true });

console.log(`  Parser version: ${parseResult.parserVersion || 'v1'}`);
console.log(`  vendorName: "${parseResult.vendorName}"`);
console.log(`  vendorKey: "${parseResult.vendorKey || 'N/A'}"`);
console.log(`  totals.totalCents: ${parseResult.totals?.totalCents || 0}`);

if (parseResult.parserVersion === 'v2') {
  console.log('  PASS: V2 parser was used');
} else {
  console.log('  FAIL: V1 parser was used (V2 should be forced by useV2: true)');
  allPassed = false;
}

if (parseResult.vendorName === 'Sysco Corporation') {
  console.log('  PASS: vendorName is "Sysco Corporation"');
} else {
  console.log(`  FAIL: vendorName is "${parseResult.vendorName}", expected "Sysco Corporation"`);
  allPassed = false;
}
console.log();

// ===== TEST 2: extractTotalsByLineScan =====
console.log('--- TEST 2: extractTotalsByLineScan() from totals.js ---');
const { extractTotalsByLineScan } = require('./services/invoice_parsing_v2/totals');
const lineScanResult = extractTotalsByLineScan(SYSCO_PDF_TEXT);

console.log(`  totalCents: ${lineScanResult.totalCents} ($${(lineScanResult.totalCents/100).toFixed(2)})`);
console.log(`  evidence: ${lineScanResult.evidence?.total?.name || 'N/A'}`);
console.log(`  evidence line: "${lineScanResult.evidence?.total?.line || 'N/A'}"`);

// INVOICE TOTAL is 1748.85 = 174885 cents
// GROUP TOTAL is 1747.30 = 174730 cents (WRONG)
if (lineScanResult.totalCents === 174885) {
  console.log('  PASS: Extracted INVOICE TOTAL ($1,748.85)');
} else if (lineScanResult.totalCents === 174730) {
  console.log('  FAIL: Extracted GROUP TOTAL ($1,747.30) instead of INVOICE TOTAL');
  allPassed = false;
} else {
  console.log(`  FAIL: Unexpected total: $${(lineScanResult.totalCents/100).toFixed(2)}`);
  allPassed = false;
}
console.log();

// ===== TEST 3: Vendor name extraction priority chain =====
console.log('--- TEST 3: Vendor name extraction (server.js logic) ---');
// Simulate server.js vendorName extraction logic (lines 3206-3248)
const parsedInvoice = parseResult;
const canonical = { parties: { vendor: { name: 'Unknown Vendor' } } };

let vendorName = 'Unknown Vendor';
let vendorSource = 'none';

// 1) Top-level vendorName
if (parsedInvoice?.vendorName && parsedInvoice.vendorName !== 'Unknown Vendor') {
  vendorName = parsedInvoice.vendorName;
  vendorSource = 'parsedInvoice.vendorName';
}
// 2) Vendor object from parser
else if (parsedInvoice?.vendor?.name && parsedInvoice.vendor.name !== 'Unknown Vendor') {
  vendorName = parsedInvoice.vendor.name;
  vendorSource = 'parsedInvoice.vendor.name';
}
// 3) Vendor detection result
else if (parsedInvoice?.vendorDetection?.vendorName &&
         parsedInvoice.vendorDetection.vendorName !== 'Unknown Vendor' &&
         (parsedInvoice.vendorDetection.confidence || 0) >= 50) {
  vendorName = parsedInvoice.vendorDetection.vendorName;
  vendorSource = 'parsedInvoice.vendorDetection';
}
// 4) Canonical vendor
else if (canonical?.parties?.vendor?.name && canonical.parties.vendor.name !== 'Unknown Vendor') {
  vendorName = canonical.parties.vendor.name;
  vendorSource = 'canonical.parties.vendor';
}

console.log(`  Final vendorName: "${vendorName}"`);
console.log(`  Source: ${vendorSource}`);

if (vendorName === 'Sysco Corporation') {
  console.log('  PASS: Vendor name correctly resolved to "Sysco Corporation"');
} else {
  console.log(`  FAIL: Vendor name is "${vendorName}", expected "Sysco Corporation"`);
  allPassed = false;
}
console.log();

// ===== TEST 4: Full parsedInvoice structure check =====
console.log('--- TEST 4: parsedInvoice structure check ---');
console.log(`  parsedInvoice.vendorName: "${parsedInvoice.vendorName || 'undefined'}"`);
console.log(`  parsedInvoice.vendorKey: "${parsedInvoice.vendorKey || 'undefined'}"`);
console.log(`  parsedInvoice.vendor.name: "${parsedInvoice.vendor?.name || 'undefined'}"`);
console.log(`  parsedInvoice.vendorDetection.vendorName: "${parsedInvoice.vendorDetection?.vendorName || 'undefined'}"`);
console.log(`  parsedInvoice.vendorDetection.confidence: ${parsedInvoice.vendorDetection?.confidence || 0}%`);

const hasVendorName = !!parsedInvoice.vendorName;
const hasVendorKey = !!parsedInvoice.vendorKey;
const hasVendorDetection = !!parsedInvoice.vendorDetection;

if (hasVendorName && hasVendorKey && hasVendorDetection) {
  console.log('  PASS: All vendor fields present');
} else {
  console.log(`  FAIL: Missing vendor fields: vendorName=${hasVendorName}, vendorKey=${hasVendorKey}, vendorDetection=${hasVendorDetection}`);
  allPassed = false;
}
console.log();

// ===== SUMMARY =====
console.log('='.repeat(70));
if (allPassed) {
  console.log('ALL TESTS PASSED - Production code path is working correctly');
  console.log();
  console.log('If production is still showing wrong values:');
  console.log('  1. Verify code is deployed: git log --oneline -1 (should show "Fix vendorName being dropped")');
  console.log('  2. Restart PM2: pm2 restart all');
  console.log('  3. Check PM2 logs: pm2 logs --lines 100');
  console.log('  4. Look for "[PARSER V2 ACTIVATED]" in logs');
} else {
  console.log('SOME TESTS FAILED - There is still a bug in the parsing code');
}
console.log('='.repeat(70));

process.exit(allPassed ? 0 : 1);
