# ComfyUI Middleware System - Improvement Plan (Revised)

## Executive Summary

This document outlines a focused improvement plan to transform the current ComfyUI middleware into a production-ready system optimized for immediate upload → process → download workflows. The plan addresses critical performance and reliability issues while avoiding over-engineering for the specific use case.

## Current Architecture Analysis

### Strengths
- Correct ComfyUI API integration pattern (submit → monitor → fetch → download)
- Clean code organization with separated concerns
- Multiple reliability approaches (WebSocket + polling fallback)
- Comprehensive error handling with timeouts

### Critical Issues (Prioritized by Business Impact)
1. **Synchronous processing model** - blocks resources during 60s workflows, prevents concurrent processing
2. **No connection pooling** - creates new WebSocket per request, adds 1-2s overhead
3. **Single ComfyUI dependency** - no load balancing across dual GPU setup
4. **Hard failure handling** - no resilience when ComfyUI instances fail
5. **Limited operational visibility** - basic metrics needed for scaling decisions

### Non-Critical (Explicitly Excluded)
- **Persistent job management** - Jobs are consumed immediately, 128GB RAM sufficient
- **Horizontal middleware scaling** - Single instance meets business needs
- **Complex monitoring** - Basic visibility sufficient for current scale

## Improvement Plan

### Phase 1: Multi-ComfyUI Support & Load Balancing

#### 1.1 ComfyUI Instance Load Balancer

**Target Setup:**
- ComfyUI Container 1: localhost:8188 (GPU 0)
- ComfyUI Container 2: localhost:8189 (GPU 1)
- Round-robin load balancing with health checking

**Implementation:**
```javascript
// ComfyUI Load Balancer
class ComfyUILoadBalancer {
  constructor() {
    this.instances = [
      { 
        host: process.env.COMFYUI_HOST_1 || 'localhost:8188',
        healthy: true, 
        activeJobs: 0,
        lastHealthCheck: Date.now()
      },
      { 
        host: process.env.COMFYUI_HOST_2 || 'localhost:8189',
        healthy: true, 
        activeJobs: 0,
        lastHealthCheck: Date.now()
      }
    ];
    this.currentIndex = 0;
  }
  
  getAvailableInstance() {
    const healthyInstances = this.instances.filter(i => i.healthy);
    if (healthyInstances.length === 0) {
      throw new Error('No healthy ComfyUI instances available');
    }
    
    // Round-robin with job count consideration
    const sortedInstances = healthyInstances.sort((a, b) => a.activeJobs - b.activeJobs);
    return sortedInstances[0];
  }
}
```

#### 1.2 Health Checking & Circuit Breaker

**Health Check Strategy:**
- Ping `/system_stats` endpoint every 30 seconds
- Mark instance unhealthy after 3 consecutive failures
- Auto-recovery when health check succeeds

```javascript
class InstanceHealthChecker {
  constructor(loadBalancer) {
    this.loadBalancer = loadBalancer;
    this.healthCheckInterval = 30000; // 30 seconds
    this.failureThreshold = 3;
  }
  
  async checkInstanceHealth(instance) {
    try {
      const response = await axios.get(`http://${instance.host}/system_stats`, {
        timeout: 5000
      });
      
      if (response.status === 200) {
        instance.healthy = true;
        instance.consecutiveFailures = 0;
        console.log(`Instance ${instance.host} is healthy`);
      }
    } catch (error) {
      instance.consecutiveFailures = (instance.consecutiveFailures || 0) + 1;
      
      if (instance.consecutiveFailures >= this.failureThreshold) {
        instance.healthy = false;
        console.warn(`Instance ${instance.host} marked unhealthy after ${instance.consecutiveFailures} failures`);
      }
    }
    
    instance.lastHealthCheck = Date.now();
  }
  
  startHealthChecking() {
    setInterval(() => {
      this.loadBalancer.instances.forEach(instance => {
        this.checkInstanceHealth(instance);
      });
    }, this.healthCheckInterval);
  }
}
```

#### 1.3 Connection Pooling for Dual Instances

**Per-Instance Connection Pools:**
```javascript
class ComfyUIConnectionManager {
  constructor() {
    this.connectionPools = new Map(); // host -> connection pool
    this.maxConnectionsPerInstance = 3;
  }
  
  getConnectionPool(host) {
    if (!this.connectionPools.has(host)) {
      this.connectionPools.set(host, {
        available: [],
        active: new Set(),
        pending: []
      });
    }
    return this.connectionPools.get(host);
  }
  
  async getConnection(host) {
    const pool = this.getConnectionPool(host);
    
    // Return available connection
    if (pool.available.length > 0) {
      const connection = pool.available.pop();
      pool.active.add(connection);
      return connection;
    }
    
    // Create new connection if under limit
    if (pool.active.size < this.maxConnectionsPerInstance) {
      const connection = await this.createConnection(host);
      pool.active.add(connection);
      return connection;
    }
    
    // Wait for available connection
    return new Promise((resolve) => {
      pool.pending.push(resolve);
    });
  }
  
  releaseConnection(host, connection) {
    const pool = this.getConnectionPool(host);
    pool.active.delete(connection);
    
    if (connection.readyState === WebSocket.OPEN) {
      if (pool.pending.length > 0) {
        const resolve = pool.pending.shift();
        pool.active.add(connection);
        resolve(connection);
      } else {
        pool.available.push(connection);
      }
    }
  }
}
```

### Phase 2: Asynchronous Processing for Concurrent Jobs

#### 2.1 In-Memory Job Management

**Lightweight Job Tracking:**
- Jobs stored in memory only (no persistence needed)
- Immediate consumption model maintained
- Enable concurrent processing across both GPUs

```javascript
// Simple in-memory job manager
class JobManager {
  constructor() {
    this.jobs = new Map(); // jobId -> job data
    this.jobTimeout = 300000; // 5 minutes
  }
  
  createJob(type, data) {
    const jobId = uuidv4();
    const job = {
      id: jobId,
      type,
      status: 'pending',
      data,
      created: Date.now(),
      comfyuiInstance: null,
      result: null
    };
    
    this.jobs.set(jobId, job);
    
    // Auto-cleanup after timeout
    setTimeout(() => {
      this.jobs.delete(jobId);
    }, this.jobTimeout);
    
    return jobId;
  }
}
```

#### 2.2 Async API Endpoints

**Job Submission (Immediate Response):**
```
POST /api/remove-background → returns job_id
POST /api/upscale-image → returns job_id
```

**Job Status/Results:**
```
GET /api/jobs/{job_id}/status → returns status + progress
GET /api/jobs/{job_id}/result → returns completed image
```

#### 2.3 API Response Formats

**Job Submission Response:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "estimated_completion_seconds": 45
}
```

**Job Status Response:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "progress": 65,
  "comfyui_instance": "localhost:8188",
  "processing_time_ms": 12500
}
```

**Job Result Response:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "image_base64": "data:image/png;base64,iVBORw0KGgo...",
  "processing_time_ms": 43200,
  "comfyui_instance": "localhost:8189"
}
```

#### 2.4 Background Job Processing

**Concurrent Processing:**
```javascript
class JobProcessor {
  constructor(jobManager, loadBalancer, connectionManager) {
    this.jobManager = jobManager;
    this.loadBalancer = loadBalancer;
    this.connectionManager = connectionManager;
    this.activeJobs = new Set();
  }
  
  async processJob(jobId) {
    const job = this.jobManager.getJob(jobId);
    if (!job) return;
    
    try {
      // Get available ComfyUI instance
      const instance = this.loadBalancer.getAvailableInstance();
      instance.activeJobs++;
      
      job.status = 'processing';
      job.comfyuiInstance = instance.host;
      
      // Execute workflow using existing comfyuiService
      const result = await this.executeWorkflow(job, instance);
      
      job.status = 'completed';
      job.result = result;
      
    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
    } finally {
      if (instance) instance.activeJobs--;
      this.activeJobs.delete(jobId);
    }
  }
}
```

### Phase 3: Basic Operational Visibility

#### 3.1 Basic Metrics Collection

**Simple Usage Tracking:**
- Track job counts per instance
- Monitor processing times
- Basic error rate tracking
- Instance health status

**Implementation:**
```javascript
class BasicMetrics {
  constructor() {
    this.stats = {
      jobsProcessed: 0,
      totalProcessingTime: 0,
      errorCount: 0,
      instanceStats: new Map(), // host -> stats
      startTime: Date.now()
    };
  }
  
  recordJobCompletion(instance, processingTime, success) {
    this.stats.jobsProcessed++;
    this.stats.totalProcessingTime += processingTime;
    
    if (!success) {
      this.stats.errorCount++;
    }
    
    // Per-instance tracking
    const instanceStats = this.stats.instanceStats.get(instance) || {
      jobsProcessed: 0,
      totalTime: 0,
      errors: 0
    };
    
    instanceStats.jobsProcessed++;
    instanceStats.totalTime += processingTime;
    if (!success) instanceStats.errors++;
    
    this.stats.instanceStats.set(instance, instanceStats);
  }
  
  getStats() {
    const uptime = Date.now() - this.stats.startTime;
    const avgProcessingTime = this.stats.jobsProcessed > 0 
      ? this.stats.totalProcessingTime / this.stats.jobsProcessed 
      : 0;
    
    return {
      uptime,
      jobsProcessed: this.stats.jobsProcessed,
      avgProcessingTime,
      errorRate: this.stats.jobsProcessed > 0 
        ? this.stats.errorCount / this.stats.jobsProcessed 
        : 0,
      instanceStats: Object.fromEntries(this.stats.instanceStats)
    };
  }
}
```

#### 3.2 Health and Status Endpoints

**System Health Monitoring:**
```javascript
// routes/status.js
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    comfyui_instances: []
  };
  
  // Check each ComfyUI instance
  for (const instance of loadBalancer.instances) {
    health.comfyui_instances.push({
      host: instance.host,
      healthy: instance.healthy,
      active_jobs: instance.activeJobs,
      last_check: new Date(instance.lastHealthCheck).toISOString()
    });
  }
  
  const hasHealthyInstance = health.comfyui_instances.some(i => i.healthy);
  if (!hasHealthyInstance) {
    health.status = 'degraded';
  }
  
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

app.get('/metrics', (req, res) => {
  const stats = metricsCollector.getStats();
  res.json(stats);
});
```

#### 3.3 Simple Logging and Error Tracking

**Enhanced Logging:**
```javascript
// utils/logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'comfyui-middleware' },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    }),
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log' 
    })
  ]
});

// Add request logging middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('Request completed', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration,
      userAgent: req.get('User-Agent')
    });
  });
  
  next();
};

module.exports = { logger, requestLogger };
```

## Implementation Timeline (Revised)

### Phase 1 (Week 1): Multi-ComfyUI Support
- [ ] Implement load balancer for dual ComfyUI instances
- [ ] Add health checking and failover logic
- [ ] Create connection pooling per instance
- [ ] Test load balancing across both GPUs

### Phase 2 (Week 2): Async Processing
- [ ] Implement in-memory job management
- [ ] Create async API endpoints
- [ ] Add background job processor
- [ ] Test concurrent job processing

### Phase 3 (Week 3): Basic Monitoring
- [ ] Add simple metrics collection
- [ ] Create health/status endpoints  
- [ ] Implement basic logging
- [ ] Add error tracking

## Success Metrics (Revised)

1. **Dual GPU Utilization**: Both ComfyUI instances process jobs concurrently
2. **Failover Reliability**: System continues operating when one instance fails
3. **Performance**: Multiple jobs process simultaneously (2x throughput)
4. **Uptime**: 99%+ availability during normal operations
5. **Visibility**: Basic metrics for scaling decisions

## Dependencies & Prerequisites

### Required Setup
- Second ComfyUI container on port 8189 (GPU 1)
- Shared model/workflow access between containers
- Environment variables for dual-instance configuration

### Environment Variables
```bash
# ComfyUI Instances
COMFYUI_HOST_1=localhost:8188
COMFYUI_HOST_2=localhost:8189
COMFYUI_TIMEOUT=60000

# Connection Management
MAX_CONNECTIONS_PER_INSTANCE=3
HEALTH_CHECK_INTERVAL=30000

# Job Management
JOB_TIMEOUT=300000
MAX_CONCURRENT_JOBS=6

# Logging
LOG_LEVEL=info
LOG_DIRECTORY=./logs
```

## Excluded Scope (Future Considerations)

The following items were considered but excluded for current implementation:

### Not Implemented
- **Redis/PostgreSQL job persistence** - Jobs consumed immediately
- **Complex monitoring/alerting** - Basic metrics sufficient
- **Horizontal middleware scaling** - Single instance meets needs
- **Advanced caching** - ComfyUI's queue handles optimization
- **Security hardening** - Internal use case
- **CDN integration** - Not needed for direct consumption

### Future Enhancements
If business needs evolve, consider:
- Result caching for repeated operations
- Rate limiting for external exposure
- Authentication/authorization
- Advanced monitoring and alerting
- Multi-region deployment

This revised plan focuses on the core improvements needed for your dual-GPU setup while avoiding unnecessary complexity for your immediate upload → process → download use case.
EOF < /dev/null
