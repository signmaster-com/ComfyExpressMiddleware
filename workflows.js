// This file contains workflow templates for different ComfyUI configurations
// Each workflow is stored as a function that returns the workflow graph structure
// Parameters can be passed to customize the workflow
/**
 * Remove Background workflow for removing image background
 */
function getRemoveBackgroundWorkflow(){
    return {
        "2": {
            "inputs": {
                "torchscript_jit": "default",
                "image": [
                    "11",
                    0
                ]
            },
            "class_type": "InspyrenetRembg",
            "_meta": {
                "title": "Inspyrenet Rembg"
            }
        },
        "4": {
            "inputs": {
                "mask": [
                    "2",
                    1
                ]
            },
            "class_type": "MaskToImage",
            "_meta": {
                "title": "Convert Mask to Image"
            }
        },
        "11": {
            "inputs": {
                "image": ""
            },
            "class_type": "ETN_LoadImageBase64",
            "_meta": {
                "title": "Load Image (Base64)",
                "name" : "InputImageBase64"
            }
        },
        "17": {
            "inputs": {
                "filename_prefix": "removedbg",
                "images": ["2", 0]
            },
            "class_type": "SaveImage",
            "_meta": {
                "title": "Save Image - Background Removed"
            }
        },
        "18": {
            "inputs": {
                "filename_prefix": "mask",
                "images": ["4", 0]
            },
            "class_type": "SaveImage",
            "_meta": {
                "title": "Save Image - Mask"
            }
        }
    };
}

/**
 * Upscale Image workflow for enhancing images by up scaling
 */
function getUpscaleImageWorkflow(){
    return {
        "3": {
            "inputs": {
                "model_name": "4x_NMKD-Siax_200k.pth"
            },
            "class_type": "UpscaleModelLoader",
            "_meta": {
                "title": "Load Upscale Model"
            }
        },
        "5": {
            "inputs": {
                "upscale_model": [
                    "3",
                    0
                ],
                "image": [
                    "8",
                    0
                ]
            },
            "class_type": "ImageUpscaleWithModel",
            "_meta": {
                "title": "Upscale Image (using Model)"
            }
        },
        "7": {
            "inputs": {
                "upscale_method": "bicubic",
                "scale_by": 0.2500000000000001,
                "image": [
                    "5",
                    0
                ]
            },
            "class_type": "ImageScaleBy",
            "_meta": {
                "title": "Upscale Image By"
            }
        },
        "8": {
            "inputs": {
                "image": ""
            },
            "class_type": "ETN_LoadImageBase64",
            "_meta": {
                "title": "Load Image (Base64)",
                "name" : "InputImageBase64"
            }
        },
        "10": {
            "inputs": {
                "filename_prefix": "upscaled",
                "images": [
                    "7",
                    0
                ]
            },
            "class_type": "SaveImage",
            "_meta": {
                "title": "Save Image - Upscaled"
            }
        }
    };
}

function getUpscaleRemoveBGWorkflow(format = 'PNG'){
    return {
        "2": {
            "inputs": {
                "image": ""
            },
            "class_type": "ETN_LoadImageBase64",
            "_meta": {
                "title": "Load Image (Base64)",
                "name" : "InputImageBase64"
            }
        },
        "3": {
            "inputs": {
                "model_name": "4x_NMKD-Siax_200k.pth"
            },
            "class_type": "UpscaleModelLoader",
            "_meta": {
                "title": "Load Upscale Model"
            }
        },
        "5": {
            "inputs": {
                "upscale_model": [
                    "3",
                    0
                ],
                "image": [
                    "2",
                    0
                ]
            },
            "class_type": "ImageUpscaleWithModel",
            "_meta": {
                "title": "Upscale Image (using Model)"
            }
        },
        "7": {
            "inputs": {
                "upscale_method": "bicubic",
                "scale_by": 0.5000000000000001,
                "image": [
                    "5",
                    0
                ]
            },
            "class_type": "ImageScaleBy",
            "_meta": {
                "title": "Upscale Image By"
            }
        },
        "8": {
            "inputs": {
                "format": format,
                "quality": 85,
                "resize_factor": 1,
                "compression_level": 6,
                "save_image": true,
                "output_prefix": "compressed_",
                "output_path": "",
                "images": [
                    "9",
                    0
                ]
            },
            "class_type": "ImageCompressor",
            "_meta": {
                "title": "🐟Image Compressor"
            }
        },
        "9": {
            "inputs": {
                "torchscript_jit": "default",
                "image": [
                    "7",
                    0
                ]
            },
            "class_type": "InspyrenetRembg",
            "_meta": {
                "title": "Inspyrenet Rembg"
            }
        }
    }
}

// Export all workflow functions
module.exports = {
    getRemoveBackgroundWorkflow,
    getUpscaleImageWorkflow,
    getUpscaleRemoveBGWorkflow
};