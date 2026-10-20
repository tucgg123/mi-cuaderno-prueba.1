// Hecho por Sebastián Poveda y Santiago Romero. 2026 · generación de temas con IA en segundo plano
//
// Las funciones normales de Netlify tienen un tiempo máximo y un archivo grande puede tardar más
// (error 504). Esta versión corre en segundo plano (hasta 15 minutos): Netlify responde 202 al
// instante y, cuando la IA termina, el resultado se guarda en Firestore (colección iaJobs), donde
// la página lo está esperando. Reutiliza TODO de generar-tema.js: login, límite por hora, Gemini,
// reintentos y validación del resultado.
//
// IMPORTANTE: esta función nunca debe lanzar errores. Si lo hiciera, Netlify la reintentaría
// automáticamente y se volvería a gastar cuota de la IA.
const { handler: generar } = require('./generar-tema.js');

const PROYECTO = process.env.FIREBASE_PROJECT_ID || 'mi-cuaderno-904fa';
const LIMITE_BACKGROUND_MS = 240000; // 4 minutos para la IA (el máximo de la plataforma es 15)

function tokenDe(event) {
  const h = event.headers || {};
  const m = (h.authorization || h.Authorization || '').match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// Escribe en Firestore con el token de la propia persona (así las reglas de seguridad la protegen).
async function guardar(jobId, token, campos) {
  const mascara = Object.keys(campos).map(k => 'updateMask.fieldPaths=' + k).join('&');
  const fields = {};
  Object.keys(campos).forEach(k => { fields[k] = { stringValue: String(campos[k]) }; });
  const url = 'https://firestore.googleapis.com/v1/projects/' + PROYECTO +
    '/databases/(default)/documents/iaJobs/' + jobId + '?' + mascara;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ fields })
  });
  if (!r.ok) throw new Error('Firestore respondió ' + r.status + ': ' + (await r.text()).slice(0, 300));
}

exports.handler = async (event) => {
  let jobId = null;
  let token = null;
  try {
    const cuerpo = JSON.parse(event.body || '{}');
    jobId = String(cuerpo.jobId || '');
    token = tokenDe(event);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(jobId) || !token) {
      console.error('Petición sin jobId válido o sin sesión.');
      return;
    }

    const r = await generar({ ...event, httpMethod: 'POST', _limiteMs: LIMITE_BACKGROUND_MS });

    let datos = null;
    try { datos = JSON.parse(r.body); } catch (e) { /* respuesta sin JSON */ }

    if (r.statusCode === 200 && datos) {
      await guardar(jobId, token, { estado: 'listo', resultado: r.body });
    } else {
      await guardar(jobId, token, {
        estado: 'error',
        mensaje: (datos && datos.error) || ('La IA respondió con el código ' + r.statusCode + '.')
      });
    }
  } catch (err) {
    console.error('Error en la función en segundo plano:', err);
    try {
      if (jobId && token) await guardar(jobId, token, { estado: 'error', mensaje: 'Error inesperado: ' + err.message });
    } catch (e2) {
      console.error('Tampoco se pudo avisar del error:', e2);
    }
  }
  // Sin "throw" ni valor de retorno útil: en segundo plano nadie lee la respuesta.
};
