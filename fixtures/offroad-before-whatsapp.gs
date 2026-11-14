/**
 * OFFROAD Ngarai Kalong | booking paket per unit + anti-duplikat
 * Spreadsheet existing: Formulir Offroad (A:L), ditambah M = ID Booking.
 * Data historis A:L tidak diubah. Tidak ada kuota stok per paket/tanggal.
 * Format baru: tripPackages array dengan satu pilihan paket untuk tiap unit.
 * Pasang Apps Script (deployment /exec lama) SEBELUM upload index.html.
 */
const SPREADSHEET_ID = '17-0kSIPJzfqBs3Y8G4jl5yaV8vAiyhyyulqceV6uGSc';
const SHEET_NAME = 'Formulir Offroad';
const HEADER_ROW = 5;
const FIRST_ROW = 6;
const TIMEZONE = 'Asia/Jakarta';
const BOOKING_ID_COL = 13; // M: ID Booking, untuk proteksi duplikat permanen
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_UNITS_PER_ORDER = 99; // pengaman input, BUKAN batas stok/kuota paket
const PACKAGES = {
  express: { name: 'Kalong Express', price: 700000 },
  classic: { name: 'Sianok Classic', price: 950000 },
  river: { name: 'River Adventure', price: 1200000 }
};

// Setiap Unit N dapat memilih jenis paket yang sama atau berbeda.
// Backend menghitung ulang harga agar nilai dari browser tidak dipercaya.
function normalizeUnitPackages_(data) {
  const hasNewUnits = data.guestUnits !== undefined && data.guestUnits !== null;
  const legacy = !hasNewUnits && data.guestPax !== undefined;
  const rawUnits = legacy ? 1 : data.guestUnits;
  const jumlahUnit = Number(rawUnits);
  if (rawUnits === undefined || rawUnits === null || String(rawUnits).trim() === '' ||
      !Number.isInteger(jumlahUnit) || jumlahUnit < 1 || jumlahUnit > MAX_UNITS_PER_ORDER) {
    throw new Error('Jumlah unit harus 1 sampai ' + MAX_UNITS_PER_ORDER + '.');
  }

  let keys;
  if (data.tripPackages !== undefined && data.tripPackages !== null) {
    // Format baru: tripPackages = ["express", "classic", "river"]
    if (!Array.isArray(data.tripPackages) || data.tripPackages.length !== jumlahUnit) {
      throw new Error('Setiap unit harus memilih satu paket.');
    }
    keys = data.tripPackages.map(key => String(key).trim());
  } else {
    // Kompatibel dengan versi website sebelumnya:
    // satu paket yang sama untuk seluruh unit; guestPax lama = 1 unit.
    const key = String(data.tripPackage || '').trim();
    keys = Array(jumlahUnit).fill(key);
  }

  if (keys.some(key => !Object.prototype.hasOwnProperty.call(PACKAGES, key))) {
    throw new Error('Pilihan paket per unit tidak valid.');
  }
  const totalPrice = keys.reduce((sum, key) => sum + PACKAGES[key].price, 0);
  const packageSummary = keys.map((key, i) =>
    'Unit ' + (i + 1) + ': ' + PACKAGES[key].name).join(' | ');
  return { jumlahUnit, keys, totalPrice, packageSummary, legacy };
}

function doPost(e) {
  let receiptId = '';
  let lock;
  try {
    const data = parseBooking_(e);
    if (data && data.offroadAdminAction) return handleOffroadAdminBridge_(data);
    receiptId = String(data.receiptId || '').trim();
    if (!/^[a-zA-Z0-9_-]{10,80}$/.test(receiptId)) {
      throw new Error('ID booking tidak valid.');
    }

    const name = String(data.guestName || '').trim();
    const whatsapp = String(data.guestWhatsapp || '').trim();
    const dateText = String(data.tripDate || '').trim();
    const notes = String(data.tripNotes || '').trim();
    const paymentType = String(data.payment || '').trim().toUpperCase();
    const config = normalizeUnitPackages_(data);
    const { jumlahUnit, totalPrice, packageSummary, legacy } = config;
    const safePhone = whatsapp.replace(/[\s-]/g, '');

    if (name.length < 2 || name.length > 150) throw new Error('Nama pemesan tidak valid.');
    if (!/^\+?[0-9]{9,16}$/.test(safePhone)) throw new Error('Nomor WhatsApp tidak valid.');
    if (paymentType !== 'DP' && paymentType !== 'LUNAS') {
      throw new Error('Pilihan pembayaran tidak valid.');
    }
    if (notes.length > 500) throw new Error('Catatan terlalu panjang.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) throw new Error('Format tanggal tidak valid.');
    const tripDate = new Date(dateText + 'T12:00:00+07:00');
    if (isNaN(tripDate.getTime()) ||
        Utilities.formatDate(tripDate, TIMEZONE, 'yyyy-MM-dd') !== dateText) {
      throw new Error('Tanggal Offroad tidak valid.');
    }
    if (dateText < Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd')) {
      throw new Error('Tanggal Offroad tidak boleh di masa lalu.');
    }

    const amountPaid = paymentType === 'DP' ? totalPrice / 2 : totalPrice;
    const remaining = totalPrice - amountPaid;
    const paymentLabel = paymentType === 'DP' ? 'DP = ' + formatNumber_(amountPaid) : 'LUNAS';
    const bookingNotes = legacy
      ? 'Tamu: ' + Number(data.guestPax || 1) + ' orang' + (notes ? ' | ' + notes : '')
      : notes;

    lock = LockService.getScriptLock();
    lock.waitLock(30000);
    const cache = CacheService.getScriptCache();
    const cacheKey = 'OFFROAD_' + receiptId;
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('Tab Formulir Offroad tidak ditemukan.');
    validateHeaders_(sheet);
    ensureBookingIdHeader_(sheet);

    // Kunci idempotensi permanen: receiptId tersimpan di kolom M.
    const existing = findExistingId_(sheet, receiptId);
    if (existing) {
      cache.put(cacheKey, 'OK', 21600);
      return json_({ success: true, status: 'OK', duplicate: true,
        receiptId, originalReceiptId: receiptId, insertedAt: existing });
    }
    // Untuk transisi dari deployment lama yang belum menyimpan ID di M.
    if (cache.get(cacheKey) === 'OK') {
      return json_({ success: true, status: 'OK', duplicate: true, receiptId });
    }

    const recent = findRecentDuplicate_(sheet, {
      name, safePhone, dateText, jumlahUnit, packageSummary,
      amountPaid, paymentType, bookingNotes
    });
    if (recent) {
      cache.put(cacheKey, 'OK', 21600);
      return json_({ success: true, status: 'OK', duplicate: true,
        receiptId, originalReceiptId: recent.id || '', insertedAt: recent.row });
    }

    // Isi baris kosong jika tersedia; sisipkan baris untuk menjaga urutan tanggal.
    const slot = findBookingSlot_(sheet, dateText);
    if (slot.insert) sheet.insertRowBefore(slot.row);
    else if (slot.row > sheet.getMaxRows()) {
      sheet.insertRowsAfter(sheet.getMaxRows(), slot.row - sheet.getMaxRows());
    }
    const targetRow = slot.row;
    const dayFormula = '=IF(E' + targetRow + '="";"";CHOOSE(WEEKDAY(E' + targetRow +
      ';1);"Minggu";"Senin";"Selasa";"Rabu";"Kamis";"Jumat";"Sabtu"))';
    const values = [
      0, new Date(), safeText_(name), safePhone, tripDate, dayFormula,
      jumlahUnit, safeText_(packageSummary), safeText_(bookingNotes),
      paymentLabel, remaining, amountPaid, receiptId
    ];
    sheet.getRange(targetRow, 4).setNumberFormat('@');
    sheet.getRange(targetRow, BOOKING_ID_COL).setNumberFormat('@');
    sheet.getRange(targetRow, 1, 1, 13).setValues([values]);
    sheet.getRange(targetRow, 2).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    sheet.getRange(targetRow, 5).setNumberFormat('dd/MM/yyyy');
    sheet.getRange(targetRow, 11, 1, 2).setNumberFormat('"Rp" #,##0');
    SpreadsheetApp.flush();

    cache.put(cacheKey, 'OK', 21600);
    try { renumberBookings_(sheet); }
    catch (error) { console.warn('Penomoran perlu diperiksa: ' + error.message); }

    return json_({ success: true, status: 'OK', duplicate: false,
      receiptId, insertedAt: targetRow, packageSummary, jumlahUnit,
      totalPrice, amountPaid, remaining });
  } catch (error) {
    if (receiptId) {
      try { CacheService.getScriptCache().put('OFFROAD_' + receiptId,
        'ERROR: ' + error.message, 600); } catch (_) {}
    }
    return json_({ success: false, status: 'ERROR', receiptId,
      message: error.message });
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (_) {} }
  }
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  const receiptId = String(params.receiptId || '').trim();
  let status = 'PENDING';
  if (/^[a-zA-Z0-9_-]{10,80}$/.test(receiptId)) {
    status = CacheService.getScriptCache().get('OFFROAD_' + receiptId) || 'PENDING';
    // Cache bisa kedaluwarsa; cek ID permanen untuk memastikan booking tersimpan.
    if (status === 'PENDING' || status.startsWith('ERROR')) {
      try {
        const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
        if (sheet && findExistingId_(sheet, receiptId)) status = 'OK';
      } catch (error) { console.warn('Status lookup: ' + error.message); }
    }
  }
  const result = { receiptId, success: status === 'OK',
    status: status.startsWith('ERROR') ? 'ERROR' : status,
    message: status.startsWith('ERROR') ? status.slice(7) : '' };
  const callback = String(params.callback || '').trim();
  if (/^[a-zA-Z_$][\w$]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(result) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(result);
}

function ensureBookingIdHeader_(sheet) {
  const cell = sheet.getRange(HEADER_ROW, BOOKING_ID_COL);
  const title = String(cell.getDisplayValue() || '').trim();
  if (!title) cell.setValue('ID Booking');
  else if (title.toLowerCase() !== 'id booking') {
    throw new Error('Kolom M sudah digunakan. Periksa M5 sebelum booking baru.');
  }
}

function findExistingId_(sheet, receiptId) {
  const count = sheet.getLastRow() - FIRST_ROW + 1;
  if (count <= 0) return 0;
  const match = sheet.getRange(FIRST_ROW, BOOKING_ID_COL, count, 1)
    .createTextFinder(receiptId).matchEntireCell(true).findNext();
  return match ? match.getRow() : 0;
}

function findRecentDuplicate_(sheet, item) {
  const count = sheet.getLastRow() - FIRST_ROW + 1;
  if (count <= 0) return null;
  // B:M: timestamp, nama, WA, tanggal, hari, unit, paket per unit, catatan, pembayaran, sisa, uang, ID.
  const rows = sheet.getRange(FIRST_ROW, 2, count, 12).getValues();
  const now = Date.now();
  const normalize = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const time = r[0] instanceof Date ? r[0].getTime() : NaN;
    if (!Number.isFinite(time) || time > now + 60000 || now - time > DUPLICATE_WINDOW_MS) continue;
    if (normalize(r[1]) !== normalize(item.name)) continue;
    if (String(r[2] || '').replace(/[\s-]/g, '') !== item.safePhone) continue;
    if (dateKeyFromCell_(r[3]) !== item.dateText) continue;
    if (Number(r[5]) !== item.jumlahUnit) continue;
    if (normalize(r[6]) !== normalize(item.packageSummary)) continue;
    if (normalize(r[7]) !== normalize(item.bookingNotes)) continue;
    const oldType = String(r[8] || '').toUpperCase().startsWith('DP') ? 'DP' : 'LUNAS';
    if (oldType !== item.paymentType || Number(r[10]) !== item.amountPaid) continue;
    return { row: FIRST_ROW + i, id: String(r[11] || '') };
  }
  return null;
}

function findBookingSlot_(sheet, newDateKey) {
  const lastRow = sheet.getLastRow();
  if (lastRow < FIRST_ROW) return { row: FIRST_ROW, insert: false };
  const rows = sheet.getRange(FIRST_ROW, 1, lastRow - FIRST_ROW + 1, 13).getValues();
  let candidateBlank = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNumber = FIRST_ROW + i;
    if (isSummaryRow_(r)) return { row: rowNumber, insert: true };
    const oldDate = dateKeyFromCell_(r[4]);
    const hasBusinessData = Boolean(r[1] || r[2] || r[3] || r[4] || r[7] || r[9] || r[11] || r[12]);
    if (!hasBusinessData) {
      if (!candidateBlank) candidateBlank = rowNumber;
      continue;
    }
    if (oldDate && oldDate > newDateKey) {
      return { row: candidateBlank || rowNumber, insert: !candidateBlank };
    }
    // Jika tanggal lama <= tanggal baru, slot kosong sebelumnya belum cocok.
    if (oldDate) candidateBlank = null;
  }
  return { row: candidateBlank || lastRow + 1, insert: false };
}

function dateKeyFromCell_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, TIMEZONE, 'yyyy-MM-dd');
  }
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return match ? match[3] + '-' + match[2].padStart(2, '0') + '-' + match[1].padStart(2, '0') : '';
}

function isSummaryRow_(row) {
  const marker = /^(TOTAL|GRAND TOTAL|JUMLAH|REKAP)(\s|$)/i;
  const customer = String(row[2] || '').trim();
  return (!customer || marker.test(customer)) && row.some(v => marker.test(String(v || '').trim()));
}

function renumberBookings_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < FIRST_ROW) return;
  const length = lastRow - FIRST_ROW + 1;
  const rows = sheet.getRange(FIRST_ROW, 1, length, 12).getValues();
  const formulas = sheet.getRange(FIRST_ROW, 1, length, 1).getFormulas();
  let counter = 1;
  for (let i = 0; i < rows.length; i++) {
    if (isSummaryRow_(rows[i])) break;
    const r = rows[i];
    if (!(r[1] || r[2] || r[4] || r[7] || r[11])) continue;
    if (!formulas[i][0] && Number(r[0]) !== counter) {
      sheet.getRange(FIRST_ROW + i, 1).setValue(counter);
    }
    counter++;
  }
}

function validateHeaders_(sheet) {
  const headers = sheet.getRange(HEADER_ROW, 1, 1, 12).getDisplayValues()[0];
  const normalize = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const required = {
    2: 'nama pemesan', 3: 'no whatsapp pemesan', 4: 'tanggal offroad',
    6: 'jumlah unit', 7: 'pilih paket', 9: 'lunas/dp',
    10: 'sisa pelunasan', 11: 'jumlah uang'
  };
  for (const index in required) {
    if (normalize(headers[index]) !== required[index]) {
      throw new Error('Judul kolom ' + String.fromCharCode(65 + Number(index)) +
        ' tidak sesuai. Periksa baris 5 Spreadsheet.');
    }
  }
}

function parseBooking_(e) {
  if (e && e.postData && e.postData.contents) {
    const content = e.postData.contents.trim();
    if (content.startsWith('{')) return JSON.parse(content);
  }
  return (e && e.parameter) || {};
}
function safeText_(value) {
  const str = String(value);
  return /^[=+@]/.test(str) ? "'" + str : str;
}
function formatNumber_(value) { return Number(value).toLocaleString('id-ID'); }
function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Aman dijalankan: hanya memeriksa header tanpa menciptakan booking.
function cekKoneksiOffroad() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Tab Formulir Offroad tidak ditemukan.');
  validateHeaders_(sheet);
  const title = String(sheet.getRange(HEADER_ROW, BOOKING_ID_COL).getDisplayValue() || '').trim();
  if (title && title.toLowerCase() !== 'id booking') throw new Error('M5 sudah berisi judul lain: ' + title);
  console.log('Header A:L OK; M5 kosong atau ID Booking; multi-paket per unit siap; tanpa menulis data.');
  return 'KONFIGURASI OFFROAD PAKET PER UNIT OK';
}

/**
 * OFFROAD ADMIN V1 - APPEND TO EXISTING V3 Code.gs.
 *
 * IMPORTANT: In the existing doPost(e), immediately after:
 *   const data = parseBooking_(e);
 * add exactly this line:
 *   if (data && data.offroadAdminAction) return handleOffroadAdminBridge_(data);
 *
 * Set Script Property OFFROAD_ADMIN_SOURCE_KEY with a randomly generated secret
 * of 32+ characters. Set the SAME value as Cloudflare Worker secret
 * OFFROAD_ADMIN_SOURCE_KEY. Never put the secret in index.html.
 *
 * Keep the original doPost, doGet, booking code and deployment /exec URL.
 */
const OFFROAD_ADMIN_FINANCE_TAB = 'Data Keuangan Offroad';
const OFFROAD_ADMIN_FINANCE_FIRST = 9;
const OFFROAD_ADMIN_FINANCE_LAST = 1001;
const OFFROAD_ADMIN_FINANCE_MARKER = 13;

function offroadAdminNumber_(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const str=String(v||'').replace(/Rp/gi,'').replace(/\s/g,'');
  if (!str) return 0;
  // For localized display '3.000.000,00', discard comma decimals.
  const cleaned=str.split(',')[0].replace(/\./g,'');
  return /^\d+$/.test(cleaned)?Number(cleaned):NaN;
}
function offroadAdminDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime()))return Utilities.formatDate(v,TIMEZONE,'yyyy-MM-dd');
  const s=String(v||'').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m?m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'):'';
}
function offroadAdminSafeStr_(v) {
  const s=String(v==null?'':v).trim();
  return /^[=+@]/.test(s)?"'"+s:s;
}
function offroadAdminEquals_(a,b) {
  if(a.length!==b.length)return false;
  let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);
  return n===0;
}
function handleOffroadAdminBridge_(data) {
  const secret=String(PropertiesService.getScriptProperties().getProperty('OFFROAD_ADMIN_SOURCE_KEY')||'');
  const provided=String(data.key||'');
  if(secret.length<32||!offroadAdminEquals_(provided,secret))return json_({status:'ERROR',message:'Akses konektor ditolak.'});
  const action=String(data.offroadAdminAction||''),payload=data.payload||{};
  try {
    const ss=SpreadsheetApp.openById(SPREADSHEET_ID);
    if(action==='snapshot')return json_(offroadAdminSnapshot_(ss));
    if(action==='post_payment')return json_(offroadAdminPostPayment_(ss,payload));
    return json_({status:'ERROR',message:'Aksi tidak diizinkan.'});
  }catch(err){
    console.error('Offroad admin bridge:',String(err.message||err));
    return json_({status:'ERROR',message:String(err.message||'Gagal memproses konektor.').slice(0,180)});
  }
}
function offroadAdminSnapshot_(ss) {
  const bs=ss.getSheetByName(SHEET_NAME),fs=ss.getSheetByName(OFFROAD_ADMIN_FINANCE_TAB);
  if(!bs||!fs)throw Error('Tab booking/keuangan tidak ditemukan.');
  const bookings=[];
  if(bs.getLastRow()>=FIRST_ROW){
    const values=bs.getRange(FIRST_ROW,1,bs.getLastRow()-FIRST_ROW+1,13).getValues();
    values.forEach(r=>{
      const id=String(r[12]||'').trim();
      // Historical manually entered rows have no permanent booking ID;
      // they remain untouched and are not actionable in Dashboard V1.
      if(!/^[a-zA-Z0-9_-]{10,80}$/.test(id))return;
      const amount=offroadAdminNumber_(r[11]),remaining=offroadAdminNumber_(r[10]);
      const units=Number(r[6]),date=offroadAdminDate_(r[4]);
      if(!Number.isSafeInteger(amount)||amount<0||!Number.isSafeInteger(remaining)||remaining<0)return;
      if(!Number.isSafeInteger(units)||units<1||units>99||!date)return;
      bookings.push({
        id,name:String(r[2]||''),phone:String(r[3]||''),date,
        units,packages:String(r[7]||''),notes:String(r[8]||''),
        paymentChoice:String(r[9]||''),
        reportedAmount:amount,outstanding:remaining,totalPrice:amount+remaining,
        createdAt:r[1] instanceof Date?r[1].toISOString():''
      });
    });
  }
  const count=OFFROAD_ADMIN_FINANCE_LAST-OFFROAD_ADMIN_FINANCE_FIRST+1;
  const income=fs.getRange(OFFROAD_ADMIN_FINANCE_FIRST,3,count,4).getValues();
  const expenses=fs.getRange(OFFROAD_ADMIN_FINANCE_FIRST,9,count,4).getValues();
  let totalIn=0,totalOut=0,inCount=0,outCount=0;
  const recent=[];
  income.forEach((r,i)=>{
    const amount=offroadAdminNumber_(r[3]);
    if(!Number.isSafeInteger(amount)||!r[0]||!r[1]||!r[2])return;
    totalIn+=amount;inCount++;
    recent.push({date:offroadAdminDate_(r[0]),description:String(r[1]).slice(0,180),kind:'Pemasukan',amount,row:i+OFFROAD_ADMIN_FINANCE_FIRST});
  });
  expenses.forEach(r=>{
    const amount=offroadAdminNumber_(r[3]);
    if(!Number.isSafeInteger(amount)||!r[0]||!r[1]||!r[2])return;
    totalOut+=amount;outCount++;
  });
  return {status:'OK',bookings,finance:{
    income:totalIn,expenses:totalOut,net:totalIn-totalOut,incomeCount:inCount,expenseCount:outCount,
    recent:recent.slice(-30).reverse()
  }};
}
function offroadAdminPostPayment_(ss,payload) {
  const id=String(payload.bookingId||''),paymentId=String(payload.paymentId||'');
  const amount=Number(payload.amount),kind=String(payload.kind||'');
  const reference=String(payload.reference||'');
  const verifiedAt=Number(payload.verifiedAt);
  if(!/^[a-zA-Z0-9_-]{10,80}$/.test(id)||!/^offroad-payment:[a-f0-9-]{36}$/.test(paymentId)||
     !Number.isSafeInteger(amount)||amount<=0||!['dp','settlement'].includes(kind)||
     reference.trim().length<10||reference.length>180||!Number.isSafeInteger(verifiedAt)||
     verifiedAt<1577836800||verifiedAt>Math.floor(Date.now()/1000)+300)throw Error('Detail verifikasi pembayaran tidak valid.');
  const bs=ss.getSheetByName(SHEET_NAME),fs=ss.getSheetByName(OFFROAD_ADMIN_FINANCE_TAB);
  if(!bs||!fs)throw Error('Tab sumber tidak ditemukan.');
  // Never post verified income while the previous guest-declared sync is active.
  if(ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='syncKeuanganOffroadOtomatis'))
    throw Error('Nonaktifkan trigger syncKeuanganOffroadOtomatis lama sebelum menulis keuangan.');
  const bookingRow=findExistingId_(bs,id);if(!bookingRow)throw Error('Booking ID tidak ditemukan di Sheets.');
  const header=String(fs.getRange('M6').getDisplayValue()).trim();
  if(header && header!=='ID Pembayaran')throw Error('M6 sudah dipakai untuk data lain.');
  const marker='OFFROADPAY|'+id+'|'+paymentId;
  const count=OFFROAD_ADMIN_FINANCE_LAST-OFFROAD_ADMIN_FINANCE_FIRST+1;
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    if(!header)fs.getRange('M6').setValue('ID Pembayaran');
    const markers=fs.getRange(OFFROAD_ADMIN_FINANCE_FIRST,OFFROAD_ADMIN_FINANCE_MARKER,count,1).getValues();
    const data=fs.getRange(OFFROAD_ADMIN_FINANCE_FIRST,3,count,4).getValues();
    let row=-1,duplicate=false;
    for(let i=0;i<count;i++){
      if(String(markers[i][0]||'')===marker){row=OFFROAD_ADMIN_FINANCE_FIRST+i;duplicate=true;break;}
    }
    if(duplicate){
      const old=data[row-OFFROAD_ADMIN_FINANCE_FIRST];
      if(old[0]&&String(old[2])==='Pemasukan'&&offroadAdminNumber_(old[3])===amount)
        return {status:'OK',duplicate:true,row};
      if(old.some(x=>x!==''&&x!==null))throw Error('ID pembayaran sama tetapi data berbeda.');
    }
    if(!duplicate){
      for(let i=0;i<count;i++){
        if(markers[i][0])continue;
        const empty=data[i].every(x=>x===''||x===null);
        if(empty){row=OFFROAD_ADMIN_FINANCE_FIRST+i;break;}
      }
    }
    if(row<0)throw Error('Slot C9:F1001 keuangan sudah penuh.');
    const r=bs.getRange(bookingRow,3,1,10).getValues()[0];
    const name=String(r[0]||''),packages=String(r[5]||'');
    const label=kind==='dp'?'DP':'Pelunasan';
    const description=offroadAdminSafeStr_('('+label+') '+name+' | '+packages+' | '+id+' | Ref '+reference);
    fs.getRange(row,OFFROAD_ADMIN_FINANCE_MARKER).setValue(marker);
    fs.getRange(row,3,1,4).setValues([[new Date(verifiedAt*1000),description,'Pemasukan',amount]]);
    fs.getRange(row,3).setNumberFormat('dd/MM/yyyy');
    fs.getRange(row,6).setNumberFormat('"Rp" #,##0');
    SpreadsheetApp.flush();
    return {status:'OK',duplicate:false,row};
  }finally{lock.releaseLock();}
}
function cekKoneksiAdminOffroadV1(){
  const key=String(PropertiesService.getScriptProperties().getProperty('OFFROAD_ADMIN_SOURCE_KEY')||'');
  if(key.length<32)throw Error('Script Property OFFROAD_ADMIN_SOURCE_KEY minimal 32 karakter belum diisi.');
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID);
  if(!ss.getSheetByName(SHEET_NAME)||!ss.getSheetByName(OFFROAD_ADMIN_FINANCE_TAB))throw Error('Tab Sheets tidak lengkap.');
  const triggers=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='syncKeuanganOffroadOtomatis');
  if(triggers.length)throw Error('Masih ada trigger syncKeuanganOffroadOtomatis lama. Nonaktifkan agar pemasukan tidak dobel.');
  console.log('Bridge Offroad siap: baca booking + pemasukan hanya setelah pembayaran diverifikasi.');
  return 'OFFROAD_ADMIN_BRIDGE_READY';
}