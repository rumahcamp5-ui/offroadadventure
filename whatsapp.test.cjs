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
