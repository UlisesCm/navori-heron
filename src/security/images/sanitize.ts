import type { ImageMediaType, MetadataBlock } from "../../core/contracts/index.ts";
import { ALLOWED_WEBP_CHUNKS, exifHasGps, sniffImageType, webpChunks } from "./magic.ts";

export type ImageLimits = { maxBytes: number; maxPixels: number };
export type SanitizedImage = {
  bytes: Uint8Array;
  width: number;
  height: number; // after EXIF orientation
  original: { mediaType: ImageMediaType; bytes: number };
  removedMetadata: MetadataBlock[];
};
export type SanitizeResult =
  | { ok: true; image: SanitizedImage }
  | {
      ok: false;
      code:
        | "UNSUPPORTED_MEDIA_TYPE"
        | "INPUT_TOO_LARGE"
        | "IMAGE_UNREADABLE"
        | "IMAGE_ENGINE_UNAVAILABLE";
      message: string;
    };
/** Never throws. */
export interface ImageSanitizer {
  sanitize(bytes: Uint8Array, limits: ImageLimits): Promise<SanitizeResult>;
}
export const WEBP_OPTIONS = { quality: 82, effort: 4 } as const;

type SharpFactory = (typeof import("sharp"))["default"];
const FORMAT_TYPES: Readonly<Record<string, ImageMediaType>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const reject = (
  code: Extract<SanitizeResult, { ok: false }>["code"],
  message: string,
): SanitizeResult => ({ ok: false, code, message });
const detail = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The only importer of "sharp": a literal dynamic import so init/status never pay for (or fail on) the native binary. */
export const loadSharp = async (): Promise<SharpFactory> => (await import("sharp")).default;

/** Present blocks of the original, in METADATA_BLOCKS order. */
function presentBlocks(meta: {
  exif?: Uint8Array | undefined;
  xmp?: Uint8Array | undefined;
  iptc?: Uint8Array | undefined;
  icc?: Uint8Array | undefined;
}): MetadataBlock[] {
  const blocks: MetadataBlock[] = [];
  if (meta.exif !== undefined) {
    blocks.push("exif");
    if (exifHasGps(meta.exif)) blocks.push("gps");
  }
  if (meta.xmp !== undefined) blocks.push("xmp");
  if (meta.iptc !== undefined) blocks.push("iptc");
  if (meta.icc !== undefined) blocks.push("icc");
  return blocks;
}

/** DR15 order: size -> magic bytes (before sharp, which would also accept SVG and GIF) -> sharp metadata() with
 * limitInputPixels -> sharp format equals the magic type -> autoOrient -> WebP without metadata -> output chunks check.
 * Only the first frame of an animation is kept. `load` is injectable so a missing native binary can be simulated. */
export function createSharpImageSanitizer(load: () => Promise<SharpFactory>): ImageSanitizer {
  let cached: SharpFactory | null = null;
  return {
    sanitize: async (bytes, limits) => {
      if (bytes.length > limits.maxBytes) {
        return reject("INPUT_TOO_LARGE", `The image exceeds ${limits.maxBytes} bytes.`);
      }
      const mediaType = sniffImageType(bytes);
      if (mediaType === null) {
        return reject("UNSUPPORTED_MEDIA_TYPE", "The file is not a PNG, JPEG or WebP image.");
      }
      try {
        cached ??= await load();
      } catch (error) {
        return reject(
          "IMAGE_ENGINE_UNAVAILABLE",
          `The image engine (sharp) could not be loaded: ${detail(error)}. Run: bun install --frozen-lockfile`,
        );
      }
      const sharp = cached;
      const open = () =>
        sharp(bytes, {
          limitInputPixels: limits.maxPixels,
          failOn: "error",
          pages: 1,
        });
      try {
        const meta = await open().metadata();
        if (FORMAT_TYPES[meta.format ?? ""] !== mediaType) {
          return reject(
            "UNSUPPORTED_MEDIA_TYPE",
            "The image content does not match its signature.",
          );
        }
        const { data, info } = await open()
          .autoOrient()
          .webp({ quality: WEBP_OPTIONS.quality, effort: WEBP_OPTIONS.effort })
          .toBuffer({ resolveWithObject: true });
        const output = new Uint8Array(data);
        const chunks = webpChunks(output);
        if (
          chunks === null ||
          chunks.some((chunk) => !ALLOWED_WEBP_CHUNKS.some((ok) => ok === chunk))
        ) {
          return reject("IMAGE_UNREADABLE", "The re-encoded image still carries metadata chunks.");
        }
        return {
          ok: true,
          image: {
            bytes: output,
            width: info.width,
            height: info.height,
            original: { mediaType, bytes: bytes.length },
            removedMetadata: presentBlocks(meta),
          },
        };
      } catch (error) {
        const message = detail(error);
        return message.includes("pixel limit")
          ? reject("INPUT_TOO_LARGE", `The image has more than ${limits.maxPixels} pixels.`)
          : reject("IMAGE_UNREADABLE", `The image could not be decoded: ${message}.`);
      }
    },
  };
}

export const sharpImageSanitizer: ImageSanitizer = createSharpImageSanitizer(loadSharp);
