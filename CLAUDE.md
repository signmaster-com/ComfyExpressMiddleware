# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm start` - Start the server in production mode
- `npm run dev` - Start the server with file watching (auto-reload on changes)

### Environment Setup
Copy `.env.example` to `.env` and configure:
- `PORT` - Server port (default: 3000)
- `COMFYUI_HOST` - ComfyUI host address (default: 192.168.1.19:8188)
- `COMFYUI_USE_SSL` - Use SSL for ComfyUI connection (default: false)
- `OUTPUT_FILES` - Save output files to disk (default: false)
- `MAX_CONNECTIONS_PER_INSTANCE` - Maximum WebSocket connections per ComfyUI instance (default: 3)
- `JOB_TIMEOUT` - Job timeout in milliseconds for automatic cleanup (default: 300000ms / 5 minutes)
- `MAX_CONCURRENT_JOBS` - Maximum concurrent jobs across all instances (default: 4)
- `MAX_JOBS_PER_INSTANCE` - Maximum concurrent jobs per ComfyUI instance (default: 2)
- `JOB_PROCESSING_INTERVAL` - Job processor polling interval in milliseconds (default: 1000ms)

## Architecture Overview

This is an Express.js middleware server that provides a simplified API interface for ComfyUI workflows. The architecture follows a layered approach:

### Entry Points
- `server.js` - Main entry point that loads environment variables and starts the Express server
- `app.js` - Express application configuration with routes and middleware setup

### Core Components

1. **Routes Layer** (`/routes`)
   - `removeBackgroundHandler.js` - Handles `/api/remove-background` endpoint
   - `upscaleImageHandler.js` - Handles `/api/upscale-image` endpoint
   - `jobStatusHandler.js` - Handles job status and management endpoints
   - Both processing routes accept image uploads via `multipart/form-data` with field name `imageFile`

2. **Services Layer** (`/services`)
   - `comfyuiService.js` - Core service that handles ComfyUI integration
     - Manages WebSocket connections for real-time workflow execution
     - Handles prompt submission and result retrieval
     - Supports optional file output saving
     - Integrates with job management for tracking
   - `jobManager.js` - Lightweight in-memory job management system
     - Tracks job states: pending, processing, completed, failed
     - Automatic cleanup after configurable timeout
     - Provides job status queries and statistics
   - `jobProcessor.js` - Background job processor for concurrent execution
     - Processes jobs across multiple ComfyUI instances concurrently
     - Load balances jobs based on instance availability
     - Handles job failures and instance failures gracefully
     - Tracks processing times and instance utilization
   - `connectionManager.js` - WebSocket connection pooling for efficient dual-instance communication
   - `loadBalancer.js` - Load balancing across multiple ComfyUI instances
   - `healthChecker.js` - Health monitoring for ComfyUI instances

3. **Workflows** (`workflows.js`)
   - Contains ComfyUI workflow definitions as JavaScript functions
   - `getRemoveBackgroundWorkflow()` - Background removal using InspyrenetRembg
   - `getUpscaleImageWorkflow()` - Image upscaling using 4x_NMKD-Siax model
   - Workflows use `ETN_LoadImageBase64` for input and `SaveImage` for output

### Communication Flow (Async Mode)
1. Client uploads image to Express endpoint
2. Job is created and added to processing queue with unique ID
3. Handler converts image to base64 and stores in job data
4. Response returned immediately with job ID (202 Accepted)
5. JobProcessor picks up pending jobs and assigns to available instances
6. Job status updated to 'processing' with assigned ComfyUI instance
7. Workflow is loaded and image is injected into `InputImageBase64` nodes
8. Workflow submitted to selected ComfyUI instance via REST API
9. WebSocket monitors execution completion (when node=null)
10. Results are fetched from `/history/{prompt_id}` endpoint
11. Images are downloaded via `/view` endpoint
12. Job status updated to 'completed' with result data and processing time
13. Client can query job status and retrieve results via API

### Important Notes on ComfyUI Integration
- Use `SaveImage` nodes instead of `ETN_SendImageWebSocket` for reliable output
- WebSocket is used only for monitoring execution status, not receiving images
- Images must be fetched from the history API after workflow completion
- The `/view` endpoint is used to download the actual image files
- Alternative polling-based approach available in `comfyuiServicePolling.js`

### API Endpoints

The server provides both synchronous and asynchronous processing endpoints:

**Synchronous Processing Endpoints** (backward compatible):
- `POST /api/remove-background` - Remove background from uploaded image (returns result immediately)
- `POST /api/upscale-image` - Upscale uploaded image (returns result immediately)
- Add `?async=true` or `?mode=async` for asynchronous operation

**Asynchronous Processing Endpoints** (immediate response with job tracking):
- `POST /api/async/remove-background` - Submit background removal job (returns job_id immediately)
- `POST /api/async/upscale-image` - Submit upscaling job (returns job_id immediately)

**Job Status and Results** (async API):
- `GET /api/jobs/{job_id}/status` - Get job status and progress information
- `GET /api/jobs/{job_id}/result` - Get completed job result (image)

**Job Management** (admin API):
- `GET /api/jobs/stats` - Get job manager statistics (total, by status, by type, by instance)
- `GET /api/jobs/processor/stats` - Get job processor statistics (active jobs, instance utilization)
- `GET /api/jobs/list?status=pending&type=remove-background&instance=host` - Get jobs with optional filtering
- `GET /api/jobs/{jobId}/info` - Get specific job details (admin view)
- `DELETE /api/jobs/{jobId}` - Manually delete a specific job
- `POST /api/jobs/cleanup` - Manually trigger cleanup of expired jobs

**Job States**:
- `pending` - Job created, waiting for processing
- `processing` - Job submitted to ComfyUI and executing
- `completed` - Job finished successfully with results
- `failed` - Job failed with error details

### Async API Usage Examples

**Submit job asynchronously:**
```bash
curl -X POST -F "imageFile=@image.jpg" http://localhost:3000/api/async/remove-background
# Returns: 202 Accepted
{
  "job_id": "uuid-string",
  "status": "pending",
  "message": "Job submitted successfully...",
  "estimated_completion_time": "30-60 seconds",
  "status_url": "/api/jobs/{job_id}/status",
  "result_url": "/api/jobs/{job_id}/result"
}
```

**Check job status:**
```bash
curl http://localhost:3000/api/jobs/{job_id}/status
# Returns status with progress information
{
  "job_id": "uuid-string",
  "status": "processing",
  "type": "remove-background",
  "processing_time_seconds": 15,
  "estimated_remaining_time_seconds": 30,
  "progress_percentage": 33,
  "comfyui_instance": "localhost:8188"
}
```

**Get completed result:**
```bash
curl http://localhost:3000/api/jobs/{job_id}/result
# Returns completed image data
{
  "job_id": "uuid-string",
  "status": "completed",
  "result": {
    "image_base64": "data:image/png;base64,...",
    "prompt_id": "comfyui-prompt-id"
  }
}
```

**Backward compatibility:**
```bash
# Synchronous (existing behavior)
curl -X POST -F "imageFile=@image.jpg" http://localhost:3000/api/remove-background

# Asynchronous via query parameter
curl -X POST -F "imageFile=@image.jpg" "http://localhost:3000/api/remove-background?async=true"
```

### Concurrent Processing Architecture

The system implements sophisticated concurrent processing across dual ComfyUI instances:

**Job Distribution:**
- Background JobProcessor monitors pending jobs every second
- Intelligent load balancing selects least-loaded healthy instances
- Configurable limits: max 4 concurrent jobs total, 2 per instance
- Real-time instance job tracking prevents overloading

**Fault Tolerance:**
- Instance health monitoring with circuit breaker pattern
- Automatic failover when instances become unhealthy
- Graceful handling of job failures without affecting other jobs
- Connection pooling maintains persistent WebSocket connections

**Performance Optimization:**
- Concurrent execution across both GPU instances
- Job queue processing with intelligent scheduling
- Processing time tracking for performance monitoring
- Automatic job cleanup prevents memory leaks

### Key Design Decisions
- Uses WebSocket connection pooling for efficient dual-instance communication
- Background job processor enables true concurrent processing across instances
- In-memory job management with automatic cleanup prevents memory leaks
- Intelligent load balancing maximizes GPU utilization
- Workflows are defined in JavaScript for easy modification
- Base64 encoding used for image transport between services
- Supports both PNG and JPEG image formats
- Optional file output saving for debugging
- 60-second timeout for workflow execution
- Error handling at each layer with detailed logging
- Health monitoring ensures system reliability