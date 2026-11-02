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
