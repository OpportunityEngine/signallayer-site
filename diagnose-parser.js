#!/usr/bin/env node
/**
 * PRODUCTION DIAGNOSTIC SCRIPT
 * Run this directly on the production server to diagnose parsing issues
 *
 * Usage: node diagnose-parser.js
 */

console.log('='.repeat(70));
console.log('INVOICE PARSER DIAGNOSTIC - PRODUCTION');
console.log('='.repeat(70));

// 1. Check environment
console.log('\n1. ENVIRONMENT CHECK:');
console.log('   INVOICE_PARSER_V2 =', process.env.INVOICE_PARSER_V2);
console.log('   NODE_ENV =', process.env.NODE_ENV);

// Load dotenv
require('dotenv').config();
console.log('   After dotenv: INVOICE_PARSER_V2 =', process.env.INVOICE_PARSER_V2);

// 2. Check V2 parser loads
console.log('\n2. V2 PARSER MODULE CHECK:');
try {
  const v2Parser = require('./services/invoice_parsing_v2');
  console.log('   ✓ V2 parser module loaded');
  console.log('   - parseInvoiceText:', typeof v2Parser.parseInvoiceText);
  console.log('   - convertToV1Format:', typeof v2Parser.convertToV1Format);
} catch (e) {
  console.log('   ✗ V2 parser FAILED to load:', e.message);
}

// 3. Check vendor detector
console.log('\n3. VENDOR DETECTOR CHECK:');
try {
  const { detectVendor } = require('./services/invoice_parsing_v2/vendorDetector');

  // Test with Sysco text
  const syscoText = `SYSCO EASTERN MARYLAND, LLC
33300 PEACH ORCHARD ROAD
POCOMOKE CITY, MD  21851
800-737-2627`;

  const result = detectVendor(syscoText);
  console.log('   Test text: "SYSCO EASTERN MARYLAND, LLC..."');
  console.log('   Result:', JSON.stringify(result, null, 2).split('\n').map(l => '   ' + l).join('\n'));

  if (result.vendorKey === 'sysco') {
    console.log('   ✓ Sysco detection WORKING');
  } else {
    console.log('   ✗ Sysco detection FAILED - got:', result.vendorKey);
  }
} catch (e) {
  console.log('   ✗ Vendor detector error:', e.message);
}

// 4. Check totals extraction
console.log('\n4. TOTALS EXTRACTION CHECK:');
try {
  const { extractTotalsByLineScan } = require('./services/invoice_parsing_v2/totals');

  // Test with Sysco totals text (includes GROUP TOTAL trap)
  const syscoTotalsText = `
***************GROUP TOTAL*************  1,747.30

MISC CHARGES    ALLOWANCE FOR DROP SIZE    4.35-
                CHGS FOR FUEL SURCHARGE    5.90

INVOICE
TOTAL                                    1,748.85

                                    LAST PAGE
`;

  const totalsResult = extractTotalsByLineScan(syscoTotalsText);
  console.log('   Test text contains GROUP TOTAL $1,747.30 and INVOICE TOTAL $1,748.85');
  console.log('   Extracted total: $' + (totalsResult.totalCents / 100).toFixed(2));
  console.log('   Evidence:', totalsResult.evidence?.total?.name || 'N/A');

  if (totalsResult.totalCents === 174885) {
    console.log('   ✓ Correctly extracted INVOICE TOTAL ($1,748.85)');
  } else if (totalsResult.totalCents === 174730) {
    console.log('   ✗ WRONG! Extracted GROUP TOTAL ($1,747.30) instead of INVOICE TOTAL');
  } else {
    console.log('   ✗ UNEXPECTED total: $' + (totalsResult.totalCents / 100).toFixed(2));
  }
} catch (e) {
  console.log('   ✗ Totals extraction error:', e.message);
  console.log('   Stack:', e.stack);
}

// 5. Check Sysco parser specifically
console.log('\n5. SYSCO PARSER CHECK:');
try {
  const { extractSyscoTotals } = require('./services/invoice_parsing_v2/parsers/syscoParser');

  const syscoText = `
***************GROUP TOTAL*************  1,747.30

INVOICE
TOTAL                                    1,748.85

LAST PAGE
`;

  const lines = syscoText.split('\n');
  const totals = extractSyscoTotals(syscoText, lines);

  console.log('   Sysco parser total: $' + (totals.totalCents / 100).toFixed(2));
  console.log('   Evidence:', totals.totalEvidence || 'N/A');

  if (totals.totalCents === 174885) {
    console.log('   ✓ Sysco parser WORKING correctly');
  } else {
    console.log('   ✗ Sysco parser WRONG - expected $1748.85, got $' + (totals.totalCents / 100).toFixed(2));
  }
} catch (e) {
  console.log('   ✗ Sysco parser error:', e.message);
}

// 6. Full pipeline test
console.log('\n6. FULL PIPELINE TEST:');
try {
  const { parseInvoice } = require('./invoice-parser');

  const fullText = `DELIVERY COPY                        CONFIDENTIAL PROPERTY OF SYSCO

SYSCO EASTERN MARYLAND, LLC
33300 PEACH ORCHARD ROAD
POCOMOKE CITY, MD  21851
800-737-2627 (800-SYSCOCS)

YELLOWFINS BAR&GRI
36908 SILICATO DR

QTY  ITEM DESCRIPTION                    UNIT PRICE    EXT PRICE
1    BREADING MIX SEAFOOD                27.88         27.88
2    DRESSING COLESLAW                   19.39         38.78

***************GROUP TOTAL*************  1,747.30

MISC CHARGES    ALLOWANCE FOR DROP SIZE    4.35-
                CHGS FOR FUEL SURCHARGE    5.90

INVOICE
TOTAL                                    1,748.85

                                    LAST PAGE
`;

  const result = parseInvoice(fullText, { useV2: true, debug: true });

  console.log('\n   Pipeline result:');
  console.log('   - parserVersion:', result.parserVersion);
  console.log('   - vendorName:', result.vendorName);
  console.log('   - vendor.name:', result.vendor?.name);
  console.log('   - totals.totalCents:', result.totals?.totalCents);
  console.log('   - total in dollars: $' + ((result.totals?.totalCents || 0) / 100).toFixed(2));

  if (result.vendorName === 'Sysco Corporation' && result.totals?.totalCents === 174885) {
    console.log('\n   ✓✓✓ FULL PIPELINE WORKING CORRECTLY ✓✓✓');
  } else {
    console.log('\n   ✗✗✗ PIPELINE HAS ISSUES ✗✗✗');
    if (result.vendorName !== 'Sysco Corporation') {
      console.log('   - Vendor wrong: expected "Sysco Corporation", got "' + result.vendorName + '"');
    }
    if (result.totals?.totalCents !== 174885) {
      console.log('   - Total wrong: expected $1748.85, got $' + ((result.totals?.totalCents || 0) / 100).toFixed(2));
    }
  }
} catch (e) {
  console.log('   ✗ Pipeline error:', e.message);
  console.log('   Stack:', e.stack);
}

// 7. Check database for recent invoices
console.log('\n7. DATABASE CHECK:');
try {
  const db = require('./database');
  const database = db.getDatabase();

  const recentInvoices = database.prepare(`
    SELECT id, vendor_name, invoice_total_cents/100.0 as total, file_name, created_at
    FROM ingestion_runs
    ORDER BY created_at DESC
    LIMIT 5
  `).all();

  console.log('   Recent invoices in database:');
  recentInvoices.forEach(inv => {
    console.log(`   - ID ${inv.id}: ${inv.vendor_name} | $${inv.total?.toFixed(2)} | ${inv.file_name}`);
  });
} catch (e) {
  console.log('   ✗ Database error:', e.message);
}

console.log('\n' + '='.repeat(70));
console.log('DIAGNOSTIC COMPLETE');
console.log('='.repeat(70));
