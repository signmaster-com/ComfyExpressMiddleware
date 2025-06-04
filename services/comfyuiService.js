const WebSocket = require('ws');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const { getLoadBalancer } = require('./loadBalancer');
const { getConnectionManager } = require('./connectionManager');
const { getJobManager } = require('./jobManager');

/**
 * Executes a ComfyUI workflow with a base64 image input
 * @param {Object} workflowJson - The workflow JSON object
 * @param {string} imageBase64 - The base64 encoded image string
 * @param {string} nodeId - The node ID to get results from (optional)
 * @param {string} jobType - Type of job for tracking (optional)
 * @returns {Promise<{base64: string, promptId: string, jobId: string}>} Promise that resolves with the base64 encoded output image, prompt ID, and job ID
 */
async function executeWorkflow(workflowJson, imageBase64, nodeId = null, jobType = 'workflow') {
  console.log(`Starting workflow execution (job type: ${jobType})`);
  
  // Generate unique client ID
  const clientId = uuidv4();
  console.log(`Generated client ID: ${clientId}`);
  
  // Deep clone the workflow to avoid modifying the original
  const modifiedWorkflow = JSON.parse(JSON.stringify(workflowJson));
  
  // Update input nodes with the base64 image
  let inputNodeFound = false;
  for (const nodeId in modifiedWorkflow) {
    const node = modifiedWorkflow[nodeId];
    if (node._meta && node._meta.name === 'InputImageBase64') {
      // Strip the data URI prefix if present to get just the base64 string
      let base64String = imageBase64;
      if (imageBase64.includes(',')) {
        base64String = imageBase64.split(',')[1];
      }
      node.inputs.image = base64String;
      inputNodeFound = true;
      console.log(`Found and updated InputImageBase64 node (ID: ${nodeId})`);
    }
  }
  
  if (!inputNodeFound) {
    console.log('Warning: No InputImageBase64 node found in workflow');
  }
  
  // Get load balancer and select an instance
  const loadBalancer = getLoadBalancer();
  
  // Log current load balancer status
  console.log('Current load balancer status:', loadBalancer.getInstancesStatus());
  
  const instance = await loadBalancer.getAvailableInstance();
  
  if (!instance) {
    throw new Error('No healthy ComfyUI instances available');
  }
  
  console.log(`Selected instance ${instance.id} (${instance.host}) for new job`);
  
  // Create job for tracking
  const jobManager = getJobManager();
  const jobId = jobManager.createJob(jobType, {
    clientId: clientId,
    workflowType: jobType,
    imageSize: imageBase64.length,
    targetNodeId: nodeId
  }, instance.host);
  
  // Define ComfyUI connection parameters for selected instance
  const comfyHost = instance.host;
  const useSSL = process.env.COMFYUI_USE_SSL === 'true';
  const httpProtocol = useSSL ? 'https' : 'http';
  const wsProtocol = useSSL ? 'wss' : 'ws';
  const comfyUrl = `${httpProtocol}://${comfyHost}`;
  const comfyWsUrl = `${wsProtocol}://${comfyHost}/ws?clientId=${clientId}`;
  
  // Increment active jobs for this instance
  loadBalancer.incrementActiveJobs(comfyHost);
  console.log('Updated load balancer status after increment:', loadBalancer.getInstancesStatus());
  
  // Construct prompt payload
  const payload = {
    prompt: modifiedWorkflow,
    client_id: clientId
  };
  
  // Send prompt request
  let promptId;
  try {
    console.log(`Submitting prompt to ${comfyUrl}/prompt`);
    const response = await axios.post(`${comfyUrl}/prompt`, payload);
    promptId = response.data.prompt_id;
    console.log(`Prompt submitted successfully. Prompt ID: ${promptId}`);
    
    // Update job status to processing
    jobManager.updateJobStatus(jobId, jobManager.JOB_STATES.PROCESSING, {
      promptId: promptId,
      submittedTime: Date.now()
    });
  } catch (error) {
    console.error('ComfyUI prompt request failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    
    // Update job status to failed
    jobManager.updateJobStatus(jobId, jobManager.JOB_STATES.FAILED, {
      error: error.message,
      errorDetails: error.response?.data
    });
    
    // Decrement active jobs on failure
    loadBalancer.decrementActiveJobs(comfyHost);
    
    // Mark instance as unhealthy if connection refused or timeout
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      loadBalancer.markUnhealthy(comfyHost);
      console.error(`Marked instance ${comfyHost} as unhealthy due to connection error: ${error.code}`);
    }
    
    throw new Error('ComfyUI prompt request failed');
  }
  
  // Monitor execution via pooled WebSocket connection
  return new Promise(async (resolve, reject) => {
    console.log(`Getting pooled WebSocket connection for: ${comfyHost}`);
    
    const connectionManager = getConnectionManager();
    let pooledConnection = null;
    let resolved = false;
    let executionCompleted = false;
    let cleanupMessageHandler = () => {}; // Will be defined later
    
    // Ensure we always clean up
    const cleanup = () => {
      cleanupMessageHandler();
      loadBalancer.decrementActiveJobs(comfyHost);
      if (pooledConnection) {
        connectionManager.releaseConnection(pooledConnection);
        pooledConnection = null;
      }
    };
    
    const resolveWithCleanup = (result) => {
      // Update job status to completed
      jobManager.updateJobStatus(jobId, jobManager.JOB_STATES.COMPLETED, {
        result: result,
        completedTime: Date.now()
      });
      cleanup();
      resolve({ ...result, jobId });
    };
    
    const rejectWithCleanup = (error) => {
      // Update job status to failed
      jobManager.updateJobStatus(jobId, jobManager.JOB_STATES.FAILED, {
        error: error.message,
        failedTime: Date.now()
      });
      cleanup();
      reject(error);
    };

    // Get connection from pool
    try {
      pooledConnection = await connectionManager.getConnection(comfyHost);
      console.log(`✅ Acquired pooled connection ${pooledConnection.id} for ${comfyHost}`);
    } catch (error) {
      console.error(`Failed to get pooled connection for ${comfyHost}:`, error.message);
      rejectWithCleanup(new Error(`Failed to get WebSocket connection: ${error.message}`));
      return;
    }
    
    // Set up timeout
    const timeoutDuration = 60000; // 60 seconds
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        console.error('ComfyUI execution timed out');
        rejectWithCleanup(new Error('ComfyUI execution timed out'));
        resolved = true;
      }
    }, timeoutDuration);

    // If execution completed, fetch the results
    const fetchResultsHandler = () => {
      if (executionCompleted && !resolved) {
        fetchResults();
      }
    };
    
    // Track cached vs fresh execution for debugging
    const cachedNodes = new Set();
    const processingNodes = new Set();
    let executionStartTime = Date.now();

    // Set up message handler for this execution
    const messageHandler = async (data) => {
      try {
        const message = JSON.parse(data.toString());
        const timestamp = Date.now() - executionStartTime;
        
        // Enhanced logging for all message types
        console.log(`[${timestamp}ms] WebSocket message:`, {
          type: message.type,
          data: message.data
        });
        
        // Handle different message types based on ComfyUI execution flow
        if (message.type === 'execution_cached' && message.data) {
          // Track which nodes will be served from cache
          if (message.data.nodes && message.data.prompt_id === promptId) {
            message.data.nodes.forEach(nodeId => cachedNodes.add(nodeId));
            console.log(`📦 CACHED NODES for prompt ${promptId}:`, Array.from(cachedNodes));
          }
        }
        
        else if (message.type === 'executing' && message.data) {
          if (message.data.prompt_id === promptId) {
            if (message.data.node === null) {
              // Execution completion signal
              console.log('🏁 WORKFLOW EXECUTION COMPLETED!');
              console.log(`📊 Execution Summary for prompt ${promptId}:`);
              console.log(`   Cached nodes: ${cachedNodes.size} - ${Array.from(cachedNodes)}`);
              console.log(`   Processed nodes: ${processingNodes.size} - ${Array.from(processingNodes)}`);
              console.log(`   Was fully cached: ${processingNodes.size === 0}`);
              console.log(`   Total execution time: ${timestamp}ms`);
              
              executionCompleted = true;
              ws.close(); // This will trigger the close event which will fetch results
            } else {
              // Node is being actively processed (not cached)
              processingNodes.add(message.data.node);
              console.log(`⚙️  PROCESSING NODE: ${message.data.node} (fresh execution)`);
            }
          }
        }
        
        else if (message.type === 'executed' && message.data) {
          // Node execution completed (both cached and fresh nodes send this)
          if (message.data.prompt_id === promptId && message.data.node) {
            const nodeId = message.data.node;
            if (cachedNodes.has(nodeId)) {
              console.log(`✅ NODE ${nodeId}: SERVED FROM CACHE`);
            } else if (processingNodes.has(nodeId)) {
              console.log(`🔥 NODE ${nodeId}: FRESHLY PROCESSED`);
            } else {
              console.log(`❓ NODE ${nodeId}: UNKNOWN STATUS (neither cached nor tracked as processing)`);
            }
          }
        }
        
        else if (message.type === 'execution_error' && message.data) {
          console.error('💥 EXECUTION ERROR:', message.data);
          clearTimeout(timeoutId);
          ws.close();
          if (!resolved) {
            rejectWithCleanup(new Error(`ComfyUI execution error: ${JSON.stringify(message.data)}`));
            resolved = true;
          }
        }
        
        else if (message.type === 'status' && message.data) {
          // Status message - important for detecting cached job completion
          console.log(`📊 STATUS MESSAGE:`, message.data);
          
          // For cached jobs, ComfyUI may only send status messages
          // Check if queue is empty, which could indicate our job completed from cache
          if (message.data.status && message.data.status.exec_info && message.data.status.exec_info.queue_remaining === 0) {
            console.log(`🏁 CACHED JOB COMPLETION DETECTED - Queue empty, job completed from cache!`);
            
            // Immediately mark as completed since cached jobs don't send normal execution messages
            if (!resolved && !executionCompleted) {
              console.log(`⚡ CACHED COMPLETION - Fetching results for prompt ${promptId}`);
              executionCompleted = true;
              clearTimeout(timeoutId); // Cancel the timeout
              fetchResultsHandler(); // Trigger result fetching
            }
          }
        }
        
        else {
          // Log any other message types we haven't specifically handled
          console.log(`📨 OTHER MESSAGE TYPE: ${message.type}`, message.data);
        }
        
      } catch (parseError) {
        // Ignore non-JSON messages (binary preview data)
        if (Buffer.isBuffer(data)) {
          console.log(`📸 Received binary data of size: ${data.length} bytes (preview image, ignoring)`);
        } else {
          console.log('⚠️  Failed to parse WebSocket message:', parseError.message);
        }
      }
    };

    // Validate connection before use
    if (!pooledConnection.isConnected) {
      rejectWithCleanup(new Error(`Connection ${pooledConnection.id} is not ready for execution`));
      return;
    }

    // Set up message handler on the pooled connection
    pooledConnection.onMessage(messageHandler);

    // Update the cleanup function
    cleanupMessageHandler = () => {
      if (pooledConnection) {
        pooledConnection.offMessage(messageHandler);
      }
    };

    // Function to fetch results from history
    async function fetchResults() {
      try {
        console.log(`Fetching results from history for prompt ${promptId}`);
        
        // Wait a bit to ensure results are saved
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const historyResponse = await axios.get(`${comfyUrl}/history/${promptId}`);
        const history = historyResponse.data;
        
        if (!history[promptId]) {
          throw new Error('No history found for prompt');
        }
        
        const outputs = history[promptId].outputs;
        console.log('Available outputs:', Object.keys(outputs));
        
        // Find the first node with images in outputs
        let targetNodeId = nodeId;
        let imageInfo = null;
        
        if (targetNodeId && outputs[targetNodeId] && outputs[targetNodeId].images) {
          imageInfo = outputs[targetNodeId].images[0];
        } else {
          // Find first node with images
          for (const [nId, output] of Object.entries(outputs)) {
            if (output.images && output.images.length > 0) {
              targetNodeId = nId;
              imageInfo = output.images[0];
              console.log(`Found image in node ${nId}`);
              break;
            }
          }
        }
        
        if (!imageInfo) {
          throw new Error('No images found in workflow output');
        }
        
        console.log(`Downloading image: ${imageInfo.filename} from ${imageInfo.type} folder`);
        
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
        console.log(`Downloaded image, size: ${imageBuffer.length} bytes`);
        
        // Determine mime type from response headers or default to PNG
        const contentType = imageResponse.headers['content-type'] || 'image/png';
        const base64Image = `data:${contentType};base64,${imageBuffer.toString('base64')}`;
        
        // Save file if OUTPUT_FILES is enabled
        if (process.env.OUTPUT_FILES === 'true') {
          const outputDir = path.join(process.cwd(), 'outputs', promptId);
          try {
            await fs.mkdir(outputDir, { recursive: true });
            const extension = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
            const fileName = `${imageInfo.filename}`;
            const filePath = path.join(outputDir, fileName);
            await fs.writeFile(filePath, imageBuffer);
            console.log(`Image saved to: ${filePath}`);
          } catch (saveError) {
            console.error('Failed to save output file:', saveError);
          }
        }
        
        clearTimeout(timeoutId);
        resolveWithCleanup({ base64: base64Image, promptId });
        resolved = true;
        
      } catch (error) {
        console.error('Failed to fetch results:', error.message);
        clearTimeout(timeoutId);
        if (!resolved) {
          rejectWithCleanup(new Error(`Failed to fetch results: ${error.message}`));
          resolved = true;
        }
      }
    }
  });
}

module.exports = {
  executeWorkflow
};