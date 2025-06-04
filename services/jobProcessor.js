const { getJobManager } = require('./jobManager');
const { getLoadBalancer } = require('./loadBalancer');
const { executeWorkflow } = require('./comfyuiService');
const { getRemoveBackgroundWorkflow, getUpscaleImageWorkflow } = require('../workflows');
const { getMetrics } = require('./metrics');
const fs = require('fs').promises;
const path = require('path');

/**
 * Background job processor for concurrent ComfyUI workflow execution
 * Manages job queue and processes jobs across multiple ComfyUI instances
 */
class JobProcessor {
  constructor() {
    this.isRunning = false;
    this.activeProcessingJobs = new Map(); // Track currently processing jobs
    this.processingIntervalId = null;
    this.instanceJobCounts = new Map(); // Track jobs per instance
    
    // Configuration
    this.maxConcurrentJobs = parseInt(process.env.MAX_CONCURRENT_JOBS) || 4;
    this.processingInterval = parseInt(process.env.JOB_PROCESSING_INTERVAL) || 1000; // 1 second
    this.maxJobsPerInstance = parseInt(process.env.MAX_JOBS_PER_INSTANCE) || 2;
    
    // Job type to workflow mapping
    this.workflowMap = {
      'remove-background': {
        workflow: getRemoveBackgroundWorkflow,
        targetNode: '17'
      },
      'upscale-image': {
        workflow: getUpscaleImageWorkflow,
        targetNode: '10'
      }
    };
    
    console.log(`🏭 JobProcessor initialized:`);
    console.log(`   Max concurrent jobs: ${this.maxConcurrentJobs}`);
    console.log(`   Max jobs per instance: ${this.maxJobsPerInstance}`);
    console.log(`   Processing interval: ${this.processingInterval}ms`);
    console.log(`   Output files: ${process.env.OUTPUT_FILES === 'true' ? 'ENABLED' : 'DISABLED'}`);
    
    // Graceful shutdown handling
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  /**
   * Start the job processor
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️  JobProcessor is already running');
      return;
    }

    console.log('🚀 Starting JobProcessor...');
    this.isRunning = true;
    
    // Start the processing loop
    this.processingIntervalId = setInterval(() => {
      this.processQueuedJobs();
    }, this.processingInterval);
    
    console.log('✅ JobProcessor started');
  }

  /**
   * Stop the job processor
   */
  async stop() {
    if (!this.isRunning) {
      console.log('⚠️  JobProcessor is not running');
      return;
    }

    console.log('🛑 Stopping JobProcessor...');
    this.isRunning = false;
    
    // Clear the processing interval
    if (this.processingIntervalId) {
      clearInterval(this.processingIntervalId);
      this.processingIntervalId = null;
    }
    
    // Wait for active jobs to complete
    if (this.activeProcessingJobs.size > 0) {
      console.log(`⏳ Waiting for ${this.activeProcessingJobs.size} active jobs to complete...`);
      
      const activePromises = Array.from(this.activeProcessingJobs.values());
      try {
        await Promise.allSettled(activePromises);
      } catch (error) {
        console.error('Error waiting for active jobs:', error);
      }
    }
    
    console.log('✅ JobProcessor stopped');
  }

  /**
   * Process queued jobs if capacity allows
   */
  async processQueuedJobs() {
    if (!this.isRunning) {
      return;
    }

    try {
      const jobManager = getJobManager();
      const loadBalancer = getLoadBalancer();
      
      // Get pending jobs
      const pendingJobs = jobManager.getJobsByStatus('pending');
      
      if (pendingJobs.length === 0) {
        return; // No jobs to process
      }

      // Check if we have capacity for more jobs
      const availableSlots = this.maxConcurrentJobs - this.activeProcessingJobs.size;
      if (availableSlots <= 0) {
        return; // At capacity
      }

      // Get available instances
      const availableInstances = await this.getAvailableInstances();
      if (availableInstances.length === 0) {
        return; // No instances available
      }

      // Process jobs up to available capacity
      const jobsToProcess = pendingJobs.slice(0, Math.min(availableSlots, availableInstances.length));
      
      for (const job of jobsToProcess) {
        if (this.activeProcessingJobs.has(job.id)) {
          continue; // Already processing
        }

        // Find the best available instance
        const instance = await this.selectBestInstance(availableInstances);
        if (!instance) {
          break; // No more available instances
        }

        // Start processing the job
        this.startJobProcessing(job, instance);
      }

    } catch (error) {
      console.error('💥 Error in processQueuedJobs:', error);
    }
  }

  /**
   * Get available ComfyUI instances that can accept more jobs
   * @returns {Promise<Array>} Array of available instances
   */
  async getAvailableInstances() {
    const loadBalancer = getLoadBalancer();
    
    // Ensure initial health check is complete
    if (!loadBalancer.initialHealthCheckComplete) {
      await loadBalancer.healthChecker.performHealthChecks();
      loadBalancer.initialHealthCheckComplete = true;
    }

    const healthyInstances = loadBalancer.healthChecker.getHealthyInstances();
    
    // Filter instances that haven't reached their job limit
    const availableInstances = healthyInstances.filter(instance => {
      const currentJobs = this.instanceJobCounts.get(instance.host) || 0;
      return currentJobs < this.maxJobsPerInstance;
    });

    return availableInstances;
  }

  /**
   * Select the best instance for job processing (least loaded)
   * @param {Array} availableInstances - Available instances
   * @returns {Object|null} Best instance or null
   */
  async selectBestInstance(availableInstances) {
    if (availableInstances.length === 0) {
      return null;
    }

    // Sort by current job count (ascending)
    const sortedInstances = availableInstances.map(instance => ({
      ...instance,
      currentJobs: this.instanceJobCounts.get(instance.host) || 0
    })).sort((a, b) => a.currentJobs - b.currentJobs);

    return sortedInstances[0];
  }

  /**
   * Start processing a job on a specific instance
   * @param {Object} job - Job to process
   * @param {Object} instance - ComfyUI instance
   */
  startJobProcessing(job, instance) {
    console.log(`🎯 Starting job ${job.id} (${job.type}) on instance ${instance.host}`);

    // Record job creation in metrics
    const metrics = getMetrics();
    metrics.recordJobCreated(job.type, instance.host);

    // Update job status to processing
    const jobManager = getJobManager();
    jobManager.updateJobStatus(job.id, 'processing', {
      comfyuiInstance: instance.host,
      processingStartTime: Date.now()
    });

    // Track instance job count
    const currentCount = this.instanceJobCounts.get(instance.host) || 0;
    this.instanceJobCounts.set(instance.host, currentCount + 1);

    // Create processing promise
    const processingPromise = this.executeJobWorkflow(job, instance)
      .then(result => {
        console.log(`✅ Job ${job.id} completed successfully`);
        
        const processingDuration = Date.now() - (job.processingStartTime || job.updatedTime);
        
        // Record successful completion in metrics
        const metrics = getMetrics();
        metrics.recordJobCompleted(job.type, instance.host, processingDuration, true);
        
        // Update job status to completed
        jobManager.updateJobStatus(job.id, 'completed', {
          result: result,
          completedTime: Date.now(),
          processingDuration: processingDuration
        });
      })
      .catch(error => {
        console.error(`❌ Job ${job.id} failed:`, error.message);
        
        const processingDuration = Date.now() - (job.processingStartTime || job.updatedTime);
        
        // Record failed completion in metrics
        const metrics = getMetrics();
        metrics.recordJobCompleted(job.type, instance.host, processingDuration, false, error.message);
        
        // Update job status to failed
        jobManager.updateJobStatus(job.id, 'failed', {
          error: error.message,
          failedTime: Date.now(),
          processingDuration: processingDuration
        });
      })
      .finally(() => {
        // Clean up tracking
        this.activeProcessingJobs.delete(job.id);
        
        // Decrement instance job count
        const currentCount = this.instanceJobCounts.get(instance.host) || 0;
        this.instanceJobCounts.set(instance.host, Math.max(0, currentCount - 1));
        
        console.log(`🏁 Job ${job.id} processing completed. Instance ${instance.host} now has ${this.instanceJobCounts.get(instance.host)} active jobs`);
      });

    // Track the active job
    this.activeProcessingJobs.set(job.id, processingPromise);
  }

  /**
   * Execute the workflow for a specific job
   * @param {Object} job - Job to execute
   * @param {Object} instance - ComfyUI instance
   * @returns {Promise<Object>} Workflow result
   */
  async executeJobWorkflow(job, instance) {
    // Get workflow configuration
    const workflowConfig = this.workflowMap[job.type];
    if (!workflowConfig) {
      throw new Error(`Unknown job type: ${job.type}`);
    }

    // Get job data
    const jobData = job.data;
    if (!jobData || !jobData.imageBase64) {
      throw new Error('Job data missing required imageBase64');
    }

    // Get workflow and execute
    const workflow = workflowConfig.workflow();
    const targetNode = workflowConfig.targetNode;

    try {
      // Execute workflow using the existing comfyuiService
      // Note: We need to temporarily override the instance selection in comfyuiService
      const result = await this.executeWorkflowOnInstance(
        workflow, 
        jobData.imageBase64, 
        targetNode, 
        job.type,
        job.id,
        instance
      );

      return result;
    } catch (error) {
      // Handle instance-specific failures
      if (this.isInstanceError(error)) {
        console.error(`💥 Instance ${instance.host} failed for job ${job.id}:`, error.message);
        
        // Mark instance as unhealthy
        const loadBalancer = getLoadBalancer();
        loadBalancer.markUnhealthy(instance.host);
      }
      
      throw error;
    }
  }

  /**
   * Execute workflow on a specific instance (bypassing load balancer selection)
   * @param {Object} workflow - ComfyUI workflow
   * @param {string} imageBase64 - Base64 image data
   * @param {string} targetNode - Target node ID
   * @param {string} jobType - Job type
   * @param {string} jobId - Job ID for unique identification
   * @param {Object} instance - Specific instance to use
   * @returns {Promise<Object>} Execution result
   */
  async executeWorkflowOnInstance(workflow, imageBase64, targetNode, jobType, jobId, instance) {
    // This is a simplified version that directly calls the ComfyUI API
    // We bypass the load balancer instance selection
    
    const axios = require('axios');
    const { v4: uuidv4 } = require('uuid');
    const { getConnectionManager } = require('./connectionManager');
    
    const clientId = uuidv4();
    const useSSL = process.env.COMFYUI_USE_SSL === 'true';
    const httpProtocol = useSSL ? 'https' : 'http';
    const comfyUrl = `${httpProtocol}://${instance.host}`;
    
    // Deep clone and modify workflow
    const modifiedWorkflow = JSON.parse(JSON.stringify(workflow));
    
    // Add unique identifier to prevent ComfyUI caching identical workflows
    const uniqueTimestamp = Date.now();
    const uniqueJobId = `job_${jobId}_${uniqueTimestamp}`;
    
    // Update input nodes with the base64 image
    for (const nodeId in modifiedWorkflow) {
      const node = modifiedWorkflow[nodeId];
      if (node._meta && node._meta.name === 'InputImageBase64') {
        let base64String = imageBase64;
        if (imageBase64.includes(',')) {
          base64String = imageBase64.split(',')[1];
        }
        node.inputs.image = base64String;
      }
      
      // Add unique identifier to SaveImage nodes to prevent caching
      if (node.class_type === 'SaveImage' && node.inputs) {
        // Append unique job identifier to filename prefix
        const originalPrefix = node.inputs.filename_prefix || 'ComfyUI';
        node.inputs.filename_prefix = `${originalPrefix}_${uniqueJobId}`;
      }
    }
    
    // Submit prompt
    const payload = {
      prompt: modifiedWorkflow,
      client_id: clientId
    };
    
    const response = await axios.post(`${comfyUrl}/prompt`, payload);
    const promptId = response.data.prompt_id;
    
    console.log(`📤 Submitted prompt ${promptId} to ${instance.host} for job processing`);
    
    // Monitor execution via WebSocket
    return new Promise(async (resolve, reject) => {
      const connectionManager = getConnectionManager();
      let pooledConnection = null;
      let resolved = false;
      let executionCompleted = false;
      
      const cleanup = () => {
        if (pooledConnection) {
          connectionManager.releaseConnection(pooledConnection);
          pooledConnection = null;
        }
      };
      
      const resolveWithCleanup = (result) => {
        cleanup();
        resolve(result);
      };
      
      const rejectWithCleanup = (error) => {
        cleanup();
        reject(error);
      };
      
      try {
        // Get pooled connection
        pooledConnection = await connectionManager.getConnection(instance.host);
        
        // Set up timeout
        const timeoutId = setTimeout(() => {
          if (!resolved) {
            rejectWithCleanup(new Error('Workflow execution timed out'));
            resolved = true;
          }
        }, 60000); // 60 second timeout
        
        // Message handler
        const messageHandler = async (data) => {
          try {
            const message = JSON.parse(data.toString());
            
            if (message.type === 'executing' && message.data) {
              if (message.data.prompt_id === promptId && message.data.node === null) {
                console.log(`🏁 Workflow execution completed for prompt ${promptId}`);
                executionCompleted = true;
                clearTimeout(timeoutId);
                
                // Fetch results
                try {
                  const result = await this.fetchWorkflowResults(comfyUrl, promptId, targetNode);
                  resolveWithCleanup(result);
                  resolved = true;
                } catch (fetchError) {
                  rejectWithCleanup(fetchError);
                  resolved = true;
                }
              }
            } else if (message.type === 'status' && message.data) {
              // Handle cached job completion
              if (message.data.status && message.data.status.exec_info && 
                  message.data.status.exec_info.queue_remaining === 0 && !executionCompleted) {
                console.log(`🏁 Cached job completion detected for prompt ${promptId}`);
                executionCompleted = true;
                clearTimeout(timeoutId);
                
                try {
                  const result = await this.fetchWorkflowResults(comfyUrl, promptId, targetNode);
                  resolveWithCleanup(result);
                  resolved = true;
                } catch (fetchError) {
                  rejectWithCleanup(fetchError);
                  resolved = true;
                }
              }
            } else if (message.type === 'execution_error' && message.data) {
              console.error(`💥 Execution error for prompt ${promptId}:`, message.data);
              clearTimeout(timeoutId);
              rejectWithCleanup(new Error(`Workflow execution error: ${JSON.stringify(message.data)}`));
              resolved = true;
            }
          } catch (parseError) {
            // Ignore non-JSON messages
          }
        };
        
        // Set up message listener
        pooledConnection.onMessage(messageHandler);
        
      } catch (error) {
        rejectWithCleanup(new Error(`Failed to get WebSocket connection: ${error.message}`));
      }
    });
  }

  /**
   * Fetch workflow results from ComfyUI history
   * @param {string} comfyUrl - ComfyUI base URL
   * @param {string} promptId - Prompt ID
   * @param {string} targetNode - Target node ID
   * @returns {Promise<Object>} Result data
   */
  async fetchWorkflowResults(comfyUrl, promptId, targetNode) {
    const axios = require('axios');
    
    // Wait a bit for results to be saved
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const historyResponse = await axios.get(`${comfyUrl}/history/${promptId}`);
    const history = historyResponse.data;
    
    if (!history[promptId]) {
      throw new Error('No history found for prompt');
    }
    
    const outputs = history[promptId].outputs;
    
    // Find the target node or first node with images
    let imageInfo = null;
    if (targetNode && outputs[targetNode] && outputs[targetNode].images) {
      imageInfo = outputs[targetNode].images[0];
    } else {
      for (const [nodeId, output] of Object.entries(outputs)) {
        if (output.images && output.images.length > 0) {
          imageInfo = output.images[0];
          break;
        }
      }
    }
    
    if (!imageInfo) {
      throw new Error('No images found in workflow output');
    }
    
    // Download the image
    const imageResponse = await axios.get(`${comfyUrl}/view`, {
      params: {
        filename: imageInfo.filename,
        subfolder: imageInfo.subfolder || '',
        type: imageInfo.type
      },
      responseType: 'arraybuffer'
    });
    
    const imageBuffer = Buffer.from(imageResponse.data);
    const contentType = imageResponse.headers['content-type'] || 'image/png';
    const base64Image = `data:${contentType};base64,${imageBuffer.toString('base64')}`;
    
    // Save file if OUTPUT_FILES is enabled
    if (process.env.OUTPUT_FILES === 'true') {
      const outputDir = path.join(process.cwd(), 'outputs', promptId);
      try {
        await fs.mkdir(outputDir, { recursive: true });
        const fileName = imageInfo.filename;
        const filePath = path.join(outputDir, fileName);
        await fs.writeFile(filePath, imageBuffer);
        console.log(`✅ Image saved to: ${filePath}`);
      } catch (saveError) {
        console.error('❌ Failed to save output file:', saveError);
      }
    }
    
    return {
      base64: base64Image,
      promptId: promptId
    };
  }

  /**
   * Check if an error is instance-related (connection/health issue)
   * @param {Error} error - Error to check
   * @returns {boolean} True if instance error
   */
  isInstanceError(error) {
    const instanceErrorCodes = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET'];
    return instanceErrorCodes.includes(error.code) || 
           error.message.includes('connection') ||
           error.message.includes('timeout') ||
           error.message.includes('WebSocket');
  }

  /**
   * Get processor statistics
   * @returns {Object} Processor stats
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      activeJobs: this.activeProcessingJobs.size,
      maxConcurrentJobs: this.maxConcurrentJobs,
      instanceJobCounts: Object.fromEntries(this.instanceJobCounts),
      processingInterval: this.processingInterval,
      maxJobsPerInstance: this.maxJobsPerInstance
    };
  }

  /**
   * Log processor status
   */
  logStatus() {
    const stats = this.getStats();
    console.log('🏭 JobProcessor Status:');
    console.log(`   Running: ${stats.isRunning}`);
    console.log(`   Active jobs: ${stats.activeJobs}/${stats.maxConcurrentJobs}`);
    console.log(`   Instance job counts: ${JSON.stringify(stats.instanceJobCounts)}`);
    
    if (stats.activeJobs > 0) {
      const activeJobIds = Array.from(this.activeProcessingJobs.keys());
      console.log(`   Active job IDs: ${activeJobIds.slice(0, 3).join(', ')}${activeJobIds.length > 3 ? '...' : ''}`);
    }
  }

  /**
   * Add a job to the processing queue
   * @param {string} jobType - Type of job
   * @param {Object} jobData - Job data including imageBase64
   * @returns {string} Job ID
   */
  addJob(jobType, jobData) {
    const jobManager = getJobManager();
    const jobId = jobManager.createJob(jobType, {
      ...jobData,
      imageBase64: jobData.imageBase64,
      submittedAt: new Date().toISOString()
    });
    
    console.log(`📝 Added job ${jobId} (${jobType}) to processing queue`);
    return jobId;
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('🛑 JobProcessor shutting down...');
    await this.stop();
    console.log('✅ JobProcessor shutdown complete');
  }
}

// Singleton instance
let jobProcessorInstance = null;

/**
 * Get or create the job processor instance
 * @returns {JobProcessor} The job processor instance
 */
function getJobProcessor() {
  if (!jobProcessorInstance) {
    jobProcessorInstance = new JobProcessor();
  }
  return jobProcessorInstance;
}

module.exports = {
  JobProcessor,
  getJobProcessor
};