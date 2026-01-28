#!/usr/bin/env node
/**
 * Invoice Parse Test CLI
 *
 * Usage:
 *   node parse-test.js invoice.pdf           # Parse a PDF
 *   node parse-test.js invoice.txt           # Parse extracted text
 *   node parse-test.js --raw "paste text"    # Parse raw text directly
 *   node parse-test.js --debug invoice.pdf   # Verbose debug output
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Import parser
const { parseInvoiceText } = require('./services/invoice_parsing_v2');
const { detectVendor } = require('./services/invoice_parsing_v2/vendorDetector');
const { normalizeInvoiceText } = require('./services/invoice_parsing_v2/utils');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function log(color, ...args) {
  console.log(color + args.join(' ') + colors.reset);
}

/**
 * Extract text from PDF using pdftotext
 */
function extractTextFromPDF(pdfPath) {
  try {
    // Try pdftotext first (best quality)
    const text = execSync(`pdftotext -layout "${pdfPath}" -`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    return text;
  } catch (e) {
    // Fallback: try without -layout flag
    try {
      const text = execSync(`pdftotext "${pdfPath}" -`, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
      });
      return text;
    } catch (e2) {
      console.error('Error: pdftotext not found. Install poppler-utils:');
      console.error('  macOS: brew install poppler');
      console.error('  Ubuntu: apt-get install poppler-utils');
      process.exit(1);
    }
  }
}

/**
 * Format currency
 */
function formatMoney(cents) {
  return '$' + (cents / 100).toFixed(2);
}

/**
 * Main parse and display function
 */
function parseAndDisplay(text, options = {}) {
  const debug = options.debug || false;

  log(colors.cyan, '\n' + '='.repeat(60));
  log(colors.cyan, ' INVOICE PARSE TEST');
  log(colors.cyan, '='.repeat(60));

  // Step 1: Vendor Detection
  log(colors.yellow, '\n[1] VENDOR DETECTION');
  const normalized = normalizeInvoiceText(text);
  const vendor = detectVendor(normalized);

  log(colors.bright, `    Vendor: ${vendor.vendorName || 'Unknown'}`);
  log(colors.gray, `    Key: ${vendor.vendorKey}, Confidence: ${vendor.confidence}%`);
  if (vendor.matchDetails && debug) {
    vendor.matchDetails.slice(0, 3).forEach(m => {
      log(colors.gray, `      - /${m.pattern.slice(0, 40)}.../ (${m.score}pts)`);
    });
  }

  // Step 2: Full Parse
  log(colors.yellow, '\n[2] PARSING INVOICE...');
  const result = parseInvoiceText(text, { debug: true });

  // Step 3: Display Results
  log(colors.yellow, '\n[3] RESULTS');

  // Metadata
  log(colors.bright, '\n  METADATA:');
  log(colors.reset, `    Invoice #: ${result.invoiceNumber || 'N/A'}`);
  log(colors.reset, `    Date: ${result.invoiceDate || 'N/A'}`);
  log(colors.reset, `    Customer: ${result.customerName || 'N/A'}`);

  // Totals
  log(colors.bright, '\n  TOTALS:');
  log(colors.reset, `    Subtotal: ${formatMoney(result.totals?.subtotalCents || 0)}`);
  log(colors.reset, `    Tax: ${formatMoney(result.totals?.taxCents || 0)}`);
  log(colors.green, `    TOTAL: ${formatMoney(result.totals?.totalCents || 0)}`);

  // Line Items
  const items = result.lineItems || [];
  log(colors.bright, `\n  LINE ITEMS (${items.length} found):`);

  if (items.length === 0) {
    log(colors.red, '    No line items extracted!');
  } else {
    let itemsSum = 0;
    items.forEach((item, i) => {
      const total = item.lineTotalCents || 0;
      itemsSum += total;
      const qty = item.qty || item.quantity || 1;
      const desc = (item.description || 'Unknown').substring(0, 35).padEnd(35);
      const sku = item.sku ? `[${item.sku}] ` : '';
      log(colors.reset, `    ${(i+1).toString().padStart(2)}. ${sku}${desc} x${qty}  ${formatMoney(total).padStart(10)}`);
    });

    log(colors.gray, '    ' + '-'.repeat(55));
    log(colors.bright, `    Line Items Sum: ${formatMoney(itemsSum).padStart(43)}`);

    // Reconciliation
    const invoiceTotal = result.totals?.totalCents || 0;
    const diff = Math.abs(itemsSum - invoiceTotal);
    const diffPct = invoiceTotal > 0 ? (diff / invoiceTotal * 100).toFixed(1) : 0;

    if (diff <= 100) { // Within $1
      log(colors.green, `    Match: ${diffPct}% difference (OK)`);
    } else {
      log(colors.red, `    MISMATCH: ${formatMoney(diff)} difference (${diffPct}%)`);
    }
  }

  // Confidence
  log(colors.bright, '\n  CONFIDENCE:');
  const conf = result.confidence || {};
  log(colors.reset, `    Score: ${conf.score || 0}%`);
  if (conf.issues && conf.issues.length > 0) {
    log(colors.red, '    Issues:');
    conf.issues.forEach(issue => log(colors.red, `      - ${issue}`));
  }
  if (conf.warnings && conf.warnings.length > 0) {
    log(colors.yellow, '    Warnings:');
    conf.warnings.forEach(warn => log(colors.yellow, `      - ${warn}`));
  }

  // Debug: Raw text sample
  if (debug) {
    log(colors.yellow, '\n[DEBUG] RAW TEXT SAMPLE (first 1000 chars):');
    log(colors.gray, text.substring(0, 1000).replace(/\n/g, '\n    '));
  }

  log(colors.cyan, '\n' + '='.repeat(60) + '\n');

  return result;
}

// Main
const args = process.argv.slice(2);
let debug = false;
let inputPath = null;
let rawText = null;

// Parse arguments
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--debug' || args[i] === '-d') {
    debug = true;
  } else if (args[i] === '--raw' || args[i] === '-r') {
    rawText = args[i + 1];
    i++;
  } else if (!args[i].startsWith('-')) {
    inputPath = args[i];
  }
}

if (!inputPath && !rawText) {
  console.log(`
Invoice Parse Test CLI

Usage:
  node parse-test.js <invoice.pdf>        Parse a PDF file
  node parse-test.js <invoice.txt>        Parse a text file
  node parse-test.js --raw "text..."      Parse raw text
  node parse-test.js --debug <file>       Enable debug output

Examples:
  node parse-test.js ./invoices/sysco-jan.pdf
  node parse-test.js --debug ./test.pdf
  node parse-test.js --raw "INVOICE #123..."
`);
  process.exit(0);
}

let text;

if (rawText) {
  text = rawText;
} else if (inputPath) {
  const fullPath = path.resolve(inputPath);

  if (!fs.existsSync(fullPath)) {
    console.error(`Error: File not found: ${fullPath}`);
    process.exit(1);
  }

  const ext = path.extname(fullPath).toLowerCase();

  if (ext === '.pdf') {
    console.log(`Extracting text from PDF: ${fullPath}`);
    text = extractTextFromPDF(fullPath);
  } else {
    // Assume text file
    text = fs.readFileSync(fullPath, 'utf8');
  }
}

parseAndDisplay(text, { debug });
