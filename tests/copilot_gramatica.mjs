// Guardia de la gramática de salida del copiloto.  node tests/copilot_gramatica.mjs
//
// Cada caso es una salida REAL o realista de cerebro pequeño: el modelo que se
// pone a hacer de cliente, el que copia la plantilla del contrato, el que
// inventa un teléfono que nadie dijo. Si estos casos dejan de filtrarse, el
// copiloto vuelve a meter basura en la ficha del usuario.
import { parse, faltan, fallbackAdvice, contrato, ACCIONES } from '../web/js/copilot-grammar.js';

const VENTAS = {
  id: 'ventas', kind: 'goals', tag: 'OBJETIVOS',
  slots: [{ key: 'nombre', label: 'El cliente da su nombre' }, { key: 'interes', label: 'El cliente muestra interés' },
    { key: 'telefono', label: 'El cliente da su teléfono' }, { key: 'compra', label: 'El cliente quiere comprar' }],
  rule: 'OBJETIVOS: nombre=si|no; interes=si|no; telefono=si|no; compra=si|no',
};
const FICHA = {
  id: 'ficha', kind: 'fields', tag: 'DATOS',
  slots: [{ key: 'nombre', label: 'Nombre' }, { key: 'empresa', label: 'Empresa' }, { key: 'telefono', label: 'Teléfono' },
    { key: 'email', label: 'Email' }, { key: 'necesidad', label: 'Necesidad' }],
  rule: 'DATOS: solo los campos que se hayan dicho, separados por punto y coma.',
};

let fallos = 0;
const t = (nombre, cond, extra = '') => {
  if (!cond) { fallos++; console.log('FAIL ' + nombre + (extra ? '  → ' + extra : '')); }
  else console.log('ok   ' + nombre);
};

// ── consejo: lo bueno pasa ───────────────────────────────────────────────────
{
  const r = parse('CONSEJO: Pregúntale por el plazo antes de dar precio.\nACCION: preguntar\nOBJETIVOS: nombre=si; interes=si; telefono=no; compra=no',
    VENTAS, { transcript: '[Hablante 2] Me llamo Ana y me interesa lo del mantenimiento.' });
  t('consejo bueno se conserva', r.advice.startsWith('Pregúntale por el plazo'), r.advice);
  t('accion del vocabulario', r.action === 'preguntar', r.action);
  t('objetivos si→true, no se ignora', r.updates.nombre === true && r.updates.interes === true && !('telefono' in r.updates), JSON.stringify(r.updates));
  t('nada rechazado', r.rejected.length === 0, r.rejected.join(','));
}

// ── consejo: lo malo se cae ─────────────────────────────────────────────────
{
  const r = parse('Claro, con mucho gusto le ayudo con eso.', VENTAS, {});
  t('sin marca CONSEJO: no hay consejo', r.advice === '', r.advice);
}
{
  const r = parse('CONSEJO: <una línea accionable para el usuario>\nOBJETIVOS: nombre=si', VENTAS, {});
  t('plantilla copiada se rechaza', r.advice === '' && r.rejected.includes('consejo-plantilla'), r.rejected.join(','));
}
{
  const r = parse('CONSEJO: Hola, ¿en qué puedo ayudarle hoy?\nACCION: preguntar', VENTAS, {});
  t('modelo haciendo de interlocutor se rechaza', r.advice === '' && r.rejected.includes('consejo-dialogo'), r.rejected.join(','));
}
{
  const linea = '[Hablante 2] Pues estamos mirando cambiar el mantenimiento del edificio este trimestre.';
  const r = parse('CONSEJO: Estamos mirando cambiar el mantenimiento del edificio este trimestre.\nACCION: esperar', VENTAS, { transcript: linea });
  t('eco del cliente se rechaza', r.advice === '' && r.rejected.includes('consejo-eco'), r.rejected.join(','));
}
{
  const r = parse('CONSEJO: —\nOBJETIVOS: nombre=no', VENTAS, {});
  t('consejo vacío («—») se rechaza', r.advice === '', r.advice);
}
{
  const largo = 'CONSEJO: ' + 'Insiste en el valor del servicio y en la garantía. '.repeat(12);
  const r = parse(largo, VENTAS, {});
  t('consejo larguísimo se recorta', r.advice.length <= 220 && r.advice.endsWith('…'), 'len=' + r.advice.length);
}

// ── acción: vocabulario cerrado ─────────────────────────────────────────────
{
  const r = parse('CONSEJO: Pide el teléfono.\nACCION: vender_mas_fuerte', VENTAS, {});
  t('acción inventada se descarta', r.action === '' && r.rejected.includes('accion-fuera-de-vocabulario'), r.action);
}
{
  const r = parse('CONSEJO: Cierra ya.\nACCION: Cerrar', VENTAS, {});
  t('acción con mayúscula/tilde se normaliza', r.action === 'cerrar', r.action);
}

// ── datos: forma + anclaje ──────────────────────────────────────────────────
{
  const tr = '[Hablante 2] Buenas, soy Ana Ruiz de Acme. Mi teléfono es el 611 22 33 44.';
  const r = parse('CONSEJO: Confirma el email.\nDATOS: nombre=Ana Ruiz; empresa=Acme; telefono=611223344', FICHA, { transcript: tr });
  t('datos dichos entran', r.updates.nombre === 'Ana Ruiz' && r.updates.empresa === 'Acme' && r.updates.telefono === '611223344', JSON.stringify(r.updates));
}
{
  const tr = '[Hablante 2] Apunta: seis uno uno, dos dos, tres tres, cuatro cuatro.';
  const r = parse('CONSEJO: Repite el número para confirmar.\nDATOS: telefono=611223344', FICHA, { transcript: tr });
  t('teléfono DICTADO cuenta como anclado', r.updates.telefono === '611223344', r.rejected.join(','));
}
{
  const tr = '[Hablante 2] Buenas, soy Ana Ruiz de Acme.';
  const r = parse('CONSEJO: Pídele el teléfono.\nDATOS: nombre=Ana Ruiz; telefono=600123456', FICHA, { transcript: tr });
  t('teléfono INVENTADO se rechaza', !('telefono' in r.updates) && r.rejected.includes('valor-inventado:telefono'), r.rejected.join(','));
}
{
  const tr = '[Hablante 2] Mi correo es ana arroba acme punto com.';
  const r = parse('CONSEJO: Confirma.\nDATOS: email=ana(at)acme', FICHA, { transcript: tr });
  t('email mal formado se rechaza', !('email' in r.updates) && r.rejected.includes('valor-mal-formado:email'), r.rejected.join(','));
}
{
  const r = parse('CONSEJO: Ok.\nDATOS: presupuesto=50000; nombre=Ana', FICHA, { transcript: '[Hablante 2] Soy Ana.' });
  t('ranura que no existe en la skill se rechaza', !('presupuesto' in r.updates) && r.rejected.some(x => x.startsWith('ranura-inventada')), r.rejected.join(','));
}
{
  const r = parse('CONSEJO: Ok.\nDATOS: nombre=…; empresa=-; necesidad=n/a', FICHA, { transcript: '[Hablante 2] Hola.' });
  t('valores-plantilla se rechazan', Object.keys(r.updates).length === 0, JSON.stringify(r.updates));
}
{
  const r = parse('CONSEJO: Ok.\nDATOS: teléfono=611223344', FICHA, { transcript: '[Hablante 2] El 611223344.' });
  t('clave con tilde se normaliza', r.updates.telefono === '611223344', JSON.stringify(r.updates));
}

// ── faltan / consejo determinista ───────────────────────────────────────────
{
  t('faltan (goals)', faltan(VENTAS, { nombre: true }).length === 3, JSON.stringify(faltan(VENTAS, { nombre: true })));
  t('faltan (fields)', faltan(FICHA, { nombre: 'Ana', email: '' }).length === 4);
  const a = fallbackAdvice(VENTAS, { nombre: true }, 'preguntar');
  t('fallback preguntar nombra lo que falta', /Pregunta ahora por/.test(a) && a.includes('interés'), a);
  t('fallback cerrar con todo lleno', /cierra/i.test(fallbackAdvice(VENTAS, { nombre: true, interes: true, telefono: true, compra: true }, 'cerrar')));
  t('fallback sin acción no se queda mudo', fallbackAdvice(FICHA, {}, '').length > 10);
  for (const acc of ACCIONES) t('fallback «' + acc + '» produce texto', fallbackAdvice(FICHA, { nombre: 'Ana' }, acc).length > 10);
}

// ── llamada simulada con los tres cerebros medidos en navegador ─────────────
// El copiloto NUNCA debe quedarse mudo ni meter en la ficha algo que nadie dijo,
// da igual qué modelo haya cargado. Los tres comportamientos son los observados
// de verdad: Gemma aconseja, LFM2.5 no dice nada, Qwen marca todo «sí».
{
  const turnos = [
    '[Hablante 2] Buenas, soy Ana Ruiz, de Acme.',
    '[Hablante 2] Estamos mirando cambiar el mantenimiento del edificio.',
    '[Hablante 2] Apunta el teléfono: seis uno uno, dos dos, tres tres, cuatro cuatro.',
  ];
  const CEREBROS = {
    gemma: i => ['CONSEJO: Pregúntale qué falla en el mantenimiento actual.\nACCION: profundizar\nDATOS: nombre=Ana Ruiz; empresa=Acme',
      'CONSEJO: Cuantifica el problema antes de dar precio.\nACCION: preguntar\nDATOS: necesidad=cambiar el mantenimiento',
      'CONSEJO: Repite el número en voz alta para confirmarlo.\nACCION: cerrar\nDATOS: telefono=611223344'][i],
    mudo: () => '',                                                   // LFM2.5: no marca nada
    parlanchin: i => turnos[i].replace('[Hablante 2] ', 'CONSEJO: '),  // el que hace de eco
    fabulador: () => 'CONSEJO: Llámale luego.\nACCION: cerrar\nDATOS: telefono=600999888; email=ana@inventado.com',
  };
  for (const [nombre, cerebro] of Object.entries(CEREBROS)) {
    const data = {}; let mudos = 0, inventados = 0;
    const dicho = [];
    for (let i = 0; i < turnos.length; i++) {
      dicho.push(turnos[i]);
      const r = parse(cerebro(i), FICHA, { transcript: dicho.join('\n') });
      Object.assign(data, r.updates);
      const consejo = r.advice || fallbackAdvice(FICHA, data, r.action);
      if (!consejo || consejo.length < 10) mudos++;
      inventados += r.rejected.filter(x => x.startsWith('valor-inventado')).length;
    }
    t('cerebro «' + nombre + '»: nunca se queda mudo', mudos === 0, mudos + ' turnos sin consejo');
    if (nombre === 'fabulador') {
      t('cerebro «fabulador»: el teléfono inventado no entra', !data.telefono && inventados > 0, JSON.stringify(data));
      t('cerebro «fabulador»: el email inventado no entra', !data.email, JSON.stringify(data));
    }
    if (nombre === 'gemma') {
      t('cerebro «gemma»: los datos dichos sí entran', data.nombre === 'Ana Ruiz' && data.telefono === '611223344', JSON.stringify(data));
    }
  }
}

// ── el contrato y el validador no se pueden separar ─────────────────────────
{
  const c = contrato(VENTAS);
  t('el contrato lleva las 3 líneas', /CONSEJO:/.test(c) && /ACCION:/.test(c) && c.includes(VENTAS.rule), c);
  t('el contrato lista el vocabulario real', ACCIONES.every(a => c.includes(a)));
}

console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
