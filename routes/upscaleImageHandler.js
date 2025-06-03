const { fileBufferToBase64 } = require('../utils/imageUtils.js');
const { executeWorkflow } = require('../services/comfyuiService.js');
const { getUpscaleImageWorkflow } = require('../workflows.js');

/**
 * Express route handler for upscaling images
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleUpscaleImage(req, res) {
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
    
    // Get the workflow
    const workflow = getUpscaleImageWorkflow();
    
    // Execute the workflow
    try {
      const result = await executeWorkflow(workflow, imageBase64, '10');
      return res.status(200).json({ 
        imageBase64: result.base64,
        promptId: result.promptId 
      });
    } catch (workflowError) {
      console.error('Failed to upscale image:', workflowError);
      return res.status(500).json({
        error: 'Failed to upscale image.',
        details: workflowError.message
      });
    }
  } catch (error) {
    console.error('Unexpected error in handleUpscaleImage:', error);
    return res.status(500).json({
      error: 'An unexpected error occurred.',
      details: error.message
    });
  }
}

module.exports = {
  handleUpscaleImage
};