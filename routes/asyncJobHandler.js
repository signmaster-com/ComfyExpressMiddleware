const { fileBufferToBase64 } = require('../utils/imageUtils');
const { getJobProcessor } = require('../services/jobProcessor');
const { getJobManager } = require('../services/jobManager');

/**
 * Asynchronous route handler for removing background from images
 * Returns job ID immediately and processes in background
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleRemoveBackgroundAsync(req, res) {
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
      return res.status(400).json({ error: 'Failed to convert image to base64.' });
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
    
    // Extract crop parameter from request body or query, default to true
    const cropParam = req.body.crop ?? req.query.crop ?? true;
    // Convert string 'false' to boolean false, everything else is truthy
    const crop = cropParam !== 'false' && cropParam !== false;
    
    // Add job to processor queue
    const jobProcessor = getJobProcessor();
    const jobId = jobProcessor.addJob('remove-background', {
      imageBase64: imageBase64,
      imageSize: buffer.length,
      mimeType: mimetype,
      originalFilename: req.file.originalname,
      format: format,
      crop: crop
    });
    
    // Return job ID immediately with 202 Accepted
    res.status(202).json({
      job_id: jobId,
      status: 'pending',
      message: 'Job submitted successfully. Use /api/jobs/{job_id}/status to track progress.',
      estimated_completion_time: '30-60 seconds',
      status_url: `/api/jobs/${jobId}/status`,
      result_url: `/api/jobs/${jobId}/result`,
      format: format,
      crop: crop
    });
    
  } catch (error) {
    console.error('Unexpected error in handleRemoveBackgroundAsync:', error);
    return res.status(500).json({
      error: 'An unexpected error occurred.',
      details: error.message
    });
  }
}

/**
 * Asynchronous route handler for upscaling images
 * Returns job ID immediately and processes in background
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleUpscaleImageAsync(req, res) {
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
      return res.status(400).json({ error: 'Failed to convert image to base64.' });
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
    
    // Add job to processor queue
    const jobProcessor = getJobProcessor();
    const jobId = jobProcessor.addJob('upscale-image', {
      imageBase64: imageBase64,
      imageSize: buffer.length,
      mimeType: mimetype,
      originalFilename: req.file.originalname,
      format: format
    });
    
    // Return job ID immediately with 202 Accepted
    res.status(202).json({
      job_id: jobId,
      status: 'pending',
      message: 'Job submitted successfully. Use /api/jobs/{job_id}/status to track progress.',
      estimated_completion_time: '45-90 seconds',
      status_url: `/api/jobs/${jobId}/status`,
      result_url: `/api/jobs/${jobId}/result`,
      format: format
    });
    
  } catch (error) {
    console.error('Unexpected error in handleUpscaleImageAsync:', error);
    return res.status(500).json({
      error: 'An unexpected error occurred.',
      details: error.message
    });
  }
}

/**
 * Asynchronous route handler for upscaling and removing background from images
 * Returns job ID immediately and processes in background
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleUpscaleRemoveBGAsync(req, res) {
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
      return res.status(400).json({ error: 'Failed to convert image to base64.' });
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
    
    // Add job to processor queue
    const jobProcessor = getJobProcessor();
    const jobId = jobProcessor.addJob('upscale-remove-bg', {
      imageBase64: imageBase64,
      imageSize: buffer.length,
      mimeType: mimetype,
      originalFilename: req.file.originalname,
      format: format
    });
    
    // Return job ID immediately with 202 Accepted
    res.status(202).json({
      job_id: jobId,
      status: 'pending',
      message: 'Job submitted successfully. Use /api/jobs/{job_id}/status to track progress.',
      estimated_completion_time: '60-180 seconds',
      status_url: `/api/jobs/${jobId}/status`,
      result_url: `/api/jobs/${jobId}/result`,
      format: format
    });
    
  } catch (error) {
    console.error('Unexpected error in handleUpscaleRemoveBGAsync:', error);
    return res.status(500).json({
      error: 'An unexpected error occurred.',
      details: error.message
    });
  }
}

/**
 * Get job status with progress information
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getJobStatus(req, res) {
  const { job_id } = req.params;
  
  if (!job_id) {
    return res.status(400).json({ error: 'Job ID is required' });
  }
  
  try {
    const jobManager = getJobManager();
    const job = jobManager.getJob(job_id);
    
    if (!job) {
      return res.status(404).json({ 
        error: 'Job not found',
        job_id: job_id
      });
    }
    
    // Calculate processing time and estimated completion
    const now = Date.now();
    const processingTime = Math.round((now - job.createdTime) / 1000);
    const estimatedTotal = getEstimatedDuration(job.type);
    const remainingTime = Math.max(0, estimatedTotal - processingTime);
    
    const response = {
      job_id: job_id,
      status: job.status,
      type: job.type,
      created_time: new Date(job.createdTime).toISOString(),
      updated_time: new Date(job.updatedTime).toISOString(),
      processing_time_seconds: processingTime,
      comfyui_instance: job.comfyuiInstance
    };
    
    // Add status-specific information
    switch (job.status) {
      case 'pending':
        response.message = 'Job is queued for processing';
        response.estimated_completion_time_seconds = estimatedTotal;
        break;
        
      case 'processing':
        response.message = 'Job is currently being processed';
        response.prompt_id = job.promptId;
        response.estimated_remaining_time_seconds = remainingTime;
        response.progress_percentage = Math.min(95, Math.round((processingTime / estimatedTotal) * 100));
        break;
        
      case 'completed':
        response.message = 'Job completed successfully';
        response.completed_time = new Date(job.completedTime || job.updatedTime).toISOString();
        response.result_url = `/api/jobs/${job_id}/result`;
        response.progress_percentage = 100;
        break;
        
      case 'failed':
        response.message = 'Job failed to process';
        response.error = job.error;
        response.failed_time = new Date(job.failedTime || job.updatedTime).toISOString();
        if (job.errorDetails) {
          response.error_details = job.errorDetails;
        }
        break;
    }
    
    return res.status(200).json(response);
  } catch (error) {
    console.error('Error getting job status:', error);
    return res.status(500).json({
      error: 'Failed to get job status',
      details: error.message
    });
  }
}

/**
 * Get completed job result (image)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getJobResult(req, res) {
  const { job_id } = req.params;
  
  if (!job_id) {
    return res.status(400).json({ error: 'Job ID is required' });
  }
  
  try {
    const jobManager = getJobManager();
    const job = jobManager.getJob(job_id);
    
    if (!job) {
      return res.status(404).json({ 
        error: 'Job not found',
        job_id: job_id
      });
    }
    
    // Check if job is completed
    if (job.status !== 'completed') {
      return res.status(409).json({
        error: 'Job not completed',
        status: job.status,
        message: job.status === 'failed' 
          ? 'Job failed to process' 
          : `Job is currently ${job.status}. Check status endpoint for progress.`,
        status_url: `/api/jobs/${job_id}/status`
      });
    }
    
    // Check if result exists
    if (!job.result || !job.result.base64) {
      return res.status(500).json({
        error: 'Job completed but result not available',
        job_id: job_id
      });
    }
    
    // Return the result
    return res.status(200).json({
      job_id: job_id,
      status: 'completed',
      type: job.type,
      completed_time: new Date(job.completedTime || job.updatedTime).toISOString(),
      processing_time_seconds: Math.round((job.updatedTime - job.createdTime) / 1000),
      result: {
        image_base64: job.result.base64,
        prompt_id: job.result.promptId
      }
    });
    
  } catch (error) {
    console.error('Error getting job result:', error);
    return res.status(500).json({
      error: 'Failed to get job result',
      details: error.message
    });
  }
}


/**
 * Get estimated duration for different workflow types
 * @param {string} workflowType - Type of workflow
 * @returns {number} Estimated duration in seconds
 */
function getEstimatedDuration(workflowType) {
  switch (workflowType) {
    case 'remove-background':
      return 45; // 45 seconds
    case 'upscale-image':
      return 60; // 60 seconds
    case 'upscale-remove-bg':
      return 90; // 90 seconds (combines both operations)
    default:
      return 30; // Default 30 seconds
  }
}

module.exports = {
  handleRemoveBackgroundAsync,
  handleUpscaleImageAsync,
  handleUpscaleRemoveBGAsync,
  getJobStatus,
  getJobResult
};