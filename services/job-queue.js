/**
 * Job Queue Service
 * Manages background parsing jobs for PDF/OCR processing
 *
 * This removes heavy processing from API threads, improving responsiveness.
 */

const crypto = require('crypto');

// Database reference (will be set by init)
let db = null;

/**
 * Initialize the job queue with database connection
 * @param {Object} database - Database connection from database.js
 */
function init(database) {
  db = database;
}

/**
 * Generate a unique job ID
 * @returns {string} Unique job ID
 */
function generateJobId() {
  return `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Create a new parsing job
 * @param {number} userId - User ID creating the job
 * @param {string} filePath - Path to the file to process
 * @param {Object} options - Processing options
 * @returns {Object} Created job
 */
function createJob(userId, filePath, options = {}) {
  if (!db) {
    throw new Error('Job queue not initialized. Call init() first.');
  }

  const jobId = generateJobId();
  const fileName = options.fileName || filePath.split('/').pop();
  const fileSize = options.fileSize || 0;
  const priority = options.priority || 0;

  const stmt = db.prepare(`
    INSERT INTO parsing_jobs (job_id, user_id, file_path, file_name, file_size, options, priority, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `);

  const result = stmt.run(
    jobId,
    userId,
    filePath,
    fileName,
    fileSize,
    JSON.stringify(options)
  , priority);

  console.log(`[JOB QUEUE] Created job ${jobId} for user ${userId}: ${fileName}`);

  return {
    id: result.lastInsertRowid,
    jobId,
    userId,
    filePath,
    fileName,
    fileSize,
    options,
    priority,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
}

/**
 * Get job by ID
 * @param {string} jobId - Job ID
 * @returns {Object|null} Job or null if not found
 */
function getJob(jobId) {
  if (!db) {
    throw new Error('Job queue not initialized. Call init() first.');
  }

  const stmt = db.prepare('SELECT * FROM parsing_jobs WHERE job_id = ?');
  const job = stmt.get(jobId);

  if (job) {
    job.options = job.options ? JSON.parse(job.options) : {};
    job.result = job.result ? JSON.parse(job.result) : null;
  }

  return job;
}

/**
 * Get all jobs for a user
 * @param {number} userId - User ID
 * @param {Object} options - Query options
 * @returns {Array} List of jobs
 */
function getJobsByUser(userId, options = {}) {
  if (!db) {
    throw new Error('Job queue not initialized. Call init() first.');
  }

  const limit = options.limit || 50;
  const status = options.status;

  let sql = 'SELECT * FROM parsing_jobs WHERE user_id = ?';
  const params = [userId];

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const stmt = db.prepare(sql);
  const jobs = stmt.all(...params);

  return jobs.map(job => ({
    ...job,
    options: job.options ? JSON.parse(job.options) : {},
    result: job.result ? JSON.parse(job.result) : null
  }));
}

/**
 * Claim the next pending job for processing
 * Uses atomic update to prevent race conditions
 * @returns {Object|null} Claimed job or null if none available
 */
function claimNextJob() {
  if (!db) {
    throw new Error('Job queue not initialized. Call init() first.');
  }

  // Use a transaction to atomically claim a job
  const claimJob = db.transaction(() => {
    // Find next pending job (highest priority first, then oldest)
    const job = db.prepare(`
      SELECT * FROM parsing_jobs
      WHERE status = 'pending'
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).get();

    if (!job) return null;

    // Mark as processing
    db.prepare(`
      UPDATE parsing_jobs
      SET status = 'processing', started_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(job.id);

    return job;
  });

  const job = claimJob();

  if (job) {
    job.options = job.options ? JSON.parse(job.options) : {};
    console.log(`[JOB QUEUE] Claimed job ${job.job_id}`);
  }

  return job;
}

/**
 * Complete a job with result
 * @param {string} jobId - Job ID
 * @param {Object} result - Processing result
 */
function completeJob(jobId, result) {
  if (!db) {
    throw new Error('Job queue not initialized. Call init() first.');
  }

  const stmt = db.prepare(`
    UPDATE parsing_jobs
    SET status = 'completed',
        result = ?,
        completed_at = CURRENT_TIMESTAMP
    WHERE job_id = ?
  `);

  stmt.run(JSON.stringify(result), jobId);
  console.log(`[JOB QUEUE] Completed job ${jobId}`);
}

/**
 * Fail a job with error message
 * @param {string} jobId - Job ID
 * @param {string} errorMessage - Error message
 * @param {boolean} retry - Whether to retry the job
 */
function failJob(jobId, errorMessage, retry = true) {
  if (!db) {
    throw new Error('Job queue not initialized. Call init() first.');
  }

  const job = getJob(jobId);
  if (!job) return;

  const canRetry = retry && job.retries < job.max_retries;

  if (canRetry) {
    // Reset to pending for retry
    const stmt = db.prepare(`
      UPDATE parsing_jobs
      SET status = 'pending',
          retries = retries + 1,
          error_message = ?,
          started_at = NULL
      WHERE job_id = ?
    `);
    stmt.run(errorMessage, jobId);
    console.log(`[JOB QUEUE] Job ${jobId} failed, will retry (attempt ${job.retries + 1}/${job.max_retries})`);
  } else {
    // Mark as permanently failed
    const stmt = db.prepare(`
      UPDATE parsing_jobs
      SET status = 'failed',
          error_message = ?,
          completed_at = CURRENT_TIMESTAMP
      WHERE job_id = ?
    `);
    stmt.run(errorMessage, jobId);
    console.log(`[JOB QUEUE] Job ${jobId} permanently failed: ${errorMessage}`);
  }
}

/**
 * Get queue statistics
 * @returns {Object} Queue stats
 */
function getQueueStats() {
  if (!db) {
    throw new Error('Job queue not initialized. Call init() first.');
  }

  const stats = db.prepare(`
    SELECT
      status,
      COUNT(*) as count
    FROM parsing_jobs
    GROUP BY status
  `).all();

  const result = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    total: 0
  };

  for (const row of stats) {
    result[row.status] = row.count;
    result.total += row.count;
  }

  return result;
}

/**
 * Clean up old completed/failed jobs
 * @param {number} daysOld - Delete jobs older than this many days
 * @returns {number} Number of jobs deleted
 */
function cleanupOldJobs(daysOld = 7) {
  if (!db) {
    throw new Error('Job queue not initialized. Call init() first.');
  }

  const stmt = db.prepare(`
    DELETE FROM parsing_jobs
    WHERE status IN ('completed', 'failed')
    AND completed_at < datetime('now', '-' || ? || ' days')
  `);

  const result = stmt.run(daysOld);
  console.log(`[JOB QUEUE] Cleaned up ${result.changes} old jobs`);
  return result.changes;
}

/**
 * Reset stuck jobs (processing for too long)
 * @param {number} timeoutMinutes - Reset jobs processing longer than this
 * @returns {number} Number of jobs reset
 */
function resetStuckJobs(timeoutMinutes = 30) {
  if (!db) {
    throw new Error('Job queue not initialized. Call init() first.');
  }

  const stmt = db.prepare(`
    UPDATE parsing_jobs
    SET status = 'pending',
        started_at = NULL,
        retries = retries + 1
    WHERE status = 'processing'
    AND started_at < datetime('now', '-' || ? || ' minutes')
    AND retries < max_retries
  `);

  const result = stmt.run(timeoutMinutes);
  if (result.changes > 0) {
    console.log(`[JOB QUEUE] Reset ${result.changes} stuck jobs`);
  }
  return result.changes;
}

module.exports = {
  init,
  createJob,
  getJob,
  getJobsByUser,
  claimNextJob,
  completeJob,
  failJob,
  getQueueStats,
  cleanupOldJobs,
  resetStuckJobs
};
