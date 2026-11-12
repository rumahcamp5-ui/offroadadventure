import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const code=readFileSync(new URL('../offroad-booking/VerifiedFinanceFirstPaymentV7.gs',import.meta.url),'utf8');
const headers=['Status Persetujuan Booking','Waktu Keputusan Booking','Admin Keputusan Booking',
 'Alasan Reject Booking','Jumlah Transfer Terverifikasi','Waktu Transfer Terverifikasi'];
const at=Math.floor(Date.now()/1000)-300;
function fixture({kind='dp',status='ACC',paymentChoice='DP = 350.000',amount=350000,
 outstanding=350000,bankAmount=amount,bankAt=at,verifiedAt=bankAt,
 approvedBy='owner@offroad.test',approvedAt=new Date(at*1000),
 expectedHeaders=headers}={}){
 const r=[
  paymentChoice,outstanding,amount,'OFFROAD-BOOKING-TEST-202611',
  'PENDING','',null,null,status,approvedAt,approvedBy,'',bankAmount,
  typeof bankAt==='number'?new Date(bankAt*1000):bankAt
 ];
 let readCount=0,writeCount=0;
 const sheet={getRange:(row,col,height,width)=>{
  if(row===5&&col===18&&height===1&&width===6)return {getDisplayValues:()=>[expectedHeaders]};
  if(row===6&&col===10&&height===1&&width===14)return {getValues:()=>{readCount++;return [r]}};
  throw new Error('Unexpected read range '+[row,col,height,width]);
 }};
 const ctx=vm.createContext({Date,String,Array,Object,Number,Math,RegExp,isFinite,Error});
 vm.runInContext(code,ctx);
 return {sheet,ctx,payment:{kind,amount,verifiedAt},reads:()=>readCount,writes:()=>writeCount};
}
test('first verified DP is allowed only after Owner ACC, bank amount and time match',()=>{
 const s=fixture();
 const out=s.ctx.offroadV7CheckFirstPaymentForFinance_(s.sheet,6,s.payment);
 assert.deepEqual(JSON.parse(JSON.stringify(out)),{allowed:true,source:'offroad',paymentType:'DP'});
 assert.equal(s.reads(),1);assert.equal(s.writes(),0);
});
test('LUNAS bank-confirmed first payment maps to settlement, not implicit guest claim',()=>{
 const s=fixture({kind:'settlement',paymentChoice:'LUNAS',outstanding:0,amount:950000});
 assert.equal(s.ctx.offroadV7CheckFirstPaymentForFinance_(s.sheet,6,s.payment).paymentType,'LUNAS');
 assert.equal(s.writes(),0);
});
test('a DP settlement is refused until a separate audited later bank receipt exists',()=>{
 const s=fixture({kind:'settlement'});
 assert.throws(()=>s.ctx.offroadV7CheckFirstPaymentForFinance_(s.sheet,6,s.payment),/pelunasan DP butuh ledger kedua/);
 assert.equal(s.writes(),0);
});
test('missing approval, rejected booking, unknown staff or mismatched bank evidence fail closed',()=>{
 for(const [name,patch,pattern] of [
  ['pending',{status:''},/belum di-ACC/],['reject',{status:'REJECT'},/belum di-ACC/],
  ['fakeStaff',{approvedBy:''},/belum di-ACC/],['unapproved',{approvedAt:''},/belum di-ACC/],
  ['bankAmount',{bankAmount:250000},/Bukti uang/],['bankDate',{bankAt:at-60},/Bukti uang/],
  ['wrongKind',{kind:'settlement'},/pelunasan DP butuh ledger/],
  ['badHeaders',{expectedHeaders:['none',...headers.slice(1)]},/Header R:W/],
  ['invalidPayment',{amount:0},/Nominal atau waktu/]
 ]){
  const s=fixture(patch);
  assert.throws(()=>s.ctx.offroadV7CheckFirstPaymentForFinance_(s.sheet,6,s.payment),pattern,name);
  assert.equal(s.writes(),0,name);
 }
});
test('bank post guard cannot be driven by public booking form and never mutates booking, finance or Membership',()=>{
 assert.doesNotMatch(code,/setValues|appendRow|setValue\(|insertRow|UrlFetchApp|OFFROAD_V7_SYNC_ENDPOINT/);
 assert.match(code,/payment\.verifiedAt!==verifiedBankAt/);
 assert.match(code,/verifiedBankAmount!==payment\.amount/);
 assert.match(code,/approval!=='ACC'/);
 assert.doesNotMatch(code,/const SPREADSHEET_ID|function doPost\(|function doGet\(/);
 const bookingSite=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.doesNotMatch(bookingSite,/offroadV7CheckFirstPaymentForFinance_|OFFROAD_FINANCE_PAYMENT/);
});
