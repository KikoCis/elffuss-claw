// Qué modelo carga el proveedor ONNX (transformers.js).
//
// Hoy: Qwen2.5-0.5B-Instruct de onnx-community — el mismo que ya verificamos
// en el navegador en agentic-install (bitácora 08-jspace-live).
//
// Mañana («modelo propio»): exporta tu fine-tune a ONNX con optimum,
// sube las carpetas a web/models/<id>/ y pon selfHosted: true.
// Ver README § «Modelo propio».
export const MODEL = {
  label: 'Elffuss LM (Qwen2.5-0.5B · ONNX)',
  id: 'onnx-community/Qwen2.5-0.5B-Instruct',
  dtype: 'q4',            // ¡NO q4f16! genera basura vía WebGPU (verificado en la bitácora)
  selfHosted: false,
  basePath: '/models/',   // solo se usa con selfHosted: true
};
// NO subir a Qwen2.5-1.5B: su q4 (1.8 GB) revienta onnxruntime-web al crear la
// sesión (OOM del heap wasm de 4 GB, throw numérico ~3.3e9). Límite práctico
// medido: ≤~1 GB en disco → ver coordinacion/ERRORES.md E-005 y NECESIDADES N-002.

// Modelo potente servido desde el servidor de UtopiaIA (llama.cpp, /v1 vía
// nginx): Ornith-1.0-9B (Qwen3.5-9B de DeepReinforce, repack de KikoCis con
// el chat template arreglado) requantizado a Q4_K_M. OJO sampling: Ornith
// DEGENERA con temperatura baja — temp 1.0 / top_p 0.95 obligatorios
// (evaluado en el README del repack). El 31B IQ2_M (10.9 GB) NO cabe en la
// RAM del servidor (15 GB, ~9.7 disponibles): quedaría <1 tok/s por disco.
export const REMOTE = {
  label: 'Ornith 9B · servidor',
  model: 'ornith-9b',
  temperature: 1.0,
  top_p: 0.95,
  maxTokens: 1024,
  // Ornith es razonador, pero en la CPU del servidor genera a ~3.5 t/s:
  // razonar 1500 tokens = ~7 min/turno (medido). Con thinking desactivado
  // responde en segundos (4.7 s el saludo). true = modo profundo (lento).
  thinking: false,
};
