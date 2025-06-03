# ComfyUI API Documentation Suite

This folder contains comprehensive documentation for utilizing ComfyUI's API capabilities. The documentation was generated through analysis of the ComfyUI codebase to provide developers with the information needed to integrate ComfyUI into their applications.

## Documentation Files

### 1. [ComfyUI_API_Documentation.md](./ComfyUI_API_Documentation.md)
**Comprehensive API Reference**
- Complete list of all REST API endpoints
- WebSocket protocol documentation
- Authentication and session management
- Workflow format specification
- Error handling guidelines
- Code examples in Python

### 2. [ComfyUI_Middleware_Development_Guide.md](./ComfyUI_Middleware_Development_Guide.md)
**Practical Middleware Implementation Guide**
- Architecture patterns for middleware design
- Complete implementation examples
- Job queue management
- Session handling
- Performance optimization strategies
- Security best practices
- Production-ready code samples

### 3. [ComfyUI_API_Quick_Reference.md](./ComfyUI_API_Quick_Reference.md)
**Quick Start Reference**
- Essential endpoints at a glance
- Minimal working examples
- Common workflow patterns
- Debugging tips
- Copy-paste ready code snippets

## Key Findings

### API Architecture
ComfyUI uses a queue-based asynchronous execution model:
1. Submit workflows via REST API
2. Monitor progress via WebSocket
3. Retrieve results via history endpoint

### Core Technologies
- **REST API**: For workflow submission and management
- **WebSocket**: For real-time progress updates
- **JSON-based workflows**: Node graph representation
- **Binary streaming**: For preview images

### Authentication
- Optional multi-user support with `--multi-user` flag
- User identification via `comfy-user` header
- API keys for external services via `extra_data` field

### Important Endpoints
- `POST /prompt` - Submit workflows
- `GET /ws` - WebSocket connection
- `GET /history/{id}` - Get results
- `GET /view` - Download images
- `GET /queue` - Monitor queue status

## Usage Recommendations

### For Web Application Developers
1. Start with the Quick Reference guide
2. Use the comprehensive documentation for detailed endpoint information
3. Implement proper error handling and retries

### For Middleware Developers
1. Review the Middleware Development Guide
2. Implement job queuing for reliability
3. Use WebSocket for real-time updates
4. Add caching for performance

### Best Practices
1. Always validate workflows before submission
2. Implement proper connection management
3. Handle both WebSocket and polling fallbacks
4. Use client IDs for session tracking
5. Monitor system resources via `/system_stats`

## Example Integration Flow

```python
# 1. Submit workflow
response = requests.post('http://localhost:8188/prompt', json={
    'prompt': workflow,
    'client_id': client_id
})
prompt_id = response.json()['prompt_id']

# 2. Monitor via WebSocket (or poll /history)
# ... WebSocket connection code ...

# 3. Get results
history = requests.get(f'http://localhost:8188/history/{prompt_id}')
outputs = history.json()[prompt_id]['outputs']

# 4. Download images
for node_outputs in outputs.values():
    if 'images' in node_outputs:
        for img in node_outputs['images']:
            image_data = requests.get('http://localhost:8188/view', params={
                'filename': img['filename'],
                'type': img['type']
            }).content
```

## Additional Resources

- **Example Scripts**: Check `/script_examples/` in the ComfyUI installation
- **Node Documentation**: Use `/object_info` endpoint for node specifications
- **UI Workflow Export**: Enable dev mode in UI to export workflows in API format

## Notes

- This documentation is based on analysis of the ComfyUI codebase
- The API is subject to change as ComfyUI is in active development
- Always test integrations thoroughly before production use
- Consider implementing circuit breakers for reliability

---

*Documentation generated through codebase analysis - for the most current information, refer to the official ComfyUI repository and example scripts.*