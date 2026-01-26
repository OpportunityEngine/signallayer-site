#!/usr/bin/env node
/**
 * Debug PDF Extraction Script
 *
 * Usage: node scripts/debug-extract.js ./path/to/invoice.pdf
 *
 * This script tests the full PDF extraction pipeline and shows:
 * - Sources used (pdf-parse, pdfjs, OCR)
 * - Coverage analysis (anchors found)
 * - Last 200 lines of combined text
 * - Grep summary for critical anchors
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function debugExtract(pdfPath) {
  console.log('='.repeat(70));
  console.log('PDF EXTRACTION DEBUG');
  console.log('='.repeat(70));
  console.log(`\nFile: ${pdfPath}`);
  console.log(`Node version: ${process.version}`);
  console.log(`CWD: ${process.cwd()}\n`);

  // Check file exists
  if (!fs.existsSync(pdfPath)) {
    console.error('ERROR: File not found:', pdfPath);
    process.exit(1);
  }

  const pdfBuffer = fs.readFileSync(pdfPath);
  console.log(`PDF size: ${pdfBuffer.length} bytes\n`);

  // ===== STEP 1: Load extraction modules =====
  console.log('--- STEP 1: Loading Extraction Modules ---');

  let extractFullInvoiceTextFromPDF;
  try {
    const processor = require('../universal-invoice-processor');
    extractFullInvoiceTextFromPDF = processor.extractFullInvoiceTextFromPDF;
    console.log('  [OK] universal-invoice-processor loaded');
  } catch (e) {
    console.error('  [FAIL] universal-invoice-processor:', e.message);
    process.exit(1);
  }

  // Check individual modules
  try {
    require('../services/pdf/pdfjsExtract');
    console.log('  [OK] pdfjsExtract loaded');
  } catch (e) {
    console.log('  [WARN] pdfjsExtract not available:', e.message);
  }

  try {
    const pdfOcr = require('../services/pdf/pdfOcr');
    console.log(`  [OK] pdfOcr loaded (OCR available: ${pdfOcr.isOcrAvailable()})`);
    if (!pdfOcr.POPPLER_AVAILABLE) console.log('      - pdftoppm NOT found');
    if (!pdfOcr.TESSERACT_AVAILABLE) console.log('      - tesseract NOT found');
  } catch (e) {
    console.log('  [WARN] pdfOcr not available:', e.message);
  }

  console.log();

  // ===== STEP 2: Run full extraction =====
  console.log('--- STEP 2: Running Full Extraction Pipeline ---');
  console.log();

  const startTime = Date.now();
  const result = await extractFullInvoiceTextFromPDF(pdfBuffer, {
    maxPages: 10,
    forceOcrLastPage: true
  });
  const elapsedMs = Date.now() - startTime;

  console.log();
  console.log('--- STEP 3: Extraction Results ---');
  console.log();
  console.log(`Time elapsed: ${elapsedMs}ms`);
  console.log();
  console.log('Sources Used:');
  console.log(`  pdf-parse:    ${result.sourcesUsed.pdfParse} chars`);
  console.log(`  pdfjs:        ${result.sourcesUsed.pdfJs} chars`);
  console.log(`  OCR last page: ${result.sourcesUsed.ocrLastPage} chars`);
  console.log(`  OCR all pages: ${result.sourcesUsed.ocrAllPages} chars`);
  console.log(`  TOTAL:        ${result.rawText.length} chars`);
  console.log();

  console.log('Coverage Analysis:');
  console.log(`  Text length:           ${result.coverage.textLen}`);
  console.log(`  Has TOTAL anchor:      ${result.coverage.hasTotalAnchor ? 'YES' : 'NO'}`);
  console.log(`  Has INVOICE word:      ${result.coverage.hasInvoiceWord ? 'YES' : 'NO'}`);
  console.log(`  Has vendor hints:      ${result.coverage.hasVendorHints ? 'YES' : 'NO'}`);
  console.log(`  Has money values:      ${result.coverage.hasMoneyValues ? 'YES' : 'NO'}`);
  console.log(`  Missing critical:      ${result.coverage.missingCriticalAnchors ? 'YES (BAD)' : 'NO (GOOD)'}`);
  console.log();

  // ===== STEP 4: Anchor grep summary =====
  console.log('--- STEP 4: Anchor Search (grep summary) ---');
  const text = result.rawText.toUpperCase();

  const anchors = [
    { name: 'INVOICE', pattern: /\bINVOICE\b/g },
    { name: 'TOTAL', pattern: /\bTOTAL\b/g },
    { name: 'INVOICE TOTAL', pattern: /INVOICE\s*TOTAL/g },
    { name: 'TOTAL USD', pattern: /TOTAL\s*USD/g },
    { name: 'AMOUNT DUE', pattern: /AMOUNT\s*DUE/g },
    { name: 'BALANCE DUE', pattern: /BALANCE\s*DUE/g },
    { name: 'GRAND TOTAL', pattern: /GRAND\s*TOTAL/g },
    { name: 'SYSCO', pattern: /SYSCO/g },
    { name: 'CINTAS', pattern: /CINTAS/g },
    { name: 'US FOODS', pattern: /US\s*FOODS/g },
    { name: 'LAST PAGE', pattern: /LAST\s*PAGE/g },
    { name: '=== PAGE', pattern: /=== PAGE/g },
    { name: '=== OCR', pattern: /=== OCR/g }
  ];

  for (const anchor of anchors) {
    const matches = text.match(anchor.pattern);
    const count = matches ? matches.length : 0;
    const status = count > 0 ? `FOUND (${count}x)` : 'not found';
    console.log(`  ${anchor.name.padEnd(15)} ${status}`);
  }
  console.log();

  // ===== STEP 5: Show last 200 lines =====
  console.log('--- STEP 5: Last 200 Lines of Combined Text ---');
  const lines = result.rawText.split('\n');
  const last200 = lines.slice(-200);
  console.log();
  console.log(last200.join('\n'));
  console.log();

  // ===== STEP 6: Show lines with TOTAL =====
  console.log('--- STEP 6: Lines Containing "TOTAL" ---');
  lines.forEach((line, i) => {
    if (/TOTAL/i.test(line)) {
      console.log(`  Line ${i + 1}: "${line.trim().substring(0, 80)}"`);
    }
  });
  console.log();

  // ===== DONE =====
  console.log('='.repeat(70));
  console.log('DEBUG COMPLETE');
  console.log('='.repeat(70));

  // Summary verdict
  if (result.coverage.hasTotalAnchor && !result.coverage.missingCriticalAnchors) {
    console.log('\n*** VERDICT: EXTRACTION LOOKS GOOD - Total anchor found ***\n');
  } else if (result.coverage.hasMoneyValues && result.coverage.textLen > 200) {
    console.log('\n*** VERDICT: PARTIAL - Has money values but missing total anchor ***\n');
  } else {
    console.log('\n*** VERDICT: EXTRACTION MAY BE INCOMPLETE - Missing critical content ***\n');
  }
}

// Main
const pdfPath = process.argv[2];
if (!pdfPath) {
  console.log('Usage: node scripts/debug-extract.js /path/to/invoice.pdf');
  console.log();
  console.log('This script tests the full PDF extraction pipeline and shows:');
  console.log('  - Sources used (pdf-parse, pdfjs, OCR)');
  console.log('  - Coverage analysis (anchors found)');
  console.log('  - Last 200 lines of combined text');
  console.log('  - Grep summary for critical anchors');
  process.exit(1);
}

debugExtract(pdfPath).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
