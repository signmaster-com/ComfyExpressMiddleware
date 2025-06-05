# ComfyUI Express Middleware

A production-ready Express.js middleware server that provides a simplified REST API interface for ComfyUI workflows. This middleware enables asynchronous job processing, load balancing across multiple ComfyUI instances, comprehensive monitoring, and robust error handling.

## 🚀 Features

### Core Functionality
- **Asynchronous Job Processing**: Submit jobs and track progress with unique job IDs
- **Dual Processing Modes**: Synchronous (immediate response) and asynchronous (background processing)
- **Load Balancing**: Intelligent distribution across multiple ComfyUI instances
- **Health Monitoring**: Circuit breaker patterns with automatic failover
- **Connection Pooling**: Persistent WebSocket connections for optimal performance

### Workflow Support
- **Background Removal**: Remove backgrounds using InspyrenetRembg
- **Image Upscaling**: 4x upscaling using NMKD-Siax model
- **Extensible Architecture**: Easy to add new ComfyUI workflows

### Monitoring & Operations
- **Comprehensive Metrics**: Job processing statistics, performance KPIs, error tracking
- **Structured Logging**: JSON-formatted logs with request tracing
- **Health Endpoints**: System status, metrics, and operational monitoring
- **Job Management**: Complete CRUD operations for job lifecycle management

### Enterprise Features
- **Circuit Breakers**: Automatic fault tolerance and recovery
- **Graceful Degradation**: Keeps jobs pending when instances are unhealthy
- **Automatic Cleanup**: Configurable job expiration and memory management
- **File Output Support**: Optional disk storage for generated images

## 📦 Quick Start

### Prerequisites
- Node.js 18+ 
- One or more ComfyUI instances running with required models
- ComfyUI custom nodes: `ETN_LoadImageBase64` for image input

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd ComfyExpressMiddleware
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your ComfyUI instance details
   ```

4. **Start the server**
   ```bash
   # Development (with file watching)
   npm run dev
   
   # Production
   npm start
   ```

### Basic Usage

**Submit an asynchronous job:**
```bash
curl -X POST -F "imageFile=@image.jpg" \
  http://localhost:3000/api/async/remove-background
```

**Check job status:**
```bash
curl http://localhost:3000/api/jobs/{job_id}/status
```

**Get completed result:**
```bash
curl http://localhost:3000/api/jobs/{job_id}/result
```

## 🏗️ Architecture

### System Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Client    │───▶│  Express.js     │───▶│  ComfyUI       │
│                 │    │  Middleware     │    │  Instance 1     │
└─────────────────┘    │                 │    └─────────────────┘
                       │  ┌───────────┐  │    ┌─────────────────┐
                       │  │Job Manager│  │───▶│  ComfyUI       │
                       │  └───────────┘  │    │  Instance 2     │
                       │  ┌───────────┐  │    └─────────────────┘
                       │  │Processor  │  │
                       │  └───────────┘  │
                       └─────────────────┘
```

### Core Services

- **Job Manager**: In-memory job tracking with automatic cleanup
- **Job Processor**: Background worker for concurrent job execution
- **Load Balancer**: Instance selection and health monitoring
- **Connection Manager**: WebSocket connection pooling
- **Health Checker**: Circuit breaker pattern implementation
- **Metrics Service**: Performance tracking and operational data

### Request Flow

1. **Job Submission**: Client uploads image → Job created with unique ID
2. **Background Processing**: JobProcessor picks up pending jobs
3. **Instance Selection**: Load balancer selects healthiest instance
4. **Workflow Execution**: Submit to ComfyUI via REST + WebSocket monitoring
5. **Result Retrieval**: Download images from ComfyUI history API
6. **Job Completion**: Update status and store results

## 🔧 Configuration

### Environment Variables

```env
# Server Configuration
PORT=3000                          # Server port
LOG_LEVEL=info                     # Logging level (error, warn, info, debug)

# ComfyUI Configuration
COMFYUI_HOST=192.168.1.19:8188     # Primary ComfyUI instance
COMFYUI_USE_SSL=false              # Use HTTPS for ComfyUI connections
OUTPUT_FILES=false                 # Save generated images to disk

# Connection Management
MAX_CONNECTIONS_PER_INSTANCE=3     # WebSocket connections per instance
MAX_CONCURRENT_JOBS=4              # Total concurrent jobs across all instances
MAX_JOBS_PER_INSTANCE=2            # Concurrent jobs per ComfyUI instance

# Job Processing
JOB_TIMEOUT=300000                 # Job timeout (5 minutes)
JOB_CLEANUP_INTERVAL=600000        # Cleanup interval (10 minutes)
JOB_PROCESSING_INTERVAL=1000       # Processor polling interval (1 second)

# Metrics & Monitoring
METRICS_FILE_PATH=./data/metrics/metrics.json  # Metrics persistence
METRICS_SAVE_INTERVAL=300000       # Auto-save interval (5 minutes)
```

### Multiple ComfyUI Instances

Configure multiple instances by setting `COMFYUI_HOST` to a comma-separated list:
```env
COMFYUI_HOST=192.168.1.19:8188,192.168.1.20:8188
```

## 📋 API Reference

### Processing Endpoints

| Method | Endpoint | Description | Details |
|--------|----------|-------------|---------|
| `POST` | `/api/remove-background` | Remove background (sync/async) | [More →](./documentation/API_Reference.md#background-removal) |
| `POST` | `/api/upscale-image` | Upscale image (sync/async) | [More →](./documentation/API_Reference.md#image-upscaling) |
| `POST` | `/api/async/remove-background` | Remove background (async only) | [More →](./documentation/API_Reference.md#dedicated-asynchronous-processing) |
| `POST` | `/api/async/upscale-image` | Upscale image (async only) | [More →](./documentation/API_Reference.md#dedicated-asynchronous-processing-1) |

### Job Management

| Method | Endpoint | Description | Details |
|--------|----------|-------------|---------|
| `GET` | `/api/jobs/{job_id}/status` | Get job status and progress | [More →](./documentation/API_Reference.md#get-job-status) |
| `GET` | `/api/jobs/{job_id}/result` | Get completed job result | [More →](./documentation/API_Reference.md#get-job-result) |
| `GET` | `/api/jobs/list` | List jobs with filtering | [More →](./documentation/API_Reference.md#list-jobs) |
| `GET` | `/api/jobs/{jobId}/info` | Get detailed job information | [More →](./documentation/API_Reference.md#get-job-details) |
| `DELETE` | `/api/jobs/{jobId}` | Delete specific job | [More →](./documentation/API_Reference.md#delete-job) |
| `POST` | `/api/jobs/cleanup` | Trigger manual cleanup | [More →](./documentation/API_Reference.md#manual-cleanup) |

### Monitoring & Status

| Method | Endpoint | Description | Details |
|--------|----------|-------------|---------|
| `GET` | `/health` | System health check | [More →](./documentation/API_Reference.md#system-health) |
| `GET` | `/status` | Quick status for load balancers | [More →](./documentation/API_Reference.md#quick-status-check) |
| `GET` | `/status/metrics` | Basic operational metrics | [More →](./documentation/API_Reference.md#basic-metrics) |
| `GET` | `/api/metrics` | Comprehensive system metrics | [More →](./documentation/API_Reference.md#system-metrics) |
| `GET` | `/api/metrics/performance` | Performance metrics and KPIs | [More →](./documentation/API_Reference.md#performance-metrics) |
| `GET` | `/api/metrics/errors` | Error rates and failures | [More →](./documentation/API_Reference.md#error-metrics) |

### Response Examples

**Job Status Response:**
```json
{
  "job_id": "abc123",
  "status": "processing",
  "type": "remove-background",
  "processing_time_seconds": 15,
  "estimated_remaining_time_seconds": 30,
  "progress_percentage": 33,
  "comfyui_instance": "192.168.1.19:8188"
}
```

**Health Check Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": { "total_uptime_hours": 24.5 },
  "comfyui_instances": {
    "total": 2,
    "healthy": 2
  },
  "job_processing": {
    "processor_running": true,
    "active_jobs": 2
  }
}
```

## 🔍 Monitoring & Observability

### Structured Logging

The system provides comprehensive structured logging:

- **Request Logging**: HTTP requests with duration and response codes
- **Job Logging**: Per-job tracking with processing times
- **Error Tracking**: Detailed error context with stack traces
- **Service Logging**: Component-level operational logs

**Log Output Example:**
```json
{
  "timestamp": "2025-06-04 12:44:18.415",
  "level": "info",
  "service": "comfyui-middleware",
  "message": "Job completed successfully",
  "component": "job-processor",
  "jobId": "abc123",
  "jobType": "remove-background",
  "instance": "192.168.1.19:8188",
  "processingDuration": 3450,
  "resultSize": 1048576
}
```

### Metrics Collection

The system tracks comprehensive operational metrics:

- **Job Statistics**: Processing times, success rates, throughput
- **Instance Metrics**: Per-instance utilization and health
- **Performance KPIs**: P95 processing times, jobs per hour
- **Error Tracking**: Failure rates and error categorization

### Health Monitoring

- **Circuit Breakers**: Automatic instance failure detection
- **Health Endpoints**: `/health`, `/status` for monitoring integration
- **Graceful Degradation**: Jobs remain pending when instances recover

## 🛠️ Development

### Project Structure

```
├── app.js                 # Express application setup
├── server.js              # Main entry point
├── routes/                # API endpoint handlers
│   ├── asyncJobHandler.js
│   ├── jobStatusHandler.js
│   ├── metricsHandler.js
│   └── statusHandler.js
├── services/              # Core business logic
│   ├── jobManager.js
│   ├── jobProcessor.js
│   ├── loadBalancer.js
│   ├── healthChecker.js
│   └── metrics.js
├── middleware/            # Express middleware
│   └── requestLogger.js
├── utils/                 # Utility functions
│   ├── logger.js
│   └── imageUtils.js
├── workflows.js           # ComfyUI workflow definitions
└── documentation/         # Additional documentation
```

### Adding New Workflows

1. **Define workflow in `workflows.js`:**
   ```javascript
   function getMyCustomWorkflow() {
     return {
       // ComfyUI workflow JSON
     };
   }
   ```

2. **Register in JobProcessor:**
   ```javascript
   this.workflowMap = {
     'my-custom-workflow': {
       workflow: getMyCustomWorkflow,
       targetNode: 'output_node_id'
     }
   };
   ```

3. **Add API endpoint in routes:**
   ```javascript
   app.post('/api/my-custom-workflow', upload.single('imageFile'), handleMyCustomWorkflow);
   ```

### Testing

```bash
# Test background removal
curl -X POST -F "imageFile=@test.jpg" http://localhost:3000/api/async/remove-background

# Check system health
curl http://localhost:3000/health

# View metrics
curl http://localhost:3000/api/metrics
```

## 📊 Performance

### Benchmarks

- **Concurrent Jobs**: 4 jobs across 2 instances
- **Processing Times**: 
  - Background removal: ~30-45 seconds
  - Image upscaling: ~45-60 seconds
- **Throughput**: ~80-120 jobs/hour depending on instance specs

### Optimization Tips

1. **Scale ComfyUI Instances**: Add more GPU instances for higher throughput
2. **Adjust Concurrency**: Tune `MAX_CONCURRENT_JOBS` based on hardware
3. **Memory Management**: Configure job cleanup intervals appropriately
4. **Connection Pooling**: Maintain persistent WebSocket connections

## 🔒 Security

### Input Validation
- File type validation (PNG, JPEG only)
- File size limits (10MB default)
- Workflow structure validation

### Operational Security
- No sensitive data in logs
- Configurable job timeouts
- Automatic cleanup of temporary data
- Request ID tracking for audit trails

## 🚨 Troubleshooting

### Common Issues

**Jobs stuck in pending state:**
- Check ComfyUI instance health: `GET /health`
- Verify network connectivity to ComfyUI instances
- Check logs for connection errors

**High memory usage:**
- Reduce `JOB_CLEANUP_INTERVAL` for faster cleanup
- Lower `MAX_CONCURRENT_JOBS` if needed
- Monitor job completion rates

**WebSocket connection errors:**
- Verify ComfyUI WebSocket endpoint accessibility
- Check firewall settings
- Monitor connection pool status

### Debug Commands

```bash
# Check job status
curl http://localhost:3000/api/jobs/stats

# View processor status  
curl http://localhost:3000/api/jobs/processor/stats

# Force cleanup
curl -X POST http://localhost:3000/api/jobs/cleanup

# Check detailed metrics
curl http://localhost:3000/api/metrics/performance
```

## 📚 Additional Documentation

- [API Reference](./documentation/API_Reference.md) - Complete API specification with examples
- [Development Guide](./documentation/ComfyUI_Middleware_Development_Guide.md) - Comprehensive guide for developers  
- [Postman Collection](./documentation/ComfyUI-Express-Middleware.postman_collection.json) - API testing collection
