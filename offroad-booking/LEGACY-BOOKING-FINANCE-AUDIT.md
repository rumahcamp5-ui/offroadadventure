# Audit Code.gs Offroad lama untuk approval booking dan sinkronisasi pembayaran

**Status:** Hasil inspeksi terhadap source `Code.gs` 505 baris yang dikirim Owner pada 13 November 2026. Source **belum terverifikasi sama dengan versi deployment /exec produksi**; ini BUKAN instruksi langsung menimpa Apps Script yang sedang aktif. Staging PR #1 belum mengubah project, Sheet, atau uang live. **Jangan copy source lama utuh ke repository GitHub publik** karena source deployment perlu dikendalikan oleh pengelola Offroad.

## Temuan terkonfirmasi dari source

1. `doPost(e)` menerima field `payment=DP/LUNAS` dari browser, menghitung `amountPaid` sebagai **50% paket atau seluruh harga**, kemudian menulis langsung kolom J `Lunas/DP`, K `Sisa Pelunasan`, L `Jumlah Uang`, dan M `ID Booking`. **Angka itu merupakan rencana pembayaran tamu, bukan verifikasi transfer bank.** Kalau otomatisasi lain membaca L sebagai pendapatan, laporan bisa terlalu tinggi.
2. Source juga menerima `offroadAdminAction` di awal `doPost`; `handleOffroadAdminBridge_` memakai Script Property `OFFROAD_ADMIN_SOURCE_KEY` untuk memperbolehkan `snapshot` atau `post_payment`. Jangan bagikan token tersebut lewat chat, HTML atau GitHub.
3. `offroadAdminPostPayment_` sudah mampu menulis `(DP)` atau `(Pelunasan)` ke **Data Keuangan Offroad** kolom C:F dan ID pembayaran kolom M. Fungsi ini *belum* mengecek kolom R `ACC` dan bukti kredit V/W sebelum posting. Pengiriman jumlah, ID pembayaran, jenis serta tanggal dari konektor perlu direkonsiliasi ke sumber Offroad dengan lebih ketat.
4. `offroadAdminPostPayment_` memeriksa trigger `syncKeuanganOffroadOtomatis` **hanya dalam project Apps Script yang sama**, melalui `ScriptApp.getProjectTriggers()`. Tidak membuktikan trigger lintas-project ataupun seluruh sync lama sudah mati.
5. **Tidak ada definisi fungsi `syncKeuanganOffroadOtomatis` dalam file yang dikirim.** Ada penyebutan namanya dalam guard dan preflight, tetapi implementasi sinkronisasi lama (jika aktif) belum bisa diaudit. Periksa semua project/trigger yang memiliki akses edit ke spreadsheet Offroad.
6. `doGet` mengembalikan status `OK` kalau ID booking sudah tersimpan; itu artinya **diterima untuk dicatat**, bukan otomatis **ACC booking**. Pesan website harus membedakan keberhasilan menyimpan form dari persetujuan admin.
7. Entri keuangan ditandai `OFFROADPAY|bookingId|paymentId`. Idempotensi dasarnya bergantung pada paymentId dan persamaan beberapa field. Risiko: tanda di kolom M ditulis **lebih dulu** daripada data pemasukan C:F; jika terjadi kegagalan di antaranya, perlu jalur pemulihan dan audit idempotensi. Dua paymentId berbeda untuk bukti kredit yang sama juga perlu dideteksi agar uang tak dihitung dua kali.
8. Tipe pembayaran `DP` yang muncul dari form disimpan sebagai label semacam `DP = 350.000`; guard yang memakai exact comparison `J==='DP'` akan salah. Gunakan parser kompatibel yang diuji.
9. Kode lama dapat menyisipkan baris booking berdasarkan tanggal serta melakukan renumber. Dashboard yang mengandalkan **nomor baris** saja dapat mengarah ke booking berbeda; selalu cocokkan ID booking permanen dan hash versi semua kolom saat menyimpan keputusan.

## Perubahan yang disiapkan di PR Offroad (belum live)

- Panel Owner `ACC`/`REJECT` di dashboard staging, status R dan metadata S:W, plus audit keputusan pada tab Offroad sendiri; booking yang belum ada uang masuk tetap menunggu, tidak otomatis ACC.
- `VerifiedFinanceFirstPaymentV7.gs` merupakan **calon pengaman baca-saja**, belum dipanggil oleh kode lama. Calon fungsi ini mensyaratkan status `ACC` oleh Owner, nominal V dan waktu W yang cocok dengan pembayaran pertama, ID booking permanen, serta tipe DP/LUNAS yang sesuai. Tidak menulis transaksi, tidak memindahkan keuangan dan **menolak pelunasan kedua DP** sebelum ada ledger bukti bank terpisah.
- Adapter Membership juga mewajibkan booking `R=ACC`, status perjalanan `O=SELESAI` dan bukti pembayaran, tetapi masih **belum menerbitkan poin atau melakukan finansial sync**.

## Rancangan transaksi finansial Offroad (pemisahan dua usaha tetap wajib)

| Kejadian | Booking Offroad | Ledger pembayaran Offroad | Keuangan Offroad | Membership |
| --- | --- | --- | --- | --- |
| Tamu pilih DP/LUNAS | Menunggu verifikasi | Belum ada pembayaran sah | **Tidak boleh otomatis mencatat pendapatan** | Belum ada poin |
| Transfer pertama benar masuk | Owner ACC booking | Tambah entri kredit pertama dengan source ID, nominal, waktu bank, hash referensi | Posting **satu** pemasukan berdasarkan entri verified/idempotent | Belum ada poin |
| Transfer belum masuk / bukti salah | Tetap menunggu atau Reject dengan alasan | Tidak ada kredit | Tidak ada pemasukan; jika ada pencatatan lama, lakukan rekonsiliasi terpisah | Belum ada poin |
| Pembayaran DP dilunasi kemudian | Booking tetap ACC | Tambah **entri kedua** (pelunasan) dengan ID dan timestamp tersendiri | Posting pemasukan kedua tanggal saat benar diterima | Poin tetap menunggu trip selesai |
| Trip sudah selesai | Status O/P/Q verified, seluruh pembayaran benar lunas | Total verified credits = harga disepakati; tidak ada refund terbuka | Tidak membuat transaksi baru hanya karena trip selesai | Membership dapat melakukan klaim/review sesuai gate tersendiri |

Kuncinya: **kolom L dari formulir bukan transaksi bank**, dan penilaian bruto/netto Offroad tidak boleh disatukan dengan ledger keuangan Rumah Camp. Jangan mengubah catatan historis otomatis untuk menyembunyikan transaksi lama.

## Masih perlu sumber lain sebelum boleh produksi

1. Isi fungsi `syncKeuanganOffroadOtomatis` dan helper-nya, **kalau ada** (atau screenshot pemicu/Triggers semua Apps Script yang terhubung ke Sheet Offroad).
2. Data struktur header `Data Keuangan Offroad` saja, terutama C:F, M6, dan apakah kolom N `Status Sync Keuangan` ditulis oleh formula / script lain.
3. Kepastian akun Owner Offroad, sumber bukti mutasi/rekening (tanpa membagikan kredensial atau foto data sensitif), dan kebijakan untuk booking DP 50% + pelunasan belakangan.
4. End-to-end staging: booking tersimpan tanpa pemasukan, Owner ACC setelah kredit nyata, duplicate/retry/replay tidak menggandakan uang, pembayaran kedua DP tetap terpisah, Reject tak mencatat pemasukan, refund audit, dan daftar booking aktif tidak menampilkan pembayaran palsu.

**Stop gate:** jangan matikan trigger lama, jangan merge PR, jangan deploy Apps Script, jangan edit Sheet atau transaksi live sebelum kode sinkronisasi lengkap dan rencana backup/rollback disetujui.
