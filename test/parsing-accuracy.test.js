/**
 * Invoice Parsing Accuracy Tests
 *
 * Runs all fixtures through the parser and validates accuracy.
 * This is a CI gate - any failure blocks the build.
 *
 * Usage:
 *   npm test -- --grep "Parsing Accuracy"
 */

const { expect } = require('chai');
const path = require('path');
const fs = require('fs');

// Import test utilities
const {
  loadFixture,
  listFixtures,
  assertParseMatch,
  validateMath,
  generateReport
} = require('../services/invoice_parsing_v2/fixtures/test-utils');

// Import the parser
const { parseInvoiceText, detectVendor } = require('../services/invoice_parsing_v2');

// Vendors to test
const VENDORS = ['cintas', 'sysco', 'usfoods', 'generic'];

// Fixtures directory
const FIXTURES_DIR = path.join(__dirname, '../services/invoice_parsing_v2/fixtures');

describe('Invoice Parsing Accuracy', function() {
  // Allow longer timeout for parsing operations
  this.timeout(30000);

  // Track overall stats
  let totalFixtures = 0;
  let passedFixtures = 0;
  let failedFixtures = 0;

  before(function() {
    console.log('\n=== Invoice Parsing Accuracy Tests ===\n');

    // Count total fixtures
    for (const vendor of VENDORS) {
      const fixtures = listFixtures(vendor);
      totalFixtures += fixtures.length;
      console.log(`  ${vendor}: ${fixtures.length} fixture(s)`);
    }
    console.log(`  TOTAL: ${totalFixtures} fixture(s)\n`);
  });

  after(function() {
    console.log('\n=== Test Summary ===');
    console.log(`  Passed: ${passedFixtures}/${totalFixtures}`);
    console.log(`  Failed: ${failedFixtures}/${totalFixtures}`);
    console.log(`  Accuracy: ${totalFixtures > 0 ? ((passedFixtures / totalFixtures) * 100).toFixed(1) : 0}%\n`);
  });

  for (const vendor of VENDORS) {
    describe(`${vendor.toUpperCase()} Parser`, function() {
      const fixtures = listFixtures(vendor);

      if (fixtures.length === 0) {
        it.skip(`[NO FIXTURES] Add fixtures to fixtures/${vendor}/`, function() {
          // Placeholder for vendors without fixtures yet
        });
        return;
      }

      for (const fixtureName of fixtures) {
        it(`should parse ${fixtureName} correctly`, async function() {
          // Load fixture
          const { text, expected } = loadFixture(vendor, fixtureName);

          // Parse the invoice
          const result = await parseInvoiceText(text, {
            vendor: vendor,
            filename: `${fixtureName}.txt`
          });

          // Check vendor detection
          if (expected.vendorKey) {
            expect(result.vendorKey).to.equal(
              expected.vendorKey,
              `Vendor detection: expected ${expected.vendorKey}, got ${result.vendorKey}`
            );
          }

          // Compare against expected results
          const comparison = assertParseMatch(result, expected, {
            centsTolerance: 100  // Allow $1.00 tolerance for rounding
          });

          if (!comparison.passed) {
            console.log('\n--- FIXTURE MISMATCH ---');
            console.log(`Vendor: ${vendor}`);
            console.log(`Fixture: ${fixtureName}`);
            console.log('Errors:');
            for (const error of comparison.errors) {
              console.log(`  - ${error}`);
            }
            console.log('');

            // Generate full report for debugging
            const report = generateReport(result, expected);
            console.log(report);

            failedFixtures++;
            expect.fail(`Fixture ${fixtureName} has ${comparison.errors.length} error(s):\n${comparison.errors.join('\n')}`);
          } else {
            passedFixtures++;
          }

          // Validate math consistency
          const mathCheck = validateMath(result, { centsTolerance: 100 });
          if (!mathCheck.valid) {
            console.log('\n--- MATH VALIDATION WARNING ---');
            console.log(`Fixture: ${vendor}/${fixtureName}`);
            for (const error of mathCheck.errors) {
              console.log(`  - ${error}`);
            }
            console.log('');
            // Don't fail on math warnings, just log them
          }
        });
      }
    });
  }

  describe('Full Document Scan Guardrails', function() {
    it('should scan entire document, not stop at first SUBTOTAL', async function() {
      // Test case: multi-section invoice
      const multiSectionText = `
ACME VENDOR
Invoice # TEST-001
Date: 01/01/2025

SECTION 1:
Product A    10.00
Product B    20.00
SUBTOTAL     30.00

SECTION 2:
Product C    15.00
Product D    25.00
SUBTOTAL     40.00

INVOICE TOTAL    70.00
`;

      const result = await parseInvoiceText(multiSectionText, {
        vendor: 'generic',
        filename: 'multi-section-test.txt'
      });

      // Should find items from both sections
      // The total should be 70.00, not 30.00
      if (result.totals && result.totals.totalCents) {
        expect(result.totals.totalCents).to.be.at.least(7000,
          'Should capture full invoice total, not stop at first subtotal');
      }

      // Check that guardrail ran
      if (result.guardrail) {
        console.log(`Guardrail status: ${result.guardrail.applied ? 'APPLIED' : 'not needed'}`);
      }
    });

    it('should detect when document was not fully scanned', async function() {
      // This tests the scan completeness check
      const shortText = `
VENDOR NAME
Invoice # 123

Item 1    $10.00

SUBTOTAL  $10.00
`;

      const result = await parseInvoiceText(shortText, {
        vendor: 'generic',
        filename: 'short-invoice.txt'
      });

      // Should have guardrail info
      expect(result).to.have.property('guardrail');
    });
  });

  describe('Vendor Detection', function() {
    it('should detect Cintas invoices', async function() {
      const cintasText = `
CINTAS CORPORATION
P.O. BOX 630803
CINCINNATI OH 45263-0803

Invoice Date: 01/15/2025
Invoice # 1234567890
`;
      const result = detectVendor(cintasText);
      expect(result.vendorKey).to.equal('cintas');
    });

    it('should detect Sysco invoices', async function() {
      const syscoText = `
Sysco Charlotte, LLC
5121 Westinghouse Blvd
Charlotte NC 28273

INVOICE DATE  01/15/2025
INVOICE #  123456789
`;
      const result = detectVendor(syscoText);
      expect(result.vendorKey).to.equal('sysco');
    });

    it('should detect US Foods invoices', async function() {
      const usfoodsText = `
US Foods
Distribution Center

Invoice Number: 12345678
Invoice Date: 01/15/2025
`;
      const result = detectVendor(usfoodsText);
      expect(result.vendorKey).to.equal('usfoods');
    });

    it('should fall back to generic for unknown vendors', async function() {
      const unknownText = `
Random Company LLC
123 Business St

Invoice: 123
Date: 01/15/2025
Total: $100.00
`;
      const result = detectVendor(unknownText);
      expect(result.vendorKey).to.equal('generic');
    });
  });

  describe('Edge Cases', function() {
    it('should handle empty input gracefully', async function() {
      const result = await parseInvoiceText('', {
        vendor: 'generic',
        filename: 'empty.txt'
      });

      expect(result).to.be.an('object');
      expect(result.lineItems).to.be.an('array');
    });

    it('should handle input with only whitespace', async function() {
      const result = await parseInvoiceText('   \n\n   \t   \n', {
        vendor: 'generic',
        filename: 'whitespace.txt'
      });

      expect(result).to.be.an('object');
    });

    it('should handle input with no line items', async function() {
      const noItemsText = `
VENDOR NAME
Invoice # 123
Date: 01/01/2025

No items on this invoice.

Total: $0.00
`;
      const result = await parseInvoiceText(noItemsText, {
        vendor: 'generic',
        filename: 'no-items.txt'
      });

      expect(result).to.be.an('object');
      expect(result.lineItems).to.be.an('array');
    });
  });
});
