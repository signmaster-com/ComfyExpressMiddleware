const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

/**
 * Executes a ComfyUI workflow using polling approach (more reliable than WebSocket)
 * @param {Object} workflowJson - The workflow JSON object
 * @param {string} imageBase64 - The base64 encoded image string
 * @param {string} nodeId - The node ID to get results from (optional)
 * @returns {Promise<{base64: string, promptId: string}>} Promise that resolves with the base64 encoded output image and prompt ID
 */
async function executeWorkflowWithPolling(workflowJson, imageBase64, nodeId = null) {
  console.log(`Starting workflow execution with polling approach`);
  
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
  
  // Define ComfyUI connection parameters
  const comfyHost = process.env.COMFYUI_HOST || '192.168.1.19:8188';
  const useSSL = process.env.COMFYUI_USE_SSL === 'true';
  const httpProtocol = useSSL ? 'https' : 'http';
  const comfyUrl = `${httpProtocol}://${comfyHost}`;
  
  // Construct prompt payload
  const payload = {
    prompt: modifiedWorkflow,
    client_id: clientId
  };
  
  // Send prompt request
  let promptId;
  let promptNumber;
  try {
    console.log(`Submitting prompt to ${comfyUrl}/prompt`);
    const response = await axios.post(`${comfyUrl}/prompt`, payload);
    promptId = response.data.prompt_id;
    promptNumber = response.data.number;
    console.log(`Prompt submitted successfully. Prompt ID: ${promptId}, Number: ${promptNumber}`);
    
    // Check for node errors
    if (response.data.node_errors && Object.keys(response.data.node_errors).length > 0) {
      console.error('Node errors detected:', response.data.node_errors);
      throw new Error(`Workflow validation failed: ${JSON.stringify(response.data.node_errors)}`);
    }
  } catch (error) {
    console.error('ComfyUI prompt request failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw new Error(`ComfyUI prompt request failed: ${error.message}`);
  }
  
  // Poll for completion
  const maxPollingTime = 60000; // 60 seconds
  const pollingInterval = 1000; // 1 second
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxPollingTime) {
    try {
      // Check history for completion
      const historyResponse = await axios.get(`${comfyUrl}/history/${promptId}`);
      const history = historyResponse.data;
      
      if (history[promptId]) {
        console.log('Workflow execution completed!');
        
        const outputs = history[promptId].outputs;
        console.log('Available outputs:', Object.keys(outputs));
        
        // Find the node with images in outputs
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
            const fileName = imageInfo.filename;
            const filePath = path.join(outputDir, fileName);
            await fs.writeFile(filePath, imageBuffer);
            console.log(`Image saved to: ${filePath}`);
          } catch (saveError) {
            console.error('Failed to save output file:', saveError);
          }
        }
        
        return { base64: base64Image, promptId };
      }
      
      // Check queue status
      const queueResponse = await axios.get(`${comfyUrl}/queue`);
      const queue = queueResponse.data;
      
      // Check if our prompt is still in queue or running
      let foundInQueue = false;
      
      // Check running queue
      if (queue.queue_running) {
        for (const item of queue.queue_running) {
          if (item[1] === promptId) {
            foundInQueue = true;
            console.log(`Prompt is currently executing...`);
            break;
          }
        }
      }
      
      // Check pending queue
      if (!foundInQueue && queue.queue_pending) {
        for (const item of queue.queue_pending) {
          if (item[1] === promptId) {
            foundInQueue = true;
            console.log(`Prompt is pending in queue...`);
            break;
          }
        }
      }
      
      // If not found in queue or history, it might have failed
      if (!foundInQueue) {
        console.log('Prompt not found in queue, checking for errors...');
      }
      
    } catch (error) {
      console.error('Error during polling:', error.message);
      // Continue polling unless it's a critical error
      if (error.response && error.response.status >= 500) {
        throw new Error(`ComfyUI server error: ${error.message}`);
      }
    }
    
    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollingInterval));
  }
  
  throw new Error('Workflow execution timed out');
}

/**
 * Alternative simpler approach - just wait and fetch
 */
async function executeWorkflowSimple(workflowJson, imageBase64, nodeId = null) {
  console.log(`Starting simple workflow execution`);
  
  // Generate unique client ID
  const clientId = uuidv4();
  
  // Deep clone and update workflow
  const modifiedWorkflow = JSON.parse(JSON.stringify(workflowJson));
  
  for (const nodeId in modifiedWorkflow) {
    const node = modifiedWorkflow[nodeId];
    if (node._meta && node._meta.name === 'InputImageBase64') {
      let base64String = imageBase64;
      if (imageBase64.includes(',')) {
        base64String = imageBase64.split(',')[1];
      }
      node.inputs.image = base64String;
    }
  }
  
  const comfyHost = process.env.COMFYUI_HOST || '192.168.1.19:8188';
  const useSSL = process.env.COMFYUI_USE_SSL === 'true';
  const httpProtocol = useSSL ? 'https' : 'http';
  const comfyUrl = `${httpProtocol}://${comfyHost}`;
  
  // Submit prompt
  const response = await axios.post(`${comfyUrl}/prompt`, {
    prompt: modifiedWorkflow,
    client_id: clientId
  });
  
  const promptId = response.data.prompt_id;
  console.log(`Prompt submitted: ${promptId}`);
  
  // Simple wait approach - adjust based on your workflow complexity
  const waitTime = 10000; // 10 seconds
  console.log(`Waiting ${waitTime}ms for completion...`);
  await new Promise(resolve => setTimeout(resolve, waitTime));
  
  // Fetch results
  const historyResponse = await axios.get(`${comfyUrl}/history/${promptId}`);
  const history = historyResponse.data;
  
  if (!history[promptId]) {
    throw new Error('No results found after waiting');
  }
  
  const outputs = history[promptId].outputs;
  
  // Find image
  for (const [nId, output] of Object.entries(outputs)) {
    if (output.images && output.images.length > 0) {
      const imageInfo = output.images[0];
      
      // Download image
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
      
      return { base64: base64Image, promptId };
    }
  }
  
  throw new Error('No images found in output');
}

module.exports = {
  executeWorkflowWithPolling,
  executeWorkflowSimple
};