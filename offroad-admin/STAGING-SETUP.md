# Setup satu kali: Offroad Admin V7 STAGING

**Belum ada Google Apps Script project atau deployment aktif.** Ini panduan untuk Owner Offroad, bukan perintah menjalankan di booking/keuangan produksi.

## Yang sudah disiapkan

- Spreadsheet dummy khusus akun Offroad: https://docs.google.com/spreadsheets/d/1jTrkBvM4V2mHIA4KeLyixGcJgV4ASxjy6jJgyFku8Po/edit
- Tab `Formulir Offroad`, header baris 5 **A–W**, empat booking fiktif pada baris 6–9, penanda staging di A1, zona waktu Asia/Jakarta. **O–Q** untuk verifikasi perjalanan; **R–W** untuk ACC/Reject booking dan bukti bank. Status O/R mempunyai validasi; P/Q/S/W diberi format tanggal/waktu. **A:N tetap data dummy booking & keuangan.** Ada tab baru `OFFROAD V7 PAYMENT LEDGER` yang kosong dan hanya menerima kredit bank yang diverifikasi oleh Owner dalam staging, tidak tersambung ke Data Keuangan asli.
- Backend di `offroad-admin/Code.gs` **dan file tambahan `offroad-admin/OffroadPaymentsV7.gs`**, UI `offroad-admin/OffroadAdminV7.html`, serta manifest `offroad-admin/appsscript.json`. **Kedua file .gs wajib ada di project admin staging baru** karena perjalanan yang sudah selesai kini harus memeriksa ledger bank.
- Backend **menolak mode produksi dan ID file lain** sebelum membaca atau memperbarui booking.

## Langkah pembuatan project oleh pemilik akun Google Offroad

1. Masuk ke https://script.google.com/home/projects/create menggunakan akun Google **Offroad**, bukan Rumah Camp. Namai project `OFFROAD V7 ADMIN - STAGING`. **Project baru**, jangan buka atau timpa project penerima booking lama.
2. Ganti isi `Code.gs` di project **baru** dengan seluruh isi [Code.gs](./Code.gs); **tambahkan file script kedua bernama `OffroadPaymentsV7`** dari [OffroadPaymentsV7.gs](./OffroadPaymentsV7.gs). Tambahkan HTML bernama **OffroadAdminV7** lalu isi dari [OffroadAdminV7.html](./OffroadAdminV7.html). Aktifkan tampilan `appsscript.json` dan sesuaikan dengan [manifest](./appsscript.json). Jangan menaruh token, email atau rekening pada HTML.
3. Di **Project Settings → Script properties** isi:
   - `OFFROAD_ADMIN_V7_MODE` → `staging`
   - `OFFROAD_ADMIN_V7_SPREADSHEET_ID` → `1jTrkBvM4V2mHIA4KeLyixGcJgV4ASxjy6jJgyFku8Po` (**hanya data simulasi**)
   - `OFFROAD_ADMIN_V7_OWNER_EMAILS` → email Google Owner Offroad yang memang diizinkan, persis seperti akun login
   - `OFFROAD_ADMIN_V7_VIEWER_EMAILS` → email Google Viewer, opsional, dipisah koma jika lebih dari satu
4. Pastikan akun Owner mempunyai **Editor** pada Sheet dummy; Viewer hanya perlu izin baca. Di editor Apps Script, pilih `offroadAdminV7Preflight` dan klik **Run**; izinkan OAuth untuk data dummy saja. Hasil yang benar: `ready:true`, `environment:'STAGING ONLY'`, `business:'offroad'`, tanpa perubahan keuangan/poin. Bila email Google kosong, **jangan mematikan pemeriksaan login**.
5. Baru buat **Deploy → New deployment → Web app**. Pilih **Execute as: User accessing the web app** dan pembatasan akses terketat yang mendukung akun Google staf. Di akun Google pribadi dengan pilihan login luas, kode tetap menolak semua akun selain allowlist, tetapi sebaiknya jangan membagikan URL luas. Coba Owner, Viewer, dan akun yang tidak terdaftar.
6. Uji **hanya** booking dummy. Pertama gunakan panel **Approval Booking**: tanpa transfer tetap *Menunggu Verifikasi*, Reject jika mutasi tidak masuk, ACC bila transfer LUNAS/DP sah dan nominal cocok. Setelah ACC, gunakan form **Ledger pembayaran terverifikasi**: catat transfer pertama, lalu jika DP masukkan pelunasan sebagai **transaksi kedua, tanggal dan referensi bank berbeda**. Sebelum pelunasan, verifikasi selesai (O–Q) harus ditolak; setelah keduanya sah, harus berhasil. Coba juga Custom price, pembatalan, transfer ulang, referensi ganda, dan audit. Pastikan **hanya R–W/O–Q dan ledger simulasi yang berubah**, kolom **A:N tetap utuh**, dan `OFFROAD V7 AUDIT` terisi. **Jangan** menghubungkan keuangan, booking lama, atau token Membership saat tes.

## Batas pengerjaan otomatis

Koneksi yang tersedia saat ini mengizinkan pembacaan GitHub dan pembuatan Sheet dummy, tetapi **tidak menyediakan API untuk membuat/mengubah/mendeploy project Google Apps Script**. Karena itu pembuatan project, persetujuan OAuth dan deployment web app perlu diselesaikan oleh akun Google pemilik, bukan dengan mengaku sudah otomatis aktif.

**Jangan merge PR Offroad #1 ke `main`, jangan mengubah Sheet Offroad asli, dan jangan jalankan adapter pengiriman poin sebelum staging lulus.**

**Sebelum mengaktifkan produksi:** perubahan approval di dashboard **belum** memblokir script finansial lama yang mungkin telah menyinkronkan nominal sejak formulir masuk. Wajib audit Code.gs penerima booking dan alur `Status Sync Keuangan` kolom N terlebih dulu agar pembayaran tak terverifikasi tidak dianggap pemasukan.

## Tahap pembayaran DP / pelunasan (staging, belum keuangan)

- Ledger pembayaran merupakan tab **OFFROAD V7 PAYMENT LEDGER** di Sheet simulasi Offroad, bukan laporan keuangan. Untuk setiap booking, maksimal satu kredit pertama (`DP` atau `LUNAS`) dan satu `PELUNASAN` jika jenis pembayaran awal DP. Rujukan bank tersimpan hanya sebagai SHA-256, sehingga **referensi yang sama ditolak** saat dipakai ulang pada entri lain.
- Persetujuan ACC berdasarkan transfer pertama tetap tercatat di R–W. Setelah itu, Owner wajib menekan tombol catat pembayaran di ledger untuk membentuk bukti kredit yang bisa diaudit. **ACC saja tidak dianggap cukup untuk menyelesaikan perjalanan atau memperoleh poin.**
- DP yang sudah dilunasi tetap mempertahankan nilai historis kolom K/L seperti saat booking diajukan. **Total terverifikasi dan sisa pembayaran dihitung dari ledger**, bukan dengan menyulap data booking menjadi LUNAS. Hal ini menjaga audit dan menghindari transaksi pertama terhapus.
- Pembukuan `Data Keuangan Offroad`, trigger sinkronisasi lama, pesan WhatsApp konfirmasi, mutasi bank sesungguhnya, dan poin Membership belum diaktifkan oleh ledger staging ini. Sebelum produksi, sumber pembayaran harus direkonsiliasi dengan trigger lama, migrasi audit, dan backend Membership. 
