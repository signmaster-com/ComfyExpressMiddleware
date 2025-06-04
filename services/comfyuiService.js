const WebSocket = require('ws');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const { getLoadBalancer } = require('./loadBalancer');

/**
 * Executes a ComfyUI workflow with a base64 image input
 * @param {Object} workflowJson - The workflow JSON object
 * @param {string} imageBase64 - The base64 encoded image string
 * @param {string} nodeId - The node ID to get results from (optional)
 * @returns {Promise<{base64: string, promptId: string}>} Promise that resolves with the base64 encoded output image and prompt ID
 */
async function executeWorkflow(workflowJson, imageBase64, nodeId = null) {
  console.log(`Starting workflow execution`);
  
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
  } catch (error) {
    console.error('ComfyUI prompt request failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    // Decrement active jobs on failure
    loadBalancer.decrementActiveJobs(comfyHost);
    
    // Mark instance as unhealthy if connection refused or timeout
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      loadBalancer.markUnhealthy(comfyHost);
      console.error(`Marked instance ${comfyHost} as unhealthy due to connection error: ${error.code}`);
    }
    
    throw new Error('ComfyUI prompt request failed');
  }
  
  // Monitor execution via WebSocket
  return new Promise((resolve, reject) => {
    console.log(`Attempting to connect to WebSocket: ${comfyWsUrl}`);
    
    const ws = new WebSocket(comfyWsUrl);
    let resolved = false;
    let executionCompleted = false;
    
    // Ensure we always decrement active jobs
    const cleanup = () => {
      loadBalancer.decrementActiveJobs(comfyHost);
    };
    
    const resolveWithCleanup = (result) => {
      cleanup();
      resolve(result);
    };
    
    const rejectWithCleanup = (error) => {
      cleanup();
      reject(error);
    };
    
    // Set up timeout
    const timeoutDuration = 60000; // 60 seconds
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        console.error('ComfyUI execution timed out');
        ws.close();
        rejectWithCleanup(new Error('ComfyUI execution timed out'));
        resolved = true;
      }
    }, timeoutDuration);
    
    ws.on('open', () => {
      console.log('WebSocket connection established with ComfyUI');
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clearTimeout(timeoutId);
      ws.close();
      if (!resolved) {
        // Mark instance as unhealthy on connection error
        loadBalancer.markUnhealthy(comfyHost);
        console.error(`Marked instance ${comfyHost} as unhealthy due to WebSocket error`);
        rejectWithCleanup(new Error('ComfyUI WebSocket connection error'));
        resolved = true;
      }
    });
    
    ws.on('close', (code, reason) => {
      console.log(`WebSocket connection closed. Code: ${code}, Reason: ${reason.toString()}`);
      clearTimeout(timeoutId);
      
      // If execution completed, fetch the results
      if (executionCompleted && !resolved) {
        fetchResults();
      } else if (!resolved) {
        rejectWithCleanup(new Error(`WebSocket closed unexpectedly: ${reason}`));
        resolved = true;
      }
    });
    
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('Received WebSocket message:', {
          type: message.type,
          ...(message.data && message.data.node ? { node: message.data.node } : {}),
          ...(message.data && message.data.prompt_id ? { prompt_id: message.data.prompt_id } : {})
        });
        
        // Check for execution completion
        if (message.type === 'executing' && message.data) {
          if (message.data.prompt_id === promptId && message.data.node === null) {
            console.log('Workflow execution completed!');
            executionCompleted = true;
            ws.close(); // This will trigger the close event which will fetch results
          }
        }
        
        // Check for execution errors
        if (message.type === 'execution_error' && message.data) {
          console.error('Execution error:', message.data);
          clearTimeout(timeoutId);
          ws.close();
          if (!resolved) {
            rejectWithCleanup(new Error(`ComfyUI execution error: ${JSON.stringify(message.data)}`));
            resolved = true;
          }
        }
      } catch (parseError) {
        // Ignore non-JSON messages (binary preview data)
        if (Buffer.isBuffer(data)) {
          console.log(`Received binary data of size: ${data.length} bytes (preview image, ignoring)`);
        }
      }
    });
    
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