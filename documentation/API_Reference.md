# ComfyUI Express Middleware - API Reference

Complete API specification for all endpoints with detailed request/response examples, error codes, and usage patterns.

## Table of Contents

1. [Authentication & Headers](#authentication--headers)
2. [Processing Endpoints](#processing-endpoints)
   - [Background Removal](#background-removal)
   - [Image Upscaling](#image-upscaling)
3. [Job Management](#job-management)
   - [Job Status & Results](#job-status--results)
   - [Administrative Operations](#administrative-operations)
4. [System Monitoring](#system-monitoring)
   - [Health Checks](#health-checks)
   - [Basic Status](#basic-status)
   - [Detailed Metrics](#detailed-metrics)
5. [Circuit Breaker Management](#circuit-breaker-management)
6. [Error Handling](#error-handling)
7. [Rate Limiting & Best Practices](#rate-limiting--best-practices)

## Authentication & Headers

Currently, the API does not require authentication. All endpoints are publicly accessible.

### Standard Headers

**Request Headers:**
```
Content-Type: multipart/form-data (for file uploads)
Content-Type: application/json (for JSON requests)
```

**Response Headers:**
```
Content-Type: application/json
X-Request-ID: <unique-request-identifier>
```

### Request ID Tracking

Every request receives a unique request ID for tracing and debugging purposes. This ID is returned in the `X-Request-ID` header and included in error responses.

## Processing Endpoints

### Background Removal

Remove image backgrounds using ComfyUI's InspyrenetRembg workflow.

#### Synchronous Processing

**Endpoint:** `POST /api/remove-background`

**Parameters:**
- `imageFile` (file, required): Image file (PNG, JPEG, WebP, max 10MB)
- `async` (query, optional): Set to `true` for asynchronous processing

**Request Example:**
```bash
curl -X POST \
  -F "imageFile=@image.jpg" \
  http://localhost:3000/api/remove-background
```

**Asynchronous Request:**
```bash
curl -X POST \
  -F "imageFile=@image.jpg" \
  "http://localhost:3000/api/remove-background?async=true"
```

**Success Response (Synchronous):**
```json
{
  "success": true,
  "message": "Background removed successfully",
  "result": {
    "image_base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
    "prompt_id": "12345-67890-abcdef",
    "processing_time_seconds": 42.5
  },
  "comfyui_instance": "192.168.1.19:8188"
}
```

**Success Response (Asynchronous):**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "message": "Job submitted successfully. Use /api/jobs/{job_id}/status to track progress.",
  "estimated_completion_time": "30-60 seconds",
  "status_url": "/api/jobs/550e8400-e29b-41d4-a716-446655440000/status",
  "result_url": "/api/jobs/550e8400-e29b-41d4-a716-446655440000/result"
}
```

#### Dedicated Asynchronous Processing

**Endpoint:** `POST /api/async/remove-background`

**Parameters:**
- `imageFile` (file, required): Image file (PNG, JPEG, WebP, max 10MB)

**Request Example:**
```bash
curl -X POST \
  -F "imageFile=@image.jpg" \
  http://localhost:3000/api/async/remove-background
```

**Response:** Same as asynchronous response above (202 Accepted)

**Error Responses:**
```json
// Missing file
{
  "error": "No image file provided."
}

// Invalid file type
{
  "error": "Invalid file type. Supported formats: PNG, JPEG, WebP"
}

// File too large
{
  "error": "File size exceeds 10MB limit"
}

// All instances unhealthy
{
  "error": "No healthy ComfyUI instances available",
  "details": "All instances are currently unhealthy. Please try again later."
}
```

### Image Upscaling

Upscale images 4x using the NMKD-Siax model.

#### Synchronous Processing

**Endpoint:** `POST /api/upscale-image`

**Parameters:**
- `imageFile` (file, required): Image file (PNG, JPEG, WebP, max 10MB)
- `async` (query, optional): Set to `true` for asynchronous processing

**Request Example:**
```bash
curl -X POST \
  -F "imageFile=@image.jpg" \
  http://localhost:3000/api/upscale-image
```

**Success Response:**
```json
{
  "success": true,
  "message": "Image upscaled successfully",
  "result": {
    "image_base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
    "prompt_id": "12345-67890-abcdef",
    "processing_time_seconds": 67.2,
    "upscale_factor": "4x"
  },
  "comfyui_instance": "192.168.1.19:8188"
}
```

#### Dedicated Asynchronous Processing

**Endpoint:** `POST /api/async/upscale-image`

**Response Format:** Same as background removal async endpoint

**Estimated Processing Time:** 45-90 seconds

## Job Management

### Job Status & Results

#### Get Job Status

**Endpoint:** `GET /api/jobs/{job_id}/status`

**Path Parameters:**
- `job_id` (string, required): Unique job identifier

**Request Example:**
```bash
curl http://localhost:3000/api/jobs/550e8400-e29b-41d4-a716-446655440000/status
```

**Response Examples:**

**Pending Job:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "type": "remove-background",
  "created_time": "2024-01-15T10:30:00.000Z",
  "updated_time": "2024-01-15T10:30:00.000Z",
  "processing_time_seconds": 5,
  "message": "Job is queued for processing",
  "estimated_completion_time_seconds": 45,
  "comfyui_instance": null
}
```

**Processing Job:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "type": "remove-background",
  "created_time": "2024-01-15T10:30:00.000Z",
  "updated_time": "2024-01-15T10:30:15.000Z",
  "processing_time_seconds": 15,
  "estimated_remaining_time_seconds": 30,
  "progress_percentage": 33,
  "message": "Job is currently being processed",
  "prompt_id": "comfyui-prompt-12345",
  "comfyui_instance": "192.168.1.19:8188"
}
```

**Completed Job:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "type": "remove-background",
  "created_time": "2024-01-15T10:30:00.000Z",
  "updated_time": "2024-01-15T10:30:45.000Z",
  "completed_time": "2024-01-15T10:30:45.000Z",
  "processing_time_seconds": 45,
  "progress_percentage": 100,
  "message": "Job completed successfully",
  "result_url": "/api/jobs/550e8400-e29b-41d4-a716-446655440000/result",
  "comfyui_instance": "192.168.1.19:8188"
}
```

**Failed Job:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "failed",
  "type": "remove-background",
  "created_time": "2024-01-15T10:30:00.000Z",
  "updated_time": "2024-01-15T10:30:30.000Z",
  "failed_time": "2024-01-15T10:30:30.000Z",
  "processing_time_seconds": 30,
  "message": "Job failed to process",
  "error": "Workflow execution error: Node validation failed",
  "error_details": "Invalid model configuration",
  "comfyui_instance": "192.168.1.19:8188"
}
```

#### Get Job Result

**Endpoint:** `GET /api/jobs/{job_id}/result`

**Path Parameters:**
- `job_id` (string, required): Unique job identifier

**Request Example:**
```bash
curl http://localhost:3000/api/jobs/550e8400-e29b-41d4-a716-446655440000/result
```

**Success Response:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "type": "remove-background",
  "completed_time": "2024-01-15T10:30:45.000Z",
  "processing_time_seconds": 45,
  "result": {
    "image_base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
    "prompt_id": "comfyui-prompt-12345"
  }
}
```

**Error Responses:**
```json
// Job not found
{
  "error": "Job not found",
  "job_id": "550e8400-e29b-41d4-a716-446655440000"
}

// Job not completed
{
  "error": "Job not completed",
  "status": "processing",
  "message": "Job is currently processing. Check status endpoint for progress.",
  "status_url": "/api/jobs/550e8400-e29b-41d4-a716-446655440000/status"
}

// Job failed
{
  "error": "Job not completed",
  "status": "failed",
  "message": "Job failed to process",
  "status_url": "/api/jobs/550e8400-e29b-41d4-a716-446655440000/status"
}
```

### Administrative Operations

#### List Jobs

**Endpoint:** `GET /api/jobs/list`

**Query Parameters:**
- `status` (string, optional): Filter by status (pending, processing, completed, failed)
- `type` (string, optional): Filter by job type (remove-background, upscale-image)
- `instance` (string, optional): Filter by ComfyUI instance

**Request Examples:**
```bash
# All jobs
curl http://localhost:3000/api/jobs/list

# Pending jobs only
curl "http://localhost:3000/api/jobs/list?status=pending"

# Background removal jobs
curl "http://localhost:3000/api/jobs/list?type=remove-background"

# Jobs on specific instance
curl "http://localhost:3000/api/jobs/list?instance=192.168.1.19:8188"

# Combined filters
curl "http://localhost:3000/api/jobs/list?status=completed&type=upscale-image"
```

**Response:**
```json
{
  "jobs": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "type": "remove-background",
      "status": "completed",
      "createdTime": 1705312200000,
      "updatedTime": 1705312245000,
      "comfyuiInstance": "192.168.1.19:8188",
      "data": {
        "imageSize": 1048576,
        "mimeType": "image/jpeg",
        "originalFilename": "photo.jpg",
        "imageBase64_size": "[removed - use result endpoint]"
      },
      "result": {
        "promptId": "comfyui-prompt-12345",
        "base64_size": "[removed - use result endpoint]"
      }
    }
  ],
  "total": 1
}
```

**Note:** Base64 image data is removed from list responses to prevent large payloads. Use the result endpoint to get actual image data.

#### Get Job Details

**Endpoint:** `GET /api/jobs/{jobId}/info`

**Path Parameters:**
- `jobId` (string, required): Unique job identifier

**Request Example:**
```bash
curl http://localhost:3000/api/jobs/550e8400-e29b-41d4-a716-446655440000/info
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "remove-background",
  "status": "completed",
  "createdTime": 1705312200000,
  "updatedTime": 1705312245000,
  "completedTime": 1705312245000,
  "processingDuration": 45000,
  "comfyuiInstance": "192.168.1.19:8188",
  "data": {
    "imageSize": 1048576,
    "mimeType": "image/jpeg",
    "originalFilename": "photo.jpg",
    "submittedAt": "2024-01-15T10:30:00.000Z",
    "imageBase64_size": "[removed - use result endpoint]"
  },
  "result": {
    "promptId": "comfyui-prompt-12345",
    "base64_size": "[removed - use result endpoint]"
  }
}
```

#### Delete Job

**Endpoint:** `DELETE /api/jobs/{jobId}`

**Path Parameters:**
- `jobId` (string, required): Unique job identifier

**Request Example:**
```bash
curl -X DELETE http://localhost:3000/api/jobs/550e8400-e29b-41d4-a716-446655440000
```

**Success Response:**
```json
{
  "message": "Job deleted successfully"
}
```

**Error Response:**
```json
{
  "error": "Job not found"
}
```

#### Manual Cleanup

**Endpoint:** `POST /api/jobs/cleanup`

Manually trigger cleanup of expired jobs.

**Request Example:**
```bash
curl -X POST http://localhost:3000/api/jobs/cleanup
```

**Response:**
```json
{
  "message": "Cleaned up 5 expired jobs",
  "cleanedCount": 5
}
```

#### Job Statistics

**Endpoint:** `GET /api/jobs/stats`

**Request Example:**
```bash
curl http://localhost:3000/api/jobs/stats
```

**Response:**
```json
{
  "total": 150,
  "byStatus": {
    "pending": 3,
    "processing": 2,
    "completed": 140,
    "failed": 5
  },
  "byType": {
    "remove-background": 85,
    "upscale-image": 65
  },
  "byInstance": {
    "192.168.1.19:8188": 75,
    "192.168.1.20:8188": 75
  }
}
```

#### Job Processor Statistics

**Endpoint:** `GET /api/jobs/processor/stats`

**Request Example:**
```bash
curl http://localhost:3000/api/jobs/processor/stats
```

**Response:**
```json
{
  "isRunning": true,
  "activeJobs": 2,
  "maxConcurrentJobs": 4,
  "instanceJobCounts": {
    "192.168.1.19:8188": 1,
    "192.168.1.20:8188": 1
  },
  "processingInterval": 1000,
  "maxJobsPerInstance": 2
}
```

## System Monitoring

### Health Checks

#### System Health

**Endpoint:** `GET /health`

Comprehensive health check for monitoring systems.

**Request Example:**
```bash
curl http://localhost:3000/health
```

**Healthy Response (200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": {
    "total_uptime_hours": 24.5,
    "process_uptime_seconds": 88200
  },
  "comfyui_instances": {
    "total": 2,
    "healthy": 2,
    "unhealthy": 0,
    "instances": [
      {
        "id": "instance-1",
        "host": "192.168.1.19:8188",
        "status": "healthy",
        "last_check": "2024-01-15T10:29:55.000Z",
        "response_time_ms": 45
      },
      {
        "id": "instance-2",
        "host": "192.168.1.20:8188",
        "status": "healthy",
        "last_check": "2024-01-15T10:29:55.000Z",
        "response_time_ms": 52
      }
    ]
  },
  "job_processing": {
    "processor_running": true,
    "active_jobs": 2,
    "pending_jobs": 1,
    "total_jobs": 150
  },
  "performance": {
    "total_jobs_processed": 1500,
    "success_rate": "98.5%",
    "average_processing_time_seconds": 45.2,
    "jobs_processed_last_hour": 62
  },
  "memory": {
    "used_mb": 245.8,
    "free_mb": 2810.2,
    "usage_percentage": 8.0
  }
}
```

**Degraded Response (200 OK):**
```json
{
  "status": "degraded",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "issues": [
    "1 ComfyUI instance unhealthy",
    "High job queue (15 pending jobs)"
  ],
  "comfyui_instances": {
    "total": 2,
    "healthy": 1,
    "unhealthy": 1
  },
  "job_processing": {
    "processor_running": true,
    "active_jobs": 1,
    "pending_jobs": 15
  }
}
```

**Critical Response (503 Service Unavailable):**
```json
{
  "status": "critical",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "issues": [
    "All ComfyUI instances unhealthy",
    "Job processor not running"
  ],
  "comfyui_instances": {
    "total": 2,
    "healthy": 0,
    "unhealthy": 2
  },
  "job_processing": {
    "processor_running": false,
    "active_jobs": 0,
    "pending_jobs": 25
  }
}
```

### Basic Status

#### Quick Status Check

**Endpoint:** `GET /status`

Lightweight status check for load balancers and uptime monitoring.

**Request Example:**
```bash
curl http://localhost:3000/status
```

**Response:**
```json
{
  "status": "healthy",
  "healthy_instances": 2,
  "active_jobs": 2,
  "uptime_hours": 24.5,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### Basic Metrics

**Endpoint:** `GET /status/metrics`

Basic operational metrics for monitoring dashboards.

**Request Example:**
```bash
curl http://localhost:3000/status/metrics
```

**Response:**
```json
{
  "jobs": {
    "total_processed": 1500,
    "success_rate": "98.5%",
    "jobs_per_hour": 62.5,
    "active_jobs": 2,
    "pending_jobs": 1
  },
  "performance": {
    "average_processing_time_seconds": 45.2,
    "p95_processing_time_ms": 65000,
    "fastest_processing_time_seconds": 18.5,
    "slowest_processing_time_seconds": 127.8
  },
  "instances": {
    "total": 2,
    "healthy": 2,
    "utilization_percentage": 50.0
  },
  "uptime": {
    "total_hours": 24.5,
    "last_restart": "2024-01-14T10:00:00.000Z"
  }
}
```

### Detailed Metrics

#### System Metrics

**Endpoint:** `GET /api/metrics`

Comprehensive system metrics for operational monitoring.

**Request Example:**
```bash
curl http://localhost:3000/api/metrics
```

**Response:**
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": {
    "total_uptime_hours": 24.5,
    "start_time": "2024-01-14T10:00:00.000Z"
  },
  "jobs": {
    "total_processed": 1500,
    "success_rate": 0.985,
    "failure_rate": 0.015,
    "active_jobs": 2,
    "pending_jobs": 1,
    "completed_jobs": 1475,
    "failed_jobs": 23,
    "by_type": {
      "remove-background": {
        "total": 850,
        "success_rate": 0.988,
        "average_processing_time_seconds": 42.3
      },
      "upscale-image": {
        "total": 650,
        "success_rate": 0.981,
        "average_processing_time_seconds": 67.8
      }
    }
  },
  "performance": {
    "average_processing_time_seconds": 45.2,
    "p95_processing_time_ms": 65000,
    "p99_processing_time_ms": 89000,
    "throughput": {
      "jobs_per_hour": 62.5,
      "jobs_per_minute": 1.04
    }
  },
  "instances": {
    "total": 2,
    "healthy": 2,
    "unhealthy": 0,
    "details": {
      "192.168.1.19:8188": {
        "status": "healthy",
        "jobs_processed": 750,
        "success_rate": 0.987,
        "average_response_time_ms": 45,
        "current_load": 1,
        "max_load": 2
      },
      "192.168.1.20:8188": {
        "status": "healthy",
        "jobs_processed": 750,
        "success_rate": 0.983,
        "average_response_time_ms": 52,
        "current_load": 1,
        "max_load": 2
      }
    }
  },
  "errors": {
    "total_errors": 23,
    "error_rate": 0.015,
    "by_type": {
      "connection_timeout": 8,
      "workflow_validation": 6,
      "instance_unavailable": 5,
      "processing_timeout": 4
    },
    "recent_errors": [
      {
        "timestamp": "2024-01-15T10:25:00.000Z",
        "type": "connection_timeout",
        "instance": "192.168.1.19:8188",
        "job_id": "abc123",
        "message": "Connection timeout after 60 seconds"
      }
    ]
  }
}
```

#### Performance Metrics

**Endpoint:** `GET /api/metrics/performance`

**Response:**
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "processing_times": {
    "average_seconds": 45.2,
    "median_seconds": 42.0,
    "p95_milliseconds": 65000,
    "p99_milliseconds": 89000,
    "fastest_seconds": 18.5,
    "slowest_seconds": 127.8
  },
  "throughput": {
    "jobs_per_hour": 62.5,
    "jobs_per_minute": 1.04,
    "jobs_per_second": 0.017
  },
  "by_job_type": {
    "remove-background": {
      "average_processing_time_seconds": 42.3,
      "p95_processing_time_ms": 58000,
      "throughput_per_hour": 35.5
    },
    "upscale-image": {
      "average_processing_time_seconds": 67.8,
      "p95_processing_time_ms": 95000,
      "throughput_per_hour": 27.0
    }
  },
  "trends": {
    "last_hour": {
      "jobs_completed": 62,
      "average_processing_time_seconds": 43.1
    },
    "last_24_hours": {
      "jobs_completed": 1500,
      "average_processing_time_seconds": 45.2
    }
  }
}
```

#### Error Metrics

**Endpoint:** `GET /api/metrics/errors`

**Response:**
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "summary": {
    "total_errors": 23,
    "error_rate": 0.015,
    "errors_last_hour": 2,
    "errors_last_24_hours": 23
  },
  "by_type": {
    "connection_timeout": {
      "count": 8,
      "percentage": 34.8,
      "last_occurrence": "2024-01-15T10:25:00.000Z"
    },
    "workflow_validation": {
      "count": 6,
      "percentage": 26.1,
      "last_occurrence": "2024-01-15T09:45:00.000Z"
    },
    "instance_unavailable": {
      "count": 5,
      "percentage": 21.7,
      "last_occurrence": "2024-01-15T08:30:00.000Z"
    },
    "processing_timeout": {
      "count": 4,
      "percentage": 17.4,
      "last_occurrence": "2024-01-15T07:15:00.000Z"
    }
  },
  "by_instance": {
    "192.168.1.19:8188": {
      "error_count": 12,
      "error_rate": 0.016,
      "most_common_error": "connection_timeout"
    },
    "192.168.1.20:8188": {
      "error_count": 11,
      "error_rate": 0.014,
      "most_common_error": "workflow_validation"
    }
  },
  "recent_errors": [
    {
      "timestamp": "2024-01-15T10:25:00.000Z",
      "type": "connection_timeout",
      "instance": "192.168.1.19:8188",
      "job_id": "abc123",
      "job_type": "remove-background",
      "message": "Connection timeout after 60 seconds",
      "stack_trace": "Error: timeout of 60000ms exceeded..."
    }
  ]
}
```

#### Instance Metrics

**Endpoint:** `GET /api/metrics/instances`

Get metrics for all instances.

**Response:**
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "summary": {
    "total_instances": 2,
    "healthy_instances": 2,
    "unhealthy_instances": 0,
    "total_capacity": 4,
    "current_utilization": 2
  },
  "instances": {
    "192.168.1.19:8188": {
      "id": "instance-1",
      "status": "healthy",
      "last_health_check": "2024-01-15T10:29:55.000Z",
      "response_time_ms": 45,
      "jobs_processed": 750,
      "success_rate": 0.987,
      "error_rate": 0.013,
      "current_load": 1,
      "max_load": 2,
      "utilization_percentage": 50.0,
      "average_job_duration_seconds": 44.1
    },
    "192.168.1.20:8188": {
      "id": "instance-2",
      "status": "healthy",
      "last_health_check": "2024-01-15T10:29:55.000Z",
      "response_time_ms": 52,
      "jobs_processed": 750,
      "success_rate": 0.983,
      "error_rate": 0.017,
      "current_load": 1,
      "max_load": 2,
      "utilization_percentage": 50.0,
      "average_job_duration_seconds": 46.3
    }
  }
}
```

**Endpoint:** `GET /api/metrics/instances/{instance}`

Get metrics for a specific instance.

**Path Parameters:**
- `instance` (string, required): Instance host (e.g., "192.168.1.19:8188")

**Request Example:**
```bash
curl http://localhost:3000/api/metrics/instances/192.168.1.19:8188
```

**Response:**
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "instance": {
    "id": "instance-1",
    "host": "192.168.1.19:8188",
    "status": "healthy",
    "last_health_check": "2024-01-15T10:29:55.000Z",
    "response_time_ms": 45,
    "uptime_hours": 24.5
  },
  "performance": {
    "jobs_processed": 750,
    "success_rate": 0.987,
    "error_rate": 0.013,
    "average_job_duration_seconds": 44.1,
    "fastest_job_seconds": 18.2,
    "slowest_job_seconds": 125.3
  },
  "load": {
    "current_jobs": 1,
    "max_concurrent_jobs": 2,
    "utilization_percentage": 50.0,
    "queue_length": 0
  },
  "job_types": {
    "remove-background": {
      "count": 425,
      "success_rate": 0.989,
      "average_duration_seconds": 41.8
    },
    "upscale-image": {
      "count": 325,
      "success_rate": 0.985,
      "average_duration_seconds": 67.2
    }
  }
}
```

#### Metrics Persistence

**Endpoint:** `POST /api/metrics/save`

Manually save metrics to persistent storage.

**Request Example:**
```bash
curl -X POST http://localhost:3000/api/metrics/save
```

**Response:**
```json
{
  "message": "Metrics saved successfully",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "file_path": "/app/data/metrics/metrics.json",
  "file_size_bytes": 15438
}
```

**Endpoint:** `GET /api/metrics/persistence`

Get metrics persistence status and configuration.

**Response:**
```json
{
  "enabled": true,
  "file_path": "/app/data/metrics/metrics.json",
  "save_interval_ms": 300000,
  "last_save": "2024-01-15T10:25:00.000Z",
  "next_save": "2024-01-15T10:30:00.000Z",
  "file_size_bytes": 15438,
  "auto_save_enabled": true
}
```

## Circuit Breaker Management

### Circuit Breaker Status

**Endpoint:** `GET /api/circuit-breakers`

Get status of all circuit breakers.

**Response:**
```json
{
  "circuit_breakers": {
    "instance-1": {
      "name": "instance-1",
      "state": "CLOSED",
      "failure_count": 0,
      "failure_threshold": 5,
      "timeout_ms": 60000,
      "last_failure_time": null,
      "success_count": 156,
      "total_requests": 156
    },
    "instance-2": {
      "name": "instance-2",
      "state": "HALF_OPEN",
      "failure_count": 3,
      "failure_threshold": 5,
      "timeout_ms": 60000,
      "last_failure_time": "2024-01-15T10:20:00.000Z",
      "success_count": 142,
      "total_requests": 148
    }
  }
}
```

### Force Circuit Breaker State

**Endpoint:** `POST /api/circuit-breakers/{name}/close`

Force close a circuit breaker (allow requests).

**Path Parameters:**
- `name` (string, required): Circuit breaker name

**Response:**
```json
{
  "message": "Circuit breaker instance-1 forced to CLOSED state",
  "circuit_breaker": {
    "name": "instance-1",
    "state": "CLOSED",
    "failure_count": 0
  }
}
```

**Endpoint:** `POST /api/circuit-breakers/{name}/open`

Force open a circuit breaker (block requests).

**Response:**
```json
{
  "message": "Circuit breaker instance-1 forced to OPEN state",
  "circuit_breaker": {
    "name": "instance-1",
    "state": "OPEN",
    "failure_count": 5
  }
}
```

## Error Handling

### Standard Error Format

All API errors follow a consistent format:

```json
{
  "error": "Error message describing what went wrong",
  "details": "Additional details about the error (optional)",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### HTTP Status Codes

| Code | Meaning | Usage |
|------|---------|--------|
| `200` | OK | Successful request |
| `202` | Accepted | Job submitted successfully (async endpoints) |
| `400` | Bad Request | Invalid request parameters or missing required fields |
| `404` | Not Found | Resource not found (job, endpoint) |
| `409` | Conflict | Resource state conflict (e.g., job not completed) |
| `413` | Payload Too Large | File size exceeds limit |
| `415` | Unsupported Media Type | Invalid file type |
| `429` | Too Many Requests | Rate limit exceeded |
| `500` | Internal Server Error | Unexpected server error |
| `503` | Service Unavailable | System unhealthy or instances unavailable |

### Common Error Scenarios

**File Upload Errors:**
```json
// No file provided
{
  "error": "No image file provided."
}

// Invalid file type
{
  "error": "Invalid file type. Supported formats: PNG, JPEG, WebP"
}

// File too large
{
  "error": "File size exceeds 10MB limit"
}
```

**Job-Related Errors:**
```json
// Job not found
{
  "error": "Job not found",
  "job_id": "invalid-job-id"
}

// Job not ready
{
  "error": "Job not completed",
  "status": "processing",
  "message": "Job is currently processing. Check status endpoint for progress."
}
```

**System Errors:**
```json
// All instances unhealthy
{
  "error": "No healthy ComfyUI instances available",
  "details": "All instances are currently unhealthy. Please try again later.",
  "healthy_instances": 0,
  "total_instances": 2
}

// Service overloaded
{
  "error": "Service temporarily overloaded",
  "details": "Maximum concurrent jobs reached. Please try again later.",
  "active_jobs": 4,
  "max_concurrent_jobs": 4
}
```

## Rate Limiting & Best Practices

### Current Limitations

- **File Size**: Maximum 10MB per upload
- **Concurrent Jobs**: Maximum 4 concurrent jobs globally
- **Job Timeout**: 5 minutes per job
- **Supported Formats**: PNG, JPEG, WebP

### Best Practices

1. **Use Asynchronous Endpoints**: For better scalability and user experience
2. **Poll Status Reasonably**: Check job status every 2-5 seconds, not more frequently
3. **Handle Timeouts**: Implement proper timeout handling in client applications
4. **Cache Results**: Cache completed results on client side when appropriate
5. **Error Handling**: Implement retry logic with exponential backoff
6. **Monitor Health**: Use health endpoints for service monitoring

### Example Client Implementation

```javascript
// Async job submission with polling
async function submitAndWaitForJob(imageFile, jobType) {
  // Submit job
  const formData = new FormData();
  formData.append('imageFile', imageFile);
  
  const submitResponse = await fetch(`/api/async/${jobType}`, {
    method: 'POST',
    body: formData
  });
  
  const { job_id } = await submitResponse.json();
  
  // Poll for completion
  while (true) {
    const statusResponse = await fetch(`/api/jobs/${job_id}/status`);
    const status = await statusResponse.json();
    
    if (status.status === 'completed') {
      // Get result
      const resultResponse = await fetch(`/api/jobs/${job_id}/result`);
      return await resultResponse.json();
    } else if (status.status === 'failed') {
      throw new Error(`Job failed: ${status.error}`);
    }
    
    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
```

### Rate Limiting Headers

Future versions may include rate limiting headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642694400
```