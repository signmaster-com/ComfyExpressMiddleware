const { getMetrics } = require('../services/metrics');
const { getLoadBalancer } = require('../services/loadBalancer');
const { getJobProcessor } = require('../services/jobProcessor');
const { getJobManager } = require('../services/jobManager');

/**
 * Get comprehensive system metrics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getSystemMetrics(req, res) {
  try {
    const metrics = getMetrics();
    const loadBalancer = getLoadBalancer();
    const jobProcessor = getJobProcessor();
    const jobManager = getJobManager();
    
    // Get core metrics
    const coreMetrics = metrics.getStats();
    
    // Get load balancer metrics
    const loadBalancerMetrics = loadBalancer.getMetrics();
    
    // Get job processor metrics
    const processorMetrics = jobProcessor.getStats();
    
    // Get job manager metrics
    const jobManagerMetrics = jobManager.getStats();
    
    // Get instance utilization
    const instanceUtilization = metrics.getInstanceUtilization();
    
    // Combine all metrics
    const response = {
      timestamp: new Date().toISOString(),
      metrics: {
        ...coreMetrics,
        load_balancer: loadBalancerMetrics,
        job_processor: processorMetrics,
        job_manager: jobManagerMetrics,
        instance_utilization: instanceUtilization
      }
    };
    
    return res.status(200).json(response);
  } catch (error) {
    console.error('Error getting system metrics:', error);
    return res.status(500).json({
      error: 'Failed to get system metrics',
      details: error.message
    });
  }
}

/**
 * Get performance metrics summary
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getPerformanceMetrics(req, res) {
  try {
    const metrics = getMetrics();
    const stats = metrics.getStats();
    
    // Extract key performance indicators
    const response = {
      timestamp: new Date().toISOString(),
      performance: {
        uptime_hours: stats.system.uptime_hours,
        total_jobs: stats.jobs.total,
        success_rate: stats.jobs.success_rate,
        average_processing_time_seconds: stats.processing_time.average_seconds,
        jobs_per_hour: stats.jobs.jobs_per_hour,
        percentiles: stats.processing_time.percentiles,
        instance_utilization: metrics.getInstanceUtilization()
      }
    };
    
    return res.status(200).json(response);
  } catch (error) {
    console.error('Error getting performance metrics:', error);
    return res.status(500).json({
      error: 'Failed to get performance metrics',
      details: error.message
    });
  }
}

/**
 * Get error metrics and recent errors
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getErrorMetrics(req, res) {
  try {
    const metrics = getMetrics();
    const stats = metrics.getStats();
    
    const response = {
      timestamp: new Date().toISOString(),
      errors: {
        total_errors: stats.errors.total_errors,
        error_rate: stats.jobs.error_rate,
        recent_errors: stats.errors.recent_errors,
        error_history_size: stats.errors.error_history_size,
        failed_jobs_by_type: {}
      }
    };
    
    // Add failed job counts by type
    Object.entries(stats.job_types).forEach(([type, typeStats]) => {
      response.errors.failed_jobs_by_type[type] = {
        total_failed: typeStats.failedJobs,
        total_jobs: typeStats.totalJobs,
        failure_rate: typeStats.totalJobs > 0 ? 
          ((typeStats.failedJobs / typeStats.totalJobs) * 100).toFixed(2) + '%' : '0%'
      };
    });
    
    return res.status(200).json(response);
  } catch (error) {
    console.error('Error getting error metrics:', error);
    return res.status(500).json({
      error: 'Failed to get error metrics',
      details: error.message
    });
  }
}

/**
 * Get instance-specific metrics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getInstanceMetrics(req, res) {
  try {
    const { instance } = req.params;
    const metrics = getMetrics();
    const loadBalancer = getLoadBalancer();
    const stats = metrics.getStats();
    
    let response;
    
    if (instance) {
      // Get metrics for specific instance
      const instanceStats = stats.instances[instance];
      const loadBalancerInstanceStats = loadBalancer.getMetrics().instances;
      
      if (!instanceStats) {
        return res.status(404).json({
          error: 'Instance not found',
          available_instances: Object.keys(stats.instances)
        });
      }
      
      response = {
        timestamp: new Date().toISOString(),
        instance: instance,
        metrics: {
          ...instanceStats,
          current_active_jobs: Object.values(loadBalancerInstanceStats)
            .find(inst => inst.host === instance)?.activeJobs || 0,
          is_healthy: Object.values(loadBalancerInstanceStats)
            .find(inst => inst.host === instance)?.isHealthy || false
        }
      };
    } else {
      // Get all instance metrics
      response = {
        timestamp: new Date().toISOString(),
        instances: stats.instances,
        utilization: metrics.getInstanceUtilization(),
        load_balancer: loadBalancer.getMetrics()
      };
    }
    
    return res.status(200).json(response);
  } catch (error) {
    console.error('Error getting instance metrics:', error);
    return res.status(500).json({
      error: 'Failed to get instance metrics',
      details: error.message
    });
  }
}

/**
 * Force save metrics to file immediately
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function forceSaveMetrics(req, res) {
  try {
    const metrics = getMetrics();
    const success = await metrics.forceSave();
    
    if (success) {
      return res.status(200).json({
        message: 'Metrics saved successfully',
        timestamp: new Date().toISOString(),
        file_path: metrics.metricsFilePath
      });
    } else {
      return res.status(500).json({
        error: 'Failed to save metrics'
      });
    }
  } catch (error) {
    console.error('Error force saving metrics:', error);
    return res.status(500).json({
      error: 'Failed to force save metrics',
      details: error.message
    });
  }
}

/**
 * Get metrics persistence status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getMetricsPersistenceStatus(req, res) {
  try {
    const metrics = getMetrics();
    const persistenceStatus = metrics.getPersistenceStatus();
    
    return res.status(200).json({
      timestamp: new Date().toISOString(),
      persistence: persistenceStatus
    });
  } catch (error) {
    console.error('Error getting persistence status:', error);
    return res.status(500).json({
      error: 'Failed to get persistence status',
      details: error.message
    });
  }
}

module.exports = {
  getSystemMetrics,
  getPerformanceMetrics,
  getErrorMetrics,
  getInstanceMetrics,
  forceSaveMetrics,
  getMetricsPersistenceStatus
};