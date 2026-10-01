// Covers: R8, R10, R11
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "../../../src/core/store/hash.ts";
import { imageSource } from "../../../src/research/adapters/image/index.ts";
import type { CaptureResult } from "../../../src/research/ports.ts";
import { captureRequest, okImage, stubSanitizer, tempRepo } from "../../helpers/research.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const failure = (result: CaptureResult) => {
  if (result.ok) throw new Error("expected a failure");
  return result.failure;
};

describe("imageSource", () => {
  test("captures a sanitized image asset and maps sanitizer failures", () => {
    return (async () => {
      const repo = tempRepo(dirs);
      repo.write("root", "shots/home.png", PNG);
      const images = stubSanitizer(okImage({ removedMetadata: ["exif", "gps"] }));
      const services = repo.services({ images });
      const result = await imageSource.capture(
        captureRequest(
          { kind: "image", file: repo.ref("shots/home.png"), method: "screenshot" },
          services,
        ),
      );
      if (!result.ok) throw new Error(result.failure.message);
      const stored = new Uint8Array([1, 2, 3, 4]);
      const sha = sha256Hex(stored);
      const path = `research/assets/${sha}.webp`;
      expect(images.seen[0]).toEqual(PNG);
      expect(result.captured.capture).toEqual({
        kind: "image",
        method: "screenshot",
        file: { name: "home.png", location: "repo" },
        image: {
          path,
          sha256: sha,
          mediaType: "image/webp",
          width: 1440,
          height: 900,
          bytes: 4,
          trust: "untrusted",
          original: { sha256: sha256Hex(PNG), mediaType: "image/png", bytes: 8 },
          removedMetadata: ["exif", "gps"],
        },
      });
      expect(result.captured.files).toEqual([{ path, sha256: sha, bytes: stored }]);
      expect(result.captured.securityFindings).toEqual([
        {
          code: "METADATA_REMOVED",
          severity: "info",
          message: "Removed exif, gps metadata from the imported image.",
          path,
          offset: null,
          line: null,
          phrase: "exif,gps",
          rule: null,
        },
      ]);
      // the same content -> the same asset path (D15)
      const again = await imageSource.capture(
        captureRequest(
          { kind: "image", file: repo.ref("shots/home.png"), method: "file" },
          services,
        ),
      );
      expect(again.ok && again.captured.files[0]?.path).toBe(path);

      const mapped: [Parameters<typeof stubSanitizer>[0], string, string][] = [
        [
          { ok: false, code: "UNSUPPORTED_MEDIA_TYPE", message: "x" },
          "UNSUPPORTED_MEDIA_TYPE",
          "shots/home.png is not a PNG, JPEG or WebP image.",
        ],
        [
          {
            ok: false,
            code: "INPUT_TOO_LARGE",
            message: "The image has more than 50000000 pixels.",
          },
          "INPUT_TOO_LARGE",
          "shots/home.png has more than 50000000 pixels.",
        ],
        [
          { ok: false, code: "INPUT_TOO_LARGE", message: "The image exceeds 5 bytes." },
          "INPUT_TOO_LARGE",
          "shots/home.png exceeds 20971520 bytes.",
        ],
        [
          { ok: false, code: "IMAGE_UNREADABLE", message: "boom." },
          "IMAGE_UNREADABLE",
          "shots/home.png could not be decoded: boom.",
        ],
        [
          { ok: false, code: "IMAGE_ENGINE_UNAVAILABLE", message: "engine message" },
          "IMAGE_ENGINE_UNAVAILABLE",
          "engine message",
        ],
      ];
      for (const [reply, code, message] of mapped) {
        const out = failure(
          await imageSource.capture(
            captureRequest(
              { kind: "image", file: repo.ref("shots/home.png"), method: "file" },
              repo.services({ images: stubSanitizer(reply) }),
            ),
          ),
        );
        expect(out).toMatchObject({ code, message });
      }
    })();
  }, 10_000);

  test("reads an explicit external file once and keeps only its name", async () => {
    const repo = tempRepo(dirs);
    const external = repo.write("outside", "Captura 2026.png", PNG);
    const images = stubSanitizer(okImage());
    const result = await imageSource.capture(
      captureRequest(
        { kind: "image", file: repo.ref(external), method: "screenshot" },
        repo.services({ images }),
      ),
    );
    if (!result.ok) throw new Error(result.failure.message);
    expect(result.captured.capture).toMatchObject({
      file: { name: "Captura 2026.png", location: "external" },
    });
    expect(JSON.stringify(result.captured.capture)).not.toContain(repo.outside);
    expect(images.seen).toHaveLength(1);
  }, 10_000);

  test("rejects unsafe, missing, oversize and non-regular paths without reading them", async () => {
    const repo = tempRepo(dirs);
    repo.write("root", "ok.png", PNG);
    repo.write("outside", "real.png", PNG);
    mkdirSync(join(repo.root, "folder"));
    symlinkSync(join(repo.outside, "real.png"), join(repo.root, "escape.png"));
    symlinkSync(join(repo.outside, "real.png"), join(repo.outside, "link.png"));
    symlinkSync(repo.outside, join(repo.root, "dir-link"));
    const images = stubSanitizer(okImage());
    const run = async (path: string, allowExternal = true, services = repo.services({ images })) =>
      failure(
        await imageSource.capture(
          captureRequest(
            { kind: "image", file: repo.ref(path, allowExternal), method: "file" },
            services,
          ),
        ),
      );
    const unsafe: [string, boolean, string][] = [
      ["../x.png", true, 'contains a ".." segment'],
      ["sub/../ok.png", true, 'contains a ".." segment'],
      [`${repo.outside}/../x.png`, true, 'contains a ".." segment'],
      ["a\\..\\b.png", true, 'contains a ".." segment'],
      ["escape.png", true, "is a symlink that leaves the product repository"],
      ["dir-link/real.png", true, "is a symlink that leaves the product repository"],
      [`${repo.outside}/link.png`, true, "is outside the product repository and is a symlink"],
      [`${repo.outside}/real.png`, false, "files of a ReferenceBatch must live inside it"],
      ["folder", true, "is not a regular file"],
      ["", true, "is not a valid path"],
      ["nul\0.png", true, "is not a valid path"],
    ];
    for (const [path, allowExternal, detail] of unsafe) {
      const out = await run(path, allowExternal);
      expect(out.code).toBe("UNSAFE_PATH");
      expect(out.message).toContain(detail);
    }
    expect(await run("missing.png")).toMatchObject({
      code: "PATH_NOT_FOUND",
      message: "File not found: missing.png",
    });
    expect(await run("no-dir/missing.png")).toMatchObject({ code: "PATH_NOT_FOUND" });
    const tiny = await imageSource.capture({
      ...captureRequest(
        { kind: "image", file: repo.ref("ok.png"), method: "file" },
        repo.services({ images }),
      ),
      limits: { maxTextBytes: 1, maxImageBytes: 4, maxImagePixels: 1 },
    });
    expect(failure(tiny)).toMatchObject({
      code: "INPUT_TOO_LARGE",
      message: "ok.png exceeds 4 bytes.",
    });
    expect(images.seen).toHaveLength(0);
  }, 10_000);

  test("replaces control characters in the recorded file name", async () => {
    const repo = tempRepo(dirs);
    repo.write("root", "tab\there.png", PNG);
    const one = await imageSource.capture(
      captureRequest(
        { kind: "image", file: repo.ref("tab\there.png"), method: "file" },
        repo.services(),
      ),
    );
    expect(one.ok && one.captured.capture).toMatchObject({ file: { name: "tab?here.png" } });
  }, 10_000);

  test("reports an input meant for another source as data", async () => {
    const repo = tempRepo(dirs);
    const result = await imageSource.capture(captureRequest({ kind: "manual" }, repo.services()));
    expect(result.ok).toBe(false);
  });
});
