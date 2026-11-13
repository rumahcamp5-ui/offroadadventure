# Offroad Admin V7: release online tanpa data dummy

**Status: KANDIDAT PRODUKSI DI PR DRAFT, BUKAN DEPLOY AKTIF.** Kode khusus online berada dalam folder `offroad-production/`. Berkas dari `offroad-admin/` adalah **staging** dan tidak boleh dicampur saat produksi.

## Sistem online yang diperiksa (13 November 2026)

- Spreadsheet resmi Offroad berjudul **OFFROAD** di akun **Offroad Adventure**. Zona waktu `Asia/Jakarta`.
- Tab `Formulir Offroad` memiliki header booking asli baris 5 kolom **A–N**. Pada 13 Nov 2026, header **O–W** sudah ditambahkan secara additive langsung ke Sheet Offroad asli setelah backup, dan baris data O–W tetap kosong. Tidak ada booking dummy yang disalin atau data A–N yang diedit.
- Tab `Data Keuangan Offroad` berisi laporan nyata. Data pembayaran lama termasuk sejumlah nilai/formula di kolom M:N yang **tidak boleh ditimpa**.
- Kode booking `doPost` lama menghitung J/K/L langsung dari DP/LUNAS yang dipilih tamu, **bukan bukti uang sudah masuk rekening**.
- Implementasi `syncKeuanganOffroadOtomatis` belum ditemukan pada `Code.gs` yang dikirim. Owner menunjukkan log **Script function not found** dari project Booking, lalu **melaporkan sudah menghapus pemicu rusak tersebut**. Ini belum membuktikan tidak ada trigger terkait di project Apps Script lain atau integrasi pihak ketiga. Jangan nyalakan sistem posting otomatis sampai audit ini selesai.
- Website `index.html` dan Apps Script endpoint booking publik sengaja **tidak diubah**. Balasan simpan booking `OK` tetap berarti form tersimpan, **bukan** admin ACC.

## Perubahan aman yang sudah dilakukan di Spreadsheet asli

- Backup penuh: https://docs.google.com/spreadsheets/d/1dHvMohTN5YuoJfnPXj8512gELpEwOBbdXXRwx_kRnEs/edit
- Formulir Offroad O5:W5 terpasang dengan header, dropdown persetujuan/perjalanan, dan format timestamp/rupiah. Data booking lama dan kolom keuangan tidak diubah.
- Tab OFFROAD V7 PAYMENT LEDGER dibuat dengan header A1:J1 dan tanpa entri pembayaran. **Jangan input data manual tanpa alur verifikasi Owner.**

## Source produksi (tanpa dummy)

1. `Code.gs`: dashboard khusus Offroad yang menggunakan **Google active-user identity** dan allowlist Owner/Viewer; hanya menerima mode `production`, nama Sheet `OFFROAD`, dan **SHA-256 fingerprint ID spreadsheet resmi** tanpa mencantumkan ID mentah di GitHub.
2. `OffroadPaymentsV7.gs`: ledger dua-tahap DP/pelunasan dengan ID pembayaran, jumlah dan tanggal transfer, hash bukti bank, anti-duplikat, serta Owner-only. **Hanya menulis ledger Offroad, bukan Data Keuangan Offroad.**
3. `OffroadAdminV7.html`: tampilan admin yang membaca booking **asli** dan menandai nominal J/K/L sebagai **pilihan/rencana pelanggan**, bukan pemasukan terverifikasi. Tombol ACC/Reject/verifikasi/pembayaran **tersembunyi/dinonaktifkan** sebelum izin tulis nyata diberikan.
4. `appsscript.json`: scope spreadsheet dan email login untuk project Admin Offroad **yang terpisah dari endpoint booking**.

### Pengaman ganda (default SEMUA TULISAN DITOLAK)

Di Script Properties project Admin Offroad baru, wajib isi:

| Script Property | Nilai awal |
| --- | --- |
| `OFFROAD_ADMIN_V7_MODE` | `production` |
| `OFFROAD_ADMIN_V7_SPREADSHEET_ID` | ID spreadsheet **OFFROAD asli**, set privat di Apps Script saja |
| `OFFROAD_ADMIN_V7_OWNER_EMAILS` | Email Owner Offroad yang berwenang (comma-separated) |
| `OFFROAD_ADMIN_V7_VIEWER_EMAILS` | Email staf baca-saja (opsional) |
| `OFFROAD_ADMIN_V7_FINANCE_TRIGGER_AUDITED` | `NO` sampai audit seluruh project/trigger selesai |
| `OFFROAD_ADMIN_V7_WRITE_ENABLED` | `NO` sampai release disetujui Owner |

**Jangan ubah dua switch terakhir menjadi YES untuk mengatasi error.** Tanpa keduanya persis `YES`, Owner pun hanya bisa baca. Viewer selalu read-only. Ketika admin membuka website, badge Owner menunjukkan **HANYA BACA** sampai benar-benar siap.

### Syarat penting sebelum memasang dan mengaktifkan

1. **Backup** spreadsheet Offroad asli di akun Offroad (backup mengandung data pribadi, batasi akses). Inventaris semua Apps Script project yang bisa mengubah Sheet dan fungsi trigger sinkronisasi keuangan.
2. Audit `syncKeuanganOffroadOtomatis` dan alur `offroadAdminPostPayment_`, termasuk sumber `paymentId` serta apakah pemrosesan menganggap L sebagai uang nyata. Nonaktifkan/perbaiki otomatisasi lama **hanya setelah ada rencana rollback**. Jangan menambah sumber pemasukan ganda.
3. **SUDAH DILAKUKAN pada 13 Nov 2026:** menambah header baru (baris 5) di Sheet Offroad asli setelah backup dan memastikan O:W kosong, tanpa mengubah A:N:
   - O `Status Perjalanan`
   - P `Tanggal Selesai`
   - Q `Pembayaran Diverifikasi`
   - R `Status Persetujuan Booking`
   - S `Waktu Keputusan Booking`
   - T `Admin Keputusan Booking`
   - U `Alasan Reject Booking`
   - V `Jumlah Transfer Terverifikasi`
   - W `Waktu Transfer Terverifikasi`
4. **SUDAH DILAKUKAN:** membuat tab baru `OFFROAD V7 PAYMENT LEDGER` **kosong** di spreadsheet Offroad asli (tanpa menyalin booking dummy). Header kolom A:J persis:
   `ID Booking`, `ID Pembayaran`, `Jenis Pembayaran`,
   `Jumlah Terverifikasi`, `Waktu Transfer`, `Hash Referensi Bank`,
   `Diverifikasi Oleh`, `Waktu Pencatatan`, `Status Ledger`, `Sumber`.
   Tab `OFFROAD V7 AUDIT` bisa dibuat otomatis pada keputusan pertama; atur akses edit hanya untuk Owner yang diizinkan.
5. Buat **project Apps Script baru khusus Admin Offroad**. Copy **seluruh 4 file dari folder ini saja**. Jangan timpa `Code.gs` booking lama atau `doPost` publik. Deploy Web app: **Execute as User accessing the web app**. Batasi akses Google sesuai staf; `Session.getActiveUser().getEmail()` yang kosong harus fail-closed.
6. Pertama jalankan `offroadAdminV7Preflight()` dan baca booking live **tanpa mengubah data**. Harus menampilkan `environment:PRODUCTION`, `writesEnabled:false`, `financeChanged:false`. Jangan nyalakan tombol keputusan sebelum audit keuangan dan cek bank.
7. Setelah audit sinkronisasi keuangan, simulasi skenario tanpa menulis keuangan menggunakan **data uji di project testing terpisah**, lalu Owner boleh menyetujui membuka switch untuk **1 booking nyata** dengan bukti bank: Menunggu → ACC setelah uang masuk → ledger pembayaran pertama → (jika DP) pelunasan terpisah → status lunas ledger → verifikasi perjalanan selesai. Periksa ulang uang dan status yang sebenarnya sebelum menjalankan.
8. **Pencatatan ke `Data Keuangan Offroad` belum dipasang dalam kandidat ini.** Pasang melalui transaksi verified ber-ID yang idempoten setelah semua fungsi lama diaudit dan dimigrasikan. Tidak ada pembayaran otomatis hanya dari formulir.
9. **Poin Membership belum otomatis diaktifkan.** Adapter harus disesuaikan untuk booking DP yang dilunasi berdasarkan ledger, pemeriksaan Owner/claim dan anti-duplikat sebelum aktif. Keuangan/dashboard Rumah Camp tetap **tidak digabung**.

## Batas akses saat ini

Connector yang tersedia bisa membaca struktur spreadsheet Offroad dan memperbarui kode **feature branch GitHub**, tetapi **tidak memiliki kemampuan membuat/memperbarui/mendeploy project Google Apps Script**. Sampai pengelola membuka project Apps Script/Admin Offroad dan mengonfigurasi berkas serta izin di Google, **tidak ada URL admin online yang aktif**. Jangan mengeksekusi perubahan live sheet/keuangan tanpa audit trigger dan backup.

**Release gate tetap TERTUTUP.** PR tetap draft; tidak ada merge ke main, deploy Google, perubahan transaksi/booking A:N live, atau penerbitan poin. **Yang berubah di Sheet live hanyalah header O–W dan tab ledger kosong.**
