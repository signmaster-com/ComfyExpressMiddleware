# Upscale Remove Background API Endpoint

## Overview
The upscale-remove-bg endpoint combines image upscaling and background removal in a single workflow, providing both synchronous and asynchronous processing options.

## Endpoints

### Synchronous Processing
**URL:** `POST /api/upscale-remove-bg`  
**Response:** Immediate result with processed image

### Asynchronous Processing  
**URL:** `POST /api/async/upscale-remove-bg`  
**Response:** Job ID for status tracking

## Request Format

### Headers
- `Content-Type: multipart/form-data`

### Body Parameters
- **imageFile** (required): Image file to process (form-data file upload)
- **format** (optional): Output image format
  - Accepted values: `PNG`, `JPEG`, `WEBP`
  - Default: `PNG`
  - Can be provided as form field or query parameter

## Response Formats

### Synchronous Response (200 OK)
```json
{
  "imageBase64": "data:image/png;base64,iVBORw0KGgoAAAANS...",
  "promptId": "77f5324b-a586-4d59-984e-4eab600e56ef",
  "jobId": "2d94d2b0-1724-4c24-ace3-c855978974f8",
  "format": "PNG"
}
```

### Asynchronous Response (202 Accepted)
```json
{
  "job_id": "2d94d2b0-1724-4c24-ace3-c855978974f8",
  "status": "pending",
  "message": "Job submitted successfully. Use /api/jobs/{job_id}/status to track progress.",
  "estimated_completion_time": "60-180 seconds",
  "status_url": "/api/jobs/2d94d2b0-1724-4c24-ace3-c855978974f8/status",
  "result_url": "/api/jobs/2d94d2b0-1724-4c24-ace3-c855978974f8/result",
  "format": "PNG"
}
```

## Asynchronous Job Management

### Check Job Status
**URL:** `GET /api/jobs/{job_id}/status`

**Response:**
```json
{
  "job_id": "2d94d2b0-1724-4c24-ace3-c855978974f8",
  "status": "completed",
  "type": "upscale-remove-bg",
  "created_time": "2024-01-15T10:30:00.000Z",
  "completed_time": "2024-01-15T10:31:30.000Z",
  "processing_time_seconds": 90,
  "result_url": "/api/jobs/2d94d2b0-1724-4c24-ace3-c855978974f8/result",
  "progress_percentage": 100
}
```

### Get Job Result
**URL:** `GET /api/jobs/{job_id}/result`

**Response:**
```json
{
  "job_id": "2d94d2b0-1724-4c24-ace3-c855978974f8",
  "status": "completed",
  "type": "upscale-remove-bg",
  "completed_time": "2024-01-15T10:31:30.000Z",
  "processing_time_seconds": 90,
  "result": {
    "image_base64": "data:image/png;base64,iVBORw0KGgoAAAANS...",
    "prompt_id": "77f5324b-a586-4d59-984e-4eab600e56ef"
  }
}
```

## Processing Details

### Workflow Steps
1. **Image Upload**: Accepts PNG, JPEG, or other common image formats
2. **Upscaling**: Uses 4x_NMKD-Siax_200k model to upscale by 4x
3. **Downscaling**: Reduces by 50% (0.5 scale factor), resulting in 2x original size
4. **Background Removal**: Uses InspyrenetRembg to remove background
5. **Compression**: ImageCompressor outputs in requested format

### Output Characteristics
- Final image is 2x the original dimensions
- Background is removed (transparent for PNG/WEBP)
- Format can be PNG (with transparency), JPEG (white background), or WEBP (with transparency)

### Comparison with Other Endpoints
- **remove-background**: Outputs at original size (1x)
- **upscale-image**: Outputs at 1x size (4x upscale then 0.25 downscale)
- **upscale-remove-bg**: Outputs at 2x size (4x upscale then 0.5 downscale)

## Usage Examples

### cURL - Synchronous with JPEG output
```bash
curl -X POST \
  -F "imageFile=@input.jpg" \
  -F "format=JPEG" \
  http://localhost:3000/api/upscale-remove-bg
```

### cURL - Asynchronous with WEBP output
```bash
# Submit job
curl -X POST \
  -F "imageFile=@input.png" \
  -F "format=WEBP" \
  http://localhost:3000/api/async/upscale-remove-bg

# Check status (use job_id from previous response)
curl http://localhost:3000/api/jobs/{job_id}/status

# Get result when completed
curl http://localhost:3000/api/jobs/{job_id}/result
```

### JavaScript/Fetch Example
```javascript
// Synchronous request
const formData = new FormData();
formData.append('imageFile', fileInput.files[0]);
formData.append('format', 'PNG');

const response = await fetch('/api/upscale-remove-bg', {
  method: 'POST',
  body: formData
});

const result = await response.json();
// result.imageBase64 contains the processed image
```

## Error Responses

### 400 Bad Request
```json
{
  "error": "No image file provided",
  "details": "Please upload an image file with field name 'imageFile'"
}
```

```json
{
  "error": "Invalid format",
  "details": "Format must be one of: PNG, JPEG, WEBP"
}
```

### 500 Internal Server Error
```json
{
  "error": "Failed to process image",
  "details": "Workflow execution failed: ..."
}
```

## Notes
- Processing time varies based on image size and server load
- Estimated completion time is 60-180 seconds for async processing
- The job_id can be used to track processing status and retrieve results
- Output files are saved in `data/outputs/{job_id}/` directory when OUTPUT_FILES=true
- Both transparent (PNG/WEBP) and non-transparent (JPEG) outputs are supported