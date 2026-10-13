// Hecho por Sebastián Poveda y Santiago Romero. 2026
// Función de Netlify · Mi cuaderno de estudio
// Esta función corre en el servidor de Netlify, nunca en el navegador del usuario.
// La clave se lee de la variable de entorno APIKEYGEMINIS (Site settings > Environment
// variables en Netlify) y jamás queda expuesta en el código ni en el sitio publicado.

// Si el primero está saturado o no existe, se prueba el siguiente.
// Hecho por Sebastián Poveda y Santiago Romero. 2026 · modelos de IA
// El límite diario de peticiones (RPD) se cuenta por modelo y por proyecto. Cuando uno se agota (429),
// se pasa al siguiente, que tiene su propio cupo. Los últimos son versiones "lite", con cupos más altos.
// Si algún nombre no existe en tu cuenta, devuelve 404 y simplemente se salta al siguiente.
const MODELOS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

// Esquema que Gemini está obligado a respetar: la respuesta siempre llega con la forma correcta,
// así no se gastan peticiones repitiendo por un JSON mal formado.
const ESQUEMA_RESPUESTA = {
  type: 'OBJECT',
  properties: {
    titulo: { type: 'STRING' },
    secciones: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          titulo: { type: 'STRING' },
          contenido: { type: 'STRING' },
          ideas: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                tipo: { type: 'STRING', enum: ['definicion', 'caracteristica', 'ejemplo'] },
                termino: { type: 'STRING' },
                texto: { type: 'STRING' }
              },
              required: ['tipo', 'termino', 'texto'],
              propertyOrdering: ['tipo', 'termino', 'texto']
            }
          }
        },
        required: ['titulo', 'contenido', 'ideas'],
        propertyOrdering: ['titulo', 'contenido', 'ideas']
      }
    },
    tarjetas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { frente: { type: 'STRING' }, reverso: { type: 'STRING' } },
        required: ['frente', 'reverso'],
        propertyOrdering: ['frente', 'reverso']
      }
    }
  },
  required: ['titulo', 'secciones', 'tarjetas'],
  propertyOrdering: ['titulo', 'secciones', 'tarjetas']
};

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(obj)
});

// Tiempo máximo total esperando a la IA. Netlify corta las funciones síncronas a los 60 s
// (límite fijo), así que dejamos 10 s de margen para poder responder con un error claro
// en vez de que Netlify devuelva un 502 sin explicación.
const LIMITE_MS = 50000;

// Hecho por Sebastián Poveda y Santiago Romero. 2026 · llamada a Gemini con tiempo límite y reintentos
async function llamarGemini(apiKey, prompt) {
  const inicio = Date.now();
  let ultima;
  for (const modelo of MODELOS) {
    let usaPensamientoCorto = true; // thinkingLevel "low": razona menos y responde antes
    let usaEsquema = true;          // responseSchema: fuerza la forma exacta del JSON
    for (let intento = 0; intento < 4; intento++) {
      const restante = LIMITE_MS - (Date.now() - inicio);
      if (restante < 3000) throw new Error('TIMEOUT');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), restante);
      const generationConfig = {
        responseMimeType: 'application/json',
        temperature: 0.4,
        maxOutputTokens: 8192
      };
      if (usaEsquema) generationConfig.responseSchema = ESQUEMA_RESPUESTA;
      if (usaPensamientoCorto) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
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
              generationConfig
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
      // 400: puede que ese modelo no acepte el razonamiento corto o el esquema. Se quitan de a uno y se reintenta.
      if (resp.status === 400) {
        if (usaPensamientoCorto) { usaPensamientoCorto = false; continue; }
        if (usaEsquema) { usaEsquema = false; continue; }
        return resp;
      }
      // 404 = modelo no disponible, 429 = cuota agotada: reintentar solo gastaría más cuota,
      // así que se pasa directo al siguiente modelo (cada modelo tiene su propio límite).
      if (resp.status === 404 || resp.status === 429) break;
      if (![500, 503].includes(resp.status)) return resp; // error que no se arregla reintentando
      if (intento < 3) await new Promise(r => setTimeout(r, 800));
    }
  }
  return ultima;
}

// Intenta leer el JSON de la IA. Si vino con ```json o cortado a la mitad, lo rescata:
// recorta hasta el último elemento completo y cierra los corchetes que falten.
// Hecho por Sebastián Poveda y Santiago Romero. 2026 · lector de JSON tolerante
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

// Hecho por Sebastián Poveda y Santiago Romero. 2026 · punto de entrada de la función
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Método no permitido.' });
  }

  const apiKey = process.env.APIKEYGEMINIS;
  if (!apiKey) {
    return json(500, { error: 'Falta configurar APIKEYGEMINIS en Netlify (Site settings > Environment variables).' });
  }

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

  // Hecho por Sebastián Poveda y Santiago Romero. 2026 · instrucciones para la IA
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
- "ideas" son de 2 a 5 por sección, tomadas del texto. Cada idea tiene: "tipo", "termino" y "texto". El "tipo" debe ser EXACTAMENTE "definicion" (qué es el concepto), "caracteristica" (rasgos, propiedades, pasos, datos, causas) o "ejemplo" (un caso que aparezca en el texto; no inventes ejemplos). El "termino" es el concepto, autor, etapa, teoría o nombre propio central de esa idea (1 a 4 palabras). El "texto" explica ese término en máximo 16 palabras y no repite el término al inicio. Procura que cada sección tenga al menos una definición si el texto la da.
- USA EL VOCABULARIO DEL TEXTO: los términos técnicos, nombres de autores, teorías, siglas y títulos deben escribirse tal como aparecen en el texto original, sin reemplazarlos por sinónimos ni términos genéricos. Los títulos de las secciones también deben usar esos términos (por ejemplo "Teoría del apego de Bowlby", no "Otra teoría").
- "contenido" debe ser claro y bien organizado, 1 o 2 párrafos cortos, o una lista de 3 a 6 guiones cuando sea más claro. Sé conciso. Texto plano, sin markdown con asteriscos.

Devuelve EXCLUSIVAMENTE un JSON válido, sin explicación adicional, con esta forma exacta:

{"titulo":"título corto para el tema (máx 8 palabras)","secciones":[{"titulo":"título de la sección","contenido":"contenido de la sección","ideas":[{"tipo":"definicion","termino":"término clave","texto":"explicación corta"},{"tipo":"caracteristica","termino":"otro término","texto":"explicación corta"},{"tipo":"ejemplo","termino":"nombre del caso","texto":"el ejemplo en pocas palabras"}]}],"tarjetas":[{"frente":"término o pregunta corta","reverso":"definición o respuesta clara y no muy larga"}]}

Genera entre 8 y 12 tarjetas que cubran los conceptos, definiciones y términos clave del texto. El "frente" debe ser corto (un término o una pregunta). El "reverso" debe responder con precisión sin ser un párrafo entero.

TEXTO A ANALIZAR:
"""
${textoRecortado}
"""`;

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

    const finish = candidate && candidate.finishReason;
    let parsed = leerJSON(raw);
    if (!parsed) {
      console.error('JSON ilegible. finishReason =', finish, '| largo =', raw.length, '| final =', raw.slice(-120));
      return json(502, { error: finish === 'MAX_TOKENS'
        ? 'La respuesta de la IA salió demasiado larga y se cortó. Prueba con un archivo más corto o con menos páginas.'
        : 'La IA no devolvió un resultado con el formato esperado. Prueba de nuevo.' });
    }
    if (finish === 'MAX_TOKENS') console.error('Respuesta cortada por MAX_TOKENS; se rescató parte del JSON.');
    // Hecho por Sebastián Poveda y Santiago Romero. 2026 · normalización de ideas y tipos
    // Cada sección: "ideas" [{tipo, texto}] pasan a "puntos" (textos) y "tipos" (paralelo).
    const TIPOS = ['definicion', 'caracteristica', 'ejemplo'];
    if (Array.isArray(parsed.secciones)) {
      parsed.secciones.forEach(sec => {
        if (!sec || typeof sec !== 'object') return;
        const fuente = Array.isArray(sec.ideas) ? sec.ideas : (Array.isArray(sec.puntos) ? sec.puntos : []);
        const unir = (termino, texto) => {
          // El esquema muestra "Término: explicación" con el término resaltado.
          const t = String(termino || '').trim().replace(/[:.\s]+$/, '');
          const x = String(texto || '').trim();
          if (!t) return x;
          if (!x) return t;
          if (x.toLowerCase().startsWith(t.toLowerCase())) {
            // La IA repitió el término al inicio: se deja una sola vez, con el formato "Término: explicación".
            const resto = x.slice(t.length).replace(/^[:\-–—\s]+/, '');
            return resto ? t + ': ' + resto : t;
          }
          return t + ': ' + x;
        };
        const pares = fuente.map(x => (typeof x === 'string')
          ? { texto: x, tipo: null }
          : { texto: unir(x && x.termino, x && x.texto), tipo: x && TIPOS.includes(x.tipo) ? x.tipo : null }
        ).map(o => ({ texto: o.texto.trim(), tipo: o.tipo })).filter(o => o.texto).slice(0, 6);
        sec.puntos = pares.map(o => o.texto);
        sec.tipos = pares.map(o => o.tipo);
        delete sec.ideas;
      });
    }
    if (!Array.isArray(parsed.tarjetas)) parsed.tarjetas = [];
    if (!Array.isArray(parsed.secciones) || !parsed.secciones.length) {
      if (!parsed.tarjetas.length) return json(502, { error: 'La IA devolvió una respuesta incompleta. Prueba de nuevo.' });
    }

    if (!parsed.titulo || !Array.isArray(parsed.tarjetas)) {
      return json(502, { error: 'La respuesta de la IA no tiene el formato esperado.' });
    }

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

// Hecho por Sebastián Poveda y Santiago Romero. 2026
