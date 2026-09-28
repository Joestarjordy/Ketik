// Word lists. Lowercase letters only, so every character maps to a key on the heatmap.
// Each list is a few hundred of the most common everyday words in that language.

const WORDS = {
  english: `
    the be to of and a in that have it for not on with he as you do at this but his by from
    they we say her she or an will my one all would there their what so up out if about who
    get which go me when make can like time no just him know take people into year your good
    some could them see other than then now look only come its over think also back after use
    two how our work first well way even new want because any these give day most us is was
    are been has had were said did find here thing many long great little own old right big
    high different small large next early young important few public bad same able last late
    hard major better best free sure clear whole real possible open short true full special
    easy strong low certain simple local human black white red green blue happy ready quick
    house world school state family student group country problem hand part place case week
    company system program question government number night point home water room mother area
    money story fact month lot study book eye job word business issue side kind head service
    friend father power hour game line end member law car city community name president team
    minute idea kid body information back parent face others level office door health person
    art war history party result change morning reason research girl guy moment air teacher
    force education foot boy age policy music market sense nation plan college interest death
    experience effect class control care field development role effort rate heart drug show
    leader light voice wife police mind price report decision son view relationship town road
    table window paper river garden kitchen letter picture island dinner summer winter coffee
    keep begin seem help talk turn start might show hear play run move live believe hold bring
    happen write provide sit stand lose pay meet include continue set learn lead understand
    watch follow stop create speak read allow add spend grow offer remember love consider
    appear buy wait serve die send expect build stay fall cut reach kill remain suggest raise
    pass sell require decide return explain hope develop carry break receive agree support hit
    produce eat cover catch draw choose cause point listen realize place close open walk win
    always never often maybe quite perhaps almost later soon still yet already enough together
    during without again around between under against through before while where every each
    across behind above below toward among within along
  `,
  indonesia: `
    yang dan di itu dengan untuk tidak ini dari dalam akan pada juga saya ke karena tersebut
    bisa ada mereka lebih kata tahun sudah atau saat oleh menjadi orang kita harus sangat
    kami masih hanya banyak telah seperti bahwa baru hari sebagai jika dia belum setelah
    bagi para ia agar paling apa bila namun lalu kalau sini sana mana siapa kapan bagaimana
    mengapa semua setiap beberapa sedikit besar kecil baik buruk panjang pendek tinggi rendah
    cepat lambat mudah sulit senang sedih marah takut berani pintar bodoh kaya miskin muda tua
    rumah sekolah kantor pasar jalan kota desa negara dunia air api tanah udara langit laut
    gunung sungai hutan pohon bunga buah daun batu pasir hujan angin panas dingin pagi siang
    sore malam minggu bulan waktu jam menit detik sekarang nanti besok kemarin dulu selalu
    kadang jarang pernah segera tetap lagi hampir cukup terlalu benar salah sama lain sendiri
    makan minum tidur bangun duduk berdiri jalan lari pergi datang pulang masuk keluar naik
    turun buka tutup ambil beri kirim terima beli jual bayar pinjam bawa simpan cari temu
    lihat dengar baca tulis bicara tanya jawab pikir tahu ingat lupa coba mulai selesai tunggu
    bantu kerja main belajar ajar pakai buat masak cuci potong tanam pilih ganti hitung ukur
    suka cinta rindu mau ingin perlu boleh dapat mungkin pasti jangan tolong terima kasih maaf
    ayah ibu anak kakak adik nenek kakek teman guru murid dokter polisi petani pedagang
    keluarga tetangga manusia hewan kucing anjing burung ikan ayam sapi kuda kambing
    nasi roti sayur daging telur susu kopi teh gula garam minyak piring gelas sendok meja kursi
    pintu jendela lampu kamar dapur tangga atap lantai dinding kunci kertas buku pensil tas
    baju celana sepatu topi uang harga murah mahal toko warung kereta mobil motor sepeda kapal
    pesawat stasiun bandara pantai pulau musim warna merah putih hitam hijau biru kuning coklat
    kepala mata telinga hidung mulut gigi tangan kaki badan hati perut rambut suara nama alamat
    cerita berita lagu film gambar foto surat pesan kabar acara pesta libur hadiah mimpi
    pekerjaan pelajaran pertanyaan jawaban masalah keadaan kesehatan kehidupan pendidikan
    pemerintah masyarakat perusahaan pembangunan pengalaman kesempatan perubahan hubungan
  `
};

for (const lang of Object.keys(WORDS)) {
  WORDS[lang] = [...new Set(WORDS[lang].trim().split(/\s+/))];
}
