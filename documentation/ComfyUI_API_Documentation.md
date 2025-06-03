# ComfyUI API Documentation

## Overview

ComfyUI provides a comprehensive REST API and WebSocket interface for programmatic interaction with the image generation system. This documentation covers all available endpoints, authentication methods, and usage patterns for integrating ComfyUI into your applications.

## Table of Contents

1. [Getting Started](#getting-started)
2. [API Architecture](#api-architecture)
3. [Authentication](#authentication)
4. [REST API Endpoints](#rest-api-endpoints)
5. [WebSocket API](#websocket-api)
6. [Workflow Format](#workflow-format)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Best Practices](#best-practices)

## Getting Started

### Base URL
The default ComfyUI server runs on:
```
http://127.0.0.1:8188
```

### API Prefix
All REST endpoints are available with and without the `/api` prefix:
- `http://127.0.0.1:8188/prompt`
- `http://127.0.0.1:8188/api/prompt`

Both URLs point to the same endpoint.

## API Architecture

ComfyUI uses a queue-based execution system:

1. **Submit a workflow** via the `/prompt` endpoint
2. **Receive a prompt_id** for tracking
3. **Monitor execution** via WebSocket or polling
4. **Retrieve results** via the `/history` endpoint

## Authentication

### Multi-User Support

Enable multi-user mode with the `--multi-user` CLI flag. In multi-user mode, include the user ID in request headers:

```
Headers:
  comfy-user: <user_id>
```

### API Keys for External Services

When using ComfyUI API nodes that require external services (like Comfy.org), include API keys in the `extra_data` field:

```json
{
  "prompt": { ... },
  "extra_data": {
    "api_key_comfy_org": "your-api-key-here"
  }
}
```

## REST API Endpoints

### Core Workflow Endpoints

#### POST /prompt
Submit a workflow for execution.

**Request Body:**
```json
{
  "prompt": {
    "node_id": {
      "class_type": "NodeClassName",
      "inputs": { ... }
    }
  },
  "client_id": "optional-client-id",
  "extra_data": {
    "extra_pnginfo": { ... },
    "api_key_comfy_org": "optional-api-key"
  }
}
```

**Response:**
```json
{
  "prompt_id": "uuid-string",
  "number": 1,
  "node_errors": {}
}
```

#### GET /prompt
Get current queue status.

**Response:**
```json
{
  "exec_info": {
    "queue_remaining": 0
  }
}
```

### Queue Management

#### GET /queue
Get detailed queue information.

**Response:**
```json
{
  "queue_running": [[number, prompt_id, prompt, extra_data, outputs_to_execute]],
  "queue_pending": [[number, prompt_id, prompt, extra_data, outputs_to_execute]]
}
```

#### POST /queue
Manage the execution queue.

**Request Body:**
```json
{
  "clear": true,  // Clear entire queue
  "delete": ["prompt_id1", "prompt_id2"]  // Delete specific items
}
```

### Execution Control

#### POST /interrupt
Stop the currently executing prompt.

#### POST /free
Free memory and unload models.

**Request Body:**
```json
{
  "unload_models": true,
  "free_memory": true
}
```

### History and Results

#### GET /history
Get execution history.

**Query Parameters:**
- `max_items`: Maximum number of history items to return

#### GET /history/{prompt_id}
Get specific execution results.

**Response:**
```json
{
  "prompt_id": {
    "outputs": {
      "node_id": {
        "images": [
          {
            "filename": "ComfyUI_00001_.png",
            "subfolder": "",
            "type": "output"
          }
        ]
      }
    }
  }
}
```

#### POST /history
Clear history.

**Request Body:**
```json
{
  "clear": true,  // Clear all history
  "delete": ["prompt_id1", "prompt_id2"]  // Delete specific items
}
```

### File Management

#### GET /view
Retrieve generated images.

**Query Parameters:**
- `filename`: Image filename
- `type`: Directory type ("output", "input", "temp")
- `subfolder`: Optional subfolder
- `preview`: Optional preview format (e.g., "webp;90")
- `channel`: Color channel ("rgba", "rgb", "a")

#### POST /upload/image
Upload an image file.

**Form Data:**
- `image`: File data
- `type`: Directory type ("input", "temp", "output")
- `subfolder`: Optional subfolder
- `overwrite`: Whether to overwrite existing files

**Response:**
```json
{
  "name": "uploaded_image.png",
  "subfolder": "",
  "type": "input"
}
```

### System Information

#### GET /system_stats
Get system and hardware information.

**Response:**
```json
{
  "system": {
    "os": "posix",
    "ram_total": 16777216,
    "ram_free": 8388608,
    "comfyui_version": "0.0.1",
    "python_version": "3.10.0",
    "pytorch_version": "2.0.0",
    "embedded_python": false
  },
  "devices": [
    {
      "name": "NVIDIA GeForce RTX 3090",
      "type": "cuda",
      "index": 0,
      "vram_total": 25769803776,
      "vram_free": 20000000000,
      "torch_vram_total": 25769803776,
      "torch_vram_free": 20000000000
    }
  ]
}
```

### Node Information

#### GET /object_info
Get information about all available nodes.

**Response:**
```json
{
  "KSampler": {
    "input": {
      "required": {
        "model": ["MODEL"],
        "seed": ["INT", {"default": 0, "min": 0, "max": 18446744073709551615}],
        ...
      }
    },
    "output": ["LATENT"],
    "output_is_list": [false],
    "output_name": ["LATENT"],
    "name": "KSampler",
    "display_name": "KSampler",
    "description": "",
    "category": "sampling"
  }
}
```

#### GET /object_info/{node_class}
Get information about a specific node type.

### Model Management

#### GET /models
List available model types.

#### GET /models/{folder}
List models in a specific folder.

**Example:** `/models/checkpoints`

#### GET /embeddings
List available embeddings.

## WebSocket API

Connect to the WebSocket endpoint for real-time updates:

```
ws://127.0.0.1:8188/ws?clientId={client_id}
```

### Message Types

#### Status Updates
```json
{
  "type": "status",
  "data": {
    "status": {
      "exec_info": {
        "queue_remaining": 0
      }
    },
    "sid": "session_id"
  }
}
```

#### Execution Progress
```json
{
  "type": "executing",
  "data": {
    "node": "node_id",  // null when execution completes
    "prompt_id": "prompt_id"
  }
}
```

#### Progress Updates
```json
{
  "type": "progress",
  "data": {
    "value": 15,
    "max": 20
  }
}
```

### Binary Messages

ComfyUI sends binary data for preview images and text output:

1. **Preview Images** (Type 1): 4-byte header + image data
2. **Unencoded Preview Images** (Type 2): Raw image data
3. **Text Output** (Type 3): 4-byte node_id length + node_id + text

## Workflow Format

Workflows are represented as JSON objects where:
- Each key is a unique node ID
- Each node specifies its class type and inputs
- Inputs can be literal values or references to other nodes

### Node Structure
```json
{
  "node_id": {
    "class_type": "NodeClassName",
    "inputs": {
      "parameter_name": value,
      "linked_parameter": ["source_node_id", output_index]
    }
  }
}
```

### Example Workflow
```json
{
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "seed": 156680208700286,
      "steps": 20,
      "cfg": 8,
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
      "ckpt_name": "v1-5-pruned-emaonly.safetensors"
    }
  },
  "5": {
    "class_type": "EmptyLatentImage",
    "inputs": {
      "width": 512,
      "height": 512,
      "batch_size": 1
    }
  },
  "6": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "beautiful scenery nature glass bottle landscape",
      "clip": ["4", 1]
    }
  },
  "7": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "text, watermark",
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
      "filename_prefix": "ComfyUI",
      "images": ["8", 0]
    }
  }
}
```

## Code Examples

### Basic HTTP Request (Python)
```python
import json
import urllib.request

def queue_prompt(prompt):
    data = json.dumps({"prompt": prompt}).encode('utf-8')
    req = urllib.request.Request("http://127.0.0.1:8188/prompt", data=data)
    return json.loads(urllib.request.urlopen(req).read())
```

### WebSocket with Image Retrieval (Python)
```python
import websocket
import uuid
import json
import urllib.request

server_address = "127.0.0.1:8188"
client_id = str(uuid.uuid4())

def queue_prompt(prompt):
    p = {"prompt": prompt, "client_id": client_id}
    data = json.dumps(p).encode('utf-8')
    req = urllib.request.Request(f"http://{server_address}/prompt", data=data)
    return json.loads(urllib.request.urlopen(req).read())

def get_image(filename, subfolder, folder_type):
    data = {"filename": filename, "subfolder": subfolder, "type": folder_type}
    url_values = urllib.parse.urlencode(data)
    with urllib.request.urlopen(f"http://{server_address}/view?{url_values}") as response:
        return response.read()

def get_history(prompt_id):
    with urllib.request.urlopen(f"http://{server_address}/history/{prompt_id}") as response:
        return json.loads(response.read())

def get_images(ws, prompt):
    prompt_id = queue_prompt(prompt)['prompt_id']
    output_images = {}
    
    while True:
        out = ws.recv()
        if isinstance(out, str):
            message = json.loads(out)
            if message['type'] == 'executing':
                data = message['data']
                if data['node'] is None and data['prompt_id'] == prompt_id:
                    break  # Execution is done
        else:
            continue  # Binary data (preview images)
    
    history = get_history(prompt_id)[prompt_id]
    for node_id in history['outputs']:
        node_output = history['outputs'][node_id]
        if 'images' in node_output:
            images_output = []
            for image in node_output['images']:
                image_data = get_image(image['filename'], image['subfolder'], image['type'])
                images_output.append(image_data)
            output_images[node_id] = images_output
    
    return output_images

# Connect and execute
ws = websocket.WebSocket()
ws.connect(f"ws://{server_address}/ws?clientId={client_id}")
images = get_images(ws, prompt)
ws.close()
```

### Direct WebSocket Image Streaming
For receiving images directly via WebSocket without saving to disk, use the `SaveImageWebsocket` node and handle binary messages.

## Error Handling

### HTTP Status Codes
- **200**: Success
- **400**: Bad request (invalid parameters, missing data)
- **403**: Forbidden (invalid user, path traversal attempt)
- **404**: Not found
- **409**: Conflict (file already exists)
- **500**: Internal server error

### Error Response Format
```json
{
  "error": {
    "type": "error_type",
    "message": "Human readable message",
    "details": "Additional details",
    "extra_info": {}
  },
  "node_errors": {
    "node_id": "Error specific to node"
  }
}
```

## Best Practices

### 1. Connection Management
- Reuse WebSocket connections for multiple prompts
- Close connections properly to avoid timeouts
- Implement reconnection logic for long-running applications

### 2. Queue Management
- Monitor queue status before submitting large batches
- Use the `front` parameter to prioritize urgent tasks
- Implement proper cleanup of completed/failed prompts

### 3. Memory Management
- Call `/free` endpoint periodically for long-running servers
- Monitor system stats to prevent OOM errors
- Unload models when switching between different workflows

### 4. Error Handling
- Always check for node_errors in prompt responses
- Implement retry logic for transient failures
- Validate workflows before submission

### 5. Performance Optimization
- Use appropriate image preview settings to reduce bandwidth
- Batch similar operations when possible
- Cache frequently used model information

## Advanced Features

### Custom Client IDs
Specify a `client_id` to:
- Track multiple concurrent sessions
- Receive targeted WebSocket messages
- Maintain session state across reconnections

### Frontend Development
When developing custom frontends:
- All routes support CORS with proper headers
- Use the `/api` prefix for easier proxy configuration
- WebSocket connections support binary and text frames

### Model Metadata
Access SafeTensors metadata:
```
GET /view_metadata/{folder_name}?filename=model.safetensors
```

### Internal APIs
The `/internal/*` routes are for ComfyUI frontend use only and should not be used in third-party applications.

## Limitations

1. No built-in authentication system (rely on network security)
2. WebSocket connections timeout after inactivity
3. File uploads are limited by `--max-upload-size` (default varies)
4. Binary WebSocket messages have specific format requirements

## Conclusion

ComfyUI's API provides comprehensive access to all features available in the web interface. By following this documentation and the provided examples, you can build robust integrations and custom workflows for your image generation needs.

For the most up-to-date information, refer to the example scripts in the `script_examples/` directory of your ComfyUI installation.