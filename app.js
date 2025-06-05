const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { requestLoggerMiddleware } = require('./middleware/requestLogger.js');
const { logger } = require('./utils/logger.js');
const { handleRemoveBackground } = require('./routes/removeBackgroundHandler.js');
const { handleUpscaleImage } = require('./routes/upscaleImageHandler.js');
const { 
  getJobStatus, 
  getAllJobs, 
  getJobStats, 
  deleteJob, 
  cleanupExpiredJobs,
  getProcessorStats
} = require('./routes/jobStatusHandler.js');
const {
  handleRemoveBackgroundAsync,
  handleUpscaleImageAsync,
  getJobStatus: getAsyncJobStatus,
  getJobResult
} = require('./routes/asyncJobHandler.js');
const {
  getSystemMetrics,
  getPerformanceMetrics,
  getErrorMetrics,
  getInstanceMetrics,
  forceSaveMetrics,
  getMetricsPersistenceStatus
} = require('./routes/metricsHandler.js');
const {
  getSystemHealth,
  getBasicMetrics,
  getQuickStatus
} = require('./routes/statusHandler.js');
const {
  getCircuitBreakerStatus,
  forceCloseBreaker,
  forceOpenBreaker
} = require('./routes/circuitBreakerHandler.js');

// Instantiate Express app
const app = express();

// Configure multer for single file uploads to memory
const upload = multer({ 
  storage: multer.memoryStorage(), 
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://signmaster.com',
      'http://signdroid.signmaster.local',
      'http://signdroid.smdev.local'
    ];
    
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID']
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(requestLoggerMiddleware);

// Routes - Processing endpoints (with backward compatibility)
app.post('/api/remove-background', upload.single('imageFile'), handleRemoveBackground);
app.post('/api/upscale-image', upload.single('imageFile'), handleUpscaleImage);

// Async-specific routes (dedicated async endpoints)
app.post('/api/async/remove-background', upload.single('imageFile'), handleRemoveBackgroundAsync);
app.post('/api/async/upscale-image', upload.single('imageFile'), handleUpscaleImageAsync);

// Job status and result endpoints (async API)
app.get('/api/jobs/:job_id/status', getAsyncJobStatus);
app.get('/api/jobs/:job_id/result', getJobResult);

// Job management routes (admin API)
app.get('/api/jobs/stats', getJobStats);
app.get('/api/jobs/processor/stats', getProcessorStats);
app.get('/api/jobs/list', getAllJobs);
app.get('/api/jobs/:jobId/info', getJobStatus);
app.delete('/api/jobs/:jobId', deleteJob);
app.post('/api/jobs/cleanup', cleanupExpiredJobs);

// Health and Status routes
app.get('/health', getSystemHealth);
app.get('/status', getQuickStatus);
app.get('/status/metrics', getBasicMetrics);

// Detailed Metrics routes
app.get('/api/metrics', getSystemMetrics);
app.get('/api/metrics/performance', getPerformanceMetrics);
app.get('/api/metrics/errors', getErrorMetrics);
app.get('/api/metrics/instances', getInstanceMetrics);
app.get('/api/metrics/instances/:instance', getInstanceMetrics);
app.post('/api/metrics/save', forceSaveMetrics);
app.get('/api/metrics/persistence', getMetricsPersistenceStatus);

// Circuit Breaker routes
app.get('/api/circuit-breakers', getCircuitBreakerStatus);
app.post('/api/circuit-breakers/:name/close', forceCloseBreaker);
app.post('/api/circuit-breakers/:name/open', forceOpenBreaker);

// Enhanced global error handler with structured logging
app.use((err, req, res, next) => {
  const requestLogger = req.logger || logger;
  
  requestLogger.error('Unhandled error in request processing', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    headers: req.headers,
    body: req.method !== 'GET' && req.body ? req.body : undefined
  });
  
  if (!res.headersSent) {
    res.status(500).json({ 
      error: 'Internal server error',
      requestId: req.requestId || 'unknown'
    });
  }
});

module.exports = app;