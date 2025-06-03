# ComfyUI Middleware Development Guide

## Introduction

This guide provides practical information for developers building middleware services between web applications and ComfyUI servers. It covers architecture patterns, implementation strategies, and real-world examples.

## Table of Contents

1. [Middleware Architecture Patterns](#middleware-architecture-patterns)
2. [Core Components](#core-components)
3. [Implementation Examples](#implementation-examples)
4. [Session Management](#session-management)
5. [Workflow Management](#workflow-management)
6. [Error Handling and Recovery](#error-handling-and-recovery)
7. [Performance Optimization](#performance-optimization)
8. [Security Considerations](#security-considerations)

## Middleware Architecture Patterns

### 1. Queue Manager Pattern
```
Web App → Middleware → ComfyUI
         ↓
    Job Queue
         ↓
    Database
```

Your middleware acts as a queue manager, handling:
- Job submission and tracking
- Result caching
- Load balancing across multiple ComfyUI instances
- Retry logic

### 2. Proxy Pattern
```
Web App → Middleware (Proxy) → ComfyUI
```

Middleware acts as a transparent proxy, adding:
- Authentication
- Request/response transformation
- Logging and monitoring
- Rate limiting

### 3. Workflow Orchestrator Pattern
```
Web App → Middleware → Multiple ComfyUI Instances
         ↓
   Workflow Engine
```

Middleware manages complex workflows:
- Multi-step image generation
- Conditional branching
- Parallel execution

## Core Components

### 1. HTTP Client Manager
```python
import aiohttp
import asyncio
from typing import Dict, Any, Optional

class ComfyUIClient:
    def __init__(self, base_url: str = "http://127.0.0.1:8188"):
        self.base_url = base_url
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def queue_prompt(self, prompt: Dict[str, Any], client_id: Optional[str] = None) -> Dict[str, Any]:
        """Submit a prompt to ComfyUI"""
        payload = {"prompt": prompt}
        if client_id:
            payload["client_id"] = client_id
        
        async with self.session.post(f"{self.base_url}/prompt", json=payload) as resp:
            return await resp.json()
    
    async def get_history(self, prompt_id: str) -> Dict[str, Any]:
        """Get execution history for a specific prompt"""
        async with self.session.get(f"{self.base_url}/history/{prompt_id}") as resp:
            return await resp.json()
    
    async def get_image(self, filename: str, subfolder: str = "", folder_type: str = "output") -> bytes:
        """Download an image from ComfyUI"""
        params = {
            "filename": filename,
            "subfolder": subfolder,
            "type": folder_type
        }
        async with self.session.get(f"{self.base_url}/view", params=params) as resp:
            return await resp.read()
```

### 2. WebSocket Manager
```python
import websockets
import json
import asyncio
from typing import Dict, Any, Callable, Optional

class ComfyUIWebSocket:
    def __init__(self, server_address: str = "127.0.0.1:8188", client_id: str = None):
        self.server_address = server_address
        self.client_id = client_id or str(uuid.uuid4())
        self.ws: Optional[websockets.WebSocketClientProtocol] = None
        self.handlers: Dict[str, Callable] = {}
    
    async def connect(self):
        """Establish WebSocket connection"""
        uri = f"ws://{self.server_address}/ws?clientId={self.client_id}"
        self.ws = await websockets.connect(uri)
    
    async def disconnect(self):
        """Close WebSocket connection"""
        if self.ws:
            await self.ws.close()
    
    def on(self, event_type: str, handler: Callable):
        """Register event handler"""
        self.handlers[event_type] = handler
    
    async def listen(self):
        """Listen for messages and dispatch to handlers"""
        async for message in self.ws:
            if isinstance(message, str):
                data = json.loads(message)
                event_type = data.get('type')
                if event_type in self.handlers:
                    await self.handlers[event_type](data.get('data'))
            else:
                # Handle binary data (preview images)
                if 'preview' in self.handlers:
                    await self.handlers['preview'](message)
```

### 3. Job Queue System
```python
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Dict, Any, Optional
import asyncio
import uuid

class JobStatus(Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

@dataclass
class Job:
    id: str
    prompt: Dict[str, Any]
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    prompt_id: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    retry_count: int = 0
    max_retries: int = 3

class JobQueue:
    def __init__(self):
        self.jobs: Dict[str, Job] = {}
        self.pending_queue: asyncio.Queue = asyncio.Queue()
    
    async def add_job(self, prompt: Dict[str, Any]) -> str:
        """Add a new job to the queue"""
        job_id = str(uuid.uuid4())
        job = Job(
            id=job_id,
            prompt=prompt,
            status=JobStatus.PENDING,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        self.jobs[job_id] = job
        await self.pending_queue.put(job_id)
        return job_id
    
    async def get_next_job(self) -> Optional[Job]:
        """Get the next pending job"""
        try:
            job_id = await self.pending_queue.get()
            return self.jobs.get(job_id)
        except asyncio.QueueEmpty:
            return None
    
    def update_job_status(self, job_id: str, status: JobStatus, **kwargs):
        """Update job status and metadata"""
        if job_id in self.jobs:
            job = self.jobs[job_id]
            job.status = status
            job.updated_at = datetime.utcnow()
            for key, value in kwargs.items():
                setattr(job, key, value)
```

## Implementation Examples

### Basic Middleware Server
```python
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
import asyncio
import io

app = FastAPI()

# Initialize components
job_queue = JobQueue()
comfy_client = None

@app.on_event("startup")
async def startup():
    global comfy_client
    comfy_client = ComfyUIClient()
    await comfy_client.__aenter__()
    # Start background worker
    asyncio.create_task(process_jobs())

@app.on_event("shutdown")
async def shutdown():
    if comfy_client:
        await comfy_client.__aexit__(None, None, None)

async def process_jobs():
    """Background worker to process jobs"""
    while True:
        job = await job_queue.get_next_job()
        if job:
            await process_single_job(job)
        else:
            await asyncio.sleep(1)

async def process_single_job(job: Job):
    """Process a single job"""
    try:
        # Update status
        job_queue.update_job_status(job.id, JobStatus.PROCESSING)
        
        # Submit to ComfyUI
        result = await comfy_client.queue_prompt(job.prompt)
        prompt_id = result['prompt_id']
        job_queue.update_job_status(job.id, JobStatus.PROCESSING, prompt_id=prompt_id)
        
        # Wait for completion (with WebSocket in production)
        await wait_for_completion(prompt_id)
        
        # Get results
        history = await comfy_client.get_history(prompt_id)
        job_queue.update_job_status(
            job.id, 
            JobStatus.COMPLETED,
            result=history[prompt_id]
        )
    except Exception as e:
        job.retry_count += 1
        if job.retry_count < job.max_retries:
            # Retry the job
            job_queue.update_job_status(job.id, JobStatus.PENDING)
            await job_queue.pending_queue.put(job.id)
        else:
            job_queue.update_job_status(
                job.id,
                JobStatus.FAILED,
                error=str(e)
            )

@app.post("/generate")
async def generate_image(workflow: Dict[str, Any], background_tasks: BackgroundTasks):
    """Submit a new generation job"""
    job_id = await job_queue.add_job(workflow)
    return {"job_id": job_id}

@app.get("/job/{job_id}")
async def get_job_status(job_id: str):
    """Get job status and results"""
    job = job_queue.jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return {
        "id": job.id,
        "status": job.status.value,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
        "result": job.result,
        "error": job.error
    }

@app.get("/job/{job_id}/image/{node_id}/{index}")
async def get_job_image(job_id: str, node_id: str, index: int):
    """Get a specific image from job results"""
    job = job_queue.jobs.get(job_id)
    if not job or job.status != JobStatus.COMPLETED:
        raise HTTPException(status_code=404, detail="Job not found or not completed")
    
    try:
        image_info = job.result['outputs'][node_id]['images'][index]
        image_data = await comfy_client.get_image(
            image_info['filename'],
            image_info['subfolder'],
            image_info['type']
        )
        return StreamingResponse(io.BytesIO(image_data), media_type="image/png")
    except (KeyError, IndexError):
        raise HTTPException(status_code=404, detail="Image not found")
```

### WebSocket Integration
```python
async def wait_for_completion(prompt_id: str, timeout: int = 300):
    """Wait for prompt completion using WebSocket"""
    ws_client = ComfyUIWebSocket()
    completion_event = asyncio.Event()
    
    async def on_executing(data):
        if data['prompt_id'] == prompt_id and data['node'] is None:
            completion_event.set()
    
    ws_client.on('executing', on_executing)
    
    try:
        await ws_client.connect()
        
        # Wait for completion or timeout
        await asyncio.wait_for(
            asyncio.gather(
                ws_client.listen(),
                completion_event.wait()
            ),
            timeout=timeout
        )
    finally:
        await ws_client.disconnect()
```

## Session Management

### User Session Tracking
```python
from typing import Dict, Optional
import time

class SessionManager:
    def __init__(self, session_timeout: int = 3600):
        self.sessions: Dict[str, Dict[str, Any]] = {}
        self.session_timeout = session_timeout
    
    def create_session(self, user_id: str) -> str:
        """Create a new session for a user"""
        session_id = str(uuid.uuid4())
        self.sessions[session_id] = {
            'user_id': user_id,
            'created_at': time.time(),
            'last_activity': time.time(),
            'client_id': str(uuid.uuid4()),  # ComfyUI client ID
            'active_jobs': []
        }
        return session_id
    
    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get session data"""
        session = self.sessions.get(session_id)
        if session:
            # Check timeout
            if time.time() - session['last_activity'] > self.session_timeout:
                del self.sessions[session_id]
                return None
            session['last_activity'] = time.time()
        return session
    
    def add_job_to_session(self, session_id: str, job_id: str):
        """Track job in session"""
        session = self.get_session(session_id)
        if session:
            session['active_jobs'].append(job_id)
```

## Workflow Management

### Workflow Templates
```python
class WorkflowTemplate:
    """Manage reusable workflow templates"""
    
    def __init__(self):
        self.templates: Dict[str, Dict[str, Any]] = {}
    
    def register_template(self, name: str, workflow: Dict[str, Any]):
        """Register a workflow template"""
        self.templates[name] = workflow
    
    def create_workflow(self, template_name: str, **params) -> Dict[str, Any]:
        """Create a workflow from template with parameters"""
        if template_name not in self.templates:
            raise ValueError(f"Template {template_name} not found")
        
        # Deep copy template
        import copy
        workflow = copy.deepcopy(self.templates[template_name])
        
        # Apply parameters
        for node_id, node in workflow.items():
            for input_key, input_value in node.get('inputs', {}).items():
                if isinstance(input_value, str) and input_value.startswith('${') and input_value.endswith('}'):
                    param_name = input_value[2:-1]
                    if param_name in params:
                        node['inputs'][input_key] = params[param_name]
        
        return workflow

# Example usage
templates = WorkflowTemplate()

# Register a text-to-image template
templates.register_template('text2img', {
    "3": {
        "class_type": "KSampler",
        "inputs": {
            "seed": "${seed}",
            "steps": "${steps}",
            "cfg": "${cfg}",
            "sampler_name": "euler",
            "scheduler": "normal",
            "denoise": 1,
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["5", 0]
        }
    },
    "4": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {
            "ckpt_name": "${model}"
        }
    },
    "5": {
        "class_type": "EmptyLatentImage",
        "inputs": {
            "width": "${width}",
            "height": "${height}",
            "batch_size": 1
        }
    },
    "6": {
        "class_type": "CLIPTextEncode",
        "inputs": {
            "text": "${positive_prompt}",
            "clip": ["4", 1]
        }
    },
    "7": {
        "class_type": "CLIPTextEncode",
        "inputs": {
            "text": "${negative_prompt}",
            "clip": ["4", 1]
        }
    },
    "8": {
        "class_type": "VAEDecode",
        "inputs": {
            "samples": ["3", 0],
            "vae": ["4", 2]
        }
    },
    "9": {
        "class_type": "SaveImage",
        "inputs": {
            "filename_prefix": "${filename_prefix}",
            "images": ["8", 0]
        }
    }
})

# Create workflow from template
workflow = templates.create_workflow(
    'text2img',
    seed=12345,
    steps=20,
    cfg=7.5,
    model="sd_xl_base_1.0.safetensors",
    width=1024,
    height=1024,
    positive_prompt="a beautiful landscape",
    negative_prompt="ugly, blurry",
    filename_prefix="generated"
)
```

## Error Handling and Recovery

### Comprehensive Error Handler
```python
class ComfyUIError(Exception):
    """Base exception for ComfyUI errors"""
    pass

class ValidationError(ComfyUIError):
    """Workflow validation error"""
    pass

class ExecutionError(ComfyUIError):
    """Execution error"""
    pass

class ConnectionError(ComfyUIError):
    """Connection error"""
    pass

async def handle_comfyui_request(func, *args, **kwargs):
    """Wrapper for ComfyUI requests with error handling"""
    max_retries = 3
    retry_delay = 1
    
    for attempt in range(max_retries):
        try:
            return await func(*args, **kwargs)
        except aiohttp.ClientConnectionError as e:
            if attempt < max_retries - 1:
                await asyncio.sleep(retry_delay * (2 ** attempt))
                continue
            raise ConnectionError(f"Failed to connect to ComfyUI: {e}")
        except aiohttp.ClientResponseError as e:
            if e.status == 400:
                raise ValidationError(f"Invalid workflow: {e}")
            elif e.status >= 500:
                if attempt < max_retries - 1:
                    await asyncio.sleep(retry_delay * (2 ** attempt))
                    continue
            raise ExecutionError(f"ComfyUI error: {e}")
```

## Performance Optimization

### Connection Pooling
```python
class ComfyUIPool:
    """Manage multiple ComfyUI instances"""
    
    def __init__(self, servers: List[str]):
        self.servers = servers
        self.clients = []
        self.current = 0
    
    async def initialize(self):
        """Initialize all clients"""
        for server in self.servers:
            client = ComfyUIClient(server)
            await client.__aenter__()
            self.clients.append(client)
    
    def get_client(self) -> ComfyUIClient:
        """Get next available client (round-robin)"""
        client = self.clients[self.current]
        self.current = (self.current + 1) % len(self.clients)
        return client
    
    async def cleanup(self):
        """Cleanup all clients"""
        for client in self.clients:
            await client.__aexit__(None, None, None)
```

### Caching System
```python
from functools import lru_cache
import hashlib
import json

class ResultCache:
    """Cache generation results"""
    
    def __init__(self, max_size: int = 100):
        self.cache = {}
        self.max_size = max_size
    
    def _get_cache_key(self, workflow: Dict[str, Any]) -> str:
        """Generate cache key from workflow"""
        # Sort keys for consistent hashing
        workflow_str = json.dumps(workflow, sort_keys=True)
        return hashlib.sha256(workflow_str.encode()).hexdigest()
    
    def get(self, workflow: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Get cached result"""
        key = self._get_cache_key(workflow)
        return self.cache.get(key)
    
    def set(self, workflow: Dict[str, Any], result: Dict[str, Any]):
        """Cache result"""
        if len(self.cache) >= self.max_size:
            # Remove oldest entry (simple FIFO)
            oldest = next(iter(self.cache))
            del self.cache[oldest]
        
        key = self._get_cache_key(workflow)
        self.cache[key] = result
```

## Security Considerations

### Input Validation
```python
from pydantic import BaseModel, validator
from typing import Dict, Any, List

class WorkflowNode(BaseModel):
    class_type: str
    inputs: Dict[str, Any]
    
    @validator('class_type')
    def validate_class_type(cls, v):
        # Whitelist allowed node types
        allowed_nodes = [
            'KSampler', 'CheckpointLoaderSimple', 'CLIPTextEncode',
            'EmptyLatentImage', 'VAEDecode', 'SaveImage'
        ]
        if v not in allowed_nodes:
            raise ValueError(f"Node type {v} not allowed")
        return v

class WorkflowRequest(BaseModel):
    workflow: Dict[str, WorkflowNode]
    
    @validator('workflow')
    def validate_workflow_size(cls, v):
        if len(v) > 100:
            raise ValueError("Workflow too large")
        return v
```

### Rate Limiting
```python
from collections import defaultdict
import time

class RateLimiter:
    def __init__(self, max_requests: int = 10, window: int = 60):
        self.max_requests = max_requests
        self.window = window
        self.requests = defaultdict(list)
    
    def is_allowed(self, user_id: str) -> bool:
        """Check if request is allowed"""
        now = time.time()
        
        # Clean old requests
        self.requests[user_id] = [
            req_time for req_time in self.requests[user_id]
            if now - req_time < self.window
        ]
        
        # Check limit
        if len(self.requests[user_id]) >= self.max_requests:
            return False
        
        self.requests[user_id].append(now)
        return True
```

## Best Practices

1. **Always use async/await** for ComfyUI communication
2. **Implement proper connection pooling** for high traffic
3. **Cache frequently used workflows** to reduce load
4. **Monitor ComfyUI server health** with regular health checks
5. **Implement circuit breakers** for failover scenarios
6. **Log all requests and responses** for debugging
7. **Use message queues** for reliable job processing
8. **Implement proper cleanup** for abandoned jobs
9. **Set reasonable timeouts** for all operations
10. **Validate all user inputs** before forwarding to ComfyUI

## Conclusion

Building a robust middleware for ComfyUI requires careful consideration of error handling, performance, and security. This guide provides the foundation for creating production-ready middleware services that can scale with your application needs.