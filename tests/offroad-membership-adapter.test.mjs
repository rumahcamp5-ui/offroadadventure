import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
// Mirror the shared Membership event envelope, without depending on its repository.
function validateOffroadObservation(event, expectedSource) {
 assert.equal(event.sourceId, expectedSource);
 const keys=['sourceId','bookingId','revision','tripUnits','tripStatus','paymentVerified','paymentVerifiedAt','tripCompletedAt'];
 assert.deepEqual(Object.keys(event).sort(), keys.sort());
 assert.ok(Number.isInteger(event.revision) && event.revision>0);
 assert.ok(Number.isInteger(event.tripUnits) && event.tripUnits>0 && event.tripUnits<=50);
 assert.ok(!('totalAmount' in event) && !('receivedAmount' in event) && !('remainingAmount' in event));
 return {reviewState:event.tripStatus==='CANCELLED'?'cancelled':
  event.tripStatus==='SELESAI'&&event.paymentVerified===true&&event.paymentVerifiedAt&&event.tripCompletedAt?'ready_for_review':'waiting'};
}

const script=readFileSync(new URL('../membership/OffroadMembershipSourceV7.gs',import.meta.url),'utf8');
const sourceId='OFFROAD_SOURCE_'+'S'.repeat(30),secret='T'.repeat(48),spreadsheetId='OFFROAD_SHEET_'+'X'.repeat(32);
function environment({remaining=0,verified=true,completed=true,status='LUNAS',token=secret,tripStatus=null}={}){
  const props=new Map([
    ['OFFROAD_V7_SYNC_ENDPOINT','https://rumahcamp-admin-v6-staging.rumahcamp5.workers.dev/api/v7-sync/offroad'],
    ['OFFROAD_V7_SOURCE_ID',sourceId],
    ['OFFROAD_V7_SYNC_TOKEN',token],
    ['OFFROAD_V7_SPREADSHEET_ID',spreadsheetId]
  ]);
  const row=Array(23).fill('');
  row[2]='Private guest name';row[3]='081234567890';row[6]=2;row[9]=status;row[10]=remaining;
  row[11]=1900000-remaining;row[12]='OFFROAD-BOOK-20261112-001';row[14]=tripStatus||(completed?'SELESAI':'PENDING');
  row[15]=completed?new Date(Date.now()-600000):'';row[16]=verified?new Date(Date.now()-300000):'';row[17]='ACC';
  const sent=[];
  const ctx=vm.createContext({
    Date,Number,JSON,String,RegExp,Error,Array,isFinite,
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v)})},
    SpreadsheetApp:{openById:id=>{assert.equal(id,spreadsheetId);return {getSheetByName:()=>({getRange:(r,c)=>({
      getDisplayValues:()=>c===18?[['Status Persetujuan Booking']]:[['ID Booking','Status Sync Keuangan','Status Perjalanan','Tanggal Selesai','Pembayaran Diverifikasi']],
      getValues:()=>[row]
    })})};}},
    Utilities:{
      Charset:{UTF_8:'utf-8'},DigestAlgorithm:{SHA_256:'sha256'},
      computeDigest:(algorithm,str)=>[...createHash('sha256').update(str).digest()],
      computeHmacSha256Signature:(str,key)=>[...createHmac('sha256',key).update(str).digest()]
    },
    UrlFetchApp:{fetch:(url,options)=>{
      const payload=JSON.parse(options.payload);
      assert.equal(url,props.get('OFFROAD_V7_SYNC_ENDPOINT'));
      assert.equal(options.headers['X-Offroad-Signature'],
        createHmac('sha256',secret).update(options.headers['X-Offroad-Timestamp']+'\n'+options.payload).digest('hex'));
      sent.push(payload);
      return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({ok:true,status:'accepted',reviewState:payload.tripStatus==='CANCELLED'?'cancelled':'ready_for_review',pointsIssued:false})};
    }}
  });
  vm.runInContext(script,ctx);
  return {ctx,props,row,sent};
}
test('Offroad Apps Script adapter sends only source evidence with server-compatible HMAC, never PII or points',()=>{
 const s=environment();
 const outcome=s.ctx.offroadV7SendVerifiedBooking(6);
 assert.equal(outcome.pointsIssued,false);
 assert.equal(s.sent.length,1);
 assert.equal(validateOffroadObservation(s.sent[0],sourceId).reviewState,'ready_for_review');
 assert.equal(s.sent[0].tripUnits,2);
 const payload=JSON.stringify(s.sent[0]);
 assert.equal(s.sent[0].paymentVerified,true);
 assert.doesNotMatch(payload,/Private guest name|081234567890|memberId|pointsX2|totalAmount|receivedAmount|remainingAmount|paymentStatus|1900000|1\\.900\\.000/);
 assert.deepEqual(Object.keys(s.sent[0]).sort(),['sourceId','bookingId','revision','tripUnits','tripStatus','paymentVerified','paymentVerifiedAt','tripCompletedAt'].sort());
 assert.equal(s.ctx.offroadV7SendVerifiedBooking(6).status,'duplicate');
 assert.equal(s.sent.length,1);
});
test('Offroad adapter fails closed for DP, incomplete visit, blank verified payment and stale source setup',()=>{
 for(const change of [{remaining:1000},{verified:false},{completed:false},{status:'DP'},{token:'short'}]){
  const s=environment(change);
  assert.throws(()=>s.ctx.offroadV7SendVerifiedBooking(6));
  assert.equal(s.sent.length,0);
 }
 const s=environment();assert.throws(()=>s.ctx.offroadV7SendVerifiedBooking(5));assert.equal(s.sent.length,0);
});

test('unapproved or rejected Offroad bookings never send completed-trip membership evidence',()=>{
 for(const status of ['', 'REJECT', 'PENDING']){
  const s=environment();
  s.row[17]=status;
  assert.throws(()=>s.ctx.offroadV7SendVerifiedBooking(6),/Booking belum di-ACC/);
  assert.equal(s.sent.length,0);
 }
});

test('a signed Offroad cancellation is a later revision, blocks stale eligibility and never touches finance',()=>{
  const s=environment();
  const first=s.ctx.offroadV7SendVerifiedBooking(6);
  assert.equal(first.reviewState,'ready_for_review');
  s.row[14]='CANCELLED';
  const result=s.ctx.offroadV7SendCancellation(6);
  assert.equal(result.reviewState,'cancelled');
  assert.equal(result.pointsIssued,false);
  assert.equal(s.sent.length,2);
  assert.equal(s.sent[0].revision,1);
  assert.equal(s.sent[1].revision,2);
  assert.deepEqual([s.sent[1].tripStatus,s.sent[1].paymentVerified,s.sent[1].paymentVerifiedAt,s.sent[1].tripCompletedAt],
    ['CANCELLED',false,null,null]);
  assert.equal(validateOffroadObservation(s.sent[1],sourceId).reviewState,'cancelled');
  for(const payload of s.sent){
    assert.deepEqual(Object.keys(payload).sort(),['sourceId','bookingId','revision','tripUnits','tripStatus','paymentVerified','paymentVerifiedAt','tripCompletedAt'].sort());
    assert.doesNotMatch(JSON.stringify(payload),/1900000|totalAmount|receivedAmount|remainingAmount|paymentStatus|Private guest name|081234567890/);
  }
  const retry=s.ctx.offroadV7SendCancellation(6);
  assert.equal(retry.status,'duplicate');
  assert.equal(retry.reviewState,'cancelled');
  assert.equal(s.sent.length,2);
});
test('cancellation must be an explicit staff status, not an unrelated missing-payment state',()=>{
  for(const status of ['SELESAI','PENDING','', 'CHECKOUT']){
    const s=environment({tripStatus:status});
    assert.throws(()=>s.ctx.offroadV7SendCancellation(6));
    assert.equal(s.sent.length,0);
  }
});

test('standalone Offroad adapter fails closed without a configured source spreadsheet ID',()=>{
  const s=environment();
  s.props.delete('OFFROAD_V7_SPREADSHEET_ID');
  assert.throws(()=>s.ctx.offroadV7SendVerifiedBooking(6),/ID spreadsheet OFFROAD/);
  assert.throws(()=>s.ctx.offroadV7SendCancellation(6),/ID spreadsheet OFFROAD/);
  assert.equal(s.sent.length,0);
});

test('this bridge is dormant on the existing Offroad booking site',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/id="bookingForm"/);
 assert.match(html,/const BOOKING_ENDPOINT\s*=/);
 assert.doesNotMatch(html,/OffroadMembershipSourceV7|offroadV7SendVerifiedBooking|offroadV7SendCancellation/);
});
