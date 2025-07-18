# Health Check API

This document details the usage of the health check API endpoint, which provides a comprehensive overview of the system's health.

## Endpoint

`GET /health`

### Description

This endpoint returns a detailed status of the ComfyExpressMiddleware, including the health of connected ComfyUI instances, job processing statistics, and performance metrics. It is designed to be used by monitoring systems to assess the overall health of the service.

### Response

The response is a JSON object with the following structure:

```json
{
  "status": "healthy",
  "timestamp": "2025-07-18T12:00:00.000Z",
  "uptime": {
    "total_uptime_ms": 3600000,
    "total_uptime_hours": 1,
    "session_uptime_ms": 1800000,
    "session_uptime_hours": 0.5,
    "started_at": "2025-07-18T11:00:00.000Z",
    "session_started_at": "2025-07-18T11:30:00.000Z"
  },
  "comfyui_instances": {
    "total": 2,
    "healthy": 2,
    "unhealthy": 0,
    "instances": [
      {
        "id": "instance-1",
        "host": "localhost:8188",
        "is_healthy": true,
        "last_health_check": "2025-07-18T11:59:59.000Z",
        "circuit_breaker": {
          "state": "CLOSED",
          "failures": 0,
          "error_rate": 0
        },
        "active_jobs": 0
      },
      {
        "id": "instance-2",
        "host": "localhost:8189",
        "is_healthy": true,
        "last_health_check": "2025-07-18T11:59:58.000Z",
        "circuit_breaker": {
          "state": "CLOSED",
          "failures": 0,
          "error_rate": 0
        },
        "active_jobs": 0
      }
    ]
  },
  "job_processing": {
    "processor_running": true,
    "active_jobs": 0,
    "max_concurrent_jobs": 10,
    "total_jobs_in_memory": 5,
    "pending_jobs": 1,
    "processing_jobs": 0
  },
  "connections": {
    "total_pools": 1,
    "pool_stats": {
      "localhost:8188": {
        "total": 10,
        "borrowed": 0,
        "pending": 0,
        "available": 10,
        "spared": 10
      }
    }
  },
  "performance": {
    "total_jobs_processed": 100,
    "success_rate": "99.00%",
    "error_rate": "1.00%",
    "average_processing_time_seconds": 5.2,
    "jobs_per_hour": 720
  },
  "issues": [],
  "last_health_check": "2025-07-18T12:00:00.000Z"
}
```

### Circuit Breaker Status

The `circuit_breaker` object within each ComfyUI instance provides information about the instance's resilience to failures. It helps prevent cascading failures when an instance is down.

-   **`state`**: The current state of the circuit breaker.
    -   **`CLOSED`**: The instance is considered healthy, and requests are being sent to it normally.
    -   **`OPEN`**: The instance has exceeded its failure threshold. The circuit breaker is "open," and no requests will be sent to this instance for a configured timeout period. This allows the instance time to recover.
    -   **`HALF_OPEN`**: After the timeout period in the `OPEN` state, the circuit breaker transitions to `HALF_OPEN`. In this state, a limited number of test requests are sent to the instance. If these requests succeed, the breaker will close and normal operation will resume. If they fail, the breaker will trip again and return to the `OPEN` state.

-   **`failures`**: The number of consecutive failures that have occurred.

-   **`error_rate`**: The percentage of recent requests that have resulted in an error.

### Status Field

The `status` field provides a high-level summary of the system's health. It can have one of the following values:

-   **`healthy`**: Indicates that all systems are online and operating within normal parameters.
    -   **Conditions:**
        -   All configured ComfyUI instances are responding to health checks.
        -   The job processor is running.
        -   The recent job error rate is below the configured threshold (e.g., < 20%).

-   **`degraded`**: Indicates that the system is still operational but one or more components are experiencing issues. The service may be slower or have a reduced capacity.
    -   **Conditions:**
        -   One or more, but not all, ComfyUI instances are unhealthy or not responding.
        -   The recent job error rate is high (e.g., > 20%).
    -   **Action:** The system can likely still process requests, but it should be monitored. The root cause of the degradation should be investigated.

-   **`critical`**: Indicates that the system is in a critical state and is likely unable to process new requests. This requires immediate attention.
    -   **Conditions:**
        -   No ComfyUI instances are available (all are unhealthy).
        -   The core job processor is not running.
    -   **Action:** Immediate investigation is required as the service is effectively down.
