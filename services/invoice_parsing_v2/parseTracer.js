/**
 * Parse Tracer - Debug tracing for invoice parsing pipeline
 *
 * Captures detailed traces of each parsing step for debugging and analysis:
 * - OCR preprocessing steps
 * - Text normalization changes
 * - Vendor detection reasoning
 * - Line item extraction attempts
 * - Totals extraction with confidence
 * - Validation results
 *
 * Traces are stored in memory with configurable retention, and optionally
 * persisted to the database for production debugging.
 */

const fs = require('fs');
const path = require('path');

// Feature flag - enable/disable tracing
const TRACING_ENABLED = process.env.PARSE_TRACING !== 'false';
const TRACE_RETENTION_MS = 1000 * 60 * 60 * 24; // 24 hours
const MAX_TRACES_IN_MEMORY = 100;

// In-memory trace storage (circular buffer)
const traceStore = new Map();
const traceOrder = [];

/**
 * Trace step types for categorization
 */
const TRACE_STEP = {
  // Input phase
  INPUT_RECEIVED: 'input_received',
  FILE_TYPE_DETECTED: 'file_type_detected',

  // OCR phase
  OCR_START: 'ocr_start',
  OCR_PREPROCESSING: 'ocr_preprocessing',
  OCR_DESKEW: 'ocr_deskew',
  OCR_ENHANCEMENT: 'ocr_enhancement',
  OCR_TESSERACT: 'ocr_tesseract',
  OCR_PSM_ATTEMPT: 'ocr_psm_attempt',
  OCR_COMBINED: 'ocr_combined',
  OCR_COMPLETE: 'ocr_complete',

  // Text normalization
  TEXT_NORMALIZE_START: 'text_normalize_start',
  TEXT_FIX_SPACED_CHARS: 'text_fix_spaced_chars',
  TEXT_FIX_EMBEDDED_SPACES: 'text_fix_embedded_spaces',
  TEXT_OCR_CORRECTIONS: 'text_ocr_corrections',
  TEXT_NORMALIZE_COMPLETE: 'text_normalize_complete',

  // Vendor detection
  VENDOR_DETECT_START: 'vendor_detect_start',
  VENDOR_PATTERN_MATCH: 'vendor_pattern_match',
  VENDOR_DETECTED: 'vendor_detected',
  VENDOR_FALLBACK: 'vendor_fallback',

  // Parsing phase
  PARSE_START: 'parse_start',
  PARSE_HEADER: 'parse_header',
  PARSE_CUSTOMER: 'parse_customer',
  PARSE_LINE_ITEMS_START: 'parse_line_items_start',
  PARSE_LINE_ITEM: 'parse_line_item',
  PARSE_LINE_ITEMS_COMPLETE: 'parse_line_items_complete',
  PARSE_TOTALS_START: 'parse_totals_start',
  PARSE_TOTAL_CANDIDATE: 'parse_total_candidate',
  PARSE_TOTALS_COMPLETE: 'parse_totals_complete',
  PARSE_ADJUSTMENTS: 'parse_adjustments',
  PARSE_COMPLETE: 'parse_complete',

  // Validation phase
  VALIDATE_START: 'validate_start',
  VALIDATE_MATH_CHECK: 'validate_math_check',
  VALIDATE_CONFIDENCE: 'validate_confidence',
  VALIDATE_COMPLETE: 'validate_complete',

  // ROI fallback
  ROI_FALLBACK_START: 'roi_fallback_start',
  ROI_REGION_CROP: 'roi_region_crop',
  ROI_OCR_RESULT: 'roi_ocr_result',
  ROI_FALLBACK_COMPLETE: 'roi_fallback_complete',

  // Error/warning
  WARNING: 'warning',
  ERROR: 'error'
};

/**
 * Create a new trace context for a parsing run
 * @param {string} runId - Unique identifier for this parsing run
 * @param {Object} metadata - Optional metadata (userId, source, etc.)
 * @returns {TraceContext}
 */
function createTrace(runId, metadata = {}) {
  if (!TRACING_ENABLED) {
    return createNoOpTrace();
  }

  const trace = {
    runId,
    startTime: Date.now(),
    endTime: null,
    metadata: {
      ...metadata,
      traceVersion: '1.0'
    },
    steps: [],
    summary: {
      stepCount: 0,
      warnings: 0,
      errors: 0,
      durationMs: 0
    }
  };

  // Add to store
  traceStore.set(runId, trace);
  traceOrder.push(runId);

  // Cleanup old traces if over limit
  while (traceOrder.length > MAX_TRACES_IN_MEMORY) {
    const oldRunId = traceOrder.shift();
    traceStore.delete(oldRunId);
  }

  return createTraceContext(trace);
}

/**
 * Create a trace context wrapper with helper methods
 */
function createTraceContext(trace) {
  return {
    runId: trace.runId,

    /**
     * Add a step to the trace
     * @param {string} stepType - One of TRACE_STEP values
     * @param {Object} data - Step-specific data
     * @param {Object} options - Options like { level: 'debug'|'info'|'warn'|'error' }
     */
    step(stepType, data = {}, options = {}) {
      const step = {
        t: Date.now() - trace.startTime, // ms since start
        type: stepType,
        level: options.level || 'info',
        data: sanitizeTraceData(data)
      };

      trace.steps.push(step);
      trace.summary.stepCount++;

      if (options.level === 'warn' || stepType === TRACE_STEP.WARNING) {
        trace.summary.warnings++;
      }
      if (options.level === 'error' || stepType === TRACE_STEP.ERROR) {
        trace.summary.errors++;
      }

      // Log to console in debug mode
      if (process.env.PARSE_TRACE_VERBOSE === 'true') {
        console.log(`[TRACE:${trace.runId}] ${stepType}`, JSON.stringify(data).substring(0, 200));
      }

      return this;
    },

    /**
     * Log a warning
     */
    warn(message, data = {}) {
      return this.step(TRACE_STEP.WARNING, { message, ...data }, { level: 'warn' });
    },

    /**
     * Log an error
     */
    error(message, error, data = {}) {
      return this.step(TRACE_STEP.ERROR, {
        message,
        error: error?.message || String(error),
        stack: error?.stack?.split('\n').slice(0, 5).join('\n'),
        ...data
      }, { level: 'error' });
    },

    /**
     * Finalize the trace
     */
    complete(finalData = {}) {
      trace.endTime = Date.now();
      trace.summary.durationMs = trace.endTime - trace.startTime;
      trace.summary.finalResult = sanitizeTraceData(finalData);

      return {
        runId: trace.runId,
        durationMs: trace.summary.durationMs,
        stepCount: trace.summary.stepCount,
        warnings: trace.summary.warnings,
        errors: trace.summary.errors
      };
    },

    /**
     * Get the full trace data
     */
    getTrace() {
      return trace;
    }
  };
}

/**
 * Create a no-op trace context when tracing is disabled
 */
function createNoOpTrace() {
  const noOp = () => noOpContext;
  const noOpContext = {
    runId: null,
    step: noOp,
    warn: noOp,
    error: noOp,
    complete: () => ({ runId: null, durationMs: 0, stepCount: 0, warnings: 0, errors: 0 }),
    getTrace: () => null
  };
  return noOpContext;
}

/**
 * Sanitize trace data to avoid storing sensitive or huge data
 */
function sanitizeTraceData(data) {
  if (!data) return data;

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    // Skip sensitive keys
    if (/password|secret|token|key/i.test(key)) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Truncate long strings
    if (typeof value === 'string') {
      sanitized[key] = value.length > 500 ? value.substring(0, 500) + '...[truncated]' : value;
      continue;
    }

    // Truncate arrays
    if (Array.isArray(value)) {
      sanitized[key] = value.length > 20
        ? [...value.slice(0, 20), `...and ${value.length - 20} more`]
        : value;
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

/**
 * Get a trace by run ID
 */
function getTrace(runId) {
  return traceStore.get(runId) || null;
}

/**
 * Get recent traces (for debugging dashboard)
 */
function getRecentTraces(limit = 20) {
  const recent = traceOrder.slice(-limit).reverse();
  return recent.map(runId => {
    const trace = traceStore.get(runId);
    if (!trace) return null;
    return {
      runId: trace.runId,
      startTime: new Date(trace.startTime).toISOString(),
      durationMs: trace.summary.durationMs,
      stepCount: trace.summary.stepCount,
      warnings: trace.summary.warnings,
      errors: trace.summary.errors,
      metadata: trace.metadata
    };
  }).filter(Boolean);
}

/**
 * Export trace to file (for debugging)
 */
function exportTrace(runId, outputDir = './traces') {
  const trace = traceStore.get(runId);
  if (!trace) return null;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filename = `trace-${runId}-${Date.now()}.json`;
  const filepath = path.join(outputDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(trace, null, 2));

  return filepath;
}

/**
 * Persist trace to database (optional)
 * @param {Object} db - Database connection
 * @param {string} runId - Run ID
 */
async function persistTrace(db, runId) {
  const trace = traceStore.get(runId);
  if (!trace || !db) return false;

  try {
    const database = typeof db.getDatabase === 'function' ? db.getDatabase() : db;

    // Check if table exists, create if not
    database.exec(`
      CREATE TABLE IF NOT EXISTS parse_traces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL UNIQUE,
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        duration_ms INTEGER,
        step_count INTEGER,
        warnings INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,
        trace_json TEXT,
        summary_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_parse_traces_run_id ON parse_traces(run_id);
      CREATE INDEX IF NOT EXISTS idx_parse_traces_created ON parse_traces(created_at);
    `);

    const stmt = database.prepare(`
      INSERT OR REPLACE INTO parse_traces
      (run_id, user_id, duration_ms, step_count, warnings, errors, trace_json, summary_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      trace.runId,
      trace.metadata.userId || null,
      trace.summary.durationMs,
      trace.summary.stepCount,
      trace.summary.warnings,
      trace.summary.errors,
      JSON.stringify(trace.steps),
      JSON.stringify(trace.summary)
    );

    return true;
  } catch (err) {
    console.error('[PARSE_TRACER] Failed to persist trace:', err.message);
    return false;
  }
}

/**
 * Clean up old traces from memory and database
 */
function cleanupOldTraces(maxAgeMs = TRACE_RETENTION_MS) {
  const cutoff = Date.now() - maxAgeMs;

  // Clean memory
  for (const runId of [...traceOrder]) {
    const trace = traceStore.get(runId);
    if (trace && trace.startTime < cutoff) {
      traceStore.delete(runId);
      const idx = traceOrder.indexOf(runId);
      if (idx >= 0) traceOrder.splice(idx, 1);
    }
  }
}

module.exports = {
  TRACE_STEP,
  TRACING_ENABLED,
  createTrace,
  getTrace,
  getRecentTraces,
  exportTrace,
  persistTrace,
  cleanupOldTraces
};
