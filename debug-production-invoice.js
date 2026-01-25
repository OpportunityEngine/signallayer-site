#!/usr/bin/env node
/**
 * PRODUCTION DEBUG SCRIPT
 *
 * This script simulates the EXACT production flow to identify where parsing fails.
 * Run this on your production server with a PDF file path.
 *
 * Usage: node debug-production-invoice.js /path/to/invoice.pdf
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function debugInvoice(pdfPath) {
  console.log('='.repeat(70));
  console.log('PRODUCTION INVOICE DEBUG');
  console.log('='.repeat(70));
  console.log(`\nFile: ${pdfPath}`);
  console.log(`Node version: ${process.version}`);
  console.log(`INVOICE_PARSER_V2: ${process.env.INVOICE_PARSER_V2}`);
  console.log(`CWD: ${process.cwd()}\n`);

  // Step 1: Read the PDF
  if (!fs.existsSync(pdfPath)) {
    console.error('ERROR: File not found:', pdfPath);
    process.exit(1);
  }

  const pdfBuffer = fs.readFileSync(pdfPath);
  console.log(`PDF size: ${pdfBuffer.length} bytes\n`);

  // Step 2: Extract text using same method as universal processor
  console.log('--- STEP 1: Text Extraction ---');
  let rawText = '';
  try {
    const pdfParse = require('pdf-parse');
    const pdfData = await pdfParse(pdfBuffer);
    rawText = pdfData.text;
    console.log(`Extracted ${rawText.length} characters`);
    console.log('First 500 chars:');
    console.log(rawText.substring(0, 500));
    console.log('...\n');
  } catch (e) {
    console.error('PDF extraction failed:', e.message);
    process.exit(1);
  }

  // Step 3: Run vendor detection
  console.log('--- STEP 2: Vendor Detection ---');
  try {
    const { detectVendor } = require('./services/invoice_parsing_v2/vendorDetector');
    const vendorInfo = detectVendor(rawText);
    console.log(`Vendor: ${vendorInfo.vendorName}`);
    console.log(`Key: ${vendorInfo.vendorKey}`);
    console.log(`Confidence: ${vendorInfo.confidence}%\n`);
  } catch (e) {
    console.error('Vendor detection failed:', e.message);
  }

  // Step 4: Run totals extraction
  console.log('--- STEP 3: Totals Extraction (Line Scan) ---');
  try {
    const { extractTotalsByLineScan } = require('./services/invoice_parsing_v2/totals');
    const totals = extractTotalsByLineScan(rawText);
    console.log(`Total: $${(totals.totalCents / 100).toFixed(2)} (${totals.totalCents} cents)`);
    console.log(`Subtotal: $${(totals.subtotalCents / 100).toFixed(2)}`);
    console.log(`Tax: $${(totals.taxCents / 100).toFixed(2)}`);
    console.log(`Evidence: ${totals.evidence?.total?.name || 'N/A'}`);
    console.log(`Evidence line: "${totals.evidence?.total?.line || 'N/A'}"\n`);
  } catch (e) {
    console.error('Totals extraction failed:', e.message);
  }

  // Step 5: Run full parser
  console.log('--- STEP 4: Full Parser (invoice-parser.js) ---');
  try {
    const invoiceParser = require('./invoice-parser');
    const parsed = invoiceParser.parseInvoice(rawText, { useV2: true, debug: false });
    console.log(`Parser version: ${parsed.parserVersion || 'unknown'}`);
    console.log(`OK: ${parsed.ok}`);
    console.log(`vendorName: "${parsed.vendorName || 'undefined'}"`);
    console.log(`vendorKey: "${parsed.vendorKey || 'undefined'}"`);
    console.log(`vendor.name: "${parsed.vendor?.name || 'undefined'}"`);
    console.log(`totals.totalCents: ${parsed.totals?.totalCents || 0}`);
    console.log(`Items: ${parsed.items?.length || 0}\n`);
  } catch (e) {
    console.error('Parser failed:', e.message, e.stack);
  }

  // Step 6: Run universal processor (full pipeline)
  console.log('--- STEP 5: Universal Processor (Full Pipeline) ---');
  try {
    const universalProcessor = require('./universal-invoice-processor');
    const result = await universalProcessor.processInvoice(
      { base64: pdfBuffer.toString('base64'), mimeType: 'application/pdf', filename: path.basename(pdfPath) },
      { source: 'debug', includeRawText: true }
    );
    console.log(`OK: ${result.ok}`);
    console.log(`File type: ${result.fileType}`);
    console.log(`Extraction method: ${result.extractionMethod}`);
    console.log(`vendorName: "${result.vendorName || 'undefined'}"`);
    console.log(`vendorKey: "${result.vendorKey || 'undefined'}"`);
    console.log(`totals.totalCents: ${result.totals?.totalCents || 0}`);
    console.log(`Items: ${result.items?.length || 0}`);
    console.log(`Raw text length: ${result.rawText?.length || 0}\n`);
  } catch (e) {
    console.error('Universal processor failed:', e.message);
  }

  // Step 7: Show lines containing TOTAL
  console.log('--- STEP 6: Lines Containing "TOTAL" ---');
  const lines = rawText.split('\n');
  lines.forEach((line, i) => {
    if (/TOTAL/i.test(line)) {
      console.log(`Line ${i}: "${line.trim()}"`);
    }
  });

  console.log('\n' + '='.repeat(70));
  console.log('DEBUG COMPLETE');
  console.log('='.repeat(70));
}

// Get PDF path from command line
const pdfPath = process.argv[2];
if (!pdfPath) {
  console.log('Usage: node debug-production-invoice.js /path/to/invoice.pdf');
  console.log('\nThis script debugs the exact production parsing flow.');
  process.exit(1);
}

debugInvoice(pdfPath).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
