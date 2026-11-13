# Dashboard Admin Offroad V7 (prototipe, berdiri sendiri)

**Status:** Kode pengembangan di branch Offroad, **BELUM DIPASANG ATAU DI-DEPLOY**. Ini bukan bagian dari dashboard Rumah Camp dan tidak menggantikan website booking Offroad.

## Yang sudah tersedia di source

- `Code.gs`: backend Apps Script milik **Offroad**. Wajib login Google dan pemeriksaan daftar email setiap pemanggilan. Akun **Owner** dapat memverifikasi; **Viewer** hanya melihat. Email Google kosong/tidak dikenali selalu ditolak.
- `OffroadAdminV7.html`: dashboard responsif berisi daftar maksimal 100 booking terbaru, pencarian, filter status, detail paket/unit, dan pemeriksaan pembayaran hanya di lingkungan Offroad. Menggunakan `google.script.run` sehingga rahasia tidak pernah ditaruh di halaman HTML.
- **Approval Booking (ACC/Reject):** panel baru memisahkan status booking dari status perjalanan. Owner wajib memeriksa transfer masuk, nominal, waktu dan referensi pemeriksaan sebelum ACC; bisa Reject dengan alasan jika uang tidak masuk/bukti invalid. DP yang benar-benar sudah dibayar boleh ACC, tetapi belum dianggap lunas. Tidak ada auto-ACC dari form. Staging menulis hanya R:W dan audit, sementara O:Q tetap khusus trip; baca [aturan approval](./BOOKING-APPROVAL.md).
- Verifikasi perjalanan menuntut pemeriksaan identitas, bukti kunjungan, status pelunasan & mutasi uang oleh Owner, waktu perjalanan selesai yang nyata, serta referensi bukti internal. Harga Custom diterima selama catatan Offroad menunjukkan lunas dan sisa 0. **Tidak pernah mengganti harga Custom dengan tarif paket standar.**
- Pembatalan adalah aksi terpisah; tidak mengembalikan uang, menghapus transaksi, atau mencabut poin secara otomatis.
- Backend membuka Sheet **Formulir Offroad** dengan ID khusus. Mengunci operasi, mencocokkan versi data yang dilihat admin dengan isi terbaru, dan menolak verifikasi jika ada perubahan di tengah pemeriksaan.
- **Satu-satunya perubahan pada tabel booking adalah O:Q**: O `Status Perjalanan`, P `Tanggal Selesai`, Q `Pembayaran Diverifikasi`. Kolom A:N, formulir booking, harga, DP, pelunasan, rekening, status sinkronisasi keuangan, dan dashboard Rumah Camp tidak diubah.
- Setiap keputusan menambah catatan di tab audit **OFFROAD V7 AUDIT** dalam spreadsheet Offroad sendiri (dibuat saat keputusan pertama). Referensi bukti disimpan sebagai SHA-256, bukan mutasi atau nomor rekening mentah.
- Pengesahan di dashboard **belum mengirim status poin otomatis**. Adapter `../membership/OffroadMembershipSourceV7.gs` merupakan langkah manual terpisah di staging. Bahkan pengiriman event tersebut hanya menghasilkan observasi, **bukan penerbitan poin**.

## Spreadsheet staging yang sudah disiapkan (12 November 2026)

- File Offroad terpisah: [OFFROAD V7 ADMIN TEST - DATA SIMULASI](https://docs.google.com/spreadsheets/d/1jTrkBvM4V2mHIA4KeLyixGcJgV4ASxjy6jJgyFku8Po/edit). Dibuat di akun Google Drive **Offroad**, bukan Rumah Camp.
- Memuat tab `Formulir Offroad` dengan **header A:Q pada baris 5** dan empat booking **fiktif** di baris 6–9: LUNAS, DP, harga Custom, dan skenario pembatalan. Tidak ada nama/nomor WhatsApp tamu asli. Jangan sambungkan ke sistem keuangan live.
- Kode `Code.gs` versi branch ini **dikunci untuk staging saja**. `OFFROAD_ADMIN_V7_MODE=staging` wajib; ID spreadsheet harus persis ID file simulasi di atas, judul harus `[STAGING] OFFROAD V7 ADMIN TEST - DATA SIMULASI` dan sel A1 harus berisi penanda dummy tetap. Mode produksi, ID live, atau salinan file lain langsung ditolak **sebelum membaca booking atau menulis O:Q**.
- Tes staging ini **belum menjadi web app**. Belum ada Apps Script project baru, URL `/exec`, konfigurasi email Owner/Viewer, atau deployment Google yang dibuat. GitHub Actions hanya menguji kode menggunakan simulasi.
- Agar berjalan sebagai web app di staging, Owner harus membuat project Apps Script baru khusus Offroad Admin dan mengatur `OFFROAD_ADMIN_V7_MODE=staging`, `OFFROAD_ADMIN_V7_SPREADSHEET_ID` sesuai ID file staging, lalu Owner/Viewer email allowlist. Jangan menambahkan project ini ke Apps Script booking live.

## Cara pemasangan di staging nanti (jangan eksekusi tanpa persetujuan)

1. **Buat project Google Apps Script baru khusus Admin Offroad**, bukan project penerima booking yang sudah ada. Ini penting karena dashboard membutuhkan `doGet()` sendiri; `doGet` lama untuk JSONP booking tidak boleh ditimpa.
2. Buat file `Code.gs` dan HTML bernama tepat `OffroadAdminV7` dari folder ini. Jangan paste ke Apps Script Rumah Camp atau halaman GitHub Pages publik.
3. Di Offroad Spreadsheet, pertahankan header baris 5 A:N. Perluas **hanya** dengan O `Status Perjalanan`, P `Tanggal Selesai`, Q `Pembayaran Diverifikasi`. Isi O/P/Q untuk booking nyata oleh staf Offroad yang berwenang. Jangan memindahkan isi kolom lama.
4. Di **Script Properties project Admin Offroad yang baru**, isi:
   - `OFFROAD_ADMIN_V7_MODE` = `staging` (wajib dalam versi pengembangan ini).
   - `OFFROAD_ADMIN_V7_SPREADSHEET_ID` = ID **file simulasi Offroad staging di atas**, bukan spreadsheet booking live ataupun Rumah Camp.
   - `OFFROAD_ADMIN_V7_OWNER_EMAILS` = email akun Google Owner Offroad, bisa lebih dari satu dipisahkan koma.
   - `OFFROAD_ADMIN_V7_VIEWER_EMAILS` = email viewer opsional; viewer tidak bisa mengubah data.
5. Deploy sebagai **Web app baru**, pilihan **Execute as: User accessing the web app**. Batasi **Who has access** seketat yang tersedia, hanya akun staf yang diizinkan. Share spreadsheet Offroad kepada akun Owner/Viewer yang memang butuh akses. Dalam mode ini, jika Google tidak mengembalikan alamat email aktif, aplikasi otomatis menolak akses; **jangan ubah jadi execute as owner untuk mengakali autentikasi**.
6. Uji dengan akun Owner dan Viewer yang berbeda. Pastikan akun tidak dikenal ditolak, verifikasi baru hanya mengisi O:Q, tab audit muncul, sedangkan J–N dan laporan keuangan tidak berubah. Uji harga Custom, booking DP, jadwal belum selesai, pembatalan dan perubahan sel saat panel terbuka.
7. Baru setelah itu lakukan uji adapter Membership terpisah dengan akun/sumber Offroad, secret HMAC di Script Properties yang berbeda, serta endpoint **staging**, bukan produksi. Tidak ada auto trigger, auto-award, atau merge keuangan.

## Pembayaran dua tahap (sudah dikodekan di staging, belum produksi)

- `OffroadPaymentsV7.gs` adalah file **Apps Script tambahan wajib** di project Admin Offroad yang baru. Setelah Owner menekan ACC, pembayaran pertama harus dicatat secara manual pada tab `OFFROAD V7 PAYMENT LEDGER`. Bagi booking `DP = ...`, tombol berikutnya mencatat satu pelunasan terpisah dengan tanggal dan referensi bank yang berbeda.
- Ledger menghitung **total yang benar-benar terverifikasi** dan **sisa terverifikasi** tanpa mengubah nilai rencana pembayaran di J/K/L. Referensi bank disimpan sebagai SHA-256, transaksi ulang dari bukti identik ditangani idempoten, kredit ganda/nominal salah/akun Viewer ditolak. Pembatalan dan refund belum otomatis.
- **Verifikasi perjalanan selesai** kini memerlukan `R=ACC` *serta* ledger Offroad menunjukkan **lunas terverifikasi**: satu pembayaran penuh atau dua pembayaran DP+pelunasan. Pilihan `LUNAS` dari browser saja tidak cukup.
- Ini **tidak** otomatis menulis `Data Keuangan Offroad` maupun memberi poin Membership. Adapter Membership dan alur keuangan produksi masih membutuhkan rekonsiliasi tambahan, termasuk dukungan DP yang dilunasi dari ledger dan penonaktifan sinkronisasi lama setelah ditinjau.
- Panduan setup file baru tersedia di [STAGING-SETUP.md](./STAGING-SETUP.md).

## Perlu diperhatikan sebelum lanjut deploy

- Staging dummy sekarang mempunyai kolom A:W: A:N catatan asal, O:Q verifikasi perjalanan, **R:W status ACC/Reject booking**. Kode belum mengubah Sheet produksi.
- **BLOCKER keuangan produksi:** Apps Script sinkronisasi keuangan Offroad lama harus diperiksa. Jika nominal dari formulir sudah masuk laporan keuangan sebelum bukti bank/ACC, penambahan dashboard ini **belum mengoreksi transaksi tersebut**. Sebelum produksi, sinkronisasi perlu memakai status R=ACC dan pembayaran bank terverifikasi di sumber Offroad, dengan pelunasan lanjutan DP yang berbeda tanggal. Jangan otomatis mengirim nominal ke Rumah Camp.
- Kirim WA konfirmasi ACC/Reject, refund, batas waktu status menunggu, dan buka ulang Reject adalah fitur operasional berikutnya; belum otomatis.

## Kontrol keamanan & batasan yang belum selesai

- Ini **bukan** pembuktian transfer bank otomatis. Owner tetap wajib memeriksa mutasi nyata dan memastikan perjalanan selesai, refund/cancel tidak bermasalah, serta referensi bukti dapat ditelusuri. Checkbox tidak menggantikan mutasi bank.
- Audit di Google Sheets bersifat append-only **secara aplikasi**, bukan kebal terhadap pemilik spreadsheet yang punya izin edit langsung. Untuk kebutuhan audit lebih kuat, perlu log transaksi server dengan izin terpisah.
- Keputusan dashboard memakai penguncian dalam satu project Apps Script serta pemeriksaan versi booking, tetapi project penerima booking lama berjalan sendiri. Pengujian produksi harus mengukur perlombaan (race) lintas-project sebelum otomatisasi dinyalakan.
- O/P/Q **tidak boleh otomatis mengubah uang**. Pemberian poin, klaim ke member, dan pembalikan poin butuh tahap tersendiri dengan bukti kepemilikan akun serta rekonsiliasi sumber yang independen.
- Project admin ini belum tersambung ke live Sheet, karena tidak ada operasi setup/deploy/akses tulis yang dijalankan untuk itu.

## Pengujian kode

`node --test tests/*.test.mjs`

Tes GitHub Actions memeriksa pembatasan akses, bukti dan identitas, Custom price, penolakan DP, versi booking yang sudah berubah, penguncian, hanya O:Q yang berubah, tidak ada poin otomatis, serta adapter Membership Offroad yang sudah tersedia.
