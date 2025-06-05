const EventEmitter = require('events');
const { createServiceLogger } = require('../utils/logger');

/**
 * Circuit Breaker States
 */
const STATES = {
  CLOSED: 'CLOSED',      // Normal operation
  OPEN: 'OPEN',          // Failing, reject all requests
  HALF_OPEN: 'HALF_OPEN' // Testing if service recovered
};

/**
 * Production-ready Circuit Breaker with exponential backoff
 * Prevents cascading failures by failing fast when a service is down
 */
class CircuitBreaker extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // Set max listeners to prevent memory leak warnings
    this.setMaxListeners(20);
    
    // Configuration optimized for ComfyUI GPU services
    this.name = options.name || 'CircuitBreaker';
    this.failureThreshold = options.failureThreshold || 3;        // Open after 3 failures (faster detection)
    this.successThreshold = options.successThreshold || 2;        // Close after 2 successes in half-open
    this.timeout = options.timeout || 30000;                      // 30 second timeout
    this.resetTimeout = options.resetTimeout || 15000;            // Initial reset timeout (15 seconds for GPU services)
    this.maxResetTimeout = options.maxResetTimeout || 120000;     // Max reset timeout (2 minutes, down from 5)
    this.volumeThreshold = options.volumeThreshold || 10;         // Min requests before opening
    this.errorThresholdPercentage = options.errorThresholdPercentage || 50; // Open if 50% errors
    
    // State
    this.state = STATES.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.nextAttempt = Date.now();
    this.currentResetTimeout = this.resetTimeout;
    
    // Metrics for volume-based decisions
    this.requests = [];
    this.windowSize = options.windowSize || 60000; // 1 minute rolling window
    
    // Logger
    this.logger = createServiceLogger(`circuit-breaker-${this.name}`);
    
    // Timer for half-open transition
    this.resetTimer = null;
    
    this.logger.info('Circuit breaker initialized', {
      name: this.name,
      failureThreshold: this.failureThreshold,
      successThreshold: this.successThreshold,
      timeout: this.timeout,
      resetTimeout: this.resetTimeout
    });
  }

  /**
   * Execute a function with circuit breaker protection
   * @param {Function} fn - Async function to execute
   * @param {Object} context - Context for error identification
   * @returns {Promise} Result of the function
   */
  async execute(fn, context = {}) {
    // Check if we should attempt the request
    if (!this.canRequest()) {
      const error = new Error(`Circuit breaker is ${this.state} for ${this.name}`);
      error.code = 'CIRCUIT_BREAKER_OPEN';
      error.state = this.state;
      error.nextAttempt = this.nextAttempt;
      throw error;
    }
    
    // Record request attempt
    this.recordRequest();
    
    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(fn);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error, context);
      throw error;
    }
  }

  /**
   * Check if a request can be made
   * @returns {boolean} Whether request is allowed
   */
  canRequest() {
    if (this.state === STATES.CLOSED) {
      return true;
    }
    
    if (this.state === STATES.OPEN) {
      // Check if we should transition to half-open
      if (Date.now() >= this.nextAttempt) {
        this.logger.info('Transitioning to HALF_OPEN state', {
          name: this.name,
          previousFailures: this.failures
        });
        this.state = STATES.HALF_OPEN;
        return true;
      }
      return false;
    }
    
    // HALF_OPEN state - allow request
    return true;
  }

  /**
   * Execute function with timeout
   * @param {Function} fn - Function to execute
   * @returns {Promise} Result or timeout error
   */
  async executeWithTimeout(fn) {
    return new Promise(async (resolve, reject) => {
      let timeoutId;
      let completed = false;
      
      // Set timeout
      timeoutId = setTimeout(() => {
        if (!completed) {
          completed = true;
          const error = new Error(`Circuit breaker timeout after ${this.timeout}ms`);
          error.code = 'CIRCUIT_BREAKER_TIMEOUT';
          reject(error);
        }
      }, this.timeout);
      
      try {
        const result = await fn();
        if (!completed) {
          completed = true;
          clearTimeout(timeoutId);
          resolve(result);
        }
      } catch (error) {
        if (!completed) {
          completed = true;
          clearTimeout(timeoutId);
          reject(error);
        }
      }
    });
  }

  /**
   * Handle successful request
   */
  onSuccess() {
    this.failures = 0;
    
    if (this.state === STATES.HALF_OPEN) {
      this.successes++;
      
      if (this.successes >= this.successThreshold) {
        this.logger.info('Circuit breaker closing after successful recovery', {
          name: this.name,
          successes: this.successes
        });
        this.close();
      }
    } else if (this.state === STATES.CLOSED) {
      // Reset exponential backoff on success
      this.currentResetTimeout = this.resetTimeout;
    }
    
    this.emit('success', { state: this.state });
  }

  /**
   * Handle failed request
   * @param {Error} error - The error that occurred
   * @param {Object} context - Additional context
   */
  onFailure(error, context = {}) {
    this.failures++;
    
    // Mark last request as error
    if (this._lastRequest) {
      this._lastRequest.error = true;
      this._lastRequest = null; // Clear reference
    }
    
    // Log the failure with context
    this.logger.warn('Request failed', {
      name: this.name,
      state: this.state,
      failures: this.failures,
      error: error.message,
      code: error.code,
      context
    });
    
    if (this.state === STATES.HALF_OPEN) {
      this.logger.error('Circuit breaker opening due to failure in HALF_OPEN state', {
        name: this.name,
        error: error.message
      });
      this.open();
    } else if (this.state === STATES.CLOSED) {
      // Check if we should open based on volume
      const shouldOpen = this.shouldOpenBasedOnVolume();
      
      if (shouldOpen || this.failures >= this.failureThreshold) {
        this.logger.error('Circuit breaker opening due to failures', {
          name: this.name,
          failures: this.failures,
          threshold: this.failureThreshold,
          volumeBased: shouldOpen
        });
        this.open();
      }
    }
    
    this.emit('failure', { state: this.state, error });
  }

  /**
   * Check if circuit should open based on error volume
   * @returns {boolean} Whether to open
   */
  shouldOpenBasedOnVolume() {
    const now = Date.now();
    const windowStart = now - this.windowSize;
    
    // Filter requests within window
    this.requests = this.requests.filter(req => req.timestamp > windowStart);
    
    if (this.requests.length < this.volumeThreshold) {
      return false; // Not enough volume
    }
    
    const errors = this.requests.filter(req => req.error).length;
    const errorPercentage = (errors / this.requests.length) * 100;
    
    return errorPercentage >= this.errorThresholdPercentage;
  }

  /**
   * Record a request for volume tracking
   */
  recordRequest() {
    const request = {
      timestamp: Date.now(),
      error: false
    };
    this.requests.push(request);
    
    // Store reference to this request for failure marking
    this._lastRequest = request;
  }

  /**
   * Open the circuit breaker
   */
  open() {
    this.state = STATES.OPEN;
    this.successes = 0;
    
    // Apply modest exponential backoff optimized for GPU services
    this.nextAttempt = Date.now() + this.currentResetTimeout;
    
    // Clear any existing timer
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
    
    // Schedule transition to half-open
    this.resetTimer = setTimeout(() => {
      this.state = STATES.HALF_OPEN;
      this.logger.info('Circuit breaker automatically transitioning to HALF_OPEN', {
        name: this.name
      });
    }, this.currentResetTimeout);
    
    // Increase timeout for next failure (moderate backoff: 1.5x instead of 2x)
    this.currentResetTimeout = Math.min(
      Math.ceil(this.currentResetTimeout * 1.5),
      this.maxResetTimeout
    );
    
    this.emit('open', { nextAttempt: this.nextAttempt });
  }

  /**
   * Close the circuit breaker
   */
  close() {
    this.state = STATES.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.currentResetTimeout = this.resetTimeout; // Reset backoff
    
    // Clear reset timer
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
    
    this.emit('close');
  }

  /**
   * Force close the circuit breaker (admin action)
   */
  forceClose() {
    this.logger.info('Force closing circuit breaker', { name: this.name });
    this.close();
  }

  /**
   * Force open the circuit breaker (admin action)
   */
  forceOpen() {
    this.logger.info('Force opening circuit breaker', { name: this.name });
    this.open();
  }

  /**
   * Get current status
   * @returns {Object} Status information
   */
  getStatus() {
    const now = Date.now();
    const recentRequests = this.requests.filter(
      req => req.timestamp > now - this.windowSize
    );
    const recentErrors = recentRequests.filter(req => req.error).length;
    
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      nextAttempt: this.state === STATES.OPEN ? this.nextAttempt : null,
      currentResetTimeout: this.currentResetTimeout,
      metrics: {
        totalRequests: recentRequests.length,
        errorCount: recentErrors,
        errorRate: recentRequests.length > 0 
          ? ((recentErrors / recentRequests.length) * 100).toFixed(2) + '%'
          : '0%'
      }
    };
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
    
    // Remove factory listeners first if they exist
    if (this._factoryListeners) {
      this.removeListener('open', this._factoryListeners.openListener);
      this.removeListener('close', this._factoryListeners.closeListener);
      delete this._factoryListeners;
    }
    
    // Clear last request reference
    this._lastRequest = null;
    
    this.removeAllListeners();
  }
}

/**
 * Circuit Breaker Factory for managing multiple breakers
 */
class CircuitBreakerFactory {
  constructor() {
    this.breakers = new Map();
    this.logger = createServiceLogger('circuit-breaker-factory');
  }

  /**
   * Get or create a circuit breaker
   * @param {string} name - Breaker name
   * @param {Object} options - Breaker options
   * @returns {CircuitBreaker} Circuit breaker instance
   */
  getBreaker(name, options = {}) {
    if (!this.breakers.has(name)) {
      const breaker = new CircuitBreaker({ name, ...options });
      this.breakers.set(name, breaker);
      
      // Store listener references for cleanup
      const openListener = () => {
        this.logger.error(`Circuit breaker ${name} opened`);
      };
      
      const closeListener = () => {
        this.logger.info(`Circuit breaker ${name} closed`);
      };
      
      breaker.on('open', openListener);
      breaker.on('close', closeListener);
      
      // Store listeners for cleanup
      breaker._factoryListeners = { openListener, closeListener };
    }
    
    return this.breakers.get(name);
  }

  /**
   * Get all breakers status
   * @returns {Object} Status of all breakers
   */
  getAllStatus() {
    const status = {};
    for (const [name, breaker] of this.breakers) {
      status[name] = breaker.getStatus();
    }
    return status;
  }

  /**
   * Clean up all breakers
   */
  destroyAll() {
    for (const breaker of this.breakers.values()) {
      breaker.destroy();
    }
    this.breakers.clear();
  }
}

// Singleton factory instance
const factory = new CircuitBreakerFactory();

module.exports = {
  CircuitBreaker,
  CircuitBreakerFactory,
  circuitBreakerFactory: factory,
  STATES
};