/**
 * Universal Invoice Processor
 *
 * Handles ALL invoice formats from ANY source:
 * - PDF files (text-based and scanned)
 * - Phone photos (JPG, PNG, HEIC)
 * - Screenshots
 * - Scanned documents
 * - Direct text input
 *
 * Features:
 * - Automatic format detection
 * - Image preprocessing for mobile photos (rotation, deskew, contrast)
 * - OCR for scanned/image documents
 * - Text extraction from digital PDFs
 * - Unified parsing pipeline
 * - Confidence scoring
 * - Mobile-optimized (handles poor lighting, skew, shadows)
 *
 * This is THE single entry point for all invoice processing.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Lazy-load heavy dependencies
let sharp = null;
let pdfParse = null;

function getSharp() {
  if (!sharp) {
    try {
      sharp = require('sharp');
    } catch (e) {
      console.warn('[UniversalProcessor] sharp not available:', e.message);
    }
  }
  return sharp;
}

function getPdfParse() {
  if (!pdfParse) {
    try {
      pdfParse = require('pdf-parse');
    } catch (e) {
      console.warn('[UniversalProcessor] pdf-parse not available:', e.message);
    }
  }
  return pdfParse;
}

// Import OCR module
let ocrModule = null;
function getOcrModule() {
  if (!ocrModule) {
    try {
      ocrModule = require('./ocr/ocrPdfToText');
    } catch (e) {
      console.warn('[UniversalProcessor] OCR module not available:', e.message);
    }
  }
  return ocrModule;
}

// Import invoice parser
const invoiceParser = require('./invoice-parser');

// ============ FILE TYPE DETECTION ============

const MIME_TYPES = {
  // PDFs
  'application/pdf': 'pdf',

  // Images
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/heic': 'image',
  'image/heif': 'image',
  'image/tiff': 'image',
  'image/bmp': 'image',
  'image/gif': 'image',

  // Text
  'text/plain': 'text',
  'text/html': 'text',
  'application/json': 'text'
};

const FILE_EXTENSIONS = {
  '.pdf': 'pdf',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.webp': 'image',
  '.heic': 'image',
  '.heif': 'image',
  '.tiff': 'image',
  '.tif': 'image',
  '.bmp': 'image',
  '.gif': 'image',
  '.txt': 'text',
  '.html': 'text',
  '.json': 'text'
};

/**
 * Detect file type from buffer magic bytes
 */
function detectFileTypeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return 'unknown';

  // PDF: %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'pdf';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image';
  }

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image';
  }

  // WebP: RIFF....WEBP
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return 'image';
  }

  // GIF: GIF8
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return 'image';
  }

  // BMP: BM
  if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
    return 'image';
  }

  // TIFF: II or MM
  if ((buffer[0] === 0x49 && buffer[1] === 0x49) || (buffer[0] === 0x4D && buffer[1] === 0x4D)) {
    return 'image';
  }

  // HEIC/HEIF: Check for ftyp box
  if (buffer.length > 12 && buffer.slice(4, 8).toString() === 'ftyp') {
    const brand = buffer.slice(8, 12).toString();
    if (['heic', 'heix', 'hevc', 'mif1'].includes(brand)) {
      return 'image';
    }
  }

  // Check if it looks like text (ASCII printable or UTF-8)
  let textScore = 0;
  const sample = Math.min(buffer.length, 1000);
  for (let i = 0; i < sample; i++) {
    const byte = buffer[i];
    if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13) {
      textScore++;
    }
  }
  if (textScore / sample > 0.85) {
    return 'text';
  }

  return 'unknown';
}

/**
 * Detect file type from multiple sources
 */
function detectFileType({ buffer, mimeType, filename }) {
  // Priority 1: Buffer magic bytes (most reliable)
  if (buffer) {
    const detected = detectFileTypeFromBuffer(buffer);
    if (detected !== 'unknown') return detected;
  }

  // Priority 2: MIME type
  if (mimeType && MIME_TYPES[mimeType.toLowerCase()]) {
    return MIME_TYPES[mimeType.toLowerCase()];
  }

  // Priority 3: File extension
  if (filename) {
    const ext = path.extname(filename).toLowerCase();
    if (FILE_EXTENSIONS[ext]) {
      return FILE_EXTENSIONS[ext];
    }
  }

  return 'unknown';
}

// ============ IMAGE PREPROCESSING FOR MOBILE PHOTOS ============

/**
 * Preprocess image for OCR
 * Optimized for phone photos with poor lighting, skew, shadows
 */
async function preprocessImageForOCR(imageBuffer, options = {}) {
  const sharpLib = getSharp();
  if (!sharpLib) {
    console.warn('[UniversalProcessor] sharp not available, skipping preprocessing');
    return imageBuffer;
  }

  const {
    targetDPI = 300,
    maxWidth = 3000,
    maxHeight = 4000,
    autoRotate = true,
    enhanceContrast = true,
    removeNoise = true,
    grayscale = true,
    sharpen = true
  } = options;

  try {
    let image = sharpLib(imageBuffer);
    const metadata = await image.metadata();

    console.log(`[ImagePreprocess] Input: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);

    // 1. Auto-rotate based on EXIF orientation (critical for phone photos)
    if (autoRotate) {
      image = image.rotate(); // Auto-rotate based on EXIF
    }

    // 2. Convert to grayscale (better for OCR)
    if (grayscale) {
      image = image.grayscale();
    }

    // 3. Resize if too large (memory optimization + faster OCR)
    if (metadata.width > maxWidth || metadata.height > maxHeight) {
      image = image.resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    // 4. Normalize/enhance contrast (helps with shadows, poor lighting)
    if (enhanceContrast) {
      image = image.normalize(); // Stretch histogram to full range
    }

    // 5. Remove noise (median filter - good for phone camera noise)
    if (removeNoise) {
      image = image.median(3); // 3x3 median filter
    }

    // 6. Sharpen text (helps OCR accuracy)
    if (sharpen) {
      image = image.sharpen({
        sigma: 1.5,
        m1: 0.5,
        m2: 0.5
      });
    }

    // 7. Convert to PNG for OCR (lossless, good Tesseract compatibility)
    const outputBuffer = await image.png({ quality: 100, compressionLevel: 6 }).toBuffer();

    const outputMetadata = await sharpLib(outputBuffer).metadata();
    console.log(`[ImagePreprocess] Output: ${outputMetadata.width}x${outputMetadata.height}, size: ${outputBuffer.length} bytes`);

    return outputBuffer;

  } catch (err) {
    console.error('[ImagePreprocess] Error:', err.message);
    // Return original if preprocessing fails
    return imageBuffer;
  }
}

/**
 * Advanced preprocessing for difficult images
 * Used when first pass OCR has low confidence
 */
async function advancedImagePreprocessing(imageBuffer) {
  const sharpLib = getSharp();
  if (!sharpLib) return imageBuffer;

  try {
    const outputBuffer = await sharpLib(imageBuffer)
      .rotate() // Auto-rotate
      .grayscale()
      .normalize()
      .linear(1.3, -30) // Increase contrast more aggressively
      .threshold(140) // Binarize for cleaner OCR
      .png()
      .toBuffer();

    return outputBuffer;
  } catch (err) {
    console.error('[AdvancedPreprocess] Error:', err.message);
    return imageBuffer;
  }
}

// ============ TEXT EXTRACTION ============

/**
 * Extract text from PDF buffer
 * Handles both digital and scanned PDFs with multiple fallback methods
 */
async function extractTextFromPDF(pdfBuffer, options = {}) {
  const { useOCRFallback = true, maxPages = 10 } = options;
  const pdfParseLib = getPdfParse();

  if (!pdfParseLib) {
    throw new Error('pdf-parse not available');
  }

  let bestText = '';
  let bestMethod = 'none';
  let bestConfidence = 0;
  let pageCount = 1;

  try {
    // Method 1: Standard pdf-parse extraction
    console.log('[PDFExtract] Trying standard text extraction...');
    const pdfData = await Promise.race([
      pdfParseLib(pdfBuffer),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('PDF parsing timeout')), 30000)
      )
    ]);

    bestText = (pdfData.text || '').trim();
    pageCount = pdfData.numpages || 1;
    bestMethod = 'pdf-parse';

    // Calculate quality score for extracted text
    const textQuality = assessTextQuality(bestText);
    bestConfidence = textQuality.score;

    console.log(`[PDFExtract] Standard extraction: ${bestText.length} chars, quality: ${(textQuality.score * 100).toFixed(0)}%`);

    // If text quality is good (has prices, reasonable length), return it
    if (textQuality.score >= 0.7 && textQuality.hasPrices) {
      return {
        text: cleanExtractedText(bestText),
        method: bestMethod,
        pageCount,
        confidence: bestConfidence
      };
    }

    // Method 2: If low text or quality, try OCR on PDF pages
    if (useOCRFallback && (bestText.length < 200 || textQuality.score < 0.5)) {
      console.log('[PDFExtract] Trying OCR extraction...');

      // Try our OCR module first
      const ocrMod = getOcrModule();
      if (ocrMod && typeof ocrMod.ocrPdfBufferToText === 'function') {
        try {
          const ocrText = ocrMod.ocrPdfBufferToText(pdfBuffer, { maxPages });
          if (ocrText) {
            const ocrQuality = assessTextQuality(ocrText);
            console.log(`[PDFExtract] OCR extraction: ${ocrText.length} chars, quality: ${(ocrQuality.score * 100).toFixed(0)}%`);

            if (ocrQuality.score > bestConfidence) {
              bestText = ocrText;
              bestMethod = 'pdf-ocr';
              bestConfidence = ocrQuality.score;
            }
          }
        } catch (ocrErr) {
          console.warn('[PDFExtract] OCR module failed:', ocrErr.message);
        }
      }

      // Method 3: Convert PDF to image and OCR (fallback for complex PDFs)
      if (bestConfidence < 0.5) {
        try {
          const imageOcrText = await extractPdfViaImageOcr(pdfBuffer);
          if (imageOcrText) {
            const imgQuality = assessTextQuality(imageOcrText);
            console.log(`[PDFExtract] Image-OCR extraction: ${imageOcrText.length} chars, quality: ${(imgQuality.score * 100).toFixed(0)}%`);

            if (imgQuality.score > bestConfidence) {
              bestText = imageOcrText;
              bestMethod = 'pdf-image-ocr';
              bestConfidence = imgQuality.score;
            }
          }
        } catch (imgErr) {
          console.warn('[PDFExtract] Image-OCR failed:', imgErr.message);
        }
      }
    }

    // Method 4: Combine all extracted text if we have multiple sources
    // Sometimes different methods extract different parts
    if (bestConfidence < 0.6 && bestText.length > 0) {
      bestText = cleanExtractedText(bestText);
    }

    return {
      text: bestText,
      method: bestMethod,
      pageCount,
      confidence: Math.max(0.2, bestConfidence) // Minimum confidence if we have any text
    };

  } catch (err) {
    console.error('[PDFExtract] Error:', err.message);
    throw err;
  }
}

/**
 * Assess the quality of extracted text for invoice parsing
 */
function assessTextQuality(text) {
  if (!text || text.length < 10) {
    return { score: 0, hasPrices: false, hasWords: false };
  }

  let score = 0.3; // Base score for having text
  const checks = {
    hasPrices: false,
    hasWords: false,
    hasNumbers: false,
    hasInvoiceKeywords: false,
    hasLineItems: false
  };

  // Check for currency/prices (strong indicator)
  if (/\$\s*[\d,]+\.?\d{0,2}|\d+\.\d{2}\s*(USD|CAD|EUR)?/i.test(text)) {
    score += 0.2;
    checks.hasPrices = true;
  }

  // Check for common invoice keywords
  if (/invoice|total|subtotal|tax|amount|qty|quantity|price|bill|order|ship/i.test(text)) {
    score += 0.15;
    checks.hasInvoiceKeywords = true;
  }

  // Check for reasonable word content (not just gibberish)
  const words = text.match(/[a-zA-Z]{3,}/g) || [];
  if (words.length > 10) {
    score += 0.1;
    checks.hasWords = true;
  }

  // Check for numbers (quantities, prices, dates)
  const numbers = text.match(/\d+/g) || [];
  if (numbers.length > 5) {
    score += 0.1;
    checks.hasNumbers = true;
  }

  // Check for line item patterns (qty + description + price on same line)
  if (/\d+\s+[A-Za-z].*\$?\d+\.\d{2}/m.test(text)) {
    score += 0.15;
    checks.hasLineItems = true;
  }

  // Penalize for too much gibberish
  const gibberish = text.match(/[^\x20-\x7E\n\r\t]/g) || [];
  const gibberishRatio = gibberish.length / text.length;
  if (gibberishRatio > 0.1) {
    score -= gibberishRatio * 0.3;
  }

  return {
    score: Math.min(1, Math.max(0, score)),
    ...checks
  };
}

/**
 * Clean extracted text for better parsing
 */
function cleanExtractedText(text) {
  if (!text) return '';

  return text
    // Normalize whitespace
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove excessive blank lines
    .replace(/\n{3,}/g, '\n\n')
    // Remove null bytes and control characters
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    // Normalize spaces
    .replace(/[ \t]+/g, ' ')
    // Trim lines
    .split('\n').map(line => line.trim()).join('\n')
    .trim();
}

/**
 * Extract text from PDF by converting to image first (for scanned PDFs)
 */
async function extractPdfViaImageOcr(pdfBuffer) {
  const sharpLib = getSharp();
  if (!sharpLib) return null;

  const { spawnSync } = require('child_process');
  const os = require('os');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-img-ocr-'));
  const pdfPath = path.join(tmpDir, 'input.pdf');
  const imgPath = path.join(tmpDir, 'page.png');

  try {
    fs.writeFileSync(pdfPath, pdfBuffer);

    // Try pdftoppm first (from poppler-utils)
    let converted = false;
    const pdftoppmPaths = ['/opt/homebrew/bin/pdftoppm', '/usr/local/bin/pdftoppm', '/usr/bin/pdftoppm'];

    for (const ppmPath of pdftoppmPaths) {
      if (fs.existsSync(ppmPath)) {
        const result = spawnSync(ppmPath, [
          '-png', '-r', '300', '-f', '1', '-l', '1',
          pdfPath, path.join(tmpDir, 'page')
        ], { timeout: 30000 });

        // pdftoppm outputs as page-1.png
        const outputPath = path.join(tmpDir, 'page-1.png');
        if (fs.existsSync(outputPath)) {
          fs.renameSync(outputPath, imgPath);
          converted = true;
          break;
        }
      }
    }

    if (!converted) {
      console.log('[PDFImageOCR] pdftoppm not available, skipping image conversion');
      return null;
    }

    // Now OCR the image
    const imageBuffer = fs.readFileSync(imgPath);
    const result = await extractTextFromImage(imageBuffer, { retryWithAdvancedPreprocess: true });

    return result?.text || null;

  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

/**
 * Extract text from image using Tesseract OCR with multi-PSM strategy
 * Tries multiple page segmentation modes to find the best extraction
 */
async function extractTextFromImage(imageBuffer, options = {}) {
  const { retryWithAdvancedPreprocess = true, tryAllPSM = true } = options;
  const { execSync, spawnSync } = require('child_process');
  const os = require('os');

  // Find Tesseract
  let tesseractPath = null;
  const possiblePaths = [
    '/opt/homebrew/bin/tesseract',
    '/usr/local/bin/tesseract',
    '/usr/bin/tesseract'
  ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        tesseractPath = p;
        break;
      }
    } catch (_) {}
  }

  if (!tesseractPath) {
    try {
      const which = execSync('command -v tesseract', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (which) tesseractPath = which;
    } catch (_) {}
  }

  if (!tesseractPath) {
    throw new Error('Tesseract not found. Install: brew install tesseract');
  }

  // Create temp directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-ocr-'));
  const outputBase = path.join(tmpDir, 'output');

  // Define PSM modes to try (ordered by likelihood for invoices)
  // PSM 3 = Fully automatic page segmentation (default)
  // PSM 4 = Assume single column of text of variable sizes
  // PSM 6 = Assume uniform block of text
  // PSM 11 = Sparse text - find as much text as possible
  // PSM 12 = Sparse text with OSD
  const psmModes = [
    { psm: '6', name: 'uniform-block', description: 'Uniform block of text' },
    { psm: '3', name: 'auto', description: 'Fully automatic' },
    { psm: '4', name: 'single-column', description: 'Single column' },
    { psm: '11', name: 'sparse', description: 'Sparse text - max extraction' },
    { psm: '1', name: 'auto-osd', description: 'Auto with orientation detection' }
  ];

  // Preprocessing variants to try
  const preprocessingVariants = [
    { name: 'standard', fn: preprocessImageForOCR },
    { name: 'advanced', fn: advancedImagePreprocessing },
    { name: 'high-contrast', fn: highContrastPreprocessing }
  ];

  let bestResult = { text: '', confidence: 0, method: 'none' };
  let allExtractedTexts = [];

  try {
    // Phase 1: Try standard preprocessing with multiple PSM modes
    console.log('[ImageOCR] Phase 1: Standard preprocessing with multi-PSM...');
    const standardBuffer = await preprocessImageForOCR(imageBuffer);
    const standardInputPath = path.join(tmpDir, 'standard.png');
    fs.writeFileSync(standardInputPath, standardBuffer);

    for (const psmMode of psmModes.slice(0, 3)) { // Try top 3 PSM modes first
      const result = runTesseract(tesseractPath, standardInputPath, outputBase, psmMode.psm);
      if (result.text) {
        const quality = assessTextQuality(result.text);
        const confidence = calculateOCRConfidence(result.text);

        console.log(`[ImageOCR] PSM ${psmMode.psm} (${psmMode.name}): ${result.text.length} chars, quality: ${(quality.score * 100).toFixed(0)}%`);

        allExtractedTexts.push({
          text: result.text,
          confidence,
          quality,
          method: `tesseract-psm${psmMode.psm}`
        });

        if (confidence > bestResult.confidence) {
          bestResult = { text: result.text, confidence, method: `tesseract-psm${psmMode.psm}` };
        }

        // If we got high quality result, no need to try more modes
        if (quality.score >= 0.75 && quality.hasPrices && quality.hasLineItems) {
          console.log('[ImageOCR] High quality result found, skipping remaining modes');
          break;
        }
      }
    }

    // Phase 2: If low confidence, try advanced preprocessing
    if (bestResult.confidence < 0.6 && retryWithAdvancedPreprocess) {
      console.log('[ImageOCR] Phase 2: Advanced preprocessing...');

      const advancedBuffer = await advancedImagePreprocessing(imageBuffer);
      const advancedInputPath = path.join(tmpDir, 'advanced.png');
      fs.writeFileSync(advancedInputPath, advancedBuffer);

      for (const psmMode of psmModes.slice(0, 2)) {
        const result = runTesseract(tesseractPath, advancedInputPath, outputBase, psmMode.psm);
        if (result.text) {
          const confidence = calculateOCRConfidence(result.text);

          allExtractedTexts.push({
            text: result.text,
            confidence,
            method: `tesseract-advanced-psm${psmMode.psm}`
          });

          if (confidence > bestResult.confidence) {
            console.log(`[ImageOCR] Advanced PSM ${psmMode.psm} improved: ${bestResult.confidence.toFixed(2)} -> ${confidence.toFixed(2)}`);
            bestResult = { text: result.text, confidence, method: `tesseract-advanced-psm${psmMode.psm}` };
          }
        }
      }
    }

    // Phase 3: Try high contrast preprocessing for difficult images
    if (bestResult.confidence < 0.5) {
      console.log('[ImageOCR] Phase 3: High contrast preprocessing...');

      const highContrastBuffer = await highContrastPreprocessing(imageBuffer);
      const highContrastInputPath = path.join(tmpDir, 'highcontrast.png');
      fs.writeFileSync(highContrastInputPath, highContrastBuffer);

      const result = runTesseract(tesseractPath, highContrastInputPath, outputBase, '11'); // Sparse text mode
      if (result.text) {
        const confidence = calculateOCRConfidence(result.text);

        allExtractedTexts.push({
          text: result.text,
          confidence,
          method: 'tesseract-highcontrast-sparse'
        });

        if (confidence > bestResult.confidence) {
          console.log(`[ImageOCR] High contrast improved: ${bestResult.confidence.toFixed(2)} -> ${confidence.toFixed(2)}`);
          bestResult = { text: result.text, confidence, method: 'tesseract-highcontrast-sparse' };
        }
      }
    }

    // Phase 4: Combine texts from multiple extractions for maximum coverage
    if (bestResult.confidence < 0.65 && allExtractedTexts.length > 1) {
      console.log('[ImageOCR] Phase 4: Combining multiple extractions...');
      const combinedText = combineOCRResults(allExtractedTexts);
      const combinedConfidence = calculateOCRConfidence(combinedText);

      if (combinedConfidence > bestResult.confidence) {
        console.log(`[ImageOCR] Combined text improved: ${bestResult.confidence.toFixed(2)} -> ${combinedConfidence.toFixed(2)}`);
        bestResult = { text: combinedText, confidence: combinedConfidence, method: 'tesseract-combined' };
      }
    }

    console.log(`[ImageOCR] Final result: ${bestResult.text.length} chars, confidence: ${(bestResult.confidence * 100).toFixed(0)}%, method: ${bestResult.method}`);

    return {
      text: cleanExtractedText(bestResult.text),
      method: bestResult.method,
      confidence: bestResult.confidence
    };

  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

/**
 * Run Tesseract with specific settings
 */
function runTesseract(tesseractPath, inputPath, outputBase, psm) {
  const { spawnSync } = require('child_process');

  const args = [
    inputPath,
    outputBase,
    '-l', 'eng',
    '--psm', psm,
    '--oem', '3',
    '-c', 'preserve_interword_spaces=1',
    '-c', 'tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:!?@#$%&*()-+=/<>[]{}|\\\'" '
  ];

  const result = spawnSync(tesseractPath, args, { encoding: 'utf8', timeout: 60000 });

  const outputPath = `${outputBase}.txt`;
  let text = '';

  if (fs.existsSync(outputPath)) {
    text = fs.readFileSync(outputPath, 'utf8').trim();
    // Clean up for next run
    try { fs.unlinkSync(outputPath); } catch (_) {}
  }

  return { text, status: result.status };
}

/**
 * High contrast preprocessing for difficult/low quality images
 */
async function highContrastPreprocessing(imageBuffer) {
  const sharpLib = getSharp();
  if (!sharpLib) return imageBuffer;

  try {
    const outputBuffer = await sharpLib(imageBuffer)
      .rotate() // Auto-rotate based on EXIF
      .grayscale()
      .normalize()
      .linear(1.5, -50) // Aggressive contrast increase
      .sharpen({ sigma: 2 })
      .threshold(120) // Binarize
      .negate() // Sometimes inverted helps
      .negate() // Negate back (but after threshold, cleans up)
      .png()
      .toBuffer();

    return outputBuffer;
  } catch (err) {
    console.error('[HighContrastPreprocess] Error:', err.message);
    return imageBuffer;
  }
}

/**
 * Combine multiple OCR results to get maximum text coverage
 * Useful when different PSM modes extract different parts of the document
 */
function combineOCRResults(results) {
  if (!results || results.length === 0) return '';
  if (results.length === 1) return results[0].text;

  // Sort by confidence (best first)
  const sorted = [...results].sort((a, b) => b.confidence - a.confidence);

  // Start with best result
  let combined = sorted[0].text;
  const combinedLines = new Set(combined.split('\n').map(l => l.trim().toLowerCase()).filter(l => l.length > 5));

  // Add unique lines from other results
  for (let i = 1; i < sorted.length; i++) {
    const lines = sorted[i].text.split('\n');
    for (const line of lines) {
      const normalized = line.trim().toLowerCase();
      // Only add if it's a meaningful line we haven't seen
      if (normalized.length > 5 && !combinedLines.has(normalized)) {
        // Check if it contains useful invoice info
        if (/\$|total|qty|quantity|price|tax|\d+\.\d{2}/.test(normalized)) {
          combined += '\n' + line.trim();
          combinedLines.add(normalized);
        }
      }
    }
  }

  return combined;
}

/**
 * Calculate OCR confidence based on text quality
 */
function calculateOCRConfidence(text) {
  if (!text || text.length < 20) return 0.1;

  let score = 0.5;

  // Has currency symbols/amounts (strong invoice indicator)
  if (/\$[\d,]+\.?\d{0,2}|\d+\.\d{2}/.test(text)) score += 0.15;

  // Has invoice-related keywords
  if (/invoice|total|subtotal|tax|qty|quantity|amount|price/i.test(text)) score += 0.15;

  // Has dates
  if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(text)) score += 0.05;

  // Reasonable amount of text
  if (text.length > 200) score += 0.05;
  if (text.length > 500) score += 0.05;

  // Low gibberish ratio (check for repeated unusual characters)
  const gibberishPattern = /[^a-zA-Z0-9\s\.,\-\$\/\(\)\#\@\&\:\;\'\"\%\*\+\=\!\?\n\r\t]/g;
  const gibberishCount = (text.match(gibberishPattern) || []).length;
  const gibberishRatio = gibberishCount / text.length;

  if (gibberishRatio < 0.05) score += 0.1;
  else if (gibberishRatio > 0.2) score -= 0.2;

  return Math.min(0.95, Math.max(0.1, score));
}

// ============ MAIN PROCESSING FUNCTION ============

/**
 * Process any invoice file/data
 *
 * @param {Object} input - Input data
 * @param {Buffer} input.buffer - File buffer (for file uploads)
 * @param {string} input.base64 - Base64-encoded data (for API calls)
 * @param {string} input.text - Raw text (for direct text input)
 * @param {string} input.filePath - Path to file (for file system reads)
 * @param {string} input.mimeType - MIME type hint
 * @param {string} input.filename - Original filename hint
 * @param {Object} options - Processing options
 * @returns {Object} Processed invoice data
 */
async function processInvoice(input, options = {}) {
  const startTime = Date.now();
  const {
    includeRawText = true,
    maxOCRPages = 5,
    preprocessImages = true,
    source = 'unknown'
  } = options;

  const result = {
    ok: false,
    source,
    fileType: 'unknown',
    extractionMethod: 'none',
    extractionConfidence: 0,
    rawText: '',
    rawTextLength: 0,
    parsed: null,
    items: [],
    totals: null,
    vendor: null,
    customer: null,
    metadata: null,
    confidence: { overall: 0 },
    opportunities: [],
    warnings: [],
    processingTimeMs: 0
  };

  try {
    // 1. Get buffer from various input formats
    let buffer = null;
    let text = null;

    if (input.buffer && Buffer.isBuffer(input.buffer)) {
      buffer = input.buffer;
    } else if (input.base64) {
      // Handle base64 with or without data URL prefix
      let base64Data = input.base64;
      if (base64Data.includes(',')) {
        base64Data = base64Data.split(',')[1];
      }
      buffer = Buffer.from(base64Data, 'base64');
    } else if (input.text) {
      text = input.text;
      result.fileType = 'text';
    } else if (input.filePath && fs.existsSync(input.filePath)) {
      buffer = fs.readFileSync(input.filePath);
    }

    if (!buffer && !text) {
      result.warnings.push('No valid input provided');
      result.processingTimeMs = Date.now() - startTime;
      return result;
    }

    // 2. Detect file type
    if (buffer) {
      result.fileType = detectFileType({
        buffer,
        mimeType: input.mimeType,
        filename: input.filename
      });
    }

    console.log(`[UniversalProcessor] File type: ${result.fileType}, size: ${buffer ? buffer.length : 'N/A'}, filename: ${input.filename || 'unknown'}, mimeType: ${input.mimeType || 'unknown'}`);

    // 3. Extract text based on file type
    let extractionResult = null;

    if (text) {
      // Direct text input
      extractionResult = {
        text,
        method: 'direct-input',
        confidence: 0.95
      };
    } else if (result.fileType === 'pdf') {
      // PDF file
      extractionResult = await extractTextFromPDF(buffer, { maxPages: maxOCRPages });
    } else if (result.fileType === 'image') {
      // Image file (phone photo, screenshot, scan)
      extractionResult = await extractTextFromImage(buffer, {
        retryWithAdvancedPreprocess: preprocessImages
      });
    } else if (result.fileType === 'text') {
      // Text file
      extractionResult = {
        text: buffer.toString('utf8'),
        method: 'text-file',
        confidence: 0.95
      };
    } else {
      result.warnings.push(`Unsupported file type: ${result.fileType}`);
      result.processingTimeMs = Date.now() - startTime;
      return result;
    }

    if (!extractionResult || !extractionResult.text) {
      result.warnings.push('Text extraction failed or returned empty');
      // Still set extraction method if we tried something
      if (extractionResult) {
        result.extractionMethod = extractionResult.method || 'attempted';
        result.extractionConfidence = extractionResult.confidence || 0;
      }
      result.processingTimeMs = Date.now() - startTime;
      return result;
    }

    result.extractionMethod = extractionResult.method;
    result.extractionConfidence = extractionResult.confidence;
    result.rawText = includeRawText ? extractionResult.text : '';
    result.rawTextLength = extractionResult.text.length;

    // 4. Parse the extracted text with unified invoice parser
    // CRITICAL: Always use V2 parser for better vendor detection and totals extraction
    console.log(`[UniversalProcessor] Parsing ${result.rawTextLength} chars of text with V2 parser...`);

    const parsed = invoiceParser.parseInvoice(extractionResult.text, { useV2: true, debug: true });

    result.parsed = parsed;
    result.ok = parsed.ok;
    result.items = parsed.items || [];
    result.totals = parsed.totals || null;
    result.vendor = parsed.vendor || null;
    result.customer = parsed.customer || null;
    result.metadata = parsed.metadata || null;
    result.opportunities = parsed.opportunities || [];

    // 5. Calculate combined confidence
    // Weight extraction confidence and parsing confidence
    const extractWeight = 0.3;
    const parseWeight = 0.7;
    result.confidence = {
      overall: (result.extractionConfidence * extractWeight) +
               ((parsed.confidence?.overall || 0) * parseWeight),
      extraction: result.extractionConfidence,
      parsing: parsed.confidence || { overall: 0 }
    };

    // Add validation warnings
    if (parsed.validation && parsed.validation.warnings) {
      result.warnings.push(...parsed.validation.warnings);
    }

    // Add low confidence warning
    if (result.confidence.overall < 0.5) {
      result.warnings.push('Low confidence extraction - manual review recommended');
    }

    result.processingTimeMs = Date.now() - startTime;

    console.log(`[UniversalProcessor] Complete: ${result.items.length} items, confidence: ${(result.confidence.overall * 100).toFixed(1)}%, time: ${result.processingTimeMs}ms`);

    return result;

  } catch (err) {
    console.error('[UniversalProcessor] Error:', err);
    result.warnings.push(`Processing error: ${err.message}`);
    result.processingTimeMs = Date.now() - startTime;
    return result;
  }
}

/**
 * Express middleware for handling invoice uploads
 * Use with multer for file uploads
 */
function createUploadHandler(options = {}) {
  return async (req, res, next) => {
    try {
      const input = {};

      // Check for file upload (multer)
      if (req.file) {
        input.buffer = req.file.buffer || (req.file.path ? fs.readFileSync(req.file.path) : null);
        input.mimeType = req.file.mimetype;
        input.filename = req.file.originalname;
      }
      // Check for base64 in body
      else if (req.body && (req.body.file || req.body.base64 || req.body.data)) {
        input.base64 = req.body.file || req.body.base64 || req.body.data;
        input.mimeType = req.body.mimeType || req.body.contentType;
        input.filename = req.body.filename;
      }
      // Check for raw text
      else if (req.body && req.body.text) {
        input.text = req.body.text;
      }
      // Check for raw_text (legacy format)
      else if (req.body && req.body.raw_text) {
        input.text = req.body.raw_text;
      }

      const result = await processInvoice(input, {
        source: req.body?.source || 'api-upload',
        ...options
      });

      // Attach result to request for downstream handlers
      req.invoiceResult = result;

      // Clean up temp file if exists
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_) {}
      }

      next();

    } catch (err) {
      console.error('[UploadHandler] Error:', err);
      next(err);
    }
  };
}

// ============ EXPORTS ============

module.exports = {
  processInvoice,
  createUploadHandler,
  detectFileType,
  preprocessImageForOCR,
  advancedImagePreprocessing,
  highContrastPreprocessing,
  extractTextFromPDF,
  extractTextFromImage,
  calculateOCRConfidence,
  assessTextQuality,
  cleanExtractedText,
  combineOCRResults
};
