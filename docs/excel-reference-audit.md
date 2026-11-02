# Excel referansının hesap mantığı

İncelenen kaynak: `/Users/admin/Downloads/Z01_CT_Sayilari.xlsx`.

## Kullanılabilecek yöntem

- HU = ham piksel × RescaleSlope + RescaleIntercept. Dosyadaki örnekte katsayılar 1 ve −1024; uygulama her yeni DICOM'un kendi katsayılarını kullanmalıdır.
- Üç ayrı ölçüm: kenar payı uygulanmış numune, kenar payı olmayan numune ve tüm geçerli görüntü pikselleri.
- Örnekte kenar payı 10 piksel / yaklaşık 2,1 mm. Başka görüntülerde piksel boyutu değiştiğinden 10 piksel sabitlenmemeli; fiziksel pay DICOM PixelSpacing değerinden çevrilmelidir. Uygulama varsayılan olarak 2,1 mm kullanır.
- Piksel sayısı, mm² alan, ortalama, standart sapma, medyan, minimum, maksimum, %5 ve %95 yüzdelikleri.
- Üst/alt ve sol/sağ yarı ortalamaları; daire için r/4 ve r/2 merkez bölgeleri. Dikdörtgen ve çokgende daireye özgü merkez bölgeleri uygulanmaz.
- Histogramın her sınıfı için yüzde = sınıf piksel sayısı / tüm ölçüm pikselleri × 100.
- Tarama dışı pikseller referansta −3024 HU olarak belirtilmiş. Bu değer bütün yeni dosyalara sabit dışlama kuralı olarak uygulanamaz; varsa DICOM Pixel Padding etiketleri kullanılmalıdır. Uygulama bu etiketleri okur; etiket yoksa dışlamanın yapılamadığını bildirir.

Mevcut uygulama bu yöntemi uygular. Şekle bağlı alan seçimi genişletilmiştir; ortalama ve diğer istatistikler seçilen geçerli piksel kümesinden hesaplanır.

## Doğrudan doğrulanan tutarlılık

- Dört sayfa var: CT Sayıları, DICOM Bilgileri, Histogram (Numune), Ölçüm Alanı.
- Histogram piksel toplamı **68.254**; kenar payı uygulanmış numune satırındaki piksel sayısı da **68.254**.
- Histogramdaki önceden hesaplanmış yüzdelerin toplamı kayan nokta yuvarlamasıyla **%100**.
- Çalışma kitabındaki 40 formülün tamamı histogram yüzdesi hesabına ait. Ana istatistikler ve bölgesel ortalamalar saklanmış sayısal sonuçlar; bunların hesap formülleri kitapta bulunmuyor.
- Ana tablodaki alan/piksel oranları yaklaşık **0,044495 mm²/piksel**; belgelenen yaklaşık 0,2109 × 0,2109 mm piksel boyutuyla yuvarlama düzeyinde tutarlı.

## Nelerin kanıtı değildir?

Kitapta homojen/homojen değil kabul eşiği, doğrulanmış boşluk HU eşiği, porozite formülü veya malzeme kalibrasyon eğrisi bulunmuyor. Kullanıcı, paylaşılan diğer görüntülerin de bu referansla aynı materyal özelliklerine sahip olduğunu doğruladı; bu nedenle mermer Excel örneği materyal referansı olarak kullanılabilir. Çekim, alan ve görüntü türü farkları yine ayrıca dikkate alınmalıdır.

Standart sapma ve yüzdelik hesaplarının uygulama ayrıntıları formül olarak verilmediğinden, Excel'den bunların örneklem/popülasyon veya yüzdelik enterpolasyon tanımı kesin olarak çıkarılamaz. Uygulamanın tercihi popülasyon standart sapması ve doğrusal enterpolasyonlu yüzdeliklerdir; bunlar ayrıca bağımsız sayısal hesaplarla test edilmiştir.

Excel'deki Z01, ORIGINAL / PRIMARY / AXIAL görüntü ve yaklaşık **0,2109 mm** piksel boyutuyla belgelenmiş. Son paylaşılan klasördeki Z01 ise DERIVED / SECONDARY / REFORMATTED / AVERAGE etiketli ve **1,406250119 mm** piksel boyutuna sahip. Dolayısıyla dosya adı eşleşmesi aynı kaynak görüntüyü tanımlamaz; ortalamaların eşit çıkması beklenemez. Kitaba gömülü PNG, özgün DICOM piksellerinin ve etiketlerinin yerini tutmaz.

Sonuç: Excel'in **ölçüm ve raporlama yöntemi** referans alınabilir. Sayısal çıktılardan malzemeye özel boşluk/homojenlik kararı üretmek için ek doğrulama gerekir. Yapay zekâ bu hesapları açıklayabilir, fakat kitapta olmayan eşikleri veya kabul kurallarını üretmemelidir.
