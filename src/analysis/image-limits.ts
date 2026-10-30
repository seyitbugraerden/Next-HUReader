import { BadRequestException } from '@nestjs/common';

export function imagePixelLimit(): number {
  const value = Number(process.env.MAX_IMAGE_PIXELS ?? 16_777_216);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      'MAX_IMAGE_PIXELS sıfır veya pozitif bir tam sayı olmalıdır.',
    );
  }
  return value;
}

export function checkImageDimensions(
  width: number,
  height: number,
  limit: number,
): void {
  if (!width || !height) {
    throw new BadRequestException('Görüntü boyutları okunamadı.');
  }
  if (limit > 0 && width * height > limit) {
    const format = new Intl.NumberFormat('tr-TR');
    throw new BadRequestException(
      `Görüntü ${width} × ${height} (${format.format(width * height)} piksel). Sunucunun ayarlı sınırı ${format.format(limit)} piksel; MAX_IMAGE_PIXELS ayarıyla yükseltilebilir.`,
    );
  }
}
