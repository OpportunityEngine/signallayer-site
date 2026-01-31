/**
 * Mobile Photo Ingest Routes
 *
 * Dedicated API endpoint for mobile phone photo uploads with:
 * - Optimized preprocessing for phone camera photos
 * - ROI OCR fallback for missed footer/totals
 * - Parse tracing for debugging
 * - Feature flags and upload limits
 *
 * Route: POST /api/ingest/photo
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// Feature flags
const MOBILE_PHOTO_ENABLED = process.env.ENABLE_MOBILE_PHOTO_UPLOAD !== 'false';
const MAX_FILE_SIZE_MB = parseInt(process.env.MOBILE_PHOTO_MAX_SIZE_MB || '20', 10);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Lazy-load dependencies
let universalProcessor = null;
let invoiceImagePipeline = null;
let roiOcrFallback = null;
let parseTracer = null;
let db = null;

function getUniversalProcessor() {
  if (!universalProcessor) {
    try {
      universalProcessor = require('./universal-invoice-processor');
    } catch (e) {
      console.error('[MOBILE_PHOTO] Failed to load universal processor:', e.message);
    }
  }
  return universalProcessor;
}

function getInvoiceImagePipeline() {
  if (!invoiceImagePipeline) {
    try {
      invoiceImagePipeline = require('./services/invoice_image_pipeline');
    } catch (e) {
      console.error('[MOBILE_PHOTO] Failed to load image pipeline:', e.message);
    }
  }
  return invoiceImagePipeline;
}

function getRoiOcrFallback() {
  if (!roiOcrFallback) {
    try {
      roiOcrFallback = require('./services/invoice_parsing_v2/roiOcrFallback');
    } catch (e) {
      console.error('[MOBILE_PHOTO] Failed to load ROI OCR fallback:', e.message);
    }
  }
  return roiOcrFallback;
}

function getParseTracer() {
  if (!parseTracer) {
    try {
      parseTracer = require('./services/invoice_parsing_v2/parseTracer');
    } catch (e) {
      console.error('[MOBILE_PHOTO] Failed to load parse tracer:', e.message);
    }
  }
  return parseTracer;
}

function getDb() {
  if (!db) {
    try {
      db = require('./database');
    } catch (e) {
      console.error('[MOBILE_PHOTO] Failed to load database:', e.message);
    }
  }
  return db;
}

// Configure multer for in-memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES
  },
  fileFilter: (req, file, cb) => {
    // Accept only image formats
    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif'
    ];

    if (allowedMimes.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: JPEG, PNG, WebP, HEIC`), false);
    }
  }
});

/**
 * Generate a unique run ID for this upload
 */
function generateRunId() {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).substring(2, 8);
  return `mobile-${ts}-${rand}`;
}

/**
 * POST /api/ingest/photo
 *
 * Mobile-optimized photo upload endpoint.
 * Accepts multipart/form-data with image file.
 *
 * Request body (multipart):
 *   - file: Image file (required)
 *   - vendor: Optional vendor hint for parsing
 *   - source: Optional source identifier (default: 'mobile_camera')
 *
 * Response:
 * {
 *   ok: boolean,
 *   runId: string,
 *   extracted: {
 *     vendor: string,
 *     invoiceNumber: string,
 *     date: string,
 *     totals: { subtotal, tax, total },
 *     lineItems: [...],
 *     currency: string
 *   },
 *   confidence: {
 *     overall: number,
 *     ocr: number,
 *     parsing: number
 *   },
 *   quality: {
 *     blurScore: number,
 *     brightness: number,
 *     resolution: { width, height }
 *   },
 *   warnings: string[],
 *   processingTimeMs: number,
 *   traceId: string
 * }
 */
router.post('/photo', upload.single('file'), async (req, res) => {
  const startTime = Date.now();
  const runId = generateRunId();

  // Check feature flag
  if (!MOBILE_PHOTO_ENABLED) {
    return res.status(503).json({
      ok: false,
      error: 'Mobile photo upload is currently disabled',
      code: 'FEATURE_DISABLED'
    });
  }

  // Initialize tracer
  const tracer = getParseTracer();
  const trace = tracer ? tracer.createTrace(runId, {
    userId: req.user?.id,
    source: 'mobile_photo_upload',
    filename: req.file?.originalname
  }) : null;

  const result = {
    ok: false,
    runId,
    extracted: null,
    confidence: { overall: 0, ocr: 0, parsing: 0 },
    quality: null,
    warnings: [],
    processingTimeMs: 0,
    traceId: runId
  };

  try {
    // Validate file upload
    if (!req.file) {
      result.warnings.push('No file uploaded');
      trace?.warn('No file in request');
      return res.status(400).json({
        ok: false,
        error: 'No image file provided',
        code: 'NO_FILE'
      });
    }

    const imageBuffer = req.file.buffer;
    const filename = req.file.originalname || 'photo.jpg';
    const mimeType = req.file.mimetype;

    console.log(`[MOBILE_PHOTO] Processing upload: ${filename}, size: ${imageBuffer.length} bytes, mime: ${mimeType}`);

    trace?.step('INPUT_RECEIVED', {
      filename,
      mimeType,
      fileSize: imageBuffer.length,
      userId: req.user?.id
    });

    // Get user ID from auth
    const userId = req.user?.id || null;

    // Optional vendor hint
    const vendorHint = req.body?.vendor || null;
    const source = req.body?.source || 'mobile_camera';

    // =========================================================
    // PHASE 1: Try v2 Image Pipeline (if enabled)
    // =========================================================
    const pipeline = getInvoiceImagePipeline();
    let pipelineResult = null;
    let usedPipeline = false;

    if (pipeline && pipeline.PIPELINE_V2_ENABLED) {
      trace?.step('OCR_START', { method: 'pipeline_v2' });

      try {
        console.log('[MOBILE_PHOTO] Using v2 image pipeline...');

        pipelineResult = await pipeline.processInvoiceImageUpload({
          userId,
          file: imageBuffer,
          metadata: {
            filename,
            mimeType,
            fileSize: imageBuffer.length,
            vendorHint,
            source
          }
        });

        trace?.step('OCR_COMPLETE', {
          method: 'pipeline_v2',
          confidence: pipelineResult.confidence?.overallScore,
          ok: pipelineResult.ok,
          failureReasons: pipelineResult.failureReasons
        });

        // Check if pipeline result is usable
        if (pipelineResult.ok || pipelineResult.confidence?.overallScore >= 0.35) {
          usedPipeline = true;

          result.ok = pipelineResult.ok;
          result.extracted = {
            vendor: pipelineResult.extracted?.vendor,
            invoiceNumber: pipelineResult.extracted?.invoiceNumber,
            date: pipelineResult.extracted?.date,
            totals: pipelineResult.extracted?.totals,
            lineItems: pipelineResult.extracted?.lineItems || [],
            currency: pipelineResult.extracted?.currency || 'USD'
          };
          result.confidence = {
            overall: pipelineResult.confidence?.overallScore || 0,
            ocr: pipelineResult.confidence?.ocrAvgConfidence || 0,
            parsing: pipelineResult.confidence?.fields?.lineItems || 0
          };
          result.quality = pipelineResult.quality;

          if (pipelineResult.failureReasons?.length > 0) {
            result.warnings.push(...pipelineResult.failureReasons);
          }
        } else {
          console.log(`[MOBILE_PHOTO] Pipeline low confidence (${(pipelineResult.confidence?.overallScore * 100).toFixed(1)}%), trying fallback`);
          trace?.step('VENDOR_FALLBACK', {
            reason: 'pipeline_low_confidence',
            pipelineScore: pipelineResult.confidence?.overallScore
          });
        }

      } catch (pipelineErr) {
        console.error('[MOBILE_PHOTO] Pipeline error:', pipelineErr.message);
        trace?.error('Pipeline failed', pipelineErr);
        result.warnings.push(`Pipeline error: ${pipelineErr.message}`);
      }
    }

    // =========================================================
    // PHASE 2: Fallback to Universal Processor
    // =========================================================
    if (!usedPipeline) {
      const processor = getUniversalProcessor();
      if (!processor) {
        throw new Error('No invoice processor available');
      }

      trace?.step('OCR_START', { method: 'universal_processor' });

      console.log('[MOBILE_PHOTO] Using universal processor fallback...');

      const processorResult = await processor.processInvoice(
        {
          buffer: imageBuffer,
          mimeType,
          filename
        },
        {
          source,
          includeRawText: false,
          preprocessImages: true
        }
      );

      trace?.step('OCR_COMPLETE', {
        method: 'universal_processor',
        confidence: processorResult.confidence?.overall,
        ok: processorResult.ok,
        itemCount: processorResult.items?.length
      });

      result.ok = processorResult.ok;
      result.extracted = {
        vendor: processorResult.vendorName || processorResult.vendor?.name,
        invoiceNumber: processorResult.metadata?.invoiceNumber,
        date: processorResult.metadata?.invoiceDate,
        totals: processorResult.totals,
        lineItems: processorResult.items?.map(item => ({
          description: item.description,
          quantity: item.quantity,
          unitCents: item.unitPriceCents,
          totalCents: item.totalCents,
          sku: item.sku
        })) || [],
        currency: processorResult.metadata?.currency || 'USD'
      };
      result.confidence = {
        overall: processorResult.confidence?.overall || 0,
        ocr: processorResult.extractionConfidence || 0,
        parsing: processorResult.confidence?.parsing?.overall || 0
      };

      if (processorResult.warnings?.length > 0) {
        result.warnings.push(...processorResult.warnings);
      }
    }

    // =========================================================
    // PHASE 3: ROI OCR Fallback for Missing Totals
    // =========================================================
    const hasTotals = result.extracted?.totals?.total ||
                      result.extracted?.totals?.invoiceTotal ||
                      result.extracted?.totals?.amountDue;

    if (!hasTotals && result.confidence.overall < 0.6) {
      const roiFallback = getRoiOcrFallback();

      if (roiFallback && roiFallback.isAvailable()) {
        console.log('[MOBILE_PHOTO] Trying ROI OCR fallback for totals...');
        trace?.step('ROI_FALLBACK_START', { reason: 'missing_totals' });

        try {
          const roiResult = await roiFallback.extractMissingTotals(imageBuffer, {
            currentTotals: result.extracted?.totals || {},
            tracer: trace
          });

          if (roiResult.success && roiResult.bestTotal) {
            console.log(`[MOBILE_PHOTO] ROI found total: $${roiResult.bestTotal} from ${roiResult.bestTotalSource}`);

            // Merge ROI totals into result
            if (!result.extracted.totals) {
              result.extracted.totals = {};
            }

            Object.assign(result.extracted.totals, roiResult.extractedTotals);

            // Update confidence based on ROI success
            result.confidence.overall = Math.min(0.95,
              result.confidence.overall + (roiResult.bestTotalConfidence * 0.2)
            );

            result.ok = true;
            result.warnings.push(`Totals recovered via ROI fallback from ${roiResult.bestTotalSource}`);
          }

          trace?.step('ROI_FALLBACK_COMPLETE', {
            success: roiResult.success,
            bestTotal: roiResult.bestTotal,
            regionsChecked: roiResult.regionsChecked?.length
          });

        } catch (roiErr) {
          console.error('[MOBILE_PHOTO] ROI fallback error:', roiErr.message);
          trace?.error('ROI fallback failed', roiErr);
        }
      }
    }

    // =========================================================
    // PHASE 4: Finalize and Save
    // =========================================================
    result.processingTimeMs = Date.now() - startTime;

    // Complete trace
    const traceResult = trace?.complete({
      ok: result.ok,
      confidence: result.confidence.overall,
      hasItems: result.extracted?.lineItems?.length > 0,
      hasTotals: !!(result.extracted?.totals?.total || result.extracted?.totals?.invoiceTotal)
    });

    // Persist trace if available
    if (tracer && trace) {
      const dbConn = getDb();
      if (dbConn) {
        tracer.persistTrace(dbConn, runId).catch(err => {
          console.warn('[MOBILE_PHOTO] Failed to persist trace:', err.message);
        });
      }
    }

    console.log(`[MOBILE_PHOTO] Complete: ok=${result.ok}, confidence=${(result.confidence.overall * 100).toFixed(1)}%, items=${result.extracted?.lineItems?.length}, time=${result.processingTimeMs}ms`);

    // Return success response
    res.json(result);

  } catch (err) {
    console.error('[MOBILE_PHOTO] Error:', err);

    result.ok = false;
    result.warnings.push(`Processing error: ${err.message}`);
    result.processingTimeMs = Date.now() - startTime;

    trace?.error('Processing failed', err);
    trace?.complete({ error: err.message });

    // Determine appropriate HTTP status
    const statusCode = err.message.includes('Unsupported file type') ? 400 : 500;

    res.status(statusCode).json({
      ok: false,
      runId,
      error: err.message,
      code: statusCode === 400 ? 'INVALID_INPUT' : 'PROCESSING_ERROR',
      processingTimeMs: result.processingTimeMs
    });
  }
});

/**
 * GET /api/ingest/photo/status
 *
 * Check if mobile photo upload is enabled and get configuration
 */
router.get('/photo/status', (req, res) => {
  res.json({
    enabled: MOBILE_PHOTO_ENABLED,
    maxFileSizeMb: MAX_FILE_SIZE_MB,
    supportedFormats: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
    features: {
      pipelineV2: !!(getInvoiceImagePipeline()?.PIPELINE_V2_ENABLED),
      roiFallback: !!(getRoiOcrFallback()?.isAvailable?.()),
      tracing: !!(getParseTracer()?.TRACING_ENABLED)
    }
  });
});

/**
 * GET /api/ingest/photo/traces
 *
 * Get recent parse traces (for debugging)
 * Requires admin/manager role
 */
router.get('/photo/traces', (req, res) => {
  // Check role
  const role = req.user?.role;
  if (!['admin', 'manager'].includes(role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const tracer = getParseTracer();
  if (!tracer) {
    return res.status(503).json({ error: 'Tracing not available' });
  }

  const limit = parseInt(req.query.limit || '20', 10);
  const traces = tracer.getRecentTraces(limit);

  res.json({
    traces,
    total: traces.length
  });
});

/**
 * GET /api/ingest/photo/trace/:runId
 *
 * Get a specific trace by run ID (for debugging)
 * Requires admin/manager role
 */
router.get('/photo/trace/:runId', (req, res) => {
  const role = req.user?.role;
  if (!['admin', 'manager'].includes(role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const tracer = getParseTracer();
  if (!tracer) {
    return res.status(503).json({ error: 'Tracing not available' });
  }

  const trace = tracer.getTrace(req.params.runId);
  if (!trace) {
    return res.status(404).json({ error: 'Trace not found' });
  }

  res.json(trace);
});

// Error handler for multer errors
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        ok: false,
        error: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB`,
        code: 'FILE_TOO_LARGE'
      });
    }
    return res.status(400).json({
      ok: false,
      error: err.message,
      code: 'UPLOAD_ERROR'
    });
  }

  if (err) {
    return res.status(400).json({
      ok: false,
      error: err.message,
      code: 'INVALID_REQUEST'
    });
  }

  next();
});

module.exports = router;
