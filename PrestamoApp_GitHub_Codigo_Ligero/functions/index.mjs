/** BACKEND SEGURO - Estas funciones se despliegan en Firebase/Google Cloud.
 * Nunca publicar refresh tokens, claves OAuth ni llaves de cifrado en el navegador.
 */
import {initializeApp} from 'firebase-admin/app';
import {getDatabase} from 'firebase-admin/database';
import {getFirestore, FieldValue} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';
import {onCall, onRequest, HttpsError} from 'firebase-functions/v2/https';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import {defineString,defineSecret} from 'firebase-functions/params';
import {google} from 'googleapis';
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';

initializeApp();
const REGION='us-central1';
const APP_ORIGIN=defineString('APP_ORIGIN');
const GOOGLE_CLIENT_ID=defineString('GOOGLE_CLIENT_ID');
const GOOGLE_REDIRECT_URI=defineString('GOOGLE_REDIRECT_URI');
const GOOGLE_CLIENT_SECRET=defineSecret('GOOGLE_CLIENT_SECRET');
const TOKEN_ENCRYPTION_KEY=defineSecret('TOKEN_ENCRYPTION_KEY');
const db=()=>getDatabase();const fs=()=>getFirestore();
const iso=()=>new Date().toISOString();
const dateBogota=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
const needUid=req=>{if(!req.auth?.uid)throw new HttpsError('unauthenticated','Inicia sesión.');return req.auth.uid};
const items=o=>Object.values(o||{}).filter(Boolean);
const balance=(data,loan)=>{
  const paid=items(data.payments).filter(p=>p.loanId===loan.id&&!p.voidedAt);
  return {principal:loan.principal-paid.reduce((a,p)=>a+Number(p.capital||0),0),interest:items(loan.charges).reduce((a,c)=>a+Number(c.amount||0),0)-paid.reduce((a,p)=>a+Number(p.interest||0),0)};
};
function addMonth(d){const [yy,mm,dd]=d.split('-').map(Number);const nd=new Date(Date.UTC(yy,mm,1));const last=new Date(Date.UTC(nd.getUTCFullYear(),nd.getUTCMonth()+1,0)).getUTCDate();return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth()+1).padStart(2,'0')}-${String(Math.min(last,dd)).padStart(2,'0')}`}
function billDue(data,day){
  let changed=false;
  for(const loan of items(data.loans)){
    if(loan.voidedAt||loan.interestPlan==='manual')continue;
    for(let steps=0;loan.nextInterestDate&&loan.nextInterestDate<=day&&steps<600;steps++){
      const bal=balance(data,loan);
      if(bal.principal<=0){loan.nextInterestDate=null;changed=true;break}
      const chargeId=`interest_${loan.nextInterestDate}`;
      loan.charges??={};
      if(!items(loan.charges).some(c=>c.date===loan.nextInterestDate)){loan.charges[chargeId]={id:chargeId,date:loan.nextInterestDate,amount:Math.round(bal.principal*loan.rateBps/10000),origin:'automatic'};changed=true}
      loan.nextInterestDate=addMonth(loan.nextInterestDate);changed=true;
    }
  }
  if(changed){data.revision=(data.revision||0)+1;data.audit??={};const logId=`automatic_interest_${day}`;data.audit[logId]??={id:logId,kind:'BILL_INTEREST',at:iso(),businessId:null,detail:'Cálculo periódico automático'}}
  return changed?data:undefined;
}
async function reconcile(uid){await db().ref(`accounts/${uid}/data`).transaction(current=>current?billDue(current,dateBogota()):undefined,undefined,false)}
function oauthClient(){return new google.auth.OAuth2(GOOGLE_CLIENT_ID.value(),GOOGLE_CLIENT_SECRET.value(),GOOGLE_REDIRECT_URI.value())}
function keyBytes(){const value=TOKEN_ENCRYPTION_KEY.value();if(!/^[a-f0-9]{64}$/i.test(value))throw Error('TOKEN_ENCRYPTION_KEY debe ser una clave hexadecimal de 64 caracteres.');return Buffer.from(value,'hex')}
function encrypt(s){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyBytes(),iv);const encrypted=Buffer.concat([cipher.update(s,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64')}
function decrypt(s){const buff=Buffer.from(s,'base64'),decipher=createDecipheriv('aes-256-gcm',keyBytes(),buff.subarray(0,12));decipher.setAuthTag(buff.subarray(12,28));return Buffer.concat([decipher.update(buff.subarray(28)),decipher.final()]).toString('utf8')}
async function authorizedGoogle(uid){const doc=await fs().doc(`googleLinks/${uid}`).get();if(!doc.exists)return null;const link=doc.data();const client=oauthClient();client.setCredentials({refresh_token:decrypt(link.refreshTokenEncrypted)});return client}
const sanitizeCell=x=>{if(typeof x==='number'&&Number.isFinite(x))return x;const v=String(x??'');return /^[=+@\-\t\r]/.test(v) ? `'${v}`:v}; // Previene fórmulas en celdas visibles.
const fmtRows=(header,values)=>[header, ...values.map(row=>row.map(sanitizeCell))];
function sheetData(data,uid){
  const bs=items(data.businesses), cs=items(data.clients),ls=items(data.loans),ps=items(data.payments),capital=items(data.capitalMovements);
  const totals=bs.map(b=>{
    const all=ls.filter(l=>l.businessId===b.id&&!l.voidedAt);
    const due=all.reduce((a,l)=>a+balance(data,l).principal,0);
    const contributed=b.openingCapital+capital.filter(c=>c.businessId===b.id).reduce((a,c)=>a+c.amount,0);
    return [b.id,b.name,contributed,contributed-due,due,cs.filter(c=>c.businessId===b.id).length,all.length];
  });
  const snapshot=Buffer.from(JSON.stringify({format:'PrestamoAppBackup',version:1,exportedAt:iso(),uid,data}), 'utf8');
  const encoded=gzipSync(snapshot).toString('base64');
  const chunks=encoded.match(/.{1,35000}/g)||[''];
  return {
    'Resumen':fmtRows(['Negocio ID','Negocio','Capital total','Disponible','Prestado','Clientes','Préstamos'],totals),
    'Clientes':fmtRows(['ID','Negocio ID','Nombre','Teléfono','Notas','Creado'],cs.map(c=>[c.id,c.businessId,c.name,c.phone,c.note,c.createdAt])),
    'Préstamos':fmtRows(['ID','Negocio','Cliente ID','Principal inicial','Capital pendiente','Interés pendiente','Tasa mensual (%)','Fecha inicio','Primer vencimiento','Modalidad','Tipo de interés','Medio de entrega'],ls.map(l=>[l.id,l.businessId,l.clientId,l.principal,balance(data,l).principal,balance(data,l).interest,l.rateBps/100,l.startDate,l.firstDueDate,l.mode,l.interestPlan||'automatic',l.disbursementMethod||'cash'])),
    'Pagos':fmtRows(['ID','Negocio','Cliente ID','Préstamo ID','Capital','Interés','Fecha','Medio','Anulado','Notas'],ps.map(p=>[p.id,p.businessId,p.clientId,p.loanId,p.capital,p.interest,p.date,p.method||'cash',p.voidedAt?'SÍ':'NO',p.note])),
    'Capital':fmtRows(['ID','Negocio','Importe (+ / -)','Concepto','Fecha','Medio','Nota'],capital.map(c=>[c.id,c.businessId,c.amount,c.category,c.date,c.method||'cash',c.note])),
    'DATOS_JSON':fmtRows(['Fragmento','Datos comprimidos base64 (GZIP)','SHA256 del archivo JSON sin comprimir'],chunks.map((part,i)=>[i+1,part,i===0?createHash('sha256').update(snapshot).digest('hex'):'']))
  };
}
const sheetTabs=['Resumen','Clientes','Préstamos','Pagos','Capital','DATOS_JSON'];
async function syncSheets(uid,data){
  const client=await authorizedGoogle(uid);if(!client)return {connected:false,synced:false};
  const sheets=google.sheets({version:'v4',auth:client});
  const metaRef=fs().doc(`backupMeta/${uid}`);const snap=await metaRef.get();let spreadsheetId=snap.data()?.spreadsheetId;
  if(!spreadsheetId){
    const created=await sheets.spreadsheets.create({requestBody:{properties:{title:'PrestamoApp - Respaldo'},sheets:sheetTabs.map(title=>({properties:{title,gridProperties:{rowCount:300,columnCount:14}}}))}});
    spreadsheetId=created.data.spreadsheetId;await metaRef.set({spreadsheetId},{merge:true});
  }
  const tabs=sheetData(data,uid);
  // Google Sheets es respaldo secundario: Storage contiene snapshots inmutables,
  // por lo que una actualización interrumpida de hojas visibles no pierde el único backup.
  // Primero actualizamos y luego limpiamos filas sobrantes del respaldo anterior.
  const old=await sheets.spreadsheets.get({spreadsheetId,fields:'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'});
  const sizes=Object.fromEntries((old.data.sheets||[]).map(sh=>[sh.properties.title,sh.properties.gridProperties.rowCount]));
  const requests=[];
  for(const [tab,values] of Object.entries(tabs)){
    const existing=sizes[tab]||0;
    if(!existing){requests.push({addSheet:{properties:{title:tab,gridProperties:{rowCount:Math.max(300,values.length+20),columnCount:14}}}})}
    else if(values.length>existing)requests.push({updateSheetProperties:{properties:{sheetId:(old.data.sheets||[]).find(sh=>sh.properties.title===tab).properties.sheetId,gridProperties:{rowCount:values.length+100}},fields:'gridProperties.rowCount'}});
  }
  // El campo sheetId debe solicitarse para la ampliación de filas.
  if(requests.length)await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests}});
  const dataRanges=Object.entries(tabs).map(([name,values])=>({range:`'${name}'!A1`,values}));
  await sheets.spreadsheets.values.batchUpdate({spreadsheetId,requestBody:{valueInputOption:'RAW',data:dataRanges}});
  // Borra celdas viejas por debajo de las nuevas filas, si las había.
  const clearRanges=Object.entries(tabs).flatMap(([name,v])=>{const n=sizes[name]||Math.max(300,v.length+20);return v.length<n?[`'${name}'!A${v.length+1}:N${n}`]:[]});
  if(clearRanges.length)await sheets.spreadsheets.values.batchClear({spreadsheetId,requestBody:{ranges:clearRanges}});
  await metaRef.set({spreadsheetId,lastSheetsSync:iso(),lastError:null},{merge:true});
  return {connected:true,synced:true,spreadsheetId};
}
async function backupOne(uid){
  await reconcile(uid);
  const snap=await db().ref(`accounts/${uid}/data`).get();if(!snap.exists())return {backupCreated:false,sheetsSynced:false};
  const data=snap.val(),exportedAt=iso();
  const dataJSON=Buffer.from(JSON.stringify({format:'PrestamoAppBackup',version:1,uid,exportedAt,data}),'utf8');
  const bytes=gzipSync(dataJSON);const hash=createHash('sha256').update(dataJSON).digest('hex');
  const safe=exportedAt.replace(/[:.]/g,'-'),path=`backups/${uid}/${dateBogota()}/${safe}-r${data.revision||0}.json.gz`;
  await getStorage().bucket().file(path).save(bytes,{contentType:'application/gzip',resumable:false,metadata:{metadata:{sha256:hash,uid,revision:String(data.revision||0)}}});
  await fs().doc(`backupMeta/${uid}`).set({lastCloudBackup:exportedAt,lastBackupPath:path,lastSha256:hash,lastError:null},{merge:true});
  try{const sh=await syncSheets(uid,data);return {backupCreated:true,sheetsSynced:sh.synced}}
  catch(e){console.error(`Google Sheets sync for ${uid}:`,e);await fs().doc(`backupMeta/${uid}`).set({lastError:`Google Sheets: ${String(e.message||e).slice(0,180)}`},{merge:true});return {backupCreated:true,sheetsSynced:false}}
}
export const backupStatus=onCall({region:REGION},async req=>{
  const uid=needUid(req),[meta,linked]=await Promise.all([fs().doc(`backupMeta/${uid}`).get(),fs().doc(`googleLinks/${uid}`).get()]);
  const data=meta.data()||{};
  return {googleConnected:linked.exists,lastCloudBackup:data.lastCloudBackup||null,lastSheetsSync:data.lastSheetsSync||null,lastError:data.lastError||null,sheetUrl:data.spreadsheetId&&linked.exists?`https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`:null};
});
export const backupManual=onCall({region:REGION,timeoutSeconds:180,memory:'1GiB',secrets:[GOOGLE_CLIENT_SECRET,TOKEN_ENCRYPTION_KEY]},async req=>{
  const uid=needUid(req),meta=await fs().doc(`backupMeta/${uid}`).get();
  const last=meta.data()?.lastManualBackup;
  if(last&&Date.now()-new Date(last).getTime()<60_000)throw new HttpsError('resource-exhausted','Espera un minuto antes de solicitar otra copia.');
  await fs().doc(`backupMeta/${uid}`).set({lastManualBackup:iso()},{merge:true});
  try{return await backupOne(uid)}catch(e){console.error('Manual backup failed:',e);throw new HttpsError('internal','No se creó la copia. Revisa la configuración de Storage y Functions.')}
});
export const connectGoogleSheets=onCall({region:REGION,secrets:[GOOGLE_CLIENT_SECRET]},async req=>{
  const uid=needUid(req);const nonce=randomBytes(24).toString('hex');
  await fs().doc(`oauthStates/${nonce}`).set({uid,createdAt:Date.now()});
  const authUrl=oauthClient().generateAuthUrl({access_type:'offline',prompt:'consent',scope:['https://www.googleapis.com/auth/drive.file'],state:nonce,include_granted_scopes:true});
  return {url:authUrl};
});
export const googleOAuthCallback=onRequest({region:REGION,timeoutSeconds:180,secrets:[GOOGLE_CLIENT_SECRET,TOKEN_ENCRYPTION_KEY]},async (req,res)=>{
  const home=APP_ORIGIN.value().replace(/\/$/,'');
  function redirect(success){res.redirect(302,`${home}/?sheets=${success?'connected':'error'}`)}
  try{
    const state=String(req.query.state||''),code=String(req.query.code||'');if(!state||!code)throw Error('OAuth incompleto');
    const stateRef=fs().doc(`oauthStates/${state}`),doc=await stateRef.get();if(!doc.exists||Date.now()-doc.data().createdAt>10*60*1000)throw Error('Estado OAuth caducado');
    const uid=doc.data().uid;await stateRef.delete(); // nonce de un solo uso
    const client=oauthClient(),response=await client.getToken(code);
    const refreshToken=response.tokens.refresh_token;
    if(!refreshToken)throw Error('Google no devolvió token de renovación; revoca la autorización y reconecta.');
    await fs().doc(`googleLinks/${uid}`).set({refreshTokenEncrypted:encrypt(refreshToken),connectedAt:iso()});
    const snap=await db().ref(`accounts/${uid}/data`).get();if(snap.exists()){
      try{await syncSheets(uid,snap.val())}catch(e){console.error('Sync after auth:',e);await fs().doc(`backupMeta/${uid}`).set({lastError:String(e.message||e).slice(0,180)},{merge:true})}
    }
    redirect(true);
  }catch(err){console.error('OAuth callback:',err);redirect(false)}
});
export const disconnectGoogleSheets=onCall({region:REGION},async req=>{
  const uid=needUid(req);await fs().doc(`googleLinks/${uid}`).delete();return {disconnected:true};
});
export const scheduledDailyBackup=onSchedule({region:REGION,schedule:'0 2 * * *',timeZone:'America/Bogota',timeoutSeconds:540,memory:'1GiB',secrets:[GOOGLE_CLIENT_SECRET,TOKEN_ENCRYPTION_KEY]},async()=>{
  // Versión para negocios pequeños: para millones de cuentas se debe paginar por usuario.
  const users=await db().ref('accounts').get();if(!users.exists())return;
  const uids=Object.keys(users.val()||{});
  for(const uid of uids){try{await backupOne(uid)}catch(e){console.error(`Daily backup failed ${uid}`,e);await fs().doc(`backupMeta/${uid}`).set({lastError:String(e.message||e).slice(0,180)},{merge:true})}}
});


/** Restauración desde respaldos. Verifica identidad y checksum antes de reemplazar.
 * Conserva una copia adicional previa a cada restauración en Cloud Storage.
 */
async function preserveBeforeRestore(uid){
  const old=await db().ref(`accounts/${uid}/data`).get();if(!old.exists())return;
  const buff=gzipSync(Buffer.from(JSON.stringify({format:'PrestamoAppBackup',version:1,uid,exportedAt:iso(),data:old.val()})));
  await getStorage().bucket().file(`backups/${uid}/pre-restore/${iso().replace(/[:.]/g,'-')}.json.gz`).save(buff,{resumable:false,contentType:'application/gzip'});
}
async function applyRestored(uid,backup){
  if(backup?.format!=='PrestamoAppBackup'||backup.uid!==uid||backup.data?.schema!==1)throw new Error('Respaldo incorrecto o pertenece a otra cuenta.');
  for(const part of ['businesses','clients','loans','payments','capitalMovements','audit']){
    if(!backup.data[part]||typeof backup.data[part]!=='object'||Array.isArray(backup.data[part]))throw new Error('Respaldo incompleto.');
  }
  await preserveBeforeRestore(uid);
  const result=await db().ref(`accounts/${uid}/data`).transaction(current=>({...backup.data,revision:Math.max(Number(current?.revision||0),Number(backup.data.revision||0))+1}),undefined,false);
  if(!result.committed)throw Error('La restauración no se confirmó.');
  await fs().doc(`backupMeta/${uid}`).set({lastRestore:iso()},{merge:true});
  return {restored:true,businesses:items(backup.data.businesses).length,clients:items(backup.data.clients).length,loans:items(backup.data.loans).length};
}
export const restoreCloudBackup=onCall({region:REGION,timeoutSeconds:180,memory:'1GiB'},async req=>{
  const uid=needUid(req);if(req.data?.confirmation!=='RESTAURAR')throw new HttpsError('invalid-argument','Confirmación requerida.');
  const meta=await fs().doc(`backupMeta/${uid}`).get(),path=meta.data()?.lastBackupPath;
  if(!path||!path.startsWith(`backups/${uid}/`))throw new HttpsError('not-found','Todavía no existe una copia en la nube.');
  try{
    const [compressed]=await getStorage().bucket().file(path).download();const original=gunzipSync(compressed);
    const hash=createHash('sha256').update(original).digest('hex');
    if(meta.data()?.lastSha256!==hash)throw Error('Checksum de backup no coincide');
    return await applyRestored(uid,JSON.parse(original.toString('utf8')));
  }catch(e){console.error('Cloud restore:',e);throw new HttpsError('internal','No fue posible verificar o restaurar la copia de Storage.');}
});
export const restoreGoogleSheets=onCall({region:REGION,timeoutSeconds:180,memory:'1GiB',secrets:[GOOGLE_CLIENT_SECRET,TOKEN_ENCRYPTION_KEY]},async req=>{
  const uid=needUid(req);if(req.data?.confirmation!=='RESTAURAR')throw new HttpsError('invalid-argument','Confirmación requerida.');
  try{
    const client=await authorizedGoogle(uid);if(!client)throw Error('Google Sheets no está conectado');
    const meta=await fs().doc(`backupMeta/${uid}`).get(),sid=meta.data()?.spreadsheetId;if(!sid)throw Error('No se encontró el archivo de Google Sheets');
    const sheets=google.sheets({version:'v4',auth:client});
    const response=await sheets.spreadsheets.values.get({spreadsheetId:sid,range:"'DATOS_JSON'!A2:C"});
    const rowsData=response.data.values||[];
    if(!rowsData.length)throw Error('La hoja no contiene copia JSON');
    rowsData.sort((a,b)=>Number(a[0])-Number(b[0]));
    const b64=rowsData.map(row=>row[1]||'').join('');
    const json=gunzipSync(Buffer.from(b64,'base64'));
    const hash=createHash('sha256').update(json).digest('hex');
    if(rowsData[0][2]!==hash)throw Error('La verificación de integridad falló');
    return await applyRestored(uid,JSON.parse(json.toString('utf8')));
  }catch(e){console.error('Google restore:',e);throw new HttpsError('internal','No fue posible verificar o restaurar la copia de Google Sheets.');}
});
