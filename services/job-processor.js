/**
 * Job Processor Service
 * Background worker that processes parsing jobs from the queue
 *
 * This runs in a loop, claiming and processing jobs asynchronously.
 */

const jobQueue = require('./job-queue');
const fs = require('fs');
const path = require('path');

// Will be set during initialization
let universalProcessor = null;
let db = null;

// Processor state
let isRunning = false;
let pollInterval = 2000; // 2 seconds
let pollTimer = null;
let currentJob = null;

/**
 * Initialize the job processor
 * @param {Object} options - Configuration options
 * @param {Object} options.db - Database connection
 * @param {Object} options.processor - Universal invoice processor
 * @param {number} options.pollInterval - Poll interval in ms (default 2000)
 */
function init(options = {}) {
  db = options.db;
  universalProcessor = options.processor;
  pollInterval = options.pollInterval || 2000;

  if (db) {
    jobQueue.init(db);
  }

  console.log('[JOB PROCESSOR] Initialized');
}

/**
 * Start the job processor
 */
function start() {
  if (isRunning) {
    console.log('[JOB PROCESSOR] Already running');
    return;
  }

  isRunning = true;
  console.log('[JOB PROCESSOR] Started');

  // Reset any stuck jobs from previous run
  jobQueue.resetStuckJobs(30);

  // Start polling
  poll();
}

/**
 * Stop the job processor
 */
function stop() {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log('[JOB PROCESSOR] Stopped');
}

/**
 * Poll for and process jobs
 */
async function poll() {
  if (!isRunning) return;

  try {
    // Try to claim a job
    const job = jobQueue.claimNextJob();

    if (job) {
      currentJob = job;
      await processJob(job);
      currentJob = null;
    }
  } catch (error) {
    console.error('[JOB PROCESSOR] Poll error:', error.message);
  }

  // Schedule next poll
  if (isRunning) {
    pollTimer = setTimeout(poll, pollInterval);
  }
}

/**
 * Process a single job
 * @param {Object} job - Job to process
 */
async function processJob(job) {
  const startTime = Date.now();
  console.log(`[JOB PROCESSOR] Processing job ${job.job_id}: ${job.file_name}`);

  try {
    // Validate file exists
    if (!fs.existsSync(job.file_path)) {
      throw new Error(`File not found: ${job.file_path}`);
    }

    // Check if we have the processor
    if (!universalProcessor) {
      throw new Error('Universal processor not initialized');
    }

    // Process the file
    const options = job.options || {};
    const result = await universalProcessor.processInvoiceFile(job.file_path, {
      userId: job.user_id,
      fileName: job.file_name,
      vendor: options.vendor,
      debug: options.debug || false
    });

    // Calculate processing time
    const processingTimeMs = Date.now() - startTime;

    // Store the result
    const jobResult = {
      success: result.success,
      runId: result.runId,
      invoiceNumber: result.invoiceNumber,
      vendorName: result.vendorName,
      totalCents: result.totalCents,
      lineItemCount: result.lineItemCount,
      confidence: result.confidence,
      processingTimeMs,
      completedAt: new Date().toISOString()
    };

    jobQueue.completeJob(job.job_id, jobResult);

    console.log(`[JOB PROCESSOR] Job ${job.job_id} completed in ${processingTimeMs}ms`);

  } catch (error) {
    console.error(`[JOB PROCESSOR] Job ${job.job_id} failed:`, error.message);

    // Determine if we should retry
    const isRetryable = !error.message.includes('File not found') &&
                        !error.message.includes('not initialized');

    jobQueue.failJob(job.job_id, error.message, isRetryable);
  }
}

/**
 * Get processor status
 * @returns {Object} Status information
 */
function getStatus() {
  const queueStats = db ? jobQueue.getQueueStats() : { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 };

  return {
    isRunning,
    currentJob: currentJob ? {
      jobId: currentJob.job_id,
      fileName: currentJob.file_name,
      startedAt: currentJob.started_at
    } : null,
    queue: queueStats,
    pollInterval
  };
}

/**
 * Process a job immediately (synchronous mode for API compatibility)
 * This bypasses the queue for simple cases or testing
 * @param {string} filePath - Path to file
 * @param {Object} options - Processing options
 * @returns {Object} Processing result
 */
async function processNow(filePath, options = {}) {
  if (!universalProcessor) {
    throw new Error('Universal processor not initialized');
  }

  return universalProcessor.processInvoiceFile(filePath, options);
}

/**
 * Maintenance tasks (call periodically)
 */
function runMaintenance() {
  if (!db) return;

  // Reset stuck jobs
  const stuckReset = jobQueue.resetStuckJobs(30);

  // Clean up old jobs (older than 7 days)
  const cleaned = jobQueue.cleanupOldJobs(7);

  if (stuckReset > 0 || cleaned > 0) {
    console.log(`[JOB PROCESSOR] Maintenance: reset ${stuckReset} stuck, cleaned ${cleaned} old jobs`);
  }
}

module.exports = {
  init,
  start,
  stop,
  getStatus,
  processNow,
  runMaintenance
};
