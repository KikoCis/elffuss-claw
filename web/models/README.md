# web/models/ — pesos autoalojados

Aquí van los pesos del «modelo propio» (no se versionan en git; se suben por rsync):

- `<id>/` — export ONNX (optimum) para transformers.js con `selfHosted: true`
  en `js/model-config.js`. Estructura estándar HF: `config.json`,
  `tokenizer.json`, `onnx/model_q4.onnx`, …
- `*.litertlm` — bundles LiteRT-LM (ai-edge-torch) para `js/providers/litert.js`.

Mientras esté vacío, los proveedores descargan los modelos públicos verificados
(onnx-community/Qwen2.5-0.5B-Instruct y litert-community/gemma-4-E2B-it-litert-lm).
