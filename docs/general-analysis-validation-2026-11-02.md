# Farklı şekiller için ortak analiz akışı — 2 Kasım 2026

## Kapsam ve sonuç

Paylaşılan 60 DICOM dosyasının tamamı güncel genel akışla çalıştırıldı. Dosya adına veya Z01’e özel koordinat kullanılmadı. 22 dosyada daire, 14 dosyada genel ön plan sınırı önerildi: toplam **36 otomatik alan önerisi**. **24 dosyada otomatik sonuç üretilmedi**; kullanıcıdan görüntü üzerinden alan düzeltmesi istenir. Otomatik öneri sayısı segmentasyon doğruluk oranı değildir.

Genel sınır hattı şekle özel en-boy/çember varsayımı yerine uyarlamalı ön plan eşiği, ince bağlantıların ayrılması, bağlı parçalar, kapalı iç boşlukların korunması ve içbükey dış sınırların izlenmesini kullanır. CT görüntülerindeki alt yatay destek adayları ve çok küçük/belirsiz yapılar için eleme kontrolleri vardır. Bunlar deneysel koruyucu kurallardır, kalibre edilmiş bir güven skoru değildir.

Otomatik sonuç üreten 36 dosyada **2.572 bağımsız karşılaştırma** geçti. Orijinal DICOM pikselleri pydicom ile okundu; tam alan, iç alan, ayrı parçalar, mm², ortalama, popülasyon standart sapması, medyan, min/maks, doğrusal %5/%95 yüzdelikleri ve histogram sayımları NumPy ile kontrol edildi. En büyük fark **1,71 × 10⁻¹¹**; kayan nokta yuvarlaması düzeyindedir. Karşılaştırma kullanılan alan maskesine göre matematiği doğrular; maskenin doğru numuneyi seçtiğini kanıtlamaz.

Parça maskeleri `roi.labelMask` PNG içinde arka plan=0, parça kimliği=1…32 olarak döndürülür. Dış sınır noktaları görüntüleme için en fazla yaklaşık yarım piksel toleransla sadeleştirilir; ölçümün dış kapsamı yerel piksel etiketlerinden gelir. İç alan, bu kapsamla birlikte sınır uzaklığına göre oluşturulur. Dar/düzensiz alanlarda otomatik içeri alma mesafesi, iki piksellik aralıklarla örneklenen iç açıklığa göre azaltılabilir. Elle girilen ayarlar değiştirilmez.

## Sınırlar

- Tek bir güvenilir ayrım modeli bulunmadığından, düşük kontrastlı kısımlar numunenin dışı sanılabilir. İç boşluklar yalnızca çevresi kapalıysa otomatik korunur; dışa açık yarıklar/sınır kayıpları ayrıca gözle kontrol edilmelidir.
- Z1010 gibi parçalı ve zayıf kontrastlı görüntülerde öneri yalnızca görünen parlak parçaları kapsayabilir; tam numune sınırı olarak onaylanmış değildir.
- Masa/numune ayrımı ve sınır doğruluğu için etiketli gerçek örnekler bulunmuyor. Duyarlılık, özgüllük veya genel tespit doğruluğu iddia edilmez.
- Görüntü kenarına ulaşan numunelerde yalnızca görünen alan ölçülür; tamamı varsayılmaz.
- Z01 dahil türetilmiş/ortalama görüntüler, özgün eksenel kesitle doğrudan eşdeğer değildir.
- Yarık işaretleri hâlâ düşük yoğunluk adaylarıdır; kesin malzeme kusuru kararı değildir.
- Önceki Z01 sürümünün alanları dışbükey önerilerdi. Bu sürümde maskeler yeniden hesaplandığından önceki alan/ortalama değerlerine sabitlenmedi.

## Dosya bazında

| Dosya | Otomatik öneri | Parça | İç piksel | Ortalama HU | Bağımsız hesap |
|---|---|---:|---:|---:|---|
| Z01 | Genel sınır | 5 | 20548 | 799.016693 | Geçti |
| Z02 | Genel sınır | 4 | 9261 | 828.780909 | Geçti |
| Z03 | Genel sınır | 4 | 10068 | 829.444676 | Geçti |
| Z04 | Genel sınır | 5 | 20061 | 798.400728 | Geçti |
| Z05 | Genel sınır | 4 | 10859 | 826.998250 | Geçti |
| Z06 | Genel sınır | 5 | 20286 | 798.795721 | Geçti |
| Z07 | Genel sınır | 4 | 11619 | 827.048111 | Geçti |
| Z08 | Genel sınır | 3 | 7301 | 844.310916 | Geçti |
| Z09 | Genel sınır | 3 | 7782 | 841.902853 | Geçti |
| Z10 | Genel sınır | 4 | 8441 | 833.574813 | Geçti |
| Z100 | Daire | 1 | 52188 | 731.636621 | Geçti |
| Z101 | Daire | 1 | 52609 | 925.276911 | Geçti |
| Z102 | Daire | 1 | 52064 | 784.068858 | Geçti |
| Z103 | Daire | 1 | 52657 | 914.961183 | Geçti |
| Z104 | Daire | 1 | 52126 | 756.184265 | Geçti |
| Z1000 | Genel sınır | 1 | 17712 | 752.272640 | Geçti |
| Z1001 | Genel sınır | 1 | 10192 | 660.134517 | Geçti |
| Z1002 | Genel sınır | 1 | 34067 | 858.208912 | Geçti |
| Z1003 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1004 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1005 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1006 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1007 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1008 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1009 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1010 | Genel sınır | 4 | 5788 | 238.310124 | Geçti |
| Z1011 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1012 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1013 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1014 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1015 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1016 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1017 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1018 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1019 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1020 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1021 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1022 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1023 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1024 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1025 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1026 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1027 | Alan düzeltmesi gerekli | — | — | — | Sonuç üretilmedi |
| Z1028 | Daire | 1 | 61490 | 895.896943 | Geçti |
| Z1029 | Daire | 1 | 61699 | 863.426279 | Geçti |
| Z1030 | Daire | 1 | 61927 | 850.637945 | Geçti |
| Z1031 | Daire | 1 | 62254 | 851.047130 | Geçti |
| Z1032 | Daire | 1 | 62084 | 813.259648 | Geçti |
| Z1033 | Daire | 1 | 62046 | 812.996132 | Geçti |
| Z1034 | Daire | 1 | 62051 | 850.409147 | Geçti |
| Z1035 | Daire | 1 | 62046 | 842.096090 | Geçti |
| Z1036 | Daire | 1 | 62109 | 828.891884 | Geçti |
| Z1037 | Daire | 1 | 62151 | 818.710125 | Geçti |
| Z1038 | Daire | 1 | 62235 | 1094.088471 | Geçti |
| Z1039 | Daire | 1 | 62226 | 1092.283386 | Geçti |
| Z1040 | Daire | 1 | 62284 | 1096.118136 | Geçti |
| Z1041 | Daire | 1 | 62219 | 1095.333998 | Geçti |
| Z1042 | Daire | 1 | 62337 | 1094.066638 | Geçti |
| Z1043 | Daire | 1 | 61954 | 1035.691384 | Geçti |
| Z1044 | Daire | 1 | 62315 | 1095.585365 | Geçti |
