import type { ImageMediaType } from "../../core/contracts/index.ts";

/** Chunks a sanitized WebP may contain; anything else (EXIF, XMP , ICCP, ANIM...) is a regression. */
export const ALLOWED_WEBP_CHUNKS = ["VP8 ", "VP8L", "VP8X", "ALPH"] as const;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG = [0xff, 0xd8, 0xff] as const;
const GPS_IFD_POINTER = 0x8825;
const EXIF_PREFIX = "Exif\0\0";

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean =>
  bytes.length >= at + signature.length && signature.every((byte, i) => bytes[at + i] === byte);

const fourcc = (bytes: Uint8Array, at: number): string =>
  String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);

/** PNG 89 50 4E 47 0D 0A 1A 0A; JPEG FF D8 FF; WebP "RIFF" ???? "WEBP". Content that is not one of the three: null. */
export function sniffImageType(bytes: Uint8Array): ImageMediaType | null {
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  if (bytes.length >= 12 && fourcc(bytes, 0) === "RIFF" && fourcc(bytes, 8) === "WEBP") {
    return "image/webp";
  }
  return null;
}

/** FourCC of every top-level RIFF chunk of a WebP, in order (bounds-checked; malformed -> null). */
export function webpChunks(bytes: Uint8Array): string[] | null {
  if (sniffImageType(bytes) !== "image/webp") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = Math.min(bytes.length, 8 + view.getUint32(4, true));
  const chunks: string[] = [];
  let offset = 12;
  while (offset < end) {
    if (offset + 8 > end) return null;
    const size = view.getUint32(offset + 4, true);
    const next = offset + 8 + size + (size % 2); // chunks are padded to an even size
    if (offset + 8 + size > end) return null;
    chunks.push(fourcc(bytes, offset));
    offset = next;
  }
  return chunks;
}

/** TIFF header (II/MM) + IFD0 entries: true when tag 0x8825 (GPS IFD pointer) is present. An "Exif\0\0" prefix is skipped. */
export function exifHasGps(exif: Uint8Array): boolean {
  const prefixed =
    fourcc(exif, 0) + String.fromCharCode(exif[4] ?? 1, exif[5] ?? 1) === EXIF_PREFIX;
  const tiff = prefixed ? exif.subarray(6) : exif;
  if (tiff.length < 8) return false;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return false;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (view.getUint16(2, little) !== 42) return false;
  const ifd = view.getUint32(4, little);
  if (ifd + 2 > tiff.length) return false;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return false;
    if (view.getUint16(entry, little) === GPS_IFD_POINTER) return true;
  }
  return false;
}
