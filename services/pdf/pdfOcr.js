/**
 * PDF OCR Fallback - Render + Tesseract
 *
 * Uses poppler (pdftoppm) to render PDF pages to images,
 * then runs Tesseract OCR to extract text.
 *
 * This captures text that pdf-parse and pdfjs miss,
 * especially in margins, footers, and scanned invoices.
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Check if poppler-utils and tesseract are available
let POPPLER_AVAILABLE = false;
let TESSERACT_AVAILABLE = false;

try {
  execSync('which pdftoppm', { stdio: 'pipe' });
  POPPLER_AVAILABLE = true;
} catch (e) {
  console.warn('[PDF-OCR] pdftoppm not found - install poppler-utils: apt-get install poppler-utils');
}

try {
  execSync('which tesseract', { stdio: 'pipe' });
  TESSERACT_AVAILABLE = true;
} catch (e) {
  console.warn('[PDF-OCR] tesseract not found - install tesseract-ocr: apt-get install tesseract-ocr');
}

/**
 * Create a temp directory for OCR operations
 */
function createTempDir() {
  const tmpDir = path.join(os.tmpdir(), `pdf-ocr-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

/**
 * Clean up temp directory
 */
function cleanupTempDir(tmpDir) {
  try {
    if (fs.existsSync(tmpDir)) {
      const files = fs.readdirSync(tmpDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
      fs.rmdirSync(tmpDir);
    }
  } catch (e) {
    console.warn('[PDF-OCR] Cleanup warning:', e.message);
  }
}

/**
 * Get the number of pages in a PDF
 */
function getPdfPageCount(pdfPath) {
  try {
    const output = execSync(`pdfinfo "${pdfPath}" 2>/dev/null | grep "Pages:" | awk '{print $2}'`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return parseInt(output.trim(), 10) || 1;
  } catch (e) {
    // Fallback: try with pdfjs
    return 1;
  }
}

/**
 * Render a specific page of PDF to PNG using pdftoppm
 *
 * @param {string} pdfPath - Path to PDF file
 * @param {number} pageNum - Page number (1-based)
 * @param {string} outputPrefix - Output file prefix
 * @param {number} dpi - Resolution (default 300)
 * @returns {string} - Path to generated PNG
 */
function renderPageToPng(pdfPath, pageNum, outputPrefix, dpi = 300) {
  if (!POPPLER_AVAILABLE) {
    throw new Error('pdftoppm not available');
  }

  const cmd = `pdftoppm -f ${pageNum} -l ${pageNum} -png -r ${dpi} "${pdfPath}" "${outputPrefix}"`;

  try {
    execSync(cmd, { stdio: 'pipe', timeout: 30000 });

    // pdftoppm creates files like prefix-01.png
    const expectedFile = `${outputPrefix}-${String(pageNum).padStart(pageNum > 9 ? 2 : 1, '0')}.png`;
    const altFile = `${outputPrefix}-${pageNum}.png`;

    if (fs.existsSync(expectedFile)) {
      return expectedFile;
    } else if (fs.existsSync(altFile)) {
      return altFile;
    }

    // Check for any PNG files with the prefix
    const dir = path.dirname(outputPrefix);
    const prefix = path.basename(outputPrefix);
    const files = fs.readdirSync(dir).filter(f => f.startsWith(prefix) && f.endsWith('.png'));

    if (files.length > 0) {
      return path.join(dir, files[0]);
    }

    throw new Error(`PNG not created: expected ${expectedFile}`);

  } catch (e) {
    console.error('[PDF-OCR] pdftoppm failed:', e.message);
    throw e;
  }
}

/**
 * Run Tesseract OCR on an image
 *
 * @param {string} imagePath - Path to image file
 * @returns {string} - Extracted text
 */
function runTesseract(imagePath) {
  if (!TESSERACT_AVAILABLE) {
    throw new Error('tesseract not available');
  }

  try {
    // Use stdout for output to avoid temp files
    const cmd = `tesseract "${imagePath}" stdout -l eng --psm 6 2>/dev/null`;
    const output = execSync(cmd, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,  // 10MB buffer
      timeout: 60000  // 60 second timeout
    });

    return output;

  } catch (e) {
    console.error('[PDF-OCR] tesseract failed:', e.message);
    throw e;
  }
}

/**
 * OCR a specific page of a PDF
 *
 * @param {Buffer} pdfBuffer - PDF file as buffer
 * @param {number} pageNum - Page number (1-based)
 * @returns {Promise<string>} - OCR text
 */
async function ocrPage(pdfBuffer, pageNum) {
  if (!POPPLER_AVAILABLE || !TESSERACT_AVAILABLE) {
    console.warn('[PDF-OCR] OCR tools not available');
    return '';
  }

  const tmpDir = createTempDir();
  const pdfPath = path.join(tmpDir, 'input.pdf');
  const imgPrefix = path.join(tmpDir, 'page');

  try {
    // Write PDF to temp file
    fs.writeFileSync(pdfPath, pdfBuffer);

    // Render page to PNG
    const pngPath = renderPageToPng(pdfPath, pageNum, imgPrefix);

    // Run OCR
    const text = runTesseract(pngPath);

    console.log(`[PDF-OCR] Page ${pageNum}: extracted ${text.length} chars`);

    return text;

  } finally {
    cleanupTempDir(tmpDir);
  }
}

/**
 * OCR the last page of a PDF (where totals usually are)
 *
 * @param {Buffer} pdfBuffer - PDF file as buffer
 * @returns {Promise<{text: string, pageNum: number}>}
 */
async function ocrLastPage(pdfBuffer) {
  if (!POPPLER_AVAILABLE || !TESSERACT_AVAILABLE) {
    console.warn('[PDF-OCR] OCR tools not available');
    return { text: '', pageNum: 0 };
  }

  const tmpDir = createTempDir();
  const pdfPath = path.join(tmpDir, 'input.pdf');
  const imgPrefix = path.join(tmpDir, 'page');

  try {
    // Write PDF to temp file
    fs.writeFileSync(pdfPath, pdfBuffer);

    // Get page count
    const pageCount = getPdfPageCount(pdfPath);

    // Render last page to PNG
    const pngPath = renderPageToPng(pdfPath, pageCount, imgPrefix);

    // Run OCR
    const text = runTesseract(pngPath);

    console.log(`[PDF-OCR] Last page (${pageCount}): extracted ${text.length} chars`);

    return {
      text: `\n=== OCR LAST PAGE (${pageCount}) ===\n${text}`,
      pageNum: pageCount
    };

  } finally {
    cleanupTempDir(tmpDir);
  }
}

/**
 * OCR all pages of a PDF
 *
 * @param {Buffer} pdfBuffer - PDF file as buffer
 * @param {number} maxPages - Maximum pages to OCR (default 10)
 * @returns {Promise<{text: string, pageCount: number}>}
 */
async function ocrAllPages(pdfBuffer, maxPages = 10) {
  if (!POPPLER_AVAILABLE || !TESSERACT_AVAILABLE) {
    console.warn('[PDF-OCR] OCR tools not available');
    return { text: '', pageCount: 0 };
  }

  const tmpDir = createTempDir();
  const pdfPath = path.join(tmpDir, 'input.pdf');
  const imgPrefix = path.join(tmpDir, 'page');

  try {
    // Write PDF to temp file
    fs.writeFileSync(pdfPath, pdfBuffer);

    // Get page count
    const pageCount = getPdfPageCount(pdfPath);
    const pagesToProcess = Math.min(pageCount, maxPages);

    const allText = [];
    allText.push(`\n=== OCR ALL PAGES (${pagesToProcess} of ${pageCount}) ===\n`);

    for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
      try {
        const pngPath = renderPageToPng(pdfPath, pageNum, `${imgPrefix}-${pageNum}`);
        const pageText = runTesseract(pngPath);

        if (pageNum > 1) {
          allText.push(`\n--- OCR PAGE ${pageNum} ---\n`);
        }
        allText.push(pageText);

        console.log(`[PDF-OCR] Page ${pageNum}/${pagesToProcess}: ${pageText.length} chars`);

      } catch (pageErr) {
        console.warn(`[PDF-OCR] Failed page ${pageNum}:`, pageErr.message);
        allText.push(`\n--- OCR PAGE ${pageNum} FAILED ---\n`);
      }
    }

    return {
      text: allText.join('\n'),
      pageCount: pagesToProcess
    };

  } finally {
    cleanupTempDir(tmpDir);
  }
}

/**
 * Check if OCR tools are available
 */
function isOcrAvailable() {
  return POPPLER_AVAILABLE && TESSERACT_AVAILABLE;
}

module.exports = {
  ocrPage,
  ocrLastPage,
  ocrAllPages,
  isOcrAvailable,
  POPPLER_AVAILABLE,
  TESSERACT_AVAILABLE
};
