const axios = require('axios');
const { circuitBreakerFactory } = require('./circuitBreaker');

class InstanceHealthChecker {
    constructor() {
        this.instances = new Map();
        this.healthCheckInterval = null;
        this.healthCheckIntervalMs = 30000; // 30 seconds
        this.maxConsecutiveFailures = 3;
        this.healthCheckTimeout = 5000; // 5 second timeout for health checks
        this.circuitBreakers = new Map(); // Circuit breakers per instance
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
            consecutiveFailures: 0
        });
        
        // Create circuit breaker for this instance
        const breaker = circuitBreakerFactory.getBreaker(`health-check-${instance.id}`, {
            failureThreshold: 3,
            successThreshold: 2,
            timeout: this.healthCheckTimeout,
            resetTimeout: 30000, // Start with 30s
            maxResetTimeout: 300000, // Max 5 minutes
            volumeThreshold: 5,
            errorThresholdPercentage: 60
        });
        
        this.circuitBreakers.set(instance.id, breaker);
        console.log(`HealthChecker: Registered instance ${instance.id} (${instance.host}) with circuit breaker`);
    }

    /**
     * Unregister an instance from health monitoring
     * @param {string} instanceId - Instance ID to remove
     */
    unregisterInstance(instanceId) {
        this.instances.delete(instanceId);
        
        // Clean up circuit breaker
        const breaker = this.circuitBreakers.get(instanceId);
        if (breaker) {
            breaker.destroy();
            this.circuitBreakers.delete(instanceId);
        }
        
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

        const breaker = this.circuitBreakers.get(instanceId);
        if (!breaker) {
            console.error(`HealthChecker: Circuit breaker not found for ${instanceId}`);
            return false;
        }

        const url = `${instance.protocol}://${instance.host}/system_stats`;
        const startTime = Date.now();

        try {
            // Use circuit breaker to execute health check
            await breaker.execute(async () => {
                const response = await axios.get(url, { 
                    timeout: this.healthCheckTimeout,
                    validateStatus: (status) => status === 200
                });
                return response;
            }, { 
                operation: 'health-check',
                instance: instance.host 
            });

            // Health check succeeded
            const wasUnhealthy = !instance.healthy;
            instance.healthy = true;
            instance.lastHealthCheck = Date.now();

            if (wasUnhealthy) {
                console.log(`HealthChecker: Instance ${instance.id} is now HEALTHY (response time: ${Date.now() - startTime}ms)`);
            }

            return true;
        } catch (error) {
            // Health check failed
            instance.lastHealthCheck = Date.now();

            // Check if it's a circuit breaker rejection
            if (error.code === 'CIRCUIT_BREAKER_OPEN') {
                // Circuit is open, mark as unhealthy without additional logging
                instance.healthy = false;
                return false;
            }

            // Actual health check failure
            const errorMessage = error.code || error.message || 'Unknown error';
            console.error(`HealthChecker: Health check failed for ${instance.id}: ${errorMessage}`);
            
            // Mark instance as unhealthy
            instance.healthy = false;

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
            const breaker = this.circuitBreakers.get(instance.id);
            const breakerStatus = breaker ? breaker.getStatus() : null;
            
            status.push({
                id: instance.id,
                host: instance.host,
                healthy: instance.healthy,
                lastHealthCheck: instance.lastHealthCheck,
                circuitBreaker: breakerStatus ? {
                    state: breakerStatus.state,
                    failures: breakerStatus.failures,
                    nextAttempt: breakerStatus.nextAttempt,
                    errorRate: breakerStatus.metrics.errorRate
                } : null
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
        const breaker = this.circuitBreakers.get(instanceId);
        
        if (instance) {
            const wasHealthy = instance.healthy;
            instance.healthy = false;
            instance.lastHealthCheck = Date.now();
            
            // Force open the circuit breaker
            if (breaker) {
                breaker.forceOpen();
            }
            
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
        
        // Clean up all circuit breakers
        for (const breaker of this.circuitBreakers.values()) {
            breaker.destroy();
        }
        this.circuitBreakers.clear();
    }

    /**
     * Check health before job submission with real-time verification
     * @param {string} instanceId - Instance ID to check
     * @returns {Promise<boolean>} - Whether instance is healthy
     */
    async checkBeforeJob(instanceId) {
        const instance = this.instances.get(instanceId);
        if (!instance) {
            return false;
        }

        // If instance is healthy and was checked very recently (within 2 seconds), trust the cached status
        if (instance.healthy && instance.lastHealthCheck && (Date.now() - instance.lastHealthCheck) < 2000) {
            return true;
        }

        // Otherwise, perform a fresh health check with faster timeout for job submission
        return await this.checkInstanceHealthForJob(instanceId);
    }

    /**
     * Fast health check specifically for job submission
     * @param {string} instanceId - Instance ID to check
     * @returns {Promise<boolean>} - Whether instance is healthy
     */
    async checkInstanceHealthForJob(instanceId) {
        const instance = this.instances.get(instanceId);
        if (!instance) {
            console.error(`HealthChecker: Instance ${instanceId} not found for job health check`);
            return false;
        }

        const breaker = this.circuitBreakers.get(instanceId);
        if (!breaker) {
            console.error(`HealthChecker: Circuit breaker not found for ${instanceId}`);
            return false;
        }

        const url = `${instance.protocol}://${instance.host}/system_stats`;
        const startTime = Date.now();

        try {
            console.log(`🏥 Pre-job health check for ${instance.host}...`);
            
            // Use circuit breaker with faster timeout for job submission
            await breaker.execute(async () => {
                const response = await axios.get(url, { 
                    timeout: 2000, // Faster 2-second timeout for job submission
                    validateStatus: (status) => status === 200
                });
                return response;
            }, { 
                operation: 'pre-job-health-check',
                instance: instance.host 
            });

            // Health check succeeded
            const responseTime = Date.now() - startTime;
            instance.healthy = true;
            instance.lastHealthCheck = Date.now();

            console.log(`✅ Pre-job health check passed for ${instance.host} (${responseTime}ms)`);
            return true;

        } catch (error) {
            // Health check failed
            instance.lastHealthCheck = Date.now();
            
            // Check if it's a circuit breaker rejection
            if (error.code === 'CIRCUIT_BREAKER_OPEN') {
                console.warn(`⚡ Circuit breaker open for ${instance.host} - failing fast`);
                instance.healthy = false;
                return false;
            }

            // Actual health check failure
            const errorMessage = error.code || error.message || 'Unknown error';
            console.warn(`❌ Pre-job health check failed for ${instance.host}: ${errorMessage}`);
            
            // Mark instance as unhealthy
            instance.healthy = false;
            return false;
        }
    }
}

module.exports = InstanceHealthChecker;