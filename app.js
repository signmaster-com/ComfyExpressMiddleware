const express = require('express');
const multer = require('multer');
const { handleRemoveBackground } = require('./routes/removeBackgroundHandler.js');
const { handleUpscaleImage } = require('./routes/upscaleImageHandler.js');

// Instantiate Express app
const app = express();

// Configure multer for single file uploads to memory
const upload = multer({ 
  storage: multer.memoryStorage(), 
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Middleware
app.use(express.json());

// Routes
app.post('/api/remove-background', upload.single('imageFile'), handleRemoveBackground);
app.post('/api/upscale-image', upload.single('imageFile'), handleUpscaleImage);

// Basic global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err.stack);
  if (!res.headersSent) {
    res.status(500).send({ error: 'Something went wrong!' });
  }
});

module.exports = app;