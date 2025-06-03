const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Simple test to verify the middleware works
async function testMiddleware() {
  const serverUrl = 'http://localhost:3000';
  
  // Create a simple test image (1x1 pixel PNG as base64)
  const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const testImageBuffer = Buffer.from(testImageBase64, 'base64');
  
  try {
    console.log('Testing middleware endpoints...');
    
    // Test remove background endpoint
    console.log('\n1. Testing /api/remove-background');
    const formData = new FormData();
    const blob = new Blob([testImageBuffer], { type: 'image/png' });
    formData.append('imageFile', blob, 'test.png');
    
    try {
      const response = await axios.post(`${serverUrl}/api/remove-background`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 70000 // 70 second timeout
      });
      
      if (response.data.imageBase64) {
        console.log('✓ Remove background successful');
        console.log(`  Prompt ID: ${response.data.promptId}`);
        console.log(`  Image size: ${response.data.imageBase64.length} characters`);
      } else {
        console.log('✗ Remove background failed - no image returned');
      }
    } catch (error) {
      console.log('✗ Remove background failed:', error.message);
    }
    
    // Test upscale endpoint
    console.log('\n2. Testing /api/upscale-image');
    try {
      const response = await axios.post(`${serverUrl}/api/upscale-image`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 70000 // 70 second timeout
      });
      
      if (response.data.imageBase64) {
        console.log('✓ Image upscale successful');
        console.log(`  Prompt ID: ${response.data.promptId}`);
        console.log(`  Image size: ${response.data.imageBase64.length} characters`);
      } else {
        console.log('✗ Image upscale failed - no image returned');
      }
    } catch (error) {
      console.log('✗ Image upscale failed:', error.message);
    }
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

// Alternative test using curl-like approach
function createCurlTestCommands() {
  console.log('\nCurl commands for testing:');
  console.log('\n# Test remove background:');
  console.log('curl -X POST http://localhost:3000/api/remove-background \\');
  console.log('  -F "imageFile=@path/to/your/test-image.png" \\');
  console.log('  -H "Content-Type: multipart/form-data"');
  
  console.log('\n# Test upscale image:');
  console.log('curl -X POST http://localhost:3000/api/upscale-image \\');
  console.log('  -F "imageFile=@path/to/your/test-image.png" \\');
  console.log('  -H "Content-Type: multipart/form-data"');
}

if (require.main === module) {
  console.log('Starting middleware tests...');
  testMiddleware().then(() => {
    createCurlTestCommands();
    console.log('\nTest completed.');
  });
}

module.exports = { testMiddleware };