// Configuración avanzada de proveedores externos (opt-in). Elffuss corre en
// LOCAL por defecto; esto solo se usa si el usuario lo activa a mano.
// Las claves viven en localStorage de SU navegador y nunca salen de aquí
// (las llamadas van directas del navegador al proveedor).
const KEY = 'elffuss.providers';

// Plantillas de proveedores externos. `kind` decide el dialecto de API.
const DEFAULTS = {
  openai: {
    kind: 'openai', label: 'OpenAI', enabled: false,
    baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '',
    help: 'Tu clave sk-… Se queda en tu navegador. OpenAI permite llamadas directas (CORS).',
  },
  anthropic: {
    kind: 'anthropic', label: 'Anthropic (Claude)', enabled: false,
    baseURL: 'https://api.anthropic.com', model: 'claude-sonnet-5', apiKey: '',
    help: 'Tu clave sk-ant-… Se envía la cabecera de acceso directo desde navegador.',
  },
  ollama: {
    kind: 'openai', label: 'Ollama (local)', enabled: false,
    baseURL: 'http://localhost:11434/v1', model: 'llama3.2', apiKey: 'ollama',
    help: 'Ollama en tu máquina. Arráncalo con OLLAMA_ORIGINS=* para permitir el navegador.',
  },
  server: {
    kind: 'openai', label: 'Servidor Elffuss (Ornith 9B)', enabled: false,
    baseURL: '/v1', model: 'ornith-9b', apiKey: '',
    temperature: 1.0, top_p: 0.95, thinking: false,
    help: 'El modelo grande en el servidor de UtopiaIA. No es local: los mensajes salen de tu máquina.',
  },
};

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* corrupto */ }
  const out = {};
  for (const [id, def] of Object.entries(DEFAULTS)) out[id] = { ...def, ...saved[id] };
  return out;
}

export function configs() { return load(); }
export function get(id) { return load()[id]; }

export function update(id, patch) {
  const all = load();
  all[id] = { ...all[id], ...patch };
  // no persistir los campos de ayuda estáticos
  const slim = {};
  for (const [k, v] of Object.entries(all))
    slim[k] = { enabled: v.enabled, baseURL: v.baseURL, model: v.model, apiKey: v.apiKey };
  localStorage.setItem(KEY, JSON.stringify(slim));
  return all[id];
}

// Externos habilitados → opciones del selector, como ext:<id>.
export function enabledExternals() {
  return Object.entries(load())
    .filter(([, c]) => c.enabled)
    .map(([id, c]) => ({ id: 'ext:' + id, label: c.label + (id === 'ollama' || c.baseURL.startsWith('http://localhost') ? ' · local' : ' · nube') }));
}
