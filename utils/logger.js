const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure data/logs directory exists
const logsDir = path.join(process.cwd(), 'data', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log format with structured JSON
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, service, requestId, duration, stack, ...meta }) => {
    const logEntry = {
      timestamp,
      level,
      service: service || 'comfyui-middleware',
      message,
      ...(requestId && { requestId }),
      ...(duration && { duration }),
      ...(stack && { stack }),
      ...meta
    };
    return JSON.stringify(logEntry);
  })
);

// Console format for development (more readable)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, service, requestId, duration, stack, ...meta }) => {
    const serviceName = service || 'comfyui-middleware';
    const reqId = requestId ? `[${requestId.slice(0, 8)}]` : '';
    const dur = duration ? `(${duration}ms)` : '';
    const metaStr = Object.keys(meta).length > 0 ? `\n${JSON.stringify(meta, null, 2)}` : '';
    const stackStr = stack ? `\n${stack}` : '';
    
    return `${timestamp} [${serviceName}] ${level}: ${reqId} ${message} ${dur}${metaStr}${stackStr}`;
  })
);

// Get log level from environment or default to 'info'
const logLevel = process.env.LOG_LEVEL || 'info';

// Create the logger
const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  defaultMeta: { service: 'comfyui-middleware' },
  transports: [
    // Write all logs with level `error` and below to `error.log`
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      tailable: true
    }),
    
    // Write all logs to `combined.log`
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      tailable: true
    })
  ],
});

// Add console transport for non-production environments
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat
  }));
}

// Helper functions for common logging patterns
const createChildLogger = (context) => {
  return {
    error: (message, meta = {}) => logger.error(message, { ...context, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { ...context, ...meta }),
    info: (message, meta = {}) => logger.info(message, { ...context, ...meta }),
    debug: (message, meta = {}) => logger.debug(message, { ...context, ...meta }),
  };
};

// Job-specific logger
const createJobLogger = (jobId, jobType, instance) => {
  return createChildLogger({
    component: 'job-processor',
    jobId,
    jobType,
    instance
  });
};

// Service-specific logger
const createServiceLogger = (serviceName) => {
  return createChildLogger({
    component: serviceName
  });
};

// Request-specific logger
const createRequestLogger = (requestId, method, url) => {
  return createChildLogger({
    component: 'http-request',
    requestId,
    method,
    url
  });
};

module.exports = {
  logger,
  createChildLogger,
  createJobLogger,
  createServiceLogger,
  createRequestLogger
};