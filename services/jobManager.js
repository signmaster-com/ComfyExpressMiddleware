const { v4: uuidv4 } = require('uuid');

/**
 * Lightweight in-memory job management for ComfyUI workflows
 * Stores jobs in memory with automatic cleanup and status tracking
 */
class JobManager {
  constructor() {
    // In-memory job storage using Map for O(1) access
    this.jobs = new Map();
    
    // Cleanup timers for automatic job expiration
    this.cleanupTimers = new Map();
    
    // Configuration
    this.jobTimeout = parseInt(process.env.JOB_TIMEOUT) || 300000; // 5 minutes default
    
    // Job state constants
    this.JOB_STATES = {
      PENDING: 'pending',
      PROCESSING: 'processing', 
      COMPLETED: 'completed',
      FAILED: 'failed'
    };
    
    console.log(`📋 JobManager initialized with ${this.jobTimeout / 1000}s job timeout`);
    
    // Graceful shutdown handling
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  /**
   * Create a new job with unique ID and metadata
   * @param {string} type - Job type (e.g., 'remove-background', 'upscale-image')
   * @param {Object} data - Job input data
   * @param {string} comfyuiInstance - ComfyUI instance host
   * @returns {string} Job ID
   */
  createJob(type, data, comfyuiInstance = null) {
    const jobId = uuidv4();
    const now = Date.now();
    
    const job = {
      id: jobId,
      type: type,
      status: this.JOB_STATES.PENDING,
      data: data,
      createdTime: now,
      updatedTime: now,
      comfyuiInstance: comfyuiInstance,
      result: null,
      error: null
    };
    
    // Store job in memory
    this.jobs.set(jobId, job);
    
    // Schedule automatic cleanup
    this.scheduleCleanup(jobId);
    
    console.log(`📝 Created job ${jobId} (type: ${type}, instance: ${comfyuiInstance || 'unknown'})`);
    return jobId;
  }

  /**
   * Retrieve a job by ID
   * @param {string} jobId - Job ID
   * @returns {Object|null} Job object or null if not found
   */
  getJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.log(`❓ Job ${jobId} not found`);
      return null;
    }
    return { ...job }; // Return copy to prevent external modification
  }

  /**
   * Update job status and metadata
   * @param {string} jobId - Job ID
   * @param {string} status - New status (pending, processing, completed, failed)
   * @param {Object} updates - Additional fields to update (result, error, etc.)
   * @returns {boolean} Success status
   */
  updateJobStatus(jobId, status, updates = {}) {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.log(`❓ Cannot update job ${jobId} - not found`);
      return false;
    }

    // Validate status
    if (!Object.values(this.JOB_STATES).includes(status)) {
      console.error(`❌ Invalid job status: ${status}`);
      return false;
    }

    // Update job fields
    job.status = status;
    job.updatedTime = Date.now();
    
    // Apply additional updates
    Object.assign(job, updates);
    
    console.log(`🔄 Updated job ${jobId} status: ${status}`);
    
    // If job is completed or failed, schedule immediate cleanup (after a short delay for result retrieval)
    if (status === this.JOB_STATES.COMPLETED || status === this.JOB_STATES.FAILED) {
      this.rescheduleCleanup(jobId, 30000); // 30 seconds to retrieve results
    }
    
    return true;
  }

  /**
   * Delete a job manually
   * @param {string} jobId - Job ID
   * @returns {boolean} Success status
   */
  deleteJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.log(`❓ Cannot delete job ${jobId} - not found`);
      return false;
    }

    // Cancel cleanup timer
    this.cancelCleanup(jobId);
    
    // Remove from memory
    this.jobs.delete(jobId);
    
    console.log(`🗑️  Deleted job ${jobId} (type: ${job.type})`);
    return true;
  }

  /**
   * Get all jobs (for debugging/monitoring)
   * @param {string} status - Optional status filter
   * @param {string} type - Optional type filter
   * @returns {Array} Array of job objects
   */
  getAllJobs(status = null, type = null) {
    let jobs = Array.from(this.jobs.values());
    
    if (status) {
      jobs = jobs.filter(job => job.status === status);
    }
    
    if (type) {
      jobs = jobs.filter(job => job.type === type);
    }
    
    return jobs.map(job => ({ ...job })); // Return copies
  }

  /**
   * Get job statistics
   * @returns {Object} Job stats by status and type
   */
  getStats() {
    const stats = {
      total: this.jobs.size,
      byStatus: {},
      byType: {},
      byInstance: {}
    };

    // Initialize status counters
    Object.values(this.JOB_STATES).forEach(status => {
      stats.byStatus[status] = 0;
    });

    // Count jobs by status, type, and instance
    for (const job of this.jobs.values()) {
      stats.byStatus[job.status]++;
      
      stats.byType[job.type] = (stats.byType[job.type] || 0) + 1;
      
      if (job.comfyuiInstance) {
        stats.byInstance[job.comfyuiInstance] = (stats.byInstance[job.comfyuiInstance] || 0) + 1;
      }
    }

    return stats;
  }

  /**
   * Schedule automatic job cleanup
   * @param {string} jobId - Job ID
   * @param {number} delay - Cleanup delay in milliseconds (default: job timeout)
   */
  scheduleCleanup(jobId, delay = this.jobTimeout) {
    // Cancel existing timer if present
    this.cancelCleanup(jobId);
    
    const timer = setTimeout(() => {
      this.cleanupJob(jobId);
    }, delay);
    
    this.cleanupTimers.set(jobId, timer);
  }

  /**
   * Reschedule cleanup with new delay
   * @param {string} jobId - Job ID
   * @param {number} delay - New cleanup delay in milliseconds
   */
  rescheduleCleanup(jobId, delay) {
    this.scheduleCleanup(jobId, delay);
  }

  /**
   * Cancel scheduled cleanup for a job
   * @param {string} jobId - Job ID
   */
  cancelCleanup(jobId) {
    const timer = this.cleanupTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(jobId);
    }
  }

  /**
   * Clean up a specific job (internal method)
   * @param {string} jobId - Job ID
   */
  cleanupJob(jobId) {
    const job = this.jobs.get(jobId);
    if (job) {
      console.log(`🧹 Auto-cleaning expired job ${jobId} (type: ${job.type}, status: ${job.status})`);
      this.jobs.delete(jobId);
    }
    this.cleanupTimers.delete(jobId);
  }

  /**
   * Clean up all expired jobs (manual cleanup)
   * @param {number} maxAge - Maximum age in milliseconds (default: job timeout)
   */
  cleanupExpiredJobs(maxAge = this.jobTimeout) {
    const now = Date.now();
    const expired = [];
    
    for (const [jobId, job] of this.jobs.entries()) {
      if (now - job.createdTime > maxAge) {
        expired.push(jobId);
      }
    }
    
    expired.forEach(jobId => {
      this.cancelCleanup(jobId);
      this.cleanupJob(jobId);
    });
    
    if (expired.length > 0) {
      console.log(`🧹 Cleaned up ${expired.length} expired jobs`);
    }
    
    return expired.length;
  }

  /**
   * Get jobs by ComfyUI instance
   * @param {string} instance - ComfyUI instance host
   * @returns {Array} Array of job objects for the instance
   */
  getJobsByInstance(instance) {
    const jobs = [];
    for (const job of this.jobs.values()) {
      if (job.comfyuiInstance === instance) {
        jobs.push({ ...job });
      }
    }
    return jobs;
  }

  /**
   * Find jobs by status
   * @param {string} status - Job status
   * @returns {Array} Array of job objects with the specified status
   */
  getJobsByStatus(status) {
    const jobs = [];
    for (const job of this.jobs.values()) {
      if (job.status === status) {
        jobs.push({ ...job });
      }
    }
    return jobs;
  }

  /**
   * Log current job manager status
   */
  logStatus() {
    const stats = this.getStats();
    console.log('📊 JobManager Status:');
    console.log(`   Total jobs: ${stats.total}`);
    console.log(`   By status: ${JSON.stringify(stats.byStatus)}`);
    if (Object.keys(stats.byType).length > 0) {
      console.log(`   By type: ${JSON.stringify(stats.byType)}`);
    }
    if (Object.keys(stats.byInstance).length > 0) {
      console.log(`   By instance: ${JSON.stringify(stats.byInstance)}`);
    }
    console.log(`   Active cleanup timers: ${this.cleanupTimers.size}`);
  }

  /**
   * Graceful shutdown - clean up all timers
   */
  shutdown() {
    console.log('🛑 JobManager shutting down...');
    
    // Cancel all cleanup timers
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
    
    // Log final stats
    const stats = this.getStats();
    console.log(`✅ JobManager shutdown complete. ${stats.total} jobs in memory at shutdown.`);
  }
}

// Singleton instance
let jobManagerInstance = null;

/**
 * Get or create the job manager instance
 * @returns {JobManager} The job manager instance
 */
function getJobManager() {
  if (!jobManagerInstance) {
    jobManagerInstance = new JobManager();
  }
  return jobManagerInstance;
}

module.exports = {
  JobManager,
  getJobManager
};