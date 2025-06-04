const { circuitBreakerFactory } = require('../services/circuitBreaker');
const { createRequestLogger } = require('../utils/logger');

/**
 * Get status of all circuit breakers
 */
async function getCircuitBreakerStatus(req, res) {
  const logger = req.logger || createRequestLogger(req.requestId, req.method, req.url);
  
  try {
    logger.debug('Fetching circuit breaker status');
    
    const status = circuitBreakerFactory.getAllStatus();
    
    // Transform status for response
    const response = {
      timestamp: new Date().toISOString(),
      breakers: {}
    };
    
    for (const [name, breakerStatus] of Object.entries(status)) {
      response.breakers[name] = {
        state: breakerStatus.state,
        failures: breakerStatus.failures,
        successes: breakerStatus.successes,
        metrics: breakerStatus.metrics,
        nextAttempt: breakerStatus.nextAttempt ? new Date(breakerStatus.nextAttempt).toISOString() : null,
        resetTimeout: breakerStatus.currentResetTimeout
      };
    }
    
    res.json(response);
  } catch (error) {
    logger.error('Failed to get circuit breaker status', {
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      error: 'Failed to retrieve circuit breaker status',
      message: error.message
    });
  }
}

/**
 * Force close a specific circuit breaker (admin action)
 */
async function forceCloseBreaker(req, res) {
  const logger = req.logger || createRequestLogger(req.requestId, req.method, req.url);
  const { name } = req.params;
  
  try {
    logger.info('Force closing circuit breaker', { name });
    
    const breaker = circuitBreakerFactory.breakers.get(name);
    if (!breaker) {
      return res.status(404).json({
        error: 'Circuit breaker not found',
        name: name
      });
    }
    
    breaker.forceClose();
    
    res.json({
      message: 'Circuit breaker closed successfully',
      name: name,
      newStatus: breaker.getStatus()
    });
  } catch (error) {
    logger.error('Failed to close circuit breaker', {
      name,
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      error: 'Failed to close circuit breaker',
      message: error.message
    });
  }
}

/**
 * Force open a specific circuit breaker (admin action)
 */
async function forceOpenBreaker(req, res) {
  const logger = req.logger || createRequestLogger(req.requestId, req.method, req.url);
  const { name } = req.params;
  
  try {
    logger.info('Force opening circuit breaker', { name });
    
    const breaker = circuitBreakerFactory.breakers.get(name);
    if (!breaker) {
      return res.status(404).json({
        error: 'Circuit breaker not found',
        name: name
      });
    }
    
    breaker.forceOpen();
    
    res.json({
      message: 'Circuit breaker opened successfully',
      name: name,
      newStatus: breaker.getStatus()
    });
  } catch (error) {
    logger.error('Failed to open circuit breaker', {
      name,
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      error: 'Failed to open circuit breaker',
      message: error.message
    });
  }
}

module.exports = {
  getCircuitBreakerStatus,
  forceCloseBreaker,
  forceOpenBreaker
};