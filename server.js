const app = require('./app.js');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

// Define the port
const PORT = process.env.PORT || 3000;

// Start the server
app.listen(PORT, () => {
  console.log(`Middleware API server running on port ${PORT}`);
  console.log(`ComfyUI should be accessible at: ${process.env.COMFYUI_HOST || '192.168.1.19:8188'}`);
});