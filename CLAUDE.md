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

## Architecture Overview

This is an Express.js middleware server that provides a simplified API interface for ComfyUI workflows. The architecture follows a layered approach:

### Entry Points
- `server.js` - Main entry point that loads environment variables and starts the Express server
- `app.js` - Express application configuration with routes and middleware setup

### Core Components

1. **Routes Layer** (`/routes`)
   - `removeBackgroundHandler.js` - Handles `/api/remove-background` endpoint
   - `upscaleImageHandler.js` - Handles `/api/upscale-image` endpoint
   - Both routes accept image uploads via `multipart/form-data` with field name `imageFile`

2. **Services Layer** (`/services`)
   - `comfyuiService.js` - Core service that handles ComfyUI integration
     - Manages WebSocket connections for real-time workflow execution
     - Handles prompt submission and result retrieval
     - Supports optional file output saving

3. **Workflows** (`workflows.js`)
   - Contains ComfyUI workflow definitions as JavaScript functions
   - `getRemoveBackgroundWorkflow()` - Background removal using InspyrenetRembg
   - `getUpscaleImageWorkflow()` - Image upscaling using 4x_NMKD-Siax model
   - Workflows use `ETN_LoadImageBase64` for input and `SaveImage` for output

### Communication Flow
1. Client uploads image to Express endpoint
2. Handler converts image to base64
3. Workflow is loaded and image is injected into `InputImageBase64` nodes
4. Service submits workflow to ComfyUI via REST API
5. WebSocket monitors execution completion (when node=null)
6. Results are fetched from `/history/{prompt_id}` endpoint
7. Images are downloaded via `/view` endpoint
8. Result is converted to base64 and returned to client

### Important Notes on ComfyUI Integration
- Use `SaveImage` nodes instead of `ETN_SendImageWebSocket` for reliable output
- WebSocket is used only for monitoring execution status, not receiving images
- Images must be fetched from the history API after workflow completion
- The `/view` endpoint is used to download the actual image files
- Alternative polling-based approach available in `comfyuiServicePolling.js`

### Key Design Decisions
- Uses WebSocket for real-time monitoring instead of polling
- Workflows are defined in JavaScript for easy modification
- Base64 encoding used for image transport between services
- Supports both PNG and JPEG image formats
- Optional file output saving for debugging
- 60-second timeout for workflow execution
- Error handling at each layer with detailed logging