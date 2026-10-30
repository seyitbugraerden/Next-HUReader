import sharp from 'sharp';
import { decodeImage } from './image-decoder.js';
import { checkImageDimensions, imagePixelLimit } from './image-limits.js';
import { dicomFixture } from '../../test/fixtures.js';

afterEach(() => vi.unstubAllEnvs());

describe('Configurable image dimensions', () => {
  it('accepts an original-resolution PNG larger than the previous 1024² limit', async () => {
    vi.stubEnv('MAX_IMAGE_PIXELS', '16777216');
    const buffer = await sharp({
      create: { width: 1200, height: 1000, channels: 3, background: '#808080' },
    })
      .png()
      .toBuffer();
    const result = await decodeImage(buffer, {});
    expect(result.width).toBe(1200);
    expect(result.height).toBe(1000);
    expect(result.values.length).toBe(1_200_000);
    expect(result.values[0]).toBe(128);
  });

  it('reports dimensions and configured limit separately from invalid formats', async () => {
    vi.stubEnv('MAX_IMAGE_PIXELS', '100');
    const buffer = await sharp({
      create: { width: 11, height: 10, channels: 3, background: '#808080' },
    })
      .png()
      .toBuffer();
    await expect(decodeImage(buffer, {})).rejects.toThrow(
      '11 × 10 (110 piksel)',
    );
    await expect(decodeImage(Buffer.from('broken'), {})).rejects.toThrow(
      'Dosya okunamadı',
    );
    const gif = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#808080' },
    })
      .gif()
      .toBuffer();
    await expect(decodeImage(gif, {})).rejects.toThrow(
      'dosya biçimi desteklenmiyor',
    );
  });

  it('applies the configured limit to DICOM as well', async () => {
    vi.stubEnv('MAX_IMAGE_PIXELS', '63');
    await expect(decodeImage(dicomFixture(), {})).rejects.toThrow(
      '8 × 8 (64 piksel)',
    );
    vi.stubEnv('MAX_IMAGE_PIXELS', '64');
    expect((await decodeImage(dicomFixture(), {})).values.length).toBe(64);
  });

  it('supports explicitly disabling the pixel limit', async () => {
    vi.stubEnv('MAX_IMAGE_PIXELS', '0');
    expect(imagePixelLimit()).toBe(0);
    expect(() => checkImageDimensions(10000, 10000, 0)).not.toThrow();
    expect((await decodeImage(dicomFixture(), {})).values.length).toBe(64);
  });

  it('rejects invalid server configuration', () => {
    for (const value of ['-1', 'NaN', '1.5', 'Infinity']) {
      vi.stubEnv('MAX_IMAGE_PIXELS', value);
      expect(() => imagePixelLimit()).toThrow('MAX_IMAGE_PIXELS');
    }
  });
});
