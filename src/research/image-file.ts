import type { ImageAsset, InputFileRecord, SecurityFinding } from "../core/contracts/index.ts";
import { sha256Hex } from "../core/store/hash.ts";
import { displayPath, readInputFile } from "./input-file.ts";
import {
  captureFailure,
  type CapturedFile,
  type CaptureFailure,
  type CaptureLimits,
  type CaptureServices,
  type InputFileRef,
} from "./ports.ts";

export type ImageCapture = {
  image: ImageAsset;
  file: CapturedFile;
  record: InputFileRecord; // basename + location of the input file (D28)
  securityFindings: SecurityFinding[]; // METADATA_REMOVED when removedMetadata != []
};

/** Reads one input image once (D28), sanitizes it from those same bytes and names the WebP by its sha256 (D15). Sanitizer
 * failures become CaptureFailure; never throws. */
export async function captureImageFile(request: {
  services: CaptureServices;
  file: InputFileRef;
  limits: CaptureLimits;
  assetsDir: "research/assets" | "brand/assets";
}): Promise<{ ok: true; capture: ImageCapture } | { ok: false; failure: CaptureFailure }> {
  const { services, limits } = request;
  const input = readInputFile({
    fs: services.fs,
    root: services.root,
    file: request.file,
    maxBytes: limits.maxImageBytes,
    externalExtensions: null,
  });
  if (!input.ok) return input;
  const shown = displayPath(request.file.path);
  const result = await services.images.sanitize(input.bytes, {
    maxBytes: limits.maxImageBytes,
    maxPixels: limits.maxImagePixels,
  });
  if (!result.ok) {
    const failed = (message: string) => captureFailure(result.code, message, [shown]);
    switch (result.code) {
      case "UNSUPPORTED_MEDIA_TYPE":
        return failed(`${shown} is not a PNG, JPEG or WebP image.`);
      case "INPUT_TOO_LARGE":
        return failed(
          result.message.includes("pixels")
            ? `${shown} has more than ${limits.maxImagePixels} pixels.`
            : `${shown} exceeds ${limits.maxImageBytes} bytes.`,
        );
      case "IMAGE_UNREADABLE":
        return failed(`${shown} could not be decoded: ${result.message}`);
      case "IMAGE_ENGINE_UNAVAILABLE":
        return failed(result.message);
    }
  }
  const { image } = result;
  const sha256 = sha256Hex(image.bytes);
  const path = `${request.assetsDir}/${sha256}.webp`;
  const asset: ImageAsset = {
    path,
    sha256,
    mediaType: "image/webp",
    width: image.width,
    height: image.height,
    bytes: image.bytes.length,
    trust: "untrusted",
    original: {
      sha256: sha256Hex(input.bytes),
      mediaType: image.original.mediaType,
      bytes: image.original.bytes,
    },
    removedMetadata: image.removedMetadata,
  };
  const removed = image.removedMetadata;
  const securityFindings: SecurityFinding[] =
    removed.length === 0
      ? []
      : [
          {
            code: "METADATA_REMOVED",
            severity: "info",
            message: `Removed ${removed.join(", ")} metadata from the imported image.`,
            path,
            offset: null,
            line: null,
            phrase: removed.join(","),
            rule: null,
          },
        ];
  return {
    ok: true,
    capture: {
      image: asset,
      file: { path, sha256, bytes: image.bytes },
      record: input.record,
      securityFindings,
    },
  };
}
