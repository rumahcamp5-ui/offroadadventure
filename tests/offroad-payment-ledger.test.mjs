import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const backend=readFileSync(new URL('../offroad-admin/Code.gs',import.meta.url),'utf8');
const payments=readFileSync(new URL('../offroad-admin/OffroadPaymentsV7.gs',import.meta.url),'utf8');
const STAGING_ID='1jTrkBvM4V2mHIA4KeLyixGcJgV4ASxjy6jJgyFku8Po';
const STAGING_TITLE='[STAGING] OFFROAD V7 ADMIN TEST - DATA SIMULASI';
const MARK='STAGING OFFROAD V7 • DATA SIMULASI • JANGAN GUNAKAN UNTUK BOOKING ASLI';
const baseHeader=['No','Timestamp','Nama Pemesan','No WhatsApp Pemesan','Tanggal Offroad','Hari',
 'Jumlah Unit','Pilih Paket ','Catatan (optional)','Lunas/DP','Sisa Pelunasan','Jumlah Uang',
 'ID Booking','Status Sync Keuangan','Status Perjalanan','Tanggal Selesai','Pembayaran Diverifikasi',
 'Status Persetujuan Booking','Waktu Keputusan Booking','Admin Keputusan Booking','Alasan Reject Booking',
 'Jumlah Transfer Terverifikasi','Waktu Transfer Terverifikasi'];
const ledgerHeaders=['ID Booking','ID Pembayaran','Jenis Pembayaran','Jumlah Terverifikasi',
 'Waktu Transfer','Hash Referensi Bank','Diverifikasi Oleh','Waktu Pencatatan','Status Ledger','Sumber'];
const now=Math.floor(Date.now()/1000),bankAt=now-600;
function fixture({actor='owner@offroad.test',choice='DP = 350.000',first=350000,
  outstanding=350000,status='ACC',bankAmount=first,bankTime=bankAt,ledgerHeadersOverride=null}={}){
 const bookingRows=Array.from({length:5},()=>Array(23).fill(''));
 bookingRows[0][0]=MARK;bookingRows[4]=baseHeader;
 const row=[1,new Date(now*1000),'SIMULASI','',new Date('2026-11-11T05:00:00Z'),'Rabu',
  1,'Kalong Express','DUMMY',choice,outstanding,first,'STAGING-BOOK-000001',
  'STAGING_ONLY','','','',status,new Date(now*1000),'owner@offroad.test','',
  bankAmount,new Date(bankTime*1000)];
 bookingRows.push(row);
 const ledger=[ledgerHeadersOverride||ledgerHeaders];
 const writes=[],props=new Map([
  ['OFFROAD_ADMIN_V7_MODE','staging'],
  ['OFFROAD_ADMIN_V7_SPREADSHEET_ID',STAGING_ID],
  ['OFFROAD_ADMIN_V7_OWNER_EMAILS','owner@offroad.test'],
  ['OFFROAD_ADMIN_V7_VIEWER_EMAILS','viewer@offroad.test']
 ]);
 function sheet(rows,tab){
  return {
   getLastRow:()=>rows.length,
   getRange:(i,j,height=1,width=1)=>({
    getDisplayValues:()=>rows.slice(i-1,i-1+height).map(r=>r.slice(j-1,j-1+width).map(v=>v==null?'':String(v))),
    getValues:()=>rows.slice(i-1,i-1+height).map(r=>r.slice(j-1,j-1+width)),
    setValues:()=>{throw Error('No booking/finance writes expected')}
   }),
   appendRow:v=>{
    assert.equal(tab,'ledger','Only ledger append authorized');
    ledger.push(v);writes.push({tab,row:v});
   }
  };
 }
 const book=sheet(bookingRows,'booking'),led=sheet(ledger,'ledger');
 const workbook={
  getName:()=>STAGING_TITLE,
  getSheetByName:name=>{
   if(name==='Formulir Offroad')return book;
   if(name==='OFFROAD V7 PAYMENT LEDGER')return led;
   return null;
  }
 };
 const ctx=vm.createContext({
  Date,JSON,String,Number,Math,Array,Object,Error,isFinite,RegExp,
  SpreadsheetApp:{openById:id=>{assert.equal(id,STAGING_ID);return workbook;}},
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key)||null})},
  Session:{getActiveUser:()=>({getEmail:()=>actor})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf-8'},
   computeDigest:(_,v)=>[...createHash('sha256').update(v).digest()],
   formatDate:(date,tz,format)=>{assert.equal(tz,'Asia/Jakarta');return date.toISOString().slice(0,10);}
  },
  HtmlService:{}
 });
 vm.runInContext(backend+'\n'+payments,ctx);
 function payload(stage='PERTAMA',amt=first,at=bankAt,reference='bank-credit-staging-000001'){
  let booking=ctx.offroadAdminV7ListApprovals().rows[0];
  return {
   row:6,bookingId:booking.bookingId,expectedVersion:booking.version,
   stage,verifiedAmount:amt,verifiedAt:at,bankReference:reference,
   confirmedIdentity:true,confirmedBankCredit:true,confirmedNoRefund:true
  };
 }
 return {ctx,ledger,bookingRows,row,writes,props,payload};
}
test('DP first and later settlement are separate immutable, dated Offroad-only bank-credit rows',()=>{
 const s=fixture(),first=s.payload();
 const a=s.ctx.offroadAdminV7RecordVerifiedPayment(first);
 assert.equal(a.ok,true);assert.equal(a.kind,'DP');assert.equal(a.pointsIssued,false);
 assert.equal(a.financeChanged,false);assert.equal(a.duplicate,false);
 assert.equal(s.ledger.length,2);
 const summary=s.ctx.offroadAdminV7PaymentSummary(6,first.bookingId);
 assert.equal(summary.payment.paidVerified,350000);
 assert.equal(summary.payment.outstandingVerified,350000);
 assert.equal(summary.payment.fullyPaid,false);
 const later=s.payload('PELUNASAN',350000,bankAt+300,'bank-credit-staging-000002');
 const b=s.ctx.offroadAdminV7RecordVerifiedPayment(later);
 assert.equal(b.kind,'PELUNASAN');assert.equal(b.ok,true);
 assert.equal(s.ledger.length,3);
 assert.equal(s.ctx.offroadAdminV7PaymentSummary(6,first.bookingId).payment.fullyPaid,true);
 assert.equal(s.ctx.offroadAdminV7PaymentSummary(6,first.bookingId).payment.outstandingVerified,0);
 assert.notEqual(s.ledger[1][1],s.ledger[2][1]);
 assert.notEqual(s.ledger[1][5],s.ledger[2][5]);
 assert.equal(s.ledger[1][3],350000);assert.equal(s.ledger[2][3],350000);
 assert.ok(s.ledger[1][4] instanceof Date);assert.ok(s.ledger[2][4] instanceof Date);
 assert.equal(s.writes.length,2);
 assert.equal(s.ledger[2][8],'VERIFIED_STAGING');
 for(let i=0;i<23;i++)assert.equal(s.row[i],s.bookingRows[5][i]);
 assert.doesNotMatch(JSON.stringify(s.ledger),/0899|rekening|Guest A|bank-credit-staging-000001/);
});
test('replayed same bank evidence is duplicate but edited/colliding payment cannot double count',()=>{
 const s=fixture(),first=s.payload();
 s.ctx.offroadAdminV7RecordVerifiedPayment(first);
 const retry=s.ctx.offroadAdminV7RecordVerifiedPayment(first);
 assert.equal(retry.duplicate,true);assert.equal(s.ledger.length,2);
 assert.throws(()=>s.ctx.offroadAdminV7RecordVerifiedPayment({...first,bankReference:'different-bank-proof-00009'}),/sudah tercatat/);
 assert.throws(()=>s.ctx.offroadAdminV7RecordVerifiedPayment(
  s.payload('PELUNASAN',350000,bankAt+100,'bank-credit-staging-000001')),/sudah digunakan/);
 s.ctx.offroadAdminV7RecordVerifiedPayment(s.payload('PELUNASAN',350000,bankAt+100,'bank-credit-staging-000002'));
 assert.throws(()=>s.ctx.offroadAdminV7RecordVerifiedPayment(s.payload('PELUNASAN',350000,bankAt+120,'bank-credit-staging-000003')),/sudah tercatat/);
 assert.equal(s.writes.length,2);
});
test('unapproved, rejected or cancelled booking and unverified bank credit never write ledger',()=>{
 for(const approval of ['', 'REJECT']){
  const s=fixture({status:approval});
  assert.throws(()=>s.ctx.offroadAdminV7RecordVerifiedPayment(s.payload()),/belum ACC/);
  assert.equal(s.writes.length,0);
 }
 const viewer=fixture({actor:'viewer@offroad.test'});
 assert.throws(()=>viewer.ctx.offroadAdminV7RecordVerifiedPayment(viewer.payload()),/Hanya Owner/);
 assert.equal(viewer.writes.length,0);
 const cancelled=fixture();cancelled.row[14]='CANCELLED';
 assert.throws(()=>cancelled.ctx.offroadAdminV7RecordVerifiedPayment(cancelled.payload()),/dibatalkan/);
 assert.equal(cancelled.writes.length,0);
 const unsafe=fixture();unsafe.props.set('OFFROAD_ADMIN_V7_MODE','production');
 assert.throws(()=>unsafe.ctx.offroadAdminV7RecordVerifiedPayment(unsafe.payload()),/mode staging/);
 assert.equal(unsafe.writes.length,0);
});
test('second transfer requires actual first DP, exact remaining, different reference and later bank date',()=>{
 const before=fixture();
 assert.throws(()=>before.ctx.offroadAdminV7RecordVerifiedPayment(before.payload('PELUNASAN',350000,bankAt+100,'bank-credit-staging-000002')),/pembayaran pertama/);
 assert.equal(before.writes.length,0);
 const s=fixture();s.ctx.offroadAdminV7RecordVerifiedPayment(s.payload());
 for(const [patch,pattern] of [
  [{verifiedAmount:349999},/tidak cocok/],
  [{verifiedAt:bankAt-1},/tidak cocok/],
  [{confirmedNoRefund:false},/belum lengkap/],
  [{confirmedBankCredit:false},/belum lengkap/]
 ]){
  assert.throws(()=>s.ctx.offroadAdminV7RecordVerifiedPayment({
   ...s.payload('PELUNASAN',350000,bankAt+100,'bank-credit-staging-000002'),
   ...patch
  }),pattern);
 }
 assert.equal(s.writes.length,1);
});
test('LUNAS booking records one full payment and rejects a fake DP settlement',()=>{
 const s=fixture({choice:'LUNAS',first:700000,outstanding:0});
 s.ctx.offroadAdminV7RecordVerifiedPayment(s.payload('PERTAMA',700000));
 assert.equal(s.ledger[1][2],'LUNAS');
 assert.equal(s.ctx.offroadAdminV7PaymentSummary(6,'STAGING-BOOK-000001').payment.fullyPaid,true);
 assert.throws(()=>s.ctx.offroadAdminV7RecordVerifiedPayment(
  s.payload('PELUNASAN',1,bankAt+200,'bank-credit-staging-000002')),/Pelunasan DP/);
 assert.equal(s.writes.length,1);
});
test('invalid staging ledger schema, stale booking and forbidden finance/network integration fail closed',()=>{
 const wrong=fixture({ledgerHeadersOverride:['WRONG',...ledgerHeaders.slice(1)]});
 assert.throws(()=>wrong.ctx.offroadAdminV7RecordVerifiedPayment(wrong.payload()),/Header ledger/);
 assert.equal(wrong.writes.length,0);
 const stale=fixture();let p=stale.payload();stale.row[11]=600000;
 assert.throws(()=>stale.ctx.offroadAdminV7RecordVerifiedPayment(p),/Booking berubah/);
 assert.equal(stale.writes.length,0);
 assert.doesNotMatch(payments,/(?:getSheetByName\(['\"]Data Keuangan Offroad['\"]\)|UrlFetchApp\.fetch\(|function doPost\(|function onEdit\(|\.setValues\()/);
 assert.match(payments,/OFFROAD_V7_LEDGER_TAB/);
 assert.match(payments,/offroadAdminV7PaymentLedger_\(actor\)/);
});
