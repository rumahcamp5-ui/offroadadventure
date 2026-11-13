/**
 * OFFROAD ADMIN V7 — stand-alone Apps Script project, not the public booking
 * receiver. Do not paste over its Code.gs, do not change its doGet/doPost.
 *
 * Deploy separately: Execute as "User accessing the web app", access only
 * authorized signed-in staff. Every RPC checks the active Google identity.
 * If Google hides it, requests fail closed. Owner/Viewer addresses are stored
 * only as private Script Properties, never in website HTML.
 *
 * Required Script Properties:
 *  OFFROAD_ADMIN_V7_SPREADSHEET_ID
 *  OFFROAD_ADMIN_V7_OWNER_EMAILS    comma-separated exact email addresses
 * Optional:
 *  OFFROAD_ADMIN_V7_VIEWER_EMAILS   read-only staff addresses
 *
 * This admin ONLY reads Offroad's own Sheet A:Q and updates O:Q following
 * explicit Owner evidence verification. It does NOT alter bookings, prices,
 * DP, balance, cash, finance sync, or Membership points.
 */
var OFFROAD_V7_BOOKING_TAB = 'Formulir Offroad';
var OFFROAD_V7_AUDIT_TAB = 'OFFROAD V7 AUDIT';
var OFFROAD_V7_FIRST_ROW = 6;
var OFFROAD_V7_MAX_ROW = 1006;
var OFFROAD_V7_STAGING_SPREADSHEET_ID = '1jTrkBvM4V2mHIA4KeLyixGcJgV4ASxjy6jJgyFku8Po';
var OFFROAD_V7_STAGING_TITLE = '[STAGING] OFFROAD V7 ADMIN TEST - DATA SIMULASI';
var OFFROAD_V7_STAGING_MARKER = 'STAGING OFFROAD V7 • DATA SIMULASI • JANGAN GUNAKAN UNTUK BOOKING ASLI';

function offroadAdminV7Emails_(raw) {
  return String(raw || '').split(',').map(function(value){return value.trim().toLowerCase();})
    .filter(function(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);});
}
function offroadAdminV7Identity_() {
  var email=String(Session.getActiveUser().getEmail()||'').trim().toLowerCase();
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw Error('Identitas Google tidak tersedia. Akses admin ditolak.');
  var p=PropertiesService.getScriptProperties();
  var owners=offroadAdminV7Emails_(p.getProperty('OFFROAD_ADMIN_V7_OWNER_EMAILS'));
  var viewers=offroadAdminV7Emails_(p.getProperty('OFFROAD_ADMIN_V7_VIEWER_EMAILS'));
  if(owners.indexOf(email)>=0)return {email:email,role:'owner',props:p};
  if(viewers.indexOf(email)>=0)return {email:email,role:'viewer',props:p};
  throw Error('Akun Google ini tidak mendapat izin admin Offroad.');
}
function offroadAdminV7Sheet_(identity) {
  // This release is STAGING ONLY. An accidental production Sheet ID,
  // wrong document title or missing fixture watermark MUST fail closed.
  if(identity.props.getProperty('OFFROAD_ADMIN_V7_MODE')!=='staging')
    throw Error('Admin Offroad V7 hanya diizinkan untuk mode staging.');
  var id=identity.props.getProperty('OFFROAD_ADMIN_V7_SPREADSHEET_ID');
  if(id!==OFFROAD_V7_STAGING_SPREADSHEET_ID)
    throw Error('ID spreadsheet bukan Sheet staging Offroad yang disetujui.');
  var file=SpreadsheetApp.openById(id);
  if(file.getName()!==OFFROAD_V7_STAGING_TITLE)
    throw Error('Judul file staging tidak sesuai; akses ditolak.');
  var sheet=file.getSheetByName(OFFROAD_V7_BOOKING_TAB);
  if(!sheet)throw Error('Tab Formulir Offroad tidak tersedia.');
  if(sheet.getRange(1,1,1,1).getDisplayValues()[0][0]!==OFFROAD_V7_STAGING_MARKER)
    throw Error('Penanda data simulasi staging tidak cocok; akses ditolak.');
  var header=sheet.getRange(5,1,1,17).getDisplayValues()[0];
  var expected={2:'Nama Pemesan',6:'Jumlah Unit',9:'Lunas/DP',10:'Sisa Pelunasan',
    11:'Jumlah Uang',12:'ID Booking',13:'Status Sync Keuangan',
    14:'Status Perjalanan',15:'Tanggal Selesai',16:'Pembayaran Diverifikasi'};
  Object.keys(expected).forEach(function(key){
    if(String(header[Number(key)]||'').trim()!==expected[key])
      throw Error('Kolom '+String.fromCharCode(65+Number(key))+' berbeda dari skema Offroad V7. Tidak ada perubahan.');
  });
  return {file:file,sheet:sheet};
}
function offroadAdminV7Currency_(value) {
  if(typeof value==='number')return Number.isSafeInteger(value)&&value>=0?value:null;
  var raw=String(value==null?'':value).trim().replace(/^Rp\s*/i,'').replace(/\s/g,'');
  if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(raw))return null;
  var n=Number(raw.replace(/\./g,''));
  return Number.isSafeInteger(n)&&n>=0?n:null;
}
function offroadAdminV7TripStart_(value) {
  var text='';
  if(value instanceof Date&&isFinite(value.getTime()))
    text=Utilities.formatDate(value,'Asia/Jakarta','yyyy-MM-dd');
  else text=String(value||'').trim();
  var iso=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  var indo=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  var year,month,day;
  if(iso){year=Number(iso[1]);month=Number(iso[2]);day=Number(iso[3]);}
  else if(indo){year=Number(indo[3]);month=Number(indo[2]);day=Number(indo[1]);}
  else return null;
  var date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()+1!==month||date.getUTCDate()!==day)
    return null;
  // Offroad site operates in West Indonesia Time (Asia/Jakarta, UTC+7).
  return Math.floor(date.getTime()/1000)-7*3600;
}
function offroadAdminV7Hash_(str) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,str,Utilities.Charset.UTF_8)
    .map(function(n){return ('0'+(n&255).toString(16)).slice(-2);}).join('');
}
function offroadAdminV7Version_(row) {
  // Fingerprint all booking/payment fields plus O-Q. Rejects stale approvals
  // if a different editor changed the row after it was displayed.
  return offroadAdminV7Hash_(JSON.stringify(row.slice(1,17)));
}
function offroadAdminV7Row_(values,rowNumber) {
  var id=String(values[12]||'').trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9:._-]{5,99}$/.test(id))return null;
  var units=Number(values[6]);
  var trip=values[4] instanceof Date?values[4].toISOString().slice(0,10):String(values[4]||'');
  return {row:rowNumber,bookingId:id,name:String(values[2]||'').slice(0,100),
    tripDate:trip,units:Number.isInteger(units)?units:0,
    package:String(values[7]||'').slice(0,130),
    paymentStatus:String(values[9]||'').slice(0,80),
    paidAmount:offroadAdminV7Currency_(values[11]),
    outstanding:offroadAdminV7Currency_(values[10]),
    tripStatus:String(values[14]||'').trim().toUpperCase()||'BELUM DIPERIKSA',
    paymentVerified:values[16] instanceof Date && isFinite(values[16].getTime()),
    tripCompleted:values[15] instanceof Date && isFinite(values[15].getTime()),
    version:offroadAdminV7Version_(values)};
}
/**
 * Read-only staging preflight. Does not return any booking rows or financial
 * values, and cannot issue rewards. Call manually once after authorization.
 */
function offroadAdminV7Preflight() {
  var actor=offroadAdminV7Identity_();
  var source=offroadAdminV7Sheet_(actor);
  return {
    ready:true,
    environment:'STAGING ONLY',
    business:'offroad',
    accessRole:actor.role,
    sheet:'Formulir Offroad (SIMULASI)',
    recordsAvailable:Math.max(0,Math.min(source.sheet.getLastRow(),OFFROAD_V7_MAX_ROW)-OFFROAD_V7_FIRST_ROW+1),
    pointsIssued:false,
    financeChanged:false
  };
}

function offroadAdminV7ListBookings() {
  var user=offroadAdminV7Identity_();
  var file=offroadAdminV7Sheet_(user),sheet=file.sheet;
  var last=Math.min(sheet.getLastRow(),OFFROAD_V7_MAX_ROW);
  var count=Math.min(100,Math.max(0,last-OFFROAD_V7_FIRST_ROW+1));
  var result=[];
  if(count){
    var start=last-count+1;
    var rows=sheet.getRange(start,1,count,17).getValues();
    for(var i=rows.length-1;i>=0;i--){
      var booking=offroadAdminV7Row_(rows[i],start+i);
      if(booking)result.push(booking);
    }
  }
  return {business:'offroad',role:user.role,rows:result,
    note:'Data internal Offroad. Ini bukan laporan gabungan atau saldo Membership.',
    pointsIssued:false};
}
function offroadAdminV7Audit_(file,entry) {
  var sheet=file.getSheetByName(OFFROAD_V7_AUDIT_TAB);
  if(!sheet){
    sheet=file.insertSheet(OFFROAD_V7_AUDIT_TAB);
    sheet.appendRow(['Waktu','Admin','ID Booking','Baris','Aksi','Referensi Bukti SHA256','Keterangan']);
  }
  sheet.appendRow(entry);
}

/**
 * BOOKING APPROVAL is separate from completed trips and Membership points.
 * R:W are Offroad-only operational fields. No payment or finance writes.
 * A booking MUST NOT be approved from the client's DP/LUNAS selection alone.
 */
function offroadAdminV7ApprovalSheet_(actor) {
  var file=offroadAdminV7Sheet_(actor);
  var header=file.sheet.getRange(5,18,1,6).getDisplayValues()[0];
  var expected=['Status Persetujuan Booking','Waktu Keputusan Booking',
    'Admin Keputusan Booking','Alasan Reject Booking',
    'Jumlah Transfer Terverifikasi','Waktu Transfer Terverifikasi'];
  for(var i=0;i<expected.length;i++)
    if(String(header[i]||'').trim()!==expected[i])
      throw Error('Kolom '+String.fromCharCode(82+i)+' belum siap untuk approval booking Offroad.');
  return file;
}
function offroadAdminV7ApprovalStatus_(row) {
  var s=String(row[17]||'').trim().toUpperCase();
  if(!s)return 'MENUNGGU VERIFIKASI';
  if(['ACC','REJECT'].indexOf(s)>=0)return s;
  throw Error('Status approval booking tidak dikenali; verifikasi dihentikan.');
}
function offroadAdminV7ApprovalRow_(row,number) {
  var booking=offroadAdminV7Row_(row,number);
  if(!booking)return null;
  return {
    row:number,bookingId:booking.bookingId,name:booking.name,tripDate:booking.tripDate,
    units:booking.units,package:booking.package,
    declaredPayment:String(row[9]||''),declaredPaid:offroadAdminV7Currency_(row[11]),
    declaredRemaining:offroadAdminV7Currency_(row[10]),
    approval:offroadAdminV7ApprovalStatus_(row),
    bankVerifiedAmount:offroadAdminV7Currency_(row[21]),
    version:offroadAdminV7Hash_(JSON.stringify(row.slice(1,23)))
  };
}
function offroadAdminV7ListApprovals() {
  var user=offroadAdminV7Identity_();
  var source=offroadAdminV7ApprovalSheet_(user),sheet=source.sheet;
  var last=Math.min(sheet.getLastRow(),OFFROAD_V7_MAX_ROW);
  var count=Math.min(100,Math.max(0,last-OFFROAD_V7_FIRST_ROW+1)),out=[];
  if(count){
    var start=last-count+1;
    var rows=sheet.getRange(start,1,count,23).getValues();
    for(var i=rows.length-1;i>=0;i--){
      var obj=offroadAdminV7ApprovalRow_(rows[i],start+i);
      if(obj)out.push(obj);
    }
  }
  return {business:'offroad',role:user.role,rows:out,pointsIssued:false,
    note:'Approval booking hanya mencatat keputusan Offroad, bukan bukti uang masuk otomatis.'};
}
function offroadAdminV7ReviewBooking(input) {
  var user=offroadAdminV7Identity_();
  if(user.role!=='owner')throw Error('Hanya Owner Offroad dapat ACC atau Reject booking.');
  if(!input||typeof input!=='object'||Array.isArray(input)||
     ['ACC','REJECT'].indexOf(input.action)<0||
     !Number.isInteger(input.row)||input.row<OFFROAD_V7_FIRST_ROW||input.row>OFFROAD_V7_MAX_ROW||
     typeof input.bookingId!=='string'||typeof input.expectedVersion!=='string'||
     !/^[a-f0-9]{64}$/.test(input.expectedVersion))
    throw Error('Permintaan approval tidak valid.');
  var ref=String(input.evidenceReference||'').trim();
  var reason=String(input.reason||'').trim();
  if(ref.length<12||ref.length>160)
    throw Error('Referensi pemeriksaan bank / bukti wajib 12–160 karakter.');
  if(input.confirmedIdentity!==true||input.confirmedBankReview!==true)
    throw Error('Identitas dan mutasi rekening Offroad harus diperiksa secara manual.');
  var isAcc=input.action==='ACC',bankTimestamp=null,confirmedAmount=0;
  if(isAcc){
    if(input.bankCreditConfirmed!==true)
      throw Error('ACC dilarang tanpa bukti uang sudah masuk rekening Offroad.');
    if(!Number.isSafeInteger(input.verifiedAmount)||input.verifiedAmount<=0)
      throw Error('Nominal transfer terverifikasi harus rupiah bulat positif.');
    if(!Number.isSafeInteger(input.verifiedAt)||input.verifiedAt<1600000000||
       input.verifiedAt>Math.floor(Date.now()/1000)+300)
      throw Error('Waktu transfer diverifikasi tidak valid.');
    bankTimestamp=new Date(input.verifiedAt*1000);
    confirmedAmount=input.verifiedAmount;
  }else{
    if(reason.length<8||reason.length>220)
      throw Error('Alasan Reject wajib 8–220 karakter.');
    if(input.bankCreditConfirmed===true||input.verifiedAmount>0)
      throw Error('Ada indikasi transfer sudah masuk: jangan Reject sebelum rekonsiliasi.');
  }
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(25000))throw Error('Sedang ada pemeriksaan lain. Coba kembali.');
  try{
    var source=offroadAdminV7ApprovalSheet_(user),sheet=source.sheet;
    if(input.row>sheet.getLastRow())throw Error('Baris booking tidak ditemukan.');
    var row=sheet.getRange(input.row,1,1,23).getValues()[0];
    var current=offroadAdminV7ApprovalRow_(row,input.row);
    if(!current||current.bookingId!==input.bookingId||current.version!==input.expectedVersion)
      throw Error('Data booking/pembayaran berubah, muat ulang sebelum memutuskan.');
    if(current.approval!=='MENUNGGU VERIFIKASI')
      throw Error('Booking sudah diputuskan. Perubahan memerlukan audit koreksi tersendiri.');
    if(String(row[14]||'').toUpperCase()==='CANCELLED')
      throw Error('Perjalanan sudah dibatalkan, tidak boleh ACC booking.');
    if(isAcc){
      var claimed=String(row[9]||'').trim().toUpperCase();
      // DP can be accepted after actual credited deposit. LUNAS is not proof.
      if(!/^(DP|LUNAS|CUSTOM)(?:\s|$|=)/.test(claimed))
        throw Error('Jenis pembayaran booking tidak dikenali.');
      if(current.declaredPaid===null||current.declaredPaid<=0||
         current.declaredPaid!==confirmedAmount)
        throw Error('Nominal transfer di bank tidak cocok dengan jumlah yang diajukan. Perlu pemeriksaan manual.');
      if(current.declaredRemaining===null||current.declaredRemaining<0)
        throw Error('Sisa pembayaran booking tidak valid.');
    }
    var stamp=new Date(),hash=offroadAdminV7Hash_(ref);
    offroadAdminV7Audit_(source.file,[stamp,user.email,current.bookingId,input.row,
      'BOOKING_'+input.action+'_REQUESTED',hash,'Offroad booking approval requested, no finance write']);
    // R:W ONLY. Never change J (declared payment), K/L (money), N (finance sync).
    sheet.getRange(input.row,18,1,6).setValues([[
      input.action,stamp,user.email,isAcc?'':reason,
      isAcc?confirmedAmount:'',isAcc?bankTimestamp:''
    ]]);
    offroadAdminV7Audit_(source.file,[new Date(),user.email,current.bookingId,input.row,
      'BOOKING_'+input.action+'_COMMITTED',hash,'Offroad R:W only; no finance sync/points issued']);
    return {ok:true,business:'offroad',bookingStatus:input.action,
      pointsIssued:false,financeChanged:false,
      message:isAcc?'Booking berhasil di-ACC setelah transfer terverifikasi.':
        'Booking ditolak dan alasan tersimpan. Tidak ada refund otomatis.'};
  }finally{lock.releaseLock();}
}

function offroadAdminV7Verify(input) {
  var user=offroadAdminV7Identity_();
  if(user.role!=='owner')throw Error('Hanya Owner Offroad yang dapat memverifikasi perjalanan.');
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw Error('Permintaan verifikasi tidak valid.');
  var action=input.action;
  if(action!=='SELESAI'&&action!=='CANCELLED')throw Error('Aksi tidak valid.');
  if(!Number.isInteger(input.row)||input.row<OFFROAD_V7_FIRST_ROW||input.row>OFFROAD_V7_MAX_ROW||
     typeof input.bookingId!=='string'||typeof input.expectedVersion!=='string'||
     !/^[a-f0-9]{64}$/.test(input.expectedVersion))
    throw Error('Identitas booking atau versi pemeriksaan tidak valid.');
  var ref=String(input.evidenceReference||'').trim();
  if(ref.length<12||ref.length>160)
    throw Error('Referensi bukti internal wajib 12 sampai 160 karakter.');
  if(input.confirmedIdentity!==true||input.confirmedTrip!==true||input.confirmedPayment!==true)
    throw Error('Identitas, perjalanan dan bukti pembayaran harus diperiksa secara independen.');
  var completedAt=null;
  if(action==='SELESAI'){
    if(!Number.isSafeInteger(input.completedAt)||input.completedAt<1600000000||
       input.completedAt>Math.floor(Date.now()/1000)+300)
      throw Error('Waktu perjalanan selesai tidak valid.');
    completedAt=new Date(input.completedAt*1000);
  }
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(25000))throw Error('Sedang ada verifikasi lain. Coba kembali.');
  try{
    var data=offroadAdminV7Sheet_(user),sheet=data.sheet;
    if(input.row>sheet.getLastRow())throw Error('Baris booking tidak ditemukan.');
    var row=sheet.getRange(input.row,1,1,23).getValues()[0];
    if(String(row[12]||'').trim()!==input.bookingId||
       offroadAdminV7Version_(row)!==input.expectedVersion)
      throw Error('Booking atau pembayaran telah berubah. Muat ulang dan periksa kembali.');
    var booking=offroadAdminV7Row_(row,input.row);
    if(!booking)throw Error('Booking Offroad tidak valid.');
    if(action==='SELESAI'){
      // A completed trip cannot become Membership-eligible without an approved booking.
      var bookingApproval=offroadAdminV7ApprovalSheet_(user);
      var approvalCell=bookingApproval.sheet.getRange(input.row,18,1,1).getValues()[0][0];
      if(String(approvalCell||'').trim().toUpperCase()!=='ACC')
        throw Error('Booking belum ACC berdasarkan transfer, perjalanan tidak boleh diverifikasi selesai.');
      if(booking.tripStatus==='CANCELLED')
        throw Error('Booking dibatalkan. Periksa pembatalan sebelum mengizinkan penyelesaian.');
      var tripStart=offroadAdminV7TripStart_(row[4]);
      if(tripStart===null||input.completedAt<tripStart)
        throw Error('Perjalanan tidak bisa dinyatakan selesai sebelum tanggal Offroad yang tercatat.');
      var status=String(row[9]||'').trim().toUpperCase();
      var paid=offroadAdminV7Currency_(row[11]);
      var outstanding=offroadAdminV7Currency_(row[10]);
      if(!/^(DP|LUNAS|CUSTOM)(?:\s|$|=)/.test(status)||paid===null||paid<=0||
         outstanding===null)
        throw Error('Pembayaran harus lunas dan bukti transfer diverifikasi Owner.');
      // Never equate a guest's declared DP/LUNAS (J:K:L) with bank receipts.
      // The Offroad-only, immutable staging ledger must show every credit:
      // first DP + separate final settlement, or one verified full payment.
      var money=offroadAdminV7PaymentLedger_(user);
      var settlement=offroadAdminV7LedgerSummary_(money,row,offroadAdminV7LedgerRows_(money.ledger));
      if(!settlement.fullyPaid)
        throw Error('Pembayaran belum lunas berdasarkan ledger bank Offroad, bukan pilihan tamu.');
      if(booking.units<1||booking.units>50)
        throw Error('Jumlah unit Offroad tidak valid.');
      if(booking.tripStatus==='SELESAI'&&booking.paymentVerified)
        throw Error('Perjalanan ini sudah diverifikasi.');
    }else if(booking.tripStatus==='CANCELLED'){
      throw Error('Pembatalan sudah dicatat.');
    }
    var stamp=new Date();
    var proofHash=offroadAdminV7Hash_(ref);
    offroadAdminV7Audit_(data.file,[stamp,user.email,booking.bookingId,input.row,
      action+'_REQUESTED',proofHash,'Owner confirmed source evidence, no financial write']);
    sheet.getRange(input.row,15,1,3).setValues([action==='SELESAI'
      ?['SELESAI',completedAt,stamp]
      :['CANCELLED','', '']]);
    offroadAdminV7Audit_(data.file,[new Date(),user.email,booking.bookingId,input.row,
      action+'_COMMITTED',proofHash,'Offroad O:Q only; membership points not issued']);
    return {ok:true,business:'offroad',tripStatus:action,pointsIssued:false,
      needsMembershipDispatch:true,
      message:'Status Offroad dicatat. Pengiriman bukti ke Membership tetap langkah manual terpisah.'};
  }finally{lock.releaseLock();}
}
function doGet() {
  try{
    offroadAdminV7Identity_();
    return HtmlService.createHtmlOutputFromFile('OffroadAdminV7')
      .setTitle('Offroad Ngarai Kalong · Admin');
  }catch(err){
    return HtmlService.createHtmlOutput('<h1>Akses ditolak</h1><p>Gunakan akun Google Offroad yang telah diizinkan.</p>')
      .setTitle('Offroad Admin · Akses Ditolak');
  }
}
