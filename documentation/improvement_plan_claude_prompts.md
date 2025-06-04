# ComfyUI Middleware Improvement - Claude Code Implementation Prompts (Revised)

## Overview
This document contains detailed prompts for Claude Code to implement the architectural improvements outlined in `improvement_plan.md`. Each prompt is designed to be self-contained and executable in sequence. This revised version focuses on the simplified 3-phase approach optimized for dual-GPU utilization without over-engineering.

---

## Phase 1: Multi-ComfyUI Support & Load Balancing

### Story 1.1: Implement ComfyUI Load Balancer

**Prompt for Claude Code:**
```
Implement a load balancer for multiple ComfyUI instances to utilize dual GPU setup.

REQUIREMENTS:
1. Create ComfyUILoadBalancer class in services/loadBalancer.js with:
   - Support for localhost:8188 and localhost:8189 instances
   - Round-robin load balancing with job count awareness
   - Health status tracking per instance
   - getAvailableInstance() method that returns least loaded healthy instance
2. Add environment variables for ComfyUI instance configuration
3. Track active job count per instance
4. Integrate with existing comfyuiService.js
5. Add proper error handling for no healthy instances

ACCEPTANCE CRITERIA:
- Load balancer distributes jobs across both ComfyUI instances
- Prefers instance with fewer active jobs
- Handles instance failures gracefully
- Maintains instance health status
- Zero configuration for default dual-instance setup

TECHNICAL NOTES:
- Use existing comfyuiService.js patterns
- Add COMFYUI_HOST_1 and COMFYUI_HOST_2 environment variables
- Default to localhost:8188 and localhost:8189
- Follow existing error handling patterns
```

### Story 1.2: Implement Health Checking with Circuit Breaker

**Prompt for Claude Code:**
```
Implement health checking for ComfyUI instances with automatic failover.

REQUIREMENTS:
1. Create InstanceHealthChecker class in services/healthChecker.js
2. Ping /system_stats endpoint every 30 seconds for each instance
3. Mark instance unhealthy after 3 consecutive failures
4. Check health of an instance before submitting a job to a comfy instance we never want to route to a dead instance (timeout of 300ms is sufficient)
5. Auto-recovery when health check succeeds
6. Integrate with LoadBalancer to exclude unhealthy instances
7. Add simple circuit breaker logic (fail fast when instance unhealthy)
8. Log health status changes

ACCEPTANCE CRITERIA:
- Health checks run automatically every 30 seconds
- Health check runs upon each job submission
- Failed instances are excluded from load balancing
- Instances auto-recover when healthy
- Health status is logged clearly
- No healthy instances scenario is handled gracefully

TECHNICAL NOTES:
- Use axios with 300ms timeout for health checks
- Integrate with existing LoadBalancer class
- Add basic logging for health status changes
- Use setInterval for periodic health checks
- Follow existing error handling patterns
```

### Story 1.3: Implement Connection Pooling for Dual Instances

**Prompt for Claude Code:**
```
Implement WebSocket connection pooling for efficient dual-instance ComfyUI communication.

REQUIREMENTS:
1. Create ComfyUIConnectionManager class in services/connectionManager.js
2. Maintain separate connection pools for each ComfyUI instance (host-based)
3. Maximum 3 connections per instance (configurable)
4. Implement connection reuse and lifecycle management
5. Add connection health monitoring with auto-reconnection
6. Handle connection queuing when pool is exhausted
7. Integrate with LoadBalancer and existing comfyuiService.js

ACCEPTANCE CRITERIA:
- Separate pools maintained for localhost:8188 and localhost:8189
- Maximum 3 connections per instance
- Connections are reused efficiently
- Failed connections are replaced automatically
- Pool handles backpressure with request queuing
- Connection status is logged

TECHNICAL NOTES:
- Use Map to store pools by host
- Integrate with existing comfyuiService WebSocket patterns
- Add MAX_CONNECTIONS_PER_INSTANCE environment variable
- Implement proper WebSocket event handling
- Add graceful connection cleanup on shutdown
```

---

## Phase 2: Asynchronous Processing for Concurrent Jobs

### Story 2.1: Implement In-Memory Job Management

**Prompt for Claude Code:**
```
Implement lightweight in-memory job management for immediate consumption workflow.

REQUIREMENTS:
1. Create JobManager class in services/jobManager.js
2. Store jobs in memory using Map (no persistence needed)
3. Support job states: pending, processing, completed, failed
4. Add automatic job cleanup after 5 minutes (configurable)
5. Include job metadata: id, type, status, data, created time, comfyui instance, result
6. Generate UUID for job IDs
7. Add methods: createJob, getJob, updateJobStatus, deleteJob

ACCEPTANCE CRITERIA:
- Jobs stored in memory only (128GB RAM sufficient)
- Automatic cleanup prevents memory leaks
- Job status can be queried by ID
- Supports concurrent job processing
- Jobs expire after configurable timeout

TECHNICAL NOTES:
- Use Map for job storage
- Use setTimeout for automatic cleanup
- Generate UUIDs with uuid library
- Store comfyui instance reference for tracking
- Add JOB_TIMEOUT environment variable (default 300000ms)
```

### Story 2.2: Create Async API Endpoints

**Prompt for Claude Code:**
```
Create asynchronous API endpoints for job submission and status tracking.

REQUIREMENTS:
1. Update existing routes to support async operation:
   - POST /api/remove-background → returns job_id immediately
   - POST /api/upscale-image → returns job_id immediately
2. Add new endpoints:
   - GET /api/jobs/{job_id}/status → returns status + progress
   - GET /api/jobs/{job_id}/result → returns completed image
3. Return 202 Accepted with job_id for job submission
4. Integrate with JobManager for job tracking
5. Maintain backward compatibility with existing endpoints

ACCEPTANCE CRITERIA:
- Job submission returns immediately with job_id
- Status endpoint shows progress and processing time
- Result endpoint serves completed images
- 404 for non-existent jobs
- Backward compatibility maintained

TECHNICAL NOTES:
- Modify existing route handlers
- Use JobManager for job tracking
- Add job_id generation with uuid
- Include estimated completion time in responses
- Use existing multer and error handling patterns
```

### Story 2.3: Implement Background Job Processor

**Prompt for Claude Code:**
```
Create background job processor for concurrent processing across both ComfyUI instances.

REQUIREMENTS:
1. Create JobProcessor class in services/jobProcessor.js
2. Process jobs concurrently using available ComfyUI instances
3. Update job status during processing (pending → processing → completed/failed)
4. Integrate with LoadBalancer to select available instances
5. Track active jobs per instance
6. Handle job failures and instance failures gracefully
7. Add processing time tracking

ACCEPTANCE CRITERIA:
- Jobs process concurrently across both GPUs
- Job status updates in real-time
- Failed jobs are handled gracefully
- Instance failures don't crash the processor
- Processing times are tracked
- Maximum concurrent jobs is configurable

TECHNICAL NOTES:
- Use LoadBalancer to select instances
- Integrate with existing comfyuiService workflow execution
- Track instance.activeJobs count
- Add MAX_CONCURRENT_JOBS environment variable
- Use Promise.all for concurrent processing
- Add comprehensive error handling
```

---

## Phase 3: Basic Operational Visibility

### Story 3.1: Implement Basic Metrics Collection

**Prompt for Claude Code:**
```
Implement basic metrics collection for operational visibility.

REQUIREMENTS:
1. Create BasicMetrics class in services/metrics.js
2. Track key metrics:
   - Total jobs processed
   - Average processing time
   - Error count and rate
   - Jobs per ComfyUI instance
   - System uptime
3. Record job completion with success/failure status
4. Track processing time per job
5. Maintain per-instance statistics

ACCEPTANCE CRITERIA:
- Basic job metrics are collected
- Processing times are tracked
- Error rates are calculated
- Per-instance stats are maintained
- Metrics are accessible via getStats() method

TECHNICAL NOTES:
- Use simple in-memory counters (no external storage)
- Track metrics in JobProcessor and LoadBalancer
- Calculate averages and rates on demand
- Include instance host in metrics
- Add startTime for uptime calculation
```

### Story 3.2: Add Health and Status Endpoints

**Prompt for Claude Code:**
```
Create health and status monitoring endpoints for system visibility.

REQUIREMENTS:
1. Add GET /health endpoint for system health check
2. Add GET /metrics endpoint for basic metrics
3. Health endpoint shows:
   - Overall system status (healthy/degraded)
   - ComfyUI instance health and active jobs
   - System uptime
   - Last health check timestamps
4. Metrics endpoint shows:
   - Jobs processed, average time, error rate
   - Per-instance statistics
   - System uptime

ACCEPTANCE CRITERIA:
- /health returns 200 for healthy, 503 for degraded
- Health check shows status of both ComfyUI instances
- /metrics provides comprehensive statistics
- Endpoints are lightweight and fast
- JSON responses are well-structured

TECHNICAL NOTES:
- Create routes/status.js for new endpoints
- Integrate with LoadBalancer for instance health
- Use BasicMetrics for statistics
- Return appropriate HTTP status codes
- Add timestamps in ISO format
```

### Story 3.3: Enhance Logging and Error Tracking

**Prompt for Claude Code:**
```
Implement enhanced logging system for better operational visibility.

REQUIREMENTS:
1. Create logger utility in utils/logger.js using winston
2. Add structured logging with JSON format
3. Log levels: error, warn, info, debug
4. Add request logging middleware
5. Create log files: error.log and combined.log
6. Include service name and timestamp in all logs
7. Add request duration tracking

ACCEPTANCE CRITERIA:
- Structured JSON logging for easy parsing
- Request/response logging with duration
- Error logs include stack traces
- Log files are created in logs/ directory
- Console output for development
- Configurable log level via environment

TECHNICAL NOTES:
- Use winston for logging framework
- Add LOG_LEVEL environment variable
- Create logs/ directory for file output
- Add request logging middleware to express
- Include user agent and request details
- Use winston.format.errors({ stack: true })
```

---

## Implementation Guidelines (Revised)

### General Development Practices
1. **Follow existing code patterns** in the project
2. **Implement proper error handling** at all layers
3. **Add logging** for debugging and monitoring
4. **Use environment variables** for all configuration
5. **Add basic tests** for critical functionality

### Testing Requirements
- Basic unit tests for core business logic
- Integration tests for API endpoints
- Manual testing for dual-instance scenarios

### Documentation Requirements
- README updates for new environment variables
- Basic API documentation for new endpoints
- Configuration documentation for dual-instance setup

### Quality Gates
- Code review for all changes
- Basic tests must pass
- Manual testing confirms dual-GPU utilization
- No performance regression

### Success Criteria for Each Phase
**Phase 1**: Jobs distribute across both ComfyUI instances with health monitoring
**Phase 2**: Concurrent job processing without blocking
**Phase 3**: Basic visibility into system performance and health

### Environment Variables Required
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

---

*This revised implementation guide provides focused, actionable prompts for Claude Code to transform the ComfyUI middleware into a dual-GPU optimized system without over-engineering. Each prompt builds upon previous work while maintaining simplicity and effectiveness for the immediate upload → process → download use case.*