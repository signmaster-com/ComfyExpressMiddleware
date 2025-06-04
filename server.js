const app = require('./app.js');
const dotenv = require('dotenv');
const { getConnectionManager } = require('./services/connectionManager.js');

// Load environment variables from .env file
dotenv.config();

// Define the port
const PORT = process.env.PORT || 3000;

// Initialize connection manager on startup
const connectionManager = getConnectionManager();

// Start the server
app.listen(PORT, () => {
  console.log(`Middleware API server running on port ${PORT}`);
  console.log(`ComfyUI should be accessible at: ${process.env.COMFYUI_HOST || '192.168.1.19:8188'}`);
  console.log(`WebSocket Connection Pooling: Max ${process.env.MAX_CONNECTIONS_PER_INSTANCE || 3} connections per instance`);
  
  // Log connection manager status every 60 seconds
  setInterval(() => {
    connectionManager.logStatus();
  }, 60000);
});