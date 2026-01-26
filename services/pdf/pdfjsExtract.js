/**
 * PDF.js Text Extraction - Position-Aware
 *
 * Uses pdfjs-dist to extract text with position information,
 * which captures margins/footers/headers better than pdf-parse.
 *
 * Key advantages:
 * - Preserves layout by grouping text by Y coordinate
 * - Captures text in margins that pdf-parse misses
 * - Includes page separators for multi-page invoices
 */

const path = require('path');

// pdfjs-dist requires special setup for Node.js
let pdfjsLib = null;

async function initPdfJs() {
  if (pdfjsLib) return pdfjsLib;

  try {
    // Try multiple import paths for compatibility
    let pdfjs = null;

    // Option 1: Try the legacy build with CommonJS wrapper
    try {
      pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
    } catch (e1) {
      // Option 2: Try ES module import
      try {
        pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      } catch (e2) {
        // Option 3: Try default build
        try {
          pdfjs = require('pdfjs-dist');
        } catch (e3) {
          throw new Error(`Could not load pdfjs-dist: ${e1.message}`);
        }
      }
    }

    pdfjsLib = pdfjs;

    // Disable worker for Node.js environment - set to empty string or false
    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    }

    return pdfjsLib;
  } catch (err) {
    console.error('[PDFJS] Failed to load pdfjs-dist:', err.message);
    throw err;
  }
}

/**
 * Extract text from PDF buffer using PDF.js with position awareness
 * Groups text items by approximate Y coordinate to preserve layout
 *
 * @param {Buffer} pdfBuffer - PDF file as buffer
 * @returns {Promise<{text: string, pageCount: number, pageTexts: string[]}>}
 */
async function extractTextPdfJs(pdfBuffer) {
  const pdfjs = await initPdfJs();

  // Convert buffer to Uint8Array
  const data = new Uint8Array(pdfBuffer);

  try {
    const loadingTask = pdfjs.getDocument({
      data,
      useSystemFonts: true,
      verbosity: 0,  // Suppress warnings
      disableWorker: true,  // Disable worker for Node.js
      isEvalSupported: false  // Disable eval for security
    });

    const doc = await loadingTask.promise;
    const pageCount = doc.numPages;
    const pageTexts = [];
    const allLines = [];

    console.log(`[PDFJS] Processing ${pageCount} pages`);

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await doc.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Group text items by approximate Y coordinate (line buckets)
      const lineBuckets = {};
      const Y_TOLERANCE = 5; // pixels tolerance for same line

      for (const item of textContent.items) {
        if (!item.str || item.str.trim() === '') continue;

        // Get Y position from transform matrix [a, b, c, d, e, f]
        // e = x position, f = y position
        const y = Math.round(item.transform[5] / Y_TOLERANCE) * Y_TOLERANCE;
        const x = item.transform[4];

        if (!lineBuckets[y]) {
          lineBuckets[y] = [];
        }

        lineBuckets[y].push({
          x,
          text: item.str
        });
      }

      // Sort lines by Y (top to bottom - higher Y first in PDF coordinates)
      const sortedYs = Object.keys(lineBuckets)
        .map(Number)
        .sort((a, b) => b - a);

      const pageLines = [];

      for (const y of sortedYs) {
        // Sort items within line by X (left to right)
        const lineItems = lineBuckets[y].sort((a, b) => a.x - b.x);

        // Join with appropriate spacing
        let lineText = '';
        let lastX = -Infinity;

        for (const item of lineItems) {
          // Add space if there's a gap between items
          const gap = item.x - lastX;
          if (gap > 20 && lineText.length > 0) {
            lineText += '  ';  // Multiple spaces for larger gaps
          } else if (gap > 5 && lineText.length > 0) {
            lineText += ' ';
          }

          lineText += item.text;
          lastX = item.x + (item.text.length * 6); // Approximate char width
        }

        if (lineText.trim()) {
          pageLines.push(lineText);
        }
      }

      // Add page separator for multi-page documents
      if (pageNum > 1) {
        allLines.push(`\n=== PAGE ${pageNum} ===\n`);
      }

      const pageText = pageLines.join('\n');
      pageTexts.push(pageText);
      allLines.push(pageText);
    }

    const fullText = allLines.join('\n');

    console.log(`[PDFJS] Extracted ${fullText.length} chars from ${pageCount} pages`);

    return {
      text: fullText,
      pageCount,
      pageTexts
    };

  } catch (err) {
    console.error('[PDFJS] Extraction error:', err.message);
    throw err;
  }
}

/**
 * Extract text from just the last page (where totals typically are)
 *
 * @param {Buffer} pdfBuffer - PDF file as buffer
 * @returns {Promise<{text: string, pageNum: number}>}
 */
async function extractLastPagePdfJs(pdfBuffer) {
  const pdfjs = await initPdfJs();
  const data = new Uint8Array(pdfBuffer);

  try {
    const loadingTask = pdfjs.getDocument({
      data,
      useSystemFonts: true,
      verbosity: 0,
      disableWorker: true,
      isEvalSupported: false
    });

    const doc = await loadingTask.promise;
    const pageCount = doc.numPages;
    const lastPage = await doc.getPage(pageCount);
    const textContent = await lastPage.getTextContent();

    // Build text preserving layout
    const lineBuckets = {};
    const Y_TOLERANCE = 5;

    for (const item of textContent.items) {
      if (!item.str || item.str.trim() === '') continue;

      const y = Math.round(item.transform[5] / Y_TOLERANCE) * Y_TOLERANCE;
      const x = item.transform[4];

      if (!lineBuckets[y]) {
        lineBuckets[y] = [];
      }

      lineBuckets[y].push({ x, text: item.str });
    }

    const sortedYs = Object.keys(lineBuckets)
      .map(Number)
      .sort((a, b) => b - a);

    const lines = [];

    for (const y of sortedYs) {
      const lineItems = lineBuckets[y].sort((a, b) => a.x - b.x);
      let lineText = '';
      let lastX = -Infinity;

      for (const item of lineItems) {
        const gap = item.x - lastX;
        if (gap > 20 && lineText.length > 0) {
          lineText += '  ';
        } else if (gap > 5 && lineText.length > 0) {
          lineText += ' ';
        }
        lineText += item.text;
        lastX = item.x + (item.text.length * 6);
      }

      if (lineText.trim()) {
        lines.push(lineText);
      }
    }

    return {
      text: lines.join('\n'),
      pageNum: pageCount
    };

  } catch (err) {
    console.error('[PDFJS] Last page extraction error:', err.message);
    throw err;
  }
}

module.exports = {
  extractTextPdfJs,
  extractLastPagePdfJs,
  initPdfJs
};
