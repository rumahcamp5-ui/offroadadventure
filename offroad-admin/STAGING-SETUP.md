# Setup satu kali: Offroad Admin V7 STAGING

**Belum ada Google Apps Script project atau deployment aktif.** Ini panduan untuk Owner Offroad, bukan perintah menjalankan di booking/keuangan produksi.

## Yang sudah disiapkan

- Spreadsheet dummy khusus akun Offroad: https://docs.google.com/spreadsheets/d/1jTrkBvM4V2mHIA4KeLyixGcJgV4ASxjy6jJgyFku8Po/edit
- Tab `Formulir Offroad`, header baris 5 A–Q, empat booking fiktif pada baris 6–9, penanda staging di A1, zona waktu Asia/Jakarta. O mempunyai validasi status; P/Q diberi format tanggal/waktu.
- Backend dan UI di `offroad-admin/Code.gs` dan `offroad-admin/OffroadAdminV7.html`, serta manifest `offroad-admin/appsscript.json`.
- Backend **menolak mode produksi dan ID file lain** sebelum membaca atau memperbarui booking.

## Langkah pembuatan project oleh pemilik akun Google Offroad

1. Masuk ke https://script.google.com/home/projects/create menggunakan akun Google **Offroad**, bukan Rumah Camp. Namai project `OFFROAD V7 ADMIN - STAGING`. **Project baru**, jangan buka atau timpa project penerima booking lama.
2. Ganti isi `Code.gs` di project **baru** dengan seluruh isi [Code.gs](./Code.gs); tambah file HTML bernama **OffroadAdminV7** lalu isi dari [OffroadAdminV7.html](./OffroadAdminV7.html). Aktifkan tampilan `appsscript.json` dan sesuaikan dengan [manifest](./appsscript.json). Jangan menaruh token, email atau rekening pada HTML.
3. Di **Project Settings → Script properties** isi:
   - `OFFROAD_ADMIN_V7_MODE` → `staging`
   - `OFFROAD_ADMIN_V7_SPREADSHEET_ID` → `1jTrkBvM4V2mHIA4KeLyixGcJgV4ASxjy6jJgyFku8Po` (**hanya data simulasi**)
   - `OFFROAD_ADMIN_V7_OWNER_EMAILS` → email Google Owner Offroad yang memang diizinkan, persis seperti akun login
   - `OFFROAD_ADMIN_V7_VIEWER_EMAILS` → email Google Viewer, opsional, dipisah koma jika lebih dari satu
4. Pastikan akun Owner mempunyai **Editor** pada Sheet dummy; Viewer hanya perlu izin baca. Di editor Apps Script, pilih `offroadAdminV7Preflight` dan klik **Run**; izinkan OAuth untuk data dummy saja. Hasil yang benar: `ready:true`, `environment:'STAGING ONLY'`, `business:'offroad'`, tanpa perubahan keuangan/poin. Bila email Google kosong, **jangan mematikan pemeriksaan login**.
5. Baru buat **Deploy → New deployment → Web app**. Pilih **Execute as: User accessing the web app** dan pembatasan akses terketat yang mendukung akun Google staf. Di akun Google pribadi dengan pilihan login luas, kode tetap menolak semua akun selain allowlist, tetapi sebaiknya jangan membagikan URL luas. Coba Owner, Viewer, dan akun yang tidak terdaftar.
6. Uji **hanya** booking dummy, satu per satu: LUNAS, DP (wajib ditolak), Custom lunas, dan pembatalan. Setelah tes, pastikan kolom **A:N tidak berubah**, O:Q sesuai verifikasi, dan tab `OFFROAD V7 AUDIT` tercatat. **Jangan** menghubungkan layanan keuangan, Apps Script booking atau token Membership selama pengujian ini.

## Batas pengerjaan otomatis

Koneksi yang tersedia saat ini mengizinkan pembacaan GitHub dan pembuatan Sheet dummy, tetapi **tidak menyediakan API untuk membuat/mengubah/mendeploy project Google Apps Script**. Karena itu pembuatan project, persetujuan OAuth dan deployment web app perlu diselesaikan oleh akun Google pemilik, bukan dengan mengaku sudah otomatis aktif.

**Jangan merge PR Offroad #1 ke `main`, jangan mengubah Sheet Offroad asli, dan jangan jalankan adapter pengiriman poin sebelum staging lulus.**
