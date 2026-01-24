#!/usr/bin/env node
/**
 * Debug script to analyze Sysco invoice text extraction and total detection
 * Usage: node debug-sysco-totals.js <invoice_file.pdf>
 */

const fs = require('fs');
const path = require('path');

// Import the universal processor to get the same text extraction
const { processInvoicePDF } = require('./universal-invoice-processor');
const { extractTotalCandidates } = require('./services/invoice_parsing_v2/totalsCandidates');
const { extractTotalsByLineScan } = require('./services/invoice_parsing_v2/totals');

async function debugSyscoTotals(pdfPath) {
  console.log('='.repeat(80));
  console.log('SYSCO INVOICE TOTAL DEBUG');
  console.log('='.repeat(80));
  console.log(`File: ${pdfPath}\n`);

  // Check file exists
  if (!fs.existsSync(pdfPath)) {
    console.error(`ERROR: File not found: ${pdfPath}`);
    process.exit(1);
  }

  // Read the PDF
  const pdfBuffer = fs.readFileSync(pdfPath);

  // Use the universal processor to get text (same as production)
  console.log('[1] Extracting text from PDF...\n');

  // We need to extract text the same way the production code does
  // Let's use pdf-parse directly
  const pdfParse = require('pdf-parse');
  const pdfData = await pdfParse(pdfBuffer);
  const text = pdfData.text;

  console.log('[2] TEXT EXTRACTION RESULTS:');
  console.log('-'.repeat(80));

  // Find lines containing "TOTAL"
  const lines = text.split('\n');
  console.log(`Total lines: ${lines.length}\n`);

  console.log('[3] ALL LINES CONTAINING "TOTAL":');
  console.log('-'.repeat(80));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/TOTAL/i.test(line)) {
      const nextLine = lines[i + 1] || '';
      const prevLine = lines[i - 1] || '';

      // Show context
      console.log(`\nLine ${i}: "${line}"`);
      console.log(`  - Length: ${line.length}`);
      console.log(`  - Trimmed: "${line.trim()}"`);
      console.log(`  - Trimmed length: ${line.trim().length}`);
      console.log(`  - Char codes: [${[...line.trim()].map(c => c.charCodeAt(0)).join(', ')}]`);
      console.log(`  - Next line (${i+1}): "${nextLine.trim()}" (len: ${nextLine.trim().length})`);

      // Test the patterns
      const trimmedLine = line.trim();
      const isExactTotal = /^TOTAL$/i.test(trimmedLine);
      const isExactTotalWithSpace = /^TOTAL\s*$/i.test(trimmedLine);
      const isInvoiceTotal = /^INVOICE\s+TOTAL\s*$/i.test(trimmedLine);
      const endsWithTotal = /TOTAL\s*$/i.test(trimmedLine);
      const hasGroupTotal = /GROUP\s*TOTAL/i.test(trimmedLine);

      console.log(`  - Pattern tests:`);
      console.log(`    - ^TOTAL$ (exact): ${isExactTotal}`);
      console.log(`    - ^TOTAL\\s*$ (with trailing space): ${isExactTotalWithSpace}`);
      console.log(`    - ^INVOICE\\s+TOTAL\\s*$: ${isInvoiceTotal}`);
      console.log(`    - TOTAL\\s*$ (ends with): ${endsWithTotal}`);
      console.log(`    - GROUP\\s*TOTAL (is group): ${hasGroupTotal}`);

      // Check if next line is a money value
      const nextTrimmed = nextLine.trim();
      const moneyPattern1 = /^\s*\$?([\d,]+\.?\d{2})\s*$/;
      const moneyPattern2 = /^\s*\$?([\d,]+\.?\d*)\s*$/;
      const moneyPattern3 = /^([\d,]+\.?\d*)$/;

      console.log(`  - Next line money patterns:`);
      console.log(`    - \\$?(\\d+\\.\\d{2})$ (2 decimals): ${moneyPattern1.test(nextTrimmed)}`);
      console.log(`    - \\$?(\\d+\\.?\\d*)$ (any decimals): ${moneyPattern2.test(nextTrimmed)}`);
      console.log(`    - ^(\\d+\\.?\\d*)$ (just number): ${moneyPattern3.test(nextTrimmed)}`);

      if (moneyPattern2.test(nextTrimmed)) {
        const match = nextTrimmed.match(moneyPattern2);
        console.log(`    - Extracted value: ${match[1]}`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('[4] RUNNING TOTAL CANDIDATES EXTRACTOR:');
  console.log('-'.repeat(80));

  const candidatesResult = extractTotalCandidates(text);

  console.log(`\nFound ${candidatesResult.candidates.length} candidates:`);
  candidatesResult.candidates.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.label}: $${(c.valueCents/100).toFixed(2)}`);
    console.log(`     Score: ${c.score}, isGroupTotal: ${c.isGroupTotal}`);
    console.log(`     Evidence: ${JSON.stringify(c.evidence)}`);
  });

  console.log(`\nBest candidate: ${candidatesResult.bestCandidate ?
    `${candidatesResult.bestCandidate.label} = $${(candidatesResult.bestCandidate.valueCents/100).toFixed(2)}` :
    'NONE'}`);

  console.log('\n' + '='.repeat(80));
  console.log('[5] RUNNING LINE SCAN TOTALS EXTRACTOR:');
  console.log('-'.repeat(80));

  const lineScanResult = extractTotalsByLineScan(text);
  console.log(`\nLine scan result:`);
  console.log(`  - Total cents: ${lineScanResult.totalCents} ($${(lineScanResult.totalCents/100).toFixed(2)})`);
  console.log(`  - Subtotal cents: ${lineScanResult.subtotalCents} ($${(lineScanResult.subtotalCents/100).toFixed(2)})`);
  console.log(`  - Tax cents: ${lineScanResult.taxCents} ($${(lineScanResult.taxCents/100).toFixed(2)})`);

  if (lineScanResult.candidates) {
    console.log(`  - Candidates:`);
    lineScanResult.candidates.forEach((c, i) => {
      console.log(`    ${i + 1}. ${c.name}: $${(c.cents/100).toFixed(2)} (priority: ${c.priority})`);
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('[6] LAST 30 LINES OF TEXT (where total usually is):');
  console.log('-'.repeat(80));

  const last30 = lines.slice(-30);
  last30.forEach((line, i) => {
    const lineNum = lines.length - 30 + i;
    console.log(`${lineNum.toString().padStart(4)}: "${line}"`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('DEBUG COMPLETE');
  console.log('='.repeat(80));
}

// Get PDF path from command line
const pdfPath = process.argv[2];

if (!pdfPath) {
  console.log('Usage: node debug-sysco-totals.js <invoice.pdf>');
  console.log('');
  console.log('This script analyzes how text is extracted from a Sysco invoice');
  console.log('and shows why the TOTAL pattern may or may not be matching.');
  process.exit(1);
}

debugSyscoTotals(pdfPath).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
