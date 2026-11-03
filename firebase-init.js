/* Auren · configuración de Firebase (edita FIREBASE_CONFIG con las llaves de tu proyecto) */

/* ======================================================================
   PEGA AQUÍ LA CONFIGURACIÓN DE TU PROYECTO DE FIREBASE
   (Firebase console > ⚙️ Configuración del proyecto > Tus apps > Config)
   ====================================================================== */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAAPnrXUzON42Hmtb4hOxQqTTQ1HBv0nR0",
  authDomain: "mi-cuaderno-904fa.firebaseapp.com",
  projectId: "mi-cuaderno-904fa",
  storageBucket: "mi-cuaderno-904fa.firebasestorage.app",
  messagingSenderId: "1001521698205",
  appId: "1:1001521698205:web:9e83b5010ea3d0a339cb74"
  
};
/* Archivos originales de más de 8 MB: si activas Firebase Storage (exige el plan Blaze) pon esto en true.
   Ver LEEME.md → "Activar Firebase Storage". Mientras sea false, el límite sigue siendo 8 MB y todo funciona como antes. */
var USAR_STORAGE = false;

firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();
/* Caché offline: los datos ya leídos de la nube siguen disponibles sin internet y los cambios se envían al volver la conexión */
db.enablePersistence({ synchronizeTabs: true }).catch(function (e) {
  console.warn('Sin caché offline de Firestore (' + (e && e.code) + '). La app funciona igual, pero necesita internet para leer la nube.');
});


/* Si los estilos no cargan (la página se vería como texto plano), se detecta, se explica con un aviso y se prueba una copia de respaldo. */
window.addEventListener('load', function () {
  setTimeout(function () {
    if (getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()) return;     // estilos cargados: todo bien
    var enlace = document.querySelector('link[rel="stylesheet"][href*="styles."]');
    var url = enlace ? enlace.href : '(no hay enlace a los estilos en index.html)';
    var respaldo = document.createElement('link');
    respaldo.rel = 'stylesheet';
    respaldo.href = '/src/styles.src.css';
    document.head.appendChild(respaldo);
    function aviso(info) {
      var d = document.createElement('div');
      d.setAttribute('role', 'alert');
      d.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#fff3cd;color:#222;border:1px solid #d6a800;border-radius:10px;padding:10px 12px;font:14px/1.4 system-ui,sans-serif';
      d.textContent = '⚠️ Los estilos de Auren no se cargaron. ' + info + ' Se intentó una copia de respaldo. Si sigue igual, mándale este mensaje a quien administra la página.';
      document.body.appendChild(d);
    }
    fetch(url, { cache: 'no-store' })
      .then(function (r) { return 'Archivo ' + url + ' → ' + r.status + ' · ' + (r.headers.get('content-type') || 'sin tipo') + '.'; })
      .catch(function (e) { return 'Archivo ' + url + ' → sin respuesta (' + e.message + ').'; })
      .then(aviso);
  }, 400);
});
