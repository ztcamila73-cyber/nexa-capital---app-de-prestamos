/**
 * PrestamoApp — respaldo económico independiente en Google Apps Script.
 * PRIVADO: nunca publiques este script como web app ni compartas su edición.
 * Propiedades del proyecto Apps Script (Configuración > Propiedades):
 *   FIREBASE_DATABASE_URL: https://...firebasedatabase.app
 *   FIREBASE_UID: UID de Firebase Authentication del propietario
 *   SERVICE_ACCOUNT_JSON: JSON privado de una cuenta de servicio autorizada
 *   SHEET_ID: opcional, se crea al configurar si falta
 *   FOLDER_ID: opcional, se crea al configurar si falta
 * Necesita OAuth2 Service Account por JWT firmado para Firebase REST.
 */
const PA = { tz:'America/Bogota', sheetName:'PrestamoApp - Respaldo', folderName:'PrestamoApp - Copias históricas', chunkSize:35000 };

function propiedades() {
  const p=PropertiesService.getScriptProperties();
  const url=String(p.getProperty('FIREBASE_DATABASE_URL')||'').replace(/\/+$/,'');
  const uid=p.getProperty('FIREBASE_UID');
  const raw=p.getProperty('SERVICE_ACCOUNT_JSON');
  if (!/^https:\/\/[-\w.]+$/.test(url)||!uid||!raw) throw Error('Faltan FIREBASE_DATABASE_URL, FIREBASE_UID o SERVICE_ACCOUNT_JSON en Propiedades.');
  const key=JSON.parse(raw);
  if (!key.client_email||!key.private_key||!key.token_uri) throw Error('El JSON de la cuenta de servicio está incompleto.');
  return {p,url,uid,key};
}
function base64url(input) {
  return Utilities.base64EncodeWebSafe(input).replace(/=+$/,'');
}
function tokenFirebase(serviceAccount) {
  const epoch=Math.floor(Date.now()/1000);
  const h=base64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const c=base64url(JSON.stringify({iss:serviceAccount.client_email,scope:'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',aud:'https://oauth2.googleapis.com/token',iat:epoch,exp:epoch+3000}));
  const input=h+'.'+c;
  const signed=Utilities.computeRsaSha256Signature(input,serviceAccount.private_key);
  const assertion=input+'.'+base64url(signed);
  const response=UrlFetchApp.fetch('https://oauth2.googleapis.com/token',{
    method:'post',payload:{grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion},muteHttpExceptions:true
  });
  if (response.getResponseCode()!==200) throw Error('No se pudo autorizar la cuenta de servicio para leer Firebase. Código HTTP '+response.getResponseCode());
  return JSON.parse(response.getContentText()).access_token;
}
function consultarFirebase(path,context,accessToken,method,payload) {
  const response=UrlFetchApp.fetch(context.url+'/'+path+'.json',{
    method:method||'get',contentType:'application/json',headers:{Authorization:'Bearer '+accessToken},
    ...(payload?{payload:JSON.stringify(payload)}:{}),muteHttpExceptions:true
  });
  if (response.getResponseCode()<200||response.getResponseCode()>=300) throw Error('Firebase HTTP '+response.getResponseCode()+' en '+path);
  return response.getContentText()?JSON.parse(response.getContentText()):null;
}
function filas(obj) { return Object.values(obj||{}).filter(Boolean); }
function hashSHA256(json) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,json,Utilities.Charset.UTF_8)
    .map(b=>(b&255).toString(16).padStart(2,'0')).join('');
}
function cifra(n) {return Number(n||0);}
function sanitizarCelda(v) {
  if (v==null) return '';
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const txt=String(v);
  return /^[=+\-@]/.test(txt) ? "'"+txt : txt;
}
function ponerTabla(book,nombre,encabezados,registros) {
  const tab=book.getSheetByName(nombre)||book.insertSheet(nombre);
  const result=[encabezados,...registros.map(row=>row.map(sanitizarCelda))];
  tab.clearContents();
  if (tab.getMaxRows()<result.length) tab.insertRowsAfter(tab.getMaxRows(),result.length-tab.getMaxRows());
  if (tab.getMaxColumns()<encabezados.length) tab.insertColumnsAfter(tab.getMaxColumns(),encabezados.length-tab.getMaxColumns());
  tab.getRange(1,1,result.length,encabezados.length).setValues(result);
  tab.setFrozenRows(1);
  tab.getRange(1,1,1,encabezados.length).setFontWeight('bold').setBackground('#e7f0ff');
}
function abrirSheet(ctx) {
  const existing=ctx.p.getProperty('SHEET_ID');
  if(existing) return SpreadsheetApp.openById(existing);
  const sheet=SpreadsheetApp.create(PA.sheetName);
  ctx.p.setProperty('SHEET_ID',sheet.getId());
  return sheet;
}
function abrirCarpeta(ctx) {
  const folderId=ctx.p.getProperty('FOLDER_ID');
  if (folderId) return DriveApp.getFolderById(folderId);
  const folder=DriveApp.createFolder(PA.folderName);
  ctx.p.setProperty('FOLDER_ID',folder.getId());
  return folder;
}
function escribirSheet(book,ctx,data,backupJson,dateIso) {
  const business=filas(data.businesses), clients=filas(data.clients), loans=filas(data.loans), payments=filas(data.payments), moves=filas(data.capitalMovements);
  const valid=payments.filter(x=>!x.voidedAt);
  ponerTabla(book,'Resumen',['Concepto','Valor'],[
    ['Actualización',dateIso],['UID cuenta Firebase',ctx.uid],['Revisión',data.revision||0],
    ['Negocios',business.length],['Clientes',clients.length],['Préstamos',loans.length],['Pagos válidos',valid.length],
    ['Capital prestado histórico',loans.reduce((a,v)=>a+cifra(v.principal),0)],
    ['Capital recuperado histórico',valid.reduce((a,v)=>a+cifra(v.capital),0)],
    ['Intereses recibidos históricos',valid.reduce((a,v)=>a+cifra(v.interest),0)],
    ['ATENCIÓN','El capital recuperado no es ganancia; revisión de gastos e impuestos fuera de esta hoja.']
  ]);
  ponerTabla(book,'Negocios',['ID','Negocio','Capital inicial','Color'],business.map(x=>[x.id,x.name,x.openingCapital,x.color]));
  ponerTabla(book,'Clientes',['ID','Negocio ID','Nombre','Teléfono','Notas'],clients.map(x=>[x.id,x.businessId,x.name,x.phone,x.note]));
  ponerTabla(book,'Prestamos',['ID','Negocio ID','Cliente ID','Capital original','Interés mensual %','Modalidad','Tipo de interés','Entrega','Referencia','Fecha','Próximo pago','Observaciones'],loans.map(x=>[x.id,x.businessId,x.clientId,x.principal,(x.rateBps||0)/100,x.mode,x.interestPlan||'automatic',x.disbursementMethod||'cash',x.disbursementReference||'',x.startDate,x.firstDueDate,x.notes]));
  ponerTabla(book,'Pagos',['ID','Negocio ID','Cliente ID','Préstamo ID','Fecha','Abono capital','Intereses','Recibido por','Anulado','Nota'],payments.map(x=>[x.id,x.businessId,x.clientId,x.loanId,x.date,x.capital,x.interest,x.method||'cash',x.voidedAt||'',x.note]));
  ponerTabla(book,'Capital',['ID','Negocio ID','Fecha','Movimiento','Medio','Monto','Motivo'],moves.map(x=>[x.id,x.businessId,x.date,x.category,x.method||'cash',x.amount,x.note]));
  const charges=loans.flatMap(l=>filas(l.charges).map(c=>[l.id,l.clientId,c.date,c.amount,c.origin||'automatic',c.reason||'']));
  ponerTabla(book,'Intereses',['Préstamo ID','Cliente ID','Vencimiento','Valor causado','Origen','Motivo'],charges);
  const zipped=Utilities.gzip(Utilities.newBlob(backupJson,'application/json','backup.json'));
  const b64=Utilities.base64Encode(zipped.getBytes());
  const chunks=b64.match(new RegExp('.{1,'+PA.chunkSize+'}','g'))||[];
  ponerTabla(book,'DATOS_JSON',['Tipo','Valor'],[['format','PrestamoAppBackup'],['uid',ctx.uid],['revision',data.revision||0],['sha256',hashSHA256(backupJson)],['updatedAt',dateIso],...chunks.map((v,i)=>['chunk_'+i,v])]);
}
/** Ejecutar una vez después de cargar las propiedades. */
function instalarRespaldo() {
  const ctx=propiedades();
  abrirSheet(ctx);abrirCarpeta(ctx);
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='respaldarAhora').forEach(t=>ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('respaldarAhora').timeBased().everyHours(4).create();
  respaldarAhora();
  return 'Respaldo instalado. Se ejecutará aproximadamente cada 4 horas.';
}
/** Copia íntegra cada 4 horas: Sheets actualizable y archivo JSON histórico en Drive. */
function respaldarAhora() {
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(10000)) return 'Otro respaldo sigue activo.';
  let ctx,token;
  try {
    ctx=propiedades(); token=tokenFirebase(ctx.key);
    const data=consultarFirebase('accounts/'+encodeURIComponent(ctx.uid)+'/data',ctx,token,'get');
    if (!data||data.schema!==1||!data.businesses||!data.loans||!data.payments) throw Error('Datos ausentes o incompletos: no reemplazar copia anterior.');
    const iso=new Date().toISOString(),revision=cifra(data.revision);
    const backupJson=JSON.stringify({format:'PrestamoAppBackup',version:1,exportedAt:iso,uid:ctx.uid,data});
    const sheet=abrirSheet(ctx); const folder=abrirCarpeta(ctx);
    // Primero un archivo histórico INDEPENDIENTE, después sobrescribimos las pestañas de consulta.
    const earlier=ctx.p.getProperty('LAST_DRIVE_REVISION');
    const stamp=Utilities.formatDate(new Date(),PA.tz,'yyyyMMdd_HHmmss');
    if (earlier!==String(revision) || ctx.p.getProperty('LAST_DRIVE_DAY')!==stamp.slice(0,8)) {
      folder.createFile(Utilities.newBlob(backupJson,'application/json','PrestamoApp_'+stamp+'_rev'+revision+'.json'));
      ctx.p.setProperties({LAST_DRIVE_REVISION:String(revision),LAST_DRIVE_DAY:stamp.slice(0,8)});
    }
    escribirSheet(sheet,ctx,data,backupJson,iso);
    consultarFirebase('accounts/'+encodeURIComponent(ctx.uid)+'/backupMeta',ctx,token,'put',{
      status:'ok',at:iso,revision,sheetUrl:sheet.getUrl(),provider:'Google Apps Script',frequency:'4h'
    });
    return 'RESPALDO OK. Revisión '+revision+' · '+sheet.getUrl();
  } catch(error) {
    // Nunca afirmar "conectado" cuando ocurrió una falla.
    if(ctx&&token) {try {consultarFirebase('accounts/'+encodeURIComponent(ctx.uid)+'/backupMeta',ctx,token,'put',{status:'error',at:new Date().toISOString(),message:String(error.message).slice(0,200)})}catch(_ignore){}}
    throw error;
  } finally {lock.releaseLock();}
}
/** Recuperación segura: crea un archivo JSON en Drive a partir de la hoja. No pisa Firebase. */
function exportarCopiaDeSheets() {
  const ctx=propiedades(),book=abrirSheet(ctx),tab=book.getSheetByName('DATOS_JSON');
  if(!tab)throw Error('No existe la pestaña DATOS_JSON.');
  const rows=tab.getDataRange().getValues();
  const metadata=Object.fromEntries(rows.slice(1).filter(x=>!String(x[0]).startsWith('chunk_')).map(x=>[String(x[0]),String(x[1])]));
  if(metadata.uid!==ctx.uid)throw Error('El respaldo pertenece a otra cuenta.');
  const chunks=rows.slice(1).filter(x=>String(x[0]).startsWith('chunk_')).sort((a,b)=>Number(String(a[0]).slice(6))-Number(String(b[0]).slice(6))).map(x=>x[1]).join('');
  const unzip=Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(chunks),'application/gzip'));
  const json=unzip.getDataAsString('UTF-8');
  if(hashSHA256(json)!==metadata.sha256)throw Error('Integridad del respaldo fallida; no uses este archivo.');
  const doc=JSON.parse(json);
  if(doc.format!=='PrestamoAppBackup'||doc.uid!==ctx.uid||doc.data.schema!==1)throw Error('Respaldo inválido.');
  const name='PrestamoApp_RESTAURAR_'+Utilities.formatDate(new Date(),PA.tz,'yyyyMMdd_HHmmss')+'.json';
  const file=abrirCarpeta(ctx).createFile(Utilities.newBlob(json,'application/json',name));
  return 'Archivo de recuperación generado: '+file.getUrl()+'. Descárgalo y restáuralo desde la app usando la confirmación doble.';
}
/** Verificación: no escribe ni modifica datos financieros. */
function comprobarEstado() {
  const ctx=propiedades(),token=tokenFirebase(ctx.key);
  const meta=consultarFirebase('accounts/'+encodeURIComponent(ctx.uid)+'/backupMeta',ctx,token,'get');
  return JSON.stringify(meta||{status:'sin copias'},null,2);
}
