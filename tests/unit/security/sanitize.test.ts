// Covers: R11
import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { exifHasGps, sniffImageType, webpChunks } from "../../../src/security/images/magic.ts";
import {
  WEBP_OPTIONS,
  createSharpImageSanitizer,
  loadSharp,
  sharpImageSanitizer,
  type ImageLimits,
} from "../../../src/security/images/sanitize.ts";

const LIMITS: ImageLimits = {
  maxBytes: 20 * 1024 * 1024,
  maxPixels: 50_000_000,
};
const canvas = (width = 40, height = 20) =>
  sharp({ create: { width, height, channels: 3, background: "#cf222e" } });
const SLOW = 15_000; // first sharp call loads the native binary

async function jpegWithMetadata(): Promise<Uint8Array> {
  return new Uint8Array(
    await canvas()
      .jpeg()
      .withExif({
        IFD0: { Copyright: "secret" },
        IFD3: { GPSLatitudeRef: "N" },
      })
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>')
      .withMetadata({ orientation: 6 })
      .toBuffer(),
  );
}

function ok(result: Awaited<ReturnType<typeof sharpImageSanitizer.sanitize>>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.message}`);
  return result.image;
}

describe("sharpImageSanitizer", () => {
  test(
    "re-encodes to WebP without metadata, applies orientation and reports removed blocks",
    async () => {
      const input = await jpegWithMetadata();
      const meta = await sharp(input).metadata();
      expect(meta.exif !== undefined && exifHasGps(meta.exif)).toBe(true);
      const image = ok(await sharpImageSanitizer.sanitize(input, LIMITS));
      expect(sniffImageType(image.bytes)).toBe("image/webp");
      expect(webpChunks(image.bytes)).toEqual(["VP8 "]);
      expect(image.original).toEqual({
        mediaType: "image/jpeg",
        bytes: input.length,
      });
      expect(image.removedMetadata).toEqual(["exif", "gps", "xmp", "icc"]);
      expect([image.width, image.height]).toEqual([20, 40]); // orientation 6 swaps the axes
      const out = await sharp(image.bytes).metadata();
      expect([out.exif, out.xmp, out.icc, out.iptc]).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
      // deterministic: same input, same bytes
      expect(ok(await sharpImageSanitizer.sanitize(input, LIMITS)).bytes).toEqual(image.bytes);
      expect(WEBP_OPTIONS).toEqual({ quality: 82, effort: 4 });
    },
    SLOW,
  );

  test(
    "accepts PNG and WebP and keeps only the first frame of an animation",
    async () => {
      const png = new Uint8Array(await canvas().png().toBuffer());
      expect(ok(await sharpImageSanitizer.sanitize(png, LIMITS)).original.mediaType).toBe(
        "image/png",
      );
      const webp = new Uint8Array(await canvas().webp().toBuffer());
      const fromWebp = ok(await sharpImageSanitizer.sanitize(webp, LIMITS));
      expect(fromWebp.original.mediaType).toBe("image/webp");
      expect(fromWebp.removedMetadata).toEqual([]);
      const frames = await sharp(
        Buffer.concat([await canvas(8, 8).raw().toBuffer(), await canvas(8, 8).raw().toBuffer()]),
        { raw: { width: 8, height: 16, channels: 3, pageHeight: 8 } },
      )
        .webp()
        .toBuffer();
      const animated = ok(await sharpImageSanitizer.sanitize(new Uint8Array(frames), LIMITS));
      expect(
        webpChunks(animated.bytes)?.every((chunk) =>
          ["VP8 ", "VP8L", "VP8X", "ALPH"].includes(chunk),
        ),
      ).toBe(true);
      expect([animated.width, animated.height]).toEqual([8, 8]);
    },
    SLOW,
  );

  test("rejects foreign content by magic bytes, size and pixel count before decoding", async () => {
    const reject = (bytes: Uint8Array, limits = LIMITS) =>
      sharpImageSanitizer.sanitize(bytes, limits);
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    );
    expect(await reject(svg)).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
    const gif = new Uint8Array(await canvas().gif().toBuffer());
    expect(await reject(gif)).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
    expect(await reject(new TextEncoder().encode("hello"))).toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "The file is not a PNG, JPEG or WebP image.",
    });
    const png = new Uint8Array(await canvas().png().toBuffer());
    expect(await reject(png, { ...LIMITS, maxBytes: png.length - 1 })).toMatchObject({
      ok: false,
      code: "INPUT_TOO_LARGE",
    });
    expect(await reject(png, { ...LIMITS, maxBytes: png.length })).toMatchObject({ ok: true });
    expect(await reject(png, { ...LIMITS, maxPixels: 799 })).toMatchObject({
      ok: false,
      code: "INPUT_TOO_LARGE",
      message: "The image has more than 799 pixels.",
    });
    // a tiny PNG that declares 9000 x 9000 is refused without decoding it
    const huge = new Uint8Array(await canvas(9000, 9000).png({ compressionLevel: 9 }).toBuffer());
    expect(huge.length).toBeLessThan(LIMITS.maxBytes);
    const started = performance.now();
    expect(await reject(huge)).toMatchObject({
      ok: false,
      code: "INPUT_TOO_LARGE",
    });
    expect(performance.now() - started).toBeLessThan(2_000);
    // a JPEG signature over garbage: engine error mapped, never thrown
    const garbage = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
    expect(await reject(garbage)).toMatchObject({
      ok: false,
      code: "IMAGE_UNREADABLE",
    });
    // a PNG signature on JPEG data is a mismatch
    const jpeg = new Uint8Array(await canvas().jpeg().toBuffer());
    const spoofed = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...jpeg]);
    expect(await reject(spoofed)).toMatchObject({ ok: false });
  }, 30_000);

  test(
    "reports a missing engine and retries the load on the next call",
    async () => {
      let attempts = 0;
      const sanitizer = createSharpImageSanitizer(() => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error("binary missing")) : loadSharp();
      });
      const png = new Uint8Array(await canvas().png().toBuffer());
      expect(await sanitizer.sanitize(png, LIMITS)).toEqual({
        ok: false,
        code: "IMAGE_ENGINE_UNAVAILABLE",
        message:
          "The image engine (sharp) could not be loaded: binary missing. Run: bun install --frozen-lockfile",
      });
      expect((await sanitizer.sanitize(png, LIMITS)).ok).toBe(true);
      expect((await sanitizer.sanitize(png, LIMITS)).ok).toBe(true);
      expect(attempts).toBe(2); // loaded once, then cached
      const notAnError = createSharpImageSanitizer(() => Promise.reject("plain"));
      expect(await notAnError.sanitize(png, LIMITS)).toMatchObject({
        code: "IMAGE_ENGINE_UNAVAILABLE",
        message: expect.stringContaining("plain"),
      });
    },
    SLOW,
  );
});
