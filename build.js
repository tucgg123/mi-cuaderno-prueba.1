/* Auren · build: minifica src/app.src.js y src/styles.src.css, les pone un hash en el nombre
   (así el navegador los guarda en caché "para siempre" y se actualizan solos cuando cambian)
   y apunta index.html a los archivos nuevos.

   Uso:  npm install   y luego   npm run build
   Si esbuild no está disponible, no hace nada y se quedan los archivos que ya están en assets/. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
let esbuild;
try { esbuild = require('esbuild'); }
catch (e) { console.warn('[build] esbuild no está instalado: se usan los archivos que ya están en assets/.'); process.exit(0); }

const raiz = __dirname, assets = path.join(raiz, 'assets');
fs.mkdirSync(assets, { recursive: true });
const hash = txt => crypto.createHash('sha256').update(txt).digest('hex').slice(0, 8);

function construir(entrada, loader, prefijo, ext) {
  const fuente = fs.readFileSync(path.join(raiz, entrada), 'utf8');
  const min = esbuild.transformSync(fuente, { loader, minify: true, legalComments: 'inline' }).code;
  const nombre = prefijo + '.' + hash(min) + '.' + ext;
  for (const f of fs.readdirSync(assets)) {
    if (f.startsWith(prefijo + '.') && f.endsWith('.' + ext) && f !== nombre) fs.unlinkSync(path.join(assets, f));
  }
  fs.writeFileSync(path.join(assets, nombre), min);
  console.log('[build]', nombre, (fuente.length / 1024).toFixed(0) + ' KB →', (min.length / 1024).toFixed(0) + ' KB');
  return nombre;
}

const js = construir('src/app.src.js', 'js', 'app', 'js');
const css = construir('src/styles.src.css', 'css', 'styles', 'css');

const ruta = path.join(raiz, 'index.html');
let html = fs.readFileSync(ruta, 'utf8');
html = html.replace(/assets\/app\.[0-9a-f]{8}\.js/, 'assets/' + js).replace(/assets\/styles\.[0-9a-f]{8}\.css/, 'assets/' + css);
fs.writeFileSync(ruta, html);
