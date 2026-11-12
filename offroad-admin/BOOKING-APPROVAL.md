# Approval Booking Offroad V7 (STAGING ONLY)

## Kenapa fitur ini wajib

Form booking Offroad sekarang meminta tamu memilih `DP` atau `LUNAS` dan mengirim jumlah nominal yang *diajukan*. Data ini **bukan** bukti uang benar-benar masuk ke rekening. Karena itu admin Offroad harus **ACC atau Reject booking** sebelum status reservasi dinyatakan sah. Status perjalanan dan poin Membership adalah tahapan **setelahnya**, bukan pengganti approval booking.

## Alur booking

1. Booking masuk: kolom R kosong -> dashboard menampilkan **Menunggu Verifikasi**. Tidak ada auto-ACC meskipun form berisi `LUNAS`.
2. Admin memeriksa ID/nama, mutasi rekening Offroad dan bukti pembayaran asli. Bila transfer masih tertunda, **biarkan menunggu**.
3. **ACC Booking** hanya untuk uang yang betul-betul sudah masuk dan nominal cocok dengan `Jumlah Uang` kolom L. Pilihan DP yang baru dibayar sah dapat ACC, tapi tidak otomatis berarti perjalanan lunas.
4. **Reject Booking** bila setelah pemeriksaan tidak ada uang masuk, bukti tidak valid, atau alasan lain yang dicatat. Owner wajib memberi alasan dan referensi pemeriksaan internal. Jika uang ternyata masuk, jangan Reject; selesaikan rekonsiliasi dahulu.
5. Status `ACC` memungkinkan proses verifikasi perjalanan pada tahap berikutnya. Status `REJECT` tidak dapat mengirim bukti selesai untuk perolehan poin Membership.
6. **Perjalanan selesai** tetap butuh status lunas dan verifikasi tersendiri di kolom O–Q. ACC booking **tidak memberikan poin atau mengubah status pelunasan**.

## Kolom Offroad yang dipakai (hanya di Sheet staging simulasi)

| Kolom | Isi | Catatan |
| --- | --- | --- |
| A–N | Booking/keuangan lama | **Tidak diubah oleh dashboard** |
| O–Q | Verifikasi perjalanan | Tetap terpisah dari ACC booking |
| R | Status Persetujuan Booking | `ACC`, `REJECT`, atau kosong = menunggu |
| S | Waktu Keputusan Booking | Timestamp admin |
| T | Admin Keputusan Booking | Email Owner |
| U | Alasan Reject Booking | Wajib kalau `REJECT` |
| V | Jumlah Transfer Terverifikasi | Rupiah di **Offroad** saja, diisi jika ACC |
| W | Waktu Transfer Terverifikasi | Timestamp mutasi yang diperiksa |

Audit tindakan `BOOKING_ACC_REQUESTED`, `BOOKING_ACC_COMMITTED`, `BOOKING_REJECT_REQUESTED`, `BOOKING_REJECT_COMMITTED` disimpan dalam tab `OFFROAD V7 AUDIT` milik Offroad. Referensi bukti dicatat sebagai hash SHA-256. Tidak ada data transfer, saldo, nama tamu atau nominal yang dikirim ke backend Membership.

## Proteksi staging

- Hanya Owner Google Offroad yang diizinkan boleh ACC/Reject; Viewer read-only, akun lain ditolak.
- Penguncian dan versi hash seluruh A–W mencegah keputusan terhadap booking yang berubah setelah halaman dibuka.
- Kode staging dibatasi ke file simulasi: `1jTrkBvM4V2mHIA4KeLyixGcJgV4ASxjy6jJgyFku8Po`.
- Tidak menulis ke kolom A–Q, tidak otomatis refund, tidak mengubah status sinkronisasi keuangan N, tidak mengirim WA dan tidak menerbitkan poin.
- Adapter poin Offroad baru boleh mengirim bukti perjalanan selesai kalau R sudah `ACC`, O `SELESAI`, pembayaran lunas dan Q terverifikasi.

## BLOCKER KRITIS sebelum produksi

**Periksa dan perbaiki Apps Script Offroad penerima booking serta alur sinkronisasi keuangan yang *saat ini live*.** Kolom N `Status Sync Keuangan` dan data nominal booking lama bisa saja sudah disinkronkan tanpa menunggu ACC. Menambahkan tombol ACC/Reject saja **belum menghentikan sinkronisasi lama tersebut**. Tidak boleh mengklaim laporan keuangan sudah diverifikasi sebelum seluruh script sinkronisasi menolak `R != ACC` dan memakai mutasi pembayaran yang benar-benar terverifikasi. Jangan menimpa Apps Script booking lama tanpa backup dan pengujian lintas-project.

Status WA ACC/Reject ke tamu, batas waktu otomatis Reject, koreksi status setelah Reject, refund, dan verifikasi *pelunasan lanjutan* pada booking DP adalah pengembangan lanjutan. Belum otomatis di branch ini.

**Jangan deploy ke produksi sebelum blokir keuangan lama, alur notifikasi, dan pembayaran DP→Lunas diuji end-to-end.**
