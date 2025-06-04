# ComfyUI Express Middleware - Development Guide

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Components](#core-components)
3. [Job Processing System](#job-processing-system)
4. [Load Balancing & Health Monitoring](#load-balancing--health-monitoring)
5. [API Implementation](#api-implementation)
6. [Monitoring & Metrics](#monitoring--metrics)
7. [Error Handling](#error-handling)
8. [Performance Optimization](#performance-optimization)
9. [Security Considerations](#security-considerations)
10. [Extending the System](#extending-the-system)

## Architecture Overview

This Express.js middleware follows a layered architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                    Express.js Application                   │
├─────────────────────────────────────────────────────────────┤
│  Routes Layer                                               │
│  ├── asyncJobHandler.js     (Async job endpoints)          │
│  ├── jobStatusHandler.js    (Job management API)           │
│  ├── metricsHandler.js      (Metrics and monitoring)       │
│  └── statusHandler.js       (Health checks)                │
├─────────────────────────────────────────────────────────────┤
│  Services Layer                                             │
│  ├── jobManager.js          (In-memory job tracking)       │
│  ├── jobProcessor.js        (Background job execution)     │
│  ├── loadBalancer.js        (Instance selection)           │
│  ├── healthChecker.js       (Circuit breaker pattern)      │
│  ├── connectionManager.js   (WebSocket pooling)            │
│  └── metrics.js             (Operational metrics)          │
├─────────────────────────────────────────────────────────────┤
│  Utilities                                                  │
│  ├── logger.js              (Structured logging)           │
│  └── imageUtils.js          (Image processing utilities)   │
└─────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Asynchronous First**: All I/O operations use async/await
2. **Separation of Concerns**: Each service has a single responsibility
3. **Fault Tolerance**: Circuit breakers and graceful degradation
4. **Observability**: Comprehensive logging and metrics
5. **Scalability**: Horizontal scaling through multiple ComfyUI instances

## Core Components

### 1. Job Manager (`jobManager.js`)

The JobManager provides lightweight in-memory job tracking with automatic cleanup:

```javascript
const { getJobManager } = require('./services/jobManager');

// Create a new job
const jobManager = getJobManager();
const jobId = jobManager.createJob('remove-background', {
  imageBase64: 'data:image/png;base64,...',
  imageSize: 1024768,
  mimeType: 'image/png'
});

// Update job status
jobManager.updateJobStatus(jobId, 'processing', {
  comfyuiInstance: '192.168.1.19:8188',
  processingStartTime: Date.now()
});

// Retrieve job
const job = jobManager.getJob(jobId);
```

**Key Features:**
- O(1) job access using Map data structure
- Automatic cleanup with configurable timeouts
- Job state management (pending, processing, completed, failed)
- Instance tracking for load balancing

### 2. Job Processor (`jobProcessor.js`)

The JobProcessor handles background job execution across multiple ComfyUI instances:

```javascript
const { getJobProcessor } = require('./services/jobProcessor');

// Start the processor
const processor = getJobProcessor();
processor.start();

// Add a job to the queue
const jobId = processor.addJob('remove-background', {
  imageBase64: imageData,
  originalFilename: 'image.jpg'
});
```

**Processing Flow:**
1. Poll for pending jobs every second
2. Select optimal ComfyUI instance
3. Submit workflow via REST API
4. Monitor execution via WebSocket
5. Fetch results from history API
6. Update job status and store results

### 3. Load Balancer (`loadBalancer.js`)

Intelligent instance selection based on health and current load:

```javascript
const { getLoadBalancer } = require('./services/loadBalancer');

const loadBalancer = getLoadBalancer();

// Get the best available instance
const instance = await loadBalancer.getHealthyInstance();

// Mark instance as unhealthy
loadBalancer.markUnhealthy('192.168.1.19:8188');
```

**Selection Algorithm:**
- Health check verification before job assignment
- Round-robin among healthy instances
- Load-based selection (least loaded first)
- Automatic failover when instances become unhealthy

### 4. Health Checker (`healthChecker.js`)

Circuit breaker pattern implementation for fault tolerance:

```javascript
const { getLoadBalancer } = require('./services/loadBalancer');

const healthChecker = loadBalancer.healthChecker;

// Check specific instance health
const isHealthy = await healthChecker.checkBeforeJob('instance-1');

// Get all healthy instances
const healthyInstances = healthChecker.getHealthyInstances();
```

**Circuit Breaker States:**
- **Closed**: All requests pass through normally
- **Open**: All requests fail fast (instance marked unhealthy)
- **Half-Open**: Test requests to check if instance recovered

## Job Processing System

### Job Lifecycle

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   PENDING   │───▶│ PROCESSING  │───▶│ COMPLETED   │───▶│   CLEANUP   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
       │                   │                              
       │                   ▼                              
       │            ┌─────────────┐                       
       └───────────▶│   FAILED    │                       
                    └─────────────┘                       
```

### Concurrent Processing

The system supports concurrent processing across multiple instances:

```javascript
// Configuration in .env
MAX_CONCURRENT_JOBS=4        // Total concurrent jobs
MAX_JOBS_PER_INSTANCE=2      // Per-instance limit
JOB_PROCESSING_INTERVAL=1000 // Polling interval (ms)
```

**Concurrency Control:**
- Global job limit prevents resource exhaustion
- Per-instance limits prevent overloading single instances
- Real-time job counting tracks active executions
- Intelligent queuing when at capacity

### Workflow Integration

Workflows are defined as JavaScript functions in `workflows.js`:

```javascript
function getRemoveBackgroundWorkflow() {
  return {
    "17": {
      "class_type": "ETN_LoadImageBase64",
      "inputs": {
        "image": "placeholder"
      },
      "_meta": {
        "name": "InputImageBase64"
      }
    },
    "14": {
      "class_type": "InspyrenetRembg",
      "inputs": {
        "images": ["17", 0],
        "model": "u2net",
        "only_mask": false
      }
    },
    "18": {
      "class_type": "SaveImage",
      "inputs": {
        "filename_prefix": "rembg_output",
        "images": ["14", 0]
      }
    }
  };
}
```

**Workflow Registration:**
```javascript
// In JobProcessor constructor
this.workflowMap = {
  'remove-background': {
    workflow: getRemoveBackgroundWorkflow,
    targetNode: '18' // Output node ID
  },
  'upscale-image': {
    workflow: getUpscaleImageWorkflow,
    targetNode: '10'
  }
};
```

## Load Balancing & Health Monitoring

### Health Check Implementation

```javascript
class HealthChecker {
  async performHealthChecks() {
    for (const instance of this.instances) {
      try {
        const response = await axios.get(`${instance.protocol}://${instance.host}/system_stats`, {
          timeout: this.healthCheckTimeout
        });
        
        if (response.status === 200) {
          this.markHealthy(instance.id);
        } else {
          this.markUnhealthy(instance.id, `HTTP ${response.status}`);
        }
      } catch (error) {
        this.markUnhealthy(instance.id, error.message);
      }
    }
  }
}
```

### Circuit Breaker Pattern

```javascript
class CircuitBreaker {
  constructor(name, threshold = 5, timeout = 60000) {
    this.name = name;
    this.failureThreshold = threshold;
    this.timeout = timeout;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
  }

  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error(`Circuit breaker ${this.name} is OPEN`);
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
}
```

## API Implementation

### RESTful Endpoint Design

The API follows REST principles with clear resource hierarchies:

```javascript
// Processing endpoints
app.post('/api/remove-background', handleRemoveBackground);
app.post('/api/async/remove-background', handleRemoveBackgroundAsync);

// Job management
app.get('/api/jobs/:job_id/status', getJobStatus);
app.get('/api/jobs/:job_id/result', getJobResult);
app.get('/api/jobs/list', getAllJobs);

// System monitoring
app.get('/health', getSystemHealth);
app.get('/api/metrics', getSystemMetrics);
```

### Request/Response Patterns

**Async Job Submission:**
```javascript
async function handleRemoveBackgroundAsync(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided.' });
  }

  const imageBase64 = fileBufferToBase64(req.file.buffer, req.file.mimetype);
  const jobProcessor = getJobProcessor();
  const jobId = jobProcessor.addJob('remove-background', {
    imageBase64,
    imageSize: req.file.buffer.length,
    mimeType: req.file.mimetype,
    originalFilename: req.file.originalname
  });

  res.status(202).json({
    job_id: jobId,
    status: 'pending',
    message: 'Job submitted successfully',
    status_url: `/api/jobs/${jobId}/status`,
    result_url: `/api/jobs/${jobId}/result`
  });
}
```

### Backward Compatibility

The system supports both synchronous and asynchronous modes:

```javascript
// Synchronous processing (legacy)
curl -X POST -F "imageFile=@image.jpg" http://localhost:3000/api/remove-background

// Asynchronous via query parameter
curl -X POST -F "imageFile=@image.jpg" "http://localhost:3000/api/remove-background?async=true"

// Dedicated async endpoint
curl -X POST -F "imageFile=@image.jpg" http://localhost:3000/api/async/remove-background
```

## Monitoring & Metrics

### Structured Logging

The system uses Winston for structured JSON logging:

```javascript
const { createServiceLogger, createJobLogger } = require('../utils/logger');

// Service-level logging
const logger = createServiceLogger('job-processor');
logger.info('JobProcessor initialized', {
  maxConcurrentJobs: this.maxConcurrentJobs,
  processingInterval: this.processingInterval
});

// Job-specific logging
const jobLogger = createJobLogger(job.id, job.type, instance.host);
jobLogger.info('Job completed successfully', {
  processingDuration: 3450,
  resultSize: result?.base64?.length || 0
});
```

### Metrics Collection

The metrics service tracks comprehensive operational data:

```javascript
const { getMetrics } = require('./services/metrics');

const metrics = getMetrics();

// Record job events
metrics.recordJobCreated('remove-background', 'instance-1');
metrics.recordJobCompleted('remove-background', 'instance-1', 3450, true);

// Track performance
metrics.recordInstanceUtilization('instance-1', 0.75);
metrics.recordErrorRate('instance-1', 0.02);
```

**Metrics Categories:**
- **Job Statistics**: Total processed, success rates, processing times
- **Instance Metrics**: Per-instance utilization and health
- **Performance KPIs**: P95 response times, throughput rates
- **Error Tracking**: Failure rates, error categorization

### Health Endpoints

```javascript
// System health check
app.get('/health', async (req, res) => {
  const health = await getSystemHealth();
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Quick status for load balancers
app.get('/status', async (req, res) => {
  const status = await getQuickStatus();
  res.json(status);
});
```

## Error Handling

### Hierarchical Error Handling

```javascript
// Global error handler
app.use((err, req, res, next) => {
  const requestLogger = req.logger || logger;
  
  requestLogger.error('Unhandled error in request processing', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    requestId: req.requestId
  });
  
  if (!res.headersSent) {
    res.status(500).json({ 
      error: 'Internal server error',
      requestId: req.requestId || 'unknown'
    });
  }
});
```

### Graceful Degradation

When ComfyUI instances become unhealthy, the system:

1. **Keeps Jobs Pending**: Jobs remain in queue for retry when instances recover
2. **Circuit Breaker Activation**: Prevents cascading failures
3. **Automatic Recovery**: Health checks detect when instances come back online
4. **Timeout Protection**: Jobs eventually timeout if instances never recover

```javascript
// In JobProcessor.processQueuedJobs()
if (!instance) {
  this.logger.warn('All instances failed pre-job health checks, keeping job pending for retry', {
    jobId: job.id,
    jobType: job.type,
    candidateInstances: availableInstances.length,
    message: 'Job will remain pending until instances recover or timeout expires'
  });
  break; // Stop processing but keep jobs pending
}
```

### Error Recovery Strategies

1. **Retry Logic**: Automatic retries with exponential backoff
2. **Instance Failover**: Automatic switching to healthy instances
3. **Job Timeout**: Prevents indefinite waiting
4. **Resource Cleanup**: Automatic cleanup of failed jobs

## Performance Optimization

### Connection Pooling

WebSocket connections are pooled for efficiency:

```javascript
class ConnectionManager {
  async getConnection(instanceHost) {
    const poolKey = instanceHost;
    
    if (!this.connectionPools.has(poolKey)) {
      this.connectionPools.set(poolKey, new ConnectionPool(instanceHost));
    }
    
    const pool = this.connectionPools.get(poolKey);
    return await pool.getConnection();
  }
}
```

### Memory Management

- **Automatic Job Cleanup**: Configurable cleanup intervals
- **Connection Pool Limits**: Prevent memory leaks
- **Image Buffer Management**: Efficient base64 handling
- **Garbage Collection**: Proper cleanup of temporary objects

### Caching Strategies

```javascript
// Prevent ComfyUI workflow caching
const uniqueTimestamp = Date.now();
const uniqueJobId = `job_${jobId}_${uniqueTimestamp}`;

// Update SaveImage nodes with unique identifiers
if (node.class_type === 'SaveImage' && node.inputs) {
  const originalPrefix = node.inputs.filename_prefix || 'ComfyUI';
  node.inputs.filename_prefix = `${originalPrefix}_${uniqueJobId}`;
}
```

## Security Considerations

### Input Validation

```javascript
// File type validation
const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
if (!allowedMimeTypes.includes(req.file.mimetype)) {
  return res.status(400).json({ error: 'Invalid file type' });
}

// File size limits
const upload = multer({ 
  storage: multer.memoryStorage(), 
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});
```

### Data Sanitization

```javascript
// Remove sensitive data from API responses
function sanitizeJobForListing(job) {
  const sanitized = { ...job };
  
  // Remove base64 from input data
  if (sanitized.data && sanitized.data.imageBase64) {
    sanitized.data = { ...sanitized.data };
    delete sanitized.data.imageBase64;
    sanitized.data.imageBase64_size = '[removed - use result endpoint]';
  }
  
  return sanitized;
}
```

### Request Tracking

```javascript
// Request ID middleware for tracing
const requestLoggerMiddleware = (req, res, next) => {
  req.requestId = uuidv4();
  req.startTime = Date.now();
  req.logger = createRequestLogger(req.requestId);
  
  res.setHeader('X-Request-ID', req.requestId);
  next();
};
```

## Extending the System

### Adding New Workflows

1. **Define Workflow Function:**
```javascript
function getMyCustomWorkflow() {
  return {
    "1": {
      "class_type": "MyCustomNode",
      "inputs": {
        "parameter": "value",
        "image": "placeholder"
      }
    },
    "2": {
      "class_type": "SaveImage",
      "inputs": {
        "filename_prefix": "custom_output",
        "images": ["1", 0]
      }
    }
  };
}
```

2. **Register in JobProcessor:**
```javascript
this.workflowMap = {
  'my-custom-workflow': {
    workflow: getMyCustomWorkflow,
    targetNode: '2'
  }
};
```

3. **Add API Endpoint:**
```javascript
async function handleMyCustomWorkflow(req, res) {
  // Implementation similar to existing handlers
}

app.post('/api/my-custom-workflow', upload.single('imageFile'), handleMyCustomWorkflow);
```

### Custom Metrics

```javascript
// Extend metrics service
class CustomMetrics extends BasicMetrics {
  recordCustomEvent(eventType, data) {
    if (!this.customEvents[eventType]) {
      this.customEvents[eventType] = [];
    }
    
    this.customEvents[eventType].push({
      timestamp: Date.now(),
      data: data
    });
  }
}
```

### Plugin Architecture

```javascript
// Plugin interface
class MiddlewarePlugin {
  constructor(app, services) {
    this.app = app;
    this.services = services;
  }
  
  async initialize() {
    // Plugin initialization
  }
  
  registerRoutes() {
    // Add custom routes
  }
  
  registerMiddleware() {
    // Add custom middleware
  }
}

// Plugin registration
const plugins = [
  new AuthenticationPlugin(app, services),
  new RateLimitingPlugin(app, services),
  new CachingPlugin(app, services)
];

plugins.forEach(plugin => plugin.initialize());
```

## Best Practices

### Development Guidelines

1. **Use TypeScript**: Consider migrating to TypeScript for better type safety
2. **Unit Testing**: Add comprehensive test coverage
3. **API Versioning**: Implement versioning for breaking changes
4. **Documentation**: Maintain up-to-date API documentation
5. **Monitoring**: Set up proper monitoring and alerting

### Production Deployment

1. **Environment Configuration**: Use proper environment variables
2. **Load Balancing**: Deploy behind a reverse proxy
3. **Monitoring**: Integrate with monitoring systems
4. **Logging**: Configure log aggregation
5. **Scaling**: Plan for horizontal scaling

### Performance Tuning

1. **Profile Memory Usage**: Monitor memory consumption patterns
2. **Optimize Concurrency**: Tune job limits based on hardware
3. **Database Integration**: Consider persistent storage for production
4. **Caching**: Implement result caching for repeated workflows
5. **CDN Integration**: Use CDN for image delivery

This development guide provides the foundation for understanding and extending the ComfyUI Express Middleware system. The architecture is designed to be robust, scalable, and maintainable while providing comprehensive monitoring and fault tolerance capabilities.