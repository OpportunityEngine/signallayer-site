#!/usr/bin/env node
/**
 * PRODUCTION DIAGNOSTIC SCRIPT
 *
 * Run this on your production server to verify the invoice parsing code is deployed correctly.
 *
 * Usage: node production-diagnostic.js
 *
 * This will check:
 * 1. Latest git commit (should include vendorName fixes)
 * 2. INVOICE_PARSER_V2 environment variable
 * 3. V2 parser activation
 * 4. Vendor detection for Sysco
 * 5. Total extraction (INVOICE TOTAL vs GROUP TOTAL)
 * 6. vendorName propagation through the chain
 */

console.log('='.repeat(70));
console.log('PRODUCTION DIAGNOSTIC - Invoice Parsing');
console.log('Run this on your production server to verify deployment');
console.log('='.repeat(70));
console.log();

// Load dotenv to get environment variables
require('dotenv').config();

const execSync = require('child_process').execSync;

// ===== CHECK 1: Git commit =====
console.log('--- CHECK 1: Git Commit ---');
try {
  const gitLog = execSync('git log --oneline -3', { encoding: 'utf8' });
  console.log('  Recent commits:');
  gitLog.trim().split('\n').forEach(line => console.log('    ' + line));

  if (gitLog.includes('Fix vendorName') || gitLog.includes('0cf0df0')) {
    console.log('  PASS: vendorName fix commit found');
  } else {
    console.log('  WARNING: vendorName fix commit not in recent history');
    console.log('  Run: git pull origin main');
  }
} catch (e) {
  console.log('  ERROR: Could not check git log:', e.message);
}
console.log();

// ===== CHECK 2: Environment variable =====
console.log('--- CHECK 2: Environment Variable ---');
const envValue = process.env.INVOICE_PARSER_V2;
console.log(`  INVOICE_PARSER_V2 = "${envValue}"`);

if (envValue === 'true') {
  console.log('  PASS: INVOICE_PARSER_V2 is set to "true"');
} else if (!envValue) {
  console.log('  INFO: INVOICE_PARSER_V2 not set (V2 is forced via useV2:true anyway)');
} else {
  console.log('  WARNING: INVOICE_PARSER_V2 has unexpected value');
}
console.log();

// ===== CHECK 3: V2 Parser Module =====
console.log('--- CHECK 3: V2 Parser Module ---');
try {
  const invoiceParser = require('./invoice-parser');

  // Check if isV2Enabled works with useV2 option - use realistic text for high confidence
  const testText = `SYSCO EASTERN MARYLAND LLC
123 PEACH ORCHARD ROAD
HAGERSTOWN, MD 21740

SOLD TO: TEST RESTAURANT

INVOICE NO: 1234567890
INVOICE DATE: 01/20/2026

ITEM    DESCRIPTION                      QTY    PRICE    EXTENSION
123456  CHICKEN BREAST 6OZ               12     8.99     107.88

INVOICE
TOTAL 107.88`;
  const result = invoiceParser.parseInvoice(testText, { useV2: true, debug: false });

  if (result.parserVersion === 'v2') {
    console.log('  PASS: V2 parser is loading and executing');
  } else if (result.parserVersion === 'v1' && result.vendorName === 'Sysco Corporation') {
    console.log('  INFO: V2 fell back to V1 (low confidence) but vendorName is correct');
    console.log('  PASS: Vendor detection working correctly');
  } else {
    console.log('  FAIL: V1 parser was used and vendorName is wrong');
    console.log('  Hint: Check that services/invoice_parsing_v2/index.js exists');
  }
} catch (e) {
  console.log('  ERROR: Failed to load invoice-parser:', e.message);
}
console.log();

// ===== CHECK 4: Vendor Detection =====
console.log('--- CHECK 4: Vendor Detection ---');
try {
  const { detectVendor } = require('./services/invoice_parsing_v2/vendorDetector');
  const testText = 'SYSCO EASTERN MARYLAND LLC\n123 PEACH ORCHARD ROAD\nDELIVERY COPY';
  const vendor = detectVendor(testText);

  console.log(`  Detected: ${vendor.vendorName} (${vendor.confidence}%)`);
  console.log(`  Vendor key: ${vendor.vendorKey}`);

  if (vendor.vendorKey === 'sysco' && vendor.vendorName === 'Sysco Corporation') {
    console.log('  PASS: Sysco vendor correctly detected');
  } else {
    console.log('  FAIL: Expected "Sysco Corporation", got "' + vendor.vendorName + '"');
  }
} catch (e) {
  console.log('  ERROR: Failed to load vendorDetector:', e.message);
}
console.log();

// ===== CHECK 5: Total Extraction =====
console.log('--- CHECK 5: Total Extraction (GROUP vs INVOICE) ---');
try {
  const { extractTotalsByLineScan } = require('./services/invoice_parsing_v2/totals');

  const testText = `
***************GROUP TOTAL*************  1,747.30

INVOICE
TOTAL                                    1,748.85
`;

  const result = extractTotalsByLineScan(testText);
  console.log(`  Extracted total: $${(result.totalCents / 100).toFixed(2)}`);
  console.log(`  Evidence: ${result.evidence?.total?.name || 'N/A'}`);

  if (result.totalCents === 174885) {
    console.log('  PASS: Correctly extracted INVOICE TOTAL ($1,748.85)');
  } else if (result.totalCents === 174730) {
    console.log('  FAIL: Extracted GROUP TOTAL ($1,747.30) instead of INVOICE TOTAL');
  } else {
    console.log(`  FAIL: Unexpected total: $${(result.totalCents/100).toFixed(2)}`);
  }
} catch (e) {
  console.log('  ERROR: Failed to load totals module:', e.message);
}
console.log();

// ===== CHECK 6: vendorName Propagation =====
console.log('--- CHECK 6: vendorName Propagation Chain ---');
try {
  const invoiceParser = require('./invoice-parser');
  // Use realistic invoice text to ensure high confidence
  const testText = `SYSCO EASTERN MARYLAND LLC
123 PEACH ORCHARD ROAD
HAGERSTOWN, MD 21740

SOLD TO: TEST RESTAURANT

INVOICE NO: 1234567890
INVOICE DATE: 01/20/2026

ITEM    DESCRIPTION                      QTY    PRICE    EXTENSION
123456  CHICKEN BREAST 6OZ               12     8.99     107.88

***GROUP TOTAL***  100.00

INVOICE
TOTAL 107.88

THANK YOU FOR YOUR BUSINESS`;

  const result = invoiceParser.parseInvoice(testText, { useV2: true, debug: false });

  console.log(`  parsedInvoice.vendorName: "${result.vendorName || 'undefined'}"`);
  console.log(`  parsedInvoice.vendorKey: "${result.vendorKey || 'undefined'}"`);
  console.log(`  parsedInvoice.vendor.name: "${result.vendor?.name || 'undefined'}"`);
  console.log(`  parsedInvoice.vendorDetection: ${result.vendorDetection ? 'present' : 'missing'}`);

  if (result.vendorName === 'Sysco Corporation') {
    console.log('  PASS: vendorName correctly set at top level');
  } else {
    console.log(`  FAIL: vendorName is "${result.vendorName}", expected "Sysco Corporation"`);
  }
} catch (e) {
  console.log('  ERROR:', e.message);
}
console.log();

// ===== CHECK 7: universal-invoice-processor.js line 994 =====
console.log('--- CHECK 7: universal-invoice-processor.js Code Check ---');
try {
  const fs = require('fs');
  const processorCode = fs.readFileSync('./universal-invoice-processor.js', 'utf8');

  if (processorCode.includes('{ useV2: true, debug: true }')) {
    console.log('  PASS: useV2: true is present in universal-invoice-processor.js');
  } else if (processorCode.includes('{ useV2: true }')) {
    console.log('  PASS: useV2: true is present (without debug flag)');
  } else {
    console.log('  FAIL: useV2: true NOT found in universal-invoice-processor.js');
    console.log('  This means V2 parser may not be activated!');
  }

  if (processorCode.includes('result.vendorName = parsed.vendorName')) {
    console.log('  PASS: vendorName propagation code is present');
  } else {
    console.log('  FAIL: vendorName propagation code NOT found');
    console.log('  vendorName may be dropped in the processing chain!');
  }
} catch (e) {
  console.log('  ERROR: Could not read universal-invoice-processor.js:', e.message);
}
console.log();

// ===== FINAL SUMMARY =====
console.log('='.repeat(70));
console.log('DIAGNOSTIC COMPLETE');
console.log();
console.log('If any checks failed:');
console.log('  1. Pull latest code: git pull origin main');
console.log('  2. Restart PM2: pm2 restart all');
console.log('  3. Clear Node.js cache: pm2 delete all && pm2 start server.js');
console.log('  4. Check PM2 logs for "[PARSER V2 ACTIVATED]" messages');
console.log('='.repeat(70));
