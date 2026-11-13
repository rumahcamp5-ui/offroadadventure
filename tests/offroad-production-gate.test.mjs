import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const source=readFileSync(new URL('../offroad-production/Code.gs',import.meta.url),'utf8');
const ledgerSource=readFileSync(new URL('../offroad-production/OffroadPaymentsV7.gs',import.meta.url),'utf8');
const ui=readFileSync(new URL('../offroad-production/OffroadAdminV7.html',import.meta.url),'utf8');
const head=['No','Timestamp','Nama Pemesan','No WhatsApp Pemesan','Tanggal Offroad','Hari',
 'Jumlah Unit','Pilih Paket ','Catatan (optional)','Lunas/DP','Sisa Pelunasan','Jumlah Uang',
 'ID Booking','Status Sync Keuangan','Status Perjalanan','Tanggal Selesai','Pembayaran Diverifikasi',
 'Status Persetujuan Booking','Waktu Keputusan Booking','Admin Keputusan Booking','Alasan Reject Booking',
 'Jumlah Transfer Terverifikasi','Waktu Transfer Terverifikasi'];
const ledhead=['ID Booking','ID Pembayaran','Jenis Pembayaran','Jumlah Terverifikasi',
 'Waktu Transfer','Hash Referensi Bank','Diverifikasi Oleh','Waktu Pencatatan','Status Ledger','Sumber'];
const FAKE_ID='OFFROAD_FAKE_SHEET_'+ 'A'.repeat(32);
function create({email='owner@offroad.test',mode='production',title='OFFROAD',write=false,audit=false,wrongHeader=false}={}){
  const booking=[...Array.from({length:5},()=>Array(23).fill(''))];
  booking[4]=head.slice();
  if(wrongHeader)booking[4][17]='OTHER';
  booking.push([1,new Date('2026-11-10T03:00:00Z'),'Test Booking','',
    new Date('2026-11-10T05:00:00Z'),'Selasa',1,'Kalong Express','',
    'DP = 350.000',350000,350000,'OFFROAD-TEST-BOOKING-01','UNSYNCED',
    '','','','','','','','','']);
  const led=[ledhead.slice()],aud=[];
  const writes=[];
  let auditCreated=false;
  const sheet=(rows,label)=>({
    getLastRow:()=>rows.length,
    getRange:(i,j,h=1,w=1)=>({
      getValues:()=>rows.slice(i-1,i+h-1).map(r=>r.slice(j-1,j+w-1)),
      getDisplayValues:()=>rows.slice(i-1,i+h-1).map(r=>r.slice(j-1,j+w-1).map(x=>String(x==null?'':x))),
      setValues:v=>{
        writes.push({label,col:j,row:i,values:v});
        if(label!=='booking')throw Error('Unauthorized sheet update');
        v.forEach((r,n)=>r.forEach((val,k)=>{rows[i-1+n][j-1+k]=val;}));
      }
    }),
    appendRow:record=>{
      if(label==='booking')throw Error('No append to booking');
      rows.push(record);writes.push({label,row:rows.length,record});
    }
  });
  const sh=sheet(booking,'booking'),ledger=sheet(led,'ledger');
  const auditSheet={appendRow:record=>{aud.push(record);writes.push({label:'audit',record})}};
  const workbook={
    getName:()=>title,
    getSheetByName:name=>{
      if(name==='Formulir Offroad')return sh;
      if(name==='OFFROAD V7 PAYMENT LEDGER')return ledger;
      if(name==='OFFROAD V7 AUDIT')return auditCreated||audit?auditSheet:null;
      if(name==='Data Keuangan Offroad')throw Error('Forbidden read of actual finance');
      return null;
    },
    insertSheet:name=>{if(name!=='OFFROAD V7 AUDIT')throw Error('Unexpected new sheet');auditCreated=true;return auditSheet;}
  };
  const props=new Map([
    ['OFFROAD_ADMIN_V7_MODE',mode],
    ['OFFROAD_ADMIN_V7_SPREADSHEET_ID',FAKE_ID],
    ['OFFROAD_ADMIN_V7_OWNER_EMAILS','owner@offroad.test'],
    ['OFFROAD_ADMIN_V7_VIEWER_EMAILS','viewer@offroad.test'],
    ['OFFROAD_ADMIN_V7_WRITE_ENABLED',write?'YES':'NO'],
    ['OFFROAD_ADMIN_V7_FINANCE_TRIGGER_AUDITED',write?'YES':'NO']
  ]);
  const ctx=vm.createContext({
    Date,Number,String,Array,Object,JSON,Math,Error,RegExp,isFinite,
    Session:{getActiveUser:()=>({getEmail:()=>email})},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null})},
    SpreadsheetApp:{openById:id=>{assert.equal(id,FAKE_ID);return workbook;}},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf-8'},
      computeDigest:(algo,s)=>[...createHash('sha256').update(s).digest()],
      formatDate:(d,zone,fmt)=>{assert.equal(zone,'Asia/Jakarta');return d.toISOString().slice(0,10);}},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    HtmlService:{createHtmlOutputFromFile:n=>({value:n,setTitle(){return this;}}),
      createHtmlOutput:n=>({value:n,setTitle(){return this;}})}
  });
  vm.runInContext(source+'\n'+ledgerSource,ctx);
  ctx.OFFROAD_V7_PRODUCTION_ID_FINGERPRINT=createHash('sha256').update(FAKE_ID).digest('hex');
  return {ctx,booking,led,aud,writes,props};
}
test('production source never includes raw live Sheet ID or staging data and uses strictly private property',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../offroad-production/appsscript.json',import.meta.url),'utf8'));
  assert.equal(manifest.runtimeVersion,'V8');
  assert.equal(manifest.timeZone,'Asia/Jakarta');
  assert.doesNotMatch(source,/17-0kSIPJzfqBs3Y8G4jl5yaV8vAiyhyyulqceV6uGSc|OFFROAD_V7_STAGING_SPREADSHEET_ID/);
  assert.doesNotMatch(source,/SIMULASI|STAGING ONLY|mode staging/);
  assert.match(source,/OFFROAD_V7_PRODUCTION_ID_FINGERPRINT/);
  assert.match(source,/OFFROAD_ADMIN_V7_FINANCE_TRIGGER_AUDITED/);
  assert.match(source,/OFFROAD_ADMIN_V7_WRITE_ENABLED/);
  assert.doesNotMatch(source+'\n'+ledgerSource,/UrlFetchApp|function doPost\(/);
  assert.match(ui,/canWrite/);assert.match(ui,/role!=='owner'\|\|!canWrite/);
  assert.doesNotMatch(ui,/data dummy|Sheet simulasi|STAGING/);
});
test('production can read actual-shape booking with Owner allowlist but is read-only by default',()=>{
  const s=create();
  const p=s.ctx.offroadAdminV7Preflight();
  assert.equal(p.environment,'PRODUCTION');
  assert.equal(p.writesEnabled,false);
  assert.equal(p.business,'offroad');
  assert.equal(p.financeChanged,false);
  const list=s.ctx.offroadAdminV7ListApprovals();
  assert.equal(list.role,'owner');assert.equal(list.canWrite,false);
  assert.equal(list.rows[0].approval,'MENUNGGU VERIFIKASI');
  const b=list.rows[0];
  assert.throws(()=>s.ctx.offroadAdminV7ReviewBooking({row:b.row,bookingId:b.bookingId,expectedVersion:b.version,action:'ACC'}),/dikunci/);
  assert.throws(()=>s.ctx.offroadAdminV7RecordVerifiedPayment({}),/dikunci/);
  assert.equal(s.writes.length,0);
});
test('unauthorized identity, wrong mode/Sheet title/hash or incomplete headers are fail-closed',()=>{
  const unknown=create({email:'unknown@example.net'});
  assert.throws(()=>unknown.ctx.offroadAdminV7Preflight(),/tidak mendapat izin/);
  const wrongMode=create({mode:'staging'});
  assert.throws(()=>wrongMode.ctx.offroadAdminV7Preflight(),/mode production/);
  const wrongTitle=create({title:'SOME OTHER BUSINESS'});
  assert.throws(()=>wrongTitle.ctx.offroadAdminV7Preflight(),/Nama spreadsheet/);
  const wrongHash=create();wrongHash.ctx.OFFROAD_V7_PRODUCTION_ID_FINGERPRINT='0'.repeat(64);
  assert.throws(()=>wrongHash.ctx.offroadAdminV7Preflight(),/Identitas spreadsheet/);
  const wrongHeader=create({wrongHeader:true});
  assert.throws(()=>wrongHeader.ctx.offroadAdminV7ListApprovals(),/Kolom R belum siap/);
  for(const c of [unknown,wrongMode,wrongTitle,wrongHash,wrongHeader])assert.equal(c.writes.length,0);
});
test('both audited finance and explicit Owner release switch must be enabled, Viewer always read-only',()=>{
  const s=create();
  s.props.set('OFFROAD_ADMIN_V7_WRITE_ENABLED','YES');
  assert.equal(s.ctx.offroadAdminV7ListApprovals().canWrite,false);
  s.props.set('OFFROAD_ADMIN_V7_WRITE_ENABLED','NO');
  s.props.set('OFFROAD_ADMIN_V7_FINANCE_TRIGGER_AUDITED','YES');
  assert.equal(s.ctx.offroadAdminV7ListApprovals().canWrite,false);
  s.props.set('OFFROAD_ADMIN_V7_WRITE_ENABLED','YES');
  assert.equal(s.ctx.offroadAdminV7ListApprovals().canWrite,true);
  const viewer=create({email:'viewer@offroad.test',write:true});
  assert.equal(viewer.ctx.offroadAdminV7ListApprovals().canWrite,false);
  assert.throws(()=>viewer.ctx.offroadAdminV7ReviewBooking({}),/Hanya Owner/);
});
test('authorized approval writes only R:W, never edits finance or grants Membership points',()=>{
  const s=create({write:true}),b=s.ctx.offroadAdminV7ListApprovals().rows[0],at=Math.floor(Date.now()/1000)-300;
  const res=s.ctx.offroadAdminV7ReviewBooking({
    row:b.row,bookingId:b.bookingId,expectedVersion:b.version,action:'ACC',
    evidenceReference:'bank-check-offroad-20261113',reason:'',
    confirmedIdentity:true,confirmedBankReview:true,bankCreditConfirmed:true,
    verifiedAmount:350000,verifiedAt:at
  });
  assert.equal(res.ok,true);assert.equal(res.financeChanged,false);assert.equal(res.pointsIssued,false);
  assert.equal(s.booking[5][17],'ACC');
  assert.equal(s.booking[5][11],350000);
  assert.equal(s.booking[5][13],'UNSYNCED');
  assert.deepEqual(s.writes.filter(x=>x.label==='booking').map(x=>x.col),[18]);
  assert.equal(s.led.length,1,'no bank payments are silently invented by an ACC');
});
