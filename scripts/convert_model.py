import torch
from torch.onnx import export
from torch.quantization import quantize_dynamic
import os

# --- Configuration ---
MODEL_PATH = "path/to/your/large_pytorch_model.pth" # <-- !!! CRITICAL EDIT 1: Update this path to your actual model file!
INPUT_SHAPE = (1, 32)  # Batch size 1, sequence length 32 - ADJUST FOR YOUR MODEL'S INPUT SHAPE
ONNX_OUTPUT_PATH = "../ai_backend/optimized_quantized_model.onnx" # <-- Output path to the new service folder

def convert_and_quantize_model(model_path: str, input_shape: tuple, output_path: str):
    """
    Loads a PyTorch model, applies dynamic quantization, and exports it to ONNX format.
    This is the critical step for VRAM reduction.
    """
    print("--- Starting Model Conversion and Quantization ---")

    # 1. Load the original FP32 model (assuming it's defined as a class)
    try:
        # !!! CRITICAL EDIT 2: Replace 'YourModelClass' with the actual definition of your model architecture!
        from models import YourModelClass 
        model = YourModelClass() 
        model.load_state_dict(torch.load(model_path))
        model.eval()
        print("✅ Original PyTorch model loaded successfully.")
    except Exception as e:
        print(f"❌ Error loading original model. Ensure 'YourModelClass' and path are correct. Error: {e}")
        return

    # 2. Apply Dynamic Quantization (The VRAM Saver)
    try:
        quantized_model = quantize_dynamic(
            model, 
            {torch.nn.Linear}, # Target linear layers for quantization
            dtype=torch.qint8
        )
        print("✅ Dynamic Quantization applied successfully.")
    except Exception as e:
        print(f"❌ Error applying dynamic quantization. Check model structure compatibility. Error: {e}")
        return

    # 3. Export the quantized model to ONNX format
    try:
        dummy_input = torch.randn(*input_shape)
        export(
            quantized_model, 
            dummy_input, 
            output_path, 
            opset_version=14, # Use a modern opset version
            dynamic_axes={'input': {0: 'batch_size'}} # Allow dynamic batching
        )
        print(f"\n🎉 SUCCESS! Optimized and Quantized model saved to: {output_path}")
    except Exception as e:
        print(f"❌ Error during ONNX export. Check input shape compatibility. Error: {e}")


if __name__ == "__main__":
    convert_and_quantize_model(MODEL_PATH, INPUT_SHAPE, ONNX_OUTPUT_PATH)
