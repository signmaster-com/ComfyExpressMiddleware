const { fileBufferToBase64 } = require('../utils/imageUtils');
const { executeWorkflow } = require('../services/comfyuiService');
const { getRemoveBackgroundWorkflow } = require('../workflows');
const { handleRemoveBackgroundAsync } = require('./asyncJobHandler');

/**
 * Express route handler for removing background from images
 * Supports both synchronous and asynchronous modes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleRemoveBackground(req, res) {
  // Check for async mode via query parameter
  const isAsync = req.query.async === 'true' || req.query.mode === 'async';
  
  if (isAsync) {
    return handleRemoveBackgroundAsync(req, res);
  }
  
  // Check if file exists
  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided.' });
  }
  
  // Extract file data
  const { buffer, mimetype } = req.file;
  
  try {
    // Convert buffer to base64
    let imageBase64;
    try {
      imageBase64 = fileBufferToBase64(buffer, mimetype);
    } catch (conversionError) {
      console.error('Failed to convert image to base64:', conversionError);
      return res.status(500).json({ error: 'Failed to convert image to base64.' });
    }
    
    // Extract format parameter from request body or query, default to PNG
    const format = (req.body.format || req.query.format || 'PNG').toUpperCase();
    
    // Validate format
    const validFormats = ['PNG', 'JPEG', 'WEBP'];
    if (!validFormats.includes(format)) {
      return res.status(400).json({
        error: 'Invalid format',
        details: `Format must be one of: ${validFormats.join(', ')}`
      });
    }
    
    // Get the workflow
    const workflow = getRemoveBackgroundWorkflow(format);
    
    // Execute the workflow
    try {
      const result = await executeWorkflow(workflow, imageBase64, '17', 'remove-background');
      return res.status(200).json({ 
        imageBase64: result.base64,
        promptId: result.promptId,
        jobId: result.jobId,
        format: format
      });
    } catch (workflowError) {
      console.error('Failed to process image for background removal:', workflowError);
      return res.status(500).json({
        error: 'Failed to process image for background removal.',
        details: workflowError.message
      });
    }
  } catch (error) {
    console.error('Unexpected error in handleRemoveBackground:', error);
    return res.status(500).json({
      error: 'An unexpected error occurred.',
      details: error.message
    });
  }
}

module.exports = {
  handleRemoveBackground
};