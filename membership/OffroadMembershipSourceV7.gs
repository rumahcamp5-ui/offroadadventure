/**
 * Offroad Membership V7 source adapter, MANUAL ONLY.
 *
 * Install in the existing OFFROAD Apps Script project only after the Owner has
 * verified the booking and authorized the source integration. No onEdit or
 * scheduled trigger is registered by this file.
 *
 * Formulir Offroad: A:N existing, O "Status Perjalanan",
 * P "Tanggal Selesai", Q "Pembayaran Diverifikasi".
 * O/P/Q must be filled by an authorized human after checking the trip and
 * actual payment. This adapter sends NO names, WhatsApp numbers or cash writes.
 *
 * Script Properties, never hard-coded:
 * OFFROAD_V7_SYNC_ENDPOINT (staging first)
 * OFFROAD_V7_SOURCE_ID     (matches Worker OFFROAD_SOURCE_ID)
 * OFFROAD_V7_SYNC_TOKEN    (matches Worker OFFROAD_SOURCE_SYNC_TOKEN)
 * OFFROAD_V7_SPREADSHEET_ID (Offroad-owned booking spreadsheet, no RC Sheets)
 */
function offroadV7Money_(value) {
  if(typeof value==='number')
    return Number.isSafeInteger(value)&&value>=0?value:null;
  const raw=String(value==null?'':value).trim();
  if(!raw || !/^(?:Rp\s*)?[0-9][0-9.,\s]*$/i.test(raw))return null;
  const cleaned=raw.replace(/^Rp\s*/i,'').replace(/\s/g,'');
  if(!/^\d{1,3}(?:\.\d{3})*$/.test(cleaned)&&!/^\d+$/.test(cleaned))return null;
  const amount=Number(cleaned.replace(/\./g,''));
  return Number.isSafeInteger(amount)&&amount>=0?amount:null;
}
function offroadV7Time_(value) {
  if(!(value instanceof Date)||!isFinite(value.getTime()))return null;
  return Math.floor(value.getTime()/1000);
}
function offroadV7Hash_(str) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,str,Utilities.Charset.UTF_8)
    .map(function(b){return ('0'+(b&255).toString(16)).slice(-2);}).join('');
}
/**
 * Common signed delivery for verified trips and explicit cancellations.
 * Strictly read/revision metadata in Script Properties; no Sheet writes.
 */
function offroadV7DispatchEvidence_(props,endpoint,secret,bookingId,base,fingerprint) {
  const propertyKey='OFFROAD_V7_REV_'+offroadV7Hash_(bookingId).slice(0,24);
  let previous={};try{previous=JSON.parse(props.getProperty(propertyKey)||'{}');}catch(_){}
  if(previous.fingerprint===fingerprint&&previous.acknowledged===true)
    return {status:'duplicate',reviewState:base.tripStatus==='CANCELLED'?'cancelled':'ready_for_review',pointsIssued:false};
  const revision=previous.fingerprint===fingerprint?previous.revision:
    Number.isSafeInteger(previous.revision)&&previous.revision>=1?previous.revision+1:1;
  if(!Number.isSafeInteger(revision)||revision<1||revision>1000000000)throw Error('Revisi Offroad tidak valid.');
  const payload=JSON.stringify({sourceId:base.sourceId,bookingId:bookingId,revision:revision,
    tripUnits:base.tripUnits,tripStatus:base.tripStatus,paymentVerified:base.paymentVerified,
    paymentVerifiedAt:base.paymentVerifiedAt,tripCompletedAt:base.tripCompletedAt});
  const timestamp=String(Math.floor(Date.now()/1000));
  const bytes=Utilities.computeHmacSha256Signature(timestamp+'\n'+payload,secret,Utilities.Charset.UTF_8);
  const signature=bytes.map(function(b){return ('0'+(b&255).toString(16)).slice(-2);}).join('');
  const res=UrlFetchApp.fetch(endpoint,{method:'post',contentType:'application/json',payload:payload,
    headers:{'X-Offroad-Timestamp':timestamp,'X-Offroad-Signature':signature},
    muteHttpExceptions:true});
  if(res.getResponseCode()!==200)throw Error('Inbox Offroad menolak observasi (HTTP '+res.getResponseCode()+').');
  let ack={};try{ack=JSON.parse(res.getContentText());}catch(_){}
  if(ack.ok!==true||['accepted','duplicate'].indexOf(ack.status)<0||ack.pointsIssued!==false)
    throw Error('Penerimaan sumber tidak cocok; periksa log, tidak ada poin yang diterbitkan.');
  props.setProperty(propertyKey,JSON.stringify({revision:revision,fingerprint:fingerprint,acknowledged:true}));
  return {status:ack.status,reviewState:ack.reviewState,pointsIssued:false};
}
/**
 * Source-only cancellation evidence (manual, no point issuance/reversal).
 * A higher signed revision blocks any future award from stale 'SELESAI' proof.
 * It does NOT issue refunds or reverse already awarded points. Owner must
 * separately review cancellations/refunds in the Offroad dashboard.
 */
function offroadV7SendCancellation(rowNumber) {
  if(!Number.isInteger(rowNumber)||rowNumber<6||rowNumber>1006)throw Error('Nomor baris Offroad tidak valid.');
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(25000))throw Error('Proses Offroad lain masih berjalan.');
  try {
    const props=PropertiesService.getScriptProperties();
    const endpoint=props.getProperty('OFFROAD_V7_SYNC_ENDPOINT');
    const sourceId=props.getProperty('OFFROAD_V7_SOURCE_ID');
    const secret=props.getProperty('OFFROAD_V7_SYNC_TOKEN');
    const allowed=[
      'https://rumahcamp-admin-v6-staging.rumahcamp5.workers.dev/api/v7-sync/offroad',
      'https://admin.rumahcamp.com/api/v7-sync/offroad'
    ];
    if(allowed.indexOf(endpoint)<0||!sourceId||!secret||secret.length<32)
      throw Error('Konfigurasi sumber Offroad belum lengkap.');
    const book=offroadV7BookingSheet_(props);
    const headings=book.getRange(5,13,1,5).getDisplayValues()[0];
    if(headings[0]!=='ID Booking'||headings[2]!=='Status Perjalanan'||
       headings[3]!=='Tanggal Selesai'||headings[4]!=='Pembayaran Diverifikasi')
      throw Error('Kolom M:Q belum cocok untuk bukti perjalanan.');
    const r=book.getRange(rowNumber,1,1,17).getValues()[0];
    const bookingId=String(r[12]||'').trim();
    const units=Number(r[6]);
    const tripStatus=String(r[14]||'').trim().toUpperCase();
    if(!/^[A-Za-z0-9][A-Za-z0-9:._-]{5,99}$/.test(bookingId)||
       !Number.isInteger(units)||units<1||units>50||tripStatus!=='CANCELLED')
      throw Error('Status perjalanan harus CANCELLED dan ID/jumlah unit valid sebelum mengirim pembatalan.');
    const base={sourceId:sourceId,bookingId:bookingId,tripUnits:units,
      tripStatus:'CANCELLED',paymentVerified:false,
      paymentVerifiedAt:null,tripCompletedAt:null};
    const fingerprint=offroadV7Hash_(JSON.stringify(base));
    return offroadV7DispatchEvidence_(props,endpoint,secret,bookingId,base,fingerprint);
  } finally {lock.releaseLock();}
}

// The existing Offroad booking Apps Script may be standalone, not bound to a
// spreadsheet. Explicitly select the Offroad-owned sheet by configured ID.
function offroadV7BookingSheet_(props) {
  const spreadsheetId=props.getProperty('OFFROAD_V7_SPREADSHEET_ID');
  if(typeof spreadsheetId!=='string'||!/^[A-Za-z0-9_-]{20,120}$/.test(spreadsheetId))
    throw Error('Konfigurasi ID spreadsheet OFFROAD belum lengkap.');
  const workbook=SpreadsheetApp.openById(spreadsheetId);
  const book=workbook&&workbook.getSheetByName('Formulir Offroad');
  if(!book)throw Error('Sheet Formulir Offroad tidak tersedia dalam spreadsheet Offroad.');
  return book;
}

function offroadV7SendVerifiedBooking(rowNumber) {
  if(!Number.isInteger(rowNumber)||rowNumber<6||rowNumber>1006)throw Error('Nomor baris Offroad tidak valid.');
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(25000))throw Error('Proses Offroad lain masih berjalan.');
  try{
    const props=PropertiesService.getScriptProperties();
    const endpoint=props.getProperty('OFFROAD_V7_SYNC_ENDPOINT');
    const sourceId=props.getProperty('OFFROAD_V7_SOURCE_ID');
    const secret=props.getProperty('OFFROAD_V7_SYNC_TOKEN');
    const allowed=[
      'https://rumahcamp-admin-v6-staging.rumahcamp5.workers.dev/api/v7-sync/offroad',
      'https://admin.rumahcamp.com/api/v7-sync/offroad'
    ];
    if(allowed.indexOf(endpoint)<0||!sourceId||!secret||secret.length<32)throw Error('Konfigurasi sumber Offroad belum lengkap.');
    const book=offroadV7BookingSheet_(props);
    const headings=book.getRange(5,13,1,5).getDisplayValues()[0];
    if(headings[0]!=='ID Booking'||headings[2]!=='Status Perjalanan'||
       headings[3]!=='Tanggal Selesai'||headings[4]!=='Pembayaran Diverifikasi')
      throw Error('Kolom M:Q belum cocok. Tambahkan O Status Perjalanan, P Tanggal Selesai, Q Pembayaran Diverifikasi.');
    const approvalHeader=book.getRange(5,18,1,1).getDisplayValues()[0][0];
    if(String(approvalHeader||'').trim()!=='Status Persetujuan Booking')
      throw Error('Kolom R Status Persetujuan Booking belum tersedia.');
    const r=book.getRange(rowNumber,1,1,23).getValues()[0];
    if(String(r[17]||'').trim().toUpperCase()!=='ACC')
      throw Error('Booking belum di-ACC setelah transfer terverifikasi; poin Offroad tidak boleh dikirim.');
    const bookingId=String(r[12]||'').trim(),units=Number(r[6]);
    const paymentStatus=String(r[9]||'').trim().toUpperCase();
    const received=offroadV7Money_(r[11]),remaining=offroadV7Money_(r[10]);
    const tripStatus=String(r[14]||'').trim().toUpperCase();
    const completedAt=offroadV7Time_(r[15]),paymentVerifiedAt=offroadV7Time_(r[16]);
    const at=Math.floor(Date.now()/1000);
    if(!/^[A-Za-z0-9][A-Za-z0-9:._-]{5,99}$/.test(bookingId)||
       !Number.isInteger(units)||units<1||units>50||
       !['LUNAS','CUSTOM'].includes(paymentStatus)||
       !Number.isSafeInteger(received)||received<=0||remaining!==0||
       tripStatus!=='SELESAI'||!completedAt||!paymentVerifiedAt||
       completedAt>at||paymentVerifiedAt>at)
      throw Error('Perjalanan selesai dan pelunasan terverifikasi wajib dicatat oleh petugas sebelum mengirim observasi.');
    // Custom package prices are allowed; never replace actual accepted cash
    // with an assumed standard package tariff.
    // Membership only receives verified completion, never Offroad revenue,
    // deposit, package tariff or outstanding amount. This check remains local.
    const base={sourceId:sourceId,bookingId:bookingId,tripUnits:units,
      tripStatus:'SELESAI',paymentVerified:true,
      paymentVerifiedAt:paymentVerifiedAt,tripCompletedAt:completedAt};
    const fingerprint=offroadV7Hash_(JSON.stringify({base:base,
      localPaymentStatus:paymentStatus,localAmount:received,localRemaining:remaining}));
    return offroadV7DispatchEvidence_(props,endpoint,secret,bookingId,base,fingerprint);
  }finally{lock.releaseLock();}
}
