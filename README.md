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

1. PNG, JPG veya tek kesitli CT DICOM yükleyin.
2. Gerekirse piksel boyutunu ve kenar payını belirtin.
3. **Kesiti analiz et** düğmesine basın.
4. Kesikli turuncu numune sınırını ve yeşil ölçüm alanını kontrol edin. Otomatik seçim bir öneridir. Elle seçim seçeneğiyle X/Y merkezi ve yarıçapı değiştirin; görüntüye tıklayarak merkezi taşıyabilirsiniz. Değişikliklerden sonra yeniden analiz edin.
5. Sonuçları inceleyin ve **Excel raporunu indir** ile dört sayfalı raporu alın.

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

Girdi sınırları: 20 MB, varsayılan 16.777.216 piksel (4096 × 4096), istek başına bir dosya. Piksel sınırı zorunlu değildir: `MAX_IMAGE_PIXELS` ortam değişkeniyle değiştirilebilir; `0` uygulamanın piksel sınırını kapatır. Görüntüler küçültülmeden, özgün çözünürlükte analiz edilir. Daha büyük görüntüler daha fazla bellek ve işlem süresi gerektirir. Dosya boyutu sınırı piksel sınırından bağımsızdır. Çember görüntü içinde olmalıdır. Rastgele şekiller, dikdörtgen numuneler ve numunenin görünmediği kesitler için otomatik daire seçimi uygun değildir.

Örnek Excel `Z01_CT_Sayilari.xlsx` bir çıktı referansı olarak kullanıldı. Dosyadaki ölçümler kodda sabit değildir; her yükleme kendi piksel verisinden hesaplanır. Excel'e gömülü PNG ile orijinal DICOM tablosundaki değerlerin birebir yeniden üretilmesi beklenmemelidir.

## API

- `POST /api/analyze`: `multipart/form-data`, `file` alanı ve isteğe bağlı ölçüm ayarları. JSON sonuç döndürür.
- `POST /api/export`: Aynı dosya ve ayarları alır; XLSX raporu döndürür.
- `GET /health`: `{ "status": "ok" }`.

İsteğe bağlı alanlar:

| Alanlar | Açıklama |
| --- | --- |
| `centerX`, `centerY`, `radius` | Elle ROI; üçü birlikte, piksel cinsinden |
| `insetPixels` | Sıfır veya pozitif kenar payı |
| `spacingX`, `spacingY` | PNG/JPG için pozitif mm/piksel değerleri; birlikte |
| `windowMin`, `windowMax` | PNG/JPG için yaklaşık HU dönüşümü; birlikte |

Rapor sayfaları: **CT Sayıları**, **DICOM Bilgileri**, **Histogram (Numune)**, **Ölçüm Alanı**. Son sayfada işaretli kesit önizlemesi bulunur. PNG/JPG raporlarında DICOM Bilgileri sayfası yalnızca mevcut kaynak ve kalibrasyon bilgilerini içerir.

## Doğrulama

```bash
npm run build
npm run lint
npm test
npm run test:e2e
```

Testler bilinen sayısal istatistikleri, sentetik daire seçimini, gri ton / yaklaşık HU ayrımını, DICOM signed piksel dönüşümünü, padding dışlamasını, alan hesabını, geçersiz girdi hatalarını ve gerçek XLSX üretimini doğrular. HTTP testleri geçici yerel port açar.

Ek olarak Chrome'da örnek PNG yükleme, otomatik/elle ölçüm alanı, yaklaşık HU, Excel indirme ve 390 px mobil genişlik akışı kontrol edildi. Gerçek özgün DICOM dosyası henüz sağlanmadığı için o dosyayla referans doğrulaması yapılmadı.

## Yapı

- `public/`: Türkçe web arayüzü, canvas önizlemesi ve histogram.
- `src/analysis/`: Dosya çözümleme, ölçüm hesapları, yükleme API'si ve Excel üretimi.
- `test/`: HTTP testleri ve bellekte oluşturulan DICOM test verisi.

Kullanılan temel paketler: [NestJS](https://docs.nestjs.com/), [sharp](https://sharp.pixelplumbing.com/), [dicom-parser](https://github.com/cornerstonejs/dicomParser), [ExcelJS](https://github.com/exceljs/exceljs). ExcelJS'in dolaylı `uuid` bağımlılığı güvenlik düzeltmesi içeren 11.x sürümüne sabitlenmiştir; XLSX üretimi bu sürümle test edilmiştir.
