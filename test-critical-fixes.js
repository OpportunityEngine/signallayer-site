/**
 * Test Critical Invoice Parsing Fixes
 *
 * Tests:
 * 1. Cintas: TOTAL USD (1998.14) should be extracted, not SUBTOTAL (1867.42)
 * 2. Sysco: INVOICE TOTAL should be extracted correctly
 * 3. Vendor Detection: Should detect Cintas and Sysco correctly
 */

const { parseInvoiceText } = require('./services/invoice_parsing_v2/index');

// Test Case 1: Cintas Invoice - TOTAL USD vs SUBTOTAL
const cintasText = `
CINTAS CORPORATION
Invoice No: 12345678

LOC 001 FR DEPT 1
0001 X59294 PANTS INDUST HW 01 R 1 12.00 12.00 Y
0002 X12345 SHIRT WORK 1 15.00 15.00 Y

UNIFORM ADVANTAGE 104.48 Y
INVENTORY MANAGEMENT 52.24 Y

SUBTOTAL          1867.42
SALES TAX          130.72
TOTAL USD         1998.14
`;

// Test Case 2: Sysco Invoice - INVOICE TOTAL
const syscoText = `
SYSCO EASTERN MARYLAND
Invoice Date: 01/15/2025

C 1 CS 25 LB WHLFCLS CREAM SOUR CULTRD GRADE A 1003864 5020193 21.52 21.52
C 2 CS 10 LB BACON SMOKED SLICED 169734 2822343 45.50 91.00

GROUP TOTAL****    1656.30

MISC CHARGES
CHGS FOR FUEL SURCHARGE                    5.90
ALLOWANCE FOR DROP SIZE                    4.35-

INVOICE
TOTAL
1747.30

LAST PAGE
`;

// Test Case 3: Sysco Invoice (alternative format) - INVOICE TOTAL on same line
const syscoText2 = `
SYSCO FOOD SERVICES
Invoice: 987654321

C 1S ONLY5LB CASAIMP CHEESE CHDR MILD FTHR SHRD YE 169734 2822343 15.73 15.73
C 2 CS 12 LB BEEF GROUND 80/20 555666 7788999 33.50 67.00

INVOICE TOTAL 1748.85

LAST PAGE
`;

console.log('='.repeat(80));
console.log('CRITICAL FIXES TEST');
console.log('='.repeat(80));

// Test 1: Cintas TOTAL USD
console.log('\n[TEST 1] Cintas: TOTAL USD vs SUBTOTAL');
console.log('-'.repeat(80));
const cintasResult = parseInvoiceText(cintasText, { debug: true });
console.log(`Vendor: ${cintasResult.vendorName} (${cintasResult.vendorKey})`);
console.log(`Total: $${(cintasResult.totals.totalCents / 100).toFixed(2)}`);
console.log(`Subtotal: $${(cintasResult.totals.subtotalCents / 100).toFixed(2)}`);
console.log(`Tax: $${(cintasResult.totals.taxCents / 100).toFixed(2)}`);
console.log(`\nExpected: TOTAL=$1998.14, SUBTOTAL=$1867.42, TAX=$130.72`);
console.log(`Result: ${cintasResult.totals.totalCents === 199814 ? 'PASS ✓' : 'FAIL ✗'}`);

if (cintasResult.totals.totalCents !== 199814) {
  console.log(`\nERROR: Expected total $1998.14 but got $${(cintasResult.totals.totalCents / 100).toFixed(2)}`);
  console.log('Debug info:', JSON.stringify(cintasResult.totals.debug || {}, null, 2));
}

if (cintasResult.vendorKey !== 'cintas') {
  console.log(`\nWARNING: Vendor detected as "${cintasResult.vendorKey}" instead of "cintas"`);
}

// Test 2: Sysco INVOICE TOTAL (multi-line format)
console.log('\n[TEST 2] Sysco: INVOICE TOTAL (multi-line format)');
console.log('-'.repeat(80));
const syscoResult = parseInvoiceText(syscoText, { debug: true });
console.log(`Vendor: ${syscoResult.vendorName} (${syscoResult.vendorKey})`);
console.log(`Total: $${(syscoResult.totals.totalCents / 100).toFixed(2)}`);
console.log(`\nExpected: TOTAL=$1747.30`);
console.log(`Result: ${syscoResult.totals.totalCents === 174730 ? 'PASS ✓' : 'FAIL ✗'}`);

if (syscoResult.totals.totalCents !== 174730) {
  console.log(`\nERROR: Expected total $1747.30 but got $${(syscoResult.totals.totalCents / 100).toFixed(2)}`);
  console.log('Debug info:', JSON.stringify(syscoResult.totals.debug || {}, null, 2));
  if (syscoResult.debug?.totalsCandidates) {
    console.log('Total candidates:', JSON.stringify(syscoResult.debug.totalsCandidates.slice(0, 3), null, 2));
  }
}

if (syscoResult.vendorKey !== 'sysco') {
  console.log(`\nWARNING: Vendor detected as "${syscoResult.vendorKey}" instead of "sysco"`);
}

// Test 3: Sysco INVOICE TOTAL (same-line format)
console.log('\n[TEST 3] Sysco: INVOICE TOTAL (same-line format)');
console.log('-'.repeat(80));
const syscoResult2 = parseInvoiceText(syscoText2, { debug: true });
console.log(`Vendor: ${syscoResult2.vendorName} (${syscoResult2.vendorKey})`);
console.log(`Total: $${(syscoResult2.totals.totalCents / 100).toFixed(2)}`);
console.log(`\nExpected: TOTAL=$1748.85`);
console.log(`Result: ${syscoResult2.totals.totalCents === 174885 ? 'PASS ✓' : 'FAIL ✗'}`);

if (syscoResult2.totals.totalCents !== 174885) {
  console.log(`\nERROR: Expected total $1748.85 but got $${(syscoResult2.totals.totalCents / 100).toFixed(2)}`);
  console.log('Debug info:', JSON.stringify(syscoResult2.totals.debug || {}, null, 2));
}

if (syscoResult2.vendorKey !== 'sysco') {
  console.log(`\nWARNING: Vendor detected as "${syscoResult2.vendorKey}" instead of "sysco"`);
}

// Summary
console.log('\n' + '='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));

const tests = [
  { name: 'Cintas TOTAL USD', pass: cintasResult.totals.totalCents === 199814 },
  { name: 'Cintas Vendor Detection', pass: cintasResult.vendorKey === 'cintas' },
  { name: 'Sysco INVOICE TOTAL (multi-line)', pass: syscoResult.totals.totalCents === 174730 },
  { name: 'Sysco Vendor Detection (1)', pass: syscoResult.vendorKey === 'sysco' },
  { name: 'Sysco INVOICE TOTAL (same-line)', pass: syscoResult2.totals.totalCents === 174885 },
  { name: 'Sysco Vendor Detection (2)', pass: syscoResult2.vendorKey === 'sysco' }
];

const passCount = tests.filter(t => t.pass).length;
const failCount = tests.length - passCount;

tests.forEach(test => {
  console.log(`${test.pass ? '✓' : '✗'} ${test.name}`);
});

console.log(`\nTotal: ${passCount}/${tests.length} tests passed`);

if (failCount > 0) {
  console.log(`\n⚠️  ${failCount} test(s) failed. Check output above for details.`);
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
