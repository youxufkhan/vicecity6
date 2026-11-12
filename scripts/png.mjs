import { inflateSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';

/** Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) for visual checks. */
export async function readPng(path) {
  const buf = await readFile(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
      if (interlace !== 0) throw new Error('interlaced png not supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);

  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      const v = line[x];
      let value;
      switch (filter) {
        case 0:
          value = v;
          break;
        case 1:
          value = v + a;
          break;
        case 2:
          value = v + b;
          break;
        case 3:
          value = v + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          value = v + pred;
          break;
        }
        default:
          throw new Error(`bad filter ${filter}`);
      }
      cur[x] = value & 0xff;
    }
  }

  return {
    width,
    height,
    channels,
    pixel(x, y) {
      const i = (y * width + x) * channels;
      return [out[i], out[i + 1], out[i + 2]];
    },
    /** Average brightness over a region (0..255). */
    brightness(x0, y0, x1, y1) {
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const [r, g, b] = this.pixel(x, y);
          sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
          count++;
        }
      }
      return count ? sum / count : 0;
    },
  };
}
