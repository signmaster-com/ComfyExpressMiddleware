const express = require('express');
const multer = require('multer');
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

// Instantiate Express app
const app = express();

// Configure multer for single file uploads to memory
const upload = multer({ 
  storage: multer.memoryStorage(), 
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Middleware
app.use(express.json());

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

// Basic global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err.stack);
  if (!res.headersSent) {
    res.status(500).send({ error: 'Something went wrong!' });
  }
});

module.exports = app;