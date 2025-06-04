# ComfyUI Seed Usage via API

## Overview

The seed parameter in ComfyUI controls random noise generation during sampling. When calling workflows via API, changing the seed value forces reprocessing of identical jobs, bypassing ComfyUI's intelligent caching system.

## Why Identical Jobs Don't Reprocess

ComfyUI uses efficient caching - it only re-executes workflow parts that have changed. Submitting the same job twice with identical parameters (including the same seed) returns cached results instead of reprocessing.

## Seed Parameter Specifications

```python
"seed": ("INT", {
    "default": 0, 
    "min": 0, 
    "max": 0xffffffffffffffff,  # 18,446,744,073,709,551,615
    "control_after_generate": True,
    "tooltip": "The random seed used for creating the noise."
})
```

- **Type**: Integer
- **Range**: 0 to 18,446,744,073,709,551,615 (64-bit unsigned)
- **Purpose**: Controls deterministic noise generation
- **Effect**: Same seed = same output (with identical inputs)

## API Usage Examples

### Basic HTTP API with Seed

```python
import json
import urllib.request
import random

# Load your workflow JSON
with open('workflow.json', 'r') as f:
    workflow = json.load(f)

# Modify seed to force reprocessing
# Assuming node "3" is your KSampler node
workflow["3"]["inputs"]["seed"] = random.randint(0, 2**32)

# Submit to ComfyUI
def queue_prompt(prompt):
    data = json.dumps({"prompt": prompt}).encode('utf-8')
    req = urllib.request.Request("http://127.0.0.1:8188/prompt", data=data)
    return json.loads(urllib.request.urlopen(req).read())

result = queue_prompt(workflow)
prompt_id = result['prompt_id']
```

### WebSocket API with Seed Randomization

```python
import websocket
import uuid
import json
import random
import urllib.request

client_id = str(uuid.uuid4())

def queue_prompt(prompt, client_id):
    p = {"prompt": prompt, "client_id": client_id}
    data = json.dumps(p).encode('utf-8')
    req = urllib.request.Request("http://127.0.0.1:8188/prompt", data=data)
    return json.loads(urllib.request.urlopen(req).read())

# Connect to WebSocket
ws = websocket.WebSocket()
ws.connect(f"ws://127.0.0.1:8188/ws?clientId={client_id}")

# Load and modify workflow
workflow = json.loads(workflow_json)

# Set random seed to force reprocessing
workflow["3"]["inputs"]["seed"] = random.randint(0, 2**63-1)

# Submit and monitor
result = queue_prompt(workflow, client_id)
prompt_id = result['prompt_id']

# Monitor execution via WebSocket
while True:
    out = ws.recv()
    if isinstance(out, str):
        message = json.loads(out)
        if message['type'] == 'executing':
            data = message['data']
            if data['node'] is None and data['prompt_id'] == prompt_id:
                break  # Execution finished
```

## Workflow Structure for Different Sampler Types

### KSampler Node

```json
{
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "seed": 42,
      "steps": 20,
      "cfg": 8,
      "sampler_name": "euler",
      "scheduler": "normal",
      "model": ["4", 0],
      "positive": ["6", 0],
      "negative": ["7", 0],
      "latent_image": ["5", 0],
      "denoise": 1.0
    }
  }
}
```

### KSamplerAdvanced Node

```json
{
  "3": {
    "class_type": "KSamplerAdvanced",
    "inputs": {
      "noise_seed": 42,
      "steps": 20,
      "cfg": 8,
      "sampler_name": "euler",
      "scheduler": "normal",
      "model": ["4", 0],
      "positive": ["6", 0],
      "negative": ["7", 0],
      "latent_image": ["5", 0],
      "start_at_step": 0,
      "end_at_step": 10000,
      "return_with_leftover_noise": "disable"
    }
  }
}
```

## Seed Strategies for API Calls

### 1. Random Seed Generation

```python
import random
import time

# Method 1: Pure random
seed = random.randint(0, 2**32)

# Method 2: Time-based (ensures uniqueness)
seed = int(time.time() * 1000000) % (2**32)

# Method 3: UUID-based
import uuid
seed = int(str(uuid.uuid4()).replace('-', ''), 16) % (2**32)
```

### 2. Incremental Seeds

```python
# Store last used seed
last_seed = 1000

def get_next_seed():
    global last_seed
    last_seed += 1
    return last_seed

# Use in workflow
workflow["3"]["inputs"]["seed"] = get_next_seed()
```

### 3. Reproducible with Variation

```python
base_seed = 12345

# Generate variations of the same base
for i in range(5):
    variant_seed = base_seed + i
    workflow["3"]["inputs"]["seed"] = variant_seed
    result = queue_prompt(workflow)
```

## Complete Example: Force Reprocessing

```python
import json
import urllib.request
import random

def submit_workflow_with_random_seed(workflow_path):
    # Load workflow
    with open(workflow_path, 'r') as f:
        workflow = json.load(f)
    
    # Find and update seed in KSampler nodes
    for node_id, node_data in workflow.items():
        if node_data.get("class_type") in ["KSampler", "KSamplerAdvanced"]:
            # Use 'seed' for KSampler, 'noise_seed' for KSamplerAdvanced
            seed_key = "noise_seed" if node_data["class_type"] == "KSamplerAdvanced" else "seed"
            node_data["inputs"][seed_key] = random.randint(0, 2**32-1)
    
    # Submit to ComfyUI
    data = json.dumps({"prompt": workflow}).encode('utf-8')
    req = urllib.request.Request("http://127.0.0.1:8188/prompt", data=data)
    response = json.loads(urllib.request.urlopen(req).read())
    
    return response['prompt_id']

# Usage
prompt_id = submit_workflow_with_random_seed('my_workflow.json')
print(f"Submitted job with ID: {prompt_id}")
```

## Key API Endpoints

- **Submit workflow**: `POST http://127.0.0.1:8188/prompt`
- **Check queue**: `GET http://127.0.0.1:8188/queue`
- **Get history**: `GET http://127.0.0.1:8188/history/{prompt_id}`
- **Download image**: `GET http://127.0.0.1:8188/view?filename={name}&type=output`
- **WebSocket monitoring**: `ws://127.0.0.1:8188/ws?clientId={uuid}`

## Best Practices

1. **Always change seeds** when you want to force reprocessing of identical workflows
2. **Use appropriate ranges** - while the max is 2^64-1, using 2^32 range is typically sufficient
3. **Store seeds** if you need to reproduce specific results later
4. **Check node types** - use `seed` for KSampler, `noise_seed` for KSamplerAdvanced
5. **Monitor via WebSocket** for real-time execution status when using random seeds

## Troubleshooting

- **Still getting cached results?** Ensure all relevant nodes have updated seeds
- **Invalid seed values?** Keep seeds within 0 to 2^64-1 range
- **Wrong parameter name?** Check if you're using `seed` vs `noise_seed` correctly
- **Node not found?** Verify the node ID in your workflow JSON matches your updates

---

## API vs UI Caching Behavior: Deep Dive Investigation

### Important Discovery: Caching System is Identical

After investigating the ComfyUI codebase, **the intelligent caching system works identically for both API calls and UI usage**. There is no special handling or duplicate detection logic that would cause different behavior between submission methods.

### How ComfyUI Caching Actually Works

The caching system uses three main types (`comfy_execution/caching.py`):
- **Classic Cache** (default): Dumps data immediately after execution
- **LRU Cache**: Least-recently-used with configurable size limit  
- **Dependency-Aware Cache**: Only holds cached items while descendants haven't executed

**Cache Key Generation:**
- Based on node class type, IS_CHANGED status, and all ancestor nodes
- Input values (constants and links to other nodes)
- Node ID (only for nodes marked NOT_IDEMPOTENT or containing UNIQUE_ID)

### Why API Calls May Fail While UI Doesn't

Since caching behavior is identical, failures with duplicate API calls are likely due to:

#### 1. **Resource Exhaustion**
- API clients submit requests faster than UI interactions
- Multiple identical workflows consume GPU memory simultaneously
- Cache memory limits exceeded with rapid submissions
- Model loading/unloading conflicts during parallel execution

#### 2. **Timing/Concurrency Issues**
- Race conditions in GPU memory allocation
- Different error handling between WebSocket (UI) and HTTP (API) connections
- Missing proper client session management

#### 3. **Missing Client Management**
API calls may lack proper `client_id` that UI provides automatically for session tracking.

### Solutions for Reliable API Usage

#### 1. **Proper Client ID Management**

```python
import uuid
import json
import urllib.request

def queue_prompt_with_client_id(workflow):
    client_id = str(uuid.uuid4())
    payload = {
        "prompt": workflow,
        "client_id": client_id
    }
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request("http://127.0.0.1:8188/prompt", data=data)
    return json.loads(urllib.request.urlopen(req).read()), client_id
```

#### 2. **Request Throttling for Identical Workflows**

```python
import time

def submit_with_throttling(workflow, delay=1.0):
    result = queue_prompt(workflow)
    time.sleep(delay)  # Prevent rapid-fire submissions
    return result

# For identical workflows, add delay between submissions
workflow1_result = submit_with_throttling(workflow)
workflow2_result = submit_with_throttling(workflow, delay=2.0)
```

#### 3. **Wait for Completion Before Resubmission**

```python
def get_history(prompt_id):
    req = urllib.request.Request(f"http://127.0.0.1:8188/history/{prompt_id}")
    return json.loads(urllib.request.urlopen(req).read())

def wait_for_completion(prompt_id, timeout=300):
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            history = get_history(prompt_id)
            if prompt_id in history:
                status = history[prompt_id].get('status', {})
                if status.get('completed', False):
                    return True
                elif 'error' in status:
                    raise Exception(f"Workflow failed: {status['error']}")
        except Exception as e:
            print(f"Error checking status: {e}")
        time.sleep(0.5)
    return False

# Safe resubmission pattern
result1 = queue_prompt(workflow)
if wait_for_completion(result1['prompt_id']):
    result2 = queue_prompt(workflow)  # Now safe to resubmit
```

#### 4. **Robust API Client with Error Handling**

```python
import time
import random

class ComfyUIClient:
    def __init__(self, base_url="http://127.0.0.1:8188"):
        self.base_url = base_url
        self.client_id = str(uuid.uuid4())
    
    def submit_workflow(self, workflow, max_retries=3, retry_delay=1.0):
        """Submit workflow with proper error handling and retries"""
        for attempt in range(max_retries):
            try:
                # Add small random seed variation to avoid exact duplicates
                self._randomize_seeds(workflow)
                
                payload = {
                    "prompt": workflow,
                    "client_id": self.client_id
                }
                
                data = json.dumps(payload).encode('utf-8')
                req = urllib.request.Request(f"{self.base_url}/prompt", data=data)
                response = json.loads(urllib.request.urlopen(req).read())
                
                return response
                
            except Exception as e:
                if attempt < max_retries - 1:
                    wait_time = retry_delay * (2 ** attempt) + random.uniform(0, 1)
                    print(f"Attempt {attempt + 1} failed: {e}. Retrying in {wait_time:.1f}s...")
                    time.sleep(wait_time)
                else:
                    raise e
    
    def _randomize_seeds(self, workflow):
        """Add small random variation to seeds to prevent exact duplicates"""
        for node_id, node_data in workflow.items():
            if node_data.get("class_type") in ["KSampler", "KSamplerAdvanced"]:
                seed_key = "noise_seed" if node_data["class_type"] == "KSamplerAdvanced" else "seed"
                if seed_key in node_data.get("inputs", {}):
                    # Add small random offset to existing seed
                    current_seed = node_data["inputs"][seed_key]
                    node_data["inputs"][seed_key] = current_seed + random.randint(0, 1000)

# Usage
client = ComfyUIClient()
result1 = client.submit_workflow(workflow)
result2 = client.submit_workflow(workflow)  # Now handles duplicates safely
```

### Updated Best Practices for API Usage

1. **Always use client_id** for proper session tracking
2. **Implement request throttling** for rapid submissions
3. **Wait for completion** before resubmitting identical workflows
4. **Add retry logic** with exponential backoff for failed requests
5. **Monitor resource usage** and implement queue limits if needed
6. **Use seed randomization** as a fallback to prevent exact duplicates

### Key Insight

The "intelligent caching" described in documentation primarily refers to **within-workflow optimization** (not re-executing unchanged parts of a workflow), not **cross-submission deduplication**. ComfyUI doesn't have built-in duplicate request handling - it processes each API call independently, which can lead to resource conflicts when identical requests arrive rapidly.

---

## WebSocket Message Differences: Detecting Cached vs Fresh Processing

### Important Discovery: WebSocket Responses Are Different

WebSocket responses **are definitively different** for cached results versus freshly processed ones. You can detect whether your workflow was served from cache or processed fresh by monitoring specific message patterns.

### Key WebSocket Message Types

ComfyUI sends three distinct message types during execution (`execution.py`):

#### 1. **`execution_cached`** Message
- **When sent**: At the beginning of execution, before any nodes are processed
- **Purpose**: Lists all nodes that will be served from cache
- **Format**:
```json
{
  "type": "execution_cached",
  "data": {
    "nodes": ["node_id_1", "node_id_2", ...],
    "prompt_id": "uuid"
  }
}
```

#### 2. **`executing`** Message  
- **When sent**: Only for nodes being actively processed (never for cached nodes)
- **Purpose**: Indicates a node is currently running
- **Format**:
```json
{
  "type": "executing", 
  "data": {
    "node": "node_id",
    "display_node": "display_id", 
    "prompt_id": "uuid"
  }
}
```

#### 3. **`executed`** Message
- **When sent**: For ALL nodes that complete (both cached and fresh)
- **Purpose**: Contains the output/result data
- **Format**:
```json
{
  "type": "executed",
  "data": {
    "node": "node_id",
    "display_node": "display_id",
    "output": {...},
    "prompt_id": "uuid"
  }
}
```

### Message Flow Patterns

#### **Cached Node Execution Flow:**
1. Node ID appears in `execution_cached` message at start
2. **NO** `executing` message is sent 
3. `executed` message is sent immediately with cached output

**Example:**
```
execution_cached: {"nodes": ["3", "7"], "prompt_id": "abc123"}
executed: {"node": "3", "output": {...}, "prompt_id": "abc123"}
executed: {"node": "7", "output": {...}, "prompt_id": "abc123"}
```

#### **Fresh Node Execution Flow:**
1. Node ID does **NOT** appear in `execution_cached` message
2. `executing` message is sent when processing begins
3. Node is actually processed/computed
4. `executed` message is sent with fresh output

**Example:**
```
executing: {"node": "3", "prompt_id": "abc123"}
executed: {"node": "3", "output": {...}, "prompt_id": "abc123"}
executing: {"node": "7", "prompt_id": "abc123"}  
executed: {"node": "7", "output": {...}, "prompt_id": "abc123"}
```

### Cache Detection Implementation

```python
import json
import websocket

def monitor_cache_behavior(workflow, client_id):
    cached_nodes = set()
    processing_nodes = set()
    
    # Connect to WebSocket
    ws = websocket.WebSocket()
    ws.connect(f"ws://127.0.0.1:8188/ws?clientId={client_id}")
    
    # Submit workflow
    result = queue_prompt(workflow, client_id)
    prompt_id = result['prompt_id']
    
    print(f"Monitoring execution for prompt: {prompt_id}")
    
    while True:
        message = json.loads(ws.recv())
        
        if message['type'] == 'execution_cached':
            cached_nodes.update(message['data']['nodes'])
            print(f"📦 Cached nodes: {cached_nodes}")
        
        elif message['type'] == 'executing':
            node_id = message['data']['node']
            if node_id:  # node can be None for completion signal
                processing_nodes.add(node_id)
                print(f"⚙️  Processing node: {node_id}")
            else:
                # Execution complete
                break
        
        elif message['type'] == 'executed':
            node_id = message['data']['node']
            if node_id in cached_nodes:
                print(f"✅ Node {node_id}: SERVED FROM CACHE")
            elif node_id in processing_nodes:
                print(f"🔥 Node {node_id}: FRESHLY PROCESSED")
    
    ws.close()
    
    # Summary
    total_cached = len(cached_nodes)
    total_processed = len(processing_nodes)
    print(f"\n📊 Execution Summary:")
    print(f"   Cached nodes: {total_cached}")
    print(f"   Processed nodes: {total_processed}")
    
    return {
        'cached_nodes': cached_nodes,
        'processed_nodes': processing_nodes,
        'was_fully_cached': total_processed == 0
    }
```

### Advanced Cache Detection with Timing

```python
import time

def detailed_cache_monitor(workflow, client_id):
    execution_log = []
    start_time = time.time()
    
    ws = websocket.WebSocket()
    ws.connect(f"ws://127.0.0.1:8188/ws?clientId={client_id}")
    
    result = queue_prompt(workflow, client_id)
    prompt_id = result['prompt_id']
    
    while True:
        message = json.loads(ws.recv())
        timestamp = time.time() - start_time
        
        if message['type'] == 'execution_cached':
            execution_log.append({
                'time': timestamp,
                'type': 'cache_list',
                'nodes': message['data']['nodes']
            })
        
        elif message['type'] == 'executing':
            node_id = message['data']['node']
            if node_id:
                execution_log.append({
                    'time': timestamp,
                    'type': 'start_processing',
                    'node': node_id
                })
            else:
                execution_log.append({
                    'time': timestamp,
                    'type': 'execution_complete'
                })
                break
        
        elif message['type'] == 'executed':
            execution_log.append({
                'time': timestamp,
                'type': 'node_complete',
                'node': message['data']['node']
            })
    
    ws.close()
    return execution_log

# Usage
log = detailed_cache_monitor(workflow, client_id)
for entry in log:
    print(f"{entry['time']:.3f}s: {entry}")
```

### Practical Applications

#### 1. **Performance Monitoring**
```python
def measure_cache_performance(workflow):
    # First submission (likely fresh)
    start_time = time.time()
    result1 = monitor_cache_behavior(workflow, str(uuid.uuid4()))
    fresh_time = time.time() - start_time
    
    # Second submission (likely cached)
    start_time = time.time()
    result2 = monitor_cache_behavior(workflow, str(uuid.uuid4()))
    cached_time = time.time() - start_time
    
    print(f"Fresh execution: {fresh_time:.2f}s")
    print(f"Cached execution: {cached_time:.2f}s")
    print(f"Speedup: {fresh_time/cached_time:.1f}x")
```

#### 2. **Debugging Workflow Changes**
```python
def debug_workflow_changes(old_workflow, new_workflow):
    print("Testing old workflow...")
    old_result = monitor_cache_behavior(old_workflow, str(uuid.uuid4()))
    
    print("Testing new workflow...")
    new_result = monitor_cache_behavior(new_workflow, str(uuid.uuid4()))
    
    print(f"Cache invalidated nodes: {new_result['processed_nodes'] - old_result['cached_nodes']}")
```

### Key Takeaways

1. **`execution_cached`** message tells you upfront which nodes will be cached
2. **`executing`** messages only appear for freshly processed nodes
3. **`executed`** messages appear for all nodes, but context determines if cached or fresh
4. **Detection pattern**: Nodes that get `executed` without `executing` were served from cache
5. **Performance insight**: Cached executions skip the `executing` phase entirely

This WebSocket message analysis provides definitive proof of whether your workflow submission was processed fresh or served from ComfyUI's intelligent caching system.