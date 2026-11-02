# Auren

Organiza tus materias, estudia con ayuda de IA y mantén tu racha.

## Estructura
- `index.html` — la página (solo estructura).
- `firebase-init.js` — llaves de Firebase y la bandera `USAR_STORAGE`.
- `src/app.src.js` y `src/styles.src.css` — **el código fuente que se edita**.
- `assets/` — los mismos archivos ya minificados y con un hash en el nombre (los genera `build.js`; no se editan a mano).
- `netlify/functions/` — la IA (`generar-tema` y `generar-tema-background`).
- `firestore.rules` y `storage.rules` — reglas de seguridad (se publican en la consola de Firebase).

## Después de cambiar el código
Edita `src/app.src.js` o `src/styles.src.css` y ejecuta `npm install` (una vez) y `npm run build`.
En Netlify con Git el build corre solo (`netlify.toml`). Si subes la carpeta a mano, ejecuta el build antes de subirla.

## Publicar en Firebase
1. **Firestore → Rules:** pega `firestore.rules` y Publish (incluye `iaUso`, el PDF original y el PDF escaneado).
2. Solo si activas Storage: **Storage → Rules:** pega `storage.rules` y Publish.

## Valores que puedes ajustar
| Qué | Dónde |
|---|---|
| Archivos por persona y día (20) | `LIMITE_IA_DIARIO` en Netlify **y** `IA_LIMITE_DIARIO` en `src/app.src.js` (iguales) |
| Tamaño máximo del original en Firestore (8 MB) | `ARCH_MAX` en `src/app.src.js` |
| PDF escaneado máximo (8 MB) | `IA_PDF_MAX` en `src/app.src.js` |

## Activar Firebase Storage (originales de 8 a 50 MB)
1. Pasa el proyecto de Firebase al plan **Blaze** (Storage lo exige; tiene cuota gratis, pero necesita tarjeta).
2. Firebase → Storage → *Comenzar*.
3. Publica `storage.rules` (Firebase pedirá dar permiso para leer Firestore desde las reglas: acéptalo).
4. En `firebase-init.js` pon `var USAR_STORAGE = true;` y despliega.
Mientras sea `false` todo funciona como antes (máximo 8 MB, guardado en Firestore).

## Política de contenido (CSP)
Está en modo solo reporte (`Content-Security-Policy-Report-Only` en `netlify.toml`). Prueba el login con Google, subir un PDF y descargar un original con la consola (F12) abierta; si no hay avisos, quita `-Report-Only` del nombre de la cabecera.

## Nota técnica
La clave local del navegador sigue siendo `cuaderno_<uid>` y el proyecto de Firebase `mi-cuaderno-904fa`: no se cambiaron para no perder datos ni sesiones. Los íconos de `icons/` no se modificaron.
