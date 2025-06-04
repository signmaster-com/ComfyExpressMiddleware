const axios = require('axios');

class InstanceHealthChecker {
    constructor() {
        this.instances = new Map();
        this.healthCheckInterval = null;
        this.healthCheckIntervalMs = 30000; // 30 seconds
        this.maxConsecutiveFailures = 3;
        this.healthCheckTimeout = 300; // 300ms timeout
    }

    /**
     * Register an instance for health monitoring
     * @param {Object} instance - Instance object with id, host, and protocol
     */
    registerInstance(instance) {
        this.instances.set(instance.id, {
            ...instance,
            healthy: false,
            lastHealthCheck: null,
            consecutiveFailures: 0,
            circuitBreakerOpen: false
        });
        console.log(`HealthChecker: Registered instance ${instance.id} (${instance.host})`);
    }

    /**
     * Unregister an instance from health monitoring
     * @param {string} instanceId - Instance ID to remove
     */
    unregisterInstance(instanceId) {
        this.instances.delete(instanceId);
        console.log(`HealthChecker: Unregistered instance ${instanceId}`);
    }

    /**
     * Check health of a specific instance
     * @param {string} instanceId - Instance ID to check
     * @returns {Promise<boolean>} - Health status
     */
    async checkInstanceHealth(instanceId) {
        const instance = this.instances.get(instanceId);
        if (!instance) {
            console.error(`HealthChecker: Instance ${instanceId} not found`);
            return false;
        }

        // Circuit breaker logic - fail fast if instance is known to be unhealthy
        if (instance.circuitBreakerOpen) {
            const timeSinceLastCheck = Date.now() - (instance.lastHealthCheck || 0);
            // Try to check after 10 seconds if circuit breaker is open
            if (timeSinceLastCheck < 10000) {
                return false;
            }
        }

        const url = `${instance.protocol}://${instance.host}/system_stats`;
        const startTime = Date.now();

        try {
            const response = await axios.get(url, { 
                timeout: this.healthCheckTimeout,
                validateStatus: (status) => status === 200
            });

            // Health check succeeded
            const wasUnhealthy = !instance.healthy || instance.consecutiveFailures > 0;
            instance.healthy = true;
            instance.consecutiveFailures = 0;
            instance.lastHealthCheck = Date.now();
            instance.circuitBreakerOpen = false;

            if (wasUnhealthy) {
                console.log(`HealthChecker: Instance ${instance.id} is now HEALTHY (response time: ${Date.now() - startTime}ms)`);
            }

            return true;
        } catch (error) {
            // Health check failed
            instance.consecutiveFailures++;
            instance.lastHealthCheck = Date.now();

            if (instance.consecutiveFailures >= this.maxConsecutiveFailures) {
                if (instance.healthy) {
                    console.error(`HealthChecker: Instance ${instance.id} is now UNHEALTHY after ${instance.consecutiveFailures} failures`);
                }
                instance.healthy = false;
                instance.circuitBreakerOpen = true;
            }

            const errorMessage = error.code || error.message || 'Unknown error';
            console.error(`HealthChecker: Health check failed for ${instance.id}: ${errorMessage} (attempt ${instance.consecutiveFailures}/${this.maxConsecutiveFailures})`);

            return false;
        }
    }

    /**
     * Perform health checks on all registered instances
     * @returns {Promise<Map>} - Map of instance IDs to health status
     */
    async performHealthChecks() {
        const results = new Map();
        const promises = [];

        for (const [instanceId, instance] of this.instances) {
            promises.push(
                this.checkInstanceHealth(instanceId)
                    .then(healthy => results.set(instanceId, healthy))
            );
        }

        await Promise.allSettled(promises);
        return results;
    }

    /**
     * Get health status of a specific instance
     * @param {string} instanceId - Instance ID
     * @returns {boolean} - Health status
     */
    isHealthy(instanceId) {
        const instance = this.instances.get(instanceId);
        return instance ? instance.healthy : false;
    }

    /**
     * Get all healthy instances
     * @returns {Array} - Array of healthy instance objects
     */
    getHealthyInstances() {
        const healthy = [];
        for (const instance of this.instances.values()) {
            if (instance.healthy) {
                healthy.push({
                    id: instance.id,
                    host: instance.host,
                    protocol: instance.protocol
                });
            }
        }
        return healthy;
    }

    /**
     * Get status of all instances
     * @returns {Array} - Array of instance status objects
     */
    getInstancesStatus() {
        const status = [];
        for (const instance of this.instances.values()) {
            status.push({
                id: instance.id,
                host: instance.host,
                healthy: instance.healthy,
                lastHealthCheck: instance.lastHealthCheck,
                consecutiveFailures: instance.consecutiveFailures,
                circuitBreakerOpen: instance.circuitBreakerOpen
            });
        }
        return status;
    }

    /**
     * Mark an instance as unhealthy (e.g., after connection error during job execution)
     * @param {string} instanceId - Instance ID to mark as unhealthy
     */
    markUnhealthy(instanceId) {
        const instance = this.instances.get(instanceId);
        if (instance) {
            const wasHealthy = instance.healthy;
            instance.healthy = false;
            instance.consecutiveFailures = this.maxConsecutiveFailures;
            instance.circuitBreakerOpen = true;
            instance.lastHealthCheck = Date.now();
            
            if (wasHealthy) {
                console.error(`HealthChecker: Instance ${instanceId} marked as UNHEALTHY due to connection error`);
            }
        }
    }

    /**
     * Start periodic health checks
     * @param {number} intervalMs - Interval in milliseconds (default: 30000)
     */
    startHealthChecks(intervalMs = this.healthCheckIntervalMs) {
        if (this.healthCheckInterval) {
            console.log('HealthChecker: Health checks already running');
            return;
        }

        this.healthCheckIntervalMs = intervalMs;
        console.log(`HealthChecker: Starting health checks every ${intervalMs / 1000} seconds`);

        // Perform initial health check
        this.performHealthChecks();

        // Schedule periodic health checks
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
            console.log('HealthChecker: Stopped health checks');
        }
    }

    /**
     * Check health before job submission
     * @param {string} instanceId - Instance ID to check
     * @returns {Promise<boolean>} - Whether instance is healthy
     */
    async checkBeforeJob(instanceId) {
        const instance = this.instances.get(instanceId);
        if (!instance) {
            return false;
        }

        // If instance is healthy and was checked recently (within 5 seconds), trust the cached status
        if (instance.healthy && instance.lastHealthCheck && (Date.now() - instance.lastHealthCheck) < 5000) {
            return true;
        }

        // Otherwise, perform a fresh health check
        return await this.checkInstanceHealth(instanceId);
    }
}

module.exports = InstanceHealthChecker;