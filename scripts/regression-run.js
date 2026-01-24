#!/usr/bin/env node
/**
 * Invoice Parser Regression Test Runner
 *
 * Runs parsing tests against a set of fixture invoices and compares
 * results to expected values. Useful for ensuring parser changes
 * don't break existing functionality.
 *
 * Usage:
 *   node scripts/regression-run.js                    # Run all tests
 *   node scripts/regression-run.js --vendor sysco    # Run tests for specific vendor
 *   node scripts/regression-run.js --update          # Update expected values
 *   node scripts/regression-run.js --verbose         # Show detailed output
 *
 * Fixtures directory: tests/fixtures/invoices/
 * Expected results: tests/fixtures/expected/
 */

const fs = require('fs');
const path = require('path');

// Parse command line args
const args = process.argv.slice(2);
const flags = {
  vendor: args.includes('--vendor') ? args[args.indexOf('--vendor') + 1] : null,
  update: args.includes('--update'),
  verbose: args.includes('--verbose') || args.includes('-v'),
  help: args.includes('--help') || args.includes('-h')
};

if (flags.help) {
  console.log(`
Invoice Parser Regression Test Runner

Usage:
  node scripts/regression-run.js [options]

Options:
  --vendor <name>   Run tests only for specific vendor (sysco, cintas, usfoods, generic)
  --update          Update expected results with current output
  --verbose, -v     Show detailed output for each test
  --help, -h        Show this help message

Fixtures:
  Place test PDFs in: tests/fixtures/invoices/
  Expected results in: tests/fixtures/expected/

Example:
  node scripts/regression-run.js --vendor sysco --verbose
`);
  process.exit(0);
}

// Directories
const FIXTURES_DIR = path.join(__dirname, '../tests/fixtures/invoices');
const EXPECTED_DIR = path.join(__dirname, '../tests/fixtures/expected');
const RESULTS_FILE = path.join(__dirname, '../tests/fixtures/regression-results.json');

// Ensure directories exist
if (!fs.existsSync(FIXTURES_DIR)) {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  console.log(`Created fixtures directory: ${FIXTURES_DIR}`);
  console.log('Add test PDF files to this directory to run regression tests.');
  process.exit(0);
}

if (!fs.existsSync(EXPECTED_DIR)) {
  fs.mkdirSync(EXPECTED_DIR, { recursive: true });
}

// Import parser modules
let parseInvoiceText, extractTextFromPDF;
try {
  parseInvoiceText = require('../services/invoice_parsing_v2').parseInvoiceText;
} catch (e) {
  console.error('Failed to load parser:', e.message);
  process.exit(1);
}

// Try to load PDF extraction
try {
  const processor = require('../universal-invoice-processor');
  extractTextFromPDF = processor.extractTextFromPDF;
} catch (e) {
  console.log('PDF extraction not available, will use .txt fixtures only');
  extractTextFromPDF = null;
}

/**
 * Load expected results for a fixture
 */
function loadExpected(fixtureName) {
  const expectedPath = path.join(EXPECTED_DIR, `${fixtureName}.json`);
  if (fs.existsSync(expectedPath)) {
    return JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
  }
  return null;
}

/**
 * Save expected results for a fixture
 */
function saveExpected(fixtureName, result) {
  const expectedPath = path.join(EXPECTED_DIR, `${fixtureName}.json`);
  const data = {
    vendorKey: result.vendorKey,
    vendorName: result.vendorName,
    invoiceNumber: result.invoiceNumber,
    invoiceDate: result.invoiceDate,
    totals: result.totals,
    lineItemCount: result.lineItems?.length || 0,
    lineItemsSum: (result.lineItems || []).reduce((s, i) => s + (i.lineTotalCents || 0), 0),
    confidence: result.confidence?.score || 0,
    issues: result.confidence?.issues || [],
    // Store sample items for verification
    sampleItems: (result.lineItems || []).slice(0, 3).map(item => ({
      description: item.description?.slice(0, 50),
      quantity: item.quantity,
      lineTotalCents: item.lineTotalCents
    })),
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(expectedPath, JSON.stringify(data, null, 2));
  return data;
}

/**
 * Compare actual result to expected
 */
function compareResults(actual, expected) {
  const issues = [];
  const warnings = [];

  // Check totals
  if (actual.totals.totalCents !== expected.totals.totalCents) {
    const diff = actual.totals.totalCents - expected.totals.totalCents;
    issues.push(`Total mismatch: got $${(actual.totals.totalCents/100).toFixed(2)}, expected $${(expected.totals.totalCents/100).toFixed(2)} (diff: ${diff})`);
  }

  if (actual.totals.subtotalCents !== expected.totals.subtotalCents) {
    const diff = actual.totals.subtotalCents - expected.totals.subtotalCents;
    issues.push(`Subtotal mismatch: got $${(actual.totals.subtotalCents/100).toFixed(2)}, expected $${(expected.totals.subtotalCents/100).toFixed(2)}`);
  }

  if (actual.totals.taxCents !== expected.totals.taxCents) {
    const diff = actual.totals.taxCents - expected.totals.taxCents;
    warnings.push(`Tax mismatch: got $${(actual.totals.taxCents/100).toFixed(2)}, expected $${(expected.totals.taxCents/100).toFixed(2)}`);
  }

  // Check line item count
  const actualCount = actual.lineItems?.length || 0;
  if (actualCount !== expected.lineItemCount) {
    if (Math.abs(actualCount - expected.lineItemCount) > 2) {
      issues.push(`Line item count mismatch: got ${actualCount}, expected ${expected.lineItemCount}`);
    } else {
      warnings.push(`Line item count slightly different: got ${actualCount}, expected ${expected.lineItemCount}`);
    }
  }

  // Check items sum
  const actualSum = (actual.lineItems || []).reduce((s, i) => s + (i.lineTotalCents || 0), 0);
  if (Math.abs(actualSum - expected.lineItemsSum) > 100) {
    const pct = expected.lineItemsSum > 0 ? Math.abs(actualSum - expected.lineItemsSum) / expected.lineItemsSum : 1;
    if (pct > 0.05) {
      issues.push(`Items sum mismatch: got $${(actualSum/100).toFixed(2)}, expected $${(expected.lineItemsSum/100).toFixed(2)}`);
    } else {
      warnings.push(`Items sum slightly different: got $${(actualSum/100).toFixed(2)}, expected $${(expected.lineItemsSum/100).toFixed(2)}`);
    }
  }

  // Check vendor
  if (actual.vendorKey !== expected.vendorKey) {
    warnings.push(`Vendor changed: got ${actual.vendorKey}, expected ${expected.vendorKey}`);
  }

  // Check confidence score (allow some variance)
  const confidenceScore = actual.confidence?.score || 0;
  if (Math.abs(confidenceScore - expected.confidence) > 15) {
    if (confidenceScore < expected.confidence) {
      warnings.push(`Confidence dropped: got ${confidenceScore}, was ${expected.confidence}`);
    } else {
      // Improvement is okay
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    warnings,
    actual: {
      totalCents: actual.totals.totalCents,
      lineItemCount: actual.lineItems?.length || 0,
      confidence: actual.confidence?.score || 0
    }
  };
}

/**
 * Run a single test
 */
async function runTest(fixturePath) {
  const fixtureName = path.basename(fixturePath, path.extname(fixturePath));
  const ext = path.extname(fixturePath).toLowerCase();

  let text;
  try {
    if (ext === '.txt') {
      text = fs.readFileSync(fixturePath, 'utf8');
    } else if (ext === '.pdf' && extractTextFromPDF) {
      const pdfBuffer = fs.readFileSync(fixturePath);
      text = await extractTextFromPDF(pdfBuffer);
    } else {
      return {
        name: fixtureName,
        skipped: true,
        reason: ext === '.pdf' ? 'PDF extraction not available' : 'Unsupported file type'
      };
    }

    // Parse the invoice
    const result = parseInvoiceText(text, { debug: true });

    // Load or create expected results
    let expected = loadExpected(fixtureName);

    if (!expected || flags.update) {
      expected = saveExpected(fixtureName, result);
      return {
        name: fixtureName,
        updated: true,
        result: {
          totalCents: result.totals.totalCents,
          lineItemCount: result.lineItems?.length || 0,
          confidence: result.confidence?.score || 0,
          vendor: result.vendorKey
        }
      };
    }

    // Compare results
    const comparison = compareResults(result, expected);

    return {
      name: fixtureName,
      passed: comparison.passed,
      issues: comparison.issues,
      warnings: comparison.warnings,
      actual: comparison.actual,
      expected: {
        totalCents: expected.totals.totalCents,
        lineItemCount: expected.lineItemCount,
        confidence: expected.confidence
      }
    };

  } catch (error) {
    return {
      name: fixtureName,
      error: error.message,
      passed: false
    };
  }
}

/**
 * Main function
 */
async function main() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  Invoice Parser Regression Test Runner');
  console.log('='.repeat(60));
  console.log('');

  // Find all fixture files
  const files = fs.readdirSync(FIXTURES_DIR)
    .filter(f => ['.txt', '.pdf'].includes(path.extname(f).toLowerCase()))
    .map(f => path.join(FIXTURES_DIR, f));

  if (files.length === 0) {
    console.log('No fixture files found.');
    console.log(`Add .txt or .pdf files to: ${FIXTURES_DIR}`);
    process.exit(0);
  }

  // Filter by vendor if specified
  let testFiles = files;
  if (flags.vendor) {
    testFiles = files.filter(f => f.toLowerCase().includes(flags.vendor.toLowerCase()));
    console.log(`Filtering for vendor: ${flags.vendor}`);
  }

  console.log(`Found ${testFiles.length} fixture files`);
  console.log('');

  // Run tests
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    updated: 0,
    tests: []
  };

  for (const file of testFiles) {
    const result = await runTest(file);
    results.tests.push(result);
    results.total++;

    if (result.skipped) {
      results.skipped++;
      if (flags.verbose) {
        console.log(`⏭️  SKIP: ${result.name} - ${result.reason}`);
      }
    } else if (result.updated) {
      results.updated++;
      console.log(`📝 UPDATED: ${result.name}`);
      if (flags.verbose) {
        console.log(`   Total: $${(result.result.totalCents/100).toFixed(2)}, Items: ${result.result.lineItemCount}, Conf: ${result.result.confidence}`);
      }
    } else if (result.error) {
      results.failed++;
      console.log(`❌ ERROR: ${result.name}`);
      console.log(`   ${result.error}`);
    } else if (result.passed) {
      results.passed++;
      console.log(`✅ PASS: ${result.name}`);
      if (flags.verbose && result.warnings.length > 0) {
        for (const w of result.warnings) {
          console.log(`   ⚠️  ${w}`);
        }
      }
    } else {
      results.failed++;
      console.log(`❌ FAIL: ${result.name}`);
      for (const issue of result.issues) {
        console.log(`   ❌ ${issue}`);
      }
      if (flags.verbose) {
        for (const w of result.warnings) {
          console.log(`   ⚠️  ${w}`);
        }
        console.log(`   Actual: Total=$${(result.actual.totalCents/100).toFixed(2)}, Items=${result.actual.lineItemCount}, Conf=${result.actual.confidence}`);
        console.log(`   Expected: Total=$${(result.expected.totalCents/100).toFixed(2)}, Items=${result.expected.lineItemCount}, Conf=${result.expected.confidence}`);
      }
    }
  }

  // Summary
  console.log('');
  console.log('-'.repeat(60));
  console.log('Summary:');
  console.log(`  Total:   ${results.total}`);
  console.log(`  Passed:  ${results.passed} ✅`);
  console.log(`  Failed:  ${results.failed} ❌`);
  console.log(`  Skipped: ${results.skipped} ⏭️`);
  console.log(`  Updated: ${results.updated} 📝`);
  console.log('-'.repeat(60));

  // Save results
  results.runAt = new Date().toISOString();
  results.flags = flags;
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`Results saved to: ${RESULTS_FILE}`);

  // Exit with error code if tests failed
  if (results.failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Regression test runner error:', err);
  process.exit(1);
});
