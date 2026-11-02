# Gerçek DICOM doğrulaması — 2 Kasım 2026

Paylaşılan **60 dosyanın tamamı** ayrı ayrı test edildi. Orijinaller değiştirilmedi, dış servise yüklenmedi. Kişi bilgileri rapora alınmadı.

## Sonuç

- 60/60 dosya çözüldü: 512 × 512, CT DICOM, HU.
- 15.728.640 pikselin HU dönüşümü ve padding maskesi bağımsız pydicom 2.4.4 / NumPy 2.0.2 hesabıyla eşleşti. Tüm dosyalarda slope=1, intercept=−1024.
- 8.676 karşılaştırma geçti. Ortalama, popülasyon standart sapması (ddof=0), medyan, min/maks, doğrusal %5/%95 yüzdelikleri, piksel sayısı, mm² alan, altı alt bölge ve histogramlar kontrol edildi. Tolerans: mutlak 1e−7 veya bağıl 1e−10. En büyük mutlak fark 1,71e−11; kayan nokta yuvarlaması düzeyinde.
- 22/60 dosyada otomatik çember bulundu: Z100–Z104 ve Z1028–Z1044. Çemberler tüm görsellerin karşılaştırmalı incelemesinde numune dış sınırına yakın göründü. Bu bir uzman tarafından çizilmiş referans sınırla geometrik doğrulama değildir.
- 38/60 dosyada otomatik analiz güvenli biçimde reddedildi. Bu dosyalara “otomatik numune ölçümü başarılı” denemez.
- 60/60 XLSX üretildi, yeniden açıldı; üç ölçüm satırındaki dokuz sayısal alanın JSON sonucu ile eşitliği, dört çalışma sayfası ve gömülü görüntü kontrol edildi.
- 180/180 yerel HTTP kontrolü geçti: her dosya için otomatik analiz, elle belirlenmiş test alanıyla analiz ve Excel dışa aktarımı. Otomatik seçim yapılamayan dosyalarda beklenen HTTP 400, elle test alanında ve Excel’de HTTP 201 doğrulandı. Bu testler Vercel’deki giriş noktası kullanılarak **yerelde** yapıldı; canlı Vercel dosya yükleme testi değildir.

## Sonuçların sınırı

**Matematiksel hesaplar, seçilen piksel kümesi için doğrulandı. Numunenin doğru seçilmesi ayrı bir koşuldur.** Otomatik seçim yapılamayan dosyalarda yalnızca hesap motorunu sınamak için merkez (256,256), yarıçap 128 px, kenar payı 10 px kullanıldı. Bu keyfi alanın sonuçları gerçek numune ölçümü değildir; 38 dosyanın Excel çıktıları da yalnızca test çıktısıdır. Otomatik seçim yapılanlarda varsayılan 2,1 mm kenar payı kullanıldı ve ayrıca aynı sabit test alanı doğrulandı.

Z01–Z10 görüntüleri uzunlamasına/izdüşüm benzeri; mevcut dairesel en kesit analizi için uygun görünmüyor. Z1000–Z1027 aralığında kısmi, düzensiz veya mevcut pencereyle tam numune sınırı belirlenemeyen görüntüler var. Bunlara sırf analizi geçirmek için çember çizilmemeli. Ölçülecek numune/alan tanımı ve gerekirse farklı ROI şekli gerekir.

Önizleme −1000…+1000 HU aralığıyla sınırlı. Özellikle Z1038 ve sonraki bazı kesitlerde beyaz doygun görünüm var; sayısal analiz +1000 HU’da kırpılmıyor (örneğin Z1038 iç alan ortalaması 1094,088471 HU). Alternatif görüntüleme penceresi sınır değerlendirmesini kolaylaştırabilir. Bilinen malzeme değeri veya cihaz/kalibrasyon referansı sağlanmadığı için fiziksel HU doğruluğu, cihaz kalibrasyonu ve numune için bilimsel geçerlilik bu testle kanıtlanmaz.

Aşağıdaki “hesap geçti” ifadesi, otomatik seçim yapılamayan dosyalarda **sabit test çemberindeki matematik** için geçerlidir.

## Dosya bazında sonuçlar

| Dosya | Otomatik numune seçimi | Bağımsız hesap | Excel / HTTP | Otomatik iç alan ortalaması (HU) | Gözlem |
|---|---|---|---|---:|---|
| Z01 | Bulunamadı | Geçti | Geçti | — | Uzunlamasına/izdüşüm benzeri görünüm; dairesel en kesit ölçümü uygun değil. |
| Z02 | Bulunamadı | Geçti | Geçti | — | Uzunlamasına/izdüşüm benzeri görünüm; dairesel en kesit ölçümü uygun değil. |
| Z03 | Bulunamadı | Geçti | Geçti | — | Uzunlamasına/izdüşüm benzeri görünüm; dairesel en kesit ölçümü uygun değil. |
| Z04 | Bulunamadı | Geçti | Geçti | — | Uzunlamasına/izdüşüm benzeri görünüm; dairesel en kesit ölçümü uygun değil. |
| Z05 | Bulunamadı | Geçti | Geçti | — | Uzunlamasına/izdüşüm benzeri görünüm; dairesel en kesit ölçümü uygun değil. |
| Z06 | Bulunamadı | Geçti | Geçti | — | Uzunlamasına/izdüşüm benzeri görünüm; dairesel en kesit ölçümü uygun değil. |
| Z07 | Bulunamadı | Geçti | Geçti | — | Uzunlamasına/izdüşüm benzeri görünüm; dairesel en kesit ölçümü uygun değil. |
| Z08 | Bulunamadı | Geçti | Geçti | — | Uzunlamasına/izdüşüm benzeri görünüm; dairesel en kesit ölçümü uygun değil. |
| Z09 | Bulunamadı | Geçti | Geçti | — | Uzunlamasına/izdüşüm benzeri görünüm; dairesel en kesit ölçümü uygun değil. |
| Z10 | Bulunamadı | Geçti | Geçti | — | Uzunlamasına/izdüşüm benzeri görünüm; dairesel en kesit ölçümü uygun değil. |
| Z100 | Bulundu; görsel onay gerekir | Geçti | Geçti | 731.636621 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z101 | Bulundu; görsel onay gerekir | Geçti | Geçti | 925.276911 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z102 | Bulundu; görsel onay gerekir | Geçti | Geçti | 784.068858 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z103 | Bulundu; görsel onay gerekir | Geçti | Geçti | 914.961183 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z104 | Bulundu; görsel onay gerekir | Geçti | Geçti | 756.184265 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z1000 | Bulunamadı | Geçti | Geçti | — | Kısmi veya düzensiz numune görünümü; tek tam çemberle numune ortalaması doğrulanamaz. |
| Z1001 | Bulunamadı | Geçti | Geçti | — | Kısmi veya düzensiz numune görünümü; tek tam çemberle numune ortalaması doğrulanamaz. |
| Z1002 | Bulunamadı | Geçti | Geçti | — | Kısmi veya düzensiz numune görünümü; tek tam çemberle numune ortalaması doğrulanamaz. |
| Z1003 | Bulunamadı | Geçti | Geçti | — | Kısmi veya düzensiz numune görünümü; tek tam çemberle numune ortalaması doğrulanamaz. |
| Z1004 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1005 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1006 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1007 | Bulunamadı | Geçti | Geçti | — | Kısmi veya düzensiz numune görünümü; tek tam çemberle numune ortalaması doğrulanamaz. |
| Z1008 | Bulunamadı | Geçti | Geçti | — | Kısmi veya düzensiz numune görünümü; tek tam çemberle numune ortalaması doğrulanamaz. |
| Z1009 | Bulunamadı | Geçti | Geçti | — | Kısmi veya düzensiz numune görünümü; tek tam çemberle numune ortalaması doğrulanamaz. |
| Z1010 | Bulunamadı | Geçti | Geçti | — | Kısmi veya düzensiz numune görünümü; tek tam çemberle numune ortalaması doğrulanamaz. |
| Z1011 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1012 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1013 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1014 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1015 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1016 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1017 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1018 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1019 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1020 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1021 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1022 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1023 | Bulunamadı | Geçti | Geçti | — | Kısmi veya düzensiz numune görünümü; tek tam çemberle numune ortalaması doğrulanamaz. |
| Z1024 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1025 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1026 | Bulunamadı | Geçti | Geçti | — | Sabit görüntüleme penceresinde tam numune sınırı seçilemiyor; otomatik numune ölçümü üretilemedi. |
| Z1027 | Bulunamadı | Geçti | Geçti | — | Kısmi veya düzensiz numune görünümü; tek tam çemberle numune ortalaması doğrulanamaz. |
| Z1028 | Bulundu; görsel onay gerekir | Geçti | Geçti | 895.896943 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z1029 | Bulundu; görsel onay gerekir | Geçti | Geçti | 863.426279 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z1030 | Bulundu; görsel onay gerekir | Geçti | Geçti | 850.637945 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z1031 | Bulundu; görsel onay gerekir | Geçti | Geçti | 851.047130 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z1032 | Bulundu; görsel onay gerekir | Geçti | Geçti | 813.259648 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z1033 | Bulundu; görsel onay gerekir | Geçti | Geçti | 812.996132 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z1034 | Bulundu; görsel onay gerekir | Geçti | Geçti | 850.409147 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z1035 | Bulundu; görsel onay gerekir | Geçti | Geçti | 842.096090 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z1036 | Bulundu; görsel onay gerekir | Geçti | Geçti | 828.891884 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z1037 | Bulundu; görsel onay gerekir | Geçti | Geçti | 818.710125 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z1038 | Bulundu; görsel onay gerekir | Geçti | Geçti | 1094.088471 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z1039 | Bulundu; görsel onay gerekir | Geçti | Geçti | 1092.283386 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z1040 | Bulundu; görsel onay gerekir | Geçti | Geçti | 1096.118136 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z1041 | Bulundu; görsel onay gerekir | Geçti | Geçti | 1095.333998 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z1042 | Bulundu; görsel onay gerekir | Geçti | Geçti | 1094.066638 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z1043 | Bulundu; görsel onay gerekir | Geçti | Geçti | 1035.691384 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
| Z1044 | Bulundu; görsel onay gerekir | Geçti | Geçti | 1095.585365 | Tam dairesel numune; çember görsel kontrolde dış sınıra yakın. Ölçüm öncesi onay gerekli. |
