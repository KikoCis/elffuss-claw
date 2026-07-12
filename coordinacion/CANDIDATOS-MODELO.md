# Análisis de candidatos a cerebro de Elffuss — julio 2026

Restricciones **medidas** (no de folleto): onnxruntime-web tiene heap wasm de
4 GB → el modelo debe pesar **≤~1 GB en disco** (q4); WebGPU para velocidad;
dtype `q4` (no q4f16); debe seguir el protocolo agéntico (tool-calls JSON +
```html apps) y hablar el idioma del navegador.

## Veredicto (probado en Elffuss real, Chromium+WebGPU, 12-jul-2026)

| Modelo | Tamaño q4 | ¿Carga? | Prueba agéntica | Veredicto |
|---|---|---|---|---|
| **LFM2.5-1.2B-Instruct** (Liquid, jun-2026) | **850 MB** | ✅ (necesita transformers.js **v4**) | ⭐ App contador completa y funcional al primer intento, renderizada en el visor; resumen en buen español; ~45 s la app entera; 0 errores | **🏆 NUEVO DEFAULT** |
| Qwen2.5-0.5B-Instruct (el anterior) | 786 MB | ✅ | Bucle completo pero apps basura (`<script src="path/to/boton.js">`), español pobre | Relevado |
| **Qwen3.5-0.8B** (mar-2026, multimodal) | 716 MB | ✅ carga | ❌ RuntimeError «unaligned accesses» (su arquitectura híbrida `past_conv/past_recurrent` pisa un bug de ort-web) + generación lentísima (7 min) | Descartado HOY; revisar con futuras versiones de ort |
| Granite 4.0 Nano 1B web (IBM) | **1781 MB** | ❌ (mismo tamaño que el Qwen 1.5B que reventó el wasm) | — | No cabe. El 350M (≈300 MB) queda como opción ultraligera no probada |
| Qwen3.5-2B | 1753 MB | ❌ previsible | — | No cabe |
| Gemma-4 E2B `.litertlm` (LiteRT-LM) | ~GBs | ✅ (ruta LiteRT, solo WebGPU) | sin E2E | La vía del modelo propio (N-001) |

## Notas técnicas

- **LFM2.5-1.2B exige transformers.js v4** (arquitectura nueva): con v3 lanza
  un throw numérico (`10283960`) al crear la sesión. El proveedor onnx ya
  importa `@huggingface/transformers@4`. Liquid la vende como «building block
  of on-device agentic AI» y en nuestra prueba lo es: primer modelo local que
  clava el protocolo sin fine-tune. Existe variante **-Thinking** (mismo
  tamaño) si algún día queremos razonamiento local.
- Qwen3.5-0.8B era el candidato bonito (multimodal, 262K ctx, misma familia
  que Ornith) — bloqueado por el runtime, no por el modelo. Re-evaluar cuando
  onnxruntime-web arregle los accesos no alineados de arquitecturas híbridas.
- Para **N-002 (fine-tune propio)**: la base recomendada pasa a ser
  **LFM2.5-1.2B** (850 MB q4, agentic-first) o su hermana 700M/350M si el SFT
  demuestra que basta menos. Qwen3.5-0.8B vuelve a la lista si ort-web lo
  arregla.
- Externos por API (config avanzada, sin límite de tamaño): Ornith 9B servidor
  (medido: 3.5 t/s CPU), OpenAI/Anthropic/Ollama con clave del usuario.
