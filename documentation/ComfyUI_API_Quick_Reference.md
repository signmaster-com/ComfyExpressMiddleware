# ComfyUI API Quick Reference

## Essential Endpoints

### Submit Workflow
```bash
POST /prompt
Content-Type: application/json

{
  "prompt": {...},
  "client_id": "optional-uuid"
}
```

### Check Status
```bash
GET /queue
GET /history/{prompt_id}
```

### Get Images
```bash
GET /view?filename=image.png&type=output&subfolder=
```

## Minimal Python Example

```python
import json
import urllib.request
import urllib.parse

# Submit prompt
def queue_prompt(prompt, server="127.0.0.1:8188"):
    data = json.dumps({"prompt": prompt}).encode('utf-8')
    req = urllib.request.Request(f"http://{server}/prompt", data=data)
    return json.loads(urllib.request.urlopen(req).read())

# Get image
def get_image(filename, server="127.0.0.1:8188"):
    url = f"http://{server}/view?filename={filename}&type=output"
    with urllib.request.urlopen(url) as response:
        return response.read()

# Get results
def get_history(prompt_id, server="127.0.0.1:8188"):
    url = f"http://{server}/history/{prompt_id}"
    with urllib.request.urlopen(url) as response:
        return json.loads(response.read())
```

## Minimal Workflow Example

```json
{
  "1": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": {"ckpt_name": "model.safetensors"}
  },
  "2": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "a photo of a cat",
      "clip": ["1", 1]
    }
  },
  "3": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "blurry",
      "clip": ["1", 1]
    }
  },
  "4": {
    "class_type": "EmptyLatentImage",
    "inputs": {"width": 512, "height": 512, "batch_size": 1}
  },
  "5": {
    "class_type": "KSampler",
    "inputs": {
      "seed": 123,
      "steps": 20,
      "cfg": 7,
      "sampler_name": "euler",
      "scheduler": "normal",
      "denoise": 1,
      "model": ["1", 0],
      "positive": ["2", 0],
      "negative": ["3", 0],
      "latent_image": ["4", 0]
    }
  },
  "6": {
    "class_type": "VAEDecode",
    "inputs": {
      "samples": ["5", 0],
      "vae": ["1", 2]
    }
  },
  "7": {
    "class_type": "SaveImage",
    "inputs": {
      "filename_prefix": "output",
      "images": ["6", 0]
    }
  }
}
```

## WebSocket Messages

### Connect
```
ws://127.0.0.1:8188/ws?clientId={uuid}
```

### Message Types
```json
// Status
{"type": "status", "data": {...}}

// Executing
{"type": "executing", "data": {"node": "5", "prompt_id": "..."}}

// Execution Complete
{"type": "executing", "data": {"node": null, "prompt_id": "..."}}

// Progress
{"type": "progress", "data": {"value": 10, "max": 20}}
```

## Common Node Types

### Image Generation
- `CheckpointLoaderSimple` - Load model
- `CLIPTextEncode` - Text prompt
- `EmptyLatentImage` - Create latent
- `KSampler` - Generate image
- `VAEDecode` - Decode to pixels
- `SaveImage` - Save result

### Image Input/Output
- `LoadImage` - Load from file
- `SaveImage` - Save to file
- `PreviewImage` - Preview only
- `LoadImageMask` - Load with alpha

### Image Processing
- `ImageScale` - Resize image
- `ImageUpscaleWithModel` - AI upscale
- `ImageCompositeMasked` - Composite
- `ImageBlur` - Blur effect

## Error Response Format
```json
{
  "error": "error message",
  "node_errors": {
    "node_id": "specific error"
  }
}
```

## Tips

1. **Get workflow from UI**: Enable dev mode → Save (API Format)
2. **Client ID**: Use same ID for WebSocket and HTTP
3. **Node connections**: `["node_id", output_index]`
4. **Binary data**: WebSocket sends preview images as binary
5. **Polling fallback**: Check `/history/{id}` if no WebSocket

## Common Patterns

### Wait for Completion
```python
import time

def wait_for_result(prompt_id, server="127.0.0.1:8188", timeout=60):
    start = time.time()
    while time.time() - start < timeout:
        history = get_history(prompt_id, server)
        if prompt_id in history:
            return history[prompt_id]
        time.sleep(1)
    return None
```

### Download All Images
```python
def download_images(prompt_id, server="127.0.0.1:8188"):
    history = get_history(prompt_id, server)
    images = []
    
    for node_id, node_output in history[prompt_id]['outputs'].items():
        if 'images' in node_output:
            for img in node_output['images']:
                image_data = get_image(img['filename'], server)
                images.append(image_data)
    
    return images
```

### Simple Middleware
```python
from flask import Flask, request, jsonify
import uuid

app = Flask(__name__)
jobs = {}

@app.route('/generate', methods=['POST'])
def generate():
    # Create workflow from request
    workflow = create_workflow(request.json)
    
    # Submit to ComfyUI
    result = queue_prompt(workflow)
    job_id = str(uuid.uuid4())
    
    jobs[job_id] = {
        'prompt_id': result['prompt_id'],
        'status': 'processing'
    }
    
    return jsonify({'job_id': job_id})

@app.route('/status/<job_id>')
def status(job_id):
    if job_id not in jobs:
        return jsonify({'error': 'Not found'}), 404
    
    job = jobs[job_id]
    history = get_history(job['prompt_id'])
    
    if job['prompt_id'] in history:
        job['status'] = 'complete'
        job['outputs'] = history[job['prompt_id']]['outputs']
    
    return jsonify(job)
```

## Debugging

### Enable Logging
```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

### Check Node Info
```bash
GET /object_info
GET /object_info/{node_class}
```

### List Models
```bash
GET /models
GET /models/checkpoints
GET /embeddings
```

### System Stats
```bash
GET /system_stats
```