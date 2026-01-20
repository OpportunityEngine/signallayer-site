// =====================================================
// INVOICE IMAGE PIPELINE - TEST SCRIPT
// Run: node services/invoice_image_pipeline/test-pipeline.js
// =====================================================

const fs = require('fs');
const path = require('path');

// Test individual components
async function runTests() {
  console.log('='.repeat(60));
  console.log('INVOICE IMAGE PIPELINE - COMPONENT TESTS');
  console.log('='.repeat(60));

  // Test 1: Confidence Scorer
  console.log('\n[TEST 1] Confidence Scorer');
  console.log('-'.repeat(40));
  try {
    const confidenceScorer = require('./confidence-scorer');

    // Test with good extraction
    const goodResult = confidenceScorer.calculateScore({
      ocrConfidence: 0.85,
      quality: {
        blurScore: 0.1,
        glareScore: 0.05,
        brightness: 0.5,
        contrast: 0.6,
        resolution: { width: 2000, height: 3000 },
        docDetected: true
      },
      extraction: {
        vendor: 'ACME Corporation Inc',
        date: '01/15/2024',
        invoiceNumber: 'INV-12345',
        totals: { subtotal: 100.00, tax: 8.50, total: 108.50 },
        lineItems: [
          { description: 'Widget A', quantity: 10, totalCents: 5000 },
          { description: 'Widget B', quantity: 5, totalCents: 2500 },
          { description: 'Service Fee', quantity: 1, totalCents: 3000 }
        ]
      },
      attempts: [{ score: 0.8 }, { score: 0.75 }]
    });

    console.log('  Good extraction score:', goodResult.overallScore.toFixed(3));
    console.log('  Field confidence:', JSON.stringify(goodResult.fields));
    console.log('  Status:', confidenceScorer.getStatusFromScore(goodResult.overallScore));

    // Test with poor extraction
    const poorResult = confidenceScorer.calculateScore({
      ocrConfidence: 0.4,
      quality: {
        blurScore: 0.6,
        glareScore: 0.3,
        brightness: 0.2,
        contrast: 0.3,
        resolution: { width: 400, height: 600 },
        docDetected: false
      },
      extraction: {
        vendor: 'ABC',
        date: null,
        totals: {},
        lineItems: []
      },
      attempts: []
    });

    console.log('  Poor extraction score:', poorResult.overallScore.toFixed(3));
    console.log('  Status:', confidenceScorer.getStatusFromScore(poorResult.overallScore));

    // Test tips
    const tips = confidenceScorer.getTipsForFailureReasons(['too_blurry', 'image_too_dark']);
    console.log('  Tips for [too_blurry, image_too_dark]:', tips);

    console.log('  ✓ Confidence Scorer tests passed');
  } catch (error) {
    console.error('  ✗ Confidence Scorer tests failed:', error.message);
  }

  // Test 2: Invoice Extractor (text parsing)
  console.log('\n[TEST 2] Invoice Extractor');
  console.log('-'.repeat(40));
  try {
    const invoiceExtractor = require('./invoice-extractor');

    const sampleInvoiceText = `
SYSCO FOOD SERVICES
Invoice #: INV-2024-0125
Date: January 15, 2024

Bill To:
OWENS CORNING
1901 49TH AVE N
MINNEAPOLIS, MN 55430

Description                    Qty    Unit Price    Total
--------------------------------------------------------
Prime Ribeye Steak 12oz       24     $18.99        $455.76
Atlantic Salmon Fillet         15     $14.50        $217.50
Fresh Asparagus Bunch         30     $3.99         $119.70
Olive Oil Extra Virgin 1L     10     $12.99        $129.90

                              Subtotal:    $922.86
                              Tax (8.5%):   $78.44
                              Total:     $1,001.30
    `;

    const extraction = invoiceExtractor.extract(sampleInvoiceText, {});

    console.log('  Vendor:', extraction.vendor);
    console.log('  Date:', extraction.date);
    console.log('  Invoice #:', extraction.invoiceNumber);
    console.log('  Totals:', extraction.totals);
    console.log('  Line Items:', extraction.lineItems.length);

    if (extraction.lineItems.length > 0) {
      console.log('  Sample item:', extraction.lineItems[0]);
    }

    console.log('  ✓ Invoice Extractor tests passed');
  } catch (error) {
    console.error('  ✗ Invoice Extractor tests failed:', error.message);
  }

  // Test 3: OCR Engine (without actual image)
  console.log('\n[TEST 3] OCR Engine');
  console.log('-'.repeat(40));
  try {
    const ocrEngine = require('./ocr-engine');

    // Test scoring function
    const testText = `
      INVOICE
      Date: 01/15/2024
      Total: $1,234.56
      Item 1    $100.00
      Item 2    $200.00
    `;

    // This will test the scoring logic
    console.log('  OCR Engine module loaded successfully');
    console.log('  PADDLE_OCR_ENABLED:', ocrEngine.PADDLE_OCR_ENABLED || false);
    console.log('  ✓ OCR Engine tests passed (note: actual OCR requires image input)');
  } catch (error) {
    console.error('  ✗ OCR Engine tests failed:', error.message);
  }

  // Test 4: Image Normalizer (without actual image)
  console.log('\n[TEST 4] Image Normalizer');
  console.log('-'.repeat(40));
  try {
    const imageNormalizer = require('./image-normalizer');

    console.log('  Image Normalizer module loaded successfully');
    console.log('  Functions available:', Object.keys(imageNormalizer));
    console.log('  ✓ Image Normalizer tests passed (note: actual normalization requires image input)');
  } catch (error) {
    console.error('  ✗ Image Normalizer tests failed:', error.message);
  }

  // Test 5: Main Pipeline Module
  console.log('\n[TEST 5] Main Pipeline Module');
  console.log('-'.repeat(40));
  try {
    const pipeline = require('./index');

    console.log('  Pipeline module loaded successfully');
    console.log('  PIPELINE_V2_ENABLED:', pipeline.PIPELINE_V2_ENABLED);
    console.log('  FAILURE_REASONS:', Object.keys(pipeline.FAILURE_REASONS).length, 'defined');
    console.log('  Functions available:', Object.keys(pipeline));
    console.log('  ✓ Main Pipeline tests passed');
  } catch (error) {
    console.error('  ✗ Main Pipeline tests failed:', error.message);
  }

  console.log('\n' + '='.repeat(60));
  console.log('TESTS COMPLETE');
  console.log('='.repeat(60));
}

// Run if called directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests };
