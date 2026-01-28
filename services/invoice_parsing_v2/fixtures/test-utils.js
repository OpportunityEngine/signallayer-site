/**
 * Invoice Parsing V2 - Test Utilities
 * Helper functions for loading fixtures and validating parse results
 */

const fs = require('fs');
const path = require('path');

/**
 * Load a fixture pair (.txt and .expected.json)
 * @param {string} vendor - Vendor subdirectory (cintas, sysco, usfoods, generic)
 * @param {string} name - Fixture name without extension (e.g., 'sample-001')
 * @returns {{ text: string, expected: object }} The fixture text and expected parse result
 */
function loadFixture(vendor, name) {
  const fixturesDir = __dirname;
  const vendorDir = path.join(fixturesDir, vendor);

  const textPath = path.join(vendorDir, `${name}.txt`);
  const expectedPath = path.join(vendorDir, `${name}.expected.json`);

  if (!fs.existsSync(textPath)) {
    throw new Error(`Fixture text file not found: ${textPath}`);
  }

  if (!fs.existsSync(expectedPath)) {
    throw new Error(`Fixture expected JSON not found: ${expectedPath}`);
  }

  const text = fs.readFileSync(textPath, 'utf-8');
  const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf-8'));

  return { text, expected };
}

/**
 * List all available fixtures for a vendor
 * @param {string} vendor - Vendor subdirectory
 * @returns {string[]} Array of fixture names (without extensions)
 */
function listFixtures(vendor) {
  const fixturesDir = __dirname;
  const vendorDir = path.join(fixturesDir, vendor);

  if (!fs.existsSync(vendorDir)) {
    return [];
  }

  const files = fs.readdirSync(vendorDir);
  const txtFiles = files.filter(f => f.endsWith('.txt'));

  return txtFiles.map(f => f.replace('.txt', ''));
}

/**
 * Compare parse results against expected values with optional tolerance
 * @param {object} result - Actual parse result from parser
 * @param {object} expected - Expected parse result from fixture
 * @param {object} options - Comparison options
 * @param {number} [options.centsTolerance=0] - Tolerance in cents for monetary comparisons
 * @param {boolean} [options.ignoreDebug=true] - Whether to ignore debug fields
 * @returns {{ passed: boolean, errors: string[] }} Comparison result
 */
function assertParseMatch(result, expected, options = {}) {
  const { centsTolerance = 0, ignoreDebug = true } = options;
  const errors = [];

  // Compare header fields
  // Note: Parser V2 returns flat structure, not nested header object
  if (expected.header) {
    const headerFieldMapping = {
      invoiceNumber: 'invoiceNumber',
      invoiceDate: 'invoiceDate',
      accountNumber: 'accountNumber',
      customerName: 'customerName',
      soldTo: 'soldTo',
      billTo: 'billTo',
      shipTo: 'shipTo',
      vendorName: 'vendorName'
    };

    for (const [key, expectedValue] of Object.entries(expected.header)) {
      if (expectedValue === null) continue;

      // Check both flat structure and nested header
      const actualValue = result[key] || (result.header && result.header[key]);

      if (actualValue !== expectedValue) {
        errors.push(`header.${key}: expected "${expectedValue}", got "${actualValue}"`);
      }
    }
  }

  // Compare totals with tolerance
  if (expected.totals) {
    const totalFields = ['subtotalCents', 'taxCents', 'totalCents'];
    for (const field of totalFields) {
      if (expected.totals[field] !== undefined) {
        const diff = Math.abs((result.totals[field] || 0) - expected.totals[field]);
        if (diff > centsTolerance) {
          errors.push(`totals.${field}: expected ${expected.totals[field]}, got ${result.totals[field]} (diff: ${diff})`);
        }
      }
    }
  }

  // Compare line items count
  if (expected.lineItems) {
    if (result.lineItems.length !== expected.lineItems.length) {
      errors.push(`lineItems.length: expected ${expected.lineItems.length}, got ${result.lineItems.length}`);
    }

    // Compare each line item
    const minLength = Math.min(result.lineItems.length, expected.lineItems.length);
    for (let i = 0; i < minLength; i++) {
      const actual = result.lineItems[i];
      const exp = expected.lineItems[i];

      // Compare description (case-insensitive, trim whitespace)
      if (exp.description) {
        const actualDesc = (actual.description || '').trim().toUpperCase();
        const expDesc = exp.description.trim().toUpperCase();
        if (!actualDesc.includes(expDesc) && !expDesc.includes(actualDesc)) {
          errors.push(`lineItems[${i}].description: expected "${exp.description}", got "${actual.description}"`);
        }
      }

      // Compare qty (parser may use 'qty' or 'quantity')
      if (exp.qty !== undefined) {
        const actualQty = actual.qty !== undefined ? actual.qty : actual.quantity;
        if (actualQty !== exp.qty) {
          errors.push(`lineItems[${i}].qty: expected ${exp.qty}, got ${actualQty}`);
        }
      }

      // Compare prices with tolerance
      if (exp.unitPriceCents !== undefined) {
        const diff = Math.abs((actual.unitPriceCents || 0) - exp.unitPriceCents);
        if (diff > centsTolerance) {
          errors.push(`lineItems[${i}].unitPriceCents: expected ${exp.unitPriceCents}, got ${actual.unitPriceCents}`);
        }
      }

      if (exp.lineTotalCents !== undefined) {
        const diff = Math.abs((actual.lineTotalCents || 0) - exp.lineTotalCents);
        if (diff > centsTolerance) {
          errors.push(`lineItems[${i}].lineTotalCents: expected ${exp.lineTotalCents}, got ${actual.lineTotalCents}`);
        }
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors
  };
}

/**
 * Validate mathematical consistency of parse result
 * Checks that line items sum correctly to subtotal
 * @param {object} result - Parse result to validate
 * @param {object} options - Validation options
 * @param {number} [options.centsTolerance=100] - Tolerance in cents (default $1.00 for rounding)
 * @returns {{ valid: boolean, errors: string[], computed: object }} Validation result
 */
function validateMath(result, options = {}) {
  const { centsTolerance = 100 } = options;
  const errors = [];
  const computed = {
    lineItemsSum: 0,
    taxableSum: 0,
    nonTaxableSum: 0
  };

  // Sum all line items
  if (result.lineItems && result.lineItems.length > 0) {
    for (const item of result.lineItems) {
      const lineTotal = item.lineTotalCents || 0;
      computed.lineItemsSum += lineTotal;

      // Track taxable vs non-taxable
      if (item.taxFlag === 'Y') {
        computed.taxableSum += lineTotal;
      } else if (item.taxFlag === 'N') {
        computed.nonTaxableSum += lineTotal;
      } else {
        // Unknown tax status - assume taxable
        computed.taxableSum += lineTotal;
      }
    }
  }

  // Compare line items sum to subtotal
  if (result.totals && result.totals.subtotalCents > 0) {
    const diff = Math.abs(computed.lineItemsSum - result.totals.subtotalCents);
    if (diff > centsTolerance) {
      errors.push(
        `Line items sum (${computed.lineItemsSum}) does not match subtotal (${result.totals.subtotalCents}), diff: ${diff} cents`
      );
    }
  }

  // Validate total = subtotal + tax
  if (result.totals && result.totals.totalCents > 0 && result.totals.subtotalCents > 0) {
    const expectedTotal = result.totals.subtotalCents + (result.totals.taxCents || 0);
    const diff = Math.abs(result.totals.totalCents - expectedTotal);
    if (diff > centsTolerance) {
      errors.push(
        `Total (${result.totals.totalCents}) does not equal subtotal (${result.totals.subtotalCents}) + tax (${result.totals.taxCents || 0}), diff: ${diff} cents`
      );
    }
  }

  // Validate each line item: qty * unitPrice = lineTotal
  if (result.lineItems) {
    for (let i = 0; i < result.lineItems.length; i++) {
      const item = result.lineItems[i];
      const qty = item.qty !== undefined ? item.qty : item.quantity;
      const expectedLineTotal = qty * item.unitPriceCents;
      const diff = Math.abs(item.lineTotalCents - expectedLineTotal);
      if (diff > centsTolerance) {
        errors.push(
          `lineItems[${i}]: qty (${qty}) * unitPrice (${item.unitPriceCents}) = ${expectedLineTotal}, but lineTotal is ${item.lineTotalCents}`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    computed
  };
}

/**
 * Format cents as dollars for display
 * @param {number} cents - Amount in cents
 * @returns {string} Formatted dollar amount
 */
function formatCents(cents) {
  return '$' + (cents / 100).toFixed(2);
}

/**
 * Generate a test report for a parse result
 * @param {object} result - Parse result
 * @param {object} expected - Expected result (optional)
 * @returns {string} Formatted test report
 */
function generateReport(result, expected = null) {
  const lines = [];

  lines.push('=== Invoice Parse Report ===');
  lines.push(`Vendor: ${result.vendorKey}`);
  lines.push(`Parser Version: ${result.parserVersion}`);
  lines.push('');

  lines.push('--- Header ---');
  // Support both flat and nested header structure
  const header = result.header || result;
  lines.push(`Invoice #: ${header.invoiceNumber || 'N/A'}`);
  lines.push(`Date: ${header.invoiceDate || 'N/A'}`);
  lines.push(`Customer: ${header.customerName || 'N/A'}`);
  lines.push('');

  lines.push('--- Line Items ---');
  const lineItems = result.lineItems || [];
  lines.push(`Count: ${lineItems.length}`);
  for (const item of lineItems) {
    const qty = item.qty !== undefined ? item.qty : item.quantity;
    lines.push(`  - ${item.description}: ${qty} x ${formatCents(item.unitPriceCents)} = ${formatCents(item.lineTotalCents)}`);
  }
  lines.push('');

  lines.push('--- Totals ---');
  const totals = result.totals || {};
  lines.push(`Subtotal: ${formatCents(totals.subtotalCents || 0)}`);
  lines.push(`Tax: ${formatCents(totals.taxCents || 0)}`);
  lines.push(`Total: ${formatCents(totals.totalCents || 0)}`);
  lines.push('');

  // Math validation
  const mathResult = validateMath(result);
  lines.push('--- Math Validation ---');
  lines.push(`Valid: ${mathResult.valid ? 'YES' : 'NO'}`);
  lines.push(`Computed Line Items Sum: ${formatCents(mathResult.computed.lineItemsSum)}`);
  if (!mathResult.valid) {
    for (const error of mathResult.errors) {
      lines.push(`  ERROR: ${error}`);
    }
  }

  // Comparison with expected
  if (expected) {
    lines.push('');
    lines.push('--- Expected Comparison ---');
    const comparison = assertParseMatch(result, expected);
    lines.push(`Match: ${comparison.passed ? 'YES' : 'NO'}`);
    if (!comparison.passed) {
      for (const error of comparison.errors) {
        lines.push(`  MISMATCH: ${error}`);
      }
    }
  }

  return lines.join('\n');
}

module.exports = {
  loadFixture,
  listFixtures,
  assertParseMatch,
  validateMath,
  formatCents,
  generateReport
};
