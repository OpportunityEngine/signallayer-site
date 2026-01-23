#!/usr/bin/env node
/**
 * Invoice Verification CLI Script
 *
 * Usage: node scripts/verify-invoice.js /path/to/invoice.pdf
 *
 * This script:
 * 1. Reads a PDF and extracts text using pdf-parse
 * 2. Runs extractTotalsByLineScan to find totals
 * 3. Prints "interesting" lines containing financial keywords
 * 4. Shows extracted totals with evidence
 */

const fs = require('fs');
const path = require('path');

// Check for PDF path argument
const pdfPath = process.argv[2];

if (!pdfPath) {
  console.log('Usage: node scripts/verify-invoice.js /path/to/invoice.pdf');
  console.log('');
  console.log('This script extracts and verifies invoice totals from a PDF file.');
  process.exit(1);
}

// Resolve to absolute path
const absolutePath = path.resolve(pdfPath);

if (!fs.existsSync(absolutePath)) {
  console.error(`Error: File not found: ${absolutePath}`);
  process.exit(1);
}

async function main() {
  console.log('='.repeat(60));
  console.log('INVOICE VERIFICATION SCRIPT');
  console.log('='.repeat(60));
  console.log(`\nFile: ${absolutePath}`);
  console.log('');

  // Try to load pdf-parse
  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch (e) {
    console.error('Error: pdf-parse module not found. Install with: npm install pdf-parse');
    process.exit(1);
  }

  // Load totals extractor
  const {
    extractTotalsByLineScan,
    extractInterestingLines,
    computeInvoiceMath,
    reconcileTotals
  } = require('../services/invoice_parsing_v2/totals');

  // Read PDF
  let pdfBuffer;
  try {
    pdfBuffer = fs.readFileSync(absolutePath);
  } catch (e) {
    console.error(`Error reading file: ${e.message}`);
    process.exit(1);
  }

  // Extract text
  let pdfData;
  try {
    pdfData = await pdfParse(pdfBuffer);
  } catch (e) {
    console.error(`Error parsing PDF: ${e.message}`);
    process.exit(1);
  }

  const text = pdfData.text || '';

  console.log(`Pages: ${pdfData.numpages}`);
  console.log(`Text length: ${text.length} characters`);
  console.log('');

  // Extract totals using line scan
  console.log('='.repeat(60));
  console.log('EXTRACTED TOTALS (Line Scan)');
  console.log('='.repeat(60));

  const totals = extractTotalsByLineScan(text);

  console.log(`\nTotal:      $${(totals.totalCents / 100).toFixed(2)}`);
  console.log(`Subtotal:   $${(totals.subtotalCents / 100).toFixed(2)}`);
  console.log(`Tax:        $${(totals.taxCents / 100).toFixed(2)}`);
  console.log(`Fees:       $${(totals.feesCents / 100).toFixed(2)}`);
  console.log(`Discounts:  $${(totals.discountCents / 100).toFixed(2)}`);

  // Show evidence
  console.log('\n--- Evidence ---');

  if (totals.evidence.total) {
    console.log(`\nTotal source: "${totals.evidence.total.name}"`);
    console.log(`  Line: ${totals.evidence.total.line}`);
  }

  if (totals.evidence.subtotal) {
    console.log(`\nSubtotal source: "${totals.evidence.subtotal.name}"`);
    console.log(`  Line: ${totals.evidence.subtotal.line}`);
  }

  if (totals.evidence.tax) {
    console.log(`\nTax source: "${totals.evidence.tax.name}"`);
    console.log(`  Line: ${totals.evidence.tax.line}`);
  }

  if (totals.evidence.fees.length > 0) {
    console.log('\nFees found:');
    for (const fee of totals.evidence.fees) {
      console.log(`  ${fee.name}: $${(fee.cents / 100).toFixed(2)}`);
      console.log(`    Line: ${fee.line}`);
    }
  }

  if (totals.evidence.discounts.length > 0) {
    console.log('\nDiscounts found:');
    for (const disc of totals.evidence.discounts) {
      console.log(`  ${disc.name}: $${(disc.cents / 100).toFixed(2)}`);
      console.log(`    Line: ${disc.line}`);
    }
  }

  // Show interesting lines
  console.log('\n');
  console.log('='.repeat(60));
  console.log('INTERESTING LINES (Financial Keywords)');
  console.log('='.repeat(60));

  const interesting = extractInterestingLines(text);

  if (interesting.length === 0) {
    console.log('\nNo interesting lines found.');
  } else {
    console.log(`\nFound ${interesting.length} lines with financial keywords:\n`);
    for (const { lineNumber, text: lineText } of interesting.slice(0, 50)) {
      // Truncate long lines
      const display = lineText.length > 100 ? lineText.slice(0, 100) + '...' : lineText;
      console.log(`  ${String(lineNumber).padStart(4)}: ${display}`);
    }
    if (interesting.length > 50) {
      console.log(`\n  ... and ${interesting.length - 50} more lines`);
    }
  }

  // Show first/last lines of document for context
  console.log('\n');
  console.log('='.repeat(60));
  console.log('DOCUMENT PREVIEW');
  console.log('='.repeat(60));

  const lines = text.split('\n');
  console.log(`\nTotal lines: ${lines.length}`);

  console.log('\n--- First 20 lines ---');
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const line = lines[i].trim();
    if (line) {
      console.log(`  ${String(i + 1).padStart(4)}: ${line.slice(0, 100)}`);
    }
  }

  console.log('\n--- Last 20 lines ---');
  const startIdx = Math.max(0, lines.length - 20);
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line) {
      console.log(`  ${String(i + 1).padStart(4)}: ${line.slice(0, 100)}`);
    }
  }

  // Summary
  console.log('\n');
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const hasTotal = totals.totalCents > 0;
  const hasSubtotal = totals.subtotalCents > 0;
  const hasTax = totals.taxCents > 0;

  console.log(`\n  Invoice Total: ${hasTotal ? '$' + (totals.totalCents / 100).toFixed(2) : 'NOT FOUND'}`);
  console.log(`  Subtotal:      ${hasSubtotal ? '$' + (totals.subtotalCents / 100).toFixed(2) : 'NOT FOUND'}`);
  console.log(`  Tax:           ${hasTax ? '$' + (totals.taxCents / 100).toFixed(2) : 'NOT FOUND'}`);

  // Math check
  if (hasSubtotal && hasTax && hasTotal) {
    const computed = totals.subtotalCents + totals.taxCents + totals.feesCents + totals.discountCents;
    const diff = Math.abs(totals.totalCents - computed);
    console.log(`\n  Math check: subtotal + tax + fees + discounts = $${(computed / 100).toFixed(2)}`);
    console.log(`  Difference from total: $${(diff / 100).toFixed(2)} (${diff <= 5 ? 'OK' : 'MISMATCH'})`);
  }

  console.log('\n' + '='.repeat(60));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
