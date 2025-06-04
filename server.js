const app = require('./app.js');
const dotenv = require('dotenv');
const { getConnectionManager } = require('./services/connectionManager.js');
const { getJobManager } = require('./services/jobManager.js');
const { getJobProcessor } = require('./services/jobProcessor.js');
const { getMetrics } = require('./services/metrics.js');

// Load environment variables from .env file
dotenv.config();

// Define the port
const PORT = process.env.PORT || 3000;

// Initialize connection manager, job manager, job processor, and metrics on startup
const connectionManager = getConnectionManager();
const jobManager = getJobManager();
const jobProcessor = getJobProcessor();
const metrics = getMetrics();

// Start the server
app.listen(PORT, () => {
  console.log(`Middleware API server running on port ${PORT}`);
  console.log(`ComfyUI should be accessible at: ${process.env.COMFYUI_HOST || '192.168.1.19:8188'}`);
  console.log(`WebSocket Connection Pooling: Max ${process.env.MAX_CONNECTIONS_PER_INSTANCE || 3} connections per instance`);
  console.log(`Job Management: Timeout ${process.env.JOB_TIMEOUT || 300000}ms (${(process.env.JOB_TIMEOUT || 300000) / 1000}s)`);
  console.log(`Job Processing: Max ${process.env.MAX_CONCURRENT_JOBS || 4} concurrent jobs, ${process.env.MAX_JOBS_PER_INSTANCE || 2} per instance`);
  
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