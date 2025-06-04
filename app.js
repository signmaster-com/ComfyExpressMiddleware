const express = require('express');
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

// Instantiate Express app
const app = express();

// Configure multer for single file uploads to memory
const upload = multer({ 
  storage: multer.memoryStorage(), 
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Middleware
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