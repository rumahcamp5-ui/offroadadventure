/**
 * OFFROAD ADMIN V7 | independently verified payment ledger — STAGING ONLY.
 *
 * This additional .gs file belongs to the NEW standalone Offroad Admin
 * Apps Script project, never the existing public booking /exec receiver.
 * It only appends to OFFROAD V7 PAYMENT LEDGER in the synthetic staging
 * spreadsheet already hard-locked by offroadAdminV7ApprovalSheet_().
 *
 * Does NOT write A:W booking/finance, Data Keuangan Offroad, Rumah Camp,
 * external Workers, actual cash, refunds, or Membership points.
 */
var OFFROAD_V7_LEDGER_TAB='OFFROAD V7 PAYMENT LEDGER';
var OFFROAD_V7_LEDGER_HEADERS=[
 'ID Booking','ID Pembayaran','Jenis Pembayaran','Jumlah Terverifikasi',
 'Waktu Transfer','Hash Referensi Bank','Diverifikasi Oleh',
 'Waktu Pencatatan','Status Ledger','Sumber'
];
var OFFROAD_V7_LEDGER_ROW_LIMIT=2500;

function offroadAdminV7PaymentLedger_(actor) {
  var data=offroadAdminV7ApprovalSheet_(actor);
  var ledger=data.file.getSheetByName(OFFROAD_V7_LEDGER_TAB);
  if(!ledger)throw Error('Ledger pembayaran Offroad staging belum tersedia.');
  var headings=ledger.getRange(1,1,1,10).getDisplayValues()[0];
  for(var i=0;i<OFFROAD_V7_LEDGER_HEADERS.length;i++)
    if(String(headings[i]||'').trim()!==OFFROAD_V7_LEDGER_HEADERS[i])
      throw Error('Header ledger pembayaran staging tidak sesuai di kolom '+(i+1)+'.');
  return {book:data.sheet,ledger:ledger};
}
function offroadAdminV7BankUnix_(date) {
  if(!(date instanceof Date)||!isFinite(date.getTime()))return null;
  return Math.floor(date.getTime()/1000);
}
function offroadAdminV7LedgerRows_(sheet) {
  var last=sheet.getLastRow();
  if(last>OFFROAD_V7_LEDGER_ROW_LIMIT)throw Error('Batas ledger staging terlampaui.');
  if(last<2)return [];
  var values=sheet.getRange(2,1,last-1,10).getValues(),result=[],ids={},proofs={};
  for(var i=0;i<values.length;i++) {
    var r=values[i],id=String(r[0]||''),paymentId=String(r[1]||'');
    var kind=String(r[2]||''),amount=r[3],when=offroadAdminV7BankUnix_(r[4]);
    var hash=String(r[5]||''),owner=String(r[6]||'');
    if(!/^[A-Za-z0-9][A-Za-z0-9:._-]{5,99}$/.test(id)||
       !/^OFFROADV7-[a-f0-9]{32}$/.test(paymentId)||
       ['DP','LUNAS','PELUNASAN'].indexOf(kind)<0||
       !Number.isSafeInteger(amount)||amount<=0||when===null||
       !/^[a-f0-9]{64}$/.test(hash)||
       !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner)||
       offroadAdminV7BankUnix_(r[7])===null||
       r[8]!=='VERIFIED_STAGING'||r[9]!=='OFFROAD_STAGING')
      throw Error('Data ledger staging baris '+(i+2)+' tidak valid; transaksi diblokir.');
    if(ids[paymentId]||proofs[hash])
      throw Error('Ledger staging punya duplikasi bukti atau ID pembayaran.');
    ids[paymentId]=true;proofs[hash]=true;
    result.push({bookingId:id,paymentId:paymentId,kind:kind,amount:amount,
      verifiedAt:when,proofHash:hash,verifiedBy:owner});
  }
  return result;
}
function offroadAdminV7LedgerSummary_(source,bookingRow,existing) {
  var id=String(bookingRow[12]||'').trim(),paid=offroadAdminV7Currency_(bookingRow[11]);
  var outstanding=offroadAdminV7Currency_(bookingRow[10]);
  if(paid===null||paid<=0||outstanding===null||
     !Number.isSafeInteger(paid+outstanding))
    throw Error('Nominal rencana booking tidak valid.');
  var record=existing.filter(function(x){return x.bookingId===id;});
  var first=record.filter(function(x){return x.kind==='DP'||x.kind==='LUNAS';});
  var settlement=record.filter(function(x){return x.kind==='PELUNASAN';});
  if(first.length>1||settlement.length>1)
    throw Error('Duplikasi tahap pembayaran dalam ledger Offroad.');
  var firstItem=first[0]||null,secondItem=settlement[0]||null;
  var status=String(bookingRow[9]||'').trim().toUpperCase();
  var isDp=/^DP(?:\s|$|=)/.test(status);
  var isFull=status==='LUNAS'||(status==='CUSTOM'&&outstanding===0);
  if(!isDp&&!isFull)throw Error('Jenis pembayaran booking belum didukung ledger.');
  if(firstItem) {
    if(firstItem.kind!==(isDp?'DP':'LUNAS')||firstItem.amount!==paid)
      throw Error('Pembayaran pertama ledger tidak cocok dengan booking.');
    var bankAmount=offroadAdminV7Currency_(bookingRow[21]);
    var bankTime=offroadAdminV7BankUnix_(bookingRow[22]);
    if(firstItem.amount!==bankAmount||firstItem.verifiedAt!==bankTime)
      throw Error('Pembayaran pertama tidak cocok dengan keputusan ACC dan bukti bank.');
  }
  if(secondItem&&(!isDp||!firstItem||secondItem.amount!==outstanding||
     secondItem.verifiedAt<firstItem.verifiedAt))
    throw Error('Pelunasan ledger tidak cocok dengan DP awal.');
  var total=(firstItem?firstItem.amount:0)+(secondItem?secondItem.amount:0);
  if(total>paid+outstanding)throw Error('Jumlah pembayaran melebihi harga booking.');
  return {bookingId:id,firstVerified:Boolean(firstItem),settlementVerified:Boolean(secondItem),
    paidVerified:total,outstandingVerified:paid+outstanding-total,expectedTotal:paid+outstanding,
    fullyPaid:Boolean(firstItem&&(isFull||Boolean(secondItem))&&total===paid+outstanding),
    isDp:isDp};
}
/** Read-only summary for one approved/pending booking. */
function offroadAdminV7PaymentSummary(rowNumber,bookingId) {
  var actor=offroadAdminV7Identity_(),data=offroadAdminV7PaymentLedger_(actor);
  if(!Number.isInteger(rowNumber)||rowNumber<6||rowNumber>1006)
    throw Error('Baris Offroad tidak valid.');
  var row=data.book.getRange(rowNumber,1,1,23).getValues()[0];
  if(String(row[12]||'').trim()!==bookingId)
    throw Error('ID booking sudah berubah. Muat ulang dahulu.');
  var summary=offroadAdminV7LedgerSummary_(data,row,offroadAdminV7LedgerRows_(data.ledger));
  return {business:'offroad',role:actor.role,payment:summary,
    financeChanged:false,pointsIssued:false};
}

/**
 * Two-step staged bank evidence ledger.
 *
 * First payment: EXACT previously approved R-W amount and bank timestamp.
 * DP settlement: independently checked second transfer, exactly K, later bank
 * timestamp and distinct bank reference. Never reuses the DP transaction.
 *
 * UI caller supplies a bank reference verified against Offroad bank by Owner.
 * Hash only stored; no raw reference or sensitive bank data in Sheet.
 */
function offroadAdminV7RecordVerifiedPayment(input) {
  var actor=offroadAdminV7Identity_();
  if(actor.role!=='owner')throw Error('Hanya Owner Offroad yang boleh mencatat pembayaran.');
  if(!input||typeof input!=='object'||Array.isArray(input)||
     !Number.isInteger(input.row)||input.row<6||input.row>1006||
     typeof input.bookingId!=='string'||!['PERTAMA','PELUNASAN'].includes(input.stage)||
     typeof input.expectedVersion!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedVersion)||
     input.confirmedIdentity!==true||input.confirmedBankCredit!==true||
     input.confirmedNoRefund!==true)
    throw Error('Identitas, versi, dan verifikasi bank belum lengkap.');
  var amount=input.verifiedAmount,at=input.verifiedAt,reference=String(input.bankReference||'').trim();
  if(!Number.isSafeInteger(amount)||amount<=0||
     !Number.isSafeInteger(at)||at<1577836800||at>Math.floor(Date.now()/1000)+300||
     reference.length<12||reference.length>160)
    throw Error('Jumlah, waktu atau referensi bank tidak valid.');
  var proofHash=offroadAdminV7Hash_(reference);
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(25000))throw Error('Ada transaksi Offroad lain sedang diperiksa.');
  try {
    var data=offroadAdminV7PaymentLedger_(actor);
    if(input.row>data.book.getLastRow())throw Error('Booking tidak ditemukan.');
    var row=data.book.getRange(input.row,1,1,23).getValues()[0];
    var booking=offroadAdminV7ApprovalRow_(row,input.row);
    if(!booking||booking.bookingId!==input.bookingId||
       booking.version!==input.expectedVersion)
      throw Error('Booking berubah sejak dibuka. Muat ulang terlebih dahulu.');
    if(booking.approval!=='ACC'||String(row[14]||'').trim().toUpperCase()==='CANCELLED')
      throw Error('Booking belum ACC atau sudah dibatalkan.');
    if(!(row[18] instanceof Date)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row[19]||'')))
      throw Error('Persetujuan Owner Offroad tidak valid.');
    var previous=offroadAdminV7LedgerRows_(data.ledger);
    var summary=offroadAdminV7LedgerSummary_(data,row,previous);
    var kind=input.stage==='PERTAMA'?(summary.isDp?'DP':'LUNAS'):'PELUNASAN';
    var own=previous.filter(function(x){return x.bookingId===booking.bookingId;});
    var existing=own.find(function(x){return x.kind===kind;});
    if(existing) {
      if(existing.amount===amount&&existing.verifiedAt===at&&existing.proofHash===proofHash)
        return {ok:true,duplicate:true,kind:kind,bookingId:booking.bookingId,
          financeChanged:false,pointsIssued:false};
      throw Error('Tahap pembayaran sudah tercatat; koreksi perlu rekonsiliasi terpisah.');
    }
    if(previous.some(function(x){return x.proofHash===proofHash;}))
      throw Error('Referensi bank sudah digunakan oleh pembayaran lain.');
    if(input.stage==='PERTAMA') {
      if(summary.firstVerified||amount!==booking.declaredPaid||
         amount!==booking.bankVerifiedAmount||
         offroadAdminV7BankUnix_(row[22])!==at)
        throw Error('Pembayaran pertama tidak cocok dengan bukti transfer ACC.');
      if(summary.isDp&&booking.declaredRemaining<=0)
        throw Error('Booking DP tidak memiliki sisa pelunasan.');
      if(!summary.isDp&&booking.declaredRemaining!==0)
        throw Error('Pembayaran LUNAS wajib memiliki sisa nol.');
    }else {
      var first=own.find(function(x){return x.kind==='DP';});
      if(!summary.isDp||!first||summary.settlementVerified)
        throw Error('Pelunasan DP membutuhkan pembayaran pertama terverifikasi dan belum pernah dicatat.');
      if(amount!==booking.declaredRemaining||at<first.verifiedAt||
         amount!==summary.outstandingVerified)
        throw Error('Pelunasan tidak cocok dengan sisa DP dan waktu transfer kedua.');
    }
    var paymentId='OFFROADV7-'+offroadAdminV7Hash_(
      booking.bookingId+'|'+kind+'|'+proofHash).slice(0,32);
    if(data.ledger.getLastRow()>=OFFROAD_V7_LEDGER_ROW_LIMIT)
      throw Error('Ledger simulasi sudah penuh.');
    data.ledger.appendRow([booking.bookingId,paymentId,kind,amount,
      new Date(at*1000),proofHash,actor.email,new Date(),
      'VERIFIED_STAGING','OFFROAD_STAGING']);
    return {ok:true,duplicate:false,kind:kind,bookingId:booking.bookingId,
      financeChanged:false,pointsIssued:false,
      message:'Bukti pembayaran tersimpan di ledger simulasi Offroad. Belum diposting ke keuangan.'};
  }finally{lock.releaseLock();}
}
