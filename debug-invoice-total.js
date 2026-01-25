/**
 * Debug script for invoice total extraction
 * Usage: node debug-invoice-total.js <path-to-extracted-text-file>
 */

const fs = require('fs');
const { findInvoiceTotal, extractAllMonetaryValues } = require('./services/invoice_parsing_v2/universalTotalFinder');

const textFile = process.argv[2];
if (!textFile) {
  console.error('Usage: node debug-invoice-total.js <path-to-text-file>');
  process.exit(1);
}

const text = fs.readFileSync(textFile, 'utf8');

console.log('='.repeat(80));
console.log('INVOICE TOTAL DEBUG REPORT');
console.log('='.repeat(80));

// Run universal finder
const result = findInvoiceTotal(text);

console.log('\n1. SELECTED TOTAL:');
console.log('   Amount: $' + (result.totalDollars ? result.totalDollars.toFixed(2) : 'NOT FOUND'));
console.log('   Confidence: ' + result.confidence + '%');
console.log('   Strategy: ' + result.strategy);

console.log('\n2. TOP 5 CANDIDATES:');
if (result.debug && result.debug.topCandidates) {
  result.debug.topCandidates.forEach(function(c, i) {
    console.log('   ' + (i+1) + '. $' + c.dollars.toFixed(2) + ' - maxScore=' + c.maxScore);
  });
}

console.log('\n3. SEARCH FOR KEY AMOUNTS:');
const keyAmounts = ['1748.85', '1747.30', '1.55'];
keyAmounts.forEach(function(amt) {
  const found = text.includes(amt);
  console.log('   $' + amt + ': ' + (found ? 'FOUND' : 'not found'));
  if (found) {
    const idx = text.indexOf(amt);
    const context = text.substring(Math.max(0, idx - 50), idx + amt.length + 50);
    console.log('     Context: "' + context.replace(/\n/g, ' ').trim() + '"');
  }
});

console.log('\n' + '='.repeat(80));
