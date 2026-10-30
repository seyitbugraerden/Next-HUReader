# HUReader

NestJS + TypeScript ile CT kesiti / numune görseli analiz uygulaması. Türkçe web arayüzü, dosya yükleme, dairesel ölçüm alanı, sayısal ölçümler, histogram ve Excel raporu içerir.

## Çalıştırma

Node.js 24.15+ veya 26+ ve npm gerekir.

```bash
npm ci
npm run start:dev
```

http://localhost:3000 adresini açın. Portu değiştirmek için `PORT=4000 npm run start:dev` kullanın. `.env.example` değişkenleri gösterir; `.env` otomatik yüklenmez. Örneğin `MAX_IMAGE_PIXELS=33554432 npm run start:dev` sınırı 33.554.432 piksele yükseltir; `MAX_IMAGE_PIXELS=0 npm run start:dev` uygulama piksel sınırını kapatır.

Üretim derlemesini çalıştırmak için:

```bash
npm run build
npm run start:prod
```

`public/` klasörünü de dağıtıma dahil edin. Bu uygulama yerel kullanım için hazırlanmıştır; hesap, veri tabanı veya geçmiş kayıtları içermez. Yüklenen dosyalar sunucu belleğinde işlenir, diske yazılmaz.

## Kullanım

1. **Görüntü yükle:** Bir veya birden fazla PNG, JPG veya tek kesitli CT DICOM seçin. **Klasör seç** düğmesiyle bir klasörü alt klasörleriyle birlikte de ekleyebilirsiniz. Yeni seçimler dosya kuyruğuna eklenir; dosyaları listeden ayrı ayrı kaldırabilirsiniz. **Ölçüm ayarlarına geç** ile ikinci aşamayı açın.
2. **Ölçüm alanını incele:** Dosya seçicisinden incelemek istediğiniz kesiti seçin. Gerekirse piksel boyutunu, kenar payını ve çemberi ayarlayın. **Ölçümü hesapla** yalnızca seçili dosyayı, **Tüm dosyaları analiz et** güncel sonucu olmayan dosyaları sırayla işler. Her dosya kendi ayarlarını korur; bir dosya hata verdiğinde sıradaki dosyaya geçilir.
3. Kesikli turuncu numune sınırını ve yeşil ölçüm alanını kontrol edin. Otomatik seçim bir öneridir. Elle seçimle X/Y merkezi ve yarıçapı değiştirin; görüntüye tıklayarak merkezi taşıyabilirsiniz. Değişikliklerden sonra yeniden hesaplayın.
4. **Sonuçlara geç** ile üçüncü aşamayı açın. En az bir güncel başarılı ölçüm varsa bu aşama kullanılabilir. Üstte tüm dosyaların durumu ve karşılaştırma tablosu, altta seçilen başarılı dosyanın ayrıntıları görünür. **Excel raporunu indir** seçilen dosyanın dört sayfalı raporunu, **Toplu Excel indir** tüm güncel başarılı sonuçların altı sayfalı raporunu üretir.

Üstteki sekmeler ve geri düğmeleriyle önceki aşamalara dönebilirsiniz. Aynı dosya için ayarlar korunur. Dosya seçilmeden ikinci, en az bir başarılı hesaplama yapılmadan üçüncü aşama açılmaz. Bir dosyanın ayarları değişirse o dosyanın eski ölçümü toplu tablodan ve Excel ölçümlerinden çıkarılır; diğer dosyaların güncel sonuçları korunur. Yeni eklenen dosyalar boş ayarlar ve otomatik alan seçimiyle başlar. Dosyalar sırayla, tek dosyalı analiz API’si üzerinden işlenir; istek başına tek dosya sınırı toplu dosya seçimini engellemez. Kuyruk ve sonuçlar yalnızca açık tarayıcı sekmesinde tutulur; sayfa yenilendiğinde temizlenir.

Klasör seçiminde PNG/JPG, `.dcm`/`.dicom`/`.ima` dosyaları ve başlığında DICOM Part 10 imzası bulunan uzantısız/sayısal uzantılı dosyalar tanınır. Diğer biçimler ve gizli dosyalar atlanır; eklenen, atlanan ve zaten listede olan dosya sayıları gösterilir. Aynı göreli yol, boyut ve son değiştirme bilgisine sahip tekrar seçimler kuyruğa yeniden eklenmez. Dosyalar göreli yola göre doğal sırada listelenir. Alt klasörlerde aynı adı taşıyan dosyalar ayrı tutulur; yollar önizlemede, karşılaştırma tablosunda ve her iki Excel raporunda korunur.

Klasör seçimi tarayıcının kullanıcı tarafından seçilen dosyalarına dayanır; sunucuya mutlak bir disk yolu verilmez. Seçim anlık bir taramadır, klasör izleme hizmeti değildir. Yeni dosyalar eklenince klasörü tekrar seçin. Klasör seçimini desteklemeyen tarayıcılarda çoklu dosya seçimi kullanılabilir. Tarayıcı özelliği: [MDN — webkitdirectory](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/webkitdirectory).

Sekmeler sol/sağ ok, Home ve End tuşlarıyla kullanılabilir. Önizlemedeki tam ekran düğmesiyle kesiti büyütebilir, **Kullanım rehberi** düğmesiyle kısa açıklamaları açabilirsiniz. Ölçüm notları sonuçlar bölümünde açılıp kapatılabilir. Arayüz masaüstü ve mobil ekranlara uyarlanır.

## Ölçümler

- Kenar payı uygulanmış numune, tam numune ve tüm geçerli görüntü için piksel sayısı, alan, ortalama, popülasyon standart sapması, medyan, minimum, maksimum ve %5/%95 yüzdelikleri.
- İç ölçüm alanında üst/alt ve sol/sağ yarılar; iç yarıçapın 1/4 ve 1/2 merkez bölgeleri.
- Kenar payı uygulanmış numune histogramı. Sınıflar alt sınırı dahil, üst sınırı hariç olacak şekilde oluşturulur. Tüm ölçüm pikselleri kapsanır.
- Yüzdelikler sıralı veride doğrusal enterpolasyonla hesaplanır. Boş bölgeler sıfır yerine boş değer döndürür.
- Alan = geçerli piksel sayısı × piksel boyutu X × piksel boyutu Y. Piksel boyutu bilinmiyorsa mm² hesaplanmaz.

## Giriş biçimleri ve ölçüm birimleri

**DICOM:** Part 10 başlığı olan, tek kareli, tek kanallı, sıkıştırılmamış 8/16 bit CT desteklenir. Implicit VR Little Endian, Explicit VR Little Endian ve Explicit VR Big Endian kabul edilir. HU = ham piksel × RescaleSlope + RescaleIntercept. DICOM PixelSpacing ve PixelPadding bilgileri kullanılır; hasta kimlik bilgileri sonuçlara taşınmaz. Desteklenmeyen sıkıştırma, çok kare, LUT ve HU dışı birim durumları açık hata verir. RescaleType yoksa CT modalitesine dayanıldığı raporda belirtilir. Yalnızca tek, klasik CT kesiti desteklenir; Enhanced CT desteği yoktur.

**PNG/JPG:** Siyah arka plan üzerine düzleştirilmiş, 8 bit gri ton yoğunluğu (0–255) analiz edilir. Bu değerler HU değildir. Bilinen pencere alt/üst sınırları birlikte girilirse doğrusal dönüşümle **yaklaşık HU** gösterilir. Pencere dönüşümünün doğrusal olduğu varsayılır; kayıplı sıkıştırma, gama/renk dönüşümleri, pencere uçlarında kırpılma, yeniden boyutlandırma ve görüntü üzerindeki işaretler nedeniyle özgün DICOM sonuçları elde edilemez. Tam sayısal analiz için işaretlenmemiş özgün DICOM gerekir.

PNG/JPG piksel boyutu isteğe bağlı girilir. DICOM'da kullanıcı piksel boyutu ve pencere kalibrasyonu alanları kullanılmaz; dosyadaki değerler esastır. DICOM önizlemesi −1000 … +1000 HU aralığındadır, ölçümler bu görüntüleme aralığıyla kırpılmaz.

Varsayılan kenar payı: piksel boyutu varsa 2,1 mm, yoksa 10 piksel. Çember piksel koordinatlarındadır; anizotropik piksellerde kenar payı küçük piksel boyutuna göre hesaplanır ve uyarı gösterilir. Kullanıcı özel kenar payını piksel cinsinden belirleyebilir.

Girdi sınırları: dosya başına 20 MB, varsayılan 16.777.216 piksel (4096 × 4096), istek başına bir dosya. Piksel sınırı zorunlu değildir: `MAX_IMAGE_PIXELS` ortam değişkeniyle değiştirilebilir; `0` uygulamanın piksel sınırını kapatır. Görüntüler küçültülmeden, özgün çözünürlükte analiz edilir. Daha büyük görüntüler daha fazla bellek ve işlem süresi gerektirir. Dosya boyutu sınırı piksel sınırından bağımsızdır. Çember görüntü içinde olmalıdır. Rastgele şekiller, dikdörtgen numuneler ve numunenin görünmediği kesitler için otomatik daire seçimi uygun değildir.

Örnek Excel `Z01_CT_Sayilari.xlsx` bir çıktı referansı olarak kullanıldı. Dosyadaki ölçümler kodda sabit değildir; her yükleme kendi piksel verisinden hesaplanır. Excel'e gömülü PNG ile orijinal DICOM tablosundaki değerlerin birebir yeniden üretilmesi beklenmemelidir.

## API

- `POST /api/analyze`: `multipart/form-data`, `file` alanı ve isteğe bağlı ölçüm ayarları. JSON sonuç döndürür.
- `POST /api/export`: Aynı dosya ve ayarları alır; XLSX raporu döndürür.
- `GET /health`: `{ "status": "ok" }`.

İsteğe bağlı alanlar:

| Alanlar | Açıklama |
| --- | --- |
| `sourcePath` | İsteğe bağlı göreli dosya yolu; yalnızca sonuç/rapor etiketi olarak kullanılır |
| `centerX`, `centerY`, `radius` | Elle ROI; üçü birlikte, piksel cinsinden |
| `insetPixels` | Sıfır veya pozitif kenar payı |
| `spacingX`, `spacingY` | PNG/JPG için pozitif mm/piksel değerleri; birlikte |
| `windowMin`, `windowMax` | PNG/JPG için yaklaşık HU dönüşümü; birlikte |

Tek dosyalı rapor sayfaları: **CT Sayıları**, **DICOM Bilgileri**, **Histogram (Numune)**, **Ölçüm Alanı**. Son sayfada işaretli kesit önizlemesi bulunur. PNG/JPG raporlarında DICOM Bilgileri sayfası yalnızca mevcut kaynak ve kalibrasyon bilgilerini içerir.

Toplu rapor sayfaları: **CT Sayıları**, **Bölgesel Ortalamalar**, **Kaynak Bilgileri**, **Histogram (Numune)**, **Ölçüm Alanı**, **İşlem Durumu**. Her satır dosya sırası ve adıyla ilişkilidir; HU, yaklaşık HU ve gri ton değerleri birim sütununda ayrı belirtilir. Hatalı, bekleyen ve güncelliğini kaybeden dosyalar yalnızca durum sayfasında listelenir. Alan sayfasında her başarılı dosyanın işaretli önizlemesi bulunur. Toplu Excel, tekrar yükleme veya analiz yapmadan tarayıcıdaki güncel sonuçlardan ExcelJS ile hazırlanır; paket yerel sunucudaki `/vendor/exceljs.min.js` adresinden yüklenir.

## Doğrulama

```bash
npm run build
npm run lint
npm test
npm run test:e2e
```

Testler bilinen sayısal istatistikleri, sentetik daire seçimini, gri ton / yaklaşık HU ayrımını, DICOM signed piksel dönüşümünü, padding dışlamasını, alan hesabını, geçersiz girdi hatalarını ve gerçek XLSX üretimini doğrular. HTTP testleri geçici yerel port açar.

Ek olarak Chrome’da çoklu dosya seçimi, bağımsız ROI ve kalibrasyon ayarları, hata izolasyonu, tek dosya yeniden denemesi, toplu Excel’de birim/sayfa/önizleme doğruluğu, eski ölçümlerin dışlanması ve 320–1440 px genişliklerde üç aşamalı akış kontrol edildi. Klasör seçimi ayrıca gerçek iç içe test klasörüyle; uzantısız DICOM, aynı adlı dosyalar, filtreleme, tekrar seçim ve Excel yol bilgileri açısından doğrulandı. Gerçek özgün DICOM dosyası henüz sağlanmadığı için o dosyayla referans doğrulaması yapılmadı.

## Yapı

- `public/`: Türkçe web arayüzü, canvas önizlemesi ve histogram.
- `src/analysis/`: Dosya çözümleme, ölçüm hesapları, yükleme API'si ve Excel üretimi.
- `test/`: HTTP testleri ve bellekte oluşturulan DICOM test verisi.

Kullanılan temel paketler: [NestJS](https://docs.nestjs.com/), [sharp](https://sharp.pixelplumbing.com/), [dicom-parser](https://github.com/cornerstonejs/dicomParser), [ExcelJS](https://github.com/exceljs/exceljs). ExcelJS'in dolaylı `uuid` bağımlılığı güvenlik düzeltmesi içeren 11.x sürümüne sabitlenmiştir; XLSX üretimi bu sürümle test edilmiştir.
