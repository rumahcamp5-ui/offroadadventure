/** Membership evidence commands only. Existing financial posting stays intact. */
function handleOffroadMembershipBridge_(data) {
  const props=PropertiesService.getScriptProperties(),secret=String(props.getProperty('OFFROAD_MEMBERSHIP_ADMIN_KEY')||'');
  if(secret.length<32||!offroadAdminEquals_(String(data.key||''),secret))return json_({status:'ERROR',message:'Akses konektor ditolak.'});
  const action=String(data.offroadMembershipAction||''),payload=data.payload||{};
  if(action==='snapshot'){
    if(!payload||Array.isArray(payload)||Object.keys(payload).length)return json_({status:'ERROR',message:'Permintaan tidak valid.'});
    try{
      const result=offroadAdminSnapshot_(SpreadsheetApp.openById(SPREADSHEET_ID)),all=props.getProperties();
      result.pendingLinks=Object.keys(all).filter(function(k){return k.indexOf('OFFROAD_MEMBER_LINK_')===0;}).map(function(k){try{const saved=JSON.parse(all[k]);return saved.status==='pending'?{bookingId:k.slice('OFFROAD_MEMBER_LINK_'.length),status:'pending'}:null;}catch(_){return null;}}).filter(Boolean).slice(0,100);
      return json_(result);
    }
    catch(_){return json_({status:'ERROR',message:'Data Offroad belum dapat dibaca.'});}
  }
  if(!payload||Array.isArray(payload)||Object.keys(payload).some(function(k){return k!=='bookingId';})||!/^[A-Za-z0-9_-]{10,80}$/.test(payload.bookingId||''))return json_({status:'ERROR',message:'ID booking tidak valid.'});
  try{
    const book=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME),row=book&&findExistingId_(book,payload.bookingId);
    if(!row)return json_({status:'ERROR',message:'Booking tidak ditemukan di sumber Offroad.'});
    if(action==='retry_link'){
      const saved=JSON.parse(props.getProperty('OFFROAD_MEMBER_LINK_'+payload.bookingId)||'{}');
      if(saved.status==='confirmed')return json_({status:'OK',membershipStatus:'confirmed'});
      if(saved.status!=='pending'||!saved.payload||!saved.payload.ticket)throw Error('Pending link missing');
      return json_(Object.assign({status:'OK'},offroadMemberLinkSaved_({receiptId:payload.bookingId,membershipTicket:saved.payload.ticket},book,row)));
    }
    if(action==='send_evidence')return json_({status:'OK',evidence:offroadV7SendVerifiedBooking(row)});
    if(action==='send_cancellation')return json_({status:'OK',evidence:offroadV7SendCancellation(row)});
    return json_({status:'ERROR',message:'Aksi membership tidak tersedia.'});
  }catch(_){return json_({status:'ERROR',message:'Bukti belum dapat dikirim. Periksa status perjalanan, tanggal selesai dan verifikasi pembayaran pada Sheet Offroad.'});}
}
