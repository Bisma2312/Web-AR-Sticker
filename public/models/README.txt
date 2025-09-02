Place the ONNX model file for U^2-Netp here as `u2netp.onnx`.

Recommended source:
- U^2-Netp (small) ONNX model from the official U-2-Net repository releases.

After placing the file, the web app will load it from `/models/u2netp.onnx` for client-side background removal.

Note:
- The app uses ONNX Runtime Web (WASM). No server changes required.
- If the model is missing, background removal will fail with an error indicating the model could not be loaded.
