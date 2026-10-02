// Esta función corre en el servidor de Netlify, nunca en el navegador del usuario.
// La clave se lee de la variable de entorno APIKEYGEMINIS (Site settings > Environment
// variables en Netlify) y jamás queda expuesta en el código ni en el sitio publicado.

// Si el primero está saturado o no existe, se prueba el siguiente.
const MODELOS = ['gemini-3.8-flash', 'gemini-3.5-flash'];

async function llamarGemini(apiKey, prompt) {
  let ultima;
  for (const modelo of MODELOS) {
    for (let intento = 0; intento < 2; intento++) {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.4 }
          })
        }
      );
      if (resp.ok) return resp;
      ultima = resp;
      if (resp.status === 404) break; // modelo no disponible: pasar al siguiente
      if (![429, 500, 503].includes(resp.status)) return resp; // error que no se arregla reintentando
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  return ultima;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido.' }) };
  }

  const apiKey = process.env.APIKEYGEMINIS;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta configurar APIKEYGEMINIS en Netlify (Site settings > Environment variables).' }) };
  }

  let texto, materia;
  try {
    const body = JSON.parse(event.body || '{}');
    texto = (body.texto || '').toString();
    materia = (body.materia || '').toString();
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Cuerpo de la petición inválido.' }) };
  }

  if (!texto.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No llegó texto para analizar.' }) };
  }

  // Tope de seguridad: no mandamos textos gigantes a la IA (cuesta más y no hace falta).
  const textoRecortado = texto.slice(0, 15000);

  const prompt = `Sos un asistente que ayuda a estudiantes universitarios a convertir apuntes de clase (sacados de un PDF o una presentación) en material de estudio.

Materia: "${materia || 'sin especificar'}"

Te paso abajo el texto extraído del archivo. Devolvé EXCLUSIVAMENTE un JSON válido, sin explicación adicional, con esta forma exacta:

{"titulo":"título corto para el tema (máx 8 palabras)","resumen":"resumen claro y bien organizado en español de los conceptos más importantes del texto, en 2 a 5 párrafos","tarjetas":[{"frente":"término o pregunta corta","reverso":"definición o respuesta clara y no muy larga"}]}

Generá entre 8 y 15 tarjetas que cubran los conceptos, definiciones y términos clave del texto. El "frente" debe ser corto (un término o una pregunta). El "reverso" debe responder con precisión pero sin ser un párrafo entero.

TEXTO A ANALIZAR:
"""
${textoRecortado}
"""`;

  try {
    const resp = await llamarGemini(apiKey, prompt);

    if (!resp.ok) {
      const errText = await resp.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'La IA respondió con un error: ' + errText.slice(0, 300) }) };
    }

    const data = await resp.json();
    const candidate = data.candidates && data.candidates[0];
    const raw = candidate && candidate.content && candidate.content.parts
      ? candidate.content.parts.map(p => p.text || '').join('').trim()
      : '';

    if (!raw) {
      return { statusCode: 502, body: JSON.stringify({ error: 'La IA no devolvió contenido. Puede que el archivo sea muy largo o el contenido haya sido bloqueado.' }) };
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'La IA no devolvió un resultado con el formato esperado. Probá de nuevo.' }) };
    }

    if (!parsed.titulo || !Array.isArray(parsed.tarjetas)) {
      return { statusCode: 502, body: JSON.stringify({ error: 'La respuesta de la IA no tiene el formato esperado.' }) };
    }

    return { statusCode: 200, body: JSON.stringify(parsed) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Error inesperado: ' + err.message }) };
  }
};
