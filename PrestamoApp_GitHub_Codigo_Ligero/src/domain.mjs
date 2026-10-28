/** Reglas de negocio sin dependencias. Dinero en pesos enteros (COP). */
export const emptyState = () => ({ schema: 1, revision: 0, businesses: {}, clients: {}, loans: {}, payments: {}, capitalMovements: {}, audit: {} });
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
export const money = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(v || 0));
export const id = () => crypto.randomUUID();
export const asMoney = value => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) throw Error('Ingresa un valor válido en pesos enteros.'); return n; };
export const addMonths = (iso, months = 1) => {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth()+1).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;
};
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(s));
const required = (value, label) => { if (!String(value || '').trim()) throw Error(`Falta ${label}.`); return String(value).trim(); };
export const rows = collection => Object.values(collection || {}).filter(Boolean);
export const PAYMENT_METHODS = Object.freeze({cash:'Efectivo',nequi:'Nequi',transfer:'Transferencia'});
export const paymentMethod = value => {
  const method = value || 'cash';
  if (!Object.hasOwn(PAYMENT_METHODS, method)) throw Error('Selecciona efectivo, Nequi o transferencia.');
  return method;
};
export const activePayments = (s, loanId) => rows(s.payments).filter(p => p.loanId === loanId && !p.voidedAt);
export const loanBalance = (s, loan) => {
  const payments = activePayments(s, loan.id);
  const capitalPaid = payments.reduce((sum,p) => sum + p.capital, 0);
  const interestPaid = payments.reduce((sum,p) => sum + p.interest, 0);
  const interestCharged = rows(loan.charges).reduce((sum,c)=>sum+c.amount,0);
  return { capitalPaid, interestPaid, interestCharged, principalDue: loan.principal - capitalPaid, interestDue: interestCharged - interestPaid };
};
export const businessBalance = (s, businessId) => {
  const b = s.businesses[businessId];
  const capitalAdjustments = rows(s.capitalMovements).filter(c => c.businessId === businessId).reduce((a,c)=>a+c.amount,0);
  const capitalTotal = (b?.openingCapital || 0) + capitalAdjustments;
  const loans = rows(s.loans).filter(l => l.businessId === businessId && !l.voidedAt);
  const principalDue = loans.reduce((acc,l) => acc + loanBalance(s,l).principalDue, 0);
  const interestDue = loans.reduce((acc,l) => acc + loanBalance(s,l).interestDue, 0);
  const interestEarned = rows(s.payments).filter(p => p.businessId === businessId && !p.voidedAt).reduce((acc,p)=>acc+p.interest,0);
  return { capitalTotal, available: capitalTotal - principalDue, principalDue, interestDue, interestEarned, collectedCash: capitalTotal - principalDue + interestEarned, capitalRecovered:rows(s.payments).filter(p=>p.businessId===businessId&&!p.voidedAt).reduce((acc,p)=>acc+p.capital,0), totalLent:loans.reduce((acc,l)=>acc+l.principal,0), loanCount: loans.filter(l=>loanBalance(s,l).principalDue>0 || loanBalance(s,l).interestDue>0).length, clientCount: rows(s.clients).filter(c=>c.businessId===businessId).length };
};
export const applyDueInterest = (state, date = today()) => {
  // Interés del primer período se registra al crear el préstamo.
  // Los períodos posteriores se crean automáticamente en sus fechas de vencimiento.
  for (const loan of rows(state.loans)) {
    if (loan.voidedAt || loan.interestPlan === 'manual' || !loan.nextInterestDate) continue;
    let count = 0;
    while (loan.nextInterestDate <= date && count++ < 600) {
      const balance = loanBalance(state, loan);
      if (balance.principalDue <= 0) { loan.nextInterestDate = null; break; }
      const amount = Math.round(balance.principalDue * loan.rateBps / 10000);
      const chargeId = `interest_${loan.nextInterestDate}`;
      if (!loan.charges) loan.charges = {};
      if (!rows(loan.charges).some(c=>c.date===loan.nextInterestDate)) loan.charges[chargeId] = { id: chargeId, date: loan.nextInterestDate, amount, origin:'automatic' };
      loan.nextInterestDate = addMonths(loan.nextInterestDate);
    }
  }
  return state;
};
export function reduceState(original, action) {
  const s = structuredClone(original || emptyState());
  if (!s.audit) s.audit = {};
  if (s.audit[action.opId]) return s; // Reintentos de red: no generan duplicados.
  const kind = action.kind, p = action.payload || {};
  if (!action.opId || !action.at) throw Error('Operación sin identificador o fecha.');
  const checkBusiness = b => { if (!s.businesses[b]) throw Error('El negocio no existe.'); };
  const checkClient = c => { if (!s.clients[c]) throw Error('El cliente no existe.'); };
  if (kind === 'CREATE_BUSINESS') {
    const openingCapital = asMoney(p.openingCapital);
    s.businesses[p.id] = { id: p.id, name: required(p.name,'el nombre del negocio'), color:p.color || '#155cfb', openingCapital, createdAt:action.at };
  } else if (kind === 'EDIT_BUSINESS') {
    checkBusiness(p.id);
    s.businesses[p.id].name = required(p.name,'el nombre del negocio');
    s.businesses[p.id].color = p.color || '#155cfb';
  } else if (kind === 'CAPITAL_MOVE') {
    checkBusiness(p.businessId);
    const magnitude = asMoney(p.amount); if (!magnitude) throw Error('El importe debe ser mayor que cero.');
    const amount = p.type==='withdraw' ? -magnitude : magnitude;
    if (amount < 0 && businessBalance(s,p.businessId).available < magnitude) throw Error('No hay suficiente capital disponible para retirar.');
    s.capitalMovements[p.id] = { id:p.id,businessId:p.businessId,amount,category:p.type==='withdraw'?'Retiro de capital':'Aporte de capital',date:p.date || today(),note:String(p.note||'').trim(),method:paymentMethod(p.method),createdAt:action.at };
  } else if (kind === 'EDIT_OPENING') {
    checkBusiness(p.businessId);
    const value = asMoney(p.amount);
    if (value + rows(s.capitalMovements).filter(c=>c.businessId===p.businessId).reduce((a,c)=>a+c.amount,0) < businessBalance(s,p.businessId).principalDue) throw Error('El capital nuevo no cubre los préstamos desembolsados.');
    const before = s.businesses[p.businessId].openingCapital;
    s.businesses[p.businessId].openingCapital = value;
    // Una corrección del capital inicial queda anotada en la bitácora.
    p.previousOpening = before;
  } else if (kind === 'CREATE_CLIENT') {
    checkBusiness(p.businessId);
    s.clients[p.id] = {id:p.id,businessId:p.businessId,name:required(p.name,'el nombre del cliente'),phone:String(p.phone||'').trim(),note:String(p.note||'').trim(),createdAt:action.at};
  } else if (kind === 'EDIT_CLIENT') {
    checkClient(p.id);
    Object.assign(s.clients[p.id],{name:required(p.name,'el nombre del cliente'),phone:String(p.phone||'').trim(),note:String(p.note||'').trim()});
  } else if (kind === 'CREATE_LOAN') {
    checkBusiness(p.businessId); checkClient(p.clientId);
    if (s.clients[p.clientId].businessId !== p.businessId) throw Error('El cliente pertenece a otro negocio.');
    const principal = asMoney(p.principal); if (!principal) throw Error('El monto debe ser mayor que cero.');
    const rateBps = Number(p.rateBps); if (!Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > 10000) throw Error('El interés debe estar entre 0 % y 100 %.');
    if (!validDate(p.startDate) || !validDate(p.firstDueDate) || p.firstDueDate < p.startDate) throw Error('Revisa las fechas del préstamo.');
    if (businessBalance(s,p.businessId).available < principal) throw Error('El capital disponible no alcanza para este préstamo.');
    const interestPlan = p.interestPlan === 'manual' ? 'manual' : 'automatic';
    const manualFirstInterest = p.manualFirstInterest == null || p.manualFirstInterest === '' ? 0 : asMoney(p.manualFirstInterest);
    const initialInterest = interestPlan==='manual' ? manualFirstInterest : Math.round(principal * rateBps / 10000);
    s.loans[p.id] = {id:p.id,businessId:p.businessId,clientId:p.clientId,principal,rateBps,startDate:p.startDate,firstDueDate:p.firstDueDate,nextInterestDate:addMonths(p.firstDueDate),mode:p.mode||'manual',interestPlan,disbursementMethod:paymentMethod(p.disbursementMethod),disbursementReference:String(p.disbursementReference||'').trim(),notes:String(p.notes||'').trim(),charges:{first:{id:'first',date:p.firstDueDate,amount:initialInterest,origin:interestPlan}},createdAt:action.at};
  } else if (kind === 'EDIT_LOAN') {
    const loan=s.loans[p.id]; if (!loan) throw Error('El préstamo no existe.');
    const rateBps=Number(p.rateBps); if (!Number.isSafeInteger(rateBps)||rateBps<0||rateBps>10000) throw Error('Interés fuera de rango.');
    loan.rateBps=rateBps;loan.mode=p.mode||'manual';loan.interestPlan=p.interestPlan==='manual'?'manual':'automatic';loan.notes=String(p.notes||'').trim();
    // Los intereses ya causados no cambian retroactivamente.
  } else if (kind === 'SET_PERIOD_INTEREST') {
    const loan=s.loans[p.loanId];
    if (!loan || loan.voidedAt) throw Error('Préstamo no disponible.');
    if (loan.businessId !== p.businessId) throw Error('Préstamo de otro negocio.');
    if (!validDate(p.periodDate) || p.periodDate < loan.firstDueDate) throw Error('Selecciona una fecha de vencimiento válida.');
    const amount = asMoney(p.amount);
    const reason = required(p.reason, 'el motivo del interés acordado');
    loan.charges ||= {};
    const existing = rows(loan.charges).find(c=>c.date===p.periodDate);
    const chargeId = existing?.id || `manual_${p.periodDate}`;
    loan.charges[chargeId] = {id:chargeId,date:p.periodDate,amount,origin:'manual',reason,changedAt:action.at,previous:existing?.amount ?? null};
    if (loanBalance(s,loan).interestDue < 0) throw Error('El interés acordado no puede ser menor que los intereses ya pagados.');
    if (loan.nextInterestDate === p.periodDate) loan.nextInterestDate = addMonths(p.periodDate);
  } else if (kind === 'CREATE_PAYMENT') {
    const loan=s.loans[p.loanId]; if (!loan || loan.voidedAt) throw Error('Préstamo no disponible.');
    if (loan.businessId!==p.businessId) throw Error('El préstamo pertenece a otro negocio.');
    const capital=asMoney(p.capital), interest=asMoney(p.interest);
    if (!(capital+interest)) throw Error('Registra un pago mayor a cero.');
    if (!validDate(p.date) || p.date < loan.startDate || p.date > today()) throw Error('La fecha del pago debe estar entre el desembolso y hoy.');
    const balance=loanBalance(s,loan);
    if (capital>balance.principalDue) throw Error(`El abono a capital supera lo pendiente: ${money(balance.principalDue)}.`);
    if (interest>balance.interestDue) throw Error(`El pago de intereses supera lo causado: ${money(balance.interestDue)}.`);
    s.payments[p.id] = {id:p.id,loanId:p.loanId,businessId:p.businessId,clientId:loan.clientId,capital,interest,date:p.date,method:paymentMethod(p.method),note:String(p.note||'').trim(),createdAt:action.at};
    if (loanBalance(s,loan).principalDue === 0) loan.nextInterestDate = null;
  } else if (kind === 'VOID_PAYMENT') {
    const payment=s.payments[p.id]; if (!payment || payment.voidedAt) throw Error('El pago no se puede anular.');
    payment.voidedAt=action.at; payment.voidReason=required(p.reason,'el motivo de anulación');
    const loan=s.loans[payment.loanId];
    if (!loan.nextInterestDate && loanBalance(s,loan).principalDue>0) loan.nextInterestDate=addMonths(rows(loan.charges).sort((a,b)=>b.date.localeCompare(a.date))[0]?.date || loan.firstDueDate);
    if (businessBalance(s,loan.businessId).available<0) throw Error('No puede anularse: ese capital ya se volvió a prestar.');
  } else if (kind === 'BILL_INTEREST') {
    applyDueInterest(s, p.date || today());
  } else if (kind === 'SETUP') {
    // Operación idempotente de inicialización (sin cambios monetarios).
  } else throw Error(`Operación desconocida: ${kind}`);
  s.revision=(s.revision||0)+1;
  s.audit[action.opId]={id:action.opId,kind,at:action.at,businessId:p.businessId||s.loans[p.loanId]?.businessId||s.loans[p.id]?.businessId||null,detail: kind==='EDIT_OPENING'?`Capital inicial: ${money(p.previousOpening)} → ${money(p.amount)}`:p.note||p.reason||'',entityId:p.id||p.loanId||null};
  return s;
}
export const monthOf = iso => String(iso||'').slice(0,7);
export const monthlySummary = (s, businessId, period) => {
  const paid=rows(s.payments).filter(p=>p.businessId===businessId&&!p.voidedAt&&monthOf(p.date)===period);
  const loans=rows(s.loans).filter(l=>l.businessId===businessId&&!l.voidedAt&&monthOf(l.startDate)===period);
  const capital=rows(s.capitalMovements).filter(c=>c.businessId===businessId&&monthOf(c.date)===period);
  const byMethod = {cash:{lent:0,received:0},nequi:{lent:0,received:0},transfer:{lent:0,received:0}};
  loans.forEach(l=>{byMethod[l.disbursementMethod||'cash'].lent += l.principal});
  paid.forEach(p=>{byMethod[p.method||'cash'].received += p.capital+p.interest});
  const capitalCollected=paid.reduce((a,p)=>a+p.capital,0);
  const interestCollected=paid.reduce((a,p)=>a+p.interest,0);
  const lent=loans.reduce((a,l)=>a+l.principal,0);
  const capitalInjected=capital.reduce((a,c)=>a+Math.max(0,c.amount),0);
  const capitalWithdrawn=capital.reduce((a,c)=>a+Math.max(0,-c.amount),0);
  return {
    capitalCollected,interestCollected,lent, count:paid.length,
    totalCollected:capitalCollected+interestCollected,
    capitalInjected,capitalWithdrawn,
    netCashFlow:capitalCollected+interestCollected+capitalInjected-lent-capitalWithdrawn,
    interestProfit:interestCollected, // ganancias brutas; sin gastos ni impuestos
    byMethod
  };
};
export function validateBackup(doc) {
  if (doc?.format !== 'PrestamoAppBackup' || doc?.data?.schema !== 1) throw Error('El archivo no es un respaldo válido de PrestamoApp.');
  for (const collection of ['businesses','clients','loans','payments','capitalMovements','audit']) if (!doc.data[collection] || typeof doc.data[collection]!=='object' || Array.isArray(doc.data[collection])) throw Error('El archivo de respaldo está incompleto.');
  return doc.data;
}
export function demoState() {
  let s=emptyState(); const at='2026-10-27T12:00:00.000Z', businessId='demo_business';
  const act=(kind,payload)=>{s=reduceState(s,{opId:id(),at,kind,payload})};
  act('CREATE_BUSINESS',{id:businessId,name:'Mi negocio de préstamos',color:'#155cfb',openingCapital:5500000});
  act('CREATE_CLIENT',{id:'demo_client',businessId,name:'Camila Torres',phone:'300 000 0000',note:'Cliente de demostración'});
  act('CREATE_LOAN',{id:'demo_loan',businessId,clientId:'demo_client',principal:1000000,rateBps:2000,startDate:'2026-10-10',firstDueDate:'2026-11-10',mode:'manual',notes:'Ejemplo'});
  return s;
}
