const InstanceHealthChecker = require('./healthChecker');

/**
 * Load balancer for multiple ComfyUI instances
 * Manages instance health and distributes jobs based on load
 */
class ComfyUILoadBalancer {
  constructor() {
    // Initialize instances from environment variables
    const host1 = process.env.COMFYUI_HOST_1 || '192.168.1.19:8188';
    const host2 = process.env.COMFYUI_HOST_2 || '192.168.1.19:8189';
    
    this.instances = new Map();
    
    // SSL configuration
    this.useSSL = process.env.COMFYUI_USE_SSL === 'true';
    this.protocol = this.useSSL ? 'https' : 'http';
    
    // Initialize health checker
    this.healthChecker = new InstanceHealthChecker();
    
    // Register instances
    const instances = [
      { id: 'instance-1', host: host1, protocol: this.protocol },
      { id: 'instance-2', host: host2, protocol: this.protocol }
    ];
    
    instances.forEach(instance => {
      this.instances.set(instance.id, {
        ...instance,
        activeJobs: 0
      });
      this.healthChecker.registerInstance(instance);
    });
    
    console.log('ComfyUI Load Balancer initialized with instances:', 
      Array.from(this.instances.values()).map(i => ({ id: i.id, host: i.host }))
    );
    
    this.initialHealthCheckComplete = false;
    
    // Start health checks automatically
    this.healthChecker.startHealthChecks(30000); // 30 seconds
  }
  
  /**
   * Get the least loaded healthy instance
   * @returns {Promise<Object|null>} The available instance or null if none available
   */
  async getAvailableInstance() {
    // If initial health check hasn't completed, do it now
    if (!this.initialHealthCheckComplete) {
      console.log('Performing initial health check before job assignment...');
      await this.healthChecker.performHealthChecks();
      this.initialHealthCheckComplete = true;
    }
    
    // Get healthy instances from health checker
    const healthyInstanceIds = this.healthChecker.getHealthyInstances().map(i => i.id);
    
    if (healthyInstanceIds.length === 0) {
      console.error('No healthy ComfyUI instances available');
      return null;
    }
    
    // Get full instance objects and sort by active jobs
    const healthyInstances = healthyInstanceIds
      .map(id => this.instances.get(id))
      .filter(Boolean)
      .sort((a, b) => a.activeJobs - b.activeJobs);
    
    const selectedInstance = healthyInstances[0];
    
    // Perform health check before job submission
    const isHealthy = await this.healthChecker.checkBeforeJob(selectedInstance.id);
    if (!isHealthy) {
      console.warn(`Instance ${selectedInstance.id} failed pre-job health check, retrying with next instance...`);
      // Remove this instance from the list and try again
      healthyInstances.shift();
      return healthyInstances.length > 0 ? healthyInstances[0] : null;
    }
    
    console.log(`Selected instance ${selectedInstance.id} (${selectedInstance.host}) with ${selectedInstance.activeJobs} active jobs`);
    return selectedInstance;
  }
  
  /**
   * Get instance by host
   * @param {string} host - The host string
   * @returns {Object|null} The instance or null if not found
   */
  getInstanceByHost(host) {
    for (const instance of this.instances.values()) {
      if (instance.host === host) {
        return instance;
      }
    }
    return null;
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
   * Mark an instance as unhealthy (called by comfyuiService on connection errors)
   * @param {string} host - The host string
   */
  markUnhealthy(host) {
    const instance = this.getInstanceByHost(host);
    if (instance) {
      this.healthChecker.markUnhealthy(instance.id);
    }
  }
  
  /**
   * Get all instances status
   * @returns {Array} Array of instance status objects
   */
  getInstancesStatus() {
    const healthStatus = this.healthChecker.getInstancesStatus();
    return healthStatus.map(status => {
      const instance = this.instances.get(status.id);
      return {
        ...status,
        activeJobs: instance ? instance.activeJobs : 0
      };
    });
  }
  
  /**
   * Check if any instance is available
   * @returns {boolean} True if at least one healthy instance exists
   */
  hasAvailableInstance() {
    return this.healthChecker.getHealthyInstances().length > 0;
  }
  
  /**
   * Get total active jobs across all instances
   * @returns {number} Total active jobs
   */
  getTotalActiveJobs() {
    let total = 0;
    for (const instance of this.instances.values()) {
      total += instance.activeJobs;
    }
    return total;
  }
  
  /**
   * Stop health checks (cleanup)
   */
  stopHealthChecks() {
    this.healthChecker.stopHealthChecks();
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
  }
  return loadBalancerInstance;
}

module.exports = {
  ComfyUILoadBalancer,
  getLoadBalancer
};