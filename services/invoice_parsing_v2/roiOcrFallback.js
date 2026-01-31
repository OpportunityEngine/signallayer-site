/**
 * ROI (Region of Interest) OCR Fallback
 *
 * When main OCR extraction misses critical invoice totals or other key fields,
 * this module crops specific regions of the image and applies enhanced OCR
 * processing to extract the missing data.
 *
 * Key regions for invoices:
 * - Footer (bottom 15-25%): Invoice total, amount due, subtotal, tax
 * - Header (top 10-20%): Vendor name, invoice number, date
 * - Right margin (right 30%): Often contains totals column
 *
 * This "label-anchored" approach looks for anchor text (TOTAL, AMOUNT DUE)
 * then extracts the value immediately following it.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');

// Lazy-load sharp
let sharp = null;
function getSharp() {
  if (!sharp) {
    try {
      sharp = require('sharp');
    } catch (e) {
      console.warn('[ROI_OCR] sharp not available:', e.message);
    }
  }
  return sharp;
}

// Tesseract paths to try
const TESSERACT_PATHS = [
  '/opt/homebrew/bin/tesseract',
  '/usr/local/bin/tesseract',
  '/usr/bin/tesseract'
];

function findTesseract() {
  for (const p of TESSERACT_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  // Fallback: try which
  try {
    const { execSync } = require('child_process');
    const which = execSync('command -v tesseract', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (which) return which;
  } catch (_) {}
  return null;
}

/**
 * Region definitions for invoice extraction
 * Values are percentages of image dimensions
 */
const REGIONS = {
  // Footer region - typically contains totals
  FOOTER: {
    name: 'footer',
    x: 0,      // Start from left edge
    y: 0.75,   // Start at 75% down
    w: 1.0,    // Full width
    h: 0.25    // Bottom 25%
  },

  // Extended footer - sometimes totals are higher up
  FOOTER_EXTENDED: {
    name: 'footer_extended',
    x: 0,
    y: 0.65,
    w: 1.0,
    h: 0.35    // Bottom 35%
  },

  // Right side totals column
  RIGHT_TOTALS: {
    name: 'right_totals',
    x: 0.6,    // Right 40%
    y: 0.5,    // Bottom half
    w: 0.4,
    h: 0.5
  },

  // Header region - vendor, invoice number, date
  HEADER: {
    name: 'header',
    x: 0,
    y: 0,
    w: 1.0,
    h: 0.2     // Top 20%
  },

  // Vendor logo area (top left)
  VENDOR_LOGO: {
    name: 'vendor_logo',
    x: 0,
    y: 0,
    w: 0.5,
    h: 0.15
  }
};

/**
 * Anchor patterns to look for in specific regions
 */
const TOTAL_ANCHORS = [
  // Primary anchors (highest confidence)
  { pattern: /INVOICE\s*TOTAL[:\s]*\$?([\d,]+\.?\d*)/i, field: 'invoiceTotal', confidence: 0.95 },
  { pattern: /TOTAL\s*DUE[:\s]*\$?([\d,]+\.?\d*)/i, field: 'totalDue', confidence: 0.95 },
  { pattern: /AMOUNT\s*DUE[:\s]*\$?([\d,]+\.?\d*)/i, field: 'amountDue', confidence: 0.95 },
  { pattern: /BALANCE\s*DUE[:\s]*\$?([\d,]+\.?\d*)/i, field: 'balanceDue', confidence: 0.92 },
  { pattern: /GRAND\s*TOTAL[:\s]*\$?([\d,]+\.?\d*)/i, field: 'grandTotal', confidence: 0.92 },

  // Secondary anchors
  { pattern: /NET\s*TOTAL[:\s]*\$?([\d,]+\.?\d*)/i, field: 'netTotal', confidence: 0.88 },
  { pattern: /TOTAL\s*AMOUNT[:\s]*\$?([\d,]+\.?\d*)/i, field: 'totalAmount', confidence: 0.88 },
  { pattern: /PLEASE\s*PAY[:\s]*\$?([\d,]+\.?\d*)/i, field: 'pleasePay', confidence: 0.85 },

  // Subtotal and tax
  { pattern: /SUB\s*[-]?\s*TOTAL[:\s]*\$?([\d,]+\.?\d*)/i, field: 'subtotal', confidence: 0.85 },
  { pattern: /MERCHANDISE\s*TOTAL[:\s]*\$?([\d,]+\.?\d*)/i, field: 'merchandiseTotal', confidence: 0.85 },
  { pattern: /TAX[:\s]*\$?([\d,]+\.?\d*)/i, field: 'tax', confidence: 0.8 },
  { pattern: /SALES\s*TAX[:\s]*\$?([\d,]+\.?\d*)/i, field: 'salesTax', confidence: 0.82 },

  // Generic TOTAL (lower confidence, may match section totals)
  { pattern: /\bTOTAL[:\s]*\$?([\d,]+\.?\d*)/i, field: 'total', confidence: 0.7 }
];

/**
 * Extract a region from an image
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {Object} region - Region definition
 * @returns {Promise<Buffer>} - Cropped region as buffer
 */
async function extractRegion(imageBuffer, region) {
  const sharpLib = getSharp();
  if (!sharpLib) {
    throw new Error('sharp not available for region extraction');
  }

  const metadata = await sharpLib(imageBuffer).metadata();
  const { width, height } = metadata;

  const left = Math.floor(width * region.x);
  const top = Math.floor(height * region.y);
  const cropWidth = Math.floor(width * region.w);
  const cropHeight = Math.floor(height * region.h);

  console.log(`[ROI_OCR] Extracting region "${region.name}": ${left},${top} ${cropWidth}x${cropHeight} from ${width}x${height}`);

  const cropped = await sharpLib(imageBuffer)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();

  return cropped;
}

/**
 * Run OCR on a specific image region
 * @param {Buffer} imageBuffer - Image buffer to OCR
 * @param {Object} options - OCR options
 * @returns {Object} - OCR result with text and confidence
 */
async function ocrRegion(imageBuffer, options = {}) {
  const tesseractPath = findTesseract();
  if (!tesseractPath) {
    throw new Error('Tesseract not found');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roi-ocr-'));
  const inputPath = path.join(tmpDir, 'input.png');
  const outputBase = path.join(tmpDir, 'output');

  try {
    fs.writeFileSync(inputPath, imageBuffer);

    // Use PSM 6 (uniform block) for region extraction - best for invoice totals
    const psm = options.psm || '6';

    const args = [
      inputPath,
      outputBase,
      '-l', 'eng',
      '--psm', psm,
      '--oem', '3',
      '-c', 'preserve_interword_spaces=1'
    ];

    const result = spawnSync(tesseractPath, args, { encoding: 'utf8', timeout: 30000 });

    const outputPath = `${outputBase}.txt`;
    if (!fs.existsSync(outputPath)) {
      return { text: '', confidence: 0, error: 'No output from Tesseract' };
    }

    const text = fs.readFileSync(outputPath, 'utf8').trim();

    return {
      text,
      confidence: estimateConfidence(text),
      charCount: text.length
    };

  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

/**
 * Estimate OCR confidence based on text quality
 */
function estimateConfidence(text) {
  if (!text || text.length < 5) return 0.1;

  let score = 0.5;

  // Has money values
  if (/\$[\d,]+\.?\d*|\d+\.\d{2}/.test(text)) score += 0.2;

  // Has total-like keywords
  if (/total|amount|due|subtotal|tax/i.test(text)) score += 0.15;

  // Reasonable text length
  if (text.length > 20) score += 0.05;
  if (text.length > 50) score += 0.05;

  // Low gibberish
  const gibberish = text.match(/[^a-zA-Z0-9\s\.,\-\$\/\(\)\#\:\n\r]/g) || [];
  const gibberishRatio = gibberish.length / text.length;
  if (gibberishRatio < 0.1) score += 0.1;
  if (gibberishRatio > 0.3) score -= 0.2;

  return Math.min(0.95, Math.max(0.1, score));
}

/**
 * Extract totals from OCR text using anchor patterns
 * @param {string} text - OCR text
 * @returns {Object} - Extracted totals
 */
function extractTotalsFromText(text) {
  const results = {
    found: false,
    totals: {},
    matches: [],
    bestTotal: null,
    bestTotalConfidence: 0
  };

  if (!text) return results;

  // Normalize text
  const normalized = text
    .replace(/\r/g, '')
    .replace(/\n+/g, '\n')
    .replace(/\s+/g, ' ');

  // Try each anchor pattern
  for (const anchor of TOTAL_ANCHORS) {
    const match = normalized.match(anchor.pattern);
    if (match && match[1]) {
      const valueStr = match[1].replace(/,/g, '');
      const value = parseFloat(valueStr);

      if (Number.isFinite(value) && value > 0) {
        results.found = true;
        results.totals[anchor.field] = value;
        results.matches.push({
          field: anchor.field,
          value,
          confidence: anchor.confidence,
          matchedText: match[0]
        });

        // Track best total (highest confidence)
        if (anchor.confidence > results.bestTotalConfidence) {
          results.bestTotal = value;
          results.bestTotalConfidence = anchor.confidence;
        }
      }
    }
  }

  return results;
}

/**
 * Main ROI OCR fallback function
 * Tries multiple regions to extract totals that were missed by main OCR
 *
 * @param {Buffer} imageBuffer - Original invoice image
 * @param {Object} options - Options
 * @param {Object} options.currentTotals - Currently extracted totals (to check what's missing)
 * @param {Object} options.tracer - Optional parse tracer for debugging
 * @returns {Promise<Object>} - Fallback extraction results
 */
async function extractMissingTotals(imageBuffer, options = {}) {
  const { currentTotals = {}, tracer = null } = options;
  const TRACE = tracer || { step: () => {} };

  const result = {
    attempted: true,
    success: false,
    regionsChecked: [],
    extractedTotals: {},
    bestTotal: null,
    bestTotalSource: null,
    processingTimeMs: 0
  };

  const startTime = Date.now();

  TRACE.step('ROI_FALLBACK_START', { currentTotals, hasTracer: !!tracer });

  try {
    // Determine if we need to look for totals
    const hasTotalAlready = currentTotals.total || currentTotals.invoiceTotal || currentTotals.amountDue;

    if (hasTotalAlready) {
      TRACE.step('ROI_FALLBACK_COMPLETE', { skipped: true, reason: 'totals_already_present' });
      result.success = false;
      result.skipped = true;
      result.processingTimeMs = Date.now() - startTime;
      return result;
    }

    // Try regions in order of likelihood for totals
    const regionsToTry = [
      REGIONS.FOOTER,
      REGIONS.RIGHT_TOTALS,
      REGIONS.FOOTER_EXTENDED
    ];

    for (const region of regionsToTry) {
      try {
        TRACE.step('ROI_REGION_CROP', { region: region.name });

        const regionBuffer = await extractRegion(imageBuffer, region);
        const ocrResult = await ocrRegion(regionBuffer, { psm: '6' });

        result.regionsChecked.push({
          region: region.name,
          textLength: ocrResult.text?.length || 0,
          confidence: ocrResult.confidence
        });

        TRACE.step('ROI_OCR_RESULT', {
          region: region.name,
          textLength: ocrResult.text?.length || 0,
          confidence: ocrResult.confidence,
          textSample: ocrResult.text?.substring(0, 100)
        });

        if (ocrResult.text && ocrResult.text.length > 10) {
          const extracted = extractTotalsFromText(ocrResult.text);

          if (extracted.found) {
            console.log(`[ROI_OCR] Found totals in ${region.name}:`, extracted.totals);

            // Merge extracted totals
            Object.assign(result.extractedTotals, extracted.totals);

            // Track best total
            if (extracted.bestTotal && extracted.bestTotalConfidence > (result.bestTotalConfidence || 0)) {
              result.bestTotal = extracted.bestTotal;
              result.bestTotalConfidence = extracted.bestTotalConfidence;
              result.bestTotalSource = region.name;
            }

            result.success = true;

            // If we found a high-confidence total, we can stop
            if (extracted.bestTotalConfidence >= 0.9) {
              console.log(`[ROI_OCR] High confidence total found, stopping search`);
              break;
            }
          }
        }

      } catch (regionErr) {
        console.warn(`[ROI_OCR] Error processing region ${region.name}:`, regionErr.message);
        result.regionsChecked.push({
          region: region.name,
          error: regionErr.message
        });
      }
    }

    TRACE.step('ROI_FALLBACK_COMPLETE', {
      success: result.success,
      regionsChecked: result.regionsChecked.length,
      extractedTotals: result.extractedTotals,
      bestTotal: result.bestTotal
    });

  } catch (err) {
    console.error('[ROI_OCR] Fallback error:', err);
    result.error = err.message;
    TRACE.error('ROI fallback failed', err);
  }

  result.processingTimeMs = Date.now() - startTime;
  return result;
}

/**
 * Check if ROI fallback is available (has dependencies)
 */
function isAvailable() {
  return !!getSharp() && !!findTesseract();
}

module.exports = {
  REGIONS,
  TOTAL_ANCHORS,
  extractRegion,
  ocrRegion,
  extractTotalsFromText,
  extractMissingTotals,
  isAvailable
};
