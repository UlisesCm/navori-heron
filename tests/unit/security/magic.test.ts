// Covers: R11
import { describe, expect, test } from "bun:test";
import {
  ALLOWED_WEBP_CHUNKS,
  exifHasGps,
  sniffImageType,
  webpChunks,
} from "../../../src/security/images/magic.ts";

const ascii = (text: string): number[] => [...text].map((ch) => ch.charCodeAt(0));
const u32 = (value: number): number[] => [
  value & 255,
  (value >> 8) & 255,
  (value >> 16) & 255,
  value >>> 24,
];

/** RIFF/WEBP container with the given [fourcc, payload size] chunks (zero filled, padded to even). */
function webp(chunks: [string, number][], declaredExtra = 0): Uint8Array {
  const body = chunks.flatMap(([id, size]) => [
    ...ascii(id),
    ...u32(size),
    ...Array.from({ length: size + (size % 2) }, () => 0),
  ]);
  return Uint8Array.from([
    ...ascii("RIFF"),
    ...u32(4 + body.length + declaredExtra),
    ...ascii("WEBP"),
    ...body,
  ]);
}

/** TIFF with one IFD0 containing the given tags; `prefix` adds the "Exif\0\0" header. */
function exif(tags: number[], little: boolean, prefix = false): Uint8Array {
  const u16 = (n: number): number[] => (little ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const long = (n: number): number[] =>
    little ? u32(n) : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const entries = tags.flatMap((tag) => [...u16(tag), ...u16(3), ...long(1), ...u16(0), ...u16(0)]);
  const tiff = [
    ...ascii(little ? "II" : "MM"),
    ...u16(42),
    ...long(8),
    ...u16(tags.length),
    ...entries,
    ...long(0),
  ];
  return Uint8Array.from(prefix ? [...ascii("Exif"), 0, 0, ...tiff] : tiff);
}

describe("image magic bytes", () => {
  test("detects image types, webp chunks and exif gps", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(webp([["VP8 ", 10]]))).toBe("image/webp");
    for (const other of [
      ascii("GIF89a"),
      ascii("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      ascii("plain text"),
      [0x89, 0x50, 0x4e, 0x47], // truncated PNG signature
      [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")],
      [...ascii("RIFF"), 0, 0],
      [],
    ]) {
      expect(sniffImageType(Uint8Array.from(other))).toBeNull();
    }

    expect(
      webpChunks(
        webp([
          ["VP8X", 10],
          ["VP8 ", 7],
          ["ALPH", 3],
        ]),
      ),
    ).toEqual(["VP8X", "VP8 ", "ALPH"]);
    // metadata chunks are reported, so the sanitizer can refuse them
    expect(
      webpChunks(
        webp([
          ["VP8L", 6],
          ["EXIF", 4],
          ["XMP ", 5],
          ["ICCP", 2],
        ]),
      ),
    ).toEqual(["VP8L", "EXIF", "XMP ", "ICCP"]);
    expect(ALLOWED_WEBP_CHUNKS).toEqual(["VP8 ", "VP8L", "VP8X", "ALPH"]);
    // malformed containers: not WebP, a chunk running past the end, a truncated header
    expect(webpChunks(png)).toBeNull();
    const overrun = webp([["VP8 ", 10]]);
    expect(webpChunks(overrun.subarray(0, overrun.length - 6))).toBeNull();
    expect(
      webpChunks(Uint8Array.from([...ascii("RIFF"), ...u32(10), ...ascii("WEBP"), 1, 2, 3])),
    ).toBeNull();
    expect(webpChunks(webp([]))).toEqual([]);
    // a declared size larger than the file is bounded by the file
    expect(webpChunks(webp([["VP8 ", 4]], 100))).toEqual(["VP8 "]);

    for (const little of [true, false]) {
      expect(exifHasGps(exif([0x010f, 0x8825], little))).toBe(true);
      expect(exifHasGps(exif([0x010f, 0x0112], little))).toBe(false);
      expect(exifHasGps(exif([0x8825], little, true))).toBe(true);
    }
    expect(exifHasGps(Uint8Array.from(ascii("XX*\0\0\0\0\0\0")))).toBe(false);
    expect(exifHasGps(Uint8Array.from([0x49, 0x49, 43, 0, 8, 0, 0, 0, 0, 0]))).toBe(false);
    expect(exifHasGps(Uint8Array.from([0x49, 0x49, 42, 0, 255, 0, 0, 0]))).toBe(false); // IFD offset out of range
    const truncated = exif([0x010f, 0x8825], true);
    expect(exifHasGps(truncated.subarray(0, truncated.length - 20))).toBe(false); // entry past the end
    expect(exifHasGps(Uint8Array.from([1, 2, 3]))).toBe(false);
  });
});
