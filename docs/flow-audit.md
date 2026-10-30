# Akış ve ölçüm tutarlılığı denetimi

Tarih: 30 Ekim 2026

Klasör/dosya seçimi → dosyaya özel ayarlar → hesaplama → alan kontrolü → karşılaştırma → Excel akışı incelendi. Bu yapı, her dosyanın bağımsız ölçülmesi için uygundur. Denetimde beş hata yeniden üretildi, düzeltildi ve regresyon testleri eklendi.

## Bulunan ve düzeltilen sorunlar

| Sorun | Önceki davranış | Düzeltme ve kanıt |
| --- | --- | --- |
| Yanlış tekrar dosya tespiti | Adı, boyutu ve tarihi aynı olan farklı içeriklerden ikincisi kayboluyordu. | Olası çakışmalarda içerik SHA-256 ile karşılaştırılır. Aynı metadata ile 80 ve 180 yoğunluklu iki görüntü ayrı kalır; aynı içeriği tekrar eklemek çoğaltmaz. |
| Klasör taramasının erken bitmesi | Bir dosyanın başlığı okunamazsa sonraki sağlam dosyalar da eklenmiyordu. | Okuma hatası dosya bazında yakalanır; atlanan dosya belirtilir, kalan dosyalar eklenir. |
| Geç gelen önizleme | Orijinal renkli görüntünün geciken yükleme olayı, hesaplanan gri ton önizlemesinin üzerine yazabiliyordu. | Önizleme sürümü ve aktif dosya kimliği kontrol edilir. Gecikme özellikle oluşturularak piksel renkleriyle doğrulandı. |
| JPEG yön uyuşmazlığı | EXIF ile döndürülmüş görselde ekrandaki X/Y, ham piksel yönündeki ölçümle uyuşmuyordu. | Analiz öncesi EXIF yönü uygulanır. 200×100 ham / 100×200 görünen görselde alt bölge seçiminin doğru alana denk geldiği doğrulandı. |
| Gerçekte bulunmayan otomatik numune | Düz veya dikdörtgen bir görsele de dairesel numune uydurulabiliyordu. | Arama penceresi kenarları numune sınırı sayılmaz. Uydurulan çember, kırpılmadan önceki sınır noktalarıyla ve düşey kapsamayla kontrol edilir. Başarısızsa elle seçim istenir; elle seçilen bölge yine ölçülebilir. |

İlk dört hata düzeltme öncesi testlerde başarısızlıkla gösterildi. Beşinci hata düz ve dikdörtgen görseller için iki ayrı başarısız testle yeniden üretildi. Aynı testler düzeltmelerden sonra geçti.

## Dosyalar arasında karışma denetimi

Kontrol edilen kurallar:

- Kaynak dosya, klasör içi yol, ROI, kalibrasyon, hesaplanan sonuç ve hata durumu dosyaya özel kalır.
- Dosya seçicisiyle tekrar tekrar geçiş yapmak ölçümleri veya ayarları değiştirmez.
- Bir dosyanın ayarı değiştiğinde yalnızca o dosyanın eski ölçümü rapordan çıkarılır.
- Başarısız tekrar hesaplama, diğer dosyaların başarılı sonuçlarını geçersizleştirmez.
- Hatalı dosya toplu sırayı durdurmaz; hata, işlem durumu sayfasında görünür.
- Hesaplama sürerken dosya seçimi ve aşama değiştirme kilitlidir.
- HU, yaklaşık HU ve gri ton değerleri birimleriyle ayrı tutulur; aralarında ortak ortalama üretilmez.
- Toplu rapor yalnızca güncel başarılı sonuçları içerir; hata/bekleme/eski sonuç durumları ayrıca listelenir.
- Alt klasörlerdeki aynı adlı dosyalar hem ekranda hem raporda göreli yollarıyla ayrılır.
- Kuyruk boşaltıldığında ölçüm ve rapor aşamaları tekrar kilitlenir.

Başarısız tek dosya hesaplamasıyla ilgili metin de düzeltildi: diğer dosyaların raporunun kullanılabilir olduğu artık açıkça belirtilir.

## Bilinen sayısal sonuçlarla karşılaştırma

Sentetik görüntüler kullanıldı; değerler görsel tahmin veya yapay zekâ yorumuyla üretilmedi.

| Örnek | Ayarlar | Beklenen ve doğrulanan sonuç |
| --- | --- | --- |
| A: tüm pikselleri 80 olan 8×8 PNG | Merkez (4,4), r=3 px, kenar=1 px, piksel boyutu 0,2×0,3 mm | 13 piksel, ortalama 80 gri ton, alan 0,78 mm² |
| B: tüm pikselleri 180 olan 8×8 PNG | Merkez (4,4), r=3 px, kenar=0, piksel boyutu 0,5×0,5 mm, pencere −1000…1000 | 29 piksel, yaklaşık 411,7647058824 HU, alan 7,25 mm² |
| CT: ham piksel 1000, eğim 1, ofset −1024 | Merkez (4,4), r=3 px, kenar=1 px, piksel boyutu 0,25×0,5 mm | 13 piksel, −24 HU, alan 1,625 mm² |

Bu değerler API cevabında ve indirilen XLSX dosyaları tekrar okunarak denetlendi. Toplu rapordaki birim sütunları, dosya yolları, ölçüm satırları, hata durumları ve işaretli önizlemeler de kontrol edildi. Tek dosyalı raporun seçili dosya ve aynı kalibrasyonla eşleştiği doğrulandı.

Birim testleri ayrıca popülasyon standart sapmasını, doğrusal enterpolasyonla yüzdelikleri, histogram toplamını, signed DICOM piksellerini, padding dışlamasını ve piksel sınırlarını kontrol eder.

## Son doğrulama

- 19 birim testi başarılı.
- 8 HTTP testi başarılı.
- 6 Chrome akış testi başarılı.
- Derleme ve lint başarılı.
- Toplam: 33 test.
- Arayüz 320, 390, 768, 1024 ve 1440 px genişliklerde kontrol edildi.

Tekrar çalıştırma:

```bash
npm test
npm run test:e2e
npm run test:workflow
npm run lint
```

`test:workflow` kendi test sunucusunu 3100 portunda başlatıp kapatır; mevcut uygulama sunucusunu kullanmaz. Google Chrome varsayılandır. Ayrıntılar README'deki doğrulama bölümündedir.

## Doğrulamanın sınırları

Bu denetim, akışın ve bilinen girdilerle hesap/rapor tutarlılığının doğrulamasıdır. Otomatik numune seçimi halen sezgisel bir çember önerisidir; her gerçek numune için doğru sınırı bulduğu kanıtlanmış değildir. PNG/JPG'den gerçek HU geri kazanıldığı iddia edilmez. Özgün DICOM sağlanmadığından örnek Excel'deki HU değerleriyle birebir karşılaştırma yapılmadı.

Kuyruk tarayıcı sekmesinde tutulur; sayfa yenilenince temizlenir. Klasör seçimi anlık taramadır; klasör izleme, kalıcı arka plan işi veya kaldığı yerden devam mekanizması değildir.
