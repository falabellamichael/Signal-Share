import onnxruntime as ort
import numpy as np
from flask import Flask, request, jsonify
import os

# --- Configuration ---
MODEL_PATH = "optimized_quantized_model.onnx" # <-- CRITICAL: Must match the output from your model conversion script!
SERVICE_PORT = 5001

app = Flask(__name__)
session = None

def initialize_engine():
    """Initializes and caches the ONNX Runtime inference session once when the service starts."""
    global session
    print("--- Initializing AI Inference Engine ---")
    if not os.path.exists(MODEL_PATH):
        print(f"❌ CRITICAL ERROR: Model file not found at {MODEL_PATH}. Please run your model conversion script first.")
        return False

    try:
        # Prioritize CUDA if available for maximum VRAM/speed benefit, otherwise fall back to CPU.
        providers = ['CUDAExecutionProvider', 'CPUExecutionProvider'] 
        session = ort.InferenceSession(MODEL_PATH, providers=providers)
        print("✅ Optimized ONNX Runtime Inference Engine initialized successfully.")
        return True
    except Exception as e:
        # Error Handling Rule: Do not hide important errors silently.
        print(f"❌ CRITICAL ERROR: Failed to initialize ONNX Runtime session. Check dependencies and model format. Error: {e}")
        return False

def preprocess_data(text: str) -> np.ndarray:
    """
    Placeholder for tokenization and tensor creation. 
    *** YOU MUST IMPLEMENT YOUR MODEL'S SPECIFIC TOKENIZATION LOGIC HERE ***
    """
    print("-> Preprocessing input data...")
    # Dummy return: A 1x32 float array matching the expected ONNX input shape (adjust dimensions!)
    return np.random.rand(1, 32).astype(np.float32)

def postprocess_output(raw_output: np.ndarray) -> str:
    """
    Placeholder for converting raw model output (logits/embeddings) back to usable data.
    *** YOU MUST IMPLEMENT YOUR MODEL'S SPECIFIC DECODING LOGIC HERE ***
    """
    print("-> Postprocessing inference results...")
    # Dummy return: A simple string result
    return "The optimized AI response is ready."


@app.route('/api/v3/generate', methods=['POST'])
def generate_response():
    """API endpoint for receiving requests and running optimized inference."""
    if session is None:
        return jsonify({"error": "Service not initialized or model failed to load."}), 503

    data = request.get_json()
    input_text = data.get('prompt')

    if not input_text:
        return jsonify({"error": "Prompt is required in the request body."}), 400

    try:
        # --- Inference Logic Execution ---
        input_tensor = preprocess_data(input_text) 
        
        # Get names from the ONNX model metadata
        input_name = session.get_inputs()[0].name
        output_name = session.get_outputs()[0].name

        # Run inference using the optimized session
        ort_inputs = {input_name: input_tensor}
        ort_outs = session.run([output_name], ort_inputs)

        final_result = postprocess_output(ort_outs[0]) 
        
        return jsonify({"status": "success", "response": final_result})

    except Exception as e:
        print(f"❌ Inference execution failed during request handling: {e}")
        # User-facing error should be clear but not overly technical.
        return jsonify({"status": "error", "message": "AI processing failed due to an internal system error."}), 500


if __name__ == '__main__':
    if initialize_engine():
        print(f"\n🚀 Starting AI Inference Service on http://127.0.0.1:{SERVICE_PORT}")
        # Use a proper WSGI server (like Gunicorn) in production, but Flask is fine for development.
        app.run(host='0.0.0.0', port=SERVICE_PORT)
