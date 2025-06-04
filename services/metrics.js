const fs = require('fs').promises;
const path = require('path');

class BasicMetrics {
  constructor() {
    // File persistence configuration
    this.metricsFilePath = process.env.METRICS_FILE_PATH || path.join(__dirname, '..', 'data', 'metrics.json');
    this.saveInterval = parseInt(process.env.METRICS_SAVE_INTERVAL) || 300000; // 5 minutes default
    this.autoSaveTimer = null;
    
    // Initialize default values
    this.startTime = Date.now();
    this.sessionStartTime = Date.now(); // Track current session start
    
    // Job counters
    this.totalJobs = 0;
    this.completedJobs = 0;
    this.failedJobs = 0;
    
    // Processing time tracking with running statistics
    this.totalProcessingTime = 0; // in milliseconds
    this.minProcessingTime = null; // minimum processing time
    this.maxProcessingTime = null; // maximum processing time
    
    // Approximated percentiles using simple running stats
    this.recentProcessingTimes = []; // Keep only last 100 for approximate percentiles
    this.maxRecentSamples = 100;
    
    // Per-instance statistics
    this.instanceStats = new Map(); // host -> stats object
    
    // Job type statistics
    this.jobTypeStats = new Map(); // type -> stats object
    
    // Error tracking
    this.errors = []; // recent errors with timestamps
    this.maxErrorHistory = 100; // Keep last 100 errors
    
    // Graceful shutdown handling
    process.on('SIGINT', () => this.gracefulShutdown());
    process.on('SIGTERM', () => this.gracefulShutdown());
    
    // Load existing metrics and start auto-save
    this.initialize();
  }

  /**
   * Initialize metrics - load from file if exists and start auto-save
   */
  async initialize() {
    try {
      await this.loadMetricsFromFile();
      this.startAutoSave();
      console.log('📊 BasicMetrics initialized with file persistence');
    } catch (error) {
      console.warn('⚠️  Failed to initialize metrics from file, starting fresh:', error.message);
      this.startAutoSave();
    }
  }

  /**
   * Load metrics from file
   */
  async loadMetricsFromFile() {
    try {
      // Check if file exists
      await fs.access(this.metricsFilePath);
      
      const data = await fs.readFile(this.metricsFilePath, 'utf8');
      const savedMetrics = JSON.parse(data);
      
      // Restore metrics data
      this.startTime = savedMetrics.startTime || this.startTime;
      this.totalJobs = savedMetrics.totalJobs || 0;
      this.completedJobs = savedMetrics.completedJobs || 0;
      this.failedJobs = savedMetrics.failedJobs || 0;
      this.totalProcessingTime = savedMetrics.totalProcessingTime || 0;
      this.minProcessingTime = savedMetrics.minProcessingTime || null;
      this.maxProcessingTime = savedMetrics.maxProcessingTime || null;
      
      // Restore recent processing times (backward compatibility)
      if (savedMetrics.recentProcessingTimes) {
        this.recentProcessingTimes = savedMetrics.recentProcessingTimes;
      } else if (savedMetrics.processingTimes) {
        // Migrate from old format - keep only last 100
        this.recentProcessingTimes = savedMetrics.processingTimes.slice(-this.maxRecentSamples);
      }
      
      // Ensure recent processing times don't exceed limit
      if (this.recentProcessingTimes.length > this.maxRecentSamples) {
        this.recentProcessingTimes = this.recentProcessingTimes.slice(-this.maxRecentSamples);
      }
      
      // Restore Maps from objects
      if (savedMetrics.instanceStats) {
        this.instanceStats = new Map(Object.entries(savedMetrics.instanceStats));
      }
      
      if (savedMetrics.jobTypeStats) {
        this.jobTypeStats = new Map(Object.entries(savedMetrics.jobTypeStats));
      }
      
      // Restore errors array
      this.errors = savedMetrics.errors || [];
      
      // Keep only recent errors
      if (this.errors.length > this.maxErrorHistory) {
        this.errors = this.errors.slice(-this.maxErrorHistory);
      }
      
      console.log(`📂 Loaded metrics from file: ${this.totalJobs} total jobs, ${this.completedJobs} completed`);
      
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('⚠️  Error loading metrics file:', error.message);
      }
      // If file doesn't exist or is corrupted, start fresh
    }
  }

  /**
   * Save metrics to file
   */
  async saveMetricsToFile() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.metricsFilePath);
      await fs.mkdir(dataDir, { recursive: true });
      
      // Prepare data for serialization
      const metricsData = {
        startTime: this.startTime,
        sessionStartTime: this.sessionStartTime,
        totalJobs: this.totalJobs,
        completedJobs: this.completedJobs,
        failedJobs: this.failedJobs,
        totalProcessingTime: this.totalProcessingTime,
        minProcessingTime: this.minProcessingTime,
        maxProcessingTime: this.maxProcessingTime,
        recentProcessingTimes: this.recentProcessingTimes, // Only recent samples for percentiles
        instanceStats: Object.fromEntries(this.instanceStats),
        jobTypeStats: Object.fromEntries(this.jobTypeStats),
        errors: this.errors.slice(-this.maxErrorHistory), // Keep recent errors
        lastSaved: Date.now()
      };
      
      // Write to temporary file first, then rename for atomic operation
      const tempFile = this.metricsFilePath + '.tmp';
      await fs.writeFile(tempFile, JSON.stringify(metricsData, null, 2));
      await fs.rename(tempFile, this.metricsFilePath);
      
      console.log(`💾 Metrics saved to file: ${this.totalJobs} total jobs tracked`);
    } catch (error) {
      console.error('❌ Failed to save metrics to file:', error.message);
    }
  }

  /**
   * Start auto-save timer
   */
  startAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }
    
    this.autoSaveTimer = setInterval(() => {
      this.saveMetricsToFile();
    }, this.saveInterval);
    
    console.log(`⏰ Auto-save enabled: saving metrics every ${this.saveInterval / 1000}s`);
  }

  /**
   * Stop auto-save timer
   */
  stopAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
      console.log('⏹️  Auto-save stopped');
    }
  }

  /**
   * Graceful shutdown - save metrics before exit
   */
  async gracefulShutdown() {
    console.log('🛑 Metrics graceful shutdown - saving final metrics...');
    this.stopAutoSave();
    await this.saveMetricsToFile();
    console.log('✅ Metrics saved successfully on shutdown');
  }

  /**
   * Record a new job creation
   * @param {string} type - Job type (remove-background, upscale-image)
   * @param {string} instance - ComfyUI instance host
   */
  recordJobCreated(type, instance = null) {
    this.totalJobs++;
    
    // Initialize instance stats if needed
    if (instance && !this.instanceStats.has(instance)) {
      this.instanceStats.set(instance, {
        totalJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        totalProcessingTime: 0,
        averageProcessingTime: 0
      });
    }
    
    // Initialize job type stats if needed
    if (!this.jobTypeStats.has(type)) {
      this.jobTypeStats.set(type, {
        totalJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        totalProcessingTime: 0,
        averageProcessingTime: 0
      });
    }
    
    // Increment counters
    if (instance) {
      this.instanceStats.get(instance).totalJobs++;
    }
    this.jobTypeStats.get(type).totalJobs++;
  }

  /**
   * Record job completion with processing time
   * @param {string} type - Job type
   * @param {string} instance - ComfyUI instance host
   * @param {number} processingTimeMs - Processing time in milliseconds
   * @param {boolean} success - Whether job completed successfully
   * @param {string} error - Error message if failed
   */
  recordJobCompleted(type, instance, processingTimeMs, success = true, error = null) {
    const instanceStats = this.instanceStats.get(instance);
    const typeStats = this.jobTypeStats.get(type);
    
    if (success) {
      this.completedJobs++;
      if (instanceStats) instanceStats.completedJobs++;
      if (typeStats) typeStats.completedJobs++;
      
      // Track processing time with running statistics
      this.totalProcessingTime += processingTimeMs;
      
      // Update min/max
      if (this.minProcessingTime === null || processingTimeMs < this.minProcessingTime) {
        this.minProcessingTime = processingTimeMs;
      }
      if (this.maxProcessingTime === null || processingTimeMs > this.maxProcessingTime) {
        this.maxProcessingTime = processingTimeMs;
      }
      
      // Keep only recent processing times for approximate percentiles
      this.recentProcessingTimes.push(processingTimeMs);
      if (this.recentProcessingTimes.length > this.maxRecentSamples) {
        this.recentProcessingTimes.shift(); // Remove oldest
      }
      
      if (instanceStats) {
        instanceStats.totalProcessingTime += processingTimeMs;
        instanceStats.averageProcessingTime = instanceStats.totalProcessingTime / instanceStats.completedJobs;
      }
      
      if (typeStats) {
        typeStats.totalProcessingTime += processingTimeMs;
        typeStats.averageProcessingTime = typeStats.totalProcessingTime / typeStats.completedJobs;
      }
    } else {
      this.failedJobs++;
      if (instanceStats) instanceStats.failedJobs++;
      if (typeStats) typeStats.failedJobs++;
      
      // Record error
      if (error) {
        this.errors.push({
          timestamp: Date.now(),
          type: type,
          instance: instance,
          error: error
        });
        
        // Keep error history manageable
        if (this.errors.length > this.maxErrorHistory) {
          this.errors = this.errors.slice(-this.maxErrorHistory);
        }
      }
    }
  }

  /**
   * Get current metrics statistics
   * @returns {Object} Comprehensive metrics data
   */
  getStats() {
    const now = Date.now();
    const totalUptimeMs = now - this.startTime;
    const totalUptimeHours = totalUptimeMs / (1000 * 60 * 60);
    const sessionUptimeMs = now - this.sessionStartTime;
    const sessionUptimeHours = sessionUptimeMs / (1000 * 60 * 60);
    
    // Calculate error rate
    const errorRate = this.totalJobs > 0 ? (this.failedJobs / this.totalJobs) * 100 : 0;
    
    // Calculate average processing time
    const avgProcessingTime = this.completedJobs > 0 ? this.totalProcessingTime / this.completedJobs : 0;
    
    // Calculate jobs per hour (based on total uptime)
    const jobsPerHour = totalUptimeHours > 0 ? this.totalJobs / totalUptimeHours : 0;
    
    // Calculate processing time percentiles
    const percentiles = this.calculatePercentiles();
    
    // Convert instance stats to object
    const instanceStatsObj = {};
    for (const [host, stats] of this.instanceStats) {
      instanceStatsObj[host] = {
        ...stats,
        successRate: stats.totalJobs > 0 ? ((stats.completedJobs / stats.totalJobs) * 100).toFixed(2) + '%' : '0%'
      };
    }
    
    // Convert job type stats to object
    const jobTypeStatsObj = {};
    for (const [type, stats] of this.jobTypeStats) {
      jobTypeStatsObj[type] = {
        ...stats,
        successRate: stats.totalJobs > 0 ? ((stats.completedJobs / stats.totalJobs) * 100).toFixed(2) + '%' : '0%'
      };
    }
    
    // Recent errors (last 10)
    const recentErrors = this.errors.slice(-10).map(err => ({
      ...err,
      timestamp: new Date(err.timestamp).toISOString()
    }));
    
    return {
      system: {
        total_uptime_ms: totalUptimeMs,
        total_uptime_hours: parseFloat(totalUptimeHours.toFixed(2)),
        session_uptime_ms: sessionUptimeMs,
        session_uptime_hours: parseFloat(sessionUptimeHours.toFixed(2)),
        system_start_time: new Date(this.startTime).toISOString(),
        session_start_time: new Date(this.sessionStartTime).toISOString(),
        metrics_file_path: this.metricsFilePath
      },
      jobs: {
        total: this.totalJobs,
        completed: this.completedJobs,
        failed: this.failedJobs,
        success_rate: (this.totalJobs > 0 ? ((this.completedJobs / this.totalJobs) * 100).toFixed(2) + '%' : '0%'),
        error_rate: parseFloat(errorRate.toFixed(2)) + '%',
        jobs_per_hour: parseFloat(jobsPerHour.toFixed(2))
      },
      processing_time: {
        average_ms: parseFloat(avgProcessingTime.toFixed(2)),
        average_seconds: parseFloat((avgProcessingTime / 1000).toFixed(2)),
        percentiles: percentiles,
        total_processing_time_ms: this.totalProcessingTime,
        total_processing_time_hours: parseFloat((this.totalProcessingTime / (1000 * 60 * 60)).toFixed(3))
      },
      instances: instanceStatsObj,
      job_types: jobTypeStatsObj,
      errors: {
        total_errors: this.failedJobs,
        recent_errors: recentErrors,
        error_history_size: this.errors.length
      }
    };
  }

  /**
   * Calculate processing time percentiles using recent samples
   * @returns {Object} Percentile data
   */
  calculatePercentiles() {
    const recentSamples = this.recentProcessingTimes;
    
    if (recentSamples.length === 0) {
      return {
        p50_ms: 0,
        p90_ms: 0,
        p95_ms: 0,
        p99_ms: 0,
        min_ms: this.minProcessingTime || 0,
        max_ms: this.maxProcessingTime || 0,
        recent_sample_size: 0,
        note: 'Based on recent samples only'
      };
    }
    
    const sorted = [...recentSamples].sort((a, b) => a - b);
    const length = sorted.length;
    
    const getPercentile = (p) => {
      const index = Math.floor((p / 100) * length);
      return sorted[Math.min(index, length - 1)];
    };
    
    return {
      p50_ms: getPercentile(50),
      p90_ms: getPercentile(90),
      p95_ms: getPercentile(95),
      p99_ms: getPercentile(99),
      min_ms: this.minProcessingTime || sorted[0],
      max_ms: this.maxProcessingTime || sorted[length - 1],
      recent_sample_size: length,
      note: 'Based on recent samples only'
    };
  }

  /**
   * Get instance utilization statistics
   * @returns {Object} Instance utilization data
   */
  getInstanceUtilization() {
    const utilization = {};
    
    for (const [host, stats] of this.instanceStats) {
      const totalJobs = stats.totalJobs;
      const systemTotal = this.totalJobs;
      const utilizationPct = systemTotal > 0 ? (totalJobs / systemTotal) * 100 : 0;
      
      utilization[host] = {
        job_count: totalJobs,
        utilization_percentage: parseFloat(utilizationPct.toFixed(2)),
        success_rate: totalJobs > 0 ? ((stats.completedJobs / totalJobs) * 100).toFixed(2) + '%' : '0%',
        average_processing_time_ms: stats.averageProcessingTime
      };
    }
    
    return utilization;
  }

  /**
   * Log current status to console
   */
  logStatus() {
    const stats = this.getStats();
    console.log('=== METRICS STATUS ===');
    console.log(`System Uptime: ${stats.system.total_uptime_hours}h (Session: ${stats.system.session_uptime_hours}h) | Jobs: ${stats.jobs.total} total, ${stats.jobs.completed} completed, ${stats.jobs.failed} failed`);
    console.log(`Success Rate: ${stats.jobs.success_rate} | Avg Processing: ${stats.processing_time.average_seconds}s | Jobs/Hour: ${stats.jobs.jobs_per_hour}`);
    console.log(`Persistence: Auto-save ${this.autoSaveTimer ? 'ON' : 'OFF'} | File: ${path.basename(this.metricsFilePath)}`);
    
    if (Object.keys(stats.instances).length > 0) {
      console.log('Instance Stats:');
      for (const [host, instStats] of Object.entries(stats.instances)) {
        console.log(`  ${host}: ${instStats.totalJobs} jobs, ${instStats.successRate} success, ${(instStats.averageProcessingTime / 1000).toFixed(1)}s avg`);
      }
    }
    
    if (stats.errors.recent_errors.length > 0) {
      console.log(`Recent Errors: ${stats.errors.recent_errors.length} (showing last 3)`);
      stats.errors.recent_errors.slice(-3).forEach(err => {
        console.log(`  ${err.timestamp}: ${err.type} on ${err.instance} - ${err.error}`);
      });
    }
    console.log('======================');
  }

  /**
   * Force save metrics immediately (useful for API endpoints)
   * @returns {Promise<boolean>} Success status
   */
  async forceSave() {
    try {
      await this.saveMetricsToFile();
      return true;
    } catch (error) {
      console.error('❌ Force save failed:', error.message);
      return false;
    }
  }

  /**
   * Get file persistence status
   * @returns {Object} Persistence status info
   */
  getPersistenceStatus() {
    return {
      file_path: this.metricsFilePath,
      auto_save_enabled: this.autoSaveTimer !== null,
      save_interval_ms: this.saveInterval,
      save_interval_minutes: this.saveInterval / 60000
    };
  }
}

// Singleton instance
let metricsInstance = null;

/**
 * Get the singleton metrics instance
 * @returns {BasicMetrics} The metrics instance
 */
function getMetrics() {
  if (!metricsInstance) {
    metricsInstance = new BasicMetrics();
  }
  return metricsInstance;
}

module.exports = {
  BasicMetrics,
  getMetrics
};