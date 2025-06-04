const axios = require('axios');

/**
 * Load balancer for multiple ComfyUI instances
 * Manages instance health and distributes jobs based on load
 */
class ComfyUILoadBalancer {
  constructor() {
    // Initialize instances from environment variables
    const host1 = process.env.COMFYUI_HOST_1 || '192.168.1.19:8188';
    const host2 = process.env.COMFYUI_HOST_2 || '192.168.1.19:8189';
    
    this.instances = [
      {
        id: 'instance-1',
        host: host1,
        healthy: false, // Start as unhealthy until verified
        activeJobs: 0,
        lastHealthCheck: null,
        consecutiveFailures: 0
      },
      {
        id: 'instance-2',
        host: host2,
        healthy: false, // Start as unhealthy until verified
        activeJobs: 0,
        lastHealthCheck: null,
        consecutiveFailures: 0
      }
    ];
    
    // SSL configuration
    this.useSSL = process.env.COMFYUI_USE_SSL === 'true';
    this.httpProtocol = this.useSSL ? 'https' : 'http';
    
    console.log('ComfyUI Load Balancer initialized with instances:', 
      this.instances.map(i => ({ id: i.id, host: i.host }))
    );
    
    this.healthCheckInterval = null;
    this.initialHealthCheckComplete = false;
  }
  
  /**
   * Get the least loaded healthy instance
   * @returns {Promise<Object|null>} The available instance or null if none available
   */
  async getAvailableInstance() {
    // If initial health check hasn't completed, do it now
    if (!this.initialHealthCheckComplete) {
      console.log('Performing initial health check before job assignment...');
      await this.performHealthChecks();
      this.initialHealthCheckComplete = true;
    }
    
    // Filter healthy instances
    const healthyInstances = this.instances.filter(instance => instance.healthy);
    
    if (healthyInstances.length === 0) {
      console.error('No healthy ComfyUI instances available');
      return null;
    }
    
    // Sort by active jobs (ascending) to get least loaded
    const sortedInstances = healthyInstances.sort((a, b) => a.activeJobs - b.activeJobs);
    const selectedInstance = sortedInstances[0];
    
    console.log(`Selected instance ${selectedInstance.id} (${selectedInstance.host}) with ${selectedInstance.activeJobs} active jobs`);
    return selectedInstance;
  }
  
  /**
   * Get instance by host
   * @param {string} host - The host string
   * @returns {Object|null} The instance or null if not found
   */
  getInstanceByHost(host) {
    return this.instances.find(instance => instance.host === host) || null;
  }
  
  /**
   * Increment active job count for an instance
   * @param {string} host - The host string
   */
  incrementActiveJobs(host) {
    const instance = this.getInstanceByHost(host);
    if (instance) {
      instance.activeJobs++;
      console.log(`Instance ${instance.id} (${host}) now has ${instance.activeJobs} active jobs`);
    }
  }
  
  /**
   * Decrement active job count for an instance
   * @param {string} host - The host string
   */
  decrementActiveJobs(host) {
    const instance = this.getInstanceByHost(host);
    if (instance && instance.activeJobs > 0) {
      instance.activeJobs--;
      console.log(`Instance ${instance.id} (${host}) now has ${instance.activeJobs} active jobs`);
    }
  }
  
  /**
   * Mark an instance as healthy
   * @param {string} host - The host string
   */
  markHealthy(host) {
    const instance = this.getInstanceByHost(host);
    if (instance && !instance.healthy) {
      instance.healthy = true;
      instance.consecutiveFailures = 0;
      console.log(`Instance ${instance.id} (${host}) marked as healthy`);
    }
  }
  
  /**
   * Mark an instance as unhealthy
   * @param {string} host - The host string
   */
  markUnhealthy(host) {
    const instance = this.getInstanceByHost(host);
    if (instance && instance.healthy) {
      instance.healthy = false;
      console.warn(`Instance ${instance.id} (${host}) marked as unhealthy`);
    }
  }
  
  /**
   * Update instance health check status
   * @param {string} host - The host string
   * @param {boolean} success - Whether the health check succeeded
   */
  updateHealthCheck(host, success) {
    const instance = this.getInstanceByHost(host);
    if (!instance) return;
    
    instance.lastHealthCheck = new Date().toISOString();
    
    if (success) {
      instance.consecutiveFailures = 0;
      if (!instance.healthy) {
        this.markHealthy(host);
      }
    } else {
      instance.consecutiveFailures++;
      console.warn(`Instance ${instance.id} (${host}) health check failed. Consecutive failures: ${instance.consecutiveFailures}`);
    }
  }
  
  /**
   * Get all instances status
   * @returns {Array} Array of instance status objects
   */
  getInstancesStatus() {
    return this.instances.map(instance => ({
      id: instance.id,
      host: instance.host,
      healthy: instance.healthy,
      activeJobs: instance.activeJobs,
      lastHealthCheck: instance.lastHealthCheck,
      consecutiveFailures: instance.consecutiveFailures
    }));
  }
  
  /**
   * Check if any instance is available
   * @returns {boolean} True if at least one healthy instance exists
   */
  hasAvailableInstance() {
    return this.instances.some(instance => instance.healthy);
  }
  
  /**
   * Get total active jobs across all instances
   * @returns {number} Total active jobs
   */
  getTotalActiveJobs() {
    return this.instances.reduce((total, instance) => total + instance.activeJobs, 0);
  }
  
  /**
   * Perform health check on a specific instance
   * @param {Object} instance - The instance to check
   * @returns {Promise<boolean>} True if healthy, false otherwise
   */
  async checkInstanceHealth(instance) {
    try {
      console.log(`Health check for instance ${instance.id} (${instance.host})`);
      const url = `${this.httpProtocol}://${instance.host}/system_stats`;
      const response = await axios.get(url, {
        timeout: 300 // 300ms timeout
      });
      
      if (response.status === 200) {
        this.updateHealthCheck(instance.host, true);
        return true;
      }
    } catch (error) {
      console.error(`Health check failed for instance ${instance.id} (${instance.host}):`, error.message);
      this.updateHealthCheck(instance.host, false);
      
      // Mark unhealthy after 3 consecutive failures
      if (instance.consecutiveFailures >= 3) {
        this.markUnhealthy(instance.host);
      }
    }
    return false;
  }
  
  /**
   * Perform health checks on all instances
   * @returns {Promise<void>}
   */
  async performHealthChecks() {
    console.log('Performing health checks on all instances...');
    const checks = this.instances.map(instance => this.checkInstanceHealth(instance));
    await Promise.all(checks);
    console.log('Health checks complete. Status:', this.getInstancesStatus());
  }
  
  /**
   * Start periodic health checks
   * @param {number} intervalMs - Interval in milliseconds (default: 10000)
   */
  startHealthChecks(intervalMs = 10000) {
    console.log(`Starting health checks every ${intervalMs}ms`);
    
    // Perform initial health check
    this.performHealthChecks();
    
    // Set up periodic checks
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, intervalMs);
  }
  
  /**
   * Stop periodic health checks
   */
  stopHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log('Health checks stopped');
    }
  }
}

// Create singleton instance
let loadBalancerInstance = null;

/**
 * Get or create the load balancer instance
 * @returns {ComfyUILoadBalancer} The load balancer instance
 */
function getLoadBalancer() {
  if (!loadBalancerInstance) {
    loadBalancerInstance = new ComfyUILoadBalancer();
    // Start automatic health checks
    loadBalancerInstance.startHealthChecks();
  }
  return loadBalancerInstance;
}

module.exports = {
  ComfyUILoadBalancer,
  getLoadBalancer
};