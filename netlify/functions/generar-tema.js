// Esta función corre en el servidor de Netlify, nunca en el navegador del usuario.
// La clave se lee de la variable de entorno APIKEYGEMINIS (Site settings > Environment
// variables en Netlify) y jamás queda expuesta en el código ni en el sitio publicado.

// Si el primero está saturado o no existe, se prueba el siguiente.
const MODELOS = ['gemini-3.8-flash', 'gemini-3.5-flash'];

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(obj)
});
// hecho por Sebastian Poveda y Santiago Romero. 2026 
// Tiempo máximo total esperando a la IA. Si se pasa, respondemos con un error claro
// en vez de dejar que Netlify corte la función con un 502 sin explicación.
const LIMITE_MS = 25000;

async function llamarGemini(apiKey, prompt) {
  const inicio = Date.now();
  let ultima;
  for (const modelo of MODELOS) {
    for (let intento = 0; intento < 2; intento++) {
      const restante = LIMITE_MS - (Date.now() - inicio);
      if (restante < 3000) throw new Error('TIMEOUT');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), restante);
      let resp;
      try {
        resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
          {
            method: 'POST',
            signal: ctrl.signal,
            headers: {
              'content-type': 'application/json',
              'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.4,
                maxOutputTokens: 8192
              }
            })
          }
        );
      } catch (e) {
        if (e.name === 'AbortError') throw new Error('TIMEOUT');
        throw e;
      } finally {
        clearTimeout(timer);
      }
      if (resp.ok) return resp;
      ultima = resp;
      console.error('Gemini respondió', resp.status, 'con el modelo', modelo);
      // 404 = modelo no disponible, 429 = cuota agotada: reintentar solo gastaría más cuota,
      // así que se pasa directo al siguiente modelo (cada modelo tiene su propio límite).
      if (resp.status === 404 || resp.status === 429) break;
      if (![500, 503].includes(resp.status)) return resp; // error que no se arregla reintentando
      if (intento === 0) await new Promise(r => setTimeout(r, 800));
    }
  }
  return ultima;
}

// Intenta leer el JSON de la IA. Si vino con ```json o cortado a la mitad, lo rescata:
// recorta hasta el último elemento completo y cierra los corchetes que falten.
function leerJSON(raw) {
  let t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch (e) { /* sigue */ }
  for (let i = t.length - 1; i > 0 && i > t.length - 4000; i--) {
    const ch = t[i];
    if (ch !== '}' && ch !== ']') continue;
    const base = t.slice(0, i + 1);
    for (const c of ['', ']}', '}]}', ']}]}']) {
      try {
        const obj = JSON.parse(base + c);
        if (obj && obj.titulo && Array.isArray(obj.secciones || obj.tarjetas)) return obj;
      } catch (e) { /* prueba otro cierre */ }
    }
  }
  return null;
}
// hecho por Sebastian Poveda y Santiago Romero. 2026 
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Método no permitido.' });
  }

  const apiKey = process.env.APIKEYGEMINIS;
  if (!apiKey) {
    return json(500, { error: 'Falta configurar APIKEYGEMINIS en Netlify (Site settings > Environment variables).' });
  }
// hecho por Sebastian Poveda y Santiago Romero. 2026 
  let texto, materia;
  try {
    const body = JSON.parse(event.body || '{}');
    texto = (body.texto || '').toString();
    materia = (body.materia || '').toString();
  } catch (e) {
    return json(400, { error: 'Cuerpo de la petición inválido.' });
  }

  if (!texto.trim()) {
    return json(400, { error: 'No llegó texto para analizar.' });
  }

  // Tope de seguridad: no mandamos textos gigantes a la IA (cuesta más y no hace falta).
  const textoRecortado = texto.slice(0, 20000);
// hecho por Sebastian Poveda y Santiago Romero. 2026 
  const prompt = `Eres un asistente que ayuda a estudiantes universitarios a convertir apuntes de clase (sacados de un PDF o una presentación) en material de estudio.

Materia: "${materia || 'sin especificar'}"

PROCESO (hazlo mentalmente, no lo escribas):
1. Analiza primero el texto completo: qué tipo de contenido es (teoría, un modelo o autor, un procedimiento, ejercicios, casos, formulario, legislación, etc.) y qué temas contiene realmente.
2. Según ese análisis, decide TÚ cuáles secciones necesita este material. La estructura debe adaptarse al contenido: no uses una plantilla fija.
3. Escribe cada sección únicamente con información que esté en el texto.

REGLAS DE LAS SECCIONES:
- Entre 3 y 6 secciones, ordenadas de forma lógica para estudiar.
- Incluye una sección solo si el texto tiene material para ella. Por ejemplo, "Autor y año" solo si el texto menciona un autor o una fecha; "Ejemplos" solo si hay ejemplos; "Limitaciones o críticas" solo si se discuten; "Fórmulas" solo si hay fórmulas; "Pasos del procedimiento" solo si hay un procedimiento.
- Los títulos deben ser específicos del contenido (por ejemplo "Componentes de la memoria de trabajo"), no genéricos.
- No inventes datos que no estén en el texto. Si algo no aparece, no crees la sección.
- "puntos" son de 2 a 5 ideas clave de la sección, cada una corta (máximo 12 palabras), tomadas del contenido. Alimentan un esquema visual, así que deben poder leerse solas.
- "contenido" debe ser claro y bien organizado, 1 o 2 párrafos cortos, o una lista de 3 a 6 guiones cuando sea más claro. Sé conciso. Texto plano, sin markdown con asteriscos.

Devuelve EXCLUSIVAMENTE un JSON válido, sin explicación adicional, con esta forma exacta:

{"titulo":"título corto para el tema (máx 8 palabras)","secciones":[{"titulo":"título de la sección","contenido":"contenido de la sección","puntos":["idea clave corta","otra idea clave corta"]}],"tarjetas":[{"frente":"término o pregunta corta","reverso":"definición o respuesta clara y no muy larga"}]}

Genera entre 8 y 12 tarjetas que cubran los conceptos, definiciones y términos clave del texto. El "frente" debe ser corto (un término o una pregunta). El "reverso" debe responder con precisión sin ser un párrafo entero.

TEXTO A ANALIZAR:
"""
${textoRecortado}
"""`;
// hecho por Sebastian Poveda y Santiago Romero. 2026 
  try {
    const resp = await llamarGemini(apiKey, prompt);

    if (!resp.ok) {
      const errText = await resp.text();
      if (resp.status === 429) {
        return json(429, { error: 'La IA alcanzó su límite de uso gratuito por ahora. Espera uno o dos minutos y vuelve a intentarlo. Si sigue igual, es el límite diario y se reinicia en unas horas.' });
      }
      return json(502, { error: 'La IA respondió con un error: ' + errText.slice(0, 600) });
    }

    const data = await resp.json();
    const candidate = data.candidates && data.candidates[0];
    const raw = candidate && candidate.content && candidate.content.parts
      ? candidate.content.parts.map(p => p.text || '').join('').trim()
      : '';

    if (!raw) {
      return json(502, { error: 'La IA no devolvió contenido. Puede que el archivo sea muy largo o el contenido haya sido bloqueado.' });
    }
// hecho por Sebastian Poveda y Santiago Romero. 2026 
    const finish = candidate && candidate.finishReason;
    let parsed = leerJSON(raw);
    if (!parsed) {
      console.error('JSON ilegible. finishReason =', finish, '| largo =', raw.length, '| final =', raw.slice(-120));
      return json(502, { error: finish === 'MAX_TOKENS'
        ? 'La respuesta de la IA salió demasiado larga y se cortó. Prueba con un archivo más corto o con menos páginas.'
        : 'La IA no devolvió un resultado con el formato esperado. Prueba de nuevo.' });
    }
    if (finish === 'MAX_TOKENS') console.error('Respuesta cortada por MAX_TOKENS; se rescató parte del JSON.');
    if (!Array.isArray(parsed.tarjetas)) parsed.tarjetas = [];
    if (!Array.isArray(parsed.secciones) || !parsed.secciones.length) {
      if (!parsed.tarjetas.length) return json(502, { error: 'La IA devolvió una respuesta incompleta. Prueba de nuevo.' });
    }

    if (!parsed.titulo || !Array.isArray(parsed.tarjetas)) {
      return json(502, { error: 'La respuesta de la IA no tiene el formato esperado.' });
    }
// hecho por Sebastian Poveda y Santiago Romero. 2026 
    return json(200, parsed);
  } catch (err) {
    if (err.message === 'TIMEOUT') {
      console.error('La IA tardó más de', LIMITE_MS, 'ms');
      return json(504, { error: 'La IA tardó demasiado en responder. Prueba con un archivo más corto o inténtalo de nuevo en un momento.' });
    }
    console.error('Error inesperado:', err);
    return json(500, { error: 'Error inesperado: ' + err.message });
  }
};
