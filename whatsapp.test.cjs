const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const gs=fs.readFileSync(__dirname+'/Code.gs','utf8');
const extract=s=>s.slice(s.indexOf('function normalizeOffroadWhatsapp('),s.indexOf('\n}',s.indexOf('function normalizeOffroadWhatsapp('))+2);
const client={};vm.runInNewContext(extract(html),client);
const server={};vm.runInNewContext(extract(gs),server);
const valid=[['081234567890','+62','6281234567890'],['01139916224','+60','601139916224'],['+60 11-3991-6224','+60','601139916224'],['00601139916224','+60','601139916224'],['81234567','+65','6581234567'],['+44 (7700) 900123','','447700900123'],['+1 202-555-0123','','12025550123']];
for(const [raw,country,want] of valid)test('client to server round trip '+raw,()=>{
 const normalized=client.normalizeOffroadWhatsapp(raw,country);assert.equal(normalized,want);
 assert.equal(server.normalizeOffroadWhatsapp('+'+normalized,country),want);
});
for(const [raw,country] of [['+601139916224','+62'],['01139916224',''],['123','+62'],['+000000000',''],['+6011abc','+60'],['+1234567890123456',''],['=1+1','']])test('reject malformed or mismatched '+raw,()=>{
 assert.throws(()=>client.normalizeOffroadWhatsapp(raw,country));assert.throws(()=>server.normalizeOffroadWhatsapp(raw,country));
});
test('all inline scripts and Apps Script parse',()=>{
 for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(match[1].trim())new vm.Script(match[1]);
 new vm.Script(gs);
});
function simulateValidation(source, phone, country) {
 let storageCalls=0;
 const context={console,Date,Utilities:{formatDate:date=>date.toISOString().slice(0,10)},LockService:{getScriptLock(){storageCalls++;throw Error('TEST_STORAGE_BOUNDARY');}},CacheService:{getScriptCache:()=>({put(){}})},ContentService:{MimeType:{JSON:'json'},createTextOutput:content=>({setMimeType(){return JSON.parse(content);}})}};
 vm.runInNewContext(source,context);
 const payload={receiptId:'TEST_PHONE_ONLY_1234',guestName:'Validation Test',guestWhatsapp:phone,waCountryCode:country,tripDate:'2099-01-01',guestUnits:1,tripPackages:['express'],payment:'DP'};
 const result=context.doPost({postData:{contents:JSON.stringify(payload)}});
 return {storageCalls,result};
}
test('original backend already accepts a complete Malaysia +60 number',()=>{
 const original=fs.readFileSync(__dirname+'/fixtures/offroad-before-whatsapp.gs','utf8');
 const r=simulateValidation(original,'+601112345678','');assert.equal(r.storageCalls,1);assert.equal(r.result.message,'TEST_STORAGE_BOUNDARY');
});
for(const [phone,country] of [['01112345678','+60'],['+60 (11) 1234-5678','+60'],['+39 06 12345678','']])test('patched doPost validates international input before storage: '+phone,()=>{
 const r=simulateValidation(gs,phone,country);assert.equal(r.storageCalls,1);assert.equal(r.result.message,'TEST_STORAGE_BOUNDARY');
});
for(const [phone,country] of [['+601112345678','+62'],['+6011abc','+60']])test('patched doPost rejects invalid input before storage: '+phone,()=>{
 const r=simulateValidation(gs,phone,country);assert.equal(r.storageCalls,0);assert.notEqual(r.result.message,'TEST_STORAGE_BOUNDARY');
});
for(const [stored,normalized] of [['+601112345678','601112345678'],['601112345678','601112345678'],['081234567890','6281234567890'],['+447700900123','447700900123']])test('recent duplicate guard recognizes historical phone format '+stored,()=>{
 const ctx={Date,console};vm.runInNewContext(gs,ctx);
 const row=[new Date(),'Validation Test',stored,'2099-01-01','',1,'Unit 1: Kalong Express','','DP = 350.000',350000,350000,'EXISTING_ID_123'];
 const sheet={getLastRow:()=>6,getRange:()=>({getValues:()=>[row]})};
 const found=ctx.findRecentDuplicate_(sheet,{name:'Validation Test',safePhone:normalized,dateText:'2099-01-01',jumlahUnit:1,packageSummary:'Unit 1: Kalong Express',bookingNotes:'',paymentType:'DP',amountPaid:350000});
 assert.equal(found.id,'EXISTING_ID_123');assert.equal(row[2],stored);
});

test('financial bridge remains byte-identical to the inspected source',()=>{
 const original=fs.readFileSync(__dirname+'/fixtures/offroad-before-whatsapp.gs','utf8');
 const marker='function offroadAdminNumber_(';
 assert.equal(gs.slice(gs.indexOf(marker)),original.slice(original.indexOf(marker)));
});
