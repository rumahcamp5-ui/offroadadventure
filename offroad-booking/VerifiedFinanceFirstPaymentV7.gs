/**
 * Read-only guard proposal for the existing OFFROAD booking Apps Script.
 * NOT INSTALLED OR CALLED BY LIVE FINANCE. Designed for a separately
 * reviewed migration of the existing offroadAdminPostPayment_.
 *
 * IMPORTANT:
 * - This gate only authorizes the *first* bank-verified booking payment.
 * - A DP's later settlement needs its own immutable bank verification and
 *   idempotent ledger; never reuse the first deposit timestamp/amount.
 * - This does not disable any old finance trigger in another Apps Script
 *   project. The user must separately inventory all triggers first.
 */
function offroadV7MoneyGate_(value) {
  if(typeof value==='number')
    return Number.isSafeInteger(value)&&value>=0?value:null;
  const s=String(value==null?'':value).trim().replace(/^Rp\s*/i,'').replace(/\s/g,'');
  if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(s))return null;
  const amount=Number(s.replace(/\./g,''));
  return Number.isSafeInteger(amount)&&amount>=0?amount:null;
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} bookingSheet Offroad booking Sheet
 * @param {number} rowNumber exact booking row, acquired by canonical booking ID
 * @param {{kind:string,amount:number,verifiedAt:number}} payment supplied by
 * an independently authenticated backend, never a public booking form.
 * @returns {{allowed:boolean,source:"offroad",paymentType:string}}
 *
 * This function NEVER writes booking, finance, R:W, or points.
 */
function offroadV7CheckFirstPaymentForFinance_(bookingSheet,rowNumber,payment) {
  if(!Number.isInteger(rowNumber)||rowNumber<6||rowNumber>1006)
    throw Error('Baris Offroad tidak valid.');
  if(!payment||typeof payment!=='object'||Array.isArray(payment))
    throw Error('Bukti pembayaran tidak valid.');
  if(!Number.isSafeInteger(payment.amount)||payment.amount<=0||
     !Number.isSafeInteger(payment.verifiedAt)||payment.verifiedAt<1577836800||
     payment.verifiedAt>Math.floor(Date.now()/1000)+300)
    throw Error('Nominal atau waktu transaksi tidak valid.');
  const headers=bookingSheet.getRange(5,18,1,6).getDisplayValues()[0];
  const expected=['Status Persetujuan Booking','Waktu Keputusan Booking',
    'Admin Keputusan Booking','Alasan Reject Booking',
    'Jumlah Transfer Terverifikasi','Waktu Transfer Terverifikasi'];
  if(headers.some((v,i)=>String(v||'').trim()!==expected[i]))
    throw Error('Header R:W persetujuan Offroad belum siap.');
  const r=bookingSheet.getRange(rowNumber,10,1,14).getValues()[0];
  // J:W = choice, planned outstanding, planned deposit, booking ID,
  // finance-sync status, trip status, trip timestamps, ACC, decision at,
  // approving staff, rejection reason, bank credit amount, bank credit time.
  const paymentChoice=String(r[0]||'').trim().toUpperCase();
  const plannedOutstanding=offroadV7MoneyGate_(r[1]);
  const plannedFirst=offroadV7MoneyGate_(r[2]);
  const approval=String(r[8]||'').trim().toUpperCase();
  const verifiedBankAmount=offroadV7MoneyGate_(r[12]);
  const verifiedBankAt=r[13] instanceof Date&&isFinite(r[13].getTime())
    ?Math.floor(r[13].getTime()/1000):null;
  const approvedAt=r[9];
  const approvedBy=String(r[10]||'').trim();
  const reference=String(r[3]||'').trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9:._-]{5,99}$/.test(reference))
    throw Error('Booking tanpa ID permanen tidak dapat disinkronkan.');
  if(approval!=='ACC'||!(approvedAt instanceof Date)||!isFinite(approvedAt.getTime())||
     !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(approvedBy))
    throw Error('Booking belum di-ACC Owner setelah bukti transfer diperiksa.');
  const isDp=/^DP(?:\s|$|=)/.test(paymentChoice);
  const isFull=paymentChoice==='LUNAS';
  if(!isDp&&!isFull)throw Error('Jenis pembayaran tidak didukung guard tahap pertama.');
  if(payment.kind!==(isDp?'dp':'settlement'))
    throw Error('Jenis transaksi bukan pembayaran pertama booking ini; pelunasan DP butuh ledger kedua.');
  if(plannedFirst===null||plannedFirst<=0||
     plannedOutstanding===null||verifiedBankAmount===null||
     plannedFirst!==payment.amount||verifiedBankAmount!==payment.amount||
     verifiedBankAt===null||payment.verifiedAt!==verifiedBankAt)
    throw Error('Bukti uang masuk tidak cocok dengan nominal/waktu ACC booking.');
  if(isFull&&plannedOutstanding!==0)
    throw Error('Booking LUNAS harus mencatat sisa awal nol.');
  if(isDp&&plannedOutstanding<=0)
    throw Error('Booking DP harus menyimpan sisa pembayaran yang belum terverifikasi.');
  return {allowed:true,source:'offroad',paymentType:isDp?'DP':'LUNAS'};
}
