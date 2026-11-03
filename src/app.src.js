/*! Hecho por Sebastián Poveda y Santiago Romero. 2026 — Auren · lógica principal */
(()=>{
/* ================= UTILIDADES ================= */
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const fmtDateLong=s=>new Date(s+'T00:00').toLocaleDateString('es',{weekday:'long',day:'numeric',month:'long'});
const relDate=s=>{const n=Math.round((new Date(s+'T00:00')-new Date(ymd(new Date())+'T00:00'))/864e5);return n==0?'hoy':n==1?'mañana':n>1?`en ${n} días`:`hace ${-n} días`};
const TY={ex:'📝 Examen',en:'📤 Entrega',ac:'🎯 Actividad',ot:'📌 Otro'};
const AV=['🎓','📚','🦉','🐱','🦊','🐼','🌸','⭐','🔥','🌙'];

/* ================= ESTADO ================= */
function defaultState(){return{
  profile:{name:'',career:'',avatar:'🎓',examDate:'',scale:5,goal:4,notes:'',rol:''},
  theme:null,
  semesters:[{id:uid(),name:'Semestre 1'}],
  materias:[],
  temas:[],
  cortes:[],
  cards:[],
  attempts:[],
  events:[],
  progress:{days:[],badges:{},sellos:{},exams:0,sembrado:true}
}}
/* Hecho por Sebastián Poveda y Santiago Romero. 2026 · estado y cortes */
const CORTES_DEFECTO=[['Corte 1',30],['Corte 2',30],['Corte 3',40]];
/* Garantiza: escala de notas, al menos un corte por materia y que cada tema esté dentro de un corte. */
function ensureCortes(){
  let changed=false;
  const pf=state.profile=state.profile||{};
  if(pf.scale==null){const g=+pf.goal;pf.scale=g>10?100:(g>5?10:5);changed=true}
  if(!(+pf.goal>=0)){pf.goal=pf.scale===100?80:(pf.scale===10?8:4);changed=true}
  state.cortes=state.cortes||[];state.temas=state.temas||[];
  (state.materias||[]).forEach(m=>{
    let cs=state.cortes.filter(c=>c.materiaId===m.id);
    if(!cs.length){
      CORTES_DEFECTO.forEach(([name,weight])=>state.cortes.push({id:uid(),materiaId:m.id,name,weight,score:null}));
      cs=state.cortes.filter(c=>c.materiaId===m.id);changed=true;
    }
    const ids=new Set(cs.map(c=>c.id));
    state.temas.forEach(t=>{if(t.materiaId===m.id&&!ids.has(t.corteId)){t.corteId=cs[0].id;changed=true}});
  });
  return changed;
}
function normalizeState(){
  if(ensureCortes())scheduleCloud();
  state.cards=state.cards||[];
  state.attempts=state.attempts||[];
  state.events=state.events||[];
  (state.materias||[]).forEach(m=>{if(m.refs==null)m.refs=''});
  state.cards.forEach(c=>{if(c.known===undefined)c.known=null});
  sembrarProgreso();
}
let state=defaultState();
let currentUid=null;
let route={view:'materias',materiaId:null};
let calView={y:new Date().getFullYear(),m:new Date().getMonth(),sel:null};
let toolState=null;
let repasoTimer=null;
function clearRepasoTimer(){if(repasoTimer){clearInterval(repasoTimer);repasoTimer=null}}

function localKey(){return 'cuaderno_'+(currentUid||'anon')}
function saveLocal(){try{localStorage.setItem(localKey(),JSON.stringify(state))}catch(e){}}
function loadLocal(){try{const raw=localStorage.getItem(localKey());return raw?JSON.parse(raw):null}catch(e){return null}}

/* ---------- Estado de la sincronización: avisa si algo falla (antes solo quedaba en la consola) ---------- */
const FIRESTORE_MAX=1048576;           // límite de Firestore por documento (1 MiB)
const sync={fallo:'',falloMateria:'',aviso:'',tamAlto:false,offline:typeof navigator!=='undefined'&&navigator.onLine===false,soloLocal:false};
function textoFalloSync(e){
  const c=(e&&e.code)||'',msg=String((e&&e.message)||'');
  if(c==='permission-denied')return 'no tienes permiso para guardar (revisa que las reglas de Firestore estén publicadas o vuelve a iniciar sesión).';
  if(c==='unauthenticated')return 'tu sesión venció. Cierra sesión y vuelve a entrar.';
  if(/exceeds the maximum|too large|payload/i.test(msg)||c==='invalid-argument')return 'tu cuaderno es demasiado grande para la nube. Usa "Liberar espacio" o elimina materias que ya no uses.';
  if(c==='resource-exhausted')return 'se alcanzó la cuota diaria de Firebase. Se reintentará más tarde.';
  if(c==='unavailable'||c==='deadline-exceeded')return 'no hay conexión con la nube.';
  return 'error inesperado'+(msg?' ('+msg.slice(0,120)+')':'')+'.';
}
function pintarBanner(){
  let b=document.getElementById('syncBanner');
  const grave=sync.fallo||sync.falloMateria;
  const msg=grave||sync.aviso||(sync.offline?'📴 Sin conexión: tus cambios se guardan en este dispositivo y se subirán a la nube cuando vuelva internet.':'');
  if(!msg||!currentUid){if(b)b.remove();return}
  if(!b){b=document.createElement('div');b.id='syncBanner';b.setAttribute('role','alert');document.body.appendChild(b)}
  b.className='syncBanner'+(grave?' grave':'');
  b.innerHTML=`<span>${msg}</span>${grave?'<button type="button" data-action="syncReintentar">Reintentar</button>':''}${(!grave&&sync.tamAlto)?'<button type="button" data-action="liberarEspacio">Liberar espacio</button>':''}`;
}
function syncFallo(e){sync.fallo='⚠️ No se pudo guardar en la nube: '+esc(textoFalloSync(e))+' Tus cambios siguen guardados en este dispositivo.';pintarBanner()}
function syncOk(){sync.fallo='';pintarBanner()}
function revisarTamano(bytes){
  const pct=Math.round(bytes/FIRESTORE_MAX*100);
  sync.tamAlto=pct>=80;
  sync.aviso=sync.tamAlto?'💾 Tu cuaderno ocupa el '+pct+' % del espacio que permite la nube. Si se llena dejará de sincronizarse: libera espacio.':'';
}
function liberarEspacio(){
  const lim=Date.now()-120*864e5,viejos=(state.attempts||[]).filter(a=>a.date<lim).length;
  if(!viejos){alert('No hay intentos antiguos que borrar. Para liberar más espacio elimina materias o temas que ya no uses.');return}
  if(confirm('Se borrarán '+viejos+' intentos de quiz y examen de hace más de 4 meses. Tu racha, tus insignias y las etapas ya completadas se conservan; las etapas sin completar podrían perder avance de exámenes antiguos. ¿Continuar?'))mutate(s=>{s.attempts=s.attempts.filter(a=>a.date>=lim)});
}
async function reintentarSync(){
  if(!currentUid)return;
  if(sync.soloLocal){
    try{
      const doc=await db.collection('users').doc(currentUid).get();
      if(doc.exists&&doc.data().data){
        if(confirm('Se encontró tu cuaderno guardado en la nube.\n\nAceptar = cargar la versión de la nube (se descartan los cambios hechos sin conexión en este dispositivo).\nCancelar = conservar lo de este dispositivo y reemplazar la nube.')){
          state=JSON.parse(doc.data().data);normalizeState();saveLocal();applyTheme();updateThemeBtn();render();startShared();
        }
      }
      sync.soloLocal=false;sync.fallo='';
    }catch(e){syncFallo(e);return}
  }
  await pushCloudNow();
}
window.addEventListener('online',()=>{sync.offline=false;pintarBanner();pushCloudNow()});
window.addEventListener('offline',()=>{sync.offline=true;pintarBanner()});

let cloudTimer=null;
function scheduleCloud(){
  if(!currentUid)return;
  clearTimeout(cloudTimer);
  cloudTimer=setTimeout(pushCloudNow,1000);
}
async function pushCloudNow(){
  if(!currentUid)return;
  pushShared();
  if(sync.soloLocal){sync.fallo='⚠️ No se pudo leer tu cuaderno de la nube al iniciar. Por seguridad no se sube nada para no pisarlo con datos viejos. Tus cambios siguen en este dispositivo.';pintarBanner();return}
  try{
    const data=JSON.stringify(state);
    revisarTamano(new Blob([data]).size);
    await db.collection('users').doc(currentUid).set({
      data,
      updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    syncOk();
  }catch(e){console.error('No se pudo sincronizar con la nube:',e);syncFallo(e)}
}
async function hydrateFromCloud(u){
  currentUid=u;
  try{
    const doc=await db.collection('users').doc(u).get();
    if(doc.exists && doc.data().data){
      state=JSON.parse(doc.data().data);
    }else{
      state=loadLocal()||defaultState();
      await pushCloudNow();
    }
  }catch(e){
    console.error('No se pudo leer la nube, uso datos locales:',e);
    state=loadLocal()||defaultState();
    sync.soloLocal=true;sync.fallo='⚠️ No se pudo leer tu cuaderno de la nube ('+esc(textoFalloSync(e))+') Trabajas con los datos de este dispositivo y no se subirá nada hasta que reintentes.';
    pintarBanner();
  }
  normalizeState();
  saveLocal();
}

/* mutate(): cambio estructural -> guarda + sincroniza + vuelve a pintar */
function mutate(fn){fn(state);ensureCortes();saveLocal();scheduleCloud();render()}
/* persist(): cambio de texto (inputs) -> guarda + sincroniza SIN repintar, para no perder el foco */
function persist(){saveLocal();scheduleCloud()}

/* ================= AUTENTICACIÓN ================= */
let authMode='login';
document.querySelectorAll('[data-authtab]').forEach(b=>b.onclick=()=>{
  authMode=b.dataset.authtab;
  document.querySelectorAll('[data-authtab]').forEach(x=>x.classList.toggle('on',x===b));
  $('authSubmit').textContent=authMode==='login'?'Iniciar sesión':'Crear cuenta';
  $('authError').hidden=true;
});
function mapAuthError(err){
  const c=err&&err.code||'';
  const M={
    'auth/invalid-email':'Ese correo no es válido.',
    'auth/user-not-found':'No existe una cuenta con ese correo.',
    'auth/wrong-password':'Contraseña incorrecta.',
    'auth/invalid-credential':'Correo o contraseña incorrectos.',
    'auth/email-already-in-use':'Ya existe una cuenta con ese correo. Prueba iniciar sesión.',
    'auth/weak-password':'La contraseña debe tener al menos 6 caracteres.',
    'auth/too-many-requests':'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
    'auth/network-request-failed':'Sin conexión a internet.',
    'auth/unauthorized-domain':'Este dominio no está autorizado en Firebase (Authentication > Settings > Authorized domains).',
    'auth/operation-not-allowed':'El acceso con Google no está activado en Firebase (Authentication > Sign-in method).',
    'auth/account-exists-with-different-credential':'Ya existe una cuenta con ese correo usando otro método de acceso.',
    'auth/popup-blocked':'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes e inténtalo de nuevo.'
  };
  return M[c]||'Ocurrió un error. Inténtalo de nuevo.';
}
$('authForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const email=$('authEmail').value.trim(),pass=$('authPass').value;
  $('authError').hidden=true;$('authSubmit').disabled=true;
  try{
    if(authMode==='login') await auth.signInWithEmailAndPassword(email,pass);
    else await auth.createUserWithEmailAndPassword(email,pass);
  }catch(err){
    $('authError').textContent=mapAuthError(err);$('authError').hidden=false;
  }finally{
    $('authSubmit').disabled=false;
  }
});
$('logoutBtn').onclick=async()=>{
  if(!confirm('¿Cerrar sesión?'))return;
  await auth.signOut();
  /* La caché offline de Firestore guarda tus datos en este equipo: al salir se borra para que no queden en computadores compartidos */
  try{await db.terminate();await db.clearPersistence()}catch(e){console.warn('No se pudo limpiar la caché local:',e)}
  location.reload();
};

/* Acceso con Google (ventana emergente; si el navegador la bloquea, se usa redirección) */
$('googleBtn').addEventListener('click',async()=>{
  const provider=new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({prompt:'select_account'});
  $('authError').hidden=true;$('googleBtn').disabled=true;
  try{
    await auth.signInWithPopup(provider);
  }catch(err){
    const c=err&&err.code||'';
    if(c==='auth/popup-blocked'){try{await auth.signInWithRedirect(provider);return}catch(e2){err=e2}}
    if(c!=='auth/popup-closed-by-user'&&c!=='auth/cancelled-popup-request'){
      console.error('Google:',err);
      $('authError').textContent=mapAuthError(err);$('authError').hidden=false;
    }
  }finally{
    $('googleBtn').disabled=false;
  }
});

auth.onAuthStateChanged(async user=>{
  if(user){
    $('authLoading').hidden=false;
    await hydrateFromCloud(user.uid);
    if(!state.profile.name&&user.displayName){state.profile.name=user.displayName;persist()}
    if(!state.profile.rol&&state.materias.some(m=>m.rol==='docente')){state.profile.rol='docente';persist()}   // cuentas que ya usaban el espacio docente
    $('authLoading').hidden=true;
    $('authScreen').hidden=true;
    $('appRoot').hidden=false;
    applyTheme();updateThemeBtn();
    route={view:esProfesor()?'docente':'materias',materiaId:null};
    document.querySelectorAll('#mainNav button').forEach(x=>x.classList.toggle('on',x.dataset.nav===route.view));
    render();
    startShared();
    iniciarAvisos();
    escucharMisInvitaciones();
    try{avisarLogros(evaluarLogros())}catch(e){console.error('Logros:',e)}
    (state.profile.rol?Promise.resolve():pedirRol()).then(procesarUnirsePendiente);
  }else{
    const ovRol=document.getElementById('rolOverlay');if(ovRol)ovRol.remove();
    stopShared();
    currentUid=null;
    sync.fallo='';sync.falloMateria='';sync.aviso='';sync.tamAlto=false;sync.soloLocal=false;pintarBanner();
    avisos=null;{const ap=$('avisosPanel');if(ap)ap.hidden=true}
    state=defaultState();
    $('appRoot').hidden=true;
    $('authScreen').hidden=false;
  }
});

/* ======================= AVISOS: novedades del docente y recordatorios =======================
   - Cuando el docente publica un tema, un examen o un evento, el estudiante recibe un aviso (campana 🔔).
     La primera vez que se sincroniza una materia solo se toma nota de lo que ya existía, para no llenarte de avisos viejos.
   - Los recordatorios avisan de lo que pasa hoy o mañana en el calendario y de los exámenes que cierran en las próximas 24 h.
   - Si das permiso al navegador, además se muestran como notificaciones del sistema cuando Auren no está a la vista.
   Límite: los avisos se generan mientras Auren está abierta (o instalada y viva en segundo plano). Avisar con la app
   totalmente cerrada exige un servidor de notificaciones push, que esta versión no incluye. */
const AV_MAX=40;
let avisos=null,avTimer=null;
const avKey=()=>'auren_avisos_'+currentUid;
const avisosActivos=()=>!state.profile||state.profile.avisos!==false;
function avCargar(){
  if(avisos&&avisos._uid===currentUid)return avisos;
  let x=null;try{x=JSON.parse(localStorage.getItem(avKey())||'null')}catch(e){}
  avisos=Object.assign({lista:[],vistos:{},base:{}},x||{},{_uid:currentUid});
  return avisos;
}
function avGuardar(){
  const a=avCargar();
  a.lista=a.lista.slice(0,AV_MAX);
  const ks=Object.keys(a.vistos);if(ks.length>800)ks.slice(0,ks.length-800).forEach(k=>delete a.vistos[k]);
  try{localStorage.setItem(avKey(),JSON.stringify({lista:a.lista,vistos:a.vistos,base:a.base}))}catch(e){}
  pintarCampana();
}
function notificarSistema(titulo,texto,tag){
  try{
    if(!document.hidden){toast(esc(texto));return}                                  // si Auren está a la vista basta el aviso interno
    if(typeof Notification==='undefined'||Notification.permission!=='granted')return;
    const opts={body:texto,icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',tag:tag||undefined,data:{url:'/'}};
    if(navigator.serviceWorker&&navigator.serviceWorker.ready)navigator.serviceWorker.ready.then(r=>r.showNotification(titulo,opts)).catch(()=>{try{new Notification(titulo,opts)}catch(e){}});
    else new Notification(titulo,opts);
  }catch(e){}
}
function avAgregar(av){
  const a=avCargar();
  a.lista.unshift(Object.assign({id:uid(),leido:false,fecha:Date.now()},av));
  avGuardar();
  notificarSistema('Auren',av.texto,av.clave);
}
function anunciarNuevos(m,tipo,items){
  if(!currentUid||!m||m.rol!=='estudiante'||!m.sharedId)return;
  const a=avCargar(),bk=m.sharedId+'|'+tipo,pre=tipo+'|'+m.sharedId+'|';
  if(!a.base[bk]){items.forEach(x=>{a.vistos[pre+x.id]=1});a.base[bk]=1;avGuardar();return}     // primera lectura: sin avisos
  const nuevos=items.filter(x=>!a.vistos[pre+x.id]);
  if(!nuevos.length)return;
  const ico={tema:'📖',examen:'📝',evento:'🗓️'}[tipo]||'🔔',que={tema:'tema',examen:'examen',evento:'evento'}[tipo]||'aviso';
  nuevos.forEach(x=>{
    a.vistos[pre+x.id]=1;
    if(avisosActivos())avAgregar({tipo,materiaId:m.id,texto:ico+' Nuevo '+que+' en '+m.name+': '+x.titulo,clave:pre+x.id});
  });
  avGuardar();
}
/* Lo que pasa hoy o mañana, y los exámenes que cierran en las próximas 24 horas */
function avisablesProximos(){
  const hoy=hoyStr(),man=sumarDias(hoy,1),out=[];
  eventosTodos().forEach(e=>{
    if(e.date!==hoy&&e.date!==man)return;
    out.push({clave:'ev|'+e.id+'|'+e.date,materiaId:e.materiaId||null,
      texto:'🔔 '+(e.date===hoy?'Hoy':'Mañana')+': '+(TY[e.type]||tipoEv(e.type)||'📌')+' '+e.title+(e.hora?' a las '+e.hora:'')+(e.materia?' · '+e.materia:'')});
  });
  state.materias.filter(m=>m.rol==='estudiante'&&m.sharedId).forEach(m=>{
    examenesDe(m).forEach(ex=>{
      if(!ex.cierre||!examAbierto(ex)||miIntento(m,ex.id))return;
      const falta=ex.cierre-Date.now();
      if(falta>0&&falta<=24*3600*1000)out.push({clave:'exc|'+ex.id,materiaId:m.id,texto:'⏰ El examen «'+(ex.titulo||'Examen')+'» de '+m.name+' cierra '+fmtFechaHora(ex.cierre)});
    });
  });
  return out;
}
function revisarRecordatorios(){
  if(!currentUid||esProfesor()||!avisosActivos())return;
  const a=avCargar();let n=0;
  avisablesProximos().forEach(x=>{
    if(a.vistos[x.clave])return;
    a.vistos[x.clave]=1;n++;
    avAgregar({tipo:'recordatorio',materiaId:x.materiaId,texto:x.texto,clave:x.clave});
  });
  if(n)avGuardar();
}
function iniciarAvisos(){
  pintarCampana();
  if(avTimer)return;
  setTimeout(revisarRecordatorios,2500);
  avTimer=setInterval(revisarRecordatorios,15*60*1000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)revisarRecordatorios()});
}
function pintarCampana(){
  const n=$('bellN'),b=$('bellBtn');if(!b)return;
  b.style.display=(esProfesor()||!currentUid)?'none':'';
  const k=currentUid?avCargar().lista.filter(x=>!x.leido).length:0;
  if(n){n.hidden=!k;n.textContent=k>9?'9+':String(k)}
  b.setAttribute('aria-label',k?'Avisos: '+k+' sin leer':'Avisos');
}
function avisosPanelHTML(sinLeer){
  const a=avCargar();
  if(!a.lista.length)return `<div class="avHead"><b>🔔 Avisos</b><button class="icon-btn" data-action="avCerrar" aria-label="Cerrar">✕</button></div><p class="meta" style="padding:12px 14px">Aquí verás cuando tu docente publique algo y los recordatorios de lo que viene en el calendario.</p>`;
  return `<div class="avHead"><b>🔔 Avisos</b><span class="row" style="margin:0"><button class="sec" data-action="avVaciar">Vaciar</button><button class="icon-btn" data-action="avCerrar" aria-label="Cerrar">✕</button></span></div>
    <div class="avLista">${a.lista.map(x=>`<button class="avItem ${sinLeer.has(x.id)?'nuevo':''}" data-action="avAbrir" data-av="${x.id}"><span>${esc(x.texto)}</span><small class="meta">${relTime(x.fecha)}${sinLeer.has(x.id)?' · nuevo':''}</small></button>`).join('')}</div>`;
}
function abrirAvisos(){
  const p=$('avisosPanel');if(!p)return;
  if(!p.hidden){p.hidden=true;return}
  const a=avCargar(),sinLeer=new Set(a.lista.filter(x=>!x.leido).map(x=>x.id));
  p.innerHTML=avisosPanelHTML(sinLeer);p.hidden=false;
  a.lista.forEach(x=>{x.leido=true});avGuardar();
}
function notificarSistemaPrueba(){
  try{
    const opts={body:'Listo: te avisaremos de lo que publique tu docente y de lo que viene en tu calendario.',icon:'/icons/icon-192.png',tag:'auren-prueba'};
    if(navigator.serviceWorker&&navigator.serviceWorker.ready)navigator.serviceWorker.ready.then(r=>r.showNotification('Auren',opts));else new Notification('Auren',opts);
  }catch(e){}
}
function avisosCardHTML(){
  const act=avisosActivos(),soporta=typeof Notification!=='undefined',perm=soporta?Notification.permission:'no';
  return `<div class="card"><h3>🔔 Avisos y recordatorios</h3>
    <p class="meta" style="margin-top:0">Te avisamos cuando tu docente publica un tema, un examen o un evento, y te recordamos lo que pasa hoy o mañana en tu calendario.</p>
    <div class="row" style="flex-wrap:wrap"><button class="${act?'pr':'sec'}" data-action="avToggle">${act?'✅ Avisos activados':'Avisos desactivados'}</button>
    ${soporta?(perm==='granted'?'<span class="chip chipOk">Notificaciones del navegador activadas</span>':perm==='denied'?'<span class="chip">Notificaciones bloqueadas en el navegador</span>':'<button class="sec" data-action="avPermiso">Activar notificaciones del navegador</button>'):'<span class="chip">Este navegador no admite notificaciones</span>'}</div>
    <p class="meta" style="margin:8px 0 0">Los avisos aparecen mientras Auren está abierta o instalada en tu dispositivo. Con la aplicación totalmente cerrada no se pueden enviar sin un servidor de notificaciones push.${perm==='denied'?' Para recibirlas, permítelas desde el candado de la barra de direcciones.':''}</p></div>`;
}
$('bellBtn').onclick=e=>{e.stopPropagation();abrirAvisos()};
document.addEventListener('click',e=>{
  const p=$('avisosPanel');
  if(p&&!p.hidden&&!e.target.closest('#avisosPanel')&&!e.target.closest('#bellBtn'))p.hidden=true;
});

/* ================= TEMA CLARO/OSCURO ================= */
function applyTheme(){
  if(state.theme)document.documentElement.setAttribute('data-theme',state.theme);
  else document.documentElement.removeAttribute('data-theme');
}
function updateThemeBtn(){$('themeBtn').textContent=state.theme==='dark'?'🌙':state.theme==='light'?'☀️':'🌗'}
$('themeBtn').onclick=()=>{
  state.theme=state.theme==='dark'?'light':state.theme==='light'?null:'dark';
  applyTheme();updateThemeBtn();persist();
};
/* Hecho por Sebastián Poveda y Santiago Romero. 2026 — Auren · estilos */
/* ================= NAVEGACIÓN PRINCIPAL ================= */
document.querySelectorAll('#mainNav [data-nav]').forEach(b=>b.onclick=()=>{
  route={view:b.dataset.nav,materiaId:null};
  document.querySelectorAll('#mainNav button').forEach(x=>x.classList.toggle('on',x===b));
  render();
});
function goToView(v){
  route.view=v;route.materiaId=null;
  document.querySelectorAll('#mainNav button').forEach(x=>x.classList.toggle('on',x.dataset.nav===v));
  render();
}

/* ---------- Repintado incremental ----------
   Antes cada cambio reemplazaba toda la pantalla con innerHTML (se perdían el foco, lo escrito y se veía "parpadeo").
   Ahora, cuando es la MISMA pantalla, se compara con lo que ya está y solo se tocan los nodos que cambiaron.
   Las listas se emparejan por data-tema / data-sec / data-corte / data-key / id, así un elemento nuevo
   o movido no "contagia" su estado (desplegado, texto escrito) al de al lado. */
function claveNodo(n){
  if(n.nodeType!==1)return '';
  const d=n.dataset||{};
  return d.key||d.tema||d.sec||d.corte||n.id||'';
}
function morphNodo(padre,o,n){
  if(o.nodeType!==n.nodeType||o.nodeName!==n.nodeName){padre.replaceChild(document.importNode(n,true),o);return}
  if(o.nodeType!==1){if(o.nodeValue!==n.nodeValue)o.nodeValue=n.nodeValue;return}
  if(o.isEqualNode(n))return;                                   // nada que hacer
  const tag=o.nodeName,activo=(o===document.activeElement);
  const abiertoSinGuardar=tag==='DETAILS'&&!(o.dataset.tema||o.dataset.sec||o.dataset.corte);   // su estado abierto/cerrado no vive en la app: se respeta
  const valorAntes=o.getAttribute('value'),checkedAntes=o.hasAttribute('checked');
  const textoAntes=tag==='TEXTAREA'?o.defaultValue:null;
  const selAntes=tag==='SELECT'?Array.from(o.options).findIndex(x=>x.hasAttribute('selected')):-1;
  for(const a of Array.from(o.attributes)){
    if(abiertoSinGuardar&&a.name==='open')continue;
    if(!n.hasAttribute(a.name))o.removeAttribute(a.name);
  }
  for(const a of Array.from(n.attributes)){
    if(abiertoSinGuardar&&a.name==='open')continue;
    if(o.getAttribute(a.name)!==a.value)o.setAttribute(a.name,a.value);
  }
  morphHijos(o,n);
  /* Lo que la persona escribió o eligió solo se pisa si la app cambió el valor de fábrica, y nunca en el campo que tiene el foco */
  if(!activo){
    if(tag==='INPUT'){
      if(o.type==='checkbox'||o.type==='radio'){if(checkedAntes!==o.hasAttribute('checked'))o.checked=o.hasAttribute('checked')}
      else if(valorAntes!==o.getAttribute('value'))o.value=o.getAttribute('value')||'';
    }else if(tag==='TEXTAREA'){
      if(textoAntes!==o.defaultValue)o.value=o.defaultValue;
    }else if(tag==='SELECT'){
      const selDespues=Array.from(o.options).findIndex(x=>x.hasAttribute('selected'));
      if(selDespues!==selAntes&&selDespues>=0)o.selectedIndex=selDespues;
    }
  }
}
function morphHijos(o,n){
  const nuevos=Array.from(n.childNodes),viejos=Array.from(o.childNodes);
  const porClave=new Map();
  viejos.forEach(x=>{const k=claveNodo(x);if(k&&!porClave.has(k))porClave.set(k,x)});
  const usados=new Set();
  let ref=o.firstChild;
  for(const nuevo of nuevos){
    const k=claveNodo(nuevo);
    let cand=null;
    if(k){const c=porClave.get(k);if(c&&!usados.has(c))cand=c}
    else if(ref&&!usados.has(ref)&&!claveNodo(ref))cand=ref;
    if(cand){
      usados.add(cand);
      if(cand===ref)ref=ref.nextSibling;else o.insertBefore(cand,ref);
      morphNodo(o,cand,nuevo);
    }else{
      o.insertBefore(document.importNode(nuevo,true),ref);
    }
  }
  viejos.forEach(x=>{if(!usados.has(x)&&x.parentNode===o)o.removeChild(x)});
}
function morph(destino,html){
  const tpl=document.createElement('template');
  tpl.innerHTML=html;
  morphHijos(destino,tpl.content);
}
const VISTAS_MORPH=['materias','materiaDetail','perfil','docente','logros','docResultados','examenDoc','calendario','docExamen'];

function render(keep){
  const _y=window.scrollY;
  guardarRuta();
  if(route.view!=='tool')clearRepasoTimer();
  if(route.view!=='examenDoc')clearExTimer();
  const view=$('view');
  let html='';
  if(route.view==='materias')html=viewMateriasHTML();
  else if(route.view==='materiaDetail')html=viewMateriaDetailHTML(route.materiaId);
  else if(route.view==='tool')html=viewToolHTML();
  else if(route.view==='calendario')html=viewCalendarioHTML();
  else if(route.view==='perfil')html=esProfesor()?viewPerfilDocenteHTML():viewPerfilHTML();
  else if(route.view==='docExamen')html=viewDocExamenHTML();
  else if(route.view==='docResultados')html=viewDocResultadosHTML();
  else if(route.view==='examenDoc')html=viewExamenDocHTML();
  else if(route.view==='docente')html=viewDocenteHTML();
  else if(route.view==='logros')html=viewLogrosHTML();
  else html=view.innerHTML;
  /* Misma pantalla → repintado incremental. Pantalla nueva o cuestionario/tarjetas (que dependen de sus animaciones) → completo. */
  if(VISTAS_MORPH.includes(route.view)&&claveVista()===ultimaVista&&view.firstElementChild)morph(view,html);
  else view.innerHTML=html;
  aplicarSoloLectura();
  aplicarRolMenu();
  animarVista();
  window.scrollTo(0,keep?_y:0);
  requestAnimationFrame(()=>{fitCards();layoutRadials()});
}

/* ================= HELPERS DE DATOS ================= */
const scaleMax=()=>+(state.profile&&state.profile.scale)||5;
function fmtN(n){return(+n).toLocaleString('es',{minimumFractionDigits:0,maximumFractionDigits:scaleMax()>10?1:2})}
function corteStats(cortes){
  const scale=scaleMax(),goal=clamp(+state.profile.goal||0,0,scale);
  const W=cortes.reduce((a,c)=>a+(+c.weight||0),0);
  const scored=cortes.filter(c=>c.score!=null&&c.score!=='');
  const Ws=scored.reduce((a,c)=>a+(+c.weight||0),0);
  const sum=scored.reduce((a,c)=>a+(+c.score)*(+c.weight||0),0);
  const acum=W>0?sum/W:0;
  const avg=Ws>0?sum/Ws:null;
  const remW=W>0?(W-Ws)/W:0;
  const need=remW>0.0001?(goal-acum)/remW:null;
  return{scale,goal,W,Ws,acum,avg,remW,need,n:scored.length};
}
function weightedAvg(cortes){
  const scored=cortes.filter(c=>c.score!=null && c.score!=='');
  const totalW=scored.reduce((a,c)=>a+(+c.weight||0),0);
  if(!scored.length||!totalW)return null;
  const sum=scored.reduce((a,c)=>a+(+c.score)*(+c.weight),0);
  return sum/totalW;
}

/* ================= VISTA: MIS MATERIAS ================= */
/* ===== Rediseño: colores por materia, iconos y panel de estadísticas ===== */
const MAT_COLORS=['#7FB3E6','#A99BE8','#8ED1A4','#E8C27A','#E58FA8','#E9A58C'];
function matColor(m){let h=0;const k=String(m.id||m.name||'');for(let i=0;i<k.length;i++)h=(h*31+k.charCodeAt(i))>>>0;return MAT_COLORS[h%MAT_COLORS.length]}
const SVG_A='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const IC_EDIT=SVG_A+'<path d="M4.5 19.5l.8-3.8L16.4 4.6a1.6 1.6 0 012.3 0l.7.7a1.6 1.6 0 010 2.3L8.3 18.7z"/></svg>';
const IC_DEL=SVG_A+'<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5"/></svg>';
const IC_ARR=SVG_A+'<path d="M5 12h14M13 6l6 6-6 6"/></svg>';
function pluralMv(n,a,b){return n+' '+(n==1?a:b)}

/* ================= VISTA: MIS MATERIAS ================= */
function viewMateriasHTML(){
  const sems=state.semesters.filter(x=>!x.oculto);
  const todas=[];
  const bloques=sems.map(sem=>{
    const mats=state.materias.filter(m=>m.semesterId===sem.id&&m.rol!=='docente');
    todas.push(...mats);
    return `<details class="sem" open>
      <summary>
        <span class="semT"><h2>🎓 ${esc(sem.name)}</h2><p>${pluralMv(mats.length,'materia','materias')}</p></span>
        <span class="mpair">
          <button class="icon-btn" data-action="renameSemester" data-id="${sem.id}" title="Renombrar semestre" aria-label="Renombrar semestre">${IC_EDIT}</button><i></i>
          <button class="icon-btn del" data-action="delSemester" data-id="${sem.id}" title="Eliminar semestre" aria-label="Eliminar semestre">${IC_DEL}</button>
        </span>
      </summary>
      <div class="grid">${mats.map(materiaCard).join('')||'<p class="meta">Sin materias en este semestre.</p>'}</div>
      <div class="madd"><button class="sec" data-action="addMateria" data-sem="${sem.id}">+ Agregar materia</button><button class="sec" data-action="createShared" data-sem="${sem.id}">🤝 Materia compartida</button></div>
    </details>`;
  }).join('');
  return `<div class="mv"><div class="mv-col">
    <div class="viewhead"><div><h1>Mis materias</h1><p class="sub">${pluralMv(sems.length,'semestre','semestres')} y ${pluralMv(todas.length,'materia','materias')}</p></div>
      <span class="row" style="margin:0"><button class="sec" data-action="joinSharedPrompt">🔗 Unirme con código</button><button class="pr" data-action="addSemester">+ Semestre</button></span></div>
    ${invitacionesHTML()}
    ${repasoHoyHTML()}
    ${sems.length?'':'<div class="empty">Aún no tienes semestres. Agrega uno para empezar a organizar tus materias.</div>'}
    ${bloques}
  </div><aside class="mv-stats" aria-label="Resumen del estudiante">${matStatsHTML(sems.length,todas)}</aside></div>`;
}
function materiaCard(m){
  const temasCount=state.temas.filter(t=>t.materiaId===m.id).length;
  const avg=weightedAvg(state.cortes.filter(c=>c.materiaId===m.id));
  const mx=scaleMax()||5;
  const tag=m.rol==='estudiante'?`<span class="mtag">👩‍🏫 ${esc(nombreDocente(m))} · solo lectura</span>`
    :m.sharedId?`<span class="mtag">🤝 Compartida · ${pluralMv(nMiembros(m),'persona','personas')}</span>`:'';
  const info=avg==null
    ?`<div class="meta">Sin notas registradas</div><div class="mbar"><i style="width:0"></i></div>`
    :`<div class="avg"><b>${fmtN(avg)}</b><span>/ ${fmtN(mx)} de promedio</span></div><div class="mbar"><i style="width:${Math.max(0,Math.min(100,avg/mx*100))}%"></i></div>`;
  return `<div class="mcard" style="--mc:${matColor(m)}">
    <div class="ttl"><h3>${esc(m.icon||'📘')} ${esc(m.name)}</h3><div class="sub2"><span class="meta">${pluralMv(temasCount,'tema','temas')}</span>${tag}</div></div>
    <div class="info">${info}</div>
    <div class="macts">
      <button class="mopen" data-action="openMateria" data-id="${m.id}" aria-label="Abrir ${esc(m.name)}"><span class="lb">Abrir</span>${IC_ARR}</button>
      <span class="mpair">
        <button class="icon-btn" data-action="renameMateria" data-id="${m.id}" title="Editar materia" aria-label="Editar ${esc(m.name)}">${IC_EDIT}</button><i></i>
        <button class="icon-btn del" data-action="delMateria" data-id="${m.id}" title="Eliminar materia" aria-label="Eliminar ${esc(m.name)}">${IC_DEL}</button>
      </span>
    </div>
  </div>`;
}
function matStatsHTML(nSem,mats){
  const mx=scaleMax()||5;
  const rows=mats.map(m=>({m,a:weightedAvg(state.cortes.filter(c=>c.materiaId===m.id))})).filter(x=>x.a!=null);
  const avg=rows.length?rows.reduce((t,x)=>t+x.a,0)/rows.length:null;
  const temas=mats.reduce((t,m)=>t+state.temas.filter(x=>x.materiaId===m.id).length,0);
  const comp=mats.filter(m=>m.sharedId).length;
  const srt=rows.slice().sort((x,y)=>y.a-x.a);
  const best=srt[0],low=srt.length>1?srt[srt.length-1]:null;
  const C=314.16,d=avg==null?0:Math.max(0,Math.min(avg/mx,1))*C;
  const hl=(lbl,x)=>`<div><span>${lbl}</span><b style="--mc:${matColor(x.m)}"><i></i><em>${esc(x.m.name)}</em> ${fmtN(x.a)}</b></div>`;
  const resaltes=(best?hl('Mejor promedio',best):'')+(low?hl('Por reforzar',low):'');
  const filas=srt.map(x=>`<div class="stRow" style="--mc:${matColor(x.m)}"><span>${esc(x.m.name)}</span><b>${fmtN(x.a)}</b><div class="mbar"><i style="width:${Math.max(0,Math.min(100,x.a/mx*100))}%"></i></div></div>`).join('');
  return `<section class="stPn"><div class="stK">Promedio general</div>
      <div class="stRing"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" fill="none" stroke="var(--b)" stroke-width="9"/><circle cx="60" cy="60" r="50" fill="none" stroke="var(--a)" stroke-width="9" stroke-linecap="round" stroke-dasharray="${d.toFixed(1)} ${C}" transform="rotate(-90 60 60)"/></svg>
      <div class="stRc"><b>${avg==null?'—':fmtN(avg)}</b><span>/ ${fmtN(mx)}</span></div></div>
      <p class="stNote">${avg==null?'Aún no hay notas registradas':'Promedio de '+pluralMv(rows.length,'materia con notas','materias con notas')}</p>
      <div class="stHl">${resaltes}</div></section>
    <section class="stPn"><div class="stK">En resumen</div><div class="stKp">
      <div><b>${nSem}</b><span>${nSem==1?'semestre':'semestres'}</span></div><div><b>${mats.length}</b><span>${mats.length==1?'materia':'materias'}</span></div>
      <div><b>${temas}</b><span>${temas==1?'tema':'temas'}</span></div><div><b>${comp}</b><span>${comp==1?'compartida':'compartidas'}</span></div></div></section>
    ${filas?`<section class="stPn"><div class="stK">Promedio por materia</div><div class="stRows">${filas}</div></section>`:''}`;
}

/* ================= VISTA: DETALLE DE MATERIA ================= */
function viewMateriaDetailHTML(materiaId){
  const m=state.materias.find(x=>x.id===materiaId);
  if(!m){goToView('materias');return'';}
  if(m.rol==='docente'){
    if(docTabMat!==materiaId){docTabMat=materiaId;docTab='contenido'}
    if(docTab!=='contenido')return viewDocenteTabHTML(m);
  }
  const cortes=state.cortes.filter(c=>c.materiaId===materiaId);
  const iaSel=cortes.some(c=>c.id===ui.iaCorte)?ui.iaCorte:(cortes[0]&&cortes[0].id);
  if(m.rol!=='estudiante'&&(!ui.iaUso||(!ui.iaUso.cargando&&Date.now()-(ui.iaUso.t||0)>60000)))setTimeout(cargarUsoIA,0);   // se consulta el cupo al abrir la materia
  return `
    <button class="sec" data-action="${m.rol==='docente'?'backDocente':'backMaterias'}">${m.rol==='docente'?'← Espacio docente':'← Mis materias'}</button>
    <div class="viewhead" style="margin-top:14px"><h1>${esc(m.icon||'📘')} ${esc(m.name)}</h1></div>
    ${m.rol==='docente'?docentePanelHTML(m):m.rol==='estudiante'?estudianteDocenteBoxHTML(m)+docsOriginalesHTML(m)+examenesEstudianteHTML(m):compartidoBoxHTML(m)}

    <section class="${m.rol==='estudiante'?'docRO':''}">
      <div class="viewhead"><h2>📁 Cortes</h2><button class="pr" data-action="addCorte" data-mat="${materiaId}">+ Agregar corte</button></div>
      <div class="card notasBox" style="margin-bottom:14px;${m.rol==='docente'?'display:none':''}">
        <b style="font-size:.9em">🧮 Mi promedio en esta materia</b>
        <div id="corteAvgBox" style="margin-top:8px">${corteAvgHTML(cortes)}</div>
      </div>
      <div class="card iaCard" style="margin-bottom:14px">
        <b style="font-size:.9em">🤖 Generar tema con IA</b>
        <p class="meta" style="margin-top:4px">Sube un PDF o una presentación (.pptx), elige en qué corte guardarlo y la IA organiza el contenido en secciones y crea las tarjetas.</p>
        <label class="lbl" for="iaCorte">Guardar en</label>
        <select class="fld" id="iaCorte" data-action="iaCorteSel">${cortes.map(c=>`<option value="${c.id}" ${c.id===iaSel?'selected':''}>${esc(c.name)||'(corte sin nombre)'}</option>`).join('')}</select>
        <input type="file" id="iaFileInput" accept=".pdf,.pptx" data-mat="${materiaId}" style="display:none">
        <button class="sec" id="iaUploadBtn" data-action="iaPickFile" style="margin-top:10px">📎 Subir PDF o PPTX</button>
        <div id="iaCupo" style="margin-top:10px">${cupoIAHTML()}</div>
        <div id="iaStatus" class="meta" style="margin-top:8px"></div>
      </div>
      ${cortes.map(c=>corteFolder(c,materiaId)).join('')}
    </section>

    <section style="margin-top:22px">
      <div class="viewhead"><h2>🎯 Estudiar</h2></div>
      <p class="meta">Estas herramientas usan las tarjetas (frente/reverso) que agregues dentro de cada tema.</p>
      <div class="toolGrid">
        <button class="sec" data-action="openTool" data-tool="flashcards" data-mat="${materiaId}">🔄 Flashcards</button>
        <button class="sec" data-action="openTool" data-tool="memorizar" data-mat="${materiaId}">📖 Memorizar</button>
        <button class="sec" data-action="openTool" data-tool="quiz" data-mat="${materiaId}">❓ Quiz</button>
        <button class="sec" data-action="openTool" data-tool="examen" data-mat="${materiaId}">📝 Modo examen</button>
        <button class="sec" data-action="openTool" data-tool="concepto" data-mat="${materiaId}">💡 ¿Qué concepto?</button>
        <button class="sec" data-action="openTool" data-tool="hoy" data-mat="${materiaId}">📅 Repaso de hoy${sesionHoy(materiaId).length?' ('+sesionHoy(materiaId).length+')':''}</button>
        <button class="sec" data-action="openTool" data-tool="falle" data-mat="${materiaId}">🎯 Repasar lo que fallé${tarjetasFalladas(materiaId).length?' ('+tarjetasFalladas(materiaId).length+')':''}</button>
        <button class="sec" data-action="openTool" data-tool="repaso" data-mat="${materiaId}">⏱️ Repaso 5 min</button>
        <button class="sec" data-action="openTool" data-tool="comparar" data-mat="${materiaId}">⚖️ Comparar</button>
        <button class="sec" data-action="openTool" data-tool="progreso" data-mat="${materiaId}">📊 Mi progreso</button>
        <button class="sec" data-action="openTool" data-tool="referencias" data-mat="${materiaId}">📚 Referencias</button>
      </div>
    </section>
  `;
}
function corteFolder(c,materiaId){
  const temas=state.temas.filter(t=>t.corteId===c.id).sort((a,b)=>b.updatedAt-a.updatedAt);
  const hasScore=c.score!=null&&c.score!=='';
  const open=ui.open[c.id]!==false;
  return `<details class="folder" data-corte="${c.id}" ${open?'open':''}>
    <summary>
      <span class="fHead"><span class="ft">📁 ${esc(c.name)||'(corte sin nombre)'}</span>
        <span class="chips"><span class="chip">${temas.length} tema${temas.length==1?'':'s'}</span><span class="chip">${fmtN(+c.weight||0)}%</span>${hasScore?`<span class="chip chipOk">Nota ${fmtN(c.score)}</span>`:''}</span></span>
      <span class="fAct">
        <button class="icon-btn" data-action="editCorte" data-id="${c.id}" title="Editar corte">✏️</button>
        <button class="icon-btn" data-action="delCorte" data-id="${c.id}" title="Eliminar corte">🗑️</button>
      </span>
    </summary>
    <div class="b">
      <div class="corteEdit">
        <div class="corteGrid">
          <div><label class="lbl">Nombre del corte</label><input class="fld" data-action="editCorteName" data-id="${c.id}" value="${esc(c.name)}" placeholder="Ej. Corte 1"></div>
          <div><label class="lbl">Peso (%)</label><input class="fld" type="number" min="0" max="100" step="1" data-action="editCorteWeight" data-id="${c.id}" value="${c.weight}"></div>
          <div><label class="lbl">Nota (0 a ${fmtN(scaleMax())})</label><input class="fld" type="number" min="0" max="${scaleMax()}" step="0.1" data-action="editCorteScore" data-id="${c.id}" value="${c.score??''}" placeholder="Sin nota"></div>
        </div>
        <div class="secFoot"><button class="sec" data-action="doneCorte" data-id="${c.id}">✓ Listo</button></div>
      </div>
      <div class="temaList">${temas.map(temaBlock).join('')||'<div class="empty">Este corte aún no tiene temas.</div>'}</div>
      <button class="pr" style="margin-top:12px" data-action="addTema" data-mat="${materiaId}" data-corte="${c.id}">+ Agregar tema</button>
    </div>
  </details>`;
}
function corteAvgHTML(cortes){
  const k=corteStats(cortes);
  const pct=k.avg==null?0:clamp(k.avg/k.scale*100,0,100);
  const gpct=clamp(k.goal/k.scale*100,0,100);
  const ok=k.avg!=null&&k.avg>=k.goal;
  let msg='';
  if(k.W<=0)msg='Asigna un peso (%) a tus cortes para calcular el promedio.';
  else if(k.need==null)msg=k.acum>=k.goal-1e-9?'🎉 Cumpliste tu meta.':'No alcanzaste la meta de '+fmtN(k.goal)+'.';
  else if(k.need<=0)msg='🎉 Ya aseguraste tu meta, aunque sacaras 0 en lo que falta.';
  else if(k.need>k.scale+1e-9)msg='Con lo que falta ya no alcanzas la meta (necesitarías '+fmtN(Math.ceil(k.need*100)/100)+' y el máximo es '+fmtN(k.scale)+').';
  else msg='Necesitas sacar al menos <b>'+fmtN(Math.ceil(k.need*100)/100)+'</b> de promedio en lo que falta ('+Math.round(k.remW*100)+'% restante) para llegar a tu meta.';
  const warn=k.W>0&&Math.abs(k.W-100)>0.01?`<p class="meta" style="color:var(--no)">⚠️ Los pesos suman ${fmtN(k.W)}%, deberían sumar 100%.</p>`:'';
  return `<div class="bar goalBar"><i style="width:${pct}%;background:${ok?'var(--ok)':'var(--a)'}"></i><span class="goalMark" style="left:${gpct}%" title="Meta"></span></div>
  <p class="meta" style="margin:6px 0">${k.avg==null?'Registra la nota de un corte para ver tu promedio.':`Promedio de lo evaluado: <b style="color:${ok?'var(--ok)':'var(--t)'}">${fmtN(k.avg)}</b> / ${fmtN(k.scale)} · meta ${fmtN(k.goal)}`}</p>
  <p class="meta" style="margin:0">${msg}</p>${warn}`;
}
function refreshCorteAvg(materiaId){
  const cortes=state.cortes.filter(c=>c.materiaId===materiaId);
  const box=$('corteAvgBox');
  if(box)box.innerHTML=corteAvgHTML(cortes);
}
const ui={open:{},sec:{},tab:{}};
function fmtBody(txt){
  const lines=String(txt||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
  let out='',list=[];
  const flush=()=>{if(list.length){out+='<ul class="lista">'+list.map(x=>`<li>${esc(x)}</li>`).join('')+'</ul>';list=[]}};
  lines.forEach(l=>{
    const h=l.match(/^#{2,3}\s+(.*)$/);
    if(h){flush();out+=`<h4 class="subTit">${esc(h[1])}</h4>`;return}
    const m=l.match(/^[-•–*]\s+(.*)$/);if(m)list.push(m[1]);else{flush();out+=`<p>${esc(l)}</p>`}
  });
  flush();
  return out||'<p class="meta">Esta sección todavía no tiene contenido.</p>';
}
function puntosDe(sc){
  if(Array.isArray(sc.puntos)&&sc.puntos.length)return sc.puntos;
  const body=String(sc.body||'').trim();
  const bullets=body.split(/\n+/).map(x=>x.trim()).filter(l=>/^[-•–*]\s+/.test(l)).map(l=>l.replace(/^[-•–*]\s+/,''));
  let base=bullets;
  if(!base.length){base=(body.match(/[^.!?]+[.!?]+/g)||[]).map(x=>x.trim());if(!base.length&&body)base=[body]}
  return base.slice(0,4).map(x=>x.length>110?x.slice(0,107).trim()+'…':x);
}
const prevSec=b=>String(b||'').replace(/^#{2,3}\s+/gm,'').replace(/\s+/g,' ').trim().slice(0,120);
function secReadHTML(sc){
  const p=puntosDe(sc);
  return `<div class="txt">${fmtBody(sc.body)}</div>${sc.rel?`<div class="relIdeas"><small>🔗 Relación con otras ideas</small><p>${esc(sc.rel)}</p></div>`:''}${p.length?`<div class="puntos"><small>Ideas clave</small><ul>${p.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}`;
}
/* Hecho por Sebastián Poveda y Santiago Romero. 2026 · sistema de esquemas */
/* ===== Esquemas: ramificado, radial y matricial ===== */
const ESQ_ESTILOS=[
  {id:'ramificado',nombre:'Ramificado',desc:'Jerarquía con ramas y tarjetas',icono:'<rect x="3" y="4" width="7" height="4" rx="1"/><rect x="14" y="10" width="7" height="4" rx="1"/><rect x="14" y="16" width="7" height="4" rx="1"/><path d="M6.5 8v10M6.5 12H14M6.5 18H14"/>'},
  {id:'radial',nombre:'Radial',desc:'Tema central y ramas alrededor',icono:'<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="4" r="2"/><circle cx="19" cy="16.5" r="2"/><circle cx="5" cy="16.5" r="2"/><path d="M12 9.5V6M14.2 13.3l3 1.8M9.8 13.3l-3 1.8"/>'},
  {id:'matricial',nombre:'Matricial',desc:'Filas y columnas comparativas',icono:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M9.5 4v16"/>'}
];
const ESQ_COLS={definicion:'Definición',caracteristica:'Características',ejemplo:'Ejemplo'};
const ESQ_TIPOS=Object.keys(ESQ_COLS);
const ESQ_TAGS={def:'definicion',car:'caracteristica',ej:'ejemplo'};
const ESQ_TAGOF={definicion:'def',caracteristica:'car',ejemplo:'ej'};
function esqEstilo(){
  if(ESQ_ESTILOS.some(e=>e.id===ui.esqEstilo))return ui.esqEstilo;
  try{const v=localStorage.getItem('esquema-estilo');if(ESQ_ESTILOS.some(e=>e.id===v)){ui.esqEstilo=v;return v}}catch(e){}
  return 'ramificado';
}
function esqGuardar(id){ui.esqEstilo=id;try{localStorage.setItem('esquema-estilo',id)}catch(e){}}
/* Cada idea tiene un tipo (definición, característica o ejemplo). Lo trae la IA; si falta, se deduce del texto. */
function ideasDe(sc){
  const tp=Array.isArray(sc.tipos)?sc.tipos:[];
  const out=puntosDe(sc).map((texto,i)=>({texto,tipo:ESQ_TIPOS.includes(tp[i])?tp[i]:null}));
  let hayDef=out.some(x=>x.tipo==='definicion');
  out.forEach((x,i)=>{
    if(x.tipo)return;
    if(/^(por ejemplo|ejemplo|p\.\s?ej|e\.g\.)/i.test(x.texto))x.tipo='ejemplo';
    else if(!hayDef&&i===0&&/\b(es|son|se define|se denomina|consiste|se entiende|significa)\b/i.test(x.texto)){x.tipo='definicion';hayDef=true}
    else x.tipo='caracteristica';
  });
  return out;
}
/* Edición: una idea por línea; opcionalmente empieza con [def], [car] o [ej] para fijar su tipo. */
function ideasTexto(sc){
  const pts=Array.isArray(sc.puntos)?sc.puntos:[],tp=Array.isArray(sc.tipos)?sc.tipos:[];
  return pts.map((p,i)=>ESQ_TIPOS.includes(tp[i])?`[${ESQ_TAGOF[tp[i]]}] ${p}`:p).join('\n');
}
function ideasParse(valor){
  const puntos=[],tipos=[];
  String(valor||'').split('\n').forEach(l=>{
    l=l.trim();if(!l)return;
    const m=l.match(/^\[(def|car|ej)\]\s*(.*)$/i);
    if(m){if(!m[2].trim())return;puntos.push(m[2].trim());tipos.push(ESQ_TAGS[m[1].toLowerCase()])}
    else{puntos.push(l);tipos.push(null)}
  });
  return{puntos,tipos};
}
const ESQ_TAGTXT={definicion:'Definición',caracteristica:'Característica',ejemplo:'Ejemplo'};
/* Una idea puede venir como "Término: explicación". El término se resalta para que el esquema use el vocabulario del tema. */
function ideaParts(texto){
  const t=String(texto||'').trim();
  const m=t.match(/^([^:.\n]{2,52}):\s+([\s\S]+)$/);
  if(m&&m[1].trim().split(/\s+/).length<=6){const d=m[2].trim();return{term:m[1].trim(),desc:d.charAt(0).toUpperCase()+d.slice(1)}}
  return{term:'',desc:t};
}
function esqCorto(t,max){if(t.length<=max)return t;const c=t.slice(0,max-1),i=c.lastIndexOf(' ');return (i>12?c.slice(0,i):c).replace(/[\s,;:.]+$/,'')+'…'}
function ideaHTML(i){const p=ideaParts(i.texto);return p.term?`<b class="esqx-term">${esc(p.term)}</b> ${esc(p.desc)}`:esc(p.desc)}
function esqLeyenda(){return `<div class="esqx-leg" aria-hidden="true">${ESQ_TIPOS.map(k=>`<span class="esqx-lg esqx-t-${k}"><i></i>${ESQ_TAGTXT[k]}</span>`).join('')}</div>`}
function esqNodo(sc,n){return `<div class="esqx-catnode"><span class="esqx-num">${n+1}</span>${esc(sc.title)||'(sin título)'}</div>`}
function esqRamificado(t,secs){
  return `${esqLeyenda()}<div class="esqx-ram"><div class="esqx-root">${esc(t.title)||'Tema'}</div><div class="esqx-cats">${secs.map((sc,n)=>{const ids=ideasDe(sc);return `<section class="esqx-cat">${esqNodo(sc,n)}${ids.length?`<div class="esqx-grid">${ids.map(i=>{const p=ideaParts(i.texto);return `<div class="esqx-card esqx-t-${i.tipo}"><span class="esqx-tag">${ESQ_TAGTXT[i.tipo]}</span>${p.term?`<b class="esqx-term">${esc(p.term)}</b>`:''}<span class="esqx-desc">${esc(p.desc)}</span></div>`}).join('')}</div>`:''}</section>`}).join('')}</div></div>`;
}
function esqRadial(t,secs){
  return `${esqLeyenda()}<div class="esqx-scroll"><div class="esqx-fit"><div class="esqx-stage"><svg class="esqx-lines" aria-hidden="true"></svg><div class="esqx-center">${esc(t.title)||'Tema'}</div>${secs.map(sc=>`<article class="esqx-rcard"><div class="esqx-rtitle">${esc(sc.title)||'(sin título)'}</div><div class="esqx-chips">${ideasDe(sc).map(i=>{const p=ideaParts(i.texto);const lbl=p.term||esqCorto(p.desc,40);return `<span class="esqx-chip esqx-t-${i.tipo}" title="${esc(i.texto)}">${esc(lbl)}</span>`}).join('')}</div></article>`).join('')}</div></div></div>`;
}
function esqMatricial(t,secs){
  const lista=it=>it.length===1?`<p>${ideaHTML(it[0])}</p>`:`<ul>${it.map(x=>`<li>${ideaHTML(x)}</li>`).join('')}</ul>`;
  const tabla=`<div class="esqx-tscroll" tabindex="0" role="region" aria-label="Matriz comparativa"><table class="esqx-matriz"><caption>${esc(t.title)||'Tema'}</caption><thead><tr><th scope="col">Concepto</th>${ESQ_TIPOS.map(k=>`<th scope="col">${ESQ_COLS[k]}</th>`).join('')}</tr></thead><tbody>${secs.map(sc=>{const ids=ideasDe(sc);return `<tr><th scope="row">${esc(sc.title)||'(sin título)'}</th>${ESQ_TIPOS.map(k=>{const it=ids.filter(x=>x.tipo===k);return `<td>${it.length?lista(it):'<span class="vacio">—</span>'}</td>`}).join('')}</tr>`}).join('')}</tbody></table></div>`;
  const tarjetas=`<div class="esqx-mcards">${secs.map((sc,n)=>{const ids=ideasDe(sc);return `<section class="esqx-mc">${esqNodo(sc,n)}${ESQ_TIPOS.map(k=>{const it=ids.filter(x=>x.tipo===k);return it.length?`<div class="esqx-mrow esqx-t-${k}"><span class="esqx-tag">${ESQ_COLS[k]}</span>${lista(it)}</div>`:''}).join('')}</section>`}).join('')}</div>`;
  return tabla+tarjetas;
}
function esquemaHTML(t){
  const secs=Array.isArray(t.secciones)?t.secciones:[];
  if(!secs.length)return'<div class="empty">Este tema no tiene secciones, así que todavía no hay esquema.</div>';
  const est=esqEstilo(),info=ESQ_ESTILOS.find(e=>e.id===est);
  const view=est==='radial'?esqRadial(t,secs):est==='matricial'?esqMatricial(t,secs):esqRamificado(t,secs);
  const items=ESQ_ESTILOS.map(e=>`<li role="none"><button type="button" class="esqx-mi" role="menuitemradio" aria-checked="${e.id===est}" data-action="esqStyle" data-estilo="${e.id}" tabindex="-1"><svg class="esqx-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${e.icono}</svg><span><span class="esqx-nm">${e.nombre}</span><span class="esqx-ds">${e.desc}</span></span></button></li>`).join('');
  return `<div class="esqx" data-esqtema="${t.id}"><div class="esqx-bar"><div class="esqx-tabs"><button type="button" class="esqx-tab" data-action="esqMenu" aria-haspopup="menu" aria-expanded="false"><span>Esquema</span><span class="esqx-cur">${info.nombre}</span><svg class="esqx-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button><ul class="esqx-menu" role="menu" aria-label="Estilo de esquema" hidden>${items}</ul></div></div><div class="esqx-view esqx-anim">${view}</div></div>`;
}
/* Vista radial: ramas en círculo, sin superposiciones, y se reduce la escala para que SIEMPRE quepa en el panel. */
function esqChocan(a,b,g){return a.x-g<b.x+b.w&&b.x-g<a.x+a.w&&a.y-g<b.y+b.h&&b.y-g<a.y+a.h}
function layoutRadial(stage){
  const fit=stage.parentElement,wrap=fit.parentElement;
  const svg=stage.querySelector('.esqx-lines'),center=stage.querySelector('.esqx-center'),cards=[...stage.querySelectorAll('.esqx-rcard')];
  while(svg.firstChild)svg.removeChild(svg.firstChild);
  const avail=wrap.clientWidth;
  stage.style.transform='';fit.style.width='';fit.style.height='';
  if(avail&&avail<560){stage.classList.add('stacked','laid');stage.style.width='';stage.style.height='';return}
  stage.classList.remove('stacked');
  const n=cards.length;if(!n){stage.classList.add('laid');return}
  const cw=center.offsetWidth,ch=center.offsetHeight,sizes=cards.map(c=>({w:c.offsetWidth,h:c.offsetHeight})),gap=26,pad=24;
  /* Se prueban varias formas (óvalo ancho, círculo, óvalo alto) y se elige la que menos hay que reducir para que quepa. */
  function resolver(ratio){
    let r=110,pts=[],rects=[];
    for(let it=0;it<900;it++){
      const rx=r*ratio,ry=r;
      pts=cards.map((_,k)=>{const an=(-90+k*360/n)*Math.PI/180;return{x:rx*Math.cos(an),y:ry*Math.sin(an)}});
      rects=pts.map((q,k)=>({x:q.x-sizes[k].w/2,y:q.y-sizes[k].h/2,w:sizes[k].w,h:sizes[k].h}));
      const todos=[{x:-cw/2,y:-ch/2,w:cw,h:ch}].concat(rects);
      let ok=true;
      for(let i=0;i<todos.length&&ok;i++)for(let j=i+1;j<todos.length;j++)if(esqChocan(todos[i],todos[j],gap)){ok=false;break}
      if(ok)break;
      r+=10;
    }
    const all=[{x:-cw/2,y:-ch/2,w:cw,h:ch}].concat(rects);
    const minX=Math.min(...all.map(q=>q.x)),maxX=Math.max(...all.map(q=>q.x+q.w)),minY=Math.min(...all.map(q=>q.y)),maxY=Math.max(...all.map(q=>q.y+q.h));
    return{pts,rects,minX,minY,W:Math.ceil(maxX-minX+pad*2),H:Math.ceil(maxY-minY+pad*2)};
  }
  let mejor=null;
  [1.35,1.1,0.9,0.75].forEach(ratio=>{
    const c=resolver(ratio);
    c.k=avail?Math.min(1,avail/c.W):1;
    if(!mejor||c.k>mejor.k+0.02||(Math.abs(c.k-mejor.k)<=0.02&&c.H<mejor.H))mejor=c;
  });
  const {pts,rects,minX,minY,W,H}=mejor;
  const ox=pad-minX,oy=pad-minY;
  stage.style.width=W+'px';stage.style.height=H+'px';
  svg.setAttribute('width',W);svg.setAttribute('height',H);svg.setAttribute('viewBox','0 0 '+W+' '+H);
  center.style.left=(-cw/2+ox)+'px';center.style.top=(-ch/2+oy)+'px';
  cards.forEach((c,k)=>{
    c.style.left=(rects[k].x+ox)+'px';c.style.top=(rects[k].y+oy)+'px';
    const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
    ln.setAttribute('x1',ox);ln.setAttribute('y1',oy);ln.setAttribute('x2',pts[k].x+ox);ln.setAttribute('y2',pts[k].y+oy);
    svg.appendChild(ln);
  });
  const k=(avail&&W>avail)?Math.max(0.72,avail/W):1;
  if(k<1)stage.style.transform='scale('+k+')';
  fit.style.width=Math.round(W*k)+'px';fit.style.height=Math.round(H*k)+'px';
  stage.classList.add('laid');
}
function layoutRadials(root){(root||document).querySelectorAll('.esqx-stage').forEach(st=>{if(st.offsetParent!==null)layoutRadial(st)})}
function esqCerrarMenus(except){
  document.querySelectorAll('.esqx-menu:not([hidden])').forEach(m=>{
    if(m===except)return;
    m.hidden=true;const tb=m.parentElement.querySelector('.esqx-tab');if(tb)tb.setAttribute('aria-expanded','false');
  });
}
function esqRefrescar(){
  document.querySelectorAll('.esqx').forEach(h=>{const t=state.temas.find(x=>x.id===h.dataset.esqtema);if(t)h.outerHTML=esquemaHTML(t)});
  requestAnimationFrame(()=>layoutRadials());
}
function temaBlock(t){
  const cards=state.cards.filter(c=>c.temaId===t.id);
  const hasSec=Array.isArray(t.secciones);
  let tab=ui.tab[t.id]||'contenido';
  if(tab==='esquema'&&!hasSec)tab='contenido';
  const tabs=[['contenido','Contenido'],...(hasSec?[['esquema','Esquema']]:[]),['tarjetas',`Tarjetas <span class="chip">${cards.length}</span>`]];
  return `<details class="s" data-tema="${t.id}" ${ui.open[t.id]?'open':''}>
    <summary><span class="temaHead"><span class="tt">📝 ${esc(t.title)||'(tema sin título)'}</span><span class="chips">${esDocenteMat(t.materiaId)?`<span class="chip ${t.publicado?'chipOk':''}">${t.publicado?'✅ Publicado':'📝 Borrador'}</span>`:''}${t.by&&sharedMateria(t.materiaId)?`<span class="chip" title="${esc(t.fuente||'')}">👤 ${esc(t.by)}</span>`:''}${hasSec?`<span class="chip">${t.secciones.length} sección${t.secciones.length==1?'':'es'}</span>`:''}<span class="chip">${cards.length} tarjeta${cards.length==1?'':'s'}</span></span></span>
      ${t.archivo?`<button class="icon-btn" data-action="descargarOriginal" data-id="${t.id}" title="Descargar documento original" aria-label="Descargar documento original">⬇️</button>`:''}${esDocenteMat(t.materiaId)?`<button class="icon-btn" data-action="togglePublicar" data-id="${t.id}" title="${t.publicado?'Pasar a borrador':'Publicar a los estudiantes'}">${t.publicado?'📝':'✅'}</button>`:''}<button class="icon-btn" data-action="delTema" data-id="${t.id}" title="Eliminar tema">🗑️</button>
    </summary>
    <div class="b">
      <input class="fld tituloTema" data-action="editTemaTitle" data-id="${t.id}" value="${esc(t.title)}" placeholder="Título del tema">
      ${t.fuente?`<p class="meta" style="margin:4px 0 0">📎 ${esc(t.fuente)}${t.by?' · subido por '+esc(t.by):''}</p>`:''}
      ${t.archivo?docOriginalHTML(t):''}
      <div class="tabsT">${tabs.map(([k,l])=>`<button type="button" data-action="temaTab" data-id="${t.id}" data-tab="${k}" class="${tab===k?'on':''}">${l}</button>`).join('')}</div>
      <div class="tp" data-panel="contenido" ${tab==='contenido'?'':'hidden'}>
        ${hasSec&&t.body?`<div class="resumenCard"><small>Resumen</small><p>${esc(t.body)}</p></div>`:''}
        ${hasSec
          ? `<div class="secList">${t.secciones.map(sc=>secBlock(t.id,sc)).join('')}</div>
             <button class="sec" data-action="addSec" data-id="${t.id}">+ Agregar sección</button>`
          : `<textarea class="fld" data-action="editTemaBody" data-id="${t.id}" placeholder="Escribe aquí tus apuntes de este tema…">${esc(t.body)}</textarea>`}
      </div>
      ${hasSec?`<div class="tp" data-panel="esquema" ${tab==='esquema'?'':'hidden'}>${esquemaHTML(t)}</div>`:''}
      <div class="tp" data-panel="tarjetas" ${tab==='tarjetas'?'':'hidden'}>
        <p class="meta tarjIntro">Frente = término o pregunta. Reverso = definición o respuesta. Con estas se arman Flashcards, Quiz, etc.</p>
        <div class="cardList">${cards.map(cardRow).join('')||'<p class="meta">Sin tarjetas todavía.</p>'}</div>
        <button class="sec" data-action="addCard" data-tema="${t.id}" data-mat="${t.materiaId}">+ Agregar tarjeta</button>
      </div>
    </div>
  </details>`;
}
function secBlock(temaId,sc){
  return `<details class="secAcc" data-sec="${sc.id}" ${ui.sec[sc.id]?'open':''}>
    <summary><span class="sn"><b class="st">${esc(sc.title)||'(sección sin título)'}</b><small class="sp">${esc(prevSec(sc.body))}</small></span></summary>
    <div class="b">
      <div class="secRead">${secReadHTML(sc)}</div>
      <div class="secEdit">
        <label class="lbl">Título de la sección</label>
        <input class="fld" data-action="editSecTitle" data-id="${temaId}" data-sid="${sc.id}" value="${esc(sc.title)}" placeholder="Título de la sección">
        <label class="lbl">Contenido</label>
        <textarea class="fld" data-action="editSecBody" data-id="${temaId}" data-sid="${sc.id}" placeholder="Contenido de la sección…">${esc(sc.body)}</textarea>
        <label class="lbl">Relación con otras ideas (opcional)</label>
        <textarea class="fld" data-action="editSecRel" data-id="${temaId}" data-sid="${sc.id}" placeholder="Cómo se conecta esta sección con otras del tema…">${esc(sc.rel||'')}</textarea>
        <label class="lbl">Ideas clave (una por línea, alimentan el esquema)</label>
        <textarea class="fld" data-action="editSecPuntos" data-id="${temaId}" data-sid="${sc.id}" placeholder="Una idea corta por línea…">${esc(ideasTexto(sc))}</textarea>
        <small class="meta">Opcional: empieza la línea con [def], [car] o [ej] para ubicarla como definición, característica o ejemplo en el esquema matricial.</small>
      </div>
      <div class="secFoot">
        <button class="sec" data-action="editSec" data-id="${temaId}" data-sid="${sc.id}"><span class="lbRead">✏️ Editar</span><span class="lbEdit">✓ Listo</span></button>
        <button class="sec" data-action="delSec" data-id="${temaId}" data-sid="${sc.id}">🗑️ Eliminar</button>
      </div>
    </div>
  </details>`;
}
function cardRow(c){
  return `<div class="cardRow" data-card="${c.id}">
    <span class="cl">Frente</span><textarea class="fld sm cf" rows="1" data-action="editCardFront" data-id="${c.id}" placeholder="Frente (término / pregunta)">${esc(c.front)}</textarea>
    <span class="cl">Reverso</span><textarea class="fld sm cb" rows="1" data-action="editCardBack" data-id="${c.id}" placeholder="Reverso (definición / respuesta)">${esc(c.back)}</textarea>
    <button class="icon-btn" data-action="delCard" data-id="${c.id}" title="Eliminar tarjeta">🗑️</button>
  </div>`;
}
/* ================= HERRAMIENTAS DE ESTUDIO ================= */
function shuffle(arr){const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function getCards(materiaId){return state.cards.filter(c=>c.materiaId===materiaId && c.front.trim() && c.back.trim())}
function fmtSecs(s){s=Math.max(0,s);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}
function relTime(ts){
  const d=Math.round((Date.now()-ts)/864e5);
  if(d<=0)return'hoy';if(d===1)return'ayer';if(d<30)return`hace ${d} días`;
  const mo=Math.round(d/30);return mo===1?'hace 1 mes':`hace ${mo} meses`;
}
function noCardsMsg(){return'<div class="empty">Esta materia todavía no tiene tarjetas con frente y reverso completos. Agregá algunas desde sus temas.</div>'}

/* ---------- Quiz y Modo examen por corte ----------
   Solo se usan las tarjetas de los temas (documentos) del corte elegido, dentro de la misma materia.
   Las opciones incorrectas salen del mismo corte. Si el corte no tiene material suficiente, se avisa
   y NO se recurre a otros cortes ni a otras materias. */
const MIN_MATERIAL=4;   // respuestas distintas necesarias para armar preguntas de 4 opciones
function tarjetasDelCorte(materiaId,corteId){
  const tids=new Set(state.temas.filter(x=>x.materiaId===materiaId&&x.corteId===corteId).map(x=>x.id));
  return state.cards.filter(c=>c.materiaId===materiaId&&tids.has(c.temaId)&&String(c.front||'').trim()&&String(c.back||'').trim());
}
/* ---------- Preguntas: opción múltiple, verdadero/falso y completar ---------- */
const limpioT=s=>String(s==null?'':s).trim();
/* 3 opciones incorrectas: primero las que escribió la IA para esa tarjeta; si faltan, respuestas de otras tarjetas del mismo grupo (corte) */
function distractoresDe(c,pool){
  const correcta=limpioT(c.back);
  const ia=[...new Set((c.dist||[]).map(limpioT).filter(x=>x&&x!==correcta))];
  if(ia.length>=3)return shuffle(ia).slice(0,3);
  const otros=[...new Map((pool||[]).filter(x=>limpioT(x.back)&&limpioT(x.back)!==correcta).map(x=>[limpioT(x.back),limpioT(x.back)])).values()].filter(x=>!ia.includes(x));
  const todos=ia.concat(shuffle(otros));
  return todos.length>=3?todos.slice(0,3):null;
}
function tipoPara(c,tipos){
  if(tipos==='mc')return 'mc';
  const op=['mc','mc'];                                                                     // la opción múltiple pesa más
  if(limpioT(c.falsa)&&limpioT(c.falsa)!==limpioT(c.back))op.push('vf');
  if(c.hueco&&limpioT(c.hueco.r)&&String(c.hueco.o||'').includes('____'))op.push('hueco');
  return op[Math.floor(Math.random()*op.length)];
}
function preguntaDe(c,d,tipos){
  const tipo=tipoPara(c,tipos);
  if(tipo==='vf'){const v=Math.random()<0.5;return{card:c,tipo,enun:c.front,afirm:v?c.back:c.falsa,correcta:v?'Verdadero':'Falso',options:['Verdadero','Falso'],selected:null}}
  if(tipo==='hueco')return{card:c,tipo,enun:c.hueco.o,correcta:c.hueco.r,options:[],selected:null};
  return{card:c,tipo:'mc',enun:c.front,correcta:c.back,options:shuffle([c.back,...d]),selected:null};
}
function armarPreguntas(cards,n,opts){
  opts=opts||{};
  const validas=cards.filter(c=>limpioT(c.front)&&limpioT(c.back));
  const poolDe=opts.poolDe||(()=>validas);
  const lista=[];
  shuffle(validas).forEach(c=>{const d=distractoresDe(c,poolDe(c));if(d)lista.push(preguntaDe(c,d,opts.tipos))});
  if(!lista.length)return null;
  return n>0?lista.slice(0,n):lista;
}
/* Completar: se acepta sin tildes, mayúsculas ni signos, y con un error de tipeo en palabras largas */
const normTxt=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
function distLev(a,b){
  const m=a.length,n=b.length;if(!m)return n;if(!n)return m;
  let prev=Array.from({length:n+1},(_,j)=>j);
  for(let i=1;i<=m;i++){const cur=[i];for(let j=1;j<=n;j++)cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur}
  return prev[n];
}
function respuestaHuecoOk(dada,correcta){
  const a=normTxt(dada),b=normTxt(correcta);
  if(!a||!b)return false;
  if(a===b)return true;
  return distLev(a,b)<=(b.length>=9?2:b.length>=5?1:0);
}
const esAcierto=q=>q.tipo==='hueco'?respuestaHuecoOk(q.selected,q.correcta):q.selected===q.correcta;
function quizCfgDe(materiaId,tool){
  ui.quizCfg=ui.quizCfg||{};
  const cortes=state.cortes.filter(c=>c.materiaId===materiaId);
  const cfg=ui.quizCfg[materiaId]=ui.quizCfg[materiaId]||{};
  if(!cortes.some(c=>c.id===cfg.corteId)){
    const conMaterial=cortes.find(c=>tarjetasDelCorte(materiaId,c.id).length);
    cfg.corteId=((conMaterial||cortes[0])||{}).id||null;
  }
  cfg.n=cfg.n||{};
  if(cfg.n[tool]==null)cfg.n[tool]=tool==='quiz'?10:0;   // 0 = todas las tarjetas del corte
  if(!cfg.tipos)cfg.tipos='mixto';                       // mixto = opción múltiple + verdadero/falso + completar
  return{corteId:cfg.corteId,n:cfg.n[tool],tipos:cfg.tipos};
}
function comenzarQuiz(){
  if(!toolState||!toolState.setup)return;
  const materiaId=route.materiaId,corteId=toolState.corteId;
  const cards=tarjetasDelCorte(materiaId,corteId);
  const questions=armarPreguntas(cards,toolState.n,{tipos:toolState.tipos});
  if(!questions){toolState.error='No hay suficiente material en este corte para armar el examen.';render(true);return}
  ui.quizCfg[materiaId].corteId=corteId;
  toolState={questions,idx:0,score:0,corteId};
  render();
}
function quizSetupHTML(isExam){
  const m=state.materias.find(x=>x.id===route.materiaId);
  const cortes=state.cortes.filter(c=>c.materiaId===m.id);
  const cards=tarjetasDelCorte(m.id,toolState.corteId);
  const distintas=new Set(cards.map(c=>String(c.back).trim())).size;
  const temas=state.temas.filter(x=>x.materiaId===m.id&&x.corteId===toolState.corteId);
  const hay=distintas>=MIN_MATERIAL;
  const dh=progresoHoy(),hoyN=state.progress.days.includes(fechaLocal(new Date()))?Math.max(dh.racha,META_RACHA):dh.racha;
  const opcionesN=[10,20,30,50].filter(x=>x<cards.length);
  const cuenta=c=>tarjetasDelCorte(m.id,c.id).length;
  return `<div class="viewhead"><h1>${isExam?'📝 Modo examen':'❓ Quiz'}</h1></div>
  <div class="card quizSetup">
    <label class="lbl" for="quizCorte" style="margin-top:0">¿De qué corte quieres que sea?</label>
    <select class="fld" id="quizCorte" data-action="quizCorte">${cortes.map(c=>`<option value="${c.id}" ${c.id===toolState.corteId?'selected':''}>${esc(c.name)||'(corte sin nombre)'} · ${cuenta(c)} tarjeta${cuenta(c)==1?'':'s'}</option>`).join('')}</select>
    <p class="meta" style="margin:8px 0 0">${temas.length?`Solo se usan los documentos de este corte (${temas.length}): ${temas.slice(0,4).map(x=>esc(x.title)||'sin título').join(', ')}${temas.length>4?'…':''}. No se mezclan otros cortes ni otras materias.`:'Este corte todavía no tiene documentos.'}</p>
    ${hay?'':`<div class="fb fbNo" role="alert">No hay suficiente material en este corte: tiene ${distintas} tarjeta${distintas==1?'':'s'} con respuestas distintas y se necesitan al menos ${MIN_MATERIAL}. Sube más documentos a este corte o elige otro; no se usarán documentos de otros cortes.</div>`}
    ${toolState.error&&hay?`<div class="fb fbNo" role="alert">${esc(toolState.error)}</div>`:''}
    <label class="lbl" for="quizN">Número de preguntas</label>
    <select class="fld" id="quizN" data-action="quizN">${opcionesN.map(x=>`<option value="${x}" ${toolState.n===x?'selected':''}>${x}</option>`).join('')}<option value="0" ${toolState.n===0||toolState.n>=cards.length?'selected':''}>Todas (${cards.length})</option></select>
    <label class="lbl" for="quizTipos">Tipos de pregunta</label>
    <select class="fld" id="quizTipos" data-action="quizTipos"><option value="mixto" ${toolState.tipos!=='mc'?'selected':''}>Variadas: opción múltiple, verdadero/falso y completar</option><option value="mc" ${toolState.tipos==='mc'?'selected':''}>Solo opción múltiple</option></select>
    <div class="premio" style="margin-top:14px"><b>🔥 Racha de hoy: ${hoyN}/${META_RACHA} preguntas</b>
      <div class="bar"><i style="width:${Math.min(100,Math.round(hoyN/META_RACHA*100))}%"></i></div>
      <p class="meta" style="margin:6px 0 0">Las primeras ${META_RACHA} preguntas del día aseguran tu racha. Las demás cuentan como práctica extra: puedes hacer todas las que quieras y quedan en tu historial.</p></div>
    <button class="pr nextBtn" data-action="quizStart" ${hay?'':'disabled'} style="margin-top:14px">Comenzar</button>
  </div>`;
}

/* ---------- Repaso espaciado (Leitner) ----------
   Cada tarjeta vive en una caja del 1 al 5. Si la aciertas cuando te tocaba, sube de caja y tarda más en volver
   (1, 2, 4, 8 y 16 días). Si la fallas, vuelve a la caja 1 y regresa mañana. Practicar fuera de turno no sube de caja. */
const LEITNER=[0,1,2,4,8,16];
const hoyStr=()=>fechaLocal(new Date());
function sumarDias(f,n){const d=new Date(f+'T00:00');d.setDate(d.getDate()+n);return fechaLocal(d)}
function tarjetaPendiente(c,hoy){return !c.due||c.due<=(hoy||hoyStr())}
function repasarTarjeta(c,acierto){
  const hoy=hoyStr(),pendiente=tarjetaPendiente(c,hoy);
  c.lastOk=!!acierto;c.last=hoy;
  if(!acierto){c.box=1;c.due=sumarDias(hoy,1);c.fails=(c.fails||0)+1;return}
  if(pendiente){c.box=Math.min(5,(c.box||0)+1);c.due=sumarDias(hoy,LEITNER[c.box])}
}
/* Sesión de hoy: primero las vencidas (las más atrasadas antes) y luego unas pocas nuevas, hasta 20 en total */
function sesionHoy(materiaId,max){
  max=max||20;
  const hoy=hoyStr(),cs=getCards(materiaId);
  const vencidas=cs.filter(c=>c.due&&c.due<=hoy).sort((a,b)=>a.due.localeCompare(b.due)||(a.box||0)-(b.box||0));
  const nuevas=cs.filter(c=>!c.due);
  return vencidas.concat(nuevas.slice(0,Math.max(0,Math.min(10,max-vencidas.length)))).slice(0,max);
}
function proximoRepasoTexto(materiaId){
  const hoy=hoyStr(),f=getCards(materiaId).filter(c=>c.due&&c.due>hoy).map(c=>c.due).sort();
  if(!f.length)return 'Practica con flashcards o quiz y Auren programará tus repasos.';
  const n=f.filter(x=>x===f[0]).length;
  return 'El próximo repaso es '+relDate(f[0])+' ('+n+' tarjeta'+(n==1?'':'s')+').';
}
function hoyVacioHTML(){return `<div class="empty"><h2>🎉 Nada pendiente por hoy</h2><p>${esc(proximoRepasoTexto(route.materiaId))}</p></div>`}
function repasoHoyHTML(){
  if(esProfesor())return '';
  const filas=state.materias.filter(m=>m.rol!=='docente').map(m=>({m,n:sesionHoy(m.id).length})).filter(x=>x.n>0);
  if(!filas.length)return '';
  const total=filas.reduce((s,x)=>s+x.n,0);
  return `<div class="card shareBox repasoHoy"><b>📅 Para repasar hoy: ${total} tarjeta${total==1?'':'s'}</b><p class="meta" style="margin:4px 0 8px">Según tus repasos anteriores, hoy te toca ver estas para que no se te olviden.</p>${filas.map(x=>`<div class="li"><span>${esc(x.m.icon)} ${esc(x.m.name)} <small class="meta">· ${x.n}</small></span><button class="sec" data-action="openTool" data-tool="hoy" data-mat="${x.m.id}">Repasar</button></div>`).join('')}</div>`;
}
/* ---------- Repasar lo que fallé ---------- */
const tarjetasFalladas=materiaId=>getCards(materiaId).filter(c=>c.lastOk===false);
async function fallosDeExamenes(m){
  const sid=m.sharedId;if(!sid)return[];
  const porTema={};
  for(const ex of examenesDe(m).filter(x=>miIntento(m,x.id))){
    await asegurarClave(m,ex.id);
    const cl=(clMap[sid]||{})[ex.id];if(!cl)continue;
    calificar(ex,cl,(miIntento(m,ex.id)||{}).respuestas||{}).det.forEach(d=>{
      const k=d.q.temaId;if(!k||!state.temas.some(t=>t.id===k))return;
      const t=porTema[k]=porTema[k]||{temaId:k,titulo:d.q.temaTitulo||'',n:0,mal:0};
      t.n++;if(!d.acierto)t.mal++;
    });
  }
  return Object.values(porTema).filter(t=>t.mal>0).sort((x,y)=>y.mal/y.n-x.mal/x.n||y.mal-x.mal);
}
async function cargarFallosExamenes(materiaId){
  const m=state.materias.find(x=>x.id===materiaId);
  let lista=[];
  if(m&&m.rol==='estudiante'){try{lista=await fallosDeExamenes(m)}catch(e){console.warn('Fallos de exámenes:',e)}}
  if(toolState&&toolState.setup&&route.tool==='falle'&&route.materiaId===materiaId){toolState.temasEx=lista;render(true)}
}
function falleSetupHTML(m){
  const falladas=tarjetasFalladas(m.id),ex=toolState.temasEx;
  return `<div class="viewhead"><h1>🎯 Repasar lo que fallé</h1></div>
  <div class="card"><b>Tarjetas que fallaste</b>
    <p class="meta">${falladas.length?'Tienes <b>'+falladas.length+'</b> tarjeta'+(falladas.length==1?'':'s')+' que fallaste la última vez. Cuando las aciertes salen de esta lista.':'No tienes tarjetas falladas ahora mismo. Cuando falles alguna en un quiz o en flashcards aparecerá aquí.'}</p>
    <button class="pr" data-action="falleStart" data-modo="tarjetas" ${falladas.length?'':'disabled'}>Practicar las que fallé</button></div>
  ${m.rol==='estudiante'?`<div class="card" style="margin-top:12px"><b>Temas donde más fallaste en los exámenes de tu profesor</b>
    ${ex===null||ex===undefined?'<p class="meta">Calculando…</p>':ex.length?ex.map(t=>`<div class="li"><span>${esc(t.titulo||'Tema')}<br><small class="meta">Fallaste ${t.mal} de ${t.n} (${Math.round(t.mal/t.n*100)} %)</small></span><button class="sec" data-action="falleStart" data-modo="tema" data-tema="${t.temaId}">Practicar</button></div>`).join(''):'<p class="meta">Todavía no hay fallos en exámenes que hayas entregado.</p>'}</div>`:''}
  ${toolState.error?`<div class="fb fbNo" role="alert">${esc(toolState.error)}</div>`:''}`;
}
function comenzarFalle(modo,temaId){
  if(!toolState||!toolState.setup||route.tool!=='falle')return;
  const mid=route.materiaId;
  const objetivos=modo==='tema'?state.cards.filter(c=>c.materiaId===mid&&c.temaId===temaId):tarjetasFalladas(mid);
  const poolDe=c=>{const t=state.temas.find(x=>x.id===c.temaId);return t?tarjetasDelCorte(mid,t.corteId):[c]};   // opciones solo del mismo corte
  const qs=armarPreguntas(objetivos,20,{poolDe,tipos:'mixto'});
  if(!qs){toolState.error='No hay suficiente material en el corte de esas tarjetas para armar preguntas (hacen falta respuestas de otras tarjetas del mismo corte).';render();return}
  toolState={questions:qs,idx:0,score:0,corteId:null};
  render();
}

function startTool(tool,materiaId){
  clearRepasoTimer();
  const cards=getCards(materiaId);
  if(tool==='flashcards'||tool==='memorizar'||tool==='repaso'||tool==='concepto'){
    toolState={cards:shuffle(cards),idx:0,flipped:false,known:0,seen:0};
  }else if(tool==='quiz'||tool==='examen'){
    /* El examen se arma con UN corte elegido (ver comenzarQuiz): nunca mezcla cortes ni materias */
    const cfg=quizCfgDe(materiaId,tool);
    toolState={setup:true,corteId:cfg.corteId,n:cfg.n,tipos:cfg.tipos,error:''};
  }else if(tool==='hoy'){
    toolState={cards:sesionHoy(materiaId),idx:0,flipped:false,known:0,seen:0};
  }else if(tool==='falle'){
    toolState={setup:true,error:'',temasEx:null};
  }else if(tool==='comparar'){
    const other=state.materias.find(m=>m.id!==materiaId);
    toolState={materiaId2:other?other.id:null};
  }else{
    toolState={};
  }
  route={view:'tool',tool,materiaId};
  render();
  if(tool==='falle')cargarFallosExamenes(materiaId);
  if(tool==='repaso'){
    toolState.secondsLeft=300;
    repasoTimer=setInterval(()=>{
      toolState.secondsLeft--;
      const el=$('repasoTimerText');
      if(el)el.textContent=fmtSecs(toolState.secondsLeft);
      if(toolState.secondsLeft<=0){clearRepasoTimer();render();}
    },1000);
  }
}

function viewToolHTML(){
  const{tool,materiaId}=route;
  const m=state.materias.find(x=>x.id===materiaId);
  if(!m){goToView('materias');return'';}
  const head=`<button class="sec" data-action="backMateria" data-id="${materiaId}">← ${esc(m.icon)} ${esc(m.name)}</button><div style="margin-top:14px"></div>`;
  let body='';
  if(tool==='flashcards')body=toolFlashcardsHTML();
  else if(tool==='hoy')body=toolFlashcardsHTML('📅 Repaso de hoy');
  else if(tool==='falle')body=toolState.setup?falleSetupHTML(m):toolQuizHTML(false);
  else if(tool==='memorizar')body=toolMemorizarHTML(m);
  else if(tool==='quiz')body=toolQuizHTML(false);
  else if(tool==='examen')body=toolQuizHTML(true);
  else if(tool==='concepto')body=toolConceptoHTML();
  else if(tool==='repaso')body=toolRepasoHTML();
  else if(tool==='comparar')body=toolCompararHTML(m);
  else if(tool==='progreso')body=toolProgresoHTML(m);
  else if(tool==='referencias')body=toolReferenciasHTML(m);
  return head+body;
}

function toolFlashcardsHTML(titulo){
  const esHoy=route.tool==='hoy';
  const{cards,idx,flipped,known,seen}=toolState;
  if(!cards.length)return esHoy?hoyVacioHTML():noCardsMsg();
  if(idx>=cards.length)return `<div class="empty"><h2>🎉 ¡Terminaste!</h2><p>Sabías ${known} de ${seen} tarjetas.</p>${esHoy?`<p class="meta">${esc(proximoRepasoTexto(route.materiaId))}</p>`:''}<button class="pr" data-action="redoTool">${esHoy?'Ver si queda algo por hoy':'Repetir'}</button></div>`;
  const c=cards[idx];
  return `
  <div class="viewhead"><h1>${titulo||'🔄 Flashcards'}</h1><span class="meta">${idx+1} / ${cards.length}</span></div>
  ${esHoy?`<div class="chips" style="margin:-4px 0 8px"><span class="chip">${c.box?'Caja '+c.box+' de 5':'Nueva'}</span></div>`:''}
  <div class="flashcard ${flipped?'flip':''}" data-action="flipCard">
    <div class="fcInner"><div class="fcFace fcFront">${esc(c.front)}</div><div class="fcFace fcBack">${esc(c.back)}</div></div>
  </div>
  <p class="meta" style="text-align:center">Tocá la tarjeta para voltear</p>
  <div class="row" style="justify-content:center">
    <button class="sec" data-action="cardAnswer" data-know="0">😕 Repasar</button>
    <button class="pr" data-action="cardAnswer" data-know="1">😊 La sé</button>
  </div>`;
}

function toolMemorizarHTML(m){
  const cards=getCards(m.id);
  if(!cards.length)return noCardsMsg();
  return `<div class="viewhead"><h1>📖 Memorizar</h1></div>
  <p class="meta">Repasá todas las tarjetas de un vistazo, sin apuros.</p>
  ${cards.map(c=>`<div class="card"><b>${esc(c.front)}</b><p class="meta" style="margin:6px 0 0">${esc(c.back)}</p></div>`).join('')}`;
}

function toolConceptoHTML(){
  const{cards,idx,flipped}=toolState;
  if(!cards.length)return noCardsMsg();
  if(idx>=cards.length)return `<div class="empty"><h2>🎉 ¡Listo!</h2><p>Repasaste ${cards.length} conceptos.</p><button class="pr" data-action="redoTool">Repetir</button></div>`;
  const c=cards[idx];
  return `
  <div class="viewhead"><h1>💡 ¿Qué concepto?</h1><span class="meta">${idx+1} / ${cards.length}</span></div>
  <div class="card">
    <p class="meta">Definición / pista:</p>
    <h3>${esc(c.back)}</h3>
    ${flipped?`<hr style="border-color:var(--b);margin:12px 0"><p class="meta">Concepto:</p><h3>${esc(c.front)}</h3>`:`<button class="sec" data-action="flipCard">Mostrar respuesta</button>`}
  </div>
  ${flipped?`<div class="row" style="justify-content:center"><button class="sec" data-action="cardAnswer" data-know="0">😕 Fallé</button><button class="pr" data-action="cardAnswer" data-know="1">😊 Acerté</button></div>`:''}`;
}

function toolRepasoHTML(){
  const{cards,idx,flipped,secondsLeft,known,seen}=toolState;
  if(!cards.length)return noCardsMsg();
  if(secondsLeft<=0)return `<div class="empty"><h2>⏱️ ¡Tiempo!</h2><p>Repasaste ${seen} tarjetas, sabías ${known}.</p><button class="pr" data-action="redoTool">Repetir</button></div>`;
  const c=cards[idx%cards.length];
  return `
  <div class="viewhead"><h1>⏱️ Repaso 5 min</h1><span class="meta" id="repasoTimerText">${fmtSecs(secondsLeft)}</span></div>
  <div class="flashcard ${flipped?'flip':''}" data-action="flipCard">
    <div class="fcInner"><div class="fcFace fcFront">${esc(c.front)}</div><div class="fcFace fcBack">${esc(c.back)}</div></div>
  </div>
  <p class="meta" style="text-align:center">Tocá para voltear</p>
  <div class="row" style="justify-content:center">
    <button class="sec" data-action="cardAnswer" data-know="0">😕 Repasar</button>
    <button class="pr" data-action="cardAnswer" data-know="1">😊 La sé</button>
  </div>`;
}

function enunciadoHTML(q){
  if(q.tipo==='vf')return `${esc(q.enun)}<br><span class="vfAfirm">«${esc(q.afirm)}»</span><br><small class="meta">¿Verdadero o falso?</small>`;
  if(q.tipo==='hueco')return 'Completa:<br>'+esc(q.enun).replace('____','<span class="hueco">____</span>');
  return esc(q.enun);
}
function huecoHTML(q,instante,contesto,acierto){
  if(!contesto)return `<input class="fld" id="huecoInput" autocomplete="off" autocapitalize="off" placeholder="Escribe la palabra o frase que falta" maxlength="80"><button class="pr" data-action="answerHueco" style="margin-top:8px">Comprobar</button>`;
  return `<div class="sec optBtn ${instante?(acierto?'ok pop':'no shake'):'chosen'}" style="cursor:default">${esc(q.selected)}</div>${instante&&!acierto?`<p class="meta" style="margin:6px 0 0">Respuesta esperada: <b>${esc(q.correcta)}</b></p>`:''}`;
}
function corteChipHTML(){
  const c=state.cortes.find(x=>x.id===toolState.corteId);
  return c?`<div class="chips" style="margin:-4px 0 8px"><span class="chip">📁 ${esc(c.name)||'(corte sin nombre)'}</span></div>`:'';
}
function toolQuizHTML(isExam){
  if(toolState.setup)return quizSetupHTML(isExam);
  const{questions,idx,score}=toolState;
  if(!questions.length)return'<div class="empty">Necesitás al menos 2 tarjetas con frente y reverso en esta materia para generar preguntas.</div>';
  const instante=!isExam||examInstantaneo;     // el quiz siempre muestra la respuesta; el examen solo si se activa
  if(idx>=questions.length){
    const pct=Math.round(score/questions.length*100);
    const tono=pct>=70?'alto':pct>=40?'medio':'bajo';
    const msg=pct===100?'¡Perfecto! 🤩':pct>=70?'¡Excelente trabajo! 🎉':pct>=40?'Vas bien, un repaso más y lo logras 💪':'Cada intento cuenta. ¡Repasa y vuelve a probar! 🌱';
    return `<div class="empty resultado">
    <h2>${isExam?'📝':'❓'} ¡Listo!</h2>
    <div class="ringWrap ${tono}"><svg class="ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="rbg" cx="60" cy="60" r="52"/><circle class="rfg" cx="60" cy="60" r="52" style="--p:${pct}"/></svg>
      <div class="ringTxt"><b class="countUp" data-to="${score}">${score}</b><span>/ ${questions.length}</span></div></div>
    <p class="resMsg">${msg}</p>
    <p class="meta">Resultado: <b>${score} / ${questions.length}</b> · ${pct}%${(state.cortes.find(x=>x.id===toolState.corteId)||{}).name?' · '+esc(state.cortes.find(x=>x.id===toolState.corteId).name):''}</p>
    ${premiosHTML()}
    ${isExam?`<div class="resList">${questions.map((q,i)=>`<p class="meta resRow ${esAcierto(q)?'bien':'mal'}" style="--i:${Math.min(i,14)}">${i+1}. ${esc(q.enun)}${q.tipo==='vf'?' «'+esc(q.afirm)+'»':''} — ${esAcierto(q)?'✅':'❌ correcta: '+esc(q.correcta)}</p>`).join('')}</div>`:''}
    <button class="pr" data-action="redoTool">Repetir</button></div>`;
  }
  const q=questions[idx];
  const contesto=!!q.selected,acierto=contesto&&esAcierto(q);
  const prog0=Math.round(idx/questions.length*100),prog1=Math.round((idx+(contesto?1:0))/questions.length*100);
  const combo=toolState.combo||0;
  return `
  <div class="viewhead"><h1>${isExam?'📝 Modo examen':'❓ Quiz'}</h1><span class="meta">${idx+1} / ${questions.length}</span></div>
  ${corteChipHTML()}
  <div class="bar qbar"><i style="width:${prog1}%;--from:${prog0}%"></i></div>
  ${isExam?`<button type="button" class="toggleChip ${examInstantaneo?'on':''}" data-action="toggleInstante" ${contesto?'disabled':''}>⚡ Ver si acerté al instante: ${examInstantaneo?'Sí':'No'}</button>`:''}
  ${instante&&combo>=2?`<div class="comboChip">🔥 ${combo} seguidas</div>`:''}
  <div class="card qCard ${contesto?'answered':''}"><h3 style="margin-top:0">${enunciadoHTML(q)}</h3>
    ${q.tipo==='hueco'?huecoHTML(q,instante,contesto,acierto):q.options.map(o=>{
      let cls='sec optBtn';
      if(instante&&contesto){
        if(o===q.correcta)cls+=' ok '+(acierto?'pop':'reveal');
        else if(o===q.selected)cls+=' no shake';
      }else if(!instante&&o===q.selected){
        cls+=' chosen picked';
      }
      return `<button class="${cls}" data-action="answerQuiz" data-opt="${esc(o)}" ${contesto?'disabled':''}>${esc(o)}</button>`;
    }).join('')}
  </div>
  ${instante&&contesto?feedbackHTML(acierto,q,idx):''}
  ${contesto?`<button class="pr nextBtn" data-action="nextQuestion">${idx+1>=questions.length?'Ver resultado →':'Siguiente →'}</button>`:''}`;
}

function toolCompararHTML(m){
  const others=state.materias.filter(x=>x.id!==m.id);
  if(!others.length)return'<div class="empty">Necesitás al menos 2 materias para comparar.</div>';
  if(!toolState.materiaId2)toolState.materiaId2=others[0].id;
  const m2=state.materias.find(x=>x.id===toolState.materiaId2)||others[0];
  const c1=getCards(m.id),c2=getCards(m2.id);
  return `
  <div class="viewhead"><h1>⚖️ Comparar</h1></div>
  <label class="lbl">Comparar con:</label>
  <select class="fld" data-action="setCompareMateria" style="max-width:280px">
    ${others.map(o=>`<option value="${o.id}" ${o.id===m2.id?'selected':''}>${esc(o.icon)} ${esc(o.name)}</option>`).join('')}
  </select>
  <div class="two" style="margin-top:14px">
    <div class="card"><h3 style="margin-top:0">${esc(m.icon)} ${esc(m.name)}</h3>${c1.map(c=>`<p class="meta"><b style="color:var(--t)">${esc(c.front)}:</b> ${esc(c.back)}</p>`).join('')||'<p class="meta">Sin tarjetas.</p>'}</div>
    <div class="card"><h3 style="margin-top:0">${esc(m2.icon)} ${esc(m2.name)}</h3>${c2.map(c=>`<p class="meta"><b style="color:var(--t)">${esc(c.front)}:</b> ${esc(c.back)}</p>`).join('')||'<p class="meta">Sin tarjetas.</p>'}</div>
  </div>`;
}

function toolProgresoHTML(m){
  const cards=getCards(m.id);
  const known=cards.filter(c=>c.known===true).length;
  const attempts=state.attempts.filter(a=>a.materiaId===m.id).sort((a,b)=>b.date-a.date).slice(0,15);
  const pct=cards.length?Math.round(known/cards.length*100):0;
  return `
  <div class="viewhead"><h1>📊 Mi progreso</h1></div>
  <div class="card">
    <p class="meta" style="margin-top:0">Tarjetas dominadas</p>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <p class="meta">${known} / ${cards.length} (${pct}%)</p>
  </div>
  <h3>Historial de quiz y exámenes</h3>
  ${attempts.length?attempts.map(a=>`<div class="li"><span>${a.type==='examen'?'📝':'❓'} ${a.score}/${a.total}${(state.cortes.find(c=>c.id===a.corteId)||{}).name?' · '+esc(state.cortes.find(c=>c.id===a.corteId).name):''}${a.extra?` <small class="meta">(${a.extra} de práctica extra)</small>`:''}</span><small>${relTime(a.date)}</small></div>`).join(''):'<p class="meta">Todavía no hiciste ningún quiz o examen en esta materia.</p>'}`;
}

function toolReferenciasHTML(m){
  return `
  <div class="viewhead"><h1>📚 Referencias</h1></div>
  <p class="meta">Guardá acá tu bibliografía o fuentes de esta materia.</p>
  <textarea class="fld" style="min-height:220px" data-action="editMateriaRefs" data-id="${m.id}" placeholder="Ej: Papalia, D. (2012). Desarrollo humano...">${esc(m.refs||'')}</textarea>`;
}

/* ================= VISTA: CALENDARIO ================= */
function viewCalendarioHTML(){
  const{y,m}=calView;
  const monthNames=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const first=new Date(y,m,1),startOff=(first.getDay()+6)%7,daysInMonth=new Date(y,m+1,0).getDate();
  const todayStr=ymd(new Date());
  const todosEv=eventosTodos();
  const evByDate={};todosEv.forEach(e=>{(evByDate[e.date]=evByDate[e.date]||[]).push(e)});
  let cells='';
  for(let i=0;i<startOff;i++)cells+='<div class="dcell empty"></div>';
  for(let d=1;d<=daysInMonth;d++){
    const ds=ymd(new Date(y,m,d));
    const has=evByDate[ds];
    cells+=`<button class="dcell ${ds===todayStr?'today':''} ${ds===calView.sel?'sel':''}" data-action="selDay" data-date="${ds}">${d}${has?(has.some(x=>!x.docente)?'<i class="dot"></i>':'')+(has.some(x=>x.docente)?'<i class="dot doc"></i>':''):''}</button>`;
  }
  const sel=calView.sel;
  const selEvents=sel?(evByDate[sel]||[]).slice().sort(sortEv):[];
  const soyDoc=state.materias.some(x=>x.rol==='docente'&&x.sharedId);
  const upcoming=todosEv.filter(e=>e.date>=todayStr).sort(sortEv).slice(0,8);
  return `
    <div class="viewhead"><h1>🗓️ Calendario</h1></div>
    <div class="calNav">
      <button class="icon-btn" data-action="calPrev">‹</button>
      <b>${monthNames[m]} ${y}</b>
      <button class="icon-btn" data-action="calNext">›</button>
    </div>
    <div class="calGrid">${['L','M','X','J','V','S','D'].map(x=>`<i class="dh">${x}</i>`).join('')}${cells}</div>
    ${sel?`<div class="card">
      <h3>${fmtDateLong(sel)}</h3>
      ${selEvents.length?selEvents.map(e=>e.docente?evDocFilaHTML(e,true):`<div class="li"><span>${TY[e.type]||'📌'} ${esc(e.title)}</span><button class="icon-btn" data-action="delEvent" data-id="${e.id}">🗑️</button></div>`).join(''):'<p class="meta">Sin eventos este día.</p>'}
      <div class="row" style="margin-top:10px;flex-wrap:wrap"><button class="sec" data-action="addEvent" data-date="${sel}">+ Agregar evento</button>${soyDoc?`<button class="pr" data-action="newEvDocCal" data-date="${sel}">👩‍🏫 Evento para mis estudiantes</button>`:''}</div>
    </div>`:'<p class="meta">Toca un día para ver o agregar eventos.</p>'}
    <h3>Próximos</h3>
    ${upcoming.length?upcoming.map(e=>`<div class="li"><span><b>${e.docente?tipoEv(e.type):(TY[e.type]||'📌')}</b> ${esc(e.title)}${e.hora?` · 🕒 ${esc(e.hora)}`:''}<br><small>${e.docente?esc(e.icon)+' '+esc(e.materia)+' · ':''}${fmtDateLong(e.date)} · ${relDate(e.date)}</small></span></div>`).join(''):'<p class="meta">No tienes eventos próximos.</p>'}
  `;
}

/* ================= VISTA: PERFIL ================= */
function viewPerfilHTML(){
  const p=state.profile;
  const avgsAll=state.materias.filter(m=>m.rol!=='docente').map(m=>weightedAvg(state.cortes.filter(c=>c.materiaId===m.id))).filter(x=>x!=null);
  const globalAvg=avgsAll.length?(avgsAll.reduce((a,b)=>a+b,0)/avgsAll.length):null;
  return `
    <div class="viewhead"><h1>👤 Mi perfil</h1></div>
    <div class="card">
      <div class="pfhero"><div class="pfav">${esc(p.avatar)}</div><div><h2 style="margin:0">${esc(p.name)||(p.rol==='docente'?'Profesor':'Estudiante')}</h2><p class="meta" style="margin:2px 0 0">${esc(p.career)||'Agrega tu carrera y universidad'}</p></div></div>
      <div class="pgs">
        <div><b>${state.materias.filter(m=>m.rol!=='docente').length}</b>materias</div>
        <div><b>${state.temas.filter(t=>!esDocenteMat(t.materiaId)).length}</b>temas</div>
        <div><b>${globalAvg==null?'—':fmtN(globalAvg)}</b>promedio global</div>
      </div>
    </div>
    <div class="card"><h3>Avatar</h3><div class="avatarPicker">${AV.map(a=>`<button class="avBtn ${a===p.avatar?'on':''}" data-action="setAvatar" data-a="${a}">${a}</button>`).join('')}</div></div>
    ${avisosCardHTML()}
    <div class="card">
      <h3>Editar perfil</h3>
      <label class="lbl">Nombre</label><input class="fld" data-action="profileField" data-f="name" value="${esc(p.name)}" maxlength="40">
      <label class="lbl">Carrera y universidad</label><input class="fld" data-action="profileField" data-f="career" value="${esc(p.career)}" maxlength="80">
      <div class="two">
        <div><label class="lbl">Próximo examen</label><input class="fld" type="date" data-action="profileField" data-f="examDate" value="${p.examDate||''}"></div>
        <div><label class="lbl">Escala de notas</label><select class="fld" data-action="setScale">${[5,10,100].map(n=>`<option value="${n}" ${scaleMax()===n?'selected':''}>0 a ${n}</option>`).join('')}</select></div>
      </div>
      <div class="two">
        <div><label class="lbl">Meta de promedio (sobre ${scaleMax()})</label><input class="fld" type="number" min="0" max="${scaleMax()}" step="0.1" data-action="profileField" data-f="goal" value="${p.goal}"></div>
        <div></div>
      </div>
      <label class="lbl">Notas personales</label><textarea class="fld" data-action="profileField" data-f="notes" placeholder="Ideas, dudas, recordatorios…">${esc(p.notes)}</textarea>
    </div>
    <div class="card">
      <h3>Tipo de cuenta</h3>
      <p class="meta">Define si ves la sección Docente. Es una preferencia de tu cuenta: no se verifica ni cambia tus datos.</p>
      <div class="row"><button class="${p.rol==='estudiante'?'pr':'sec'}" data-action="setRol" data-rol="estudiante">🎓 Estudiante</button><button class="${p.rol==='docente'?'pr':'sec'}" data-action="setRol" data-rol="docente">👩‍🏫 Profesor</button></div>
    </div>
    <div class="card">
      <h3>Cuenta</h3>
      <p class="meta">Conectado como <b>${esc(auth.currentUser&&auth.currentUser.email||'')}</b></p>
      <button class="sec" data-action="logout">🚪 Cerrar sesión</button>
    </div>
  `;
}

/* ================= BÚSQUEDA ================= */
$('searchBox').addEventListener('input',e=>{
  const q=e.target.value.trim().toLowerCase();
  const box=$('searchResults');
  if(q.length<2){box.innerHTML='';return}
  const results=[];
  state.materias.forEach(m=>{if(m.name.toLowerCase().includes(q))results.push({label:`📘 ${m.name}`,materiaId:m.id})});
  state.temas.forEach(t=>{
    if((t.title||'').toLowerCase().includes(q)||(t.body||'').toLowerCase().includes(q)){
      const mat=state.materias.find(m=>m.id===t.materiaId);
      results.push({label:`📝 ${t.title||'(sin título)'} — ${mat?mat.name:''}`,materiaId:t.materiaId});
    }
  });
  box.innerHTML=results.slice(0,8).map((r,i)=>`<div data-r="${i}">${esc(r.label)}</div>`).join('');
  box.querySelectorAll('[data-r]').forEach((el,i)=>el.onclick=()=>{
    box.innerHTML='';$('searchBox').value='';
    route={view:'materiaDetail',materiaId:results[i].materiaId};
    document.querySelectorAll('#mainNav button').forEach(x=>x.classList.remove('on'));
    render();
  });
});
document.addEventListener('click',e=>{if(!e.target.closest('#searchWrap'))$('searchResults').innerHTML=''});

/* ================= ACCIONES (clicks) ================= */
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');if(!b)return;
  e.preventDefault();
  const a=b.dataset.action;

  if(a==='addSemester'){
    const name=prompt('Nombre del semestre (ej. Semestre 1, 2026-1):');
    if(name&&name.trim())mutate(s=>s.semesters.push({id:uid(),name:name.trim()}));
  }
  else if(a==='renameSemester'){
    const cur=state.semesters.find(x=>x.id===b.dataset.id);
    const name=prompt('Nuevo nombre del semestre:',cur?cur.name:'');
    if(name&&name.trim())mutate(s=>{const x=s.semesters.find(y=>y.id===b.dataset.id);if(x)x.name=name.trim()});
  }
  else if(a==='renameMateria'){
    const cur=state.materias.find(x=>x.id===b.dataset.id);
    const name=prompt('Nuevo nombre de la materia:',cur?cur.name:'');
    if(name&&name.trim()){
      const icon=prompt('Emoji (opcional):',cur?cur.icon:'📘')||(cur?cur.icon:'📘');
      mutate(s=>{const x=s.materias.find(y=>y.id===b.dataset.id);if(x){x.name=name.trim();x.icon=icon}});
    }
  }
  else if(a==='delSemester'){
    if(confirm('¿Eliminar este semestre y todas sus materias, temas y cortes? Esta acción no se puede deshacer.')){
      state.materias.filter(m=>m.semesterId===b.dataset.id&&m.sharedId).forEach(m=>abandonarCompartida(m,{silent:true}));
      mutate(s=>{
        const matIds=s.materias.filter(m=>m.semesterId===b.dataset.id).map(m=>m.id);
        s.materias=s.materias.filter(m=>m.semesterId!==b.dataset.id);
        s.temas=s.temas.filter(t=>!matIds.includes(t.materiaId));
        s.cortes=s.cortes.filter(c=>!matIds.includes(c.materiaId));
        s.cards=s.cards.filter(c=>!matIds.includes(c.materiaId));
        s.attempts=s.attempts.filter(x=>!matIds.includes(x.materiaId));
        s.semesters=s.semesters.filter(x=>x.id!==b.dataset.id);
      });
    }
  }
  else if(a==='addMateria'){
    const name=prompt('Nombre de la materia:');
    if(name&&name.trim()){
      const icon=prompt('Emoji para la materia (opcional):','📘')||'📘';
      mutate(s=>s.materias.push({id:uid(),name:name.trim(),icon,semesterId:b.dataset.sem,refs:''}));
    }
  }
  else if(a==='delMateria'){
    const msh=state.materias.find(x=>x.id===b.dataset.id);
    if(confirm(msh&&msh.rol==='docente'?'Vas a eliminar esta materia PARA TODOS: tus estudiantes dejarán de recibirla y se borrará el contenido de la nube (ellos conservan una copia local de lo que ya tenían). ¿Continuar?':msh&&msh.sharedId?'Esta materia es compartida: se eliminará de TU cuaderno y saldrás del grupo. Las demás personas conservan todo. ¿Continuar?':'¿Eliminar esta materia y todo su contenido (temas, tarjetas y cortes)? Esta acción no se puede deshacer.')){
      if(msh&&msh.sharedId)abandonarCompartida(msh,{silent:true,todos:msh.rol==='docente'});
      mutate(s=>{
        s.cards=s.cards.filter(c=>c.materiaId!==b.dataset.id);
        s.attempts=s.attempts.filter(x=>x.materiaId!==b.dataset.id);
        s.temas=s.temas.filter(t=>t.materiaId!==b.dataset.id);
        s.cortes=s.cortes.filter(c=>c.materiaId!==b.dataset.id);
        s.materias=s.materias.filter(m=>m.id!==b.dataset.id);
      });
    }
  }
  else if(a==='openMateria'){route={view:'materiaDetail',materiaId:b.dataset.id};render();}
  else if(a==='backMaterias')goToView('materias');
  else if(a==='backMateria'){route={view:'materiaDetail',materiaId:b.dataset.id};render();}
  else if(a==='addTema'){
    mutate(s=>{ui.open[b.dataset.corte]=true;s.temas.unshift({id:uid(),materiaId:b.dataset.mat,corteId:b.dataset.corte,title:'',body:'',by:miNombre(),publicado:((s.materias.find(x=>x.id===b.dataset.mat)||{}).rol==='docente')?false:undefined,updatedAt:Date.now()})});
  }
  else if(a==='temaTab'){
    ui.tab[b.dataset.id]=b.dataset.tab;
    const box=b.closest('.b');
    box.querySelectorAll('.tabsT button').forEach(x=>x.classList.toggle('on',x===b));
    box.querySelectorAll('.tp').forEach(p=>{p.hidden=p.dataset.panel!==b.dataset.tab});
    requestAnimationFrame(()=>{fitCards();layoutRadials()});
  }
  else if(a==='esqMenu'){
    const menu=b.parentElement.querySelector('.esqx-menu'),abrir=menu.hidden;
    esqCerrarMenus(abrir?menu:null);
    menu.hidden=!abrir;b.setAttribute('aria-expanded',String(abrir));
  }
  else if(a==='esqStyle'){
    const id=b.closest('.esqx').dataset.esqtema;
    esqGuardar(b.dataset.estilo);esqRefrescar();
    const nb=document.querySelector('.esqx[data-esqtema="'+id+'"] .esqx-tab');if(nb)nb.focus();
  }
  else if(a==='editSec'){
    const el=b.closest('.secAcc');
    if(el.classList.contains('editing')){
      const t=state.temas.find(x=>x.id===b.dataset.id),sc=t&&t.secciones&&t.secciones.find(x=>x.id===b.dataset.sid);
      if(sc){
        el.querySelector('.secRead').innerHTML=secReadHTML(sc);
        const pan=el.closest('.b').querySelector('[data-panel="esquema"]');
        if(pan){pan.innerHTML=esquemaHTML(t);requestAnimationFrame(()=>layoutRadials(pan))}
      }
      el.classList.remove('editing');
    }else{el.classList.add('editing');el.querySelectorAll('textarea').forEach(fitTA)}
  }
  else if(a==='addSec'){
    mutate(s=>{const t=s.temas.find(x=>x.id===b.dataset.id);if(t){t.secciones=t.secciones||[];t.secciones.push({id:uid(),title:'',body:''});t.updatedAt=Date.now()}});
  }
  else if(a==='delSec'){
    if(confirm('¿Eliminar esta sección?'))mutate(s=>{const t=s.temas.find(x=>x.id===b.dataset.id);if(t&&t.secciones)t.secciones=t.secciones.filter(x=>x.id!==b.dataset.sid)});
  }
  else if(a==='descargarOriginal'){descargarOriginal(b.dataset.id)}
  else if(a==='avCerrar'){$('avisosPanel').hidden=true}
  else if(a==='avVaciar'){avCargar().lista=[];avGuardar();$('avisosPanel').innerHTML=avisosPanelHTML(new Set())}
  else if(a==='avAbrir'){
    const x=avCargar().lista.find(v=>v.id===b.dataset.av);$('avisosPanel').hidden=true;
    const mm=x&&x.materiaId&&state.materias.find(v=>v.id===x.materiaId);
    if(mm){route={view:'materiaDetail',materiaId:mm.id};document.querySelectorAll('#mainNav button').forEach(v=>v.classList.toggle('on',v.dataset.nav==='materias'));render()}
  }
  else if(a==='avToggle'){mutate(s=>{s.profile.avisos=s.profile.avisos===false});if(avisosActivos())revisarRecordatorios()}
  else if(a==='avPermiso'){
    try{Promise.resolve(Notification.requestPermission()).then(()=>{render(true);if(Notification.permission==='granted')notificarSistemaPrueba()})}catch(err){console.warn(err)}
  }
  else if(a==='syncReintentar'){reintentarSync()}
  else if(a==='liberarEspacio'){liberarEspacio()}
  else if(a==='delTema'){
    if(confirm(msgDelTema(b.dataset.id))){
      const t0=state.temas.find(x=>x.id===b.dataset.id);
      if(t0&&t0.archivo){const mm=state.materias.find(x=>x.id===t0.materiaId);if(mm&&mm.sharedId&&mm.rol!=='estudiante')borrarOriginalNube(mm.sharedId,t0.id,t0.archivo.partes,t0.archivo)}
      mutate(s=>{s.cards=s.cards.filter(c=>c.temaId!==b.dataset.id);s.temas=s.temas.filter(t=>t.id!==b.dataset.id)});
    }
  }
  else if(a==='addCard'){
    mutate(s=>s.cards.push({id:uid(),temaId:b.dataset.tema,materiaId:b.dataset.mat,front:'',back:'',known:null}));
  }
  else if(a==='delCard'){
    if(confirm('¿Eliminar esta tarjeta?'))mutate(s=>s.cards=s.cards.filter(c=>c.id!==b.dataset.id));
  }
  else if(a==='addCorte'){
    const name=prompt('Nombre del nuevo corte:','Corte '+(state.cortes.filter(c=>c.materiaId===b.dataset.mat).length+1));
    if(name&&name.trim())mutate(s=>{
      const mine=s.cortes.filter(c=>c.materiaId===b.dataset.mat);
      const used=mine.reduce((x,c)=>x+(+c.weight||0),0);
      const id=uid();ui.open[id]=true;
      s.cortes.push({id,materiaId:b.dataset.mat,name:name.trim(),weight:Math.max(0,100-used),score:null});
    });
  }
  else if(a==='editCorte'||a==='doneCorte'){
    const el=b.closest('.folder');
    if(el.classList.contains('editing')){el.classList.remove('editing');render();}
    else{el.classList.add('editing');el.open=true;const i=el.querySelector('.corteEdit input');if(i)i.focus();}
  }
  else if(a==='delCorte'){
    const id=b.dataset.id,c=state.cortes.find(x=>x.id===id);if(!c)return;
    if(state.cortes.filter(x=>x.materiaId===c.materiaId).length<=1){alert('Cada materia necesita al menos un corte. Puedes editar este en lugar de eliminarlo.');return;}
    const n=state.temas.filter(t=>t.corteId===id).length;
    const msg=n?`¿Eliminar "${c.name}" junto con sus ${n} tema${n==1?'':'s'} y sus tarjetas? Esta acción no se puede deshacer.`:`¿Eliminar "${c.name}"?`;
    const matC=state.materias.find(x=>x.id===c.materiaId);
    if(matC&&matC.sharedId){
      /* Los cortes son personales: borrar uno no debe borrar temas que también son de otras personas. */
      if(confirm(`¿Eliminar "${c.name}"? Los ${n} tema${n==1?'':'s'} de esta materia compartida NO se borran: pasan a otro de tus cortes.`))mutate(s=>{
        const otro=s.cortes.find(x=>x.materiaId===c.materiaId&&x.id!==id);
        s.temas.forEach(t=>{if(t.corteId===id)t.corteId=otro.id});
        s.cortes=s.cortes.filter(x=>x.id!==id);
      });
      return;
    }
    if(confirm(msg))mutate(s=>{
      const ids=s.temas.filter(t=>t.corteId===id).map(t=>t.id);
      s.cards=s.cards.filter(k=>!ids.includes(k.temaId));
      s.temas=s.temas.filter(t=>t.corteId!==id);
      s.cortes=s.cortes.filter(x=>x.id!==id);
    });
  }
  else if(a==='openTool'){startTool(b.dataset.tool,b.dataset.mat);}
  else if(a==='quizStart'){comenzarQuiz()}
  else if(a==='redoTool'){startTool(route.tool,route.materiaId);}
  else if(a==='flipCard'){
    toolState.flipped=!toolState.flipped;
    if(b.classList.contains('flashcard'))b.classList.toggle('flip',toolState.flipped);   // sin repintar: así el giro se anima
    else render();
  }
  else if(a==='falleStart'){comenzarFalle(b.dataset.modo,b.dataset.tema)}
  else if(a==='cardAnswer'){
    const know=b.dataset.know==='1';
    const c=toolState.cards[toolState.idx];
    const real=state.cards.find(x=>x.id===c.id);
    if(real){real.known=know;repasarTarjeta(real,know);persist();avisarLogros(evaluarLogros());}
    toolState.seen++;if(know)toolState.known++;
    toolState.idx++;toolState.flipped=false;
    render();
  }
  else if(a==='answerQuiz'||a==='answerHueco'){
    const q=toolState.questions[toolState.idx];
    if(q.selected)return;
    if(a==='answerHueco')q.selected=limpioT(($('huecoInput')||{}).value)||'(sin respuesta)';
    else q.selected=b.dataset.opt;
    const acierto=esAcierto(q);
    if(acierto)toolState.score++;
    const realQ=state.cards.find(x=>x.id===q.card.id);
    if(realQ){repasarTarjeta(realQ,acierto);persist()}      // el repaso espaciado también aprende de los quiz
    if(route.tool!=='examen'||examInstantaneo){
      toolState.combo=acierto?(toolState.combo||0)+1:0;
      toolState.fx={tipo:acierto?'ok':'no'};
    }
    render();
  }
  else if(a==='nextQuestion'){
    toolState.idx++;
    if(toolState.idx>=toolState.questions.length){
      toolState.fxFin=true;
      mutate(s=>{
        const att={id:uid(),materiaId:route.materiaId,type:route.tool,score:toolState.score,total:toolState.questions.length,date:Date.now(),porCorte:porCorteDe(toolState.questions),corteId:toolState.corteId||null};
        s.attempts.push(att);
        toolState.premios=registrarSesion(att);      // racha, insignias y etapas
      });
      if(toolState.premios&&toolState.premios.nuevos.length)avisarLogros(toolState.premios.nuevos);
    }else{
      render();
    }
  }
  else if(a==='calPrev'){calView.m--;if(calView.m<0){calView.m=11;calView.y--}render();}
  else if(a==='calNext'){calView.m++;if(calView.m>11){calView.m=0;calView.y++}render();}
  else if(a==='selDay'){calView.sel=b.dataset.date;render();}
  else if(a==='addEvent'){
    const title=prompt('Título del evento (ej. Examen final de Ética):');
    if(title&&title.trim()){
      const t=(prompt('Tipo: escribe "examen", "entrega" u "otro"','examen')||'otro').toLowerCase();
      const type=t.startsWith('ex')?'ex':t.startsWith('en')?'en':'ot';
      mutate(s=>s.events.push({id:uid(),date:b.dataset.date,title:title.trim(),type}));
    }
  }
  else if(a==='delEvent'){
    if(confirm('¿Eliminar este evento?'))mutate(s=>s.events=s.events.filter(x=>x.id!==b.dataset.id));
  }
  else if(a==='setAvatar'){mutate(s=>s.profile.avatar=b.dataset.a);}
  else if(a==='logout'){if(confirm('¿Cerrar sesión?'))auth.signOut();}
});

/* ================= ACCIONES (edición en vivo, sin repintar) ================= */
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&e.target&&e.target.id==='huecoInput'){e.preventDefault();const b=document.querySelector('[data-action="answerHueco"]');if(b)b.click()}
});
document.addEventListener('input',e=>{
  const a=e.target.dataset.action;if(!a)return;
  const id=e.target.dataset.id;

  if(a==='editTemaTitle'){
    const t=state.temas.find(x=>x.id===id);if(!t)return;
    t.title=e.target.value;t.updatedAt=Date.now();persist();
    const sum=e.target.closest('details')?.querySelector('summary span');
    if(sum)sum.textContent='📝 '+(t.title||'(tema sin título)');
  }
  else if(a==='editTemaBody'){
    const t=state.temas.find(x=>x.id===id);if(!t)return;
    t.body=e.target.value;t.updatedAt=Date.now();persist();
  }
  else if(a==='iaCorteSel'){ui.iaCorte=e.target.value}
  else if(a==='quizCorte'&&toolState&&toolState.setup){toolState.corteId=e.target.value;toolState.error='';ui.quizCfg[route.materiaId].corteId=e.target.value;render(true)}
  else if(a==='quizTipos'&&toolState&&toolState.setup){toolState.tipos=e.target.value;ui.quizCfg[route.materiaId].tipos=toolState.tipos}
  else if(a==='quizN'&&toolState&&toolState.setup){toolState.n=+e.target.value||0;ui.quizCfg[route.materiaId].n[route.tool]=toolState.n}
  else if(a==='editSecPuntos'){
    const t=state.temas.find(x=>x.id===id);
    const sc=t&&t.secciones&&t.secciones.find(x=>x.id===e.target.dataset.sid);if(!sc)return;
    const pr=ideasParse(e.target.value);sc.puntos=pr.puntos;sc.tipos=pr.tipos;
    t.updatedAt=Date.now();persist();
  }
  else if(a==='editSecRel'){
    const t=state.temas.find(x=>x.id===id);if(!t||!t.secciones)return;
    const sc=t.secciones.find(x=>x.id===e.target.dataset.sid);if(!sc)return;
    sc.rel=e.target.value;t.updatedAt=Date.now();persist();
  }
  else if(a==='editSecTitle'||a==='editSecBody'){
    const t=state.temas.find(x=>x.id===id);if(!t||!t.secciones)return;
    const sc=t.secciones.find(x=>x.id===e.target.dataset.sid);if(!sc)return;
    if(a==='editSecTitle'){
      sc.title=e.target.value;
      const sn=e.target.closest('details')?.querySelector('summary .st');
      if(sn)sn.textContent=sc.title||'(sección sin título)';
    }else{sc.body=e.target.value;const sp=e.target.closest('details')?.querySelector('summary .sp');if(sp)sp.textContent=prevSec(sc.body)}
    t.updatedAt=Date.now();persist();
  }
  else if(a==='editCorteName'){
    const c=state.cortes.find(x=>x.id===id);if(!c)return;
    c.name=e.target.value;persist();
    const ft=e.target.closest('.folder')?.querySelector('.ft');if(ft)ft.textContent='📁 '+(c.name||'(corte sin nombre)');
  }
  else if(a==='editCorteWeight'){
    const c=state.cortes.find(x=>x.id===id);if(!c)return;
    c.weight=clamp(+e.target.value||0,0,100);persist();refreshCorteAvg(route.materiaId);
  }
  else if(a==='editCorteScore'){
    const c=state.cortes.find(x=>x.id===id);if(!c)return;
    c.score=e.target.value===''?null:clamp(+e.target.value,0,scaleMax());persist();refreshCorteAvg(route.materiaId);
  }
  else if(a==='profileField'){
    const f=e.target.dataset.f;
    state.profile[f]=f==='goal'?clamp(+e.target.value||0,0,scaleMax()):e.target.value;
    persist();
  }
  else if(a==='editCardFront'){
    const c=state.cards.find(x=>x.id===id);if(!c)return;
    c.front=e.target.value;persist();
  }
  else if(a==='editCardBack'){
    const c=state.cards.find(x=>x.id===id);if(!c)return;
    c.back=e.target.value;persist();
  }
  else if(a==='editMateriaRefs'){
    const m=state.materias.find(x=>x.id===id);if(!m)return;
    m.refs=e.target.value;persist();
  }
});
document.addEventListener('change',e=>{
  if(e.target.dataset.action==='setCompareMateria'){
    toolState.materiaId2=e.target.value;persist();render();
  }
});

document.addEventListener('change',e=>{
  if(!e.target.dataset||e.target.dataset.action!=='setScale')return;
  const ns=+e.target.value,os=scaleMax();
  if(ns===os)return;
  if(!confirm('Cambiar la escala convierte tus notas y tu meta proporcionalmente (por ejemplo, 4,5 sobre 5 pasa a 90 sobre 100). ¿Continuar?')){render();return;}
  const conv=x=>{const v=x*ns/os;return ns>10?Math.round(v*10)/10:Math.round(v*100)/100};
  mutate(s=>{
    s.profile.scale=ns;s.profile.goal=conv(+s.profile.goal||0);
    s.cortes.forEach(c=>{if(c.score!=null&&c.score!=='')c.score=conv(+c.score)});
  });
});

/* Auto-ajuste de altura de las secciones (solo estético) */
function fitTA(t){t.style.height='auto';t.style.height=(t.scrollHeight+4)+'px'}
/* Tarjetas: cada campo crece según su texto. Los campos ocultos (pestaña cerrada) se ajustan al mostrarse. */
function fitCards(root){(root||document).querySelectorAll('.cardRow textarea').forEach(t=>{if(t.offsetParent!==null)fitTA(t)})}
let esqRz;
window.addEventListener('resize',()=>{fitCards();clearTimeout(esqRz);esqRz=setTimeout(()=>layoutRadials(),120)});
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>layoutRadials());
document.addEventListener('click',e=>{if(!e.target.closest('.esqx-tabs'))esqCerrarMenus()});
document.addEventListener('keydown',e=>{
  const tab=e.target.closest&&e.target.closest('.esqx-tab');
  if(tab&&(e.key==='ArrowDown'||e.key==='ArrowUp')){
    e.preventDefault();const menu=tab.parentElement.querySelector('.esqx-menu');
    esqCerrarMenus(menu);menu.hidden=false;tab.setAttribute('aria-expanded','true');
    const it=[...menu.querySelectorAll('.esqx-mi')];(it.find(x=>x.getAttribute('aria-checked')==='true')||it[0]).focus();return;
  }
  const menu=e.target.closest&&e.target.closest('.esqx-menu');if(!menu)return;
  const it=[...menu.querySelectorAll('.esqx-mi')],i=it.indexOf(document.activeElement);
  if(e.key==='ArrowDown'){e.preventDefault();it[(i+1)%it.length].focus()}
  else if(e.key==='ArrowUp'){e.preventDefault();it[(i-1+it.length)%it.length].focus()}
  else if(e.key==='Home'){e.preventDefault();it[0].focus()}
  else if(e.key==='End'){e.preventDefault();it[it.length-1].focus()}
  else if(e.key==='Escape'){e.preventDefault();esqCerrarMenus();const tb=menu.parentElement.querySelector('.esqx-tab');if(tb)tb.focus()}
  else if(e.key==='Tab')esqCerrarMenus();
});
document.addEventListener('toggle',e=>{const d=e.target;if(!d.matches||!d.matches('details'))return;
  if(d.dataset.tema)ui.open[d.dataset.tema]=d.open;
  if(d.dataset.sec)ui.sec[d.dataset.sec]=d.open;
  if(d.dataset.corte)ui.open[d.dataset.corte]=d.open;
  if(d.open)requestAnimationFrame(()=>{fitCards(d);layoutRadials(d)});
},true);
document.addEventListener('input',e=>{if(e.target.matches&&e.target.matches('.secAcc textarea, .cardRow textarea'))fitTA(e.target)});

/* Hecho por Sebastián Poveda y Santiago Romero. 2026 · generación de temas con IA */
/* ================= IA: SUBIR PDF/PPTX Y GENERAR TEMA + TARJETAS ================= */
/* Caché de resultados de IA: si subes otra vez el mismo archivo, se reutiliza el resultado
   y NO se gasta una petición del límite diario de Gemini (que cuenta peticiones, no tokens). */
const IA_CACHE_VER='v6';   // súbela cada vez que cambies las instrucciones de la IA, para no reutilizar resultados viejos
const IA_LIMITE_DIARIO=20;   // archivos (PDF o PPTX) por persona y por día. Debe coincidir con LIMITE_DIARIO en netlify/functions/generar-tema.js
const IA_MAX_CHARS=60000;   // texto máximo que se manda a la IA (antes 20 000: el resto se ignoraba en silencio)
const IA_CACHE_MAX=15;     // cuántos resultados se recuerdan en este navegador
async function iaHash(texto){
  try{
    const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(IA_CACHE_VER+'|'+String(texto).trim().slice(0,IA_MAX_CHARS)));
    return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }catch(e){return null}
}
function iaCacheLeer(){try{return JSON.parse(localStorage.getItem('iaCache')||'{}')||{}}catch(e){return{}}}
async function iaCacheGet(texto){
  const k=await iaHash(texto);if(!k)return null;
  const e=iaCacheLeer()[k];
  return e&&e.d&&e.v===IA_CACHE_VER?e.d:null;
}
async function iaCacheSet(texto,data){
  const k=await iaHash(texto);if(!k)return;
  const c=iaCacheLeer();c[k]={t:Date.now(),v:IA_CACHE_VER,d:data};
  Object.keys(c).sort((a,b)=>c[b].t-c[a].t).slice(IA_CACHE_MAX).forEach(x=>delete c[x]);
  try{localStorage.setItem('iaCache',JSON.stringify(c))}catch(e){/* sin espacio: no pasa nada */}
}
/* ---------- Cupo diario de archivos ---------- */
const diaColombia=()=>Math.floor((Date.now()-18000000)/86400000);    // el día cambia a medianoche de Colombia (UTC-5)
function iaRestantes(){const u=ui.iaUso;return u&&u.ok?Math.max(0,IA_LIMITE_DIARIO-u.usados):null}
function textoRenueva(){const min=Math.max(1,Math.ceil((86400000-((Date.now()-18000000)%86400000))/60000)),h=Math.floor(min/60),m=min%60;return h?h+' h'+(m?' '+m+' min':''):m+' min'}
function cupoIAHTML(){
  const u=ui.iaUso;
  if(!u||(!u.ok&&u.cargando))return '<span class="meta">Consultando cuántos archivos te quedan hoy…</span>';
  if(!u.ok)return `<span class="meta">No pude consultar tu cupo ahora. El límite es de <b>${IA_LIMITE_DIARIO} archivos (PDF o PPTX) por día</b>.</span>`;
  const rest=Math.max(0,IA_LIMITE_DIARIO-u.usados),cls=rest===0?'cupo0':rest<=3?'cupoBajo':'';
  return `<div class="cupoIA ${cls}"><b>📎 Te quedan ${rest} de ${IA_LIMITE_DIARIO} archivos hoy</b><div class="bar"><i style="width:${Math.round(rest/IA_LIMITE_DIARIO*100)}%"></i></div><small class="meta">${rest===0?'Ya usaste todos los de hoy. ':''}Se renuevan a la medianoche (hora de Colombia), en ${textoRenueva()}. Si subes un archivo que ya analizaste antes en este navegador, no gasta cupo. Si la IA falla, tampoco.</small></div>`;
}
function actualizarCupoUI(){const el=$('iaCupo');if(el)el.innerHTML=cupoIAHTML()}
async function cargarUsoIA(){
  if(!currentUid||(ui.iaUso&&ui.iaUso.cargando))return;
  ui.iaUso={...(ui.iaUso||{}),cargando:true};
  try{
    const d=await db.collection('iaUso').doc(currentUid).get(),x=d.exists?d.data():null;
    ui.iaUso={ok:true,usados:(x&&x.dia===diaColombia())?(+x.n||0):0,t:Date.now()};
  }catch(e){console.warn('No se pudo leer el cupo de IA:',e);ui.iaUso={ok:false,t:Date.now()}}
  actualizarCupoUI();
}
/* pdf.js y JSZip pesan bastante: se descargan solo la primera vez que alguien sube un archivo, no al abrir la app */
const PDFJS_VER='5.4.54';
let pdfjsPromise=null,jszipPromise=null;
function cargarPdfJs(){
  if(!pdfjsPromise)pdfjsPromise=import('https://cdn.jsdelivr.net/npm/pdfjs-dist@'+PDFJS_VER+'/build/pdf.min.mjs').then(m=>{
    m.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@'+PDFJS_VER+'/build/pdf.worker.min.mjs';
    return m;
  }).catch(e=>{pdfjsPromise=null;throw new Error('No se pudo cargar el lector de PDF (¿sin internet?)')});
  return pdfjsPromise;
}
function cargarJSZip(){
  if(window.JSZip)return Promise.resolve(window.JSZip);
  if(!jszipPromise)jszipPromise=new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload=()=>res(window.JSZip);
    s.onerror=()=>{jszipPromise=null;rej(new Error('No se pudo cargar el lector de PPTX (¿sin internet?)'))};
    document.head.appendChild(s);
  });
  return jszipPromise;
}
async function extraerPDF(file){
  const buf=await file.arrayBuffer();
  const pdfjs=await cargarPdfJs();
  const pdf=await pdfjs.getDocument({data:buf}).promise;
  let texto='';
  for(let i=1;i<=pdf.numPages;i++){
    const page=await pdf.getPage(i);
    const content=await page.getTextContent();
    texto+=content.items.map(it=>it.str).join(' ')+'\n\n';
  }
  return{texto:texto.trim(),paginas:pdf.numPages};
}
const IA_PDF_MAX=8*1024*1024;      // tamaño máximo de un PDF escaneado que se le manda a la IA
function archivoABase64(file){
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]||'');r.onerror=()=>rej(r.error||new Error('No se pudo leer el archivo'));r.readAsDataURL(file)});
}
async function extraerTextoPPTX(file){
  const JSZ=await cargarJSZip();
  const zip=await JSZ.loadAsync(file);
  const slideFiles=Object.keys(zip.files)
    .filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a,b)=>{
      const na=+a.match(/slide(\d+)\.xml/)[1], nb=+b.match(/slide(\d+)\.xml/)[1];
      return na-nb;
    });
  let texto='';
  for(const name of slideFiles){
    const xml=await zip.files[name].async('text');
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    const nodes=doc.getElementsByTagName('a:t');
    texto+=Array.from(nodes).map(n=>n.textContent).join(' ')+'\n\n';
  }
  return texto.trim();
}

/* ---------- Documento original (PDF/PPTX del docente) ----------
   Se guarda en Firestore troceado en base64:  temarios/{sid}/temas/{temaId}/archivo/{0..n}
   (Firestore limita cada documento a 1 MiB). El tema guarda solo la ficha: tema.archivo={nombre,tipo,tam,partes}.
   Es independiente de lo que genera la IA (resumen, esquema, tarjetas, exámenes). */
const ARCH_MAX=8*1024*1024;      // tamaño máximo del original (8 MB)
const ARCH_PARTE=600000;         // caracteres base64 por trozo (múltiplo de 4: cada trozo se decodifica solo)
const ARCH_STORAGE_MAX=50*1024*1024;   // con Firebase Storage activado: hasta 50 MB
const usaStorage=()=>typeof USAR_STORAGE!=='undefined'&&USAR_STORAGE===true;
const tieneOriginal=a=>!!(a&&(a.partes||a.ruta));
let storagePromise=null;
function cargarStorage(){
  if(!storagePromise)storagePromise=new Promise((res,rej)=>{
    const listo=()=>{try{res(firebase.storage())}catch(e){storagePromise=null;rej(e)}};
    if(firebase.storage)return listo();
    const s=document.createElement('script');
    s.src='https://www.gstatic.com/firebasejs/11.10.0/firebase-storage-compat.js';
    s.onload=listo;s.onerror=()=>{storagePromise=null;rej(new Error('No se pudo cargar Firebase Storage'))};
    document.head.appendChild(s);
  });
  return storagePromise;
}
async function guardarEnStorage(m,temaId,file,avisar){
  const st=await cargarStorage();
  const seguro=file.name.replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g,'_');
  const ruta='originales/'+m.sharedId+'/'+temaId+'/'+seguro;
  /* contentDisposition hace que el navegador lo descargue con el nombre original sin pedir permisos CORS */
  const tarea=st.ref(ruta).put(file,{contentType:file.type||archivoMime(file.name),contentDisposition:"attachment; filename*=UTF-8''"+encodeURIComponent(file.name)});
  await new Promise((res,rej)=>{tarea.on('state_changed',s=>{if(avisar)avisar('📎 Subiendo el original… '+Math.round(s.bytesTransferred/s.totalBytes*100)+' %')},rej,res)});
  return{nombre:file.name,tipo:file.type||archivoMime(file.name),tam:file.size,en:'storage',ruta,subido:Date.now()};
}
function archivoMime(n){const x=String(n||'').toLowerCase();return x.endsWith('.pdf')?'application/pdf':x.endsWith('.pptx')?'application/vnd.openxmlformats-officedocument.presentationml.presentation':'application/octet-stream'}
function fmtTam(b){b=+b||0;return b>=1048576?(b/1048576).toFixed(1).replace('.',',')+' MB':Math.max(1,Math.round(b/1024))+' KB'}
async function guardarOriginal(m,temaId,file,avisar){
  if(!m||!m.sharedId||m.rol==='estudiante'||!temaId)return{ok:false,mensaje:'El original solo se guarda en materias compartidas o de docente.'};
  if(file.size>ARCH_MAX){
    if(usaStorage()&&file.size<=ARCH_STORAGE_MAX){
      try{return{ok:true,meta:await guardarEnStorage(m,temaId,file,avisar)}}
      catch(err){console.error('Storage:',err);return{ok:false,mensaje:'No se pudo subir el original grande a Firebase Storage'+detalleError(err)+'. El tema sí se creó, pero sin el original descargable.'}}
    }
    const tope=usaStorage()?ARCH_STORAGE_MAX:ARCH_MAX;
    return{ok:false,mensaje:'El archivo pesa '+fmtTam(file.size)+' y el máximo para guardar el original es '+fmtTam(tope)+'. El tema sí se creó, pero sin el original descargable.'};
  }
  try{
    const b64=await archivoABase64(file);
    const partes=Math.ceil(b64.length/ARCH_PARTE);
    const col=refTemario(m.sharedId).collection('temas').doc(temaId).collection('archivo');
    for(let i=0;i<partes;i++){
      if(avisar)avisar('📎 Guardando el original… '+(i+1)+'/'+partes);
      await col.doc(String(i)).set({i,data:b64.slice(i*ARCH_PARTE,(i+1)*ARCH_PARTE)});
    }
    return{ok:true,meta:{nombre:file.name,tipo:file.type||archivoMime(file.name),tam:file.size,partes,subido:Date.now()}};
  }catch(err){
    console.error('Guardar original:',err);
    borrarOriginalNube(m.sharedId,temaId,Math.ceil(ARCH_MAX*1.4/ARCH_PARTE));
    return{ok:false,mensaje:'No se pudo guardar el original'+detalleError(err)+'. ¿Publicaste las reglas nuevas de Firestore? El tema sí se creó.'};
  }
}
async function borrarOriginalNube(sid,temaId,partes,meta){
  if(meta&&meta.en==='storage'&&meta.ruta){
    try{const st=await cargarStorage();await st.ref(meta.ruta).delete()}catch(e){console.warn('No se pudo borrar el original de Storage:',e)}
    return;
  }
  if(!sid||!temaId||!partes)return;
  try{
    const col=refTemario(sid).collection('temas').doc(temaId).collection('archivo');
    const b=db.batch();for(let i=0;i<partes;i++)b.delete(col.doc(String(i)));await b.commit();
  }catch(e){console.warn('No se pudo limpiar el original de la nube:',e)}
}
const descargando=new Set();
async function descargarOriginal(temaId){
  const t=state.temas.find(x=>x.id===temaId);if(!t||!t.archivo)return;
  const m=state.materias.find(x=>x.id===t.materiaId);
  if(!m||!m.sharedId){alert('Este documento no está disponible en este dispositivo.');return}
  if(descargando.has(temaId))return;
  descargando.add(temaId);
  toast('⬇️ Preparando '+esc(t.archivo.nombre||'el documento')+'…');
  try{
    if(t.archivo.en==='storage'){
      const st=await cargarStorage();
      const url=await st.ref(t.archivo.ruta).getDownloadURL();
      const a=document.createElement('a');a.href=url;a.rel='noopener';document.body.appendChild(a);a.click();setTimeout(()=>a.remove(),1500);
      return;
    }
    const snap=await refTemario(m.sharedId).collection('temas').doc(temaId).collection('archivo').orderBy('i').get();
    const partes=snap.docs.map(d=>d.data());
    if(partes.length!==t.archivo.partes||partes.some((p,i)=>p.i!==i))throw new Error('El documento está incompleto en la nube. Pídele a tu docente que lo vuelva a subir.');
    const trozos=partes.map(p=>{const bin=atob(p.data),u=new Uint8Array(bin.length);for(let k=0;k<bin.length;k++)u[k]=bin.charCodeAt(k);return u});
    const blob=new Blob(trozos,{type:t.archivo.tipo||archivoMime(t.archivo.nombre)});
    if(t.archivo.tam&&blob.size!==t.archivo.tam)throw new Error('El archivo descargado no coincide con el original (tamaño distinto).');
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=t.archivo.nombre||'documento';
    document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500);
  }catch(e){
    console.error(e);
    alert('No se pudo descargar el documento original'+(e&&e.code?detalleError(e):': '+(e&&e.message||'error'))+'.');
  }finally{descargando.delete(temaId)}
}
function docOriginalHTML(t){
  const a=t.archivo,pdf=/pdf/i.test(a.tipo||'')||/\.pdf$/i.test(a.nombre||'');
  return `<div class="origDoc"><span class="odIco" aria-hidden="true">${pdf?'📄':'📎'}</span><span class="odTxt"><b>Documento original</b><small>${esc(a.nombre||'documento')} · ${fmtTam(a.tam)}</small></span><button type="button" class="pr" data-action="descargarOriginal" data-id="${t.id}">⬇️ Descargar ${pdf?'PDF original':'archivo original'}</button></div>`;
}
function docsOriginalesHTML(m){
  const items=state.temas.filter(x=>x.materiaId===m.id&&x.archivo);
  if(!items.length)return '';
  const cortes=state.cortes.filter(c=>c.materiaId===m.id);
  return `<div class="card shareBox" style="margin-top:12px"><b style="font-size:.9em">📎 Documentos originales de tu docente</b>
    <p class="meta" style="margin:4px 0 0">Los archivos tal como los subió tu docente. Son independientes de los resúmenes, esquemas, tarjetas y exámenes generados con IA.</p>
    ${cortes.map(c=>{const ts=items.filter(x=>x.corteId===c.id);if(!ts.length)return '';
      return `<div style="margin-top:10px"><span class="chip">📁 ${esc(c.name)||'(corte sin nombre)'}</span>${ts.map(x=>`<div class="li"><span>📝 ${esc(x.title)||'(tema sin título)'}<br><small class="meta">${esc(x.archivo.nombre||'')} · ${fmtTam(x.archivo.tam)}</small></span><button class="sec" data-action="descargarOriginal" data-id="${x.id}">⬇️ Descargar</button></div>`).join('')}</div>`}).join('')}
  </div>`;
}

document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action="iaPickFile"]');
  if(b)$('iaFileInput').click();
});

document.addEventListener('change',async e=>{
  if(e.target.id!=='iaFileInput')return;
  const file=e.target.files[0];
  if(!file)return;
  const materiaId=e.target.dataset.mat;
  const statusEl=$('iaStatus');
  const btn=$('iaUploadBtn');
  const nombre=file.name.toLowerCase();

  try{
    btn.disabled=true;
    statusEl.textContent='📄 Leyendo el archivo…';
    let texto='',pdfEscaneado=null;
    if(nombre.endsWith('.pdf')){
      const r0=await extraerPDF(file);texto=r0.texto;
      /* Casi sin texto seleccionable = escaneo o fotos de hojas: se lo manda la IA directamente para que lo lea (tipo OCR) */
      if(r0.texto.trim().length<Math.max(40,r0.paginas*25)){
        if(file.size>IA_PDF_MAX){
          statusEl.textContent='❌ Este PDF parece escaneado (sin texto) y pesa '+fmtTam(file.size)+'. Para que la IA lo lea el máximo es '+fmtTam(IA_PDF_MAX)+': comprímelo o divídelo en partes.';
          btn.disabled=false;return;
        }
        pdfEscaneado=file;
      }
    }
    else if(nombre.endsWith('.pptx')) texto=await extraerTextoPPTX(file);
    else{ statusEl.textContent='❌ Solo se admiten archivos .pdf o .pptx.'; btn.disabled=false; return; }

    if(!pdfEscaneado&&(!texto||texto.trim().length<40)){
      statusEl.textContent='❌ No pude sacar texto de ese archivo. Revisa que no esté vacío ni protegido con contraseña.';
      btn.disabled=false; return;
    }
    const claveCache=pdfEscaneado?('PDF-ESCANEADO|'+file.name+'|'+file.size+'|'+file.lastModified):texto;

    const materia=state.materias.find(m=>m.id===materiaId);
    if(state.temas.some(t=>t.materiaId===materiaId&&t.fuente===file.name)&&!confirm('Ya hay un tema creado a partir de un archivo llamado "'+file.name+'". ¿Subirlo de todos modos?')){statusEl.textContent='';return}
    let data=await iaCacheGet(claveCache);
    const desdeCache=!!data;
    if(desdeCache){
      statusEl.textContent='♻️ Ya había analizado este archivo: reutilicé el resultado sin gastar IA.';
    }else{
      if(iaRestantes()===0){
        statusEl.textContent='❌ Ya usaste tus '+IA_LIMITE_DIARIO+' archivos de hoy. Se renuevan a la medianoche (hora de Colombia), en '+textoRenueva()+'. Los archivos que ya analizaste antes en este navegador sí puedes volver a subirlos sin gastar cupo.';
        btn.disabled=false;return;
      }
      statusEl.textContent=pdfEscaneado?'🔍 Este PDF parece escaneado (no tiene texto seleccionable): la IA lo leerá directamente. Puede tardar unos minutos…':'🤖 La IA está armando el tema y las tarjetas… puede tardar hasta un minuto.';
      const r=await pedirIA(texto,materia?materia.name:'',statusEl,pdfEscaneado);
      if(!r.ok){statusEl.textContent='❌ '+r.error;btn.disabled=false;ui.iaUso=null;cargarUsoIA();return}
      data=r.data;
      if(data&&data.cupo){ui.iaUso={ok:true,usados:+data.cupo.usados||0,t:Date.now()}}else{ui.iaUso=null;cargarUsoIA()}
      if(data)delete data.cupo;     // el cupo no es parte del tema ni debe quedar en la caché
    }
    if(!data.titulo||!Array.isArray(data.tarjetas)){
      statusEl.textContent='❌ La IA no devolvió un resultado válido. Probá de nuevo.';
      btn.disabled=false; return;
    }
    if(!desdeCache)iaCacheSet(claveCache,data);

    let temaIdNuevo=null;
    mutate(s=>{
      const temaId=uid();temaIdNuevo=temaId;
      const secs=Array.isArray(data.secciones)?data.secciones.filter(x=>x&&x.titulo&&x.contenido).map(x=>({id:uid(),title:String(x.titulo),body:String(x.contenido),rel:String(x.relacion||'').trim(),...(()=>{const pr=(Array.isArray(x.puntos)?x.puntos:[]).map((p,i)=>({p:String(p).trim(),t:Array.isArray(x.tipos)?x.tipos[i]:null})).filter(o=>o.p).slice(0,6);return{puntos:pr.map(o=>o.p),tipos:pr.map(o=>ESQ_TIPOS.includes(o.t)?o.t:null)}})()})):[];
      const sel=$('iaCorte');const corteId=(sel&&sel.value)||(s.cortes.find(c=>c.materiaId===materiaId)||{}).id;
      ui.open[corteId]=true;ui.open[temaId]=true;
      const tema={id:temaId,materiaId,corteId,title:data.titulo,body:data.resumen||'',by:miNombre(),fuente:file.name,publicado:(materia&&materia.rol==='docente')?false:undefined,updatedAt:Date.now()};
      if(secs.length)tema.secciones=secs;
      s.temas.unshift(tema);
      (data.tarjetas||[]).forEach(t=>{
        if(t.frente&&t.reverso){
          const c={id:uid(),materiaId,temaId,front:t.frente,back:t.reverso,known:null};
          const dist=(Array.isArray(t.distractores)?t.distractores:[]).map(x=>String(x||'').trim()).filter(Boolean).slice(0,3);
          if(dist.length>=3)c.dist=dist;                                   // opciones incorrectas hechas por la IA
          if(String(t.falsa||'').trim())c.falsa=String(t.falsa).trim();    // afirmación falsa (verdadero/falso)
          if(String(t.hueco_oracion||'').includes('____')&&String(t.hueco_respuesta||'').trim())c.hueco={o:String(t.hueco_oracion).trim(),r:String(t.hueco_respuesta).trim()};
          s.cards.push(c);
        }
      });
    });
    const avisoRecorte=pdfEscaneado?' 🔍 Era un PDF escaneado: revisa el contenido por si alguna parte no se leyó bien.':texto.length>IA_MAX_CHARS?` ⚠️ El archivo es muy largo: la IA analizó solo los primeros ${IA_MAX_CHARS.toLocaleString('es')} caracteres.`:'';
    const setEstado=txt=>{const st=$('iaStatus');if(st)st.textContent=txt};
    const base_ok=`✅ Listo — se creó el tema "${data.titulo}" con ${(data.tarjetas||[]).length} tarjetas.${desdeCache?' (resultado reutilizado, sin gastar IA ni cupo)':''}${avisoRecorte}${(!desdeCache&&iaRestantes()!=null)?' Te quedan '+iaRestantes()+' de '+IA_LIMITE_DIARIO+' archivos hoy.':''}`;
    setEstado(base_ok);
    /* Documento original: se guarda aparte de lo que genera la IA (solo en materias compartidas / de docente) */
    if(materia&&materia.sharedId&&materia.rol!=='estudiante'){
      const r=await guardarOriginal(materia,temaIdNuevo,file,txt=>setEstado(base_ok+' '+txt));
      if(r.ok){
        mutate(s=>{const tm=s.temas.find(x=>x.id===temaIdNuevo);if(tm)tm.archivo=r.meta});
        setEstado(base_ok+' 📎 Original guardado: los estudiantes podrán descargarlo.');
      }else{
        setEstado(base_ok+' ⚠️ '+r.mensaje);
        toast('⚠️ '+esc(r.mensaje));
      }
    }
  }catch(err){
    console.error(err);
    const st=$('iaStatus');
    if(st) st.textContent='❌ Algo falló: '+err.message;
  }finally{
    const bt=$('iaUploadBtn'); if(bt)bt.disabled=false;
    e.target.value='';
  }
});
/* Hecho por Sebastián Poveda y Santiago Romero. 2026 */
/* ======================================================================
   MATERIAS COMPARTIDAS
   Una materia compartida vive en Firestore como  temarios/{sharedId}
     - documento:           nombre, icono, dueño, miembros
     - subcolección temas:  un documento por tema (con sus tarjetas dentro)
   Cada persona conserva su propia copia local (m.sharedId la enlaza con el grupo).
   Es PERSONAL de cada quien: cortes, notas, calendario y si "sabía" una tarjeta.
   Es COMPARTIDO: temas, secciones, tarjetas y el autor / archivo de origen.
   ====================================================================== */
const SESION=uid();        // distingue mis escrituras de las de otras personas o dispositivos
const sharedLast={};       // temaId -> {sid,k}: último contenido sincronizado (evita reenviar lo que no cambió)
const sharedMeta={};       // sharedId -> datos del documento del grupo
const sharedUnsub={};      // sharedId -> funciones para dejar de escuchar
const sharedFirst={};      // sharedId -> true cuando ya llegó la primera lectura de temas
let pendingRender=false;

const refTemario=sid=>db.collection('temarios').doc(sid);
function miNombre(){
  const u=auth.currentUser;
  return String((state.profile&&state.profile.name)||(u&&u.displayName)||(u&&u.email&&u.email.split('@')[0])||'Alguien').trim();
}
function sharedMateria(materiaId){const m=state.materias.find(x=>x.id===materiaId);return m&&m.sharedId?m:null}
function nMiembros(m){const x=sharedMeta[m.sharedId];return x&&x.members?x.members.length:1}
function msgDelTema(id){
  const t=state.temas.find(x=>x.id===id);
  return t&&sharedMateria(t.materiaId)
    ?'Esta materia es compartida: el tema se eliminará para TODAS las personas del grupo. ¿Continuar?'
    :'¿Eliminar este tema y sus tarjetas?';
}

/* Contenido compartible de un tema (sin nada personal como corteId o "known") */
function contenidoTema(t){
  return{
    publicado:esDocenteMat(t.materiaId)?!!t.publicado:true,
    title:t.title||'',body:t.body||'',
    secciones:Array.isArray(t.secciones)?t.secciones:null,
    by:t.by||'',fuente:t.fuente||'',
    archivo:tieneOriginal(t.archivo)?t.archivo:null,
    ...(esDocenteMat(t.materiaId)?{corte:((state.cortes.find(c=>c.id===t.corteId)||{}).name||'')}:{}),
    cards:state.cards.filter(c=>c.temaId===t.id).map(c=>({id:c.id,front:c.front||'',back:c.back||''}))
  };
}

/* ---------- Subir mis cambios ---------- */
let pushingShared=false,repushShared=false;
async function pushShared(){
  if(!currentUid)return;
  if(pushingShared){repushShared=true;return}
  pushingShared=true;
  try{
    let huboFallo=false;
    for(const m of state.materias.filter(x=>x.sharedId)){
      try{await pushSharedMateria(m,false)}
      catch(e){console.error('No se pudo sincronizar "'+m.name+'":',e);huboFallo=true;sync.falloMateria='⚠️ No se pudo sincronizar la materia compartida "'+esc(m.name)+'": '+esc(textoFalloSync(e));pintarBanner()}
    }
    if(!huboFallo&&sync.falloMateria){sync.falloMateria='';pintarBanner()}
  }finally{
    pushingShared=false;
    if(repushShared){repushShared=false;pushShared()}
  }
}
/* force=true solo al compartir una materia que ya existía: sube todo lo que hay antes de escuchar */
async function pushSharedMateria(m,force){
  const sid=m.sharedId;
  if(m.rol==='estudiante')return;              // el estudiante nunca escribe contenido
  if(!force&&!sharedFirst[sid])return;       // hasta no ver lo que ya hay en la nube, no se escribe nada
  if(m.rol==='docente'&&sharedMeta[sid]&&(sharedMeta[sid].name!==m.name||(sharedMeta[sid].icon||'')!==(m.icon||'')))
    await refTemario(sid).update({name:m.name,icon:m.icon||'📘'});
  const base=refTemario(sid).collection('temas');
  const temas=state.temas.filter(t=>t.materiaId===m.id);
  const ids=new Set(temas.map(t=>t.id));
  const ops=[],hechos={},borrados=[];
  temas.forEach(t=>{
    const c=contenidoTema(t),k=JSON.stringify(c);
    if(sharedLast[t.id]&&sharedLast[t.id].k===k)return;
    const data=JSON.parse(JSON.stringify({...c,updatedAt:t.updatedAt||Date.now(),sess:SESION,editor:currentUid}));
    ops.push(b=>b.set(base.doc(t.id),data));
    hechos[t.id]=k;
  });
  Object.keys(sharedLast).forEach(id=>{
    if(sharedLast[id].sid===sid&&!ids.has(id)){ops.push(b=>b.delete(base.doc(id)));borrados.push(id)}
  });
  for(let i=0;i<ops.length;i+=400){
    const batch=db.batch();
    ops.slice(i,i+400).forEach(f=>f(batch));
    await batch.commit();
  }
  Object.keys(hechos).forEach(id=>{sharedLast[id]={sid,k:hechos[id]}});
  borrados.forEach(id=>delete sharedLast[id]);
}

/* ---------- Recibir cambios de otras personas ---------- */
function corteConNombre(materiaId,nombre){
  const n=String(nombre||'').trim().toLowerCase();
  let c=state.cortes.find(x=>x.materiaId===materiaId&&String(x.name||'').trim().toLowerCase()===n);
  if(!c){c={id:uid(),materiaId,name:String(nombre).trim(),weight:0,score:null};state.cortes.push(c)}
  return c.id;
}
function aplicarTemaRemoto(m,id,d){
  let t=state.temas.find(x=>x.id===id);
  if(!t){t={id,materiaId:m.id,corteId:null};state.temas.unshift(t)}
  t.materiaId=m.id;
  t.title=d.title||'';t.body=d.body||'';t.by=d.by||'';t.fuente=d.fuente||'';
  if(tieneOriginal(d.archivo))t.archivo=d.archivo;else delete t.archivo;
  /* Materia de docente: el tema queda en el corte que el docente le puso (se busca por nombre; si no existe, se crea) */
  if(m.rol==='estudiante'&&d.corte)t.corteId=corteConNombre(m.id,d.corte);
  if(typeof d.publicado==='boolean')t.publicado=d.publicado;else delete t.publicado;
  if(Array.isArray(d.secciones))t.secciones=d.secciones;else delete t.secciones;
  t.updatedAt=d.updatedAt||Date.now();
  const viejas=new Map(state.cards.filter(c=>c.temaId===id).map(c=>[c.id,c]));
  state.cards=state.cards.filter(c=>c.temaId!==id);
  (d.cards||[]).forEach(c=>state.cards.push({
    id:c.id,temaId:id,materiaId:m.id,front:c.front||'',back:c.back||'',
    known:viejas.has(c.id)?viejas.get(c.id).known:null     // "sabía esta tarjeta" es solo mío
  }));
  sharedLast[id]={sid:m.sharedId,k:JSON.stringify(contenidoTema(t))};
}
function quitarTemaLocal(id){
  state.temas=state.temas.filter(t=>t.id!==id);
  state.cards=state.cards.filter(c=>c.temaId!==id);
  delete sharedLast[id];
}
/* Repinta sin interrumpir: si estoy escribiendo, espera a que suelte el campo */
function renderSeguro(){
  if(!['materias','materiaDetail','perfil','docente','logros','docResultados','examenDoc','calendario'].includes(route.view))return;
  const a=document.activeElement;
  if(a&&a.matches&&a.matches('textarea,input,select')&&$('view').contains(a)){pendingRender=true;return}
  render(true);
}
document.addEventListener('focusout',()=>{
  if(!pendingRender)return;
  setTimeout(()=>{
    const a=document.activeElement;
    if(a&&a.matches&&a.matches('textarea,input,select')&&$('view').contains(a))return;
    pendingRender=false;renderSeguro();
  },150);
});

function escucharCompartida(m){
  const sid=m.sharedId;
  if(!sid||sharedUnsub[sid])return;
  const fallo=err=>{
    console.error('Materia compartida:',err);
    if(err&&(err.code==='permission-denied'||err.code==='not-found'))
      desvincularCompartida(sid,'Ya no tienes acceso a la materia compartida "'+m.name+'". Conservas una copia en tu cuaderno que ya no se sincroniza.');
  };
  const u1=refTemario(sid).onSnapshot(snap=>{
    if(!snap.exists||(snap.data()||{}).eliminado){
      desvincularCompartida(sid,'La materia compartida "'+m.name+'" fue eliminada por quien la creó. Conservas una copia en tu cuaderno que ya no se sincroniza.');
      return;
    }
    sharedMeta[sid]=snap.data();
    const loc=state.materias.find(x=>x.sharedId===sid);
    if(loc&&loc.rol==='estudiante'&&(loc.name!==sharedMeta[sid].name||loc.icon!==sharedMeta[sid].icon)){loc.name=sharedMeta[sid].name;loc.icon=sharedMeta[sid].icon||'📘';saveLocal()}
    renderSeguro();
  },fallo);
  const colTemas=refTemario(sid).collection('temas');
  const u2=(m.rol==='estudiante'?colTemas.where('publicado','==',true):colTemas).onSnapshot(snap=>{
    const mat=state.materias.find(x=>x.sharedId===sid);
    if(!mat)return;
    let cambio=false;
    if(!sharedFirst[sid]){
      /* Primera lectura: lo que hay en la nube manda. Se descarta lo local que ya no existe allá. */
      const remotos=new Set(snap.docs.map(d=>d.id));
      const viejos=state.temas.filter(t=>t.materiaId===mat.id&&!remotos.has(t.id)).map(t=>t.id);
      viejos.forEach(quitarTemaLocal);
      snap.docs.forEach(d=>aplicarTemaRemoto(mat,d.id,d.data()));
      sharedFirst[sid]=true;cambio=true;
    }else{
      snap.docChanges().forEach(ch=>{
        if(ch.doc.metadata.hasPendingWrites)return;                    // es mi propio cambio todavía en camino
        if(ch.type==='removed'){
          if(sharedMeta[sid]&&sharedMeta[sid].eliminado)return;        // el grupo se está borrando: conservo mi copia
          quitarTemaLocal(ch.doc.id);cambio=true;
        }else{
          const d=ch.doc.data();
          if(d.sess===SESION)return;                                   // lo escribí yo en esta sesión
          aplicarTemaRemoto(mat,ch.doc.id,d);cambio=true;
        }
      });
    }
    if(cambio){ensureCortes();saveLocal();renderSeguro()}
    if(mat.rol==='estudiante')anunciarNuevos(mat,'tema',snap.docs.map(d=>({id:d.id,titulo:d.data().title||'Sin título'})));
  },fallo);
  sharedUnsub[sid]=[u1,u2];
  if(m.rol==='docente')sharedUnsub[sid].push(escucharInvitaciones(sid));
  if(m.rol==='docente'||m.rol==='estudiante')escucharExamenes(m).forEach(f=>sharedUnsub[sid].push(f));
  if(m.rol==='docente'||m.rol==='estudiante')sharedUnsub[sid].push(escucharEventos(m));
}
function detener(sid){
  (sharedUnsub[sid]||[]).forEach(f=>{try{f()}catch(e){}});
  delete sharedUnsub[sid];delete sharedFirst[sid];delete sharedMeta[sid];delete invitMap[sid];limpiarExamenes(sid);
}
function olvidarTemas(sid){Object.keys(sharedLast).forEach(id=>{if(sharedLast[id].sid===sid)delete sharedLast[id]})}
function startShared(){stopShared();state.materias.filter(m=>m.sharedId).forEach(escucharCompartida)}
function stopShared(){
  Object.keys(sharedUnsub).forEach(detener);Object.keys(sharedLast).forEach(k=>delete sharedLast[k]);
  if(invitesUnsub){invitesUnsub();invitesUnsub=null}
  invitesPend=[];
}

/* La materia deja de estar enlazada al grupo pero la copia local se conserva */
function desvincularCompartida(sid,aviso){
  detener(sid);olvidarTemas(sid);
  state.materias.forEach(m=>{if(m.sharedId===sid)hacerLocal(m)});
  saveLocal();scheduleCloud();renderSeguro();
  if(aviso)setTimeout(()=>alert(aviso),50);
}

/* ---------- Crear, compartir, unirse, salir ---------- */
async function crearCompartida(semId){
  const name=prompt('Nombre de la materia compartida (ej. Ética con Santiago):');
  if(!name||!name.trim())return;
  const icon=prompt('Emoji (opcional):','📘')||'📘';
  const ref=db.collection('temarios').doc();
  try{
    await ref.set({name:name.trim(),icon,ownerUid:currentUid,members:[currentUid],
      memberNames:{[currentUid]:miNombre()},createdAt:firebase.firestore.FieldValue.serverTimestamp()});
  }catch(e){console.error(e);alert('No se pudo crear la materia compartida. Revisa las reglas de Firestore y tu conexión.');return}
  mutate(s=>s.materias.push({id:uid(),name:name.trim(),icon,semesterId:semId,refs:'',sharedId:ref.id}));
  const m=state.materias.find(x=>x.sharedId===ref.id);
  escucharCompartida(m);
  route={view:'materiaDetail',materiaId:m.id};render();
}
async function compartirMateria(m){
  if(m.sharedId)return;
  const ref=db.collection('temarios').doc();
  try{
    await ref.set({name:m.name,icon:m.icon||'📘',ownerUid:currentUid,members:[currentUid],
      memberNames:{[currentUid]:miNombre()},createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    m.sharedId=ref.id;
    await pushSharedMateria(m,true);            // sube los temas que ya tenías antes de empezar a escuchar
  }catch(e){
    console.error(e);delete m.sharedId;olvidarTemas(ref.id);
    alert('No se pudo compartir la materia. Revisa las reglas de Firestore y tu conexión.');return;
  }
  persist();escucharCompartida(m);render(true);
}
async function unirseCompartida(codigo){
  codigo=String(codigo||'').trim();
  const enlace=codigo.match(/[?&]unirse=([A-Za-z0-9]+)/);if(enlace)codigo=enlace[1];
  if(!/^[A-Za-z0-9]{10,40}$/.test(codigo)){alert('Ese código no es válido. Pídele a tu compañero que te lo envíe de nuevo.');return}
  const ya=state.materias.find(x=>x.sharedId===codigo);
  if(ya){route={view:'materiaDetail',materiaId:ya.id};render();return}
  try{
    const ref=refTemario(codigo),F=firebase.firestore.FieldValue;
    await ref.update({members:F.arrayUnion(currentUid),['memberNames.'+currentUid]:miNombre()});
    const d=(await ref.get()).data();
    mutate(s=>{
      s.materias.push({id:uid(),name:d.name,icon:d.icon||'📘',semesterId:semVisible(s).id,refs:'',sharedId:codigo});
    });
    const m=state.materias.find(x=>x.sharedId===codigo);
    escucharCompartida(m);
    route={view:'materiaDetail',materiaId:m.id};render();
  }catch(e){
    console.error(e);
    alert('No encontré esa materia compartida o no tienes permiso para entrar. Revisa que el código esté completo.');
  }
}
async function abandonarCompartida(m,opts){
  opts=opts||{};
  const sid=m.sharedId;if(!sid)return;
  const eraDocente=m.rol==='docente';
  const meta=sharedMeta[sid]||{};
  const soyDueno=meta.ownerUid===currentUid;
  const soyUltimo=Array.isArray(meta.members)&&meta.members.length<=1;
  detener(sid);olvidarTemas(sid);
  hacerLocal(m);                                // desde aquí ya no se sincroniza nada de esta materia
  try{
    if((opts.todos&&soyDueno)||soyUltimo){
      const ref=refTemario(sid);
      if(!soyUltimo){                           // avisa primero para que los demás conserven su copia
        await ref.update({eliminado:true});
        await new Promise(r=>setTimeout(r,1500));
      }
      const qs=await ref.collection('temas').get();
      for(const d of qs.docs){const ar=(d.data()||{}).archivo;if(tieneOriginal(ar))await borrarOriginalNube(sid,d.id,ar.partes,ar)}
      for(let i=0;i<qs.docs.length;i+=400){
        const b=db.batch();qs.docs.slice(i,i+400).forEach(d=>b.delete(d.ref));await b.commit();
      }
      if(eraDocente)await borrarInvitaciones(sid);
      await ref.delete();
    }else{
      const F=firebase.firestore.FieldValue;
      await refTemario(sid).update({members:F.arrayRemove(currentUid),['memberNames.'+currentUid]:F.delete()});
    }
  }catch(e){
    console.error(e);
    if(!opts.silent)alert('Saliste de la materia en tu cuaderno, pero no se pudo avisar a la nube: '+e.message);
  }
}
function procesarUnirsePendiente(){
  let c=null;
  try{c=sessionStorage.getItem('unirse');sessionStorage.removeItem('unirse')}catch(e){}
  if(c&&confirm('Te invitaron a una materia compartida. ¿Quieres unirte?'))unirseCompartida(c);
}
/* Enlace de invitación: tuapp.netlify.app/?unirse=CODIGO (se guarda hasta que la persona inicie sesión) */
try{
  const p=new URLSearchParams(location.search).get('unirse');
  if(p){sessionStorage.setItem('unirse',p);history.replaceState(null,'',location.pathname)}
}catch(e){}

/* ---------- Interfaz ---------- */
function compartidoBoxHTML(m){
  if(!m.sharedId){
    return `<div class="card shareBox" style="margin-top:14px">
      <b style="font-size:.9em">🤝 Estudiar con otras personas</b>
      <p class="meta" style="margin:4px 0 0">Comparte esta materia con tus compañeros: todos pueden subir archivos y editar temas y tarjetas, y el grupo ve los cambios al instante. Tus cortes y notas siguen siendo solo tuyos.</p>
      <button class="sec" style="margin-top:10px" data-action="shareMateria" data-id="${m.id}">🤝 Compartir esta materia</button>
    </div>`;
  }
  const meta=sharedMeta[m.sharedId];
  if(!meta)return `<div class="card shareBox" style="margin-top:14px"><b style="font-size:.9em">🤝 Materia compartida</b><p class="meta" style="margin:4px 0 0">Conectando con el grupo…</p></div>`;
  const dueno=meta.ownerUid===currentUid;
  const nombres=(meta.members||[]).map(id=>{
    const n=(meta.memberNames||{})[id]||'Alguien';
    return `<span class="chip">${id===currentUid?'⭐ Tú':'👤 '+esc(n)}${id===meta.ownerUid?' · creó':''}</span>`;
  }).join('');
  return `<div class="card shareBox" style="margin-top:14px">
    <b style="font-size:.9em">🤝 Materia compartida · ${(meta.members||[]).length} persona${(meta.members||[]).length==1?'':'s'}</b>
    <div class="members">${nombres}</div>
    <p class="meta" style="margin:0">Para invitar a alguien, envíale el enlace (o el código). Tiene que iniciar sesión para entrar. Quien tenga el código puede unirse, así que compártelo solo con tu grupo.</p>
    <p class="meta" style="margin:6px 0 0">Código: <code>${esc(m.sharedId)}</code></p>
    <div class="row">
      <button class="sec" data-action="copyInvite" data-id="${m.id}">🔗 Copiar enlace</button>
      <button class="sec" data-action="copyCode" data-id="${m.id}">📋 Copiar código</button>
      <button class="sec" data-action="leaveShared" data-id="${m.id}">🚪 Salir del grupo</button>
      ${dueno?`<button class="sec" data-action="deleteShared" data-id="${m.id}">🗑️ Eliminar para todos</button>`:''}
    </div>
  </div>`;
}
async function copiar(texto,btn){
  const viejo=btn.textContent;
  try{await navigator.clipboard.writeText(texto);btn.textContent='✓ Copiado';setTimeout(()=>{btn.textContent=viejo},1500)}
  catch(e){prompt('Copia esto:',texto)}
}
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-action]');if(!b)return;
  const a=b.dataset.action;
  const m=b.dataset.id?state.materias.find(x=>x.id===b.dataset.id):null;
  if(a==='createShared')crearCompartida(b.dataset.sem);
  else if(a==='joinSharedPrompt'){const c=prompt('Pega el código o el enlace de invitación:');if(c)unirseCompartida(c)}
  else if(a==='shareMateria'&&m)compartirMateria(m);
  else if(a==='copyInvite'&&m)copiar(location.origin+location.pathname+'?unirse='+m.sharedId,b);
  else if(a==='copyCode'&&m)copiar(m.sharedId,b);
  else if(a==='leaveShared'&&m){
    if(confirm('¿Salir de esta materia compartida? Conservas una copia en tu cuaderno, pero ya no se sincroniza con el grupo.')){
      await abandonarCompartida(m);persist();render();
    }
  }
  else if(a==='deleteShared'&&m){
    if(confirm('¿Eliminar la materia compartida para TODAS las personas? Cada quien conservará una copia en su cuaderno, pero el grupo dejará de existir.')){
      await abandonarCompartida(m,{todos:true});persist();render();
    }
  }
});


/* ======================================================================
   ESPACIO DOCENTE
   - Una materia de docente es un temario con tipo:'docente' (Firestore: temarios/{id}).
   - El docente es el único que escribe. Cada tema tiene publicado:true/false.
   - Los estudiantes entran por INVITACIÓN a su correo (colección invitaciones/{sid}_{correo}),
     ven solo los temas publicados y el contenido es de solo lectura para ellos.
   - En el cuaderno de cada persona: m.rol = 'docente' | 'estudiante'.
     Las materias de docente viven en un semestre oculto ('sem-docente') para no mezclarse
     con las materias del estudiante.
   ====================================================================== */
const invitMap={};        // sid -> invitaciones que envié como docente
let invitesPend=[];       // invitaciones pendientes dirigidas a mi correo
let invitesUnsub=null;

function esDocenteMat(materiaId){const m=state.materias.find(x=>x.id===materiaId);return !!(m&&m.rol==='docente')}
function nombreDocente(m){const x=sharedMeta[m.sharedId];return x?((x.memberNames||{})[x.ownerUid]||'tu docente'):'tu docente'}
function semDocente(s){
  let x=s.semesters.find(y=>y.id==='sem-docente');
  if(!x){x={id:'sem-docente',name:'Docente',oculto:true};s.semesters.push(x)}
  return x;
}
function semVisible(s){
  const v=s.semesters.filter(x=>!x.oculto);
  if(v.length)return v[v.length-1];
  const n={id:uid(),name:'Semestre 1'};s.semesters.push(n);return n;
}
/* Deja de estar enlazada al grupo pero se conserva como materia normal y editable */
function hacerLocal(m){
  delete m.sharedId;delete m.rol;
  if(state.semesters.some(x=>x.id===m.semesterId&&x.oculto))m.semesterId=semVisible(state).id;
}

/* ---------- Crear materia como docente ---------- */
async function crearDocente(){
  const name=prompt('Nombre de la materia (ej. Ética profesional – Grupo A):');
  if(!name||!name.trim())return;
  const icon=prompt('Emoji (opcional):','📘')||'📘';
  const ref=db.collection('temarios').doc();
  try{
    await ref.set({tipo:'docente',name:name.trim(),icon,ownerUid:currentUid,members:[currentUid],
      memberNames:{[currentUid]:miNombre()},createdAt:firebase.firestore.FieldValue.serverTimestamp()});
  }catch(e){console.error(e);alert('No se pudo crear la materia'+detalleError(e)+'. Revisa las reglas de Firestore y tu conexión.');return}
  mutate(s=>s.materias.push({id:uid(),name:name.trim(),icon,semesterId:semDocente(s).id,refs:'',sharedId:ref.id,rol:'docente'}));
  const m=state.materias.find(x=>x.sharedId===ref.id);
  escucharCompartida(m);
  route={view:'materiaDetail',materiaId:m.id};render();
}

/* ---------- Invitaciones (docente) ---------- */
function escucharInvitaciones(sid){
  return db.collection('invitaciones').where('sid','==',sid).where('ownerUid','==',currentUid).onSnapshot(snap=>{
    invitMap[sid]=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderSeguro();
  },err=>console.error('Invitaciones:',err));
}
async function invitarEstudiantes(m){
  const box=$('invEmails');if(!box)return;
  const crudos=[...new Set(box.value.split(/[\s,;]+/).map(x=>x.trim().toLowerCase()).filter(Boolean))];
  const valido=e=>/^[^\s@\/\\]+@[^\s@\/\\]+\.[^\s@\/\\]+$/.test(e);
  const buenos=crudos.filter(valido),malos=crudos.filter(e=>!valido(e));
  const yo=(auth.currentUser.email||'').toLowerCase();
  const existentes=new Set((invitMap[m.sharedId]||[]).map(i=>i.email));
  const nuevos=buenos.filter(e=>e!==yo&&!existentes.has(e));
  if(!nuevos.length){alert(malos.length?'Estos correos no son válidos: '+malos.join(', '):'No hay correos nuevos para invitar.');return}
  try{
    for(let i=0;i<nuevos.length;i+=400){
      const b=db.batch();
      nuevos.slice(i,i+400).forEach(email=>b.set(db.collection('invitaciones').doc(m.sharedId+'_'+email),{
        sid:m.sharedId,email,materia:m.name,icon:m.icon||'📘',docente:miNombre(),ownerUid:currentUid,
        estado:'pendiente',createdAt:firebase.firestore.FieldValue.serverTimestamp()}));
      await b.commit();
    }
    box.value='';
    alert('Invitaciones enviadas a '+nuevos.length+' persona'+(nuevos.length==1?'':'s')+'.'+(malos.length?'\nNo válidos (se omitieron): '+malos.join(', '):''));
  }catch(e){console.error(e);alert('No se pudieron enviar las invitaciones'+detalleError(e)+'. Si dice permission-denied, falta publicar las reglas nuevas de Firestore.')}
}
async function quitarInvitacion(m,invId){
  const inv=(invitMap[m.sharedId]||[]).find(x=>x.id===invId);if(!inv)return;
  if(!confirm(inv.uid?'¿Quitar a '+(inv.nombre||inv.email)+' de la materia? Conservará una copia de lo que ya tenía, pero ya no recibirá más cambios.':'¿Cancelar la invitación a '+inv.email+'?'))return;
  try{
    if(inv.uid){const F=firebase.firestore.FieldValue;
      await refTemario(m.sharedId).update({members:F.arrayRemove(inv.uid),['memberNames.'+inv.uid]:F.delete()})}
    await db.collection('invitaciones').doc(invId).delete();
  }catch(e){console.error(e);alert('No se pudo completar la acción.')}
}
async function borrarInvitaciones(sid){
  const qs=await db.collection('invitaciones').where('sid','==',sid).where('ownerUid','==',currentUid).get();
  for(let i=0;i<qs.docs.length;i+=400){
    const b=db.batch();qs.docs.slice(i,i+400).forEach(d=>b.delete(d.ref));await b.commit();
  }
}

/* ---------- Publicar / borrador ---------- */
function avisoPublicado(){toast('📣 Publicado. Tus estudiantes verán un aviso 🔔 cuando abran Auren.')}
function publicarTema(id){
  mutate(s=>{const t=s.temas.find(x=>x.id===id);if(t)t.publicado=!t.publicado});
  const t=state.temas.find(x=>x.id===id);if(t&&t.publicado&&esDocenteMat(t.materiaId))avisoPublicado();
}
function publicarTodos(m){
  const borradores=state.temas.filter(t=>t.materiaId===m.id&&!t.publicado);
  if(!borradores.length)return;
  if(!confirm('¿Publicar '+borradores.length+' tema'+(borradores.length==1?'':'s')+' a todos tus estudiantes?'))return;
  mutate(s=>s.temas.forEach(t=>{if(t.materiaId===m.id)t.publicado=true}));
  avisoPublicado();
}

/* ---------- Invitaciones recibidas (estudiante) ---------- */
function escucharMisInvitaciones(){
  if(invitesUnsub){invitesUnsub();invitesUnsub=null}
  const u=auth.currentUser;
  if(!u||!u.email||!u.emailVerified){invitesPend=[];return}
  invitesUnsub=db.collection('invitaciones').where('email','==',u.email.toLowerCase()).where('estado','==','pendiente')
    .onSnapshot(snap=>{
      invitesPend=snap.docs.map(d=>({id:d.id,...d.data()}));
      renderSeguro();
    },err=>console.error('Mis invitaciones:',err));
}
async function aceptarInvitacion(invId){
  const inv=invitesPend.find(x=>x.id===invId);if(!inv)return;
  try{
    const ref=refTemario(inv.sid),F=firebase.firestore.FieldValue;
    await ref.update({members:F.arrayUnion(currentUid),['memberNames.'+currentUid]:miNombre()});
    await db.collection('invitaciones').doc(invId).update({estado:'aceptada',uid:currentUid,nombre:miNombre()});
    const d=(await ref.get()).data();
    if(!state.materias.some(x=>x.sharedId===inv.sid)){
      mutate(s=>s.materias.push({id:uid(),name:d.name,icon:d.icon||'📘',semesterId:semVisible(s).id,refs:'',sharedId:inv.sid,rol:'estudiante'}));
    }
    const m=state.materias.find(x=>x.sharedId===inv.sid);
    escucharCompartida(m);
    route={view:'materiaDetail',materiaId:m.id};render();
  }catch(e){console.error(e);alert('No se pudo aceptar la invitación'+detalleError(e)+'. Inténtalo de nuevo.')}
}
async function rechazarInvitacion(invId){
  if(!confirm('¿Rechazar esta invitación?'))return;
  try{await db.collection('invitaciones').doc(invId).update({estado:'rechazada',nombre:miNombre()})}
  catch(e){console.error(e);alert('No se pudo rechazar la invitación.')}
}

/* ---------- Interfaz ---------- */
function invitacionesHTML(){
  const u=auth.currentUser;if(!u)return'';
  if(!u.emailVerified){
    return `<div class="card shareBox" style="margin-bottom:14px"><p class="meta" style="margin:0">📨 ¿Te invitó un docente a una materia? Verifica tu correo para ver sus invitaciones.</p>
      <div class="row"><button class="sec" data-action="verifyEmail">Enviar correo de verificación</button><button class="sec" data-action="recheckVerified">Ya verifiqué</button></div></div>`;
  }
  if(!invitesPend.length)return'';
  return `<div class="card shareBox" style="margin-bottom:14px"><b style="font-size:.9em">📨 Invitaciones de docentes</b>
    ${invitesPend.map(i=>`<div style="margin-top:10px"><div>${esc(i.icon||'📘')} <b>${esc(i.materia)}</b> <span class="meta">· ${esc(i.docente||'Docente')}</span></div>
      <div class="row"><button class="pr" data-action="acceptInvite" data-inv="${esc(i.id)}">✓ Aceptar</button><button class="sec" data-action="declineInvite" data-inv="${esc(i.id)}">Rechazar</button></div></div>`).join('')}
  </div>`;
}
function estudianteDocenteBoxHTML(m){
  return `<div class="card shareBox" style="margin-top:14px">
    <b style="font-size:.9em">👩‍🏫 Materia de ${esc(nombreDocente(m))}</b>
    <p class="meta" style="margin:4px 0 0">El contenido lo publica tu docente y se actualiza solo. Es de solo lectura. Tus cortes, notas y tu progreso en las tarjetas son solo tuyos.</p>
    <div class="row"><button class="sec" data-action="leaveShared" data-id="${m.id}">🚪 Salir de la materia</button></div>
  </div>`;
}
function docenteCard(m){
  const temas=state.temas.filter(t=>t.materiaId===m.id);
  const pub=temas.filter(t=>t.publicado).length;
  const invs=invitMap[m.sharedId]||[];
  const unidos=invs.filter(i=>i.estado==='aceptada').length;
  const nEx=Object.keys(exMap[m.sharedId]||{}).length;
  return `<div class="card matCard">
    <h3>${esc(m.icon||'📘')} ${esc(m.name)}</h3>
    <p class="meta">${temas.length} tema${temas.length==1?'':'s'} · ${pub} publicado${pub==1?'':'s'} · ${unidos} estudiante${unidos==1?'':'s'} · ${nEx} examen${nEx==1?'':'es'}</p>
    <div class="row">
      <button class="sec" data-action="openMateria" data-id="${m.id}">Abrir →</button>
      <button class="icon-btn" data-action="renameMateria" data-id="${m.id}" title="Editar materia">✏️</button>
      <button class="icon-btn" data-action="delMateria" data-id="${m.id}" title="Eliminar materia para todos">🗑️</button>
    </div>
  </div>`;
}
function viewDocenteHTML(){
  const mats=state.materias.filter(m=>m.rol==='docente');
  return `<div class="viewhead"><h1>👩‍🏫 Espacio docente</h1><button class="pr" data-action="createDocente">+ Crear materia</button></div>
    ${mats.length?`<div class="grid">${mats.map(docenteCard).join('')}</div>`
    :`<div class="empty">Aquí creas tus materias como docente: subes un PDF, la IA genera el tema y las tarjetas, tú los revisas y los publicas, e invitas a tus estudiantes por correo. Ellos las ven en su cuaderno, en solo lectura.</div>`}`;
}
/* En materias de docente, el estudiante no puede editar el contenido compartido */
function aplicarSoloLectura(){
  const m=route.view==='materiaDetail'?state.materias.find(x=>x.id===route.materiaId):null;
  if(!m||m.rol!=='estudiante')return;
  $('view').querySelectorAll('input[data-action^="editTema"],textarea[data-action^="editTema"],input[data-action^="editSec"],textarea[data-action^="editSec"],input[data-action^="editCard"],textarea[data-action^="editCard"]')
    .forEach(el=>{el.readOnly=true});
}

document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-action]');if(!b)return;
  const a=b.dataset.action;
  const m=b.dataset.id?state.materias.find(x=>x.id===b.dataset.id):null;
  if(a==='createDocente')crearDocente();
  else if(a==='backDocente')goToView('docente');
  else if(a==='inviteStudents'&&m)invitarEstudiantes(m);
  else if(a==='removeInvite'&&m)quitarInvitacion(m,b.dataset.inv);
  else if(a==='togglePublicar')publicarTema(b.dataset.id);
  else if(a==='publishAll'&&m)publicarTodos(m);
  else if(a==='acceptInvite')aceptarInvitacion(b.dataset.inv);
  else if(a==='declineInvite')rechazarInvitacion(b.dataset.inv);
  else if(a==='verifyEmail'){
    try{await auth.currentUser.sendEmailVerification();alert('Te enviamos un correo de verificación. Ábrelo y luego pulsa "Ya verifiqué".')}
    catch(err){console.error(err);alert('No se pudo enviar el correo. Inténtalo de nuevo en unos minutos.')}
  }
  else if(a==='recheckVerified'){
    try{
      await auth.currentUser.reload();await auth.currentUser.getIdToken(true);
      if(auth.currentUser.emailVerified){escucharMisInvitaciones();render()}
      else alert('Todavía no aparece verificado. Abre el enlace del correo y vuelve a intentarlo.');
    }catch(err){console.error(err)}
  }
});


/* ======================================================================
   RACHAS, ESTAMPILLAS Y CAMINO AL ÉXITO  (Etapa 4)
   Todo vive en state.progress, que ya se guarda y sincroniza con la cuenta:
     days:    días (AAAA-MM-DD, hora local) con una sesión válida de Modo examen
     badges:  insignias y estampillas desbloqueadas  { id: fecha }
     sellos:  etapas del Camino al éxito completadas { corteId: {t,materia,corte} }
     exams:   total de sesiones válidas (se conserva aunque borres una materia)
   Sesión válida = terminar el Modo examen con al menos MIN_PREGUNTAS preguntas.
   ====================================================================== */
const MIN_PREGUNTAS=5;     // mínimo de preguntas para que un examen cuente en el Camino al éxito y en las insignias de rendimiento
const META_RACHA=10;       // preguntas al día (Quiz o Modo examen) que aseguran la racha. Las demás son práctica extra.
const HITOS_RACHA=[3,10,15,30];
const NIVELES=['Novato','Aprendiz','Estudioso','Constante','Experto','Maestro','Leyenda'];
let logrosTab='racha';
let logrosMat=null;

function fechaLocal(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function numDia(s){const[y,m,d]=s.split('-').map(Number);return Math.round(Date.UTC(y,m-1,d)/86400000)}   // sin problemas de cambio de hora
function progresoHoy(){const p=state.progress||{},f=fechaLocal(new Date());return(p.dia&&p.dia.f===f)?p.dia:{f,racha:0,extra:0}}
function esValida(a){return !!(a&&a.type==='examen'&&a.total>=MIN_PREGUNTAS)}

/* Día de gracia: 1 por semana (lunes a domingo). Si te saltas UN día y estudiaste el anterior, ese hueco se cubre solo
   y la racha sigue. El día cubierto no suma a la racha, solo evita que se rompa. */
function semanaDe(n){return Math.floor((n+3)/7)}       // n = numDia; el día 0 (1-ene-1970) fue jueves
function rachaInfo(days){
  const set=new Set((days||[]).map(numDia));
  const hoy=numDia(fechaLocal(new Date()));
  let d=hoy,n=0;
  const usadas=new Set(),congelados=[];
  if(!set.has(d))d--;                               // si hoy todavía no estudias, la racha sigue viva hasta que acabe el día
  for(;;){
    if(set.has(d)){n++;d--;continue}
    if(set.has(d-1)&&!usadas.has(semanaDe(d))){usadas.add(semanaDe(d));congelados.push(d);d--;continue}
    break;
  }
  return{racha:n,congelados,graciaDisponible:!usadas.has(semanaDe(hoy)),hoy};
}
function rachaActual(days){return rachaInfo(days).racha}
function mejorRacha(days){
  const ds=[...new Set((days||[]).map(numDia))].sort((a,b)=>a-b);
  let mejor=0,run=0,prev=null,usadas=new Set();
  ds.forEach(d=>{
    if(prev===null){run=1;usadas=new Set()}
    else if(d===prev+1)run++;
    else if(d===prev+2&&!usadas.has(semanaDe(prev+1))){usadas.add(semanaDe(prev+1));run++}
    else{run=1;usadas=new Set()}
    prev=d;if(run>mejor)mejor=run;
  });
  return mejor;
}

/* ---------- Insignias y estampillas ---------- */
const BADGES=[
  {id:'primer_examen',icon:'📝',nombre:'Primer examen',tipo:'meta',desc:'Termina tu primer Modo examen (mínimo '+MIN_PREGUNTAS+' preguntas).',test:c=>c.p.exams>=1},
  {id:'racha_3',icon:'🌱',nombre:'Insignia de inicio',tipo:'constancia',desc:'3 días seguidos completando tus '+META_RACHA+' preguntas diarias.',test:c=>c.mejor>=3},
  {id:'racha_10',icon:'🔥',nombre:'Estampilla de constancia',tipo:'constancia',desc:'10 días seguidos de estudio.',test:c=>c.mejor>=10},
  {id:'racha_15',icon:'⭐',nombre:'Estampilla especial',tipo:'constancia',desc:'15 días seguidos de estudio.',test:c=>c.mejor>=15},
  {id:'racha_30',icon:'🏆',nombre:'Insignia de disciplina',tipo:'constancia',desc:'30 días seguidos de estudio.',test:c=>c.mejor>=30},
  {id:'perfecto',icon:'💯',nombre:'Examen perfecto',tipo:'rendimiento',desc:'Responde todas las preguntas bien en un Modo examen.',
    test:c=>!!c.att&&esValida(c.att)&&c.att.score===c.att.total},
  {id:'mejora',icon:'📈',nombre:'Estampilla de mejora',tipo:'rendimiento',desc:'Supera en 10 puntos o más tu mejor resultado anterior en la misma materia.',
    test:c=>{
      if(!c.att||!esValida(c.att))return false;
      const prev=state.attempts.filter(a=>a.materiaId===c.att.materiaId&&a.id!==c.att.id&&esValida(a));
      if(!prev.length)return false;
      const mejorPrev=Math.max(...prev.map(a=>a.score/a.total));
      return c.att.score/c.att.total>=mejorPrev+0.1;
    }},
  {id:'dominio',icon:'🧠',nombre:'Dominio',tipo:'rendimiento',desc:'Domina el 80% de las tarjetas de una materia (con al menos 10 tarjetas).',
    test:()=>state.materias.some(m=>{
      if(m.rol==='docente')return false;
      const cs=getCards(m.id);
      return cs.length>=10&&cs.filter(k=>k.known===true).length/cs.length>=0.8;
    })},
  {id:'meta_nota',icon:'🎯',nombre:'Meta alcanzada',tipo:'rendimiento',desc:'Asegura tu nota meta en una materia con las notas de tus cortes.',
    test:()=>state.materias.some(m=>{
      if(m.rol==='docente')return false;
      const k=corteStats(state.cortes.filter(c=>c.materiaId===m.id));
      return k.W>0&&k.Ws>0&&k.goal>0&&k.acum>=k.goal;
    })}
];

function sembrarProgreso(){
  const p=state.progress=state.progress||{};
  p.days=p.days||[];p.badges=p.badges||{};p.sellos=p.sellos||{};p.exams=p.exams||0;
  if(p.sembrado)return;
  /* Primera vez con esta función: se cuenta lo que ya habías hecho para no empezar de cero */
  const validos=(state.attempts||[]).filter(esValida);
  validos.forEach(a=>{const d=fechaLocal(new Date(a.date));if(!p.days.includes(d))p.days.push(d)});
  p.days.sort();
  p.exams=Math.max(p.exams,validos.length);
  p.sembrado=true;
  try{evaluarLogros(null,true)}catch(e){console.error('Logros:',e)}   // los logros nunca deben impedir iniciar sesión
}

/* Revisa qué logros se cumplen ahora y los desbloquea. Devuelve los nuevos (para avisar). */
function evaluarLogros(att,enMutate){
  const p=state.progress,nuevos=[];
  const c={p,att,mejor:mejorRacha(p.days)};
  BADGES.forEach(b=>{
    if(!p.badges[b.id]&&b.test(c)){p.badges[b.id]=Date.now();nuevos.push({id:b.id,icon:b.icon,nombre:b.nombre})}
  });
  state.materias.filter(m=>m.rol!=='docente').forEach(m=>{
    state.cortes.filter(k=>k.materiaId===m.id).forEach(k=>{
      if(p.sellos[k.id])return;
      if(etapaCorte(m,k).completa){
        p.sellos[k.id]={t:Date.now(),materia:m.name,corte:k.name};
        nuevos.push({id:'corte_'+k.id,icon:'🏅',nombre:'Etapa completada: '+(k.name||'corte')+' · '+m.name});
      }
    });
  });
  if(nuevos.length&&!enMutate)persist();
  return nuevos;
}

/* Se llama al terminar un quiz o examen (dentro de mutate, que ya guarda y repinta) */
function registrarSesion(att){
  /* Cada pregunta contestada cuenta primero para la racha del día (hasta META_RACHA) y el resto es práctica extra.
     Se guarda en progress.dia y en el propio intento (att.racha / att.extra), así queda un registro verificable. */
  const p=state.progress,hoy=fechaLocal(new Date(att.date));
  const res={valida:false,diaNuevo:false,nuevos:[],racha:0,aporte:0,extra:0,hoyRacha:0,extraHoy:0,meta:META_RACHA};
  if(!p.dia||p.dia.f!==hoy)p.dia={f:hoy,racha:0,extra:0};
  const falta=Math.max(0,META_RACHA-p.dia.racha);
  res.aporte=Math.min(falta,att.total);res.extra=att.total-res.aporte;
  p.dia.racha+=res.aporte;p.dia.extra+=res.extra;
  att.racha=res.aporte;att.extra=res.extra;
  if(p.dia.racha>=META_RACHA&&!p.days.includes(hoy)){p.days.push(hoy);p.days.sort();res.diaNuevo=true}
  res.valida=p.days.includes(hoy);
  if(esValida(att))p.exams++;
  res.hoyRacha=p.dia.racha;res.extraHoy=p.dia.extra;
  res.racha=rachaActual(p.days);
  res.nuevos=evaluarLogros(att,true);
  return res;
}
/* Aciertos por corte de un examen: así el Camino al éxito sabe cómo vas en cada etapa */
function porCorteDe(questions){
  const out={};
  questions.forEach(q=>{
    const card=state.cards.find(c=>c.id===q.card.id)||q.card;
    const t=state.temas.find(x=>x.id===card.temaId);
    if(!t||!t.corteId)return;
    const o=out[t.corteId]=out[t.corteId]||{ok:0,total:0};
    o.total++;if(esAcierto(q))o.ok++;
  });
  return out;
}

function nivelDe(){
  const p=state.progress;
  const xp=p.days.length*20+(Object.keys(p.badges).length+Object.keys(p.sellos).length)*50;
  const nivel=Math.floor(Math.sqrt(xp/50))+1;
  const base=50*(nivel-1)*(nivel-1),sig=50*nivel*nivel;
  return{xp,nivel,nombre:NIVELES[Math.min(nivel-1,NIVELES.length-1)],pct:Math.round((xp-base)/(sig-base)*100),faltan:sig-xp};
}

/* ---------- Camino al éxito: una etapa por corte ---------- */
function etapaCorte(m,c){
  const tids=new Set(state.temas.filter(t=>t.materiaId===m.id&&t.corteId===c.id).map(t=>t.id));
  const cards=state.cards.filter(k=>tids.has(k.temaId)&&String(k.front||'').trim()&&String(k.back||'').trim());
  const dominadas=cards.filter(k=>k.known===true).length;
  const ints=state.attempts.filter(a=>a.materiaId===m.id&&esValida(a)&&a.porCorte&&a.porCorte[c.id]&&a.porCorte[c.id].total>=3);
  const dias=new Set(ints.map(a=>fechaLocal(new Date(a.date)))).size;
  const mejorPct=ints.reduce((mx,a)=>Math.max(mx,a.porCorte[c.id].ok/a.porCorte[c.id].total),0);
  const pctDom=cards.length?dominadas/cards.length:0;
  const objs=[
    {tipo:'material',icon:'📚',titulo:'Reúne tu material',detalle:Math.min(cards.length,5)+' / 5 tarjetas en este corte',hecho:cards.length>=5,prog:Math.min(1,cards.length/5)},
    {tipo:'constancia',icon:'🔥',titulo:'Practica en 2 días distintos',detalle:Math.min(dias,2)+' / 2 días con examen',hecho:dias>=2,prog:Math.min(1,dias/2)},
    {tipo:'rendimiento',icon:'🎯',titulo:'Saca 70% o más en un examen',detalle:ints.length?'Tu mejor resultado: '+Math.round(mejorPct*100)+'%':'Aún sin exámenes de este corte',hecho:mejorPct>=0.7,prog:Math.min(1,mejorPct/0.7)},
    {tipo:'dominio',icon:'🧠',titulo:'Domina el 70% de las tarjetas',detalle:dominadas+' de '+cards.length+' dominadas',hecho:cards.length>=5&&pctDom>=0.7,prog:Math.min(1,pctDom/0.7)}
  ];
  return{objs,hechos:objs.filter(o=>o.hecho).length,completa:objs.every(o=>o.hecho)};
}

/* ---------- Interfaz ---------- */
function toast(html){
  const t=document.createElement('div');t.className='toast';t.innerHTML=html;document.body.appendChild(t);
  setTimeout(()=>t.classList.add('on'),20);
  setTimeout(()=>{t.classList.remove('on');setTimeout(()=>t.remove(),400)},4200);
}
function avisarLogros(nuevos){
  (nuevos||[]).forEach((b,i)=>setTimeout(()=>toast('🎉 <b>¡Nuevo logro!</b><br>'+b.icon+' '+esc(b.nombre)),i*700));
}
function premiosHTML(){
  const pr=toolState&&toolState.premios;if(!pr)return'';
  const ok=pr.valida,falta=Math.max(0,pr.meta-pr.hoyRacha);
  return `<div class="card premio"><b>🔥 Racha: ${pr.racha} día${pr.racha==1?'':'s'}</b>
    ${pr.diaNuevo?'<span class="chip chipOk">+1 hoy</span>':ok?'<span class="chip">Racha de hoy asegurada</span>':''}
    <div class="bar"><i style="width:${Math.min(100,Math.round(pr.hoyRacha/pr.meta*100))}%"></i></div>
    <p class="meta" style="margin:6px 0 0">Preguntas de racha hoy: <b>${Math.min(pr.hoyRacha,pr.meta)}/${pr.meta}</b>${ok?'':' · te faltan <b>'+falta+'</b> para asegurar la racha de hoy'}${pr.extraHoy?' · práctica extra de hoy: <b>'+pr.extraHoy+'</b>':''}</p>
    ${pr.nuevos.map(b=>`<div style="margin-top:8px">🎉 Nuevo logro: ${b.icon} <b>${esc(b.nombre)}</b></div>`).join('')}
  </div>`;
}
function fmtFecha(ts){return new Date(ts).toLocaleDateString('es',{day:'numeric',month:'short'})}

function rachaTabHTML(){
  const p=state.progress,rInfo=rachaInfo(p.days),racha=rInfo.racha,mejor=Math.max(mejorRacha(p.days),racha),nv=nivelDe();
  const hoy=fechaLocal(new Date()),hoyHecho=p.days.includes(hoy),dh=progresoHoy(),hoyN=hoyHecho?Math.max(dh.racha,META_RACHA):dh.racha;
  const sig=HITOS_RACHA.find(h=>h>racha);
  const sigB=sig?BADGES.find(b=>b.id==='racha_'+sig):null;
  const tira=[];
  for(let i=13;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const s=fechaLocal(d);tira.push({s,on:p.days.includes(s),hoy:i===0,dia:d.toLocaleDateString('es',{weekday:'narrow'})})}
  const grupo=(tipo,titulo)=>`<h3 style="margin:22px 0 10px">${titulo}</h3><div class="badgeGrid">${BADGES.filter(b=>b.tipo===tipo).map(b=>{
    const t=p.badges[b.id];
    return `<div class="badgeC ${t?'':'lock'}"><div class="bIcon">${t?b.icon:'🔒'}</div><b>${esc(b.nombre)}</b><small>${esc(b.desc)}</small>${t?`<span class="chip chipOk">${fmtFecha(t)}</span>`:''}</div>`}).join('')}</div>`;
  const sellos=Object.values(p.sellos);
  return `
  <div class="card racha">
    <div class="rTop"><div class="rNum">🔥 ${racha}</div><div><b>${racha==1?'día':'días'} de racha</b><div class="meta">Mejor racha: ${mejor} día${mejor==1?'':'s'}</div></div></div>
    <p class="meta" style="margin:10px 0 0">${hoyHecho?'✅ La racha de hoy ya está asegurada.':racha>0?'⚠️ Responde tus '+META_RACHA+' preguntas de hoy (Quiz o Modo examen) para mantener la racha.':'Responde '+META_RACHA+' preguntas en un Quiz o Modo examen para empezar tu racha.'}</p>
    <div class="bar"><i style="width:${Math.min(100,Math.round(hoyN/META_RACHA*100))}%"></i></div>
    <p class="meta" style="margin:0 0 6px">Preguntas de racha hoy: <b>${hoyN}/${META_RACHA}</b>${dh.extra?' · práctica extra: <b>'+dh.extra+'</b>':''}. Después de las ${META_RACHA} puedes seguir practicando sin límite: se guardan como práctica extra y no cambian tu racha.</p>
    <div class="strip">${tira.map(d=>`<span class="dot ${d.on?'on':''} ${d.hoy?'hoy':''}" title="${d.s}">${d.dia}</span>`).join('')}</div>
    <p class="meta" style="margin:8px 0 0">🧊 ${rInfo.congelados.includes(rInfo.hoy-1)?'Ayer usaste tu <b>día de gracia</b>: tu racha sigue viva.':rInfo.graciaDisponible?'Tienes <b>1 día de gracia</b> esta semana: si un día no alcanzas, tu racha no se rompe.':'Ya usaste tu día de gracia de esta semana.'}</p>
    ${sigB?`<div class="bar"><i style="width:${Math.round(racha/sig*100)}%"></i></div><p class="meta" style="margin:0">Te faltan ${sig-racha} día${sig-racha==1?'':'s'} para ${sigB.icon} <b>${esc(sigB.nombre)}</b>.</p>`:'<p class="meta" style="margin:10px 0 0">🎉 ¡Completaste todos los hitos de racha!</p>'}
  </div>
  <div class="card" style="margin-top:12px">
    <div class="rTop"><div class="rNum" style="font-size:1.6em">⭐ ${nv.nivel}</div><div><b>Nivel ${nv.nivel} · ${esc(nv.nombre)}</b><div class="meta">${nv.xp} puntos · faltan ${nv.faltan} para el siguiente nivel</div></div></div>
    <div class="bar"><i style="width:${nv.pct}%"></i></div>
    <p class="meta" style="margin:0">Sumas 20 puntos por cada día que estudias y 50 por cada insignia o etapa completada. No dependen de tus notas.</p>
  </div>
  <p class="meta" style="margin-top:14px">Una sesión cuenta cuando terminas el <b>Modo examen</b> con al menos ${MIN_PREGUNTAS} preguntas. Cuenta una por día.</p>
  ${grupo('constancia','🔥 Constancia')}
  ${grupo('rendimiento','🎯 Rendimiento y metas')}
  ${grupo('meta','🚀 Primeros pasos')}
  ${sellos.length?`<h3 style="margin:22px 0 10px">🏅 Etapas completadas</h3><div class="badgeGrid">${sellos.map(s=>`<div class="badgeC"><div class="bIcon">🏅</div><b>${esc(s.corte||'Corte')}</b><small>${esc(s.materia||'')}</small><span class="chip chipOk">${fmtFecha(s.t)}</span></div>`).join('')}</div>`:''}`;
}

function caminoTabHTML(){
  const mats=state.materias.filter(m=>m.rol!=='docente');
  if(!mats.length)return '<div class="empty">Crea una materia y agrega temas con tarjetas para ver tu camino.</div>';
  const m=mats.find(x=>x.id===logrosMat)||mats[0];
  logrosMat=m.id;
  const cortes=state.cortes.filter(c=>c.materiaId===m.id);
  const etapas=cortes.map(c=>({c,e:etapaCorte(m,c)}));
  const actual=etapas.findIndex(x=>!x.e.completa);
  const todo=etapas.length&&actual===-1;
  const nombreTipo={material:'Material',constancia:'Constancia',rendimiento:'Rendimiento',dominio:'Dominio'};
  return `
  <label class="lbl" for="logrosMat">Materia</label>
  <select class="fld" id="logrosMat" data-action="logrosMat" style="max-width:320px">${mats.map(x=>`<option value="${x.id}" ${x.id===m.id?'selected':''}>${esc(x.icon||'📘')} ${esc(x.name)}</option>`).join('')}</select>
  <p class="meta" style="margin-top:8px">Cada corte es una etapa. Combina constancia (practicar varios días) con rendimiento (aciertos y dominio), así avanzas aunque todavía no tengas notas.</p>
  <div class="path">
    ${etapas.map(({c,e},i)=>{
      const estado=e.completa?'hecha':(i===actual?'actual':'pend');
      const sello=state.progress.sellos[c.id];
      return `<div class="stage ${estado}">
        <div class="node">${e.completa?'✓':(i===actual?'▶':i+1)}</div>
        <div class="card stCard">
          <div class="stHead"><b>${esc(c.name)||'(corte sin nombre)'}</b><span class="chip">${fmtN(+c.weight||0)}%</span>${e.completa?'<span class="chip chipOk">Completada</span>':i===actual?'<span class="chip" style="color:var(--a);border-color:var(--a)">Etapa actual</span>':''}</div>
          <div class="bar"><i style="width:${Math.round(e.hechos/e.objs.length*100)}%"></i></div>
          ${e.objs.map(o=>`<div class="obj ${o.hecho?'ok':''}"><span class="oi">${o.hecho?'✅':o.icon}</span><div><b>${o.titulo}</b> <small class="tipoT">${nombreTipo[o.tipo]}</small><div class="meta" style="margin:0">${o.detalle}</div>${o.hecho?'':`<div class="bar mini"><i style="width:${Math.round(o.prog*100)}%"></i></div>`}</div></div>`).join('')}
          <div class="reward ${sello?'':'lock'}">${sello?'🏅 Estampilla desbloqueada · '+fmtFecha(sello.t):'🔒 Completa los 4 objetivos para ganar la estampilla de esta etapa'}</div>
        </div>
      </div>`;
    }).join('')}
    <div class="stage ${todo?'hecha':'pend'}"><div class="node">🏆</div><div class="card stCard"><b>Meta final</b><div class="meta" style="margin:4px 0 0">${todo?'🎉 ¡Completaste todas las etapas de '+esc(m.name)+'!':'Completa todas las etapas de esta materia.'}</div></div></div>
  </div>`;
}

function viewLogrosHTML(){
  return `<div class="viewhead"><h1>🏆 Mis logros</h1></div>
  <div class="tabsT" style="margin-bottom:14px">
    <button type="button" data-action="logrosTab" data-tab="racha" class="${logrosTab==='racha'?'on':''}">🔥 Racha y estampillas</button>
    <button type="button" data-action="logrosTab" data-tab="camino" class="${logrosTab==='camino'?'on':''}">🗺️ Camino al éxito</button>
  </div>
  ${logrosTab==='camino'?caminoTabHTML():rachaTabHTML()}`;
}

document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');if(!b)return;
  if(b.dataset.action==='logrosTab'){logrosTab=b.dataset.tab;render(true)}
});
document.addEventListener('change',e=>{
  if(e.target.matches&&e.target.matches('[data-action="logrosMat"]')){logrosMat=e.target.value;render(true)}
});
/* Al entrar a Logros se revisa si hay algo nuevo (por ejemplo, una nota meta registrada) */
document.querySelectorAll('#mainNav [data-nav="logros"]').forEach(b=>b.addEventListener('click',()=>{
  const nuevos=evaluarLogros();
  if(nuevos.length){avisarLogros(nuevos);render(true)}
}));


/* ======================================================================
   ANIMACIONES Y EFECTOS
   - Las animaciones CSS están dentro de @media (prefers-reduced-motion:no-preference):
     si el dispositivo pide menos movimiento, no se mueve nada.
   - Los efectos en JavaScript (chispas, confeti, contador) también lo respetan.
   - El Modo examen NO revela aciertos mientras respondes (es un examen).
     Quien quiera feedback inmediato puede activar "Ver si acerté al instante".
   ====================================================================== */
let examInstantaneo=false;
let ultimaVista=null;

const FRASES_OK=['¡Correcto!','¡Muy bien!','¡Exacto!','¡Así se hace!','¡Perfecto!','¡Sigue así!'];
const FRASES_NO=['Casi…','Esta vez no, ¡pero así se aprende!','Ups, a repasar esta 🌱','No pasa nada, ya la sabrás'];

function reducido(){
  try{return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)}catch(e){return false}
}
function feedbackHTML(acierto,q,idx){
  return acierto
    ?`<div class="fb fbOk" role="status">🎉 ${FRASES_OK[idx%FRASES_OK.length]}</div>`
    :`<div class="fb fbNo" role="status">😕 ${FRASES_NO[idx%FRASES_NO.length]}<span>La correcta: <b>${esc(q.correcta)}</b></span></div>`;
}

/* Cada pantalla distinta (o cada pregunta nueva) entra con una animación suave */
function claveVista(){
  let k=route.view+':'+(route.materiaId||'')+':'+(route.tool||'')+':'+(route.examId||'');
  if(route.view==='materiaDetail')k+=':'+docTab;
  if(route.view==='tool'&&toolState&&typeof toolState.idx==='number')k+=':'+toolState.idx;
  if(route.view==='logros')k+=':'+logrosTab+':'+(logrosMat||'');
  return k;
}
function animarVista(){
  const v=$('view');if(!v)return;
  const k=claveVista(),nueva=k!==ultimaVista;
  ultimaVista=k;
  const enTool=route.view==='tool'&&toolState;
  if(reducido()){
    v.classList.remove('vIn');
    if(enTool){toolState.fx=null;toolState.fxFin=false}
    return;
  }
  if(nueva){
    v.classList.remove('vIn');void v.offsetWidth;v.classList.add('vIn');
    v.querySelectorAll('.grid>*,.badgeGrid>*,.path>.stage').forEach((el,i)=>el.style.setProperty('--i',Math.min(i,12)));
    setTimeout(()=>v.classList.remove('vIn'),1400);
  }else{
    v.classList.remove('vIn');      // un repintado dentro de la misma pantalla no repite la entrada
  }
  v.querySelectorAll('.countUp').forEach(contar);
  if(enTool&&toolState.fx){
    const fx=toolState.fx;toolState.fx=null;
    if(fx.tipo==='ok'){const b=v.querySelector('.optBtn.ok');if(b)explotar(b)}
  }
  if(enTool&&toolState.fxFin){
    toolState.fxFin=false;
    const qs=toolState.questions;
    if(qs&&toolState.idx>=qs.length&&toolState.score/qs.length>=0.7)lluvia();
  }
}

/* Número que sube de 0 al valor final */
function contar(el){
  const fin=+el.dataset.to||0;
  if(!fin||typeof requestAnimationFrame!=='function'){el.textContent=fin;return}
  const t0=performance.now(),dur=850;
  el.textContent='0';
  const paso=t=>{
    const p=Math.min(1,(t-t0)/dur);
    el.textContent=Math.round(fin*(1-Math.pow(1-p,3)));
    if(p<1)requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}
/* Chispas que salen de la respuesta correcta */
function explotar(el){
  const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
  const cols=['#3f7d5c','#e8b04b','#dc9c86','#6fb3d2','#c96f8a'];
  for(let i=0;i<24;i++){
    const s=document.createElement('i');s.className='spark';
    const ang=Math.random()*Math.PI*2,dist=50+Math.random()*80;
    s.style.cssText='left:'+cx+'px;top:'+cy+'px;background:'+cols[i%cols.length]+';--dx:'+(Math.cos(ang)*dist)+'px;--dy:'+(Math.sin(ang)*dist-30)+'px;--rot:'+(Math.random()*540-270)+'deg';
    document.body.appendChild(s);
    setTimeout(()=>s.remove(),1000);
  }
}
/* Lluvia de confeti al terminar con buen resultado */
function lluvia(){
  const cols=['#3f7d5c','#e8b04b','#dc9c86','#6fb3d2','#c96f8a','#7a2e2c'];
  for(let i=0;i<60;i++){
    const c=document.createElement('i');c.className='confetti';
    c.style.cssText='left:'+(Math.random()*100)+'vw;background:'+cols[i%cols.length]+';--d:'+(2.4+Math.random()*1.6)+'s;--w:'+(Math.random()*0.7)+'s';
    document.body.appendChild(c);
    setTimeout(()=>c.remove(),4600);
  }
}

document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');if(!b)return;
  if(b.dataset.action==='toggleInstante'){examInstantaneo=!examInstantaneo;render(true)}
});


/* ======================================================================
   ROL DE LA CUENTA: estudiante o profesor
   state.profile.rol decide si se ve el menú Docente. No es un permiso de seguridad
   (cualquiera podría elegir "profesor"): lo que protege los datos son las reglas de Firestore.
   ====================================================================== */
function detalleError(e){return e&&e.code?' ('+e.code+')':''}
function esProfesor(){return !!(state.profile&&state.profile.rol==='docente')}
function elegirRol(rol){
  state.profile.rol=rol;
  persist();
  aplicarRolMenu();
  route={view:rol==='docente'?'docente':'materias',materiaId:null};   // cada rol tiene su propio portal
  document.querySelectorAll('#mainNav button').forEach(x=>x.classList.toggle('on',x.dataset.nav===route.view));
  render();
}
/* Pantalla de bienvenida: se muestra una vez, hasta que la persona elige */
function pedirRol(){
  return new Promise(resolver=>{
    if(document.getElementById('rolOverlay')){resolver();return}
    const ov=document.createElement('div');
    ov.id='rolOverlay';ov.className='rolOverlay';
    ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');ov.setAttribute('aria-labelledby','rolTitulo');
    ov.innerHTML=`<div class="rolBox">
      <div class="rolLogo">📒</div>
      <h2 id="rolTitulo" style="margin:0 0 6px">¡Bienvenido a Auren!</h2>
      <p class="meta" style="margin:0">¿Cómo vas a usar la app? Define qué secciones verás. Puedes cambiarlo después en tu perfil.</p>
      <div class="rolGrid">
        <button type="button" class="rolOpt" data-rol="estudiante"><span>🎓</span><b>Soy estudiante</b><small>Organiza tus materias, estudia con IA y recibe las materias de tus profesores.</small></button>
        <button type="button" class="rolOpt" data-rol="docente"><span>👩‍🏫</span><b>Soy profesor</b><small>Crea materias, publica contenido e invita a tus estudiantes por correo.</small></button>
      </div></div>`;
    ov.querySelectorAll('.rolOpt').forEach(btn=>btn.addEventListener('click',()=>{
      elegirRol(btn.dataset.rol);
      ov.remove();
      resolver();
    }));
    document.body.appendChild(ov);
  });
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action="setRol"]');if(!b)return;
  const rol=b.dataset.rol;
  if(rol===state.profile.rol)return;
  if(rol==='estudiante'&&state.materias.some(m=>m.rol==='docente')&&!confirm('Tienes materias como profesor. Si cambias a estudiante, la sección Docente se oculta (no se borra nada) hasta que vuelvas a elegir Profesor. ¿Continuar?'))return;
  elegirRol(rol);
});


/* ======================================================================
   IA EN SEGUNDO PLANO
   Las funciones normales de Netlify tienen un tiempo máximo y un archivo grande puede superarlo
   (error 504). Por eso la subida:
     1. crea un "trabajo" en Firestore (iaJobs/{id}),
     2. lanza generar-tema-background (Netlify responde 202 y la IA sigue sin límite de 504),
     3. espera aquí el resultado, que la función escribe en ese trabajo.
   Si algo de eso no está disponible (la función no existe, las reglas no se publicaron…),
   se usa la función normal como antes.
   ====================================================================== */
const ESPERA_MAX_IA_MS=270000;

function esperarTrabajoIA(ref,statusEl,limpiar){
  return new Promise(resolver=>{
    const t0=Date.now();
    let terminado=false,reloj=null,tope=null,cancelar=()=>{};
    const terminar=r=>{
      if(terminado)return;terminado=true;
      clearInterval(reloj);clearTimeout(tope);
      try{cancelar()}catch(e){}
      Promise.resolve().then(()=>limpiar&&limpiar()).catch(()=>{}).then(()=>{try{ref.delete()}catch(e){}});   // primero los trozos del PDF, luego el trabajo
      resolver(r);
    };
    const pintar=()=>{
      const seg=Math.round((Date.now()-t0)/1000);
      statusEl.textContent=limpiar?'🔍 La IA está leyendo tu PDF escaneado… '+seg+' s (puede tardar unos minutos)':'🤖 La IA está armando el tema y las tarjetas… '+seg+' s (si el archivo es grande puede tardar un par de minutos)';
    };
    pintar();reloj=setInterval(pintar,1000);
    tope=setTimeout(()=>terminar({ok:false,error:'La IA tardó demasiado en responder. Inténtalo de nuevo o prueba con un archivo más corto.'}),ESPERA_MAX_IA_MS);
    cancelar=ref.onSnapshot(snap=>{
      const d=snap.exists?snap.data():null;
      if(!d)return;
      if(d.estado==='listo'){
        let datos=null;try{datos=JSON.parse(d.resultado)}catch(e){}
        terminar(datos?{ok:true,data:datos}:{ok:false,error:'La IA devolvió un resultado ilegible. Inténtalo de nuevo.'});
      }else if(d.estado==='error'){
        terminar({ok:false,error:d.mensaje||'La IA no pudo completar la petición.'});
      }
    },err=>terminar({ok:false,error:'No se pudo recibir el resultado de la IA'+detalleError(err)+'.'}));
  });
}

async function borrarEntradaIA(ref,partes){
  if(!partes)return;
  try{const b=db.batch();for(let i=0;i<partes;i++)b.delete(ref.collection('entrada').doc(String(i)));await b.commit()}
  catch(e){console.warn('No se pudieron limpiar los trozos del PDF:',e)}
}
async function pedirIA(texto,materiaNombre,statusEl,pdf){
  const token=await auth.currentUser.getIdToken();   // prueba de que hay sesión iniciada
  const cabeceras={'content-type':'application/json','authorization':'Bearer '+token};
  const base=pdf?{materia:materiaNombre}:{texto:texto.slice(0,IA_MAX_CHARS),materia:materiaNombre};   // la función usa hasta IA_MAX_CHARS caracteres
  let partesPdf=0;

  /* 1) En segundo plano: sin el límite de tiempo de las funciones normales */
  const jobId=uid();
  const ref=db.collection('iaJobs').doc(jobId);
  let lanzado=false,motivo='';
  try{
    await ref.set({uid:currentUid,estado:'pendiente',creado:Date.now()});
    if(pdf){
      /* El PDF no cabe en la petición (límite de 256 KB): se sube troceado a Firestore y la función en segundo plano lo lee de ahí */
      const b64=await archivoABase64(pdf);
      partesPdf=Math.ceil(b64.length/ARCH_PARTE);
      for(let i=0;i<partesPdf;i++){
        statusEl.textContent='📤 Enviando el PDF a la IA… '+(i+1)+'/'+partesPdf;
        await ref.collection('entrada').doc(String(i)).set({i,uid:currentUid,data:b64.slice(i*ARCH_PARTE,(i+1)*ARCH_PARTE)});
      }
    }
    const r=await fetch('/.netlify/functions/generar-tema-background',{
      method:'POST',headers:cabeceras,body:JSON.stringify({...base,jobId,...(partesPdf?{pdfPartes:partesPdf}:{})})
    });
    lanzado=r.status===202;
    if(!lanzado){
      motivo=r.status===404?'Netlify no encuentra la función generar-tema-background (revisa que el archivo se llame exactamente así y esté en netlify/functions)'
        :'la función en segundo plano respondió '+r.status+' (mira Logs → Functions en Netlify)';
      console.warn('El modo en segundo plano respondió',r.status,'; uso la función normal.');
    }
  }catch(e){
    motivo=(e&&e.code==='permission-denied')
      ?'faltan publicar las reglas de Firestore (colección iaJobs): Firebase → Firestore Database → Rules → Publish'
      :'no se pudo iniciar ('+((e&&(e.code||e.message))||'error')+')';
    console.warn('Modo en segundo plano no disponible; uso la función normal:',e);
  }
  if(lanzado)return esperarTrabajoIA(ref,statusEl,partesPdf?()=>borrarEntradaIA(ref,partesPdf):null);
  if(pdf){
    /* Un PDF escaneado solo se puede leer en segundo plano (la función normal no acepta archivos tan grandes) */
    await borrarEntradaIA(ref,partesPdf);try{ref.delete()}catch(e){}
    return{ok:false,error:'No se pudo enviar el PDF escaneado a la IA ('+motivo+').'};
  }
  try{ref.delete()}catch(e){}
  statusEl.textContent='🤖 Usando el modo normal (el de segundo plano no está disponible: '+motivo+'). Puede tardar hasta un minuto…';

  /* 2) Respaldo: función normal (con su límite de tiempo) */
  const resp=await fetch('/.netlify/functions/generar-tema',{method:'POST',headers:cabeceras,body:JSON.stringify(base)});
  let data=null;
  try{data=await resp.json()}catch(e){}
  if(!resp.ok||!data){
    return{ok:false,error:((data&&data.error)||('El servidor no pudo completar la petición (código '+resp.status+'). Suele pasar cuando la IA tarda demasiado; prueba con un archivo más corto o inténtalo de nuevo.'))
      +' [Modo en segundo plano no disponible: '+motivo+']'};
  }
  return{ok:true,data};
}


/* ======================================================================
   PORTAL DOCENTE: exámenes, resultados y menús separados por rol
   Datos (todo dentro de temarios/{sid}, solo en materias de docente):
     examenes/{exId}            título, estado (borrador|publicado|cerrado), cierre, escala y las
                                preguntas SIN la respuesta correcta
     claves/{exId}              {correctas:{preguntaId: índice}}  → el estudiante solo puede leerla
                                DESPUÉS de entregar su examen (lo exigen las reglas de Firestore)
     intentos/{exId}_{uid}      las respuestas del estudiante. Se crea una vez y no se modifica
   La nota "oficial" la calcula el panel del docente a partir de esas respuestas inmutables, así
   que un estudiante no puede inventarse su calificación.
   ====================================================================== */
const exMap={},clMap={},inMap={};      // sid -> datos en vivo
const pendClave=new Set();
let docTab='contenido',docTabMat=null;
let exBuf=null,exGuardarT=null;        // examen que el docente está editando
let exTom=null;                        // examen que el estudiante está presentando
let docResSel=null;                    // estudiante desplegado en los resultados
let docResFiltro='todas';              // filtro del detalle: todas | mal | bien

const ms=x=>x&&typeof x.toMillis==='function'?x.toMillis():(Number(x)||0);
const fmtFechaHora=t=>t?new Date(t).toLocaleString('es',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
const baseDe=m=>refTemario(m.sharedId);
const materiaRuta=()=>state.materias.find(x=>x.id===route.materiaId);
function mezclar(a){const r=a.slice();for(let i=r.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[r[i],r[j]]=[r[j],r[i]]}return r}
function examenesDe(m){return Object.values(exMap[m.sharedId]||{}).sort((a,b)=>ms(b.creado)-ms(a.creado))}
function examAbierto(ex){return ex.estado==='publicado'&&(!ex.cierre||Date.now()<=ex.cierre)}
function nEstudiantes(m){const x=sharedMeta[m.sharedId];return x&&x.members?Math.max(0,x.members.length-1):0}
const chipEstado=ex=>ex.estado==='borrador'?'<span class="chip">📝 Borrador</span>':ex.estado==='cerrado'?'<span class="chip">🔒 Cerrado</span>':(examAbierto(ex)?'<span class="chip chipOk">🟢 Publicado</span>':'<span class="chip">⏰ Venció</span>');

/* ---------- Calificación (la usan el docente y el estudiante) ---------- */
function calificar(ex,clave,resp){
  const det=(ex.preguntas||[]).map(q=>{
    const c=clave&&clave.correctas?clave.correctas[q.id]:undefined;
    const e=resp?resp[q.id]:undefined;
    return{q,elegido:e,correcta:c,acierto:e!==undefined&&c!==undefined&&Number(e)===Number(c)};
  });
  const ok=det.filter(d=>d.acierto).length,total=det.length||1;
  const escala=ex.escala||5;
  return{ok,total,pct:Math.round(ok/total*100),nota:Math.round(ok/total*escala*10)/10,escala,det};
}

/* ---------- Escuchar exámenes en vivo ---------- */
function escucharExamenes(m){
  const sid=m.sharedId,base=refTemario(sid),prof=m.rol==='docente',aviso=n=>err=>console.warn('Exámenes ('+n+'):',err);
  const u=[];
  const colEx=base.collection('examenes');
  u.push((prof?colEx:colEx.where('estado','in',['publicado','cerrado'])).onSnapshot(snap=>{
    exMap[sid]={};snap.docs.forEach(d=>{exMap[sid][d.id]={id:d.id,...d.data()}});renderSeguro();
    if(!prof)anunciarNuevos(m,'examen',snap.docs.filter(d=>d.data().estado==='publicado').map(d=>({id:d.id,titulo:d.data().titulo||'Examen'})));
  },aviso('examenes')));
  const colIn=base.collection('intentos');
  u.push((prof?colIn:colIn.where('uid','==',currentUid)).onSnapshot(snap=>{
    inMap[sid]={};snap.docs.forEach(d=>{inMap[sid][d.id]={id:d.id,...d.data()}});renderSeguro();
  },aviso('intentos')));
  const colIni=base.collection('inicios');
  u.push((prof?colIni:colIni.where('uid','==',currentUid)).onSnapshot(snap=>{
    iniMap[sid]={};snap.docs.forEach(d=>{iniMap[sid][d.id]={id:d.id,...d.data()}});renderSeguro();
  },aviso('inicios')));
  if(prof)u.push(base.collection('claves').onSnapshot(snap=>{
    clMap[sid]={};snap.docs.forEach(d=>{clMap[sid][d.id]={id:d.id,...d.data()}});renderSeguro();
  },aviso('claves')));
  return u;
}
function limpiarExamenes(sid){delete exMap[sid];delete clMap[sid];delete inMap[sid];delete iniMap[sid];delete evMap[sid]}

/* ======================= EVENTOS DEL DOCENTE EN EL CALENDARIO ======================= */
/* Viven en temarios/{sid}/eventos. El docente (dueño) escribe; los estudiantes de la materia solo leen. */
const evMap={};   // sid -> {id: evento}
const TIPOS_EV=[['ex','📝 Examen'],['en','📤 Entrega'],['ac','🎯 Actividad'],['ot','📌 Otro']];
function escucharEventos(m){
  const sid=m.sharedId;
  return refTemario(sid).collection('eventos').onSnapshot(snap=>{
    evMap[sid]={};snap.docs.forEach(d=>{evMap[sid][d.id]={id:d.id,...d.data()}});renderSeguro();
    if(m.rol==='estudiante')anunciarNuevos(m,'evento',snap.docs.map(d=>({id:d.id,titulo:(d.data().title||'Evento')+(d.data().date?' ('+fmtFecha(new Date(d.data().date+'T00:00').getTime())+')':'')})));
  },err=>console.warn('Eventos:',err));
}
function eventosDocentes(){
  const out=[];
  state.materias.forEach(m=>{
    if(!m.sharedId||(m.rol!=='docente'&&m.rol!=='estudiante'))return;
    Object.values(evMap[m.sharedId]||{}).forEach(e=>{
      if(!e.date)return;
      out.push({id:'d:'+m.sharedId+':'+e.id,evId:e.id,sid:m.sharedId,materiaId:m.id,materia:m.name,icon:m.icon||'📘',
        date:e.date,title:e.title||'(sin título)',type:e.type||'ot',hora:e.hora||'',nota:e.nota||'',by:e.by||'',docente:true,editable:m.rol==='docente'});
    });
  });
  return out;
}
const eventosTodos=()=>state.events.concat(eventosDocentes());
const tipoEv=t=>(TIPOS_EV.find(x=>x[0]===t)||['','📌 Otro'])[1];
const sortEv=(a,b)=>a.date.localeCompare(b.date)||(a.hora||'99').localeCompare(b.hora||'99');

/* Fila de un evento del docente (calendario del estudiante y del docente) */
function evDocFilaHTML(e,conMateria){
  return `<div class="li evDoc"><span><b>${tipoEv(e.type)}</b> · ${esc(e.title)}${e.hora?` <small>🕒 ${esc(e.hora)}</small>`:''}
    <br><small class="meta">${conMateria?`${esc(e.icon)} ${esc(e.materia)} · `:''}${e.editable?'Publicado para tus estudiantes':'👩‍🏫 '+esc(e.by||'Tu docente')}${e.nota?' · '+esc(e.nota):''}</small></span>
    ${e.editable?`<span class="row" style="margin:0"><button class="icon-btn" data-action="editEvDoc" data-sid="${e.sid}" data-ev="${e.evId}" title="Editar evento" aria-label="Editar evento">✏️</button><button class="icon-btn" data-action="delEvDoc" data-sid="${e.sid}" data-ev="${e.evId}" title="Eliminar evento" aria-label="Eliminar evento">🗑️</button></span>`:''}</div>`;
}

/* Pestaña "Calendario" del espacio docente */
function docenteEventosHTML(m){
  const hoy=ymd(new Date());
  const todos=Object.values(evMap[m.sharedId]||{}).filter(e=>e.date).map(e=>({...e,evId:e.id,sid:m.sharedId,editable:true,materia:m.name,icon:m.icon||'📘'})).sort(sortEv);
  const prox=todos.filter(e=>e.date>=hoy),pas=todos.filter(e=>e.date<hoy).reverse();
  const fila=e=>`<div class="li evDoc"><span><b>${tipoEv(e.type)}</b> · ${esc(e.title)}${e.hora?` <small>🕒 ${esc(e.hora)}</small>`:''}
    <br><small class="meta">${fmtDateLong(e.date)} · ${relDate(e.date)}${e.nota?' · '+esc(e.nota):''}</small></span>
    <span class="row" style="margin:0"><button class="icon-btn" data-action="editEvDoc" data-sid="${e.sid}" data-ev="${e.evId}" title="Editar evento" aria-label="Editar evento">✏️</button><button class="icon-btn" data-action="delEvDoc" data-sid="${e.sid}" data-ev="${e.evId}" title="Eliminar evento" aria-label="Eliminar evento">🗑️</button></span></div>`;
  const n=nEstudiantes(m);
  return `<div class="card shareBox">
    <b style="font-size:.9em">🗓️ Calendario de la materia</b>
    <p class="meta" style="margin:4px 0 0">Los eventos que agregues aparecen en el calendario de ${n?`tus <b>${n}</b> estudiante${n==1?'':'s'}`:'tus estudiantes'} (y en el tuyo). Puedes editarlos o eliminarlos cuando quieras y el cambio les llega en vivo.</p>
    <button class="pr" style="margin-top:10px" data-action="newEvDoc" data-id="${m.id}">+ Agregar evento</button>
  </div>
  <h3>Próximos</h3>
  ${prox.length?prox.map(fila).join(''):'<p class="meta">No hay eventos próximos.</p>'}
  ${pas.length?`<details class="evPas"><summary class="meta">Anteriores (${pas.length})</summary>${pas.map(fila).join('')}</details>`:''}`;
}

/* Formulario (ventana) para crear o editar */
function abrirEventoForm({sid=null,ev=null,fecha=''}={}){
  const docs=state.materias.filter(x=>x.rol==='docente'&&x.sharedId);
  if(!docs.length){alert('Primero crea una materia en tu espacio docente.');return}
  if(document.getElementById('evOverlay'))return;
  const cur=ev?(evMap[sid]||{})[ev]:null;
  if(ev&&!cur)return;
  const selSid=sid||docs[0].sharedId;
  const ov=document.createElement('div');
  ov.id='evOverlay';ov.className='rolOverlay';ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');ov.setAttribute('aria-labelledby','evTitulo');
  ov.innerHTML=`<form class="rolBox evBox" id="evForm" novalidate>
    <h2 id="evTitulo" style="margin:0 0 4px">${cur?'Editar evento':'Nuevo evento'}</h2>
    <p class="meta" style="margin:0 0 6px">Lo verán los estudiantes de la materia en su calendario.</p>
    <label class="lbl" for="evMat">Materia</label>
    <select class="fld" id="evMat" ${cur||docs.length==1?'disabled':''}>${docs.map(x=>`<option value="${x.sharedId}" ${x.sharedId===selSid?'selected':''}>${esc(x.icon||'📘')} ${esc(x.name)}</option>`).join('')}</select>
    <label class="lbl" for="evTit">Título</label>
    <input class="fld" id="evTit" maxlength="120" required placeholder="Ej. Parcial 1 · Unidades 1 a 3" value="${esc(cur?cur.title:'')}">
    <div class="two">
      <div><label class="lbl" for="evTipo">Tipo</label><select class="fld" id="evTipo">${TIPOS_EV.map(([k,t])=>`<option value="${k}" ${(cur?cur.type:'ex')===k?'selected':''}>${t}</option>`).join('')}</select></div>
      <div><label class="lbl" for="evFecha">Fecha</label><input class="fld" type="date" id="evFecha" required value="${esc(cur?cur.date:fecha)}"></div>
    </div>
    <label class="lbl" for="evHora">Hora (opcional)</label>
    <input class="fld" type="time" id="evHora" value="${esc(cur?cur.hora||'':'')}">
    <label class="lbl" for="evNota">Detalle (opcional)</label>
    <textarea class="fld" id="evNota" maxlength="500" placeholder="Salón, temas, material permitido…">${esc(cur?cur.nota||'':'')}</textarea>
    <p id="evErr" class="authError" hidden></p>
    <div class="row evBtns"><button type="button" class="sec" id="evCancel">Cancelar</button><button type="submit" class="pr" id="evSave">${cur?'Guardar cambios':'Agregar al calendario'}</button></div>
  </form>`;
  const cerrar=()=>{ov.remove();document.removeEventListener('keydown',esc_)};
  const esc_=e=>{if(e.key==='Escape')cerrar()};
  document.addEventListener('keydown',esc_);
  ov.addEventListener('mousedown',e=>{if(e.target===ov)cerrar()});
  document.body.appendChild(ov);
  ov.querySelector('#evCancel').onclick=cerrar;
  ov.addEventListener('input',()=>{ov.querySelector('#evErr').hidden=true});
  ov.querySelector('#evForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const q=id=>ov.querySelector('#'+id).value;
    const title=q('evTit').trim(),date=q('evFecha'),err=ov.querySelector('#evErr');
    if(!title){err.textContent='Escribe un título.';err.hidden=false;return}
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){err.textContent='Elige una fecha válida.';err.hidden=false;return}
    const btn=ov.querySelector('#evSave');btn.disabled=true;btn.textContent='Guardando…';
    const ok=await guardarEventoDoc(q('evMat'),ev,{title,date,type:q('evTipo'),hora:q('evHora'),nota:q('evNota').trim()});
    if(ok){if(calView)calView.sel=date;cerrar()}else{btn.disabled=false;btn.textContent=cur?'Guardar cambios':'Agregar al calendario'}
  });
  setTimeout(()=>{const t=ov.querySelector('#evTit');if(t)t.focus()},30);
}
async function guardarEventoDoc(sid,evId,d){
  const m=state.materias.find(x=>x.sharedId===sid&&x.rol==='docente');
  if(!m)return false;
  const col=refTemario(sid).collection('eventos'),ref=evId?col.doc(evId):col.doc();
  const ts=firebase.firestore.FieldValue.serverTimestamp();
  const datos={title:d.title,date:d.date,type:d.type,hora:d.hora||'',nota:d.nota||'',by:miNombre(),actualizado:ts};
  if(!evId)datos.creado=ts;
  try{await ref.set(datos,{merge:true});return true}
  catch(e){console.error(e);alert('No se pudo guardar el evento'+detalleError(e)+'. Si dice permission-denied, publica las reglas nuevas de firestore.rules en Firebase.');return false}
}
async function borrarEventoDoc(sid,evId){
  const m=state.materias.find(x=>x.sharedId===sid&&x.rol==='docente');
  if(!m)return;
  if(!confirm('¿Eliminar este evento del calendario de tus estudiantes?'))return;
  try{await refTemario(sid).collection('eventos').doc(evId).delete()}
  catch(e){console.error(e);alert('No se pudo eliminar el evento'+detalleError(e)+'.')}
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');if(!b)return;
  const a=b.dataset.action;
  if(a==='newEvDoc'){const m=state.materias.find(x=>x.id===b.dataset.id);if(m&&m.sharedId)abrirEventoForm({sid:m.sharedId,fecha:ymd(new Date())})}
  else if(a==='newEvDocCal')abrirEventoForm({fecha:b.dataset.date||''});
  else if(a==='editEvDoc')abrirEventoForm({sid:b.dataset.sid,ev:b.dataset.ev});
  else if(a==='delEvDoc')borrarEventoDoc(b.dataset.sid,b.dataset.ev);
});

/* El estudiante trae la clave solo cuando ya entregó (las reglas no se la dan antes) */
async function asegurarClave(m,exId){
  const sid=m.sharedId,k=sid+'/'+exId;
  if((clMap[sid]||{})[exId]||pendClave.has(k))return;
  pendClave.add(k);
  try{
    const d=await baseDe(m).collection('claves').doc(exId).get();
    if(d.exists){(clMap[sid]=clMap[sid]||{})[exId]={id:exId,...d.data()};renderSeguro()}
  }catch(e){console.warn('No se pudo leer la clave:',e)}
  pendClave.delete(k);
}

/* ======================= DOCENTE: pestañas de la materia ======================= */
function docenteTabsHTML(m){
  const tabs=[['contenido','📚 Contenido'],['examenes','📝 Exámenes'],['eventos','🗓️ Calendario'],['estudiantes','👥 Estudiantes']];
  return `<div class="tabsT docTabs" style="margin:14px 0">${tabs.map(([k,t])=>`<button type="button" data-action="docTab" data-tab="${k}" class="${docTab===k?'on':''}">${t}</button>`).join('')}</div>`;
}
function docentePanelHTML(m){
  const temas=state.temas.filter(t=>t.materiaId===m.id);
  const pub=temas.filter(t=>t.publicado).length,bor=temas.length-pub;
  return docenteTabsHTML(m)+`<div class="card shareBox">
    <b style="font-size:.9em">📚 Contenido de la materia</b>
    <p class="meta" style="margin:4px 0 0">Los temas que crees o generes con IA quedan como <b>borrador</b>. Revísalos y edítalos; tus estudiantes solo ven los que publiques (botón ✅/📝 en cada tema). Con los temas publicados puedes armar exámenes en la pestaña <b>Exámenes</b>.</p>
    <div class="members"><span class="chip">${pub} publicado${pub==1?'':'s'}</span><span class="chip">${bor} borrador${bor==1?'':'es'}</span></div>
    ${bor?`<button class="sec" data-action="publishAll" data-id="${m.id}">✅ Publicar todos los borradores</button>`:''}
  </div>`;
}
function docenteEstudiantesHTML(m){
  const invs=invitMap[m.sharedId]||[];
  const estado=i=>i.estado==='aceptada'?`<span class="chip chipOk">✅ Se unió</span>`:i.estado==='rechazada'?`<span class="chip">✖ Rechazó</span>`:`<span class="chip">⏳ Pendiente</span>`;
  return `<div class="card shareBox">
    <label class="lbl" for="invEmails" style="margin-top:0">Invitar estudiantes por correo</label>
    <textarea class="fld" id="invEmails" placeholder="correo1@ejemplo.com, correo2@ejemplo.com"></textarea>
    <p class="meta" style="margin:4px 0 0">Verán la invitación al iniciar sesión con ese mismo correo (con Google o con correo verificado).</p>
    <button class="pr" style="margin-top:8px" data-action="inviteStudents" data-id="${m.id}">📨 Invitar</button>
    <div style="margin-top:14px"><b style="font-size:.85em">Estudiantes (${invs.length})</b></div>
    ${invs.length?invs.map(i=>`<div class="row" style="justify-content:space-between;margin-top:6px"><span>${esc(i.nombre||i.email)} <span class="meta">${i.nombre?esc(i.email):''}</span> ${estado(i)}</span><button class="icon-btn" data-action="removeInvite" data-id="${m.id}" data-inv="${esc(i.id)}" title="Quitar">🗑️</button></div>`).join(''):'<p class="meta" style="margin:6px 0 0">Aún no has invitado a nadie.</p>'}
    <div class="row" style="margin-top:14px"><button class="sec" data-action="delMateria" data-id="${m.id}">🗑️ Eliminar materia para todos</button></div>
  </div>`;
}
function viewDocenteTabHTML(m){
  return `<button class="sec" data-action="backDocente">← Mis materias</button>
    <div class="viewhead" style="margin-top:14px"><h1>${esc(m.icon||'📘')} ${esc(m.name)}</h1></div>
    ${docenteTabsHTML(m)}
    ${docTab==='examenes'?docenteExamenesHTML(m):docTab==='eventos'?docenteEventosHTML(m):docenteEstudiantesHTML(m)}`;
}

/* ---------- Lista de exámenes ---------- */
function docenteExamenesHTML(m){
  const exs=examenesDe(m),nEst=nEstudiantes(m);
  const intentos=Object.values(inMap[m.sharedId]||{});
  const cards=exs.map(ex=>{
    const ints=intentos.filter(i=>i.examId===ex.id);
    const cl=(clMap[m.sharedId]||{})[ex.id];
    let prom='';
    if(ints.length&&cl){const ps=ints.map(i=>calificar(ex,cl,i.respuestas||{}).pct);prom=` · promedio ${Math.round(ps.reduce((a,b)=>a+b,0)/ps.length)}%`}
    const acciones=ex.estado==='borrador'
      ?`<button class="sec" data-action="exEditar" data-id="${m.id}" data-ex="${ex.id}">✏️ Editar</button>`
      :`<button class="pr" data-action="exResultados" data-id="${m.id}" data-ex="${ex.id}">📊 Resultados</button>
        ${ex.estado==='cerrado'?`<button class="sec" data-action="exEstado" data-id="${m.id}" data-ex="${ex.id}" data-to="publicado">🔓 Reabrir</button>`:`<button class="sec" data-action="exEstado" data-id="${m.id}" data-ex="${ex.id}" data-to="cerrado">🔒 Cerrar</button>`}`;
    return `<div class="card exCard">
      <div class="stHead"><b>${esc(ex.titulo||'Sin título')}</b>${chipEstado(ex)}</div>
      <p class="meta" style="margin:6px 0 0">${(ex.preguntas||[]).length} pregunta${(ex.preguntas||[]).length==1?'':'s'}${ex.cierre?' · cierra '+fmtFechaHora(ex.cierre):''}${ex.duracion?' · ⏱️ '+ex.duracion+' min':''}${ex.estado==='borrador'?'':' · entregas '+ints.length+'/'+nEst+prom}</p>
      <div class="row" style="flex-wrap:wrap">${acciones}<button class="icon-btn" data-action="exEliminarLista" data-id="${m.id}" data-ex="${ex.id}" title="Eliminar examen">🗑️</button></div>
    </div>`;
  }).join('');
  return `<div class="viewhead"><h2>📝 Exámenes</h2><span class="row" style="margin:0;flex-wrap:wrap">${exs.some(e=>e.estado!=='borrador')?`<button class="sec" data-action="libroNotas" data-id="${m.id}">⬇️ Libro de notas (Excel)</button>`:''}<button class="pr" data-action="newExam" data-id="${m.id}">+ Nuevo examen</button></span></div>
    ${exs.length?cards:'<div class="empty">Aún no hay exámenes. Crea uno a partir de los temas de tu materia: generas las preguntas, las revisas y las publicas. Después verás las notas de cada estudiante y en qué preguntas fallaron.</div>'}`;
}

/* ======================= DOCENTE: editor de examen ======================= */
function cierreLocal(t){if(!t)return'';const d=new Date(t-new Date(t).getTimezoneOffset()*60000);return d.toISOString().slice(0,16)}
function exDividir(buf){
  return{
    examen:{titulo:buf.titulo||'',estado:buf.estado,cierre:buf.cierre||0,escala:buf.escala,creado:buf.creado,publicadoEn:buf.publicadoEn||0,duracion:buf.duracion||0,mezclar:buf.mezclar!==false,
      preguntas:buf.preguntas.map(q=>({id:q.id,enunciado:q.enunciado||'',opciones:[0,1,2,3].map(i=>q.opciones[i]||''),temaId:q.temaId||'',temaTitulo:q.temaTitulo||''}))},
    clave:{correctas:Object.fromEntries(buf.preguntas.map(q=>[q.id,Number(q.correcta)||0]))}
  };
}
function setGuardado(t){const el=$('exGuardado');if(el)el.textContent=t}
async function exGuardarYa(){
  if(!exBuf)return;
  clearTimeout(exGuardarT);
  const m=materiaRuta();if(!m)return;
  const base=baseDe(m),{examen,clave}=exDividir(exBuf);
  const b=db.batch();
  b.set(base.collection('examenes').doc(exBuf.id),examen);
  b.set(base.collection('claves').doc(exBuf.id),clave);
  setGuardado('Guardando…');
  try{await b.commit();setGuardado('✓ Guardado')}
  catch(e){console.error(e);setGuardado('⚠️ No se pudo guardar'+detalleError(e)+'. ¿Publicaste las reglas nuevas de Firestore?')}
}
function exGuardarLuego(){clearTimeout(exGuardarT);setGuardado('Cambios sin guardar…');exGuardarT=setTimeout(exGuardarYa,900)}

async function crearExamen(m){
  const n=examenesDe(m).length+1;
  exBuf={id:uid(),titulo:'Examen '+n,estado:'borrador',cierre:0,duracion:0,mezclar:true,escala:scaleMax(),creado:Date.now(),publicadoEn:0,preguntas:[]};
  route={view:'docExamen',materiaId:m.id,examId:exBuf.id};
  render();
  await exGuardarYa();
}
function abrirEditor(m,exId){
  const ex=(exMap[m.sharedId]||{})[exId];if(!ex)return;
  const cl=((clMap[m.sharedId]||{})[exId]||{}).correctas||{};
  exBuf={id:exId,titulo:ex.titulo||'',estado:ex.estado||'borrador',cierre:ex.cierre||0,escala:ex.escala||scaleMax(),creado:ms(ex.creado)||Date.now(),publicadoEn:ex.publicadoEn||0,duracion:ex.duracion||0,mezclar:ex.mezclar!==false,
    preguntas:(ex.preguntas||[]).map(q=>({id:q.id,enunciado:q.enunciado||'',opciones:[0,1,2,3].map(i=>(q.opciones||[])[i]||''),
      correcta:cl[q.id]!==undefined?Number(cl[q.id]):0,temaId:q.temaId||'',temaTitulo:q.temaTitulo||''}))};
  route={view:'docExamen',materiaId:m.id,examId:exId};
  render();
}
function generarPreguntas(m,temaIds,n){
  const limpia=k=>String(k.front||'').trim()&&String(k.back||'').trim();
  const usadas=new Set(exBuf.preguntas.map(q=>q.fuenteId).filter(Boolean));
  const fuente=state.cards.filter(k=>temaIds.includes(k.temaId)&&limpia(k)&&!usadas.has(k.id));
  const cortesSel=new Set(temaIds.map(id=>(state.temas.find(x=>x.id===id)||{}).corteId));
  const enCorte=k=>{const tm=state.temas.find(x=>x.id===k.temaId);return !!tm&&cortesSel.has(tm.corteId)};
  const cardsCorte=state.cards.filter(k=>k.materiaId===m.id&&limpia(k)&&enCorte(k));      // las opciones incorrectas salen solo de los cortes de los temas elegidos
  const pool=[...new Set(cardsCorte.map(k=>String(k.back).trim()))];
  const out=[];
  mezclar(fuente).slice(0,n).forEach(k=>{
    const correcta=String(k.back).trim();
    let otras=distractoresDe(k,cardsCorte);                  // primero las opciones incorrectas que hizo la IA
    if(!otras)otras=mezclar(pool.filter(b=>b!==correcta)).slice(0,3);
    if(!otras.length)return;                       // sin otras respuestas no se puede armar opción múltiple
    const ops=mezclar([correcta,...otras]);
    const t=state.temas.find(x=>x.id===k.temaId)||{};
    out.push({id:uid(),enunciado:String(k.front).trim(),opciones:[0,1,2,3].map(i=>ops[i]||''),correcta:ops.indexOf(correcta),
      temaId:k.temaId,temaTitulo:t.title||'',fuenteId:k.id});
  });
  return out;
}
function validarExamen(b){
  if(!String(b.titulo||'').trim())return 'Ponle un título al examen.';
  if(!b.preguntas.length)return 'Agrega al menos una pregunta.';
  for(let i=0;i<b.preguntas.length;i++){
    const q=b.preguntas[i],ops=q.opciones.map(o=>String(o||'').trim());
    const llenas=ops.filter(Boolean);
    if(!String(q.enunciado||'').trim())return 'La pregunta '+(i+1)+' no tiene enunciado.';
    if(llenas.length<2)return 'La pregunta '+(i+1)+' necesita al menos 2 opciones.';
    if(new Set(llenas).size!==llenas.length)return 'La pregunta '+(i+1)+' tiene opciones repetidas.';
    if(!ops[q.correcta])return 'En la pregunta '+(i+1)+' marca cuál opción es la correcta.';
  }
  return '';
}
function viewDocExamenHTML(){
  const m=materiaRuta();
  if(!m||!exBuf||exBuf.id!==route.examId)return '<div class="empty">No se pudo abrir el examen. <button class="sec" data-action="backDocente">Volver</button></div>';
  const lock=exBuf.estado!=='borrador';
  const temas=state.temas.filter(t=>t.materiaId===m.id);
  const nCards=t=>state.cards.filter(k=>k.temaId===t.id&&String(k.front||'').trim()&&String(k.back||'').trim()).length;
  const dis=lock?'disabled':'';
  return `<button class="sec" data-action="exVolver">← Exámenes</button>
  <div class="viewhead" style="margin-top:14px"><h1>📝 ${lock?'Examen':'Editar examen'}</h1><span id="exGuardado" class="meta"></span></div>
  ${lock?'<div class="card shareBox" style="margin-bottom:12px">🔒 Este examen ya está publicado, por eso no se edita (así todos los estudiantes responden lo mismo y los resultados son comparables). Si nadie lo ha presentado, puedes volver a pasarlo a borrador.</div>':''}
  <div class="card">
    <label class="lbl" style="margin-top:0">Título</label>
    <input class="fld" data-ex="titulo" value="${esc(exBuf.titulo)}" maxlength="80" ${dis}>
    <div class="two">
      <div><label class="lbl">Fecha límite (opcional)</label><input class="fld" type="datetime-local" data-ex="cierre" value="${cierreLocal(exBuf.cierre)}" ${dis}></div>
      <div><label class="lbl">Escala de notas</label><p class="meta" style="margin:8px 0 0">0 a ${exBuf.escala} (la de tu perfil)</p></div>
    </div>
    <div class="two">
      <div><label class="lbl">Tiempo límite en minutos (0 = sin límite)</label><input class="fld" type="number" min="0" max="600" data-ex="duracion" value="${exBuf.duracion||0}" ${dis}></div>
      <div><label class="lbl">Orden</label><label class="exTemaLbl"><input type="checkbox" data-ex="mezclar" ${exBuf.mezclar!==false?'checked':''} ${dis}> Mezclar preguntas y opciones para cada estudiante</label></div>
    </div>
    <p class="meta" style="margin:6px 0 0">${exBuf.duracion>0?'El reloj de cada estudiante empieza cuando pulsa "Comenzar"; queda registrada su hora de inicio y, si se acaba el tiempo, se entrega lo que lleve.':'Sin tiempo límite, el estudiante lo presenta cuando quiera mientras esté abierto.'}</p>
  </div>
  ${lock?'':`<div class="card shareBox" style="margin-top:12px">
    <b style="font-size:.9em">✨ Generar preguntas desde tus temas</b>
    <p class="meta" style="margin:4px 0 8px">Se crean preguntas de opción múltiple con las tarjetas de los temas que elijas. Después puedes editarlas o agregar las tuyas.</p>
    ${temas.length?temas.map(t=>`<label class="exTemaLbl"><input type="checkbox" class="exTema" value="${t.id}" ${nCards(t)?'':'disabled'}> ${esc(t.title||'Sin título')} <span class="meta">(${nCards(t)} tarjeta${nCards(t)==1?'':'s'})</span></label>`).join(''):'<p class="meta">Todavía no hay temas. Crea uno en la pestaña Contenido.</p>'}
    <div class="row"><label class="meta" for="exN">Cantidad</label><input class="fld" id="exN" type="number" min="1" max="40" value="10" style="width:90px"><button class="pr" data-action="exGenerar">✨ Generar</button></div>
  </div>`}
  ${lock?'':bancoPanelHTML()}
  <div class="viewhead" style="margin-top:18px"><h2>Preguntas (${exBuf.preguntas.length})</h2></div>
  ${exBuf.preguntas.length?exBuf.preguntas.map((q,i)=>`<div class="card exQ" style="margin-bottom:12px">
    <div class="row" style="justify-content:space-between;margin-top:0"><b>Pregunta ${i+1}</b>${q.temaTitulo?`<span class="chip">${esc(q.temaTitulo)}</span>`:''}${lock?'':`<button class="icon-btn" data-action="exDelQ" data-q="${q.id}" title="Eliminar pregunta">🗑️</button>`}</div>
    <textarea class="fld" data-ex="enun" data-q="${q.id}" placeholder="Escribe la pregunta" ${dis}>${esc(q.enunciado)}</textarea>
    ${[0,1,2,3].map(j=>`<div class="exOpt"><button type="button" class="exRadio ${q.correcta===j?'on':''}" data-action="exCorrecta" data-q="${q.id}" data-i="${j}" title="Marcar como correcta" ${dis}>${q.correcta===j?'✓':''}</button><input class="fld" data-ex="opt" data-q="${q.id}" data-i="${j}" value="${esc(q.opciones[j]||'')}" placeholder="Opción ${j+1}${j>1?' (opcional)':''}" ${dis}></div>`).join('')}
  </div>`).join(''):'<div class="empty">Aún no hay preguntas. Genera algunas desde tus temas o agrega una manualmente.</div>'}
  ${lock?'':'<button class="sec" data-action="exAddQ">+ Agregar pregunta</button>'}
  <div class="row" style="flex-wrap:wrap;margin-top:18px">
    ${lock?'':'<button class="pr" data-action="exPublicar">🚀 Publicar examen</button>'}
    ${lock&&exBuf.estado==='publicado'?'<button class="sec" data-action="exABorrador">📝 Volver a borrador</button>':''}
    <button class="sec" data-action="exEliminar">🗑️ Eliminar examen</button>
  </div>`;
}
/* ======================= DOCENTE: banco de preguntas =======================
   Vive en bancoPreguntas/{uid}/items (solo del docente) y no depende de la materia: sirve para el siguiente semestre. */
let bancoCache=null,bancoAbierto=false,bancoCargando=false,bancoFiltro={corte:'',texto:''};const bancoSel=new Set();
const bancoRef=()=>db.collection('bancoPreguntas').doc(currentUid).collection('items');
function hashPregunta(q){
  const s=[q.enunciado,...(q.opciones||[])].map(x=>normTxt(x)).join('|')+'|'+(Number(q.correcta)||0);
  return 'p'+semillaTxt(s).toString(36)+semillaTxt(s.split('').reverse().join('')).toString(36);
}
async function cargarBanco(){
  if(bancoCargando)return;
  bancoCargando=true;
  try{const snap=await bancoRef().get();bancoCache=snap.docs.map(d=>({id:d.id,...d.data()}))}
  catch(e){console.warn('Banco de preguntas:',e);bancoCache=[];toast('⚠️ No se pudo leer tu banco de preguntas'+esc(detalleError(e)))}
  bancoCargando=false;
  if(route.view==='docExamen')render(true);
}
async function guardarEnBanco(m,qs){
  const b=db.batch();let n=0;
  qs.forEach(q=>{
    const ops=[0,1,2,3].map(i=>limpioT((q.opciones||[])[i]));
    if(!limpioT(q.enunciado)||ops.filter(Boolean).length<2||!ops[Number(q.correcta)])return;
    const t=state.temas.find(x=>x.id===q.temaId),c=t&&state.cortes.find(x=>x.id===t.corteId);
    const item={enunciado:limpioT(q.enunciado),opciones:ops,correcta:Number(q.correcta)||0,temaTitulo:limpioT(q.temaTitulo),corte:c?limpioT(c.name):'',materia:limpioT(m.name),creado:Date.now()};
    b.set(bancoRef().doc(hashPregunta(item)),item);n++;
  });
  if(!n)return 0;
  await b.commit();
  bancoCache=null;cargarBanco();
  return n;
}
function bancoPanelHTML(){
  if(!bancoAbierto)return `<div class="card shareBox" style="margin-top:12px"><b style="font-size:.9em">📚 Banco de preguntas</b>
    <p class="meta" style="margin:4px 0 8px">Guarda tus mejores preguntas y reutilízalas en otros exámenes y en otros semestres. Es solo tuyo.</p>
    <div class="row" style="flex-wrap:wrap"><button class="sec" data-action="exBancoGuardar">💾 Guardar estas preguntas en mi banco</button><button class="sec" data-action="exBancoAbrir">📥 Traer del banco</button></div></div>`;
  if(bancoCache===null){if(!bancoCargando)cargarBanco();return `<div class="card shareBox" style="margin-top:12px"><b>📚 Banco de preguntas</b><p class="meta">Cargando…</p></div>`}
  const cortes=[...new Set(bancoCache.map(x=>x.corte||''))].sort();
  const q=normTxt(bancoFiltro.texto);
  const lista=bancoCache.filter(x=>(!bancoFiltro.corte||(bancoFiltro.corte==='__sin'?!x.corte:x.corte===bancoFiltro.corte))&&(!q||normTxt(x.enunciado+' '+x.materia+' '+x.temaTitulo).includes(q)))
    .sort((x,y)=>(x.corte||'').localeCompare(y.corte||'')||(y.creado||0)-(x.creado||0));
  const enExamen=new Set(exBuf.preguntas.map(p=>normTxt(p.enunciado)));
  return `<div class="card shareBox" style="margin-top:12px"><b style="font-size:.9em">📚 Banco de preguntas (${bancoCache.length})</b>
    <div class="two" style="margin-top:8px">
      <div><label class="lbl" style="margin-top:0">Corte</label><select class="fld" data-action="bancoCorte"><option value="">Todos los cortes</option>${cortes.map(c=>`<option value="${c||'__sin'}" ${bancoFiltro.corte===(c||'__sin')?'selected':''}>${esc(c)||'(sin corte)'}</option>`).join('')}</select></div>
      <div><label class="lbl" style="margin-top:0">Buscar</label><input class="fld" data-action="bancoTexto" value="${esc(bancoFiltro.texto)}" placeholder="Palabra, tema o materia" maxlength="60"></div>
    </div>
    ${lista.length?lista.map(x=>{const ya=enExamen.has(normTxt(x.enunciado));return `<div class="li bancoFila"><label class="exTemaLbl" style="flex:1"><input type="checkbox" data-action="bancoSel" data-bid="${x.id}" ${bancoSel.has(x.id)?'checked':''} ${ya?'disabled':''}> ${esc(x.enunciado)}<br><small class="meta">${esc(x.corte||'sin corte')} · ${esc(x.materia||'')}${x.temaTitulo?' · '+esc(x.temaTitulo):''}${ya?' · ya está en este examen':''}</small></label><button class="icon-btn" data-action="bancoDel" data-bid="${x.id}" title="Quitar del banco" aria-label="Quitar del banco">🗑️</button></div>`}).join(''):'<p class="meta">No hay preguntas con ese filtro. Guarda las de un examen con "Guardar estas preguntas en mi banco".</p>'}
    <div class="row" style="flex-wrap:wrap;margin-top:10px"><button class="pr" data-action="exBancoAgregar" ${bancoSel.size?'':'disabled'}>Agregar seleccionadas (${bancoSel.size})</button><button class="sec" data-action="exBancoGuardar">💾 Guardar las de este examen</button><button class="sec" data-action="exBancoCerrar">Cerrar</button></div></div>`;
}
async function exEliminarExamen(m,exId){
  const base=baseDe(m),b=db.batch();
  b.delete(base.collection('examenes').doc(exId));
  b.delete(base.collection('claves').doc(exId));
  Object.values(inMap[m.sharedId]||{}).filter(i=>i.examId===exId).forEach(i=>b.delete(base.collection('intentos').doc(i.id)));
  Object.values(iniMap[m.sharedId]||{}).filter(i=>i.examId===exId).forEach(i=>b.delete(base.collection('inicios').doc(i.id)));
  try{await b.commit()}catch(e){console.error(e);alert('No se pudo eliminar el examen'+detalleError(e)+'.')}
}

/* ======================= DOCENTE: resultados ======================= */
function resultadosDe(m,ex){
  const sid=m.sharedId,meta=sharedMeta[sid]||{},clave=(clMap[sid]||{})[ex.id],inv=invitMap[sid]||[];
  const intentos=Object.values(inMap[sid]||{}).filter(i=>i.examId===ex.id);
  const uids=(meta.members||[]).filter(u=>u!==meta.ownerUid);
  intentos.forEach(i=>{if(!uids.includes(i.uid))uids.push(i.uid)});
  const filas=uids.map(u=>{
    const it=intentos.find(i=>i.uid===u),inf=inv.find(i=>i.uid===u)||{};
    return{uid:u,nombre:(meta.memberNames||{})[u]||(it&&it.nombre)||inf.nombre||'Estudiante',email:inf.email||(it&&it.email)||'',
      intento:it||null,ini:(iniMap[sid]||{})[ex.id+'_'+u]||null,res:(it&&clave)?calificar(ex,clave,it.respuestas||{}):null};
  });
  const hechas=filas.filter(f=>f.res),pcts=hechas.map(f=>f.res.pct);
  const stats={entregaron:hechas.length,total:filas.length,
    prom:pcts.length?Math.round(pcts.reduce((a,b)=>a+b,0)/pcts.length):null,
    max:pcts.length?Math.max(...pcts):null,min:pcts.length?Math.min(...pcts):null,aprobaron:pcts.filter(p=>p>=60).length};
  const buckets=[0,0,0,0,0];pcts.forEach(p=>buckets[Math.min(4,Math.floor(p/20))]++);
  const preguntas=(ex.preguntas||[]).map(q=>{
    const dets=hechas.map(f=>f.res.det.find(d=>d.q.id===q.id)).filter(Boolean);
    const aciertos=dets.filter(d=>d.acierto).length,cuentas={};
    dets.filter(d=>!d.acierto&&d.elegido!==undefined).forEach(d=>{cuentas[d.elegido]=(cuentas[d.elegido]||0)+1});
    const top=Object.entries(cuentas).sort((a,b)=>b[1]-a[1])[0];
    return{q,n:dets.length,aciertos,pct:dets.length?Math.round(aciertos/dets.length*100):null,
      peor:top?{texto:(q.opciones||[])[+top[0]]||'',veces:top[1]}:null};
  });
  const temas={};
  preguntas.forEach(p=>{if(!p.n)return;const k=p.q.temaTitulo||'Sin tema';const t=temas[k]=temas[k]||{titulo:k,ok:0,n:0};t.ok+=p.aciertos;t.n+=p.n});
  const porTema=Object.values(temas).map(t=>({...t,pct:Math.round(t.ok/t.n*100)})).sort((a,b)=>a.pct-b.pct);
  return{filas,stats,buckets,preguntas,porTema,clave};
}
const colorPct=p=>p>=70?'var(--ok)':p>=50?'var(--a)':'var(--no)';
function barraPct(p){return `<div class="bar mini pctBar"><i style="width:${p==null?0:p}%;background:${colorPct(p)}"></i></div>`}

function minutosUsados(f){return(f.ini&&f.intento&&ms(f.ini.inicio)&&ms(f.intento.enviado))?Math.max(0,Math.round((ms(f.intento.enviado)-ms(f.ini.inicio))/60000)):null}
function detalleEstudianteHTML(f,ex){
  const det=f.res.det,ok=det.filter(d=>d.acierto).length,sin=det.filter(d=>d.elegido===undefined).length,mal=det.length-ok-sin;
  const vis=det.map((d,i)=>({d,i})).filter(x=>docResFiltro==='mal'?!x.d.acierto:docResFiltro==='bien'?x.d.acierto:true);
  const chip=(k,txt)=>`<button type="button" class="toggleChip ${docResFiltro===k?'on':''}" data-action="resFiltro" data-f="${k}">${txt}</button>`;
  return `<div class="resDet">
    <p class="meta" style="margin:8px 0 0">${f.intento&&ms(f.intento.enviado)?'Entregó el '+esc(fmtFechaHora(ms(f.intento.enviado)))+' · ':''}<b>${ok}</b> correcta${ok==1?'':'s'} · <b>${mal}</b> incorrecta${mal==1?'':'s'}${sin?' · <b>'+sin+'</b> sin responder':''}</p>
    <div class="row" style="flex-wrap:wrap;margin:8px 0 0">${chip('todas','Todas ('+det.length+')')}${chip('mal','❌ Incorrectas ('+(mal+sin)+')')}${chip('bien','✅ Correctas ('+ok+')')}</div>
    ${vis.length?vis.map(({d,i})=>`<div class="resRow ${d.acierto?'bien':'mal'}" style="margin-top:10px"><b>${i+1}. ${esc(d.q.enunciado)}</b>${d.q.temaTitulo?` <span class="chip">${esc(d.q.temaTitulo)}</span>`:''}
      <ul class="resOps">${(d.q.opciones||[]).map((o,j)=>{
        if(!String(o||'').trim())return '';
        const esC=j===Number(d.correcta),esE=d.elegido!==undefined&&j===Number(d.elegido);
        const tag=esC&&esE?'✅ Su respuesta · correcta':esC?'✔ Respuesta correcta':esE?'❌ Su respuesta':'';
        return `<li class="${esC?'opC':esE?'opE':''}">${esc(o)}${tag?` <small>${tag}</small>`:''}</li>`}).join('')}</ul>
      ${d.elegido===undefined?'<div class="meta" style="margin:2px 0 0">Sin responder</div>':''}</div>`).join(''):'<p class="meta">No hay preguntas en este filtro.</p>'}
    <div class="row"><button class="sec" data-action="exRepetir" data-u="${f.uid}">↩️ Permitir que lo repita</button></div></div>`;
}
function viewDocResultadosHTML(){
  const m=materiaRuta(),ex=m&&(exMap[m.sharedId]||{})[route.examId];
  if(!m||!ex)return '<div class="empty">No se encontró el examen. <button class="sec" data-action="exVolver">Volver</button></div>';
  if(m.rol!=='docente')return '<div class="empty">Solo el docente de la materia puede ver las respuestas de los estudiantes.</div>';
  const r=resultadosDe(m,ex),st=r.stats,esc_=ex.escala||5;
  const notaProm=st.prom==null?'—':fmtN(Math.round(st.prom/100*esc_*10)/10);
  const maxB=Math.max(1,...r.buckets);
  const rangos=['0–19%','20–39%','40–59%','60–79%','80–100%'];
  return `<button class="sec" data-action="exVolver">← Exámenes</button>
  <div class="viewhead" style="margin-top:14px"><h1>📊 ${esc(ex.titulo||'Examen')}</h1></div>
  <div class="row" style="margin:0 0 12px;flex-wrap:wrap">${chipEstado(ex)}<span class="chip">${(ex.preguntas||[]).length} preguntas</span>${ex.cierre?`<span class="chip">cierra ${fmtFechaHora(ex.cierre)}</span>`:''}
    <button class="sec" data-action="exCsv">⬇️ Descargar notas (CSV)</button>
    <button class="sec" data-action="exCsvDet">⬇️ Respuestas detalladas (CSV)</button>
    <button class="pr" data-action="exXlsx">⬇️ Excel (.xlsx)</button>
    ${ex.estado==='cerrado'?`<button class="sec" data-action="exEstado" data-id="${m.id}" data-ex="${ex.id}" data-to="publicado">🔓 Reabrir</button>`:`<button class="sec" data-action="exEstado" data-id="${m.id}" data-ex="${ex.id}" data-to="cerrado">🔒 Cerrar examen</button>`}</div>
  ${r.clave?'':'<p class="meta">Cargando las respuestas correctas…</p>'}
  <div class="statGrid">
    <div class="card statC"><b>${st.entregaron}/${st.total}</b><span>entregaron</span></div>
    <div class="card statC"><b>${st.prom==null?'—':st.prom+'%'}</b><span>promedio · nota ${notaProm}</span></div>
    <div class="card statC"><b>${st.max==null?'—':st.max+'%'}</b><span>más alta</span></div>
    <div class="card statC"><b>${st.min==null?'—':st.min+'%'}</b><span>más baja</span></div>
    <div class="card statC"><b>${st.aprobaron}</b><span>con 60% o más</span></div>
  </div>
  ${st.entregaron?`<div class="card" style="margin-top:12px"><b style="font-size:.9em">Distribución de resultados</b>
    <div class="histo">${r.buckets.map((n,i)=>`<div class="hCol"><span class="hN">${n}</span><div class="hBar" style="height:${Math.round(n/maxB*70)+4}px"></div><span class="hL">${rangos[i]}</span></div>`).join('')}</div></div>`:''}

  <h2 style="margin:22px 0 10px">👥 Estudiantes</h2>
  ${r.filas.length?r.filas.map(f=>{
    const abierto=docResSel===f.uid;
    return `<div class="card resFila" style="margin-bottom:8px">
      <div class="row resCab" style="justify-content:space-between;margin-top:0" data-action="resFila" data-u="${f.uid}">
        <div><b>${esc(f.nombre)}</b><div class="meta" style="margin:0">${esc(f.email)}${f.ini&&ms(f.ini.inicio)?' · inició '+esc(fmtFechaHora(ms(f.ini.inicio))):''}${f.intento&&ms(f.intento.enviado)?' · entregó '+esc(fmtFechaHora(ms(f.intento.enviado))):''}${minutosUsados(f)!=null?' · '+minutosUsados(f)+' min':''}</div></div>
        <div style="text-align:right">${f.res?`<b style="color:${colorPct(f.res.pct)}">${f.res.ok}/${f.res.total} · ${f.res.pct}%</b><div class="meta" style="margin:0">nota ${fmtN(f.res.nota)} / ${f.res.escala}</div>`
          :f.intento?'<span class="chip">Entregó (calculando…)</span>':f.ini?'<span class="chip">⏳ Empezó y no entregó</span>':'<span class="chip">⏳ Sin entregar</span>'}</div>
      </div>
      ${abierto&&f.res?detalleEstudianteHTML(f,ex):''}
    </div>`}).join(''):'<div class="empty">Todavía no hay estudiantes en esta materia.</div>'}

  ${st.entregaron?`<h2 style="margin:22px 0 10px">❓ Resultados por pregunta</h2>
  ${r.preguntas.map((p,i)=>`<div class="card" style="margin-bottom:8px"><div class="row" style="justify-content:space-between;margin-top:0;align-items:flex-start">
      <div><b>${i+1}. ${esc(p.q.enunciado)}</b>${p.q.temaTitulo?`<div class="meta" style="margin:2px 0 0">${esc(p.q.temaTitulo)}</div>`:''}</div>
      <div style="text-align:right;white-space:nowrap"><b style="color:${colorPct(p.pct)}">${p.pct==null?'—':p.pct+'%'}</b><div class="meta" style="margin:0">${p.aciertos}/${p.n} acertaron</div></div></div>
      ${barraPct(p.pct)}
      ${p.pct!=null&&p.pct<50?'<span class="chip" style="color:var(--no);border-color:var(--no)">⚠️ Pregunta difícil</span> ':''}
      ${p.peor?`<span class="meta">Error más común: <b>${esc(p.peor.texto)}</b> (${p.peor.veces} estudiante${p.peor.veces==1?'':'s'})</span>`:''}
    </div>`).join('')}
  <h2 style="margin:22px 0 10px">📚 Temas que más cuestan</h2>
  ${r.porTema.map(t=>`<div class="card" style="margin-bottom:8px"><div class="row" style="justify-content:space-between;margin-top:0"><b>${esc(t.titulo)}</b><b style="color:${colorPct(t.pct)}">${t.pct}% de acierto</b></div>${barraPct(t.pct)}<span class="meta">${t.ok} de ${t.n} respuestas correctas</span></div>`).join('')}`:''}`;
}
/* ---------- Excel (.xlsx) sin librerías extra: se arma con JSZip, que ya se usa para leer PPTX ---------- */
const xmlEsc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
const colLetra=n=>{let s='';n++;while(n>0){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26)}return s};
function hojaXML(h){
  const filas=h.filas.map((fila,i)=>`<row r="${i+1}">${fila.map((v,j)=>{
    if(v===null||v===undefined||v==='')return '';
    const ref=colLetra(j)+(i+1),st=i===0?' s="1"':'';
    if(typeof v==='number'&&isFinite(v))return `<c r="${ref}"${st}><v>${v}</v></c>`;
    return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const cols=h.anchos?`<cols>${h.anchos.map((w,j)=>`<col min="${j+1}" max="${j+1}" width="${w}" customWidth="1"/>`).join('')}</cols>`:'';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+cols+'<sheetData>'+filas+'</sheetData></worksheet>';
}
async function crearXlsx(hojas){
  const JSZ=await cargarJSZip(),z=new JSZ();
  const nombres=hojas.map((h,i)=>xmlEsc(String(h.nombre||'Hoja'+(i+1)).replace(/[\[\]:*?\/\\]/g,' ').slice(0,31)));
  z.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+hojas.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>');
  z.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  z.file('xl/workbook.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+hojas.map((_,i)=>`<sheet name="${nombres[i]}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets></workbook>');
  z.file('xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+hojas.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+`<Relationship Id="rId${hojas.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  z.file('xl/styles.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>');
  hojas.forEach((h,i)=>z.file(`xl/worksheets/sheet${i+1}.xml`,hojaXML(h)));
  const bytes=await z.generateAsync({type:'uint8array',compression:'DEFLATE'});
  return new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
function bajarBlob(blob,nombre){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=nombre;
  document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
}
const nombreArchivo=(t,suf)=>(t||'examen').replace(/[^\wáéíóúñÁÉÍÓÚÑ -]+/g,'').trim().replace(/\s+/g,'_')+suf;
async function descargarXlsx(m,ex){
  const r=resultadosDe(m,ex);
  const hora=t=>t?fmtFechaHora(t):'';
  const notas=[['Estudiante','Correo','Estado','Aciertos','Total','Porcentaje','Nota','Escala','Inició','Entregó','Minutos usados']];
  r.filas.forEach(f=>notas.push([f.nombre,f.email,f.res?'Entregó':f.intento?'Entregó (sin calificar)':f.ini?'Empezó y no entregó':'Sin entregar',
    f.res?f.res.ok:'',f.res?f.res.total:'',f.res?f.res.pct:'',f.res?f.res.nota:'',f.res?f.res.escala:'',
    f.ini?hora(ms(f.ini.inicio)):'',f.intento?hora(ms(f.intento.enviado)):'',minutosUsados(f)==null?'':minutosUsados(f)]));
  const preg=[['N.º','Pregunta','Tema','% de acierto','Respondieron','Acertaron','Opción incorrecta más elegida','Veces']];
  r.preguntas.forEach((p,i)=>preg.push([i+1,p.q.enunciado,p.q.temaTitulo||'',p.pct==null?'':p.pct,p.n,p.aciertos,p.peor?p.peor.texto:'',p.peor?p.peor.veces:'']));
  const resp=[['Estudiante','Correo','N.º','Pregunta','Tema','Respuesta elegida','Respuesta correcta','Resultado']];
  r.filas.forEach(f=>{if(!f.res)return;f.res.det.forEach((d,i)=>resp.push([f.nombre,f.email,i+1,d.q.enunciado,d.q.temaTitulo||'',
    d.elegido===undefined?'(sin responder)':((d.q.opciones||[])[d.elegido]||''),(d.q.opciones||[])[d.correcta]||'',d.acierto?'Correcta':'Incorrecta']))});
  const blob=await crearXlsx([{nombre:'Notas',filas:notas,anchos:[28,30,22,10,8,12,8,8,18,18,14]},{nombre:'Por pregunta',filas:preg,anchos:[6,60,24,12,13,10,36,8]},{nombre:'Respuestas',filas:resp,anchos:[28,30,6,60,24,34,34,12]}]);
  bajarBlob(blob,nombreArchivo(ex.titulo,'_notas.xlsx'));
}
/* Libro de notas: una fila por estudiante y una columna por examen, con el promedio */
async function descargarLibroNotas(m){
  const exs=examenesDe(m).filter(e=>e.estado!=='borrador').sort((x,y)=>ms(x.creado)-ms(y.creado));
  if(!exs.length){alert('Todavía no hay exámenes publicados.');return}
  const res=exs.map(ex=>resultadosDe(m,ex));
  const filas=[['Estudiante','Correo',...exs.map(e=>e.titulo||'Examen'),'Promedio']];
  res[0].filas.forEach((f0,k)=>{
    const notas=res.map(r=>{const f=r.filas.find(x=>x.uid===f0.uid);return f&&f.res?f.res.nota:''});
    const num=notas.filter(x=>x!=='');
    filas.push([f0.nombre,f0.email,...notas,num.length?Math.round(num.reduce((s,x)=>s+x,0)/num.length*100)/100:'']);
  });
  const blob=await crearXlsx([{nombre:'Libro de notas',filas,anchos:[28,30,...exs.map(()=>14),12]}]);
  bajarBlob(blob,nombreArchivo(m.name,'_libro_de_notas.xlsx'));
}
function bajarCsv(titulo,sufijo,filas){
  const celda=v=>{v=String(v==null?'':v);if(/^[=+\-@]/.test(v)&&isNaN(Number(v)))v="'"+v;return /[",\n;]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  const csv='\ufeff'+filas.map(f=>f.map(celda).join(',')).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  a.download=(titulo||'examen').replace(/[^\wáéíóúñÁÉÍÓÚÑ -]+/g,'').trim().replace(/\s+/g,'_')+sufijo+'.csv';
  document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
}
function descargarCsv(m,ex){
  const r=resultadosDe(m,ex);
  const filas=[['Estudiante','Correo','Aciertos','Total','Porcentaje','Nota','Escala','Entregado']];
  r.filas.forEach(f=>filas.push([f.nombre,f.email,f.res?f.res.ok:'',f.res?f.res.total:'',f.res?f.res.pct+'%':'',f.res?f.res.nota:'',f.res?f.res.escala:'',f.intento?fmtFechaHora(ms(f.intento.enviado)):'Sin entregar']));
  bajarCsv(ex.titulo,'_notas',filas);
}
/* Una fila por estudiante y pregunta: respuesta elegida, respuesta correcta y si acertó */
function descargarCsvDetalle(m,ex){
  const r=resultadosDe(m,ex);
  const filas=[['Estudiante','Correo','N.º','Pregunta','Tema','Respuesta elegida','Respuesta correcta','Resultado']];
  r.filas.forEach(f=>{
    if(!f.res){filas.push([f.nombre,f.email,'','','','','',f.intento?'Entregó (sin calificar)':'Sin entregar']);return}
    f.res.det.forEach((d,i)=>filas.push([f.nombre,f.email,i+1,d.q.enunciado,d.q.temaTitulo||'',
      d.elegido===undefined?'(sin responder)':((d.q.opciones||[])[d.elegido]||''),(d.q.opciones||[])[d.correcta]||'',d.acierto?'Correcta':'Incorrecta']));
  });
  bajarCsv(ex.titulo,'_respuestas',filas);
}

/* ======================= ESTUDIANTE: exámenes de su profesor ======================= */
/* ---------- Orden distinto para cada estudiante ----------
   La mezcla sale de (examen + estudiante), así es la misma si recarga la página. Las respuestas se guardan con el
   número de opción ORIGINAL, por eso la calificación y los resultados del docente no cambian. */
function semillaTxt(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function prng(seed){return()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function barajarCon(arr,rnd){const x=arr.slice();for(let i=x.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[x[i],x[j]]=[x[j],x[i]]}return x}
function ordenExamen(ex,uidEst){
  const qs=ex.preguntas||[],llenas=q=>[0,1,2,3].filter(j=>String((q.opciones||[])[j]||'').trim());
  if(ex.mezclar===false)return qs.map(q=>({q,ops:llenas(q)}));
  const rnd=prng(semillaTxt(ex.id+'|'+uidEst));
  return barajarCon(qs,rnd).map(q=>({q,ops:barajarCon(llenas(q),rnd)}));
}
/* ---------- Tiempo límite: hora de inicio y reloj ---------- */
const iniMap={};      // sid -> {exId_uid: {inicio,...}}
let exTimer=null;
function clearExTimer(){if(exTimer){clearInterval(exTimer);exTimer=null}}
const exKeyLocal=exId=>'auren_ex_'+currentUid+'_'+exId;
function cargarRespLocal(exId){try{return JSON.parse(localStorage.getItem(exKeyLocal(exId))||'{}')||{}}catch(e){return{}}}
function guardarRespLocal(){try{if(exTom&&route.examId)localStorage.setItem(exKeyLocal(route.examId),JSON.stringify(exTom.respuestas))}catch(e){}}
function borrarRespLocal(exId){try{localStorage.removeItem(exKeyLocal(exId))}catch(e){}}
function miInicio(m,exId){const d=(iniMap[m.sharedId]||{})[exId+'_'+currentUid];return d?ms(d.inicio):0}
function exRestanteMs(ex){return exTom&&exTom.inicio?exTom.inicio+(ex.duracion||0)*60000-(Date.now()+(exTom.skew||0)):Infinity}
function fmtRestante(r){const s=Math.max(0,Math.ceil(r/1000)),h=Math.floor(s/3600),mi=Math.floor(s%3600/60),se=s%60;return(h?h+':'+String(mi).padStart(2,'0'):String(mi))+':'+String(se).padStart(2,'0')}
function iniciarRelojExamen(m){
  clearExTimer();
  const ex=(exMap[m.sharedId]||{})[route.examId];
  if(!ex||!(ex.duracion>0)||!exTom||!exTom.inicio)return;
  const tic=()=>{
    const r=exRestanteMs(ex),el=$('exReloj');
    if(el){el.textContent='⏱️ '+fmtRestante(r);el.classList.toggle('urgente',r<=60000)}
    if(r<=0){clearExTimer();entregarExamenEst(m,true)}
  };
  tic();exTimer=setInterval(tic,1000);
}
async function comenzarExamenEst(m){
  const ex=(exMap[m.sharedId]||{})[route.examId];if(!ex||!exTom||exTom.comenzando)return;
  exTom.comenzando=true;exTom.error='';render(true);
  const id=ex.id+'_'+currentUid,ref=baseDe(m).collection('inicios').doc(id);
  try{
    try{await ref.set({examId:ex.id,uid:currentUid,nombre:miNombre(),inicio:firebase.firestore.FieldValue.serverTimestamp()})}
    catch(e){if(!(e&&e.code==='permission-denied'))throw e}      // si ya había empezado antes, se lee su hora de inicio
    const d=await ref.get({source:'server'});
    if(!d.exists)throw new Error('No se pudo registrar la hora de inicio');
    const t=ms(d.data().inicio);
    (iniMap[m.sharedId]=iniMap[m.sharedId]||{})[id]={id,...d.data()};
    exTom.inicio=t;exTom.skew=t-Date.now();
  }catch(e){console.error(e);exTom.error='No se pudo comenzar el examen'+detalleError(e)+'. Si eres tú quien administra la página, revisa que las reglas de Firestore estén publicadas.'}
  exTom.comenzando=false;render(true);iniciarRelojExamen(m);
}
function miIntento(m,exId){return (inMap[m.sharedId]||{})[exId+'_'+currentUid]}
function examenesEstudianteHTML(m){
  const exs=examenesDe(m);
  if(!exs.length)return '';
  const sid=m.sharedId;
  return `<div class="card shareBox" style="margin-top:12px"><b style="font-size:.9em">📝 Exámenes de tu profesor</b>
    ${exs.map(ex=>{
      const it=miIntento(m,ex.id);
      let estado='',accion='';
      if(it){
        asegurarClave(m,ex.id);
        const cl=(clMap[sid]||{})[ex.id];
        const r=cl?calificar(ex,cl,it.respuestas||{}):null;
        estado=r?`<span class="chip chipOk">✅ ${r.ok}/${r.total} · nota ${fmtN(r.nota)}/${r.escala}</span>`:'<span class="chip chipOk">✅ Entregado</span>';
        accion=`<button class="sec" data-action="exPresentar" data-id="${m.id}" data-ex="${ex.id}">Ver resultado</button>`;
      }else if(examAbierto(ex)){
        estado=ex.cierre?`<span class="chip">⏰ hasta ${fmtFechaHora(ex.cierre)}</span>`:'<span class="chip">Pendiente</span>';
        accion=`<button class="pr" data-action="exPresentar" data-id="${m.id}" data-ex="${ex.id}">Presentar examen</button>`;
      }else estado='<span class="chip">🔒 Cerrado sin entregar</span>';
      return `<div style="margin-top:12px"><div><b>${esc(ex.titulo||'Examen')}</b> <span class="meta">· ${(ex.preguntas||[]).length} preguntas</span></div><div class="row" style="flex-wrap:wrap">${estado}${accion}</div></div>`;
    }).join('')}
  </div>`;
}
async function abrirExamenEst(m,exId){
  const exx=(exMap[m.sharedId]||{})[exId];
  if(!miIntento(m,exId)&&(!exx||!examAbierto(exx))){alert('Este examen ya no está disponible.');return}
  clearExTimer();
  exTom={respuestas:miIntento(m,exId)?{}:cargarRespLocal(exId),resultado:null,cargando:false,error:'',inicio:0,skew:0};
  const ini=miInicio(m,exId);if(ini&&!miIntento(m,exId))exTom.inicio=ini;       // retoma un examen que ya había empezado
  route={view:'examenDoc',materiaId:m.id,examId:exId};
  render();
  if(miIntento(m,exId))await cargarResultadoEst(m,exId);
  else iniciarRelojExamen(m);
}
async function cargarResultadoEst(m,exId){
  exTom.cargando=true;render(true);
  try{
    const d=await baseDe(m).collection('claves').doc(exId).get();
    if(!d.exists)throw new Error('sin-clave');
    (clMap[m.sharedId]=clMap[m.sharedId]||{})[exId]={id:exId,...d.data()};
    const ex=(exMap[m.sharedId]||{})[exId],it=miIntento(m,exId);
    exTom.resultado=calificar(ex,clMap[m.sharedId][exId],(it&&it.respuestas)||exTom.respuestas);
    exTom.error='';
  }catch(e){console.error(e);exTom.error='No se pudieron cargar tus resultados'+detalleError(e)+'.'}
  exTom.cargando=false;render(true);
}
async function entregarExamenEst(m,forzado){
  const ex=(exMap[m.sharedId]||{})[route.examId];if(!ex||!exTom||exTom.enviando)return;
  const faltan=(ex.preguntas||[]).filter(q=>exTom.respuestas[q.id]===undefined).length;
  if(!forzado){
    if(faltan&&!(ex.duracion>0)){alert('Te faltan '+faltan+' pregunta'+(faltan==1?'':'s')+' por responder.');return}
    if(faltan){if(!confirm('Te faltan '+faltan+' pregunta'+(faltan==1?'':'s')+' sin responder. ¿Entregar de todos modos?'))return}
    else if(!confirm('¿Entregar el examen? No podrás cambiar tus respuestas.'))return;
  }
  clearExTimer();
  exTom.enviando=true;exTom.error='';render(true);
  try{
    const u=auth.currentUser;
    await baseDe(m).collection('intentos').doc(ex.id+'_'+currentUid).set({
      examId:ex.id,uid:currentUid,nombre:miNombre(),email:(u&&u.email)||'',
      respuestas:exTom.respuestas,enviado:firebase.firestore.FieldValue.serverTimestamp()});
    exTom.enviando=false;borrarRespLocal(ex.id);
    (inMap[m.sharedId]=inMap[m.sharedId]||{})[ex.id+'_'+currentUid]={id:ex.id+'_'+currentUid,examId:ex.id,uid:currentUid,respuestas:{...exTom.respuestas}};
    await cargarResultadoEst(m,ex.id);
  }catch(e){
    console.error(e);exTom.enviando=false;
    exTom.error=(e&&e.code==='permission-denied')?'No se pudo entregar: el examen ya cerró, se acabó tu tiempo o no tienes permiso. Avisa a tu profesor.':'No se pudo entregar'+detalleError(e)+'. Inténtalo de nuevo.';
    render(true);
  }
}
function viewExamenDocHTML(){
  const m=materiaRuta(),ex=m&&(exMap[m.sharedId]||{})[route.examId];
  if(!m||!ex||!exTom)return '<div class="empty">No se encontró el examen. <button class="sec" data-action="backMaterias">Volver</button></div>';
  const volver=`<button class="sec" data-action="backMateria" data-id="${m.id}">← ${esc(m.name)}</button>`;
  const err=exTom.error?`<div class="fb fbNo" role="alert">${esc(exTom.error)}</div>`:'';
  if(exTom.resultado){
    const r=exTom.resultado,tono=r.pct>=70?'alto':r.pct>=40?'medio':'bajo';
    const msg=r.pct===100?'¡Perfecto! 🤩':r.pct>=70?'¡Excelente trabajo! 🎉':r.pct>=40?'Vas bien, repasa lo que fallaste 💪':'Cada intento cuenta. ¡Repasa y sigue! 🌱';
    return `${volver}
    <div class="empty resultado" style="margin-top:14px"><h2>📝 ${esc(ex.titulo||'Examen')}</h2>
      <div class="ringWrap ${tono}"><svg class="ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="rbg" cx="60" cy="60" r="52"/><circle class="rfg" cx="60" cy="60" r="52" style="--p:${r.pct}"/></svg>
        <div class="ringTxt"><b class="countUp" data-to="${r.ok}">${r.ok}</b><span>/ ${r.total}</span></div></div>
      <p class="resMsg">${msg}</p>
      <p class="meta">Nota: <b>${fmtN(r.nota)} / ${r.escala}</b> · ${r.pct}%</p>
      <div class="resList">${r.det.map((d,i)=>`<div class="resRow ${d.acierto?'bien':'mal'}" style="--i:${Math.min(i,14)};margin-top:10px"><b>${i+1}. ${esc(d.q.enunciado)}</b>
        <div class="meta" style="margin:2px 0 0">${d.acierto?'✅':'❌'} Tu respuesta: <b>${esc((d.q.opciones||[])[d.elegido]||'(sin responder)')}</b>${d.acierto?'':' · Correcta: <b>'+esc((d.q.opciones||[])[d.correcta]||'')+'</b>'}</div></div>`).join('')}</div>
    </div>`;
  }
  if(exTom.cargando||miIntento(m,ex.id))return `${volver}<div class="empty" style="margin-top:14px">${err||'Cargando tus resultados…'}</div>`;
  if(ex.duracion>0&&!exTom.inicio)return `${volver}
  <div class="card" style="margin-top:14px"><h2 style="margin-top:0">📝 ${esc(ex.titulo||'Examen')}</h2>
    <p>Este examen tiene <b>${ex.duracion} minuto${ex.duracion==1?'':'s'}</b> de tiempo límite y <b>${(ex.preguntas||[]).length} pregunta${(ex.preguntas||[]).length==1?'':'s'}</b>.</p>
    <p class="meta">El reloj empieza cuando pulses <b>Comenzar</b> y no se detiene aunque salgas de la página. Tu hora de inicio queda registrada. Si se acaba el tiempo, se entrega lo que lleves respondido.</p>
    ${err}
    <button class="pr" data-action="exComenzar" ${exTom.comenzando?'disabled':''}>${exTom.comenzando?'Comenzando…':'▶️ Comenzar'}</button></div>`;
  const total=(ex.preguntas||[]).length,hechas=(ex.preguntas||[]).filter(q=>exTom.respuestas[q.id]!==undefined).length;
  const orden=ordenExamen(ex,currentUid),conTiempo=ex.duracion>0;
  return `${volver}
  <div class="viewhead" style="margin-top:14px"><h1>📝 ${esc(ex.titulo||'Examen')}</h1><span class="meta">${hechas} / ${total}</span></div>
  ${conTiempo?`<div class="exRelojWrap"><span id="exReloj" class="chip exReloj">⏱️ ${fmtRestante(exRestanteMs(ex))}</span><small class="meta">Tiempo límite: ${ex.duracion} min. Al acabarse se entrega lo que lleves.</small></div>`:''}
  <div class="bar qbar"><i style="width:${total?Math.round(hechas/total*100):0}%;--from:${total?Math.round(hechas/total*100):0}%"></i></div>
  ${ex.cierre?`<p class="meta">Cierra ${fmtFechaHora(ex.cierre)}</p>`:''}
  ${orden.map(({q,ops},i)=>`<div class="card qCard" style="margin-bottom:12px"><h3 style="margin-top:0">${i+1}. ${esc(q.enunciado)}</h3>
    ${ops.map(j=>`<button class="sec optBtn ${exTom.respuestas[q.id]===j?'chosen':''}" data-action="exResp" data-q="${q.id}" data-i="${j}">${esc(q.opciones[j])}</button>`).join('')}</div>`).join('')}
  ${err}
  <button class="pr nextBtn" data-action="exEntregar" ${(hechas<total&&!conTiempo)||exTom.enviando?'disabled':''}>${exTom.enviando?'Entregando…':'Entregar examen'}</button>
  ${hechas<total&&!conTiempo?'<p class="meta">Responde todas las preguntas para poder entregar.</p>':''}`;
}

/* ======================= Menús y pantallas por rol ======================= */
function aplicarRolMenu(){
  const prof=esProfesor();
  document.body.classList.toggle('modoProfe',prof);
  const visibles=prof?['docente','perfil']:['materias','calendario','logros','perfil'];
  document.querySelectorAll('#mainNav [data-nav]').forEach(b=>{b.style.display=visibles.includes(b.dataset.nav)?'':'none'});
  const d=document.querySelector('#mainNav [data-nav="docente"]');if(d)d.textContent='🏫 Mis materias';
  const ct=$('ct');if(ct)ct.textContent=prof?'🏫 Auren · Docente':'📚 Auren';
  const sw=$('searchWrap');if(sw)sw.style.display=prof?'none':'';
  pintarCampana();
}
/* Cada rol solo entra a sus propias pantallas */
function guardarRuta(){
  const m=route.materiaId?state.materias.find(x=>x.id===route.materiaId):null;
  if(esProfesor()){
    const personal=['materias','calendario','logros'].includes(route.view)||(['materiaDetail','tool'].includes(route.view)&&!(m&&m.rol==='docente'));
    if(personal)route={view:'docente',materiaId:null};
  }else if(['docente','docExamen','docResultados'].includes(route.view)){
    route={view:'materias',materiaId:null};
  }
}
function viewPerfilDocenteHTML(){
  const p=state.profile;
  const mats=state.materias.filter(m=>m.rol==='docente');
  const nEx=mats.reduce((a,m)=>a+Object.keys(exMap[m.sharedId]||{}).length,0);
  return `
    <div class="viewhead"><h1>👤 Mi perfil</h1></div>
    <div class="card">
      <div class="pfhero"><div class="pfav">${esc(p.avatar)}</div><div><h2 style="margin:0">${esc(p.name)||'Profesor'}</h2><p class="meta" style="margin:2px 0 0">${esc(p.career)||'Agrega tu institución'}</p></div></div>
      <div class="pgs"><div><b>${mats.length}</b>materias</div><div><b>${nEx}</b>exámenes</div></div>
    </div>
    <div class="card"><h3>Avatar</h3><div class="avatarPicker">${AV.map(a=>`<button class="avBtn ${a===p.avatar?'on':''}" data-action="setAvatar" data-a="${a}">${a}</button>`).join('')}</div></div>
    <div class="card">
      <h3>Editar perfil</h3>
      <label class="lbl">Nombre (lo verán tus estudiantes)</label><input class="fld" data-action="profileField" data-f="name" value="${esc(p.name)}" maxlength="40">
      <label class="lbl">Institución</label><input class="fld" data-action="profileField" data-f="career" value="${esc(p.career)}" maxlength="80">
      <label class="lbl">Escala de notas de tus exámenes</label><select class="fld" data-action="setScale" style="max-width:220px">${[5,10,100].map(n=>`<option value="${n}" ${scaleMax()===n?'selected':''}>0 a ${n}</option>`).join('')}</select>
      <p class="meta" style="margin:6px 0 0">Se aplica a los exámenes nuevos. Los ya creados conservan su escala.</p>
    </div>
    <div class="card">
      <h3>Tipo de cuenta</h3>
      <p class="meta">Estás en el portal docente. Si cambias a estudiante verás el cuaderno de estudio; tus materias de profesor no se borran.</p>
      <div class="row"><button class="sec" data-action="setRol" data-rol="estudiante">🎓 Estudiante</button><button class="pr" data-action="setRol" data-rol="docente">👩‍🏫 Profesor</button></div>
    </div>
    <div class="card">
      <h3>Cuenta</h3>
      <p class="meta">Conectado como <b>${esc(auth.currentUser&&auth.currentUser.email||'')}</b></p>
      <button class="sec" data-action="logout">🚪 Cerrar sesión</button>
    </div>`;
}

/* ======================= Acciones ======================= */
document.addEventListener('input',e=>{
  const ea=e.target.dataset&&e.target.dataset.action;
  if(ea==='bancoCorte'){bancoFiltro.corte=e.target.value;render(true);return}
  if(ea==='bancoTexto'){bancoFiltro.texto=e.target.value;render(true);return}
  if(ea==='bancoSel'){const id=e.target.dataset.bid;if(e.target.checked)bancoSel.add(id);else bancoSel.delete(id);render(true);return}
  const el=e.target,k=el.dataset&&el.dataset.ex;
  if(!k||!exBuf||exBuf.estado!=='borrador')return;
  if(k==='titulo')exBuf.titulo=el.value;
  else if(k==='cierre')exBuf.cierre=el.value?new Date(el.value).getTime():0;
  else if(k==='duracion')exBuf.duracion=Math.max(0,Math.min(600,parseInt(el.value)||0));
  else if(k==='mezclar')exBuf.mezclar=!!el.checked;
  else{
    const q=exBuf.preguntas.find(x=>x.id===el.dataset.q);if(!q)return;
    if(k==='enun')q.enunciado=el.value;
    else if(k==='opt')q.opciones[+el.dataset.i]=el.value;
  }
  exGuardarLuego();
});
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-action]');if(!b)return;
  const a=b.dataset.action;
  const m=b.dataset.id?state.materias.find(x=>x.id===b.dataset.id):null;
  if(a==='docTab'){docTab=b.dataset.tab;render(true)}
  else if(a==='newExam'&&m)crearExamen(m);
  else if(a==='exEditar'&&m)abrirEditor(m,b.dataset.ex);
  else if(a==='exResultados'&&m&&m.rol==='docente'){docResSel=null;docResFiltro='todas';route={view:'docResultados',materiaId:m.id,examId:b.dataset.ex};render()}
  else if(a==='exEstado'&&m){
    try{await baseDe(m).collection('examenes').doc(b.dataset.ex).update({estado:b.dataset.to})}
    catch(err){console.error(err);alert('No se pudo cambiar el estado'+detalleError(err)+'.')}
  }
  else if(a==='exEliminarLista'&&m){
    if(confirm('¿Eliminar este examen y todas las entregas de tus estudiantes? No se puede deshacer.'))exEliminarExamen(m,b.dataset.ex);
  }
  else if(a==='exVolver'){
    await exGuardarYa();exBuf=null;
    const mm=materiaRuta();
    if(mm){docTab='examenes';docTabMat=mm.id;route={view:'materiaDetail',materiaId:mm.id};render()}
  }
  else if(a==='exBancoAbrir'){bancoAbierto=true;render(true)}
  else if(a==='exBancoCerrar'){bancoAbierto=false;bancoSel.clear();render(true)}
  else if(a==='exBancoGuardar'&&exBuf){
    const mm=materiaRuta();if(!mm)return;
    try{const n=await guardarEnBanco(mm,exBuf.preguntas);toast(n?'📚 '+n+' pregunta'+(n==1?'':'s')+' guardada'+(n==1?'':'s')+' en tu banco':'No hay preguntas completas para guardar')}
    catch(err){console.error(err);alert('No se pudo guardar en el banco'+detalleError(err)+'. ¿Publicaste las reglas nuevas de Firestore?')}
  }
  else if(a==='exBancoAgregar'&&exBuf&&exBuf.estado==='borrador'){
    const ya=new Set(exBuf.preguntas.map(p=>normTxt(p.enunciado)));let n=0;
    (bancoCache||[]).filter(x=>bancoSel.has(x.id)&&!ya.has(normTxt(x.enunciado))).forEach(x=>{
      exBuf.preguntas.push({id:uid(),enunciado:x.enunciado,opciones:[0,1,2,3].map(i=>(x.opciones||[])[i]||''),correcta:Number(x.correcta)||0,temaId:'',temaTitulo:x.temaTitulo||''});n++;
    });
    bancoSel.clear();if(n){exGuardarLuego();toast('📥 '+n+' pregunta'+(n==1?'':'s')+' agregada'+(n==1?'':'s'))}
    render(true);
  }
  else if(a==='bancoDel'){
    if(confirm('¿Quitar esta pregunta de tu banco? (No se borra de los exámenes donde ya la usaste.)')){
      try{await bancoRef().doc(b.dataset.bid).delete();bancoCache=(bancoCache||[]).filter(x=>x.id!==b.dataset.bid);bancoSel.delete(b.dataset.bid);render(true)}
      catch(err){console.error(err);alert('No se pudo quitar'+detalleError(err)+'.')}
    }
  }
  else if(a==='exAddQ'&&exBuf){
    exBuf.preguntas.push({id:uid(),enunciado:'',opciones:['','','',''],correcta:0,temaId:'',temaTitulo:''});
    exGuardarLuego();render(true);
  }
  else if(a==='exDelQ'&&exBuf){
    exBuf.preguntas=exBuf.preguntas.filter(q=>q.id!==b.dataset.q);exGuardarLuego();render(true);
  }
  else if(a==='exCorrecta'&&exBuf&&exBuf.estado==='borrador'){
    const q=exBuf.preguntas.find(x=>x.id===b.dataset.q);if(q){q.correcta=+b.dataset.i;exGuardarLuego();render(true)}
  }
  else if(a==='exGenerar'&&exBuf){
    const mm=materiaRuta();if(!mm)return;
    const ids=[...document.querySelectorAll('.exTema:checked')].map(x=>x.value);
    const n=Math.max(1,Math.min(40,parseInt($('exN').value)||10));
    if(!ids.length){alert('Elige al menos un tema.');return}
    const nuevas=generarPreguntas(mm,ids,n);
    if(!nuevas.length){alert('No se pudieron generar preguntas. Los temas elegidos necesitan tarjetas, y la materia necesita al menos 2 respuestas distintas.');return}
    exBuf.preguntas=exBuf.preguntas.concat(nuevas);exGuardarLuego();render(true);
  }
  else if(a==='exPublicar'&&exBuf){
    const err=validarExamen(exBuf);if(err){alert(err);return}
    if(!confirm('¿Publicar el examen? Tus estudiantes lo verán de inmediato y ya no podrás editarlo.'))return;
    exBuf.estado='publicado';exBuf.publicadoEn=Date.now();
    await exGuardarYa();render(true);avisoPublicado();
  }
  else if(a==='exABorrador'&&exBuf){
    const mm=materiaRuta();
    if(Object.values(inMap[mm.sharedId]||{}).some(i=>i.examId===exBuf.id)){alert('Ya hay estudiantes que lo presentaron, así que no se puede volver a borrador. Puedes cerrarlo.');return}
    exBuf.estado='borrador';await exGuardarYa();render(true);
  }
  else if(a==='exEliminar'&&exBuf){
    const mm=materiaRuta();
    if(mm&&confirm('¿Eliminar este examen? No se puede deshacer.')){
      const id=exBuf.id;exBuf=null;clearTimeout(exGuardarT);
      await exEliminarExamen(mm,id);
      docTab='examenes';docTabMat=mm.id;route={view:'materiaDetail',materiaId:mm.id};render();
    }
  }
  else if(a==='resFila'){docResSel=docResSel===b.dataset.u?null:b.dataset.u;render(true)}
  else if(a==='exRepetir'){
    const mm=materiaRuta();
    if(mm&&confirm('¿Permitir que este estudiante vuelva a presentar el examen? Se borra su entrega actual.')){
      try{
        await baseDe(mm).collection('intentos').doc(route.examId+'_'+b.dataset.u).delete();
        try{await baseDe(mm).collection('inicios').doc(route.examId+'_'+b.dataset.u).delete()}catch(e2){}      // también su hora de inicio, para que empiece de cero
      }
      catch(err){console.error(err);alert('No se pudo borrar la entrega'+detalleError(err)+'.')}
    }
  }
  else if(a==='exCsv'){const mm=materiaRuta(),ex=mm&&(exMap[mm.sharedId]||{})[route.examId];if(ex&&mm.rol==='docente')descargarCsv(mm,ex)}
  else if(a==='exCsvDet'){const mm=materiaRuta(),ex=mm&&(exMap[mm.sharedId]||{})[route.examId];if(ex&&mm.rol==='docente')descargarCsvDetalle(mm,ex)}
  else if(a==='resFiltro'){docResFiltro=b.dataset.f;render(true)}
  else if(a==='exXlsx'){const mm=materiaRuta(),ex=mm&&(exMap[mm.sharedId]||{})[route.examId];if(ex&&mm.rol==='docente')descargarXlsx(mm,ex).catch(err=>alert('No se pudo crear el Excel'+detalleError(err)+'.'))}
  else if(a==='libroNotas'&&m&&m.rol==='docente'){descargarLibroNotas(m).catch(err=>alert('No se pudo crear el Excel'+detalleError(err)+'.'))}
  else if(a==='exPresentar'&&m)abrirExamenEst(m,b.dataset.ex);
  else if(a==='exResp'&&exTom){exTom.respuestas[b.dataset.q]=+b.dataset.i;guardarRespLocal();render(true)}
  else if(a==='exComenzar'){const mm=materiaRuta();if(mm)comenzarExamenEst(mm)}
  else if(a==='exEntregar'){const mm=materiaRuta();if(mm)entregarExamenEst(mm)}
});

})();

/* Service worker (PWA) */
if('serviceWorker' in navigator){
  window.addEventListener('load',function(){
    navigator.serviceWorker.register('/service-worker.js').catch(function(e){console.warn('SW no registrado',e)});
  });
}
