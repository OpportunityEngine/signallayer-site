// =====================================================
// INVOICE IMAGE PIPELINE v2
// Production-grade phone photo → OCR → parsing pipeline
// =====================================================

const imageNormalizer = require('./image-normalizer');
const ocrEngine = require('./ocr-engine');
const invoiceExtractor = require('./invoice-extractor');
const confidenceScorer = require('./confidence-scorer');
const db = require('../../database');

// Feature flag for v2 pipeline
const PIPELINE_V2_ENABLED = process.env.INVOICE_OCR_PIPELINE_V2 !== 'false';

// Failure reason enums
const FAILURE_REASONS = {
  TOO_BLURRY: 'too_blurry',
  GLARE_DETECTED: 'glare_detected',
  DOCUMENT_NOT_DETECTED: 'document_not_detected',
  LOW_RESOLUTION: 'low_resolution',
  NO_TEXT_DETECTED: 'no_supported_text_detected',
  TOTALS_NOT_FOUND: 'totals_not_found',
  LINE_ITEMS_NOT_DETECTED: 'line_items_not_detected',
  PARSING_AMBIGUOUS: 'parsing_ambiguous',
  SKEW_TOO_SEVERE: 'skew_too_severe',
  IMAGE_TOO_DARK: 'image_too_dark',
  IMAGE_TOO_BRIGHT: 'image_too_bright',
  UNSUPPORTED_FORMAT: 'unsupported_format',
  PROCESSING_ERROR: 'processing_error'
};

/**
 * Main orchestrator for invoice image processing
 * @param {Object} params - Processing parameters
 * @param {number} params.userId - User ID for tracking
 * @param {Buffer|string} params.file - Image buffer or base64 string
 * @param {Object} params.metadata - Additional metadata (filename, mimeType, etc.)
 * @returns {Promise<Object>} Structured extraction result
 */
async function processInvoiceImageUpload({ userId, file, metadata = {} }) {
  const startTime = Date.now();
  const pipelineId = `pipe-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

  const result = {
    ok: false,
    pipelineId,
    extracted: {
      vendor: null,
      date: null,
      invoiceNumber: null,
      totals: { subtotal: null, tax: null, total: null },
      address: null,
      lineItems: [],
      currency: 'USD'
    },
    confidence: {
      overallScore: 0,
      ocrAvgConfidence: 0,
      fields: {
        vendor: 0,
        date: 0,
        total: 0,
        lineItems: 0
      }
    },
    quality: {
      blurScore: 0,
      glareScore: 0,
      skewScore: 0,
      brightness: 0,
      contrast: 0,
      resolution: { width: 0, height: 0 },
      docDetected: false
    },
    attempts: [],
    failureReasons: [],
    processingTimeMs: 0,
    normalizedPreviewPaths: null
  };

  try {
    // Convert base64 to buffer if needed
    let imageBuffer = file;
    if (typeof file === 'string') {
      // Remove data URL prefix if present
      const base64Data = file.replace(/^data:image\/\w+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');
    }

    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length < 100) {
      result.failureReasons.push(FAILURE_REASONS.UNSUPPORTED_FORMAT);
      result.processingTimeMs = Date.now() - startTime;
      await logPipelineRun(userId, pipelineId, result, metadata);
      return result;
    }

    console.log(`[PIPELINE] Starting invoice image processing: ${pipelineId}`);
    console.log(`[PIPELINE] Image size: ${imageBuffer.length} bytes, filename: ${metadata.filename || 'unknown'}`);

    // =========================================
    // PHASE 1: Image Normalization + Quality
    // =========================================
    const normalizationStart = Date.now();
    const normalization = await imageNormalizer.normalize(imageBuffer, {
      filename: metadata.filename,
      mimeType: metadata.mimeType
    });

    result.quality = normalization.quality;
    result.normalizedPreviewPaths = normalization.previewPaths;

    const normTime = Date.now() - normalizationStart;
    console.log(`[PIPELINE] Normalization complete in ${normTime}ms, quality score: ${normalization.quality.overallQuality}`);

    // Check for critical quality issues
    if (normalization.quality.blurScore > 0.7) {
      result.failureReasons.push(FAILURE_REASONS.TOO_BLURRY);
    }
    if (normalization.quality.glareScore > 0.6) {
      result.failureReasons.push(FAILURE_REASONS.GLARE_DETECTED);
    }
    if (normalization.quality.brightness < 0.15) {
      result.failureReasons.push(FAILURE_REASONS.IMAGE_TOO_DARK);
    }
    if (normalization.quality.brightness > 0.85) {
      result.failureReasons.push(FAILURE_REASONS.IMAGE_TOO_BRIGHT);
    }
    if (!normalization.quality.docDetected && normalization.quality.skewScore > 0.5) {
      result.failureReasons.push(FAILURE_REASONS.DOCUMENT_NOT_DETECTED);
    }
    if (normalization.quality.resolution.width < 400 || normalization.quality.resolution.height < 400) {
      result.failureReasons.push(FAILURE_REASONS.LOW_RESOLUTION);
    }

    // =========================================
    // PHASE 2: OCR with Multiple Variants
    // =========================================
    const ocrStart = Date.now();
    let bestOcrResult = null;
    let bestOcrScore = 0;

    // Try each normalized variant
    for (const variant of normalization.variants) {
      const ocrResult = await ocrEngine.extractText(variant.buffer, {
        variantName: variant.name,
        pipelineId
      });

      result.attempts.push({
        variantName: variant.name,
        engine: ocrResult.engine,
        ocrConf: ocrResult.confidence,
        score: ocrResult.score,
        notes: ocrResult.notes,
        textLength: ocrResult.text?.length || 0
      });

      if (ocrResult.score > bestOcrScore) {
        bestOcrScore = ocrResult.score;
        bestOcrResult = ocrResult;
      }

      // If we get a very good result, no need to try more variants
      if (ocrResult.score >= 0.85) {
        console.log(`[PIPELINE] High confidence OCR result from variant: ${variant.name}`);
        break;
      }
    }

    const ocrTime = Date.now() - ocrStart;
    console.log(`[PIPELINE] OCR complete in ${ocrTime}ms, best score: ${bestOcrScore}, attempts: ${result.attempts.length}`);

    if (!bestOcrResult || !bestOcrResult.text || bestOcrResult.text.length < 20) {
      result.failureReasons.push(FAILURE_REASONS.NO_TEXT_DETECTED);
      result.confidence.ocrAvgConfidence = bestOcrResult?.confidence || 0;
      result.processingTimeMs = Date.now() - startTime;
      await logPipelineRun(userId, pipelineId, result, metadata);
      return result;
    }

    result.confidence.ocrAvgConfidence = bestOcrResult.confidence;

    // =========================================
    // PHASE 3: Invoice Field Extraction
    // =========================================
    const extractionStart = Date.now();
    const extraction = invoiceExtractor.extract(bestOcrResult.text, {
      ocrBoxes: bestOcrResult.boxes,
      metadata
    });

    const extractionTime = Date.now() - extractionStart;
    console.log(`[PIPELINE] Extraction complete in ${extractionTime}ms`);

    // Populate extracted data
    result.extracted = {
      vendor: extraction.vendor,
      date: extraction.date,
      invoiceNumber: extraction.invoiceNumber,
      totals: extraction.totals,
      address: extraction.address,
      lineItems: extraction.lineItems,
      currency: extraction.currency || 'USD'
    };

    // Check for extraction issues
    if (!extraction.totals?.total && !extraction.totals?.subtotal) {
      result.failureReasons.push(FAILURE_REASONS.TOTALS_NOT_FOUND);
    }
    if (!extraction.lineItems || extraction.lineItems.length === 0) {
      result.failureReasons.push(FAILURE_REASONS.LINE_ITEMS_NOT_DETECTED);
    }
    if (extraction.ambiguous) {
      result.failureReasons.push(FAILURE_REASONS.PARSING_AMBIGUOUS);
    }

    // =========================================
    // PHASE 4: Confidence Scoring
    // =========================================
    const scoring = confidenceScorer.calculateScore({
      ocrConfidence: bestOcrResult.confidence,
      quality: normalization.quality,
      extraction,
      attempts: result.attempts
    });

    result.confidence = scoring;
    result.ok = scoring.overallScore >= 0.4; // Minimum threshold for "success"

    // =========================================
    // PHASE 5: Finalize
    // =========================================
    result.processingTimeMs = Date.now() - startTime;

    console.log(`[PIPELINE] Processing complete in ${result.processingTimeMs}ms`);
    console.log(`[PIPELINE] Overall confidence: ${scoring.overallScore}, OK: ${result.ok}`);
    console.log(`[PIPELINE] Failure reasons: ${result.failureReasons.join(', ') || 'none'}`);

    // Log to database for observability
    await logPipelineRun(userId, pipelineId, result, metadata);

    return result;

  } catch (error) {
    console.error(`[PIPELINE] Error processing image:`, error);
    result.failureReasons.push(FAILURE_REASONS.PROCESSING_ERROR);
    result.processingTimeMs = Date.now() - startTime;

    try {
      await logPipelineRun(userId, pipelineId, result, metadata, error.message);
    } catch (logErr) {
      console.error(`[PIPELINE] Failed to log error:`, logErr);
    }

    return result;
  }
}

/**
 * Log pipeline run to database for observability
 */
async function logPipelineRun(userId, pipelineId, result, metadata, errorMessage = null) {
  try {
    const database = db.getDatabase();

    // Check if table exists, create if not
    database.exec(`
      CREATE TABLE IF NOT EXISTS invoice_pipeline_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pipeline_id TEXT UNIQUE NOT NULL,
        user_id INTEGER,
        filename TEXT,
        file_type TEXT,
        file_size INTEGER,

        -- Quality metrics
        blur_score REAL,
        glare_score REAL,
        skew_score REAL,
        brightness REAL,
        contrast REAL,
        resolution_width INTEGER,
        resolution_height INTEGER,
        doc_detected INTEGER,

        -- OCR metrics
        ocr_avg_confidence REAL,
        attempts_count INTEGER,
        best_variant TEXT,
        best_engine TEXT,

        -- Extraction results
        vendor_extracted TEXT,
        date_extracted TEXT,
        total_extracted INTEGER,
        line_items_count INTEGER,

        -- Confidence scores
        overall_score REAL,
        vendor_confidence REAL,
        date_confidence REAL,
        total_confidence REAL,
        line_items_confidence REAL,

        -- Status
        ok INTEGER,
        failure_reasons TEXT,
        error_message TEXT,
        processing_time_ms INTEGER,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const bestAttempt = result.attempts.reduce((best, curr) =>
      (!best || curr.score > best.score) ? curr : best, null);

    database.prepare(`
      INSERT INTO invoice_pipeline_runs (
        pipeline_id, user_id, filename, file_type, file_size,
        blur_score, glare_score, skew_score, brightness, contrast,
        resolution_width, resolution_height, doc_detected,
        ocr_avg_confidence, attempts_count, best_variant, best_engine,
        vendor_extracted, date_extracted, total_extracted, line_items_count,
        overall_score, vendor_confidence, date_confidence, total_confidence, line_items_confidence,
        ok, failure_reasons, error_message, processing_time_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pipelineId,
      userId || null,
      metadata.filename || null,
      metadata.mimeType || null,
      metadata.fileSize || null,
      result.quality?.blurScore || null,
      result.quality?.glareScore || null,
      result.quality?.skewScore || null,
      result.quality?.brightness || null,
      result.quality?.contrast || null,
      result.quality?.resolution?.width || null,
      result.quality?.resolution?.height || null,
      result.quality?.docDetected ? 1 : 0,
      result.confidence?.ocrAvgConfidence || null,
      result.attempts?.length || 0,
      bestAttempt?.variantName || null,
      bestAttempt?.engine || null,
      result.extracted?.vendor || null,
      result.extracted?.date || null,
      result.extracted?.totals?.total || null,
      result.extracted?.lineItems?.length || 0,
      result.confidence?.overallScore || 0,
      result.confidence?.fields?.vendor || 0,
      result.confidence?.fields?.date || 0,
      result.confidence?.fields?.total || 0,
      result.confidence?.fields?.lineItems || 0,
      result.ok ? 1 : 0,
      result.failureReasons?.join(',') || null,
      errorMessage,
      result.processingTimeMs || 0
    );

    console.log(`[PIPELINE] Logged run ${pipelineId} to database`);
  } catch (err) {
    console.error(`[PIPELINE] Failed to log pipeline run:`, err.message);
  }
}

/**
 * Get pipeline runs for admin dashboard
 */
async function getPipelineRuns(options = {}) {
  try {
    const database = db.getDatabase();
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    const runs = database.prepare(`
      SELECT * FROM invoice_pipeline_runs
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    return runs;
  } catch (err) {
    console.error(`[PIPELINE] Failed to get pipeline runs:`, err.message);
    return [];
  }
}

/**
 * Get pipeline run by ID
 */
async function getPipelineRunById(pipelineId) {
  try {
    const database = db.getDatabase();
    return database.prepare(`
      SELECT * FROM invoice_pipeline_runs WHERE pipeline_id = ?
    `).get(pipelineId);
  } catch (err) {
    console.error(`[PIPELINE] Failed to get pipeline run:`, err.message);
    return null;
  }
}

module.exports = {
  processInvoiceImageUpload,
  getPipelineRuns,
  getPipelineRunById,
  FAILURE_REASONS,
  PIPELINE_V2_ENABLED
};
