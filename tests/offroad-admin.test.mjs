import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const script=readFileSync(new URL('../offroad-admin/Code.gs',import.meta.url),'utf8');
const view=readFileSync(new URL('../offroad-admin/OffroadAdminV7.html',import.meta.url),'utf8');
const SPREADSHEET_ID='1jTrkBvM4V2mHIA4KeLyixGcJgV4ASxjy6jJgyFku8Po';
const STAGING_TITLE='[STAGING] OFFROAD V7 ADMIN TEST - DATA SIMULASI';
const STAGING_MARKER='STAGING OFFROAD V7 • DATA SIMULASI • JANGAN GUNAKAN UNTUK BOOKING ASLI';
const HEADERS=['No','Timestamp','Nama Pemesan','No WhatsApp Pemesan','Tanggal Offroad','Hari',
 'Jumlah Unit','Pilih Paket ','Catatan (optional)','Lunas/DP','Sisa Pelunasan','Jumlah Uang',
 'ID Booking','Status Sync Keuangan','Status Perjalanan','Tanggal Selesai','Pembayaran Diverifikasi',
 'Status Persetujuan Booking','Waktu Keputusan Booking','Admin Keputusan Booking','Alasan Reject Booking',
 'Jumlah Transfer Terverifikasi','Waktu Transfer Terverifikasi'];

function setup({email='owner@offroad.test',payment='LUNAS',balance=0,paid=1250000,status='',auditExists=false,bookingApproval='ACC'}={}){
 const headers=HEADERS.slice();
 const row=[1,new Date('2026-11-10T08:00:00Z'),'Guest A','0899-PRIVATE',
   new Date('2026-11-11T07:00:00Z'),'Rabu',2,'Sianok Classic + Kalong Express',
   'private notes',payment,balance,paid,'OFFROAD-BOOKING-20261111-001',
   'SYNCED',status,'','',bookingApproval,'','','','',''];
 const cells=[...Array.from({length:5},()=>Array(23).fill('')),row];
 cells[0][0]=STAGING_MARKER;
 cells[4]=headers;
 const writes=[],auditRows=[],props=new Map([
  ['OFFROAD_ADMIN_V7_SPREADSHEET_ID',SPREADSHEET_ID],
  ['OFFROAD_ADMIN_V7_MODE','staging'],
  ['OFFROAD_ADMIN_V7_OWNER_EMAILS','owner@offroad.test'],
  ['OFFROAD_ADMIN_V7_VIEWER_EMAILS','viewer@offroad.test']
 ]);
 let lockReleased=0,inserted=0;
 const booked={
  getLastRow:()=>cells.length,
  getRange:(start,col,numRows=1,numCols=1)=>({
    getValues:()=>cells.slice(start-1,start-1+numRows).map(row=>row.slice(col-1,col-1+numCols)),
    getDisplayValues:()=>cells.slice(start-1,start-1+numRows).map(row=>row.slice(col-1,col-1+numCols).map(v=>String(v||''))),
    setValues:values=>{
      writes.push({tab:'booking',start,col,numRows,numCols,values});
      assert.equal(values.length,numRows);
      for(let i=0;i<numRows;i++)for(let j=0;j<numCols;j++)cells[start-1+i][col-1+j]=values[i][j];
    }
  })
 };
 const audit={appendRow:entry=>{auditRows.push(entry);writes.push({tab:'audit',entry});}};
 const workbook={
  getName:()=>STAGING_TITLE,
  getSheetByName:name=>name==='Formulir Offroad'?booked:name==='OFFROAD V7 AUDIT'&&(inserted||auditExists)?audit:null,
  insertSheet:name=>{assert.equal(name,'OFFROAD V7 AUDIT');inserted++;return audit;}
 };
 const ctx=vm.createContext({
  Date,JSON,String,Number,Array,Object,Math,isFinite,Error,RegExp,
  Session:{getActiveUser:()=>({getEmail:()=>email})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null})},
  SpreadsheetApp:{openById:id=>{assert.equal(id,SPREADSHEET_ID);return workbook;}},
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf-8'},
    formatDate:(date,zone,format)=>{assert.equal(zone,'Asia/Jakarta');assert.equal(format,'yyyy-MM-dd');return date.toISOString().slice(0,10);},
    computeDigest:(algo,value)=>[...createHash('sha256').update(value).digest()]},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>lockReleased++})},
  HtmlService:{
    createHtmlOutputFromFile:name=>({value:name,setTitle(x){this.title=x;return this;}}),
    createHtmlOutput:value=>({value,setTitle(x){this.title=x;return this;}})
  }
 });
 vm.runInContext(script,ctx);
 return {ctx,row,cells,headers,writes,auditRows,props,inserted:()=>inserted,lockReleased:()=>lockReleased};
}
function request(s,patch={}){
 const result=s.ctx.offroadAdminV7ListBookings();
 const b=result.rows[0];
 return {row:b.row,bookingId:b.bookingId,expectedVersion:b.version,
   action:'SELESAI',completedAt:Math.floor(Date.now()/1000)-600,
   evidenceReference:'mutasi-bank-offroad-20261111',confirmedIdentity:true,
   confirmedTrip:true,confirmedPayment:true,...patch};
}
test('staging admin never opens or writes a production spreadsheet by mistaken configuration',()=>{
 const wrongMode=setup();wrongMode.props.set('OFFROAD_ADMIN_V7_MODE','production');
 assert.throws(()=>wrongMode.ctx.offroadAdminV7ListBookings(),/hanya diizinkan untuk mode staging/);
 assert.equal(wrongMode.writes.length,0);
 const wrongId=setup();wrongId.props.set('OFFROAD_ADMIN_V7_SPREADSHEET_ID','PRODUCTION_'+'X'.repeat(32));
 assert.throws(()=>wrongId.ctx.offroadAdminV7Verify(request(wrongId)),/bukan Sheet staging/);
 assert.equal(wrongId.writes.length,0);
 const wrongWatermark=setup();wrongWatermark.cells[0][0]='LIVE OFFROAD DATA';
 assert.throws(()=>wrongWatermark.ctx.offroadAdminV7ListBookings(),/Penanda data simulasi/);
 assert.equal(wrongWatermark.writes.length,0);
 assert.match(script,/OFFROAD_V7_STAGING_SPREADSHEET_ID/);
 assert.doesNotMatch(script,/OFFROAD_ADMIN_V7_MODE'\)\s*===\s*'production'/);
});

test('staging manifest and preflight are read-only, minimal and bound to Offroad dummy data',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../offroad-admin/appsscript.json',import.meta.url),'utf8'));
  assert.equal(manifest.runtimeVersion,'V8');
  assert.equal(manifest.timeZone,'Asia/Jakarta');
  assert.deepEqual(manifest.oauthScopes,[
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/userinfo.email'
  ]);
  assert.equal(Object.hasOwn(manifest,'webapp'),false,'No permissive web-app settings may be baked into manifest');
  const s=setup();
  const result=s.ctx.offroadAdminV7Preflight();
  assert.equal(result.ready,true);
  assert.equal(result.environment,'STAGING ONLY');
  assert.equal(result.business,'offroad');
  assert.equal(result.accessRole,'owner');
  assert.equal(result.recordsAvailable,1);
  assert.equal(result.pointsIssued,false);
  assert.equal(result.financeChanged,false);
  assert.equal(s.writes.length,0);
  assert.doesNotMatch(JSON.stringify(result),/0899-PRIVATE|Guest A|1250000|mutasi-bank|OFFROAD_ADMIN_V7_SPREADSHEET_ID/);
  const outsider=setup({email:'outsider@invalid.example'});
  assert.throws(()=>outsider.ctx.offroadAdminV7Preflight(),/tidak mendapat izin/);
  const unsafe=setup();unsafe.props.set('OFFROAD_ADMIN_V7_MODE','production');
  assert.throws(()=>unsafe.ctx.offroadAdminV7Preflight(),/hanya diizinkan untuk mode staging/);
  assert.equal(unsafe.writes.length,0);
});

test('Offroad admin Google identity allowlist is mandatory and never trusts client role',()=>{
 for(const email of ['', 'stranger@offroad.test']){
  const s=setup({email});
  assert.throws(()=>s.ctx.offroadAdminV7ListBookings(),/tidak tersedia|tidak mendapat izin/);
  assert.throws(()=>s.ctx.offroadAdminV7Verify({}),/tidak tersedia|tidak mendapat izin/);
  assert.equal(s.writes.length,0);
  const html=s.ctx.doGet();
  assert.match(html.value,/Akses ditolak/);
 }
 const viewer=setup({email:'viewer@offroad.test'});
 assert.equal(viewer.ctx.offroadAdminV7ListBookings().role,'viewer');
 assert.throws(()=>viewer.ctx.offroadAdminV7Verify(request(viewer)),/Hanya Owner/);
 assert.equal(viewer.writes.length,0);
 const owner=setup();
 assert.equal(owner.ctx.offroadAdminV7ListBookings().role,'owner');
 assert.equal(owner.ctx.doGet().value,'OffroadAdminV7');
 owner.props.delete('OFFROAD_ADMIN_V7_SPREADSHEET_ID');
 assert.throws(()=>owner.ctx.offroadAdminV7ListBookings(),/bukan Sheet staging Offroad/);
});

test('Owner-only verification changes only O:Q in Offroad Sheet and writes separate audit, never moves money',()=>{
 const s=setup({payment:'CUSTOM',balance:0,paid:1250000});
 const initial=s.row.slice();
 const result=s.ctx.offroadAdminV7Verify(request(s));
 assert.equal(result.ok,true);assert.equal(result.pointsIssued,false);
 assert.equal(result.needsMembershipDispatch,true);
 assert.equal(s.row[14],'SELESAI');assert.ok(s.row[15] instanceof Date);assert.ok(s.row[16] instanceof Date);
 for(let i=0;i<14;i++)assert.deepEqual(s.row[i],initial[i],'Original A:N column '+i+' untouched');
 const booked=s.writes.filter(w=>w.tab==='booking');
 assert.equal(booked.length,1);assert.equal(booked[0].start,6);assert.equal(booked[0].col,15);
 assert.equal(booked[0].numCols,3);assert.equal(booked[0].numRows,1);
 assert.equal(s.inserted(),1);
 assert.equal(s.auditRows.length,3); // header, request, committed
 assert.equal(s.lockReleased(),1);
 assert.doesNotMatch(JSON.stringify(s.auditRows),/1250000|0899-PRIVATE|private notes|mutasi-bank-offroad-20261111/);
 assert.throws(()=>s.ctx.offroadAdminV7Verify(request(s)),/sudah diverifikasi/);
 assert.equal(s.writes.filter(w=>w.tab==='booking').length,1);
});

test('DP, unpaid, bad proof, stale version and mismatched booking cannot be approved',()=>{
 for(const change of [
  {payment:'DP'},
  {payment:'CUSTOM',balance:50000},
  {payment:'LUNAS',paid:0}
 ]){
  const s=setup(change);
  assert.throws(()=>s.ctx.offroadAdminV7Verify(request(s)),/Pembayaran harus lunas/);
  assert.equal(s.writes.length,0);
 }
 const s=setup(),r=request(s);
 assert.throws(()=>s.ctx.offroadAdminV7Verify({...r,evidenceReference:'short'}),/Referensi bukti/);
 assert.throws(()=>s.ctx.offroadAdminV7Verify({...r,confirmedTrip:false}),/harus diperiksa/);
 assert.throws(()=>s.ctx.offroadAdminV7Verify({...r,completedAt:Math.floor(Date.now()/1000)+5000}),/Waktu perjalanan/);
 assert.throws(()=>s.ctx.offroadAdminV7Verify({...r,completedAt:Math.floor(new Date('2026-11-10T05:00:00Z').getTime()/1000)}),/sebelum tanggal Offroad/);
 assert.throws(()=>s.ctx.offroadAdminV7Verify({...r,bookingId:'OFFROAD-OTHER'}),/telah berubah/);
 s.row[11]=1000000;
 assert.throws(()=>s.ctx.offroadAdminV7Verify(r),/telah berubah/);
 assert.equal(s.writes.length,0);
});
test('explicit cancellation is logged without touching a payment, issuing points, or changing other booking columns',()=>{
 const s=setup({payment:'DP',balance:50000,paid:100000});
 const before=s.row.slice();
 const cancelled=s.ctx.offroadAdminV7Verify(request(s,{action:'CANCELLED',completedAt:null}));
 assert.equal(cancelled.tripStatus,'CANCELLED');
 assert.equal(cancelled.pointsIssued,false);
 for(let i=0;i<14;i++)assert.deepEqual(s.row[i],before[i]);
 assert.equal(s.row[14],'CANCELLED');assert.equal(s.row[15],'');assert.equal(s.row[16],'');
 assert.throws(()=>s.ctx.offroadAdminV7Verify(request(s,{action:'CANCELLED'})),/sudah dicatat/);
 assert.throws(()=>s.ctx.offroadAdminV7Verify(request(s,{action:'SELESAI'})),/dibatalkan/);
 assert.equal(s.writes.filter(x=>x.tab==='booking').length,1);
});

test('dashboard renders server-owned Offroad records without third-party backend or unsafe dynamic HTML',()=>{
 assert.match(view,/OFFROAD OPERATIONS/);
 assert.match(view,/google\.script\.run/);
 assert.match(view,/offroadAdminV7ListBookings\(\)/);
 assert.match(view,/offroadAdminV7Verify\(/);
 assert.match(view,/document\.createElement/);
 assert.match(view,/textContent/);
 assert.doesNotMatch(view,/innerHTML|localStorage|sessionStorage|script\.google\.com\/macros|rumahcamp-admin\.workers\.dev/);
 assert.doesNotMatch(script,/UrlFetchApp|OFFROAD_SYNC_V7|v7_offroad_point_awards|pointsIssued:true/);
 assert.match(script,/getRange\(input\.row,15,1,3\)\.setValues/);
 assert.match(script,/Session\.getActiveUser\(\)\.getEmail\(\)/);
 assert.match(script,/OFFROAD_ADMIN_V7_OWNER_EMAILS/);
});

test('pending DP can be ACC only after confirmed matching bank transfer, writing R:W and audit only',()=>{
 const s=setup({bookingApproval:'',payment:'DP',paid:300000,balance:500000});
 const pending=s.ctx.offroadAdminV7ListApprovals();
 assert.equal(pending.rows.length,1);
 assert.equal(pending.rows[0].approval,'MENUNGGU VERIFIKASI');
 const item=pending.rows[0],original=s.row.slice();
 const payload={action:'ACC',row:6,bookingId:item.bookingId,expectedVersion:item.version,
   evidenceReference:'bank-staging-mutasi-11nov2026',confirmedIdentity:true,
   confirmedBankReview:true,bankCreditConfirmed:true,
   verifiedAmount:300000,verifiedAt:Math.floor(Date.now()/1000)-300};
 const outcome=s.ctx.offroadAdminV7ReviewBooking(payload);
 assert.equal(outcome.bookingStatus,'ACC');
 assert.equal(outcome.financeChanged,false);assert.equal(outcome.pointsIssued,false);
 for(let i=0;i<17;i++)assert.deepEqual(s.row[i],original[i],'A:Q must stay intact, cell '+i);
 assert.equal(s.row[17],'ACC');assert.equal(s.row[19],'owner@offroad.test');assert.equal(s.row[20],'');assert.equal(s.row[21],300000);
 assert.ok(s.row[18] instanceof Date);assert.ok(s.row[22] instanceof Date);
 const change=s.writes.filter(w=>w.tab==='booking');
 assert.equal(change.length,1);assert.equal(change[0].col,18);assert.equal(change[0].numCols,6);
 assert.equal(s.auditRows.length,3);
 assert.doesNotMatch(JSON.stringify(s.auditRows),/bank-staging-mutasi-11nov2026|300000|0899-PRIVATE|Guest A/);
 assert.throws(()=>s.ctx.offroadAdminV7ReviewBooking(payload),/berubah|sudah diputuskan/);
});
test('reject booking without verified transfer records reason, never refunds or writes finance',()=>{
 const s=setup({bookingApproval:'',payment:'LUNAS',paid:950000,balance:0});
 const original=s.row.slice(),item=s.ctx.offroadAdminV7ListApprovals().rows[0];
 const res=s.ctx.offroadAdminV7ReviewBooking({row:6,bookingId:item.bookingId,
  expectedVersion:item.version,action:'REJECT',
  evidenceReference:'no-credit-found-staging-11nov',
  reason:'Transfer tidak ditemukan di rekening Offroad.',
  confirmedIdentity:true,confirmedBankReview:true,
  bankCreditConfirmed:false,verifiedAmount:0});
 assert.equal(res.bookingStatus,'REJECT');assert.equal(res.financeChanged,false);
 for(let i=0;i<17;i++)assert.deepEqual(s.row[i],original[i]);
 assert.equal(s.row[17],'REJECT');assert.match(s.row[20],/tidak ditemukan/);
 assert.equal(s.row[21],'');assert.equal(s.row[22],'');
 assert.equal(s.writes.filter(w=>w.tab==='booking').length,1);
});
test('ACC blocked for unconfirmed/incorrect bank credit, stale row, and unauthorized viewer',()=>{
 const s=setup({bookingApproval:'',payment:'LUNAS',paid:700000,balance:0});
 const item=s.ctx.offroadAdminV7ListApprovals().rows[0];
 const base={row:6,bookingId:item.bookingId,expectedVersion:item.version,
  action:'ACC',evidenceReference:'verified-mutation-staging-2026',
  confirmedIdentity:true,confirmedBankReview:true,bankCreditConfirmed:true,
  verifiedAmount:700000,verifiedAt:Math.floor(Date.now()/1000)-400};
 assert.throws(()=>s.ctx.offroadAdminV7ReviewBooking({...base,bankCreditConfirmed:false}),/tanpa bukti/);
 assert.throws(()=>s.ctx.offroadAdminV7ReviewBooking({...base,verifiedAmount:650000}),/tidak cocok/);
 assert.throws(()=>s.ctx.offroadAdminV7ReviewBooking({...base,confirmedBankReview:false}),/mutasi rekening/);
 assert.throws(()=>s.ctx.offroadAdminV7ReviewBooking({...base,verifiedAt:Math.floor(Date.now()/1000)+10000}),/Waktu transfer/);
 assert.throws(()=>s.ctx.offroadAdminV7ReviewBooking({...base,action:'REJECT',
   bankCreditConfirmed:true,reason:'Ada uang masuk'}),/jangan Reject/);
 s.row[11]=650000;
 assert.throws(()=>s.ctx.offroadAdminV7ReviewBooking(base),/berubah/);
 assert.equal(s.writes.length,0);
 const viewer=setup({email:'viewer@offroad.test',bookingApproval:''});
 const v=viewer.ctx.offroadAdminV7ListApprovals().rows[0];
 assert.throws(()=>viewer.ctx.offroadAdminV7ReviewBooking({...base,bookingId:v.bookingId,expectedVersion:v.version}),/Hanya Owner/);
 assert.equal(viewer.writes.length,0);
});
test('completed Offroad trip blocked without ACC booking, even when declared LUNAS',()=>{
 const s=setup({bookingApproval:'',payment:'LUNAS',paid:1250000,balance:0});
 assert.throws(()=>s.ctx.offroadAdminV7Verify(request(s)),/Booking belum ACC/);
 assert.equal(s.writes.length,0);
});
test('approval UI provides manual ACC and Reject, never auto-approves from guest payment choice',()=>{
 assert.match(view,/id="approvalRows"/);
 assert.match(view,/id="approvalDetail"/);
 assert.match(view,/offroadAdminV7ListApprovals\(\)/);
 assert.match(view,/offroadAdminV7ReviewBooking\(/);
 assert.match(view,/Uang benar-benar masuk rekening/);
 assert.match(view,/Reject Booking/);
 assert.doesNotMatch(view,/innerHTML|OFFROAD_V7_SYNC_TOKEN|Authorization:\s*Bearer/);
 assert.match(script,/getRange\(input\.row,18,1,6\)\.setValues/);
 assert.doesNotMatch(script,/\/api\/v7-admin\/offroad-claims/);
});
