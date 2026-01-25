/**
 * Test script to debug Sysco invoice parsing issues
 *
 * This script tests:
 * 1. Vendor detection with sample Sysco text
 * 2. Universal Total Finder with various INVOICE TOTAL formats
 */

const { detectVendor } = require('./services/invoice_parsing_v2/vendorDetector');
const { findInvoiceTotal } = require('./services/invoice_parsing_v2/universalTotalFinder');

console.log('='.repeat(80));
console.log('SYSCO INVOICE PARSING DEBUG TEST');
console.log('='.repeat(80));

// Test case 1: Vendor detection with minimal Sysco text
console.log('\n[TEST 1] Vendor Detection - Minimal Sysco Text');
console.log('-'.repeat(80));

const minimalSyscoText = `
SYSCO EASTERN MARYLAND, LLC
1234 PEACH ORCHARD ROAD
BALTIMORE, MD 21225

INVOICE
Invoice #: 123456789
Date: 01/20/2026

SHIP TO:
TEST RESTAURANT
123 MAIN ST

GROUP TOTAL
MISC CHARGES
FUEL SURCHARGE
DROP SIZE ALLOWANCE
INVOICE TOTAL
`;

const vendorResult = detectVendor(minimalSyscoText);
console.log(`Result: ${vendorResult.vendorKey} - "${vendorResult.vendorName}" (${vendorResult.confidence}% confidence)`);
console.log(`Expected: sysco - "Sysco Corporation" (>= 50% confidence)`);
console.log(`Status: ${vendorResult.vendorKey === 'sysco' && vendorResult.confidence >= 50 ? 'PASS ✓' : 'FAIL ✗'}`);

// Test case 2: Universal Total Finder - Various formats
console.log('\n[TEST 2] Universal Total Finder - INVOICE TOTAL on Same Line');
console.log('-'.repeat(80));

const sameLineText = `
Line items here...
SUBTOTAL 1747.30
TAX 0.00
INVOICE TOTAL 1748.85
LAST PAGE
`;

const sameLineResult = findInvoiceTotal(sameLineText);
console.log(`Found: $${sameLineResult.totalDollars?.toFixed(2)} (${sameLineResult.confidence}% confidence)`);
console.log(`Expected: $1748.85`);
console.log(`Status: ${sameLineResult.totalDollars === 1748.85 ? 'PASS ✓' : 'FAIL ✗'}`);

// Test case 3: INVOICE TOTAL split across two lines
console.log('\n[TEST 3] Universal Total Finder - INVOICE TOTAL + Value on Next Line');
console.log('-'.repeat(80));

const twoLineText = `
Line items here...
SUBTOTAL 1747.30
TAX 0.00
INVOICE TOTAL
1748.85
LAST PAGE
`;

const twoLineResult = findInvoiceTotal(twoLineText);
console.log(`Found: $${twoLineResult.totalDollars?.toFixed(2)} (${twoLineResult.confidence}% confidence)`);
console.log(`Expected: $1748.85`);
console.log(`Status: ${twoLineResult.totalDollars === 1748.85 ? 'PASS ✓' : 'FAIL ✗'}`);

// Test case 4: INVOICE and TOTAL on separate lines, value on third line
console.log('\n[TEST 4] Universal Total Finder - INVOICE, TOTAL, Value on 3 Lines');
console.log('-'.repeat(80));

const threeLineText = `
Line items here...
SUBTOTAL 1747.30
TAX 0.00
INVOICE
TOTAL
1748.85
LAST PAGE
`;

const threeLineResult = findInvoiceTotal(threeLineText);
console.log(`Found: $${threeLineResult.totalDollars?.toFixed(2)} (${threeLineResult.confidence}% confidence)`);
console.log(`Expected: $1748.85`);
console.log(`Status: ${threeLineResult.totalDollars === 1748.85 ? 'PASS ✓' : 'FAIL ✗'}`);

// Test case 5: Competing values - line items sum vs invoice total
console.log('\n[TEST 5] Universal Total Finder - Competing Values (Line Items Sum vs Invoice Total)');
console.log('-'.repeat(80));

const competingValuesText = `
ITEM 1                    100.00
ITEM 2                    200.00
ITEM 3                    300.50
ITEM 4                    500.00
ITEM 5                    646.80

SUBTOTAL               1747.30
FUEL SURCHARGE            6.95
DROP SIZE ALLOWANCE      -5.40
INVOICE TOTAL
1748.85
LAST PAGE
`;

const competingResult = findInvoiceTotal(competingValuesText);
console.log(`Found: $${competingResult.totalDollars?.toFixed(2)} (${competingResult.confidence}% confidence, via ${competingResult.strategy})`);
console.log(`Expected: $1748.85`);
console.log(`Status: ${competingResult.totalDollars === 1748.85 ? 'PASS ✓' : 'FAIL ✗'}`);

// Log all candidates for test 5
if (competingResult.debug?.topCandidates) {
  console.log('\nTop candidates found:');
  competingResult.debug.topCandidates.forEach((c, i) => {
    console.log(`  ${i + 1}. $${c.dollars.toFixed(2)} - maxScore=${c.maxScore}, strategies=[${c.strategies.join(', ')}]`);
  });
}

// Test case 6: Real-world format with whitespace and alignment
console.log('\n[TEST 6] Universal Total Finder - Real-world Format with Spacing');
console.log('-'.repeat(80));

const realWorldText = `
ITEM                                    QTY    UNIT PRICE    TOTAL
CHEESE SHREDDED                           1        15.73    15.73
CREAM SOUR                                1        21.52    21.52
BREAD ROLLS                               2        10.00    20.00

                        GROUP TOTAL              1747.30

MISC CHARGES
ALLOWANCE FOR DROP SIZE                                        4.35-
CHGS FOR FUEL SURCHARGE                                        5.90

INVOICE
TOTAL                                                       1748.85

                                             LAST PAGE
`;

const realWorldResult = findInvoiceTotal(realWorldText);
console.log(`Found: $${realWorldResult.totalDollars?.toFixed(2)} (${realWorldResult.confidence}% confidence, via ${realWorldResult.strategy})`);
console.log(`Expected: $1748.85`);
console.log(`Status: ${realWorldResult.totalDollars === 1748.85 ? 'PASS ✓' : 'FAIL ✗'}`);

// Summary
console.log('\n' + '='.repeat(80));
console.log('TEST SUMMARY');
console.log('='.repeat(80));
console.log('Run this test to verify the fixes:');
console.log('  node test-sysco-debug.js');
console.log('='.repeat(80));
