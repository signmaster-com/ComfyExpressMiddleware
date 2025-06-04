const { v4: uuidv4 } = require('uuid');
const { createRequestLogger } = require('../utils/logger');

/**
 * Express middleware for structured request logging
 * Tracks request duration, adds request ID, and logs request/response details
 */
function requestLoggerMiddleware(req, res, next) {
  // Generate unique request ID
  const requestId = uuidv4();
  req.requestId = requestId;
  
  // Add request ID to response headers for tracing
  res.setHeader('X-Request-ID', requestId);
  
  // Record start time
  const startTime = Date.now();
  
  // Create request-specific logger
  const reqLogger = createRequestLogger(requestId, req.method, req.url);
  
  // Extract relevant request information
  const requestInfo = {
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    contentLength: req.get('Content-Length'),
    contentType: req.get('Content-Type'),
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    body: req.method !== 'GET' && req.body && !req.file ? 
      (typeof req.body === 'object' ? Object.keys(req.body) : 'present') : undefined
  };
  
  // Log incoming request
  reqLogger.info('Incoming request', requestInfo);
  
  // Capture the original end function
  const originalEnd = res.end;
  
  // Override res.end to log response
  res.end = function(chunk, encoding) {
    // Calculate duration
    const duration = Date.now() - startTime;
    
    // Extract response information
    const responseInfo = {
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
      contentLength: res.get('Content-Length'),
      contentType: res.get('Content-Type'),
      duration
    };
    
    // Determine log level based on status code
    let logLevel = 'info';
    if (res.statusCode >= 500) {
      logLevel = 'error';
    } else if (res.statusCode >= 400) {
      logLevel = 'warn';
    }
    
    // Log response
    reqLogger[logLevel]('Request completed', responseInfo);
    
    // Call the original end function
    originalEnd.call(this, chunk, encoding);
  };
  
  // Handle errors during request processing
  res.on('error', (error) => {
    const duration = Date.now() - startTime;
    reqLogger.error('Request error', {
      error: error.message,
      stack: error.stack,
      duration
    });
  });
  
  // Add logger to request object for use in routes
  req.logger = reqLogger;
  
  next();
}

module.exports = {
  requestLoggerMiddleware
};