/** Member booking confirmation only; never posts money or points. */
function offroadMemberLinkSettings_() {
  const props=PropertiesService.getScriptProperties();
  const sourceId=String(props.getProperty('OFFROAD_V7_SOURCE_ID')||'');
  const secret=String(props.getProperty('OFFROAD_V7_SYNC_TOKEN')||'');
  if(props.getProperty('OFFROAD_V7_BOOKING_LINK_ENABLED')!=='true'||!/^[-A-Za-z0-9_]{30,100}$/.test(sourceId)||secret.length<32)
    throw Error('Pengaitan member Offroad belum aktif. Booking dapat dimulai ulang tanpa pengaitan member.');
  return {props,sourceId,secret};
}
function offroadMemberLinkCall_(settings,action,data) {
  const payload=JSON.stringify(Object.assign({sourceId:settings.sourceId},data));
  const timestamp=String(Math.floor(Date.now()/1000));
  const signature=Utilities.computeHmacSha256Signature(timestamp+'\n'+payload,settings.secret,Utilities.Charset.UTF_8)
    .map(function(b){return ('0'+(b&255).toString(16)).slice(-2);}).join('');
  const response=UrlFetchApp.fetch('https://admin.rumahcamp.com/api/v7-sync/offroad-booking/'+action,{
    method:'post',contentType:'application/json',payload,
    headers:{'X-Offroad-Timestamp':timestamp,'X-Offroad-Signature':signature},
    followRedirects:false,muteHttpExceptions:true
  });
  if(response.getResponseCode()!==200)throw Error('Pengaitan member belum terkonfirmasi (HTTP '+response.getResponseCode()+').');
  let result;try{result=JSON.parse(response.getContentText());}catch(_){throw Error('Respons pengaitan member tidak valid.');}
  if(result.ok!==true||result.bookingId!==data.bookingId)throw Error('Identitas pengaitan member tidak cocok.');
  return result;
}
function offroadMemberLinkCheck_(data) {
  if(!data.membershipTicket)return;
  if(!/^[a-f0-9]{64}$/.test(data.membershipTicket)||!/^offroad_[a-f0-9]{32}$/.test(data.receiptId))throw Error('Tautan member Offroad tidak valid.');
  return offroadMemberLinkCall_(offroadMemberLinkSettings_(),'check',{bookingId:data.receiptId,ticket:data.membershipTicket});
}
function offroadMemberLinkSaved_(data,sheet,row) {
  if(!data.membershipTicket)return {membershipStatus:'none'};
  const settings=offroadMemberLinkSettings_(),key='OFFROAD_MEMBER_LINK_'+data.receiptId;
  // Use the persisted source row, never a browser timestamp or unit count.
  const values=sheet.getRange(row,1,1,13).getValues()[0];
  const date=values[1],units=Number(values[6]),id=String(values[12]||'');
  if(id!==data.receiptId||!(date instanceof Date)||!isFinite(date.getTime())||!Number.isInteger(units)||units<1||units>99)
    throw Error('Booking tersimpan perlu diperiksa sebelum dihubungkan ke member.');
  const payload={bookingId:id,ticket:data.membershipTicket,bookedAt:Math.floor(date.getTime()/1000),tripUnits:units};
  settings.props.setProperty(key,JSON.stringify({status:'pending',payload}));
  try{
    offroadMemberLinkCall_(settings,'confirm',payload);
    settings.props.setProperty(key,JSON.stringify({status:'confirmed'}));
    return {membershipStatus:'confirmed'};
  }catch(_){
    // Booking already exists. Keep its ID and an explicit pending state, never
    // create a second row, re-post money, or pretend membership was confirmed.
    return {membershipStatus:'pending'};
  }
}
function offroadMemberLinkStatus_(receiptId) {
  if(!/^offroad_[a-f0-9]{32}$/.test(receiptId))return 'none';
  try{const saved=JSON.parse(PropertiesService.getScriptProperties().getProperty('OFFROAD_MEMBER_LINK_'+receiptId)||'{}');return saved.status==='confirmed'?'confirmed':saved.status==='pending'?'pending':'none';}catch(_){return 'pending';}
}
function offroadMemberRetryMatches_(sheet,row,want) {
  const r=sheet.getRange(row,1,1,13).getValues()[0];
  return String(r[2]||'')===safeText_(want.name)&&String(r[3]||'')===want.safePhone&&
    r[4] instanceof Date&&Utilities.formatDate(r[4],TIMEZONE,'yyyy-MM-dd')===want.dateText&&
    Number(r[6])===want.jumlahUnit&&String(r[7]||'')===safeText_(want.packageSummary)&&
    String(r[8]||'')===safeText_(want.bookingNotes)&&String(r[9]||'')===want.paymentLabel&&
    Number(r[10])===want.remaining&&Number(r[11])===want.amountPaid;
}
