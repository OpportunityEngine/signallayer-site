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
 * Handles both digital and scanned PDFs
 */
async function extractTextFromPDF(pdfBuffer, options = {}) {
  const { useOCRFallback = true, maxPages = 10 } = options;
  const pdfParseLib = getPdfParse();

  if (!pdfParseLib) {
    throw new Error('pdf-parse not available');
  }

  try {
    // Try standard text extraction first
    const pdfData = await Promise.race([
      pdfParseLib(pdfBuffer),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('PDF parsing timeout')), 30000)
      )
    ]);

    const text = (pdfData.text || '').trim();
    const pageCount = pdfData.numpages || 1;

    console.log(`[PDFExtract] Extracted ${text.length} chars from ${pageCount} pages`);

    // Check if text extraction was successful (not a scanned PDF)
    if (text.length > 100) {
      return {
        text,
        method: 'pdf-parse',
        pageCount,
        confidence: 0.9
      };
    }

    // Scanned PDF - try OCR
    if (useOCRFallback) {
      console.log('[PDFExtract] Low text content, attempting OCR...');
      const ocrMod = getOcrModule();

      if (ocrMod && typeof ocrMod.ocrPdfBufferToText === 'function') {
        const ocrText = ocrMod.ocrPdfBufferToText(pdfBuffer, { maxPages });
        if (ocrText && ocrText.length > text.length) {
          return {
            text: ocrText,
            method: 'ocr',
            pageCount,
            confidence: 0.7
          };
        }
      }
    }

    return {
      text,
      method: 'pdf-parse',
      pageCount,
      confidence: text.length > 50 ? 0.5 : 0.2
    };

  } catch (err) {
    console.error('[PDFExtract] Error:', err.message);
    throw err;
  }
}

/**
 * Extract text from image using Tesseract OCR
 */
async function extractTextFromImage(imageBuffer, options = {}) {
  const { retryWithAdvancedPreprocess = true } = options;
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

  // Preprocess image for better OCR
  console.log('[ImageOCR] Preprocessing image...');
  const preprocessedBuffer = await preprocessImageForOCR(imageBuffer);

  // Create temp directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-ocr-'));
  const inputPath = path.join(tmpDir, 'input.png');
  const outputBase = path.join(tmpDir, 'output');

  try {
    // Write preprocessed image
    fs.writeFileSync(inputPath, preprocessedBuffer);

    // Run Tesseract with optimized settings for invoices
    // PSM 6 = Assume uniform block of text (good for invoices)
    // OEM 3 = Default, uses LSTM if available
    const result = spawnSync(tesseractPath, [
      inputPath,
      outputBase,
      '-l', 'eng',
      '--psm', '6',
      '--oem', '3',
      '-c', 'preserve_interword_spaces=1'
    ], { encoding: 'utf8', timeout: 60000 });

    if (result.status !== 0) {
      console.error('[ImageOCR] Tesseract error:', result.stderr);
    }

    const outputPath = `${outputBase}.txt`;
    let text = '';

    if (fs.existsSync(outputPath)) {
      text = fs.readFileSync(outputPath, 'utf8').trim();
    }

    console.log(`[ImageOCR] First pass extracted ${text.length} chars`);

    // Calculate confidence based on text quality
    let confidence = calculateOCRConfidence(text);

    // If low confidence and retry enabled, try advanced preprocessing
    if (confidence < 0.5 && retryWithAdvancedPreprocess) {
      console.log('[ImageOCR] Low confidence, retrying with advanced preprocessing...');

      const advancedBuffer = await advancedImagePreprocessing(imageBuffer);
      fs.writeFileSync(inputPath, advancedBuffer);

      const retryResult = spawnSync(tesseractPath, [
        inputPath,
        outputBase,
        '-l', 'eng',
        '--psm', '4', // Assume single column (good for receipts)
        '--oem', '3'
      ], { encoding: 'utf8', timeout: 60000 });

      if (fs.existsSync(outputPath)) {
        const retryText = fs.readFileSync(outputPath, 'utf8').trim();
        const retryConfidence = calculateOCRConfidence(retryText);

        if (retryConfidence > confidence) {
          console.log(`[ImageOCR] Advanced preprocessing improved: ${confidence.toFixed(2)} -> ${retryConfidence.toFixed(2)}`);
          text = retryText;
          confidence = retryConfidence;
        }
      }
    }

    return {
      text,
      method: 'tesseract-ocr',
      confidence
    };

  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
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

    console.log(`[UniversalProcessor] File type: ${result.fileType}, size: ${buffer ? buffer.length : 'N/A'}`);

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
      result.processingTimeMs = Date.now() - startTime;
      return result;
    }

    result.extractionMethod = extractionResult.method;
    result.extractionConfidence = extractionResult.confidence;
    result.rawText = includeRawText ? extractionResult.text : '';
    result.rawTextLength = extractionResult.text.length;

    // 4. Parse the extracted text with unified invoice parser
    console.log(`[UniversalProcessor] Parsing ${result.rawTextLength} chars of text...`);

    const parsed = invoiceParser.parseInvoice(extractionResult.text);

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
  extractTextFromPDF,
  extractTextFromImage,
  calculateOCRConfidence
};
