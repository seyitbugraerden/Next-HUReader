// Minimal uncompressed Explicit VR Little Endian CT fixture, generated in memory.
export function dicomFixture(
  options: {
    signed?: boolean;
    padding?: boolean;
    compressed?: boolean;
    slope?: string;
    intercept?: string;
    frames?: string;
    imageType?: string;
  } = {},
): Buffer {
  function element(
    group: number,
    tag: number,
    vr: string,
    value: Buffer,
  ): Buffer {
    const wide = ['OB', 'OW', 'SQ', 'UN'].includes(vr);
    if (value.length % 2)
      value = Buffer.concat([value, Buffer.from([vr === 'UI' ? 0 : 32])]);
    const header = Buffer.alloc(wide ? 12 : 8);
    header.writeUInt16LE(group, 0);
    header.writeUInt16LE(tag, 2);
    header.write(vr, 4, 'ascii');
    if (wide) header.writeUInt32LE(value.length, 8);
    else header.writeUInt16LE(value.length, 6);
    return Buffer.concat([header, value]);
  }
  const text = (g: number, t: number, vr: string, v: string) =>
    element(g, t, vr, Buffer.from(v));
  const number = (g: number, t: number, v: number, signed = false) => {
    const b = Buffer.alloc(2);
    if (signed) b.writeInt16LE(v);
    else b.writeUInt16LE(v);
    return element(g, t, signed ? 'SS' : 'US', b);
  };
  const pixels = Buffer.alloc(8 * 8 * 2);
  for (let i = 0; i < 64; i++) {
    if (options.signed)
      pixels.writeInt16LE(i === 0 && options.padding ? -2000 : -100, i * 2);
    else pixels.writeUInt16LE(i === 0 && options.padding ? 0 : 1000, i * 2);
  }
  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.from('DICM'),
    text(
      2,
      0x10,
      'UI',
      options.compressed ? '1.2.840.10008.1.2.4.50' : '1.2.840.10008.1.2.1',
    ),
    ...(options.imageType ? [text(8, 0x08, 'CS', options.imageType)] : []),
    text(8, 0x60, 'CS', 'CT'),
    number(0x28, 2, 1),
    text(0x28, 4, 'CS', 'MONOCHROME2'),
    text(0x28, 8, 'IS', options.frames ?? '1'),
    number(0x28, 0x10, 8),
    number(0x28, 0x11, 8),
    text(0x28, 0x30, 'DS', '0.5\\0.25'),
    number(0x28, 0x100, 16),
    number(0x28, 0x101, 16),
    number(0x28, 0x102, 15),
    number(0x28, 0x103, options.signed ? 1 : 0),
    ...(options.padding
      ? [number(0x28, 0x120, options.signed ? -2000 : 0, options.signed)]
      : []),
    text(0x28, 0x1052, 'DS', options.intercept ?? '-1024'),
    text(0x28, 0x1053, 'DS', options.slope ?? '1'),
    text(0x28, 0x1054, 'LO', 'HU'),
    element(0x7fe0, 0x10, 'OW', pixels),
  ]);
}
