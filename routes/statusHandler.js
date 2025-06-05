const { getLoadBalancer } = require('../services/loadBalancer');
const { getJobManager } = require('../services/jobManager');
const { getJobProcessor } = require('../services/jobProcessor');
const { getMetrics } = require('../services/metrics');
const { getConnectionManager } = require('../services/connectionManager');

/**
 * System health check endpoint
 * Returns 200 for healthy, 503 for degraded system
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getSystemHealth(req, res) {
  try {
    const timestamp = new Date().toISOString();
    const loadBalancer = getLoadBalancer();
    const jobProcessor = getJobProcessor();
    const jobManager = getJobManager();
    const connectionManager = getConnectionManager();
    const metrics = getMetrics();
    
    // Get ComfyUI instance health
    const instancesStatus = loadBalancer.getInstancesStatus();
    const healthyInstances = instancesStatus.filter(instance => instance.healthy);
    const totalInstances = instancesStatus.length;
    
    // System uptime
    const metricsStats = metrics.getStats();
    const systemUptime = metricsStats.system.total_uptime_ms;
    const sessionUptime = metricsStats.system.session_uptime_ms;
    
    // Job processor status
    const processorStats = jobProcessor.getStats();
    const jobManagerStats = jobManager.getStats();
    
    // Connection manager status
    const connectionStats = connectionManager.getAllStats();
    
    // Determine overall system health
    let systemStatus = 'healthy';
    let statusCode = 200;
    const healthIssues = [];
    
    // Check instance health
    if (healthyInstances.length === 0) {
      systemStatus = 'critical';
      healthIssues.push('No healthy ComfyUI instances available');
    } else if (healthyInstances.length < totalInstances) {
      systemStatus = 'degraded';
      healthIssues.push(`${totalInstances - healthyInstances.length} of ${totalInstances} ComfyUI instances unhealthy`);
    }
    
    // Check job processor
    if (!processorStats.isRunning) {
      systemStatus = 'critical';
      healthIssues.push('Job processor not running');
    }
    
    // Check for high error rate (>20% in recent metrics)
    const errorRate = parseFloat(metricsStats.jobs.error_rate.replace('%', ''));
    if (errorRate > 20 && metricsStats.jobs.total > 10) {
      if (systemStatus === 'healthy') systemStatus = 'degraded';
      healthIssues.push(`High error rate: ${metricsStats.jobs.error_rate}`);
    }
    
    // Build response
    const healthResponse = {
      status: systemStatus,
      timestamp: timestamp,
      uptime: {
        total_uptime_ms: systemUptime,
        total_uptime_hours: parseFloat((systemUptime / (1000 * 60 * 60)).toFixed(2)),
        session_uptime_ms: sessionUptime,
        session_uptime_hours: parseFloat((sessionUptime / (1000 * 60 * 60)).toFixed(2)),
        started_at: metricsStats.system.system_start_time,
        session_started_at: metricsStats.system.session_start_time
      },
      comfyui_instances: {
        total: totalInstances,
        healthy: healthyInstances.length,
        unhealthy: totalInstances - healthyInstances.length,
        instances: instancesStatus.map(instance => ({
          id: instance.id,
          host: instance.host,
          is_healthy: instance.healthy,
          last_health_check: instance.lastHealthCheck,
          circuit_breaker: instance.circuitBreaker ? {
            state: instance.circuitBreaker.state,
            failures: instance.circuitBreaker.failures,
            error_rate: instance.circuitBreaker.errorRate
          } : null,
          active_jobs: instance.activeJobs || 0
        }))
      },
      job_processing: {
        processor_running: processorStats.isRunning,
        active_jobs: processorStats.activeJobs,
        max_concurrent_jobs: processorStats.maxConcurrentJobs,
        total_jobs_in_memory: jobManagerStats.total,
        pending_jobs: jobManagerStats.byStatus.pending || 0,
        processing_jobs: jobManagerStats.byStatus.processing || 0
      },
      connections: {
        total_pools: Object.keys(connectionStats).length,
        pool_stats: connectionStats
      },
      performance: {
        total_jobs_processed: metricsStats.jobs.total,
        success_rate: metricsStats.jobs.success_rate,
        error_rate: metricsStats.jobs.error_rate,
        average_processing_time_seconds: metricsStats.processing_time.average_seconds,
        jobs_per_hour: metricsStats.jobs.jobs_per_hour
      },
      issues: healthIssues,
      last_health_check: timestamp
    };
    
    return res.status(statusCode).json(healthResponse);
    
  } catch (error) {
    console.error('Error in system health check:', error);
    return res.status(503).json({
      status: 'critical',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      details: error.message,
      issues: ['Health check system failure']
    });
  }
}

/**
 * Basic system metrics endpoint
 * Returns key operational metrics for monitoring
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getBasicMetrics(req, res) {
  try {
    const timestamp = new Date().toISOString();
    const metrics = getMetrics();
    const loadBalancer = getLoadBalancer();
    const jobProcessor = getJobProcessor();
    
    const metricsStats = metrics.getStats();
    const processorStats = jobProcessor.getStats();
    
    // Build basic metrics response
    const basicMetrics = {
      timestamp: timestamp,
      system: {
        uptime_hours: metricsStats.system.total_uptime_hours,
        session_uptime_hours: metricsStats.system.session_uptime_hours,
        started_at: metricsStats.system.system_start_time
      },
      jobs: {
        total_processed: metricsStats.jobs.total,
        completed: metricsStats.jobs.completed,
        failed: metricsStats.jobs.failed,
        success_rate: metricsStats.jobs.success_rate,
        error_rate: metricsStats.jobs.error_rate,
        jobs_per_hour: metricsStats.jobs.jobs_per_hour,
        currently_active: processorStats.activeJobs,
        max_concurrent: processorStats.maxConcurrentJobs
      },
      performance: {
        average_processing_time_ms: metricsStats.processing_time.average_ms,
        average_processing_time_seconds: metricsStats.processing_time.average_seconds,
        min_processing_time_ms: metricsStats.processing_time.percentiles.min_ms,
        max_processing_time_ms: metricsStats.processing_time.percentiles.max_ms,
        p50_processing_time_ms: metricsStats.processing_time.percentiles.p50_ms,
        p95_processing_time_ms: metricsStats.processing_time.percentiles.p95_ms
      },
      instances: {},
      job_types: {}
    };
    
    // Add per-instance statistics
    for (const [host, stats] of Object.entries(metricsStats.instances)) {
      basicMetrics.instances[host] = {
        total_jobs: stats.totalJobs,
        completed_jobs: stats.completedJobs,
        failed_jobs: stats.failedJobs,
        success_rate: stats.successRate,
        average_processing_time_ms: stats.averageProcessingTime,
        current_active_jobs: processorStats.instanceJobCounts[host] || 0
      };
    }
    
    // Add per-job-type statistics
    for (const [type, stats] of Object.entries(metricsStats.job_types)) {
      basicMetrics.job_types[type] = {
        total_jobs: stats.totalJobs,
        completed_jobs: stats.completedJobs,
        failed_jobs: stats.failedJobs,
        success_rate: stats.successRate,
        average_processing_time_ms: stats.averageProcessingTime
      };
    }
    
    return res.status(200).json(basicMetrics);
    
  } catch (error) {
    console.error('Error getting basic metrics:', error);
    return res.status(500).json({
      error: 'Failed to retrieve basic metrics',
      timestamp: new Date().toISOString(),
      details: error.message
    });
  }
}

/**
 * Quick system status endpoint (lightweight)
 * Returns minimal status information for rapid health checks
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getQuickStatus(req, res) {
  try {
    const timestamp = new Date().toISOString();
    const loadBalancer = getLoadBalancer();
    const jobProcessor = getJobProcessor();
    const metrics = getMetrics();
    
    const healthyInstances = loadBalancer.healthChecker.getHealthyInstances();
    const processorStats = jobProcessor.getStats();
    const metricsStats = metrics.getStats();
    
    // Determine status
    let status = 'healthy';
    if (!processorStats.isRunning || healthyInstances.length === 0) {
      status = 'critical';
    } else if (healthyInstances.length < 2) {
      status = 'degraded';
    }
    
    const quickStatus = {
      status: status,
      timestamp: timestamp,
      healthy_instances: healthyInstances.length,
      total_instances: 2,
      active_jobs: processorStats.activeJobs,
      total_jobs_processed: metricsStats.jobs.total,
      uptime_hours: metricsStats.system.total_uptime_hours,
      processor_running: processorStats.isRunning
    };
    
    const statusCode = 200;
    return res.status(statusCode).json(quickStatus);
    
  } catch (error) {
    console.error('Error getting quick status:', error);
    return res.status(503).json({
      status: 'critical',
      timestamp: new Date().toISOString(),
      error: 'Status check failed'
    });
  }
}

module.exports = {
  getSystemHealth,
  getBasicMetrics,
  getQuickStatus
};