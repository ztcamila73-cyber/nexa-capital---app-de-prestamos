import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,reduceState,loanBalance,businessBalance,applyDueInterest,validateBackup} from '../src/domain.mjs';
let tick=0;
const act=(state,kind,payload)=>reduceState(state,{opId:`op_${++tick}`,at:'2026-10-27T12:00:00Z',kind,payload});
function setup(){
  let s=emptyState();
  s=act(s,'CREATE_BUSINESS',{id:'b1',name:'Principal',openingCapital:5000000});
  s=act(s,'CREATE_BUSINESS',{id:'b2',name:'Familiar',openingCapital:2000000});
  s=act(s,'CREATE_CLIENT',{id:'c1',name:'Camila',businessId:'b1'});
  s=act(s,'CREATE_LOAN',{id:'l1',businessId:'b1',clientId:'c1',principal:1000000,rateBps:2000,startDate:'2026-10-01',firstDueDate:'2026-11-01',mode:'manual'});
  return s;
}
test('Negocios separados y capital total disponible/activo',()=>{
 let s=setup();
 assert.deepEqual([businessBalance(s,'b1').capitalTotal,businessBalance(s,'b1').available,businessBalance(s,'b1').principalDue],[5000000,4000000,1000000]);
 s=act(s,'CAPITAL_MOVE',{id:'cap1',businessId:'b1',amount:500000,type:'deposit',date:'2026-10-27'});
 assert.deepEqual([businessBalance(s,'b1').capitalTotal,businessBalance(s,'b1').available],[5500000,4500000]);
 assert.equal(businessBalance(s,'b2').available,2000000);
});
test('Un mismo cliente puede tener dos préstamos independientes',()=>{
 let s=setup();
 s=act(s,'CREATE_LOAN',{id:'l2',businessId:'b1',clientId:'c1',principal:500000,rateBps:1000,startDate:'2026-10-20',firstDueDate:'2026-11-20'});
 assert.equal(loanBalance(s,s.loans.l1).principalDue,1000000);
 assert.equal(loanBalance(s,s.loans.l2).principalDue,500000);
 assert.equal(businessBalance(s,'b1').loanCount,2);
});
test('Pago mixto: el capital baja y el interés causado cambia por separado',()=>{
 let s=setup();
 s=act(s,'CREATE_PAYMENT',{id:'p1',loanId:'l1',businessId:'b1',capital:200000,interest:40000,date:'2026-10-27'});
 const bal=loanBalance(s,s.loans.l1);
 assert.deepEqual([bal.principalDue,bal.interestDue,bal.capitalPaid,bal.interestPaid],[800000,160000,200000,40000]);
 assert.equal(businessBalance(s,'b1').available,4200000);
 assert.equal(businessBalance(s,'b1').interestEarned,40000);
 // En el siguiente vencimiento se causa interés sobre el capital restante.
 s=applyDueInterest(s,'2026-12-01');
 assert.equal(loanBalance(s,s.loans.l1).interestDue,320000);
 assert.equal(s.loans.l1.nextInterestDate,'2027-01-01');
 s=applyDueInterest(s,'2026-12-01');
 assert.equal(loanBalance(s,s.loans.l1).interestDue,320000);
});
test('Abonos sin límite ni cuotas obligatorias',()=>{
 let s=setup();
 for(let k=0;k<9;k++)s=act(s,'CREATE_PAYMENT',{id:`part${k}`,loanId:'l1',businessId:'b1',capital:10000,interest:0,date:'2026-10-27'});
 assert.equal(loanBalance(s,s.loans.l1).capitalPaid,90000);
});
test('Anulación trazable y sin borrar registro del pago',()=>{
 let s=setup();s=act(s,'CREATE_PAYMENT',{id:'p1',loanId:'l1',businessId:'b1',capital:100000,interest:80000,date:'2026-10-25'});
 s=act(s,'VOID_PAYMENT',{id:'p1',reason:'Duplicado'});
 assert.equal(loanBalance(s,s.loans.l1).principalDue,1000000);
 assert.equal(loanBalance(s,s.loans.l1).interestDue,200000);
 assert.ok(s.payments.p1.voidedAt);assert.equal(s.payments.p1.voidReason,'Duplicado');
});
test('No permite prestar, retirar ni pagar por encima del saldo',()=>{
 let s=setup();
 assert.throws(()=>act(s,'CREATE_LOAN',{id:'bad',businessId:'b1',clientId:'c1',principal:5000000,rateBps:2000,startDate:'2026-10-01',firstDueDate:'2026-11-01'}),/disponible/);
 assert.throws(()=>act(s,'CAPITAL_MOVE',{id:'bad',businessId:'b1',amount:4800000,type:'withdraw'}),/disponible/);
 assert.throws(()=>act(s,'CREATE_PAYMENT',{id:'bad',loanId:'l1',businessId:'b1',capital:2000000,interest:0,date:'2026-10-25'}),/supera/);
 assert.throws(()=>act(s,'CREATE_PAYMENT',{id:'bad',loanId:'l1',businessId:'b1',capital:0,interest:250000,date:'2026-10-25'}),/supera/);
});
test('Operación duplicada tras reintento de red no cambia el saldo',()=>{
 let s=setup(); const op={kind:'CAPITAL_MOVE',payload:{id:'one',businessId:'b1',amount:500000,type:'deposit'},opId:'duplicate',at:'2026-10-27T01:00:00Z'};
 s=reduceState(s,op);s=reduceState(s,op);
 assert.equal(businessBalance(s,'b1').capitalTotal,5500000);
});
test('Corrección del capital inicial deja evidencia de valor anterior y posterior',()=>{
 let s=setup();s=act(s,'EDIT_OPENING',{businessId:'b1',amount:5500000});
 assert.equal(businessBalance(s,'b1').capitalTotal,5500000);
 assert.ok(Object.values(s.audit).some(a=>a.kind==='EDIT_OPENING'&&a.detail.includes('5.000.000')));
});
test('Respaldo JSON verificable',()=>{
 const data=setup();assert.equal(validateBackup({format:'PrestamoAppBackup',data}),data);
 assert.throws(()=>validateBackup({data:{}}),/no es un respaldo válido/);
});

test('Medio de desembolso y pagos registrados por canal sin perder cliente ni préstamo',()=>{
 let s=setup();
 s=act(s,'CREATE_LOAN',{id:'nequi_loan',businessId:'b1',clientId:'c1',principal:300000,rateBps:1000,startDate:'2026-10-20',firstDueDate:'2026-11-20',disbursementMethod:'nequi',disbursementReference:'Referencia de ejemplo'});
 s=act(s,'CREATE_PAYMENT',{id:'nequi_pay',loanId:'nequi_loan',businessId:'b1',capital:100000,interest:10000,method:'transfer',date:'2026-10-27'});
 assert.equal(s.loans.nequi_loan.disbursementMethod,'nequi');
 assert.equal(s.payments.nequi_pay.method,'transfer');
 assert.equal(loanBalance(s,s.loans.nequi_loan).principalDue,200000);
});
test('Interés manual: monto del primer período y siguientes definidos con motivo',()=>{
 let s=setup();
 s=act(s,'CREATE_LOAN',{id:'manual2',businessId:'b1',clientId:'c1',principal:500000,rateBps:2000,startDate:'2026-10-20',firstDueDate:'2026-11-20',interestPlan:'manual',manualFirstInterest:45000,mode:'manual'});
 assert.equal(loanBalance(s,s.loans.manual2).interestDue,45000);
 s=act(s,'CREATE_PAYMENT',{id:'manualpay',loanId:'manual2',businessId:'b1',capital:100000,interest:20000,date:'2026-10-27'});
 assert.equal(loanBalance(s,s.loans.manual2).principalDue,400000);
 s=applyDueInterest(s,'2027-02-01');
 assert.equal(loanBalance(s,s.loans.manual2).interestDue,25000,'no debe acumular intereses automáticos en modo manual');
 s=act(s,'SET_PERIOD_INTEREST',{loanId:'manual2',businessId:'b1',periodDate:'2026-12-20',amount:18000,reason:'Pacto específico de diciembre'});
 assert.equal(loanBalance(s,s.loans.manual2).interestDue,43000);
 assert.equal(s.loans.manual2.charges['manual_2026-12-20'].origin,'manual');
});
test('No se puede reducir interés manual por debajo del ya pagado',()=>{
 let s=setup();
 s=act(s,'CREATE_PAYMENT',{id:'pmanual',loanId:'l1',businessId:'b1',capital:0,interest:100000,date:'2026-10-27'});
 assert.throws(()=>act(s,'SET_PERIOD_INTEREST',{loanId:'l1',businessId:'b1',periodDate:'2026-11-01',amount:50000,reason:'Acuerdo'}),/pagados/);
});
test('Interés manual en un período futuro evita doble causación automática',()=>{
 let s=setup();
 s=act(s,'SET_PERIOD_INTEREST',{loanId:'l1',businessId:'b1',periodDate:'2026-12-01',amount:50000,reason:'Pacto para el período 2'});
 s=applyDueInterest(s,'2026-12-01');
 assert.equal(loanBalance(s,s.loans.l1).interestCharged,250000);
});
test('Informes separados: dinero prestado, capital recogido, interés recibido y efectivo por método',async()=>{
 const {monthlySummary}=await import('../src/domain.mjs');
 let s=setup();
 s=act(s,'CREATE_PAYMENT',{id:'f1',loanId:'l1',businessId:'b1',capital:90000,interest:40000,date:'2026-10-27',method:'nequi'});
 s=act(s,'CAPITAL_MOVE',{id:'i1',businessId:'b1',amount:500000,type:'deposit',method:'transfer',date:'2026-10-27'});
 const m=monthlySummary(s,'b1','2026-10');
 assert.equal(m.lent,1000000);
 assert.equal(m.capitalCollected,90000);
 assert.equal(m.interestCollected,40000);
 assert.equal(m.capitalInjected,500000);
 assert.equal(m.netCashFlow,-370000);
 assert.deepEqual(m.byMethod.nequi,{lent:0,received:130000});
});
test('Métodos de pago desconocidos no se guardan',()=>{
 const s=setup();
 assert.throws(()=>act(s,'CREATE_PAYMENT',{id:'bad_method',loanId:'l1',businessId:'b1',capital:10000,interest:0,method:'efectivo_inventado',date:'2026-10-27'}),/Selecciona/);
});
