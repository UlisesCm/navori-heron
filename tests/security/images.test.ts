// Covers: R11
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { ExitCode } from "../../src/core/contracts/index.ts";
import {
  ALLOWED_WEBP_CHUNKS,
  exifHasGps,
  sniffImageType,
  webpChunks,
} from "../../src/security/images/magic.ts";
import { runCliCaptured } from "../helpers/cli.ts";
import { e2eSetup } from "../helpers/e2e.ts";
import { hashTree } from "../helpers/fixtures.ts";
import { readReferences, referenceArgs } from "../helpers/research.ts";

const { initialized } = e2eSetup();
const SLOW = 60_000; // sharp loads its native binary and one image is 7100 x 7100

const canvas = (width = 40, height = 20) =>
  sharp({ create: { width, height, channels: 3, background: "#cf222e" } });

const imageAdd = (root: string, file: string): string[] => [
  ...referenceArgs(root, ["source"]),
  "--source",
  "image",
  "--file",
  file,
];

const heron = (tree: Map<string, string>) =>
  [...tree].filter(([path]) => path.startsWith(".heron/"));

describe("imported images", () => {
  test(
    "sanitizes, bounds and deduplicates imported images",
    async () => {
      const root = await initialized("no-ux");

      // A JPEG with GPS, XMP and an orientation tag: the stored WebP carries none of it.
      const jpeg = new Uint8Array(
        await canvas()
          .jpeg()
          .withExif({ IFD0: { Copyright: "secret" }, IFD3: { GPSLatitudeRef: "N" } })
          .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>')
          .withMetadata({ orientation: 6 })
          .toBuffer(),
      );
      const meta = await sharp(jpeg).metadata();
      expect(meta.exif !== undefined && exifHasGps(meta.exif)).toBe(true);
      writeFileSync(join(root, "photo.jpg"), jpeg);
      const run = await runCliCaptured(imageAdd(root, join(root, "photo.jpg")));
      expect(run.code).toBe(ExitCode.Ok);
      expect(run.stdout).toContain("Removed metadata: exif, gps, xmp, icc");
      expect(run.stdout).toContain("(20x40, ");
      const reference = readReferences(root).references[0];
      if (reference?.capture.kind !== "image") throw new Error("expected an image capture");
      const asset = new Uint8Array(
        readFileSync(join(root, ".heron", reference.capture.image.path)),
      );
      expect(sniffImageType(asset)).toBe("image/webp");
      const chunks = webpChunks(asset) ?? [];
      expect(chunks.length).toBeGreaterThan(0);
      expect(
        chunks.every((chunk) => (ALLOWED_WEBP_CHUNKS as readonly string[]).includes(chunk)),
      ).toBe(true);
      const out = await sharp(asset).metadata();
      expect([out.exif, out.xmp, out.icc, out.iptc]).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
      expect(reference.securityFindings.map((finding) => finding.code)).toEqual([
        "METADATA_REMOVED",
      ]);

      // Dedupe: the same image twice is one file under research/assets/ (the name is the sha256 of the output).
      expect((await runCliCaptured(imageAdd(root, join(root, "photo.jpg")))).code).toBe(
        ExitCode.Ok,
      );
      expect(readdirSync(join(root, ".heron", "research", "assets"))).toEqual([
        `${reference.capture.image.sha256}.webp`,
      ]);

      // Everything that is not a PNG, JPEG or WebP is refused before decoding, and nothing is written.
      const before = hashTree(root, { exclude: [] });
      const unsupported: [string, Uint8Array][] = [
        ["gif", new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000")],
        [
          "svg",
          new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
        ],
        ["text", new TextEncoder().encode("just text")],
      ];
      for (const [name, bytes] of unsupported) {
        writeFileSync(join(root, `${name}.png`), bytes);
        const refused = await runCliCaptured(imageAdd(root, join(root, `${name}.png`)));
        expect({ name, code: refused.code }).toEqual({ name, code: ExitCode.Usage });
        expect(refused.stderr).toContain("is not a PNG, JPEG or WebP image.");
      }
      // 20 MiB + 1 byte is refused by size before it is read; > 50 megapixels before it is decoded.
      writeFileSync(join(root, "huge.png"), new Uint8Array(20 * 1024 * 1024 + 1));
      const huge = await runCliCaptured(imageAdd(root, join(root, "huge.png")));
      expect(huge.code).toBe(ExitCode.Usage);
      expect(huge.stderr).toContain("exceeds 20971520 bytes.");
      writeFileSync(join(root, "wide.png"), await canvas(7100, 7100).png().toBuffer());
      const wide = await runCliCaptured(imageAdd(root, join(root, "wide.png")));
      expect(wide.code).toBe(ExitCode.Usage);
      expect(wide.stderr).toContain("has more than 50000000 pixels.");
      const after = hashTree(root, { exclude: [] });
      expect(heron(after)).toEqual(heron(before));
    },
    SLOW,
  );
});
