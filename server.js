const app = require('./app.js');
const dotenv = require('dotenv');
const { createServiceLogger } = require('./utils/logger.js');
const { getConnectionManager } = require('./services/connectionManager.js');
const { getJobManager } = require('./services/jobManager.js');
const { getJobProcessor } = require('./services/jobProcessor.js');
const { getMetrics } = require('./services/metrics.js');

// Load environment variables from .env file
dotenv.config();

// Create server logger
const serverLogger = createServiceLogger('server');

// Define the port
const PORT = process.env.PORT || 3000;

// Initialize connection manager, job manager, job processor, and metrics on startup
const connectionManager = getConnectionManager();
const jobManager = getJobManager();
const jobProcessor = getJobProcessor();
const metrics = getMetrics();

// Start the server - bind to all interfaces (0.0.0.0) for Docker
app.listen(PORT, '0.0.0.0', () => {
  serverLogger.info('Server started successfully', {
    port: PORT,
    comfyuiHost: process.env.COMFYUI_HOST || '192.168.1.19:8188',
    maxConnectionsPerInstance: process.env.MAX_CONNECTIONS_PER_INSTANCE || 3,
    jobTimeout: process.env.JOB_TIMEOUT || 300000,
    maxConcurrentJobs: process.env.MAX_CONCURRENT_JOBS || 4,
    maxJobsPerInstance: process.env.MAX_JOBS_PER_INSTANCE || 2,
    logLevel: process.env.LOG_LEVEL || 'info',
    outputFiles: process.env.OUTPUT_FILES === 'true'
  });
  
  // Start the job processor
  jobProcessor.start();
  
  // Log status every 60 seconds
  setInterval(() => {
    connectionManager.logStatus();
    jobManager.logStatus();
    jobProcessor.logStatus();
    metrics.logStatus();
  }, 60000);
});