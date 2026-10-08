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
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.4,
              maxOutputTokens: 8192
            }
          })
        }
      );
      if (resp.ok) return resp;
      ultima = resp;
      if (resp.status === 404) break; // modelo no disponible: pasar al siguiente
      if (![429, 500, 503].includes(resp.status)) return resp; // error que no se arregla reintentando
      if (intento === 0) await new Promise(r => setTimeout(r, 1500));
    }
  }
  return ultima;
}
// Codigo Hecho de parte de Sebastián Poveda y Santiago Romero. 2026
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
// Codigo Hecho de parte de Sebastián Poveda y Santiago Romero. 2026
  // Tope de seguridad: no mandamos textos gigantes a la IA (cuesta más y no hace falta).
  const textoRecortado = texto.slice(0, 25000);

  const prompt = `Eres un asistente que ayuda a estudiantes universitarios a convertir apuntes de clase (sacados de un PDF o una presentación) en material de estudio.

Materia: "${materia || 'sin especificar'}"

PROCESO (hazlo mentalmente, no lo escribas):
1. Analiza primero el texto completo: qué tipo de contenido es (teoría, un modelo o autor, un procedimiento, ejercicios, casos, formulario, legislación, etc.) y qué temas contiene realmente.
2. Según ese análisis, decide TÚ cuáles secciones necesita este material. La estructura debe adaptarse al contenido: no uses una plantilla fija.
3. Escribe cada sección únicamente con información que esté en el texto.

REGLAS DE LAS SECCIONES:
- Entre 3 y 8 secciones, ordenadas de forma lógica para estudiar.
- Incluye una sección solo si el texto tiene material para ella. Por ejemplo, "Autor y año" solo si el texto menciona un autor o una fecha; "Ejemplos" solo si hay ejemplos; "Limitaciones o críticas" solo si se discuten; "Fórmulas" solo si hay fórmulas; "Pasos del procedimiento" solo si hay un procedimiento.
- Los títulos deben ser específicos del contenido (por ejemplo "Componentes de la memoria de trabajo"), no genéricos.
- No inventes datos que no estén en el texto. Si algo no aparece, no crees la sección.
- "puntos" son de 2 a 5 ideas clave de la sección, cada una corta (máximo 12 palabras), tomadas del contenido. Alimentan un esquema visual, así que deben poder leerse solas.
- "contenido" debe ser claro y bien organizado, de 1 a 3 párrafos cortos o una lista con guiones cuando sea más claro. Texto plano, sin markdown con asteriscos.

Devuelve EXCLUSIVAMENTE un JSON válido, sin explicación adicional, con esta forma exacta:

{"titulo":"título corto para el tema (máx 8 palabras)","secciones":[{"titulo":"título de la sección","contenido":"contenido de la sección","puntos":["idea clave corta","otra idea clave corta"]}],"tarjetas":[{"frente":"término o pregunta corta","reverso":"definición o respuesta clara y no muy larga"}]}

Genera entre 8 y 15 tarjetas que cubran los conceptos, definiciones y términos clave del texto. El "frente" debe ser corto (un término o una pregunta). El "reverso" debe responder con precisión sin ser un párrafo entero.

TEXTO A ANALIZAR:
"""
${textoRecortado}
"""`;
// Codigo Hecho de parte de Sebastián Poveda y Santiago Romero. 2026
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
      return { statusCode: 502, body: JSON.stringify({ error: 'La IA no devolvió un resultado con el formato esperado. Prueba de nuevo.' }) };
    }

    if (!parsed.titulo || !Array.isArray(parsed.tarjetas)) {
      return { statusCode: 502, body: JSON.stringify({ error: 'La respuesta de la IA no tiene el formato esperado.' }) };
    }

    return { statusCode: 200, body: JSON.stringify(parsed) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Error inesperado: ' + err.message }) };
  }
};
