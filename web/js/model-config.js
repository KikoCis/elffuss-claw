// Qué modelo carga el proveedor ONNX (transformers.js).
//
// Hoy: Qwen2.5-0.5B-Instruct de onnx-community — el mismo que ya verificamos
// en el navegador en agentic-install (bitácora 08-jspace-live).
//
// Mañana («modelo propio»): exporta tu fine-tune a ONNX con optimum,
// sube las carpetas a web/models/<id>/ y pon selfHosted: true.
// Ver README § «Modelo propio».
export const MODEL = {
  label: 'Nastia LM (Qwen2.5-0.5B · ONNX)',
  id: 'onnx-community/Qwen2.5-0.5B-Instruct',
  dtype: 'q4',            // ¡NO q4f16! genera basura vía WebGPU (verificado en la bitácora)
  selfHosted: false,
  basePath: '/models/',   // solo se usa con selfHosted: true
};
