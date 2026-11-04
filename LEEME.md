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
El build se hace en tu computador (Netlify ya no lo ejecuta): después de `npm run build`, sube también la carpeta `assets/` y `index.html` (cambia el nombre con hash).

## Publicar en Firebase
1. **Firestore → Rules:** pega `firestore.rules` y Publish. Incluye: cupo diario (`iaUso`), PDF original, PDF escaneado, hora de inicio de exámenes (`inicios`), tiempo límite al entregar y banco de preguntas (`bancoPreguntas`).
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

## Funciones de estudio y de docente (resumen)
**Estudiante**
- 📅 *Repaso de hoy*: repaso espaciado tipo Leitner (cajas 1 a 5; vuelve en 1, 2, 4, 8 y 16 días). Aprende de flashcards, quiz y examen. Aparece también como panel en *Mis materias*.
- 🎯 *Repasar lo que fallé*: quiz con las tarjetas falladas o con los temas donde más falló en los exámenes de su profesor.
- 🧊 *Día de gracia*: 1 por semana (lunes a domingo); cubre un día suelto sin romper la racha.
- Preguntas variadas: opción múltiple (con opciones incorrectas hechas por la IA), verdadero/falso y completar. Las tarjetas **nuevas** traen esos datos; las anteriores siguen como opción múltiple.
- 🔔 Avisos: campana con lo que publica el docente (temas, exámenes, eventos) y recordatorios de hoy/mañana y de exámenes que cierran en 24 h. Notificaciones del navegador opcionales.

**Docente**
- Orden de preguntas y opciones distinto por estudiante (la calificación no cambia).
- Tiempo límite por examen, con hora de inicio registrada por el servidor y entrega automática al acabarse el tiempo.
- Banco de preguntas por corte, tuyo y reutilizable entre semestres.
- Exportar a Excel (.xlsx): notas, resultados por pregunta, respuestas y libro de notas de la materia.

## Límites conocidos
- **Avisos con la app totalmente cerrada** (push real) no están incluidos: necesitan un servidor que envíe notificaciones (Firebase Cloud Messaging con credenciales). El `service-worker.js` ya tiene el receptor `push` listo.
- El reloj del examen se calcula en el navegador a partir de la hora de inicio del servidor; las reglas de Firestore rechazan entregas pasado el tiempo (+60 s de margen).
- Cambiar la versión de la caché de la IA (`IA_CACHE_VER`) hace que los archivos analizados antes se vuelvan a analizar (y gasten cupo) la próxima vez que se suban.

## Nuevo diseño (rediseño visual de Auren)
- **Paleta y fondo:** modo oscuro azul noche con acento durazno; modo claro con acento terracota. Fondo de circuito animado.
- **Efectos visuales** (Perfil → ✨): *Completos*, *Ligeros* (circuito quieto, sin desenfoque) o *Sin efectos*. En automático, los celulares y equipos modestos usan *Ligeros* y quien pide "reducir movimiento" no ve animaciones.
- **Menú de esquina** (☰) con Materias, Calendario, Logros, Perfil, tema y salir. El buscador se enfoca con la tecla `/`.
- **Inicio:** calendario del mes con tus eventos y los de tus docentes, "Mi carrera", promedio por semestre (también en una ventana) y promedio en la cabecera de cada semestre.
- **Color por materia:** se elige al crear o editar la materia.
- **Diálogos propios** en lugar de los del navegador (`alert`, `confirm`, `prompt`): se encolan, se cierran con Esc y se usan con teclado.
- **Navegación con URL:** `#/materia/ID`, `#/estudio/quiz/ID`, `#/calendario`… El botón "atrás" del celular vuelve a la pantalla anterior y se puede recargar o compartir el enlace de una materia.
- **Practicar con un tema** (flashcards, memorizar, repaso…) y **Quiz / Modo examen** por corte o por tema.
- **Examen escrito:** respondes con tus palabras, ves la respuesta y te autoevalúas; alimenta el repaso espaciado y la racha.
- **Perfil → 💾 Tus datos:** descarga una copia de tus datos en un archivo.
