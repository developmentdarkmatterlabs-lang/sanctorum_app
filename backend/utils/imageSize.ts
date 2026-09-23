/** The sprite sheet format the renderer assumes: 4 columns x 4 rows of cells. */
export const SPRITE_SHEET = {
  cell: 48,
  columns: 4,
  rows: 4,
  get width() {
    return this.cell * this.columns;
  },
  get height() {
    return this.cell * this.rows;
  },
} as const;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type ImageSize = { width: number; height: number };

/**
 * Reads width/height from a PNG's IHDR chunk. Returns null if the buffer is
 * not a PNG. Avoids pulling in an image library just to check dimensions.
 */
export function readPngSize(buffer: Buffer): ImageSize | null {
  // 8-byte magic + 4-byte length + "IHDR" + 8 bytes of dimensions
  if (buffer.length < 24) return null;
  if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) return null;
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

/**
 * Reads width/height from a JPEG by walking its marker segments to the frame
 * header (SOF0..SOF15). Returns null if not a JPEG or no frame is found.
 */
export function readJpegSize(buffer: Buffer): ImageSize | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null; // SOI

  let offset = 2;
  while (offset < buffer.length) {
    // Markers are 0xFF followed by a type byte; skip any fill 0xFF bytes.
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    let marker = buffer[offset + 1];
    while (marker === 0xff && offset + 1 < buffer.length) {
      offset++;
      marker = buffer[offset + 1];
    }
    offset += 2;

    // Standalone markers (RSTn, SOI, EOI, TEM) carry no length.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > buffer.length) return null;
    const segLen = buffer.readUInt16BE(offset);

    // SOF0..SOF15 (except DHT 0xC4, DAC 0xCC, and RSTn) hold the dimensions.
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (offset + 7 > buffer.length) return null;
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += segLen;
  }
  return null;
}

export type ImageKind = 'png' | 'jpeg';

/** Reads dimensions of a PNG or JPEG, plus which it is. Null if neither. */
export function readImageSize(
  buffer: Buffer
): (ImageSize & { kind: ImageKind }) | null {
  const png = readPngSize(buffer);
  if (png) return { ...png, kind: 'png' };
  const jpeg = readJpegSize(buffer);
  if (jpeg) return { ...jpeg, kind: 'jpeg' };
  return null;
}
