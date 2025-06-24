const { fileBufferToBase64 } = require('../utils/imageUtils');
const { executeWorkflow } = require('../services/comfyuiService');
const { getUpscaleRemoveBGWorkflow } = require('../workflows');
const { handleUpscaleRemoveBGAsync } = require('./asyncJobHandler');

/**
 * Handles upscaling and background removal for uploaded images
 * Combines both upscaling and background removal in a single workflow
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function upscaleRemoveBGHandler(req, res) {
    // Check if async mode is requested
    const isAsync = req.query.async === 'true' || req.query.mode === 'async';
    if (isAsync) {
        return handleUpscaleRemoveBGAsync(req, res);
    }

    // Validate that a file was uploaded
    if (!req.file) {
        return res.status(400).json({
            error: 'No image file provided',
            details: 'Please upload an image file with field name "imageFile"'
        });
    }

    try {
        // Extract file data
        const { buffer, mimetype } = req.file;
        
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
        
        // Convert file buffer to base64
        let imageBase64;
        try {
            imageBase64 = await fileBufferToBase64(buffer, mimetype);
        } catch (error) {
            console.error('Error converting file to base64:', error);
            return res.status(400).json({
                error: 'Invalid image file',
                details: 'Failed to process the uploaded image'
            });
        }

        // Get the upscale and remove background workflow
        const workflow = getUpscaleRemoveBGWorkflow(format);
        
        // Execute the workflow - using node 8 which is the ImageCompressor output
        const result = await executeWorkflow(workflow, imageBase64, '8', 'upscale-remove-bg');
        
        // Send the processed image back to the client
        res.status(200).json({
            imageBase64: result.base64,
            promptId: result.promptId,
            jobId: result.jobId,
            format: format
        });
        
    } catch (error) {
        console.error('Error in upscaleRemoveBGHandler:', error);
        res.status(500).json({
            error: 'Failed to process image',
            details: error.message
        });
    }
}

module.exports = {
    upscaleRemoveBGHandler
};