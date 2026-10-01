// Covers: R10
import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExitCode,
  type CliEnvelope,
  type ReferencesAddData,
} from "../../src/core/contracts/index.ts";
import { fixedContext, runCliCaptured } from "../helpers/cli.ts";
import { e2eSetup } from "../helpers/e2e.ts";
import { hashTree } from "../helpers/fixtures.ts";
import { heronTexts, makePng, readReferences, referenceArgs } from "../helpers/research.ts";

const { initialized } = e2eSetup();
const outsideDirs: string[] = [];
afterEach(() => {
  for (const dir of outsideDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const SLOW = 30_000; // the first sharp call loads the native binary

/** A scratch directory outside the repository (a realpath). */
function outsideDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "heron-outside-")));
  outsideDirs.push(dir);
  return dir;
}

const imageAdd = (root: string, file: string, ...extra: string[]): string[] => [
  ...referenceArgs(root, ["source"]),
  "--source",
  "image",
  "--file",
  file,
  ...extra,
];
const designAdd = (root: string, file: string): string[] => [
  ...referenceArgs(root, ["source"]),
  "--source",
  "design-md",
  "--file",
  file,
];

describe("input file paths", () => {
  test(
    "rejects image paths and symlinks escaping the allowed roots",
    async () => {
      const root = await initialized("no-ux");
      const outside = outsideDir();
      const png = await makePng(20, 10);
      writeFileSync(join(outside, "a.png"), png);
      writeFileSync(join(outside, "notes.txt"), "# not markdown");
      writeFileSync(join(root, "ok.png"), png);
      mkdirSync(join(root, "sub"));
      symlinkSync(join(outside, "a.png"), join(root, "link.png"));
      symlinkSync(outside, join(root, "dir-link"));
      symlinkSync(join(outside, "a.png"), join(outside, "link.png"));
      const fifo = Bun.spawnSync(["mkfifo", join(root, "pipe.png")]);
      expect(fifo.exitCode).toBe(0);
      const ctx = () => fixedContext({ cwd: root });
      const before = hashTree(root, { exclude: [] });

      const rejected: [string, string[], string][] = [
        ["parent segment", imageAdd(root, "../x.png"), '".." segment'],
        ["inner parent segment", imageAdd(root, "sub/../a.png"), '".." segment'],
        ["absolute parent segment", imageAdd(root, `${outside}/../a.png`), '".." segment'],
        [
          "file symlink out of the repo",
          imageAdd(root, "link.png"),
          "symlink that leaves the product repository",
        ],
        [
          "directory symlink out of the repo",
          imageAdd(root, "dir-link/a.png"),
          "symlink that leaves the product repository",
        ],
        [
          "explicit external symlink",
          imageAdd(root, join(outside, "link.png")),
          "outside the product repository and is a symlink",
        ],
        ["fifo", imageAdd(root, "pipe.png"), "is not a regular file"],
        [
          "external DESIGN.md without .md",
          designAdd(root, join(outside, "notes.txt")),
          "is not a .md or .markdown file",
        ],
        ["design-md parent segment", designAdd(root, "../x.md"), '".." segment'],
      ];
      for (const [label, argv, message] of rejected) {
        const run = await runCliCaptured(argv, ctx());
        expect({ label, code: run.code }).toEqual({ label, code: ExitCode.Blocked });
        expect(run.stderr).toContain(message);
        expect(hashTree(root, { exclude: [] })).toEqual(before);
      }

      // The same escapes inside a batch, plus an external path (batch items never accept one).
      const batch = join(root, "batch.json");
      for (const file of ["../x.png", "link.png", join(outside, "a.png")]) {
        writeFileSync(
          batch,
          JSON.stringify({
            kind: "ReferenceBatch",
            schemaVersion: 1,
            references: [
              {
                source: "image",
                file,
                origin: "x",
                reason: "x",
                studies: ["x"],
                doNotCopy: ["x"],
                influences: ["x"],
              },
            ],
          }),
        );
        const run = await runCliCaptured(["references", "import", batch, root], ctx());
        expect({ file, code: run.code }).toEqual({ file, code: ExitCode.Blocked });
      }
      const heron = [...hashTree(root, { exclude: [] }).keys()].filter((path) =>
        path.startsWith(".heron/"),
      );
      expect(heron).toEqual([...before.keys()].filter((path) => path.startsWith(".heron/")));

      // D28: an explicit absolute path to a regular file outside the repo is read once and copied sanitized.
      const original = readFileSync(join(outside, "a.png"));
      const accepted = await runCliCaptured(imageAdd(root, join(outside, "a.png")), ctx());
      expect(accepted.code).toBe(ExitCode.Ok);
      const reference = readReferences(root).references[0];
      if (reference?.capture.kind !== "image") throw new Error("expected an image capture");
      expect(reference.capture.file).toEqual({ name: "a.png", location: "external" });
      expect(reference.capture.image.path).toBe(
        `research/assets/${reference.capture.image.sha256}.webp`,
      );
      expect(readdirSync(join(root, ".heron", "research", "assets"))).toEqual([
        `${reference.capture.image.sha256}.webp`,
      ]);
      const json = await runCliCaptured(
        [...imageAdd(root, join(outside, "a.png")), "--json"],
        ctx(),
      );
      expect((JSON.parse(json.stdout) as CliEnvelope).data as ReferencesAddData).toBeDefined();
      for (const text of [...heronTexts(root), accepted.stdout, accepted.stderr, json.stdout]) {
        expect(text).not.toContain(outside);
      }
      expect(readFileSync(join(outside, "a.png")).equals(original)).toBe(true);

      // The same rows via brand add --file: nothing is written and every escape is refused with exit 3.
      const brandAdd = (file: string): string[] => [
        "brand",
        "add",
        root,
        "--kind",
        "logo",
        "--origin",
        "provided",
        "--value",
        "Logo",
        "--file",
        file,
      ];
      const heronBefore = hashTree(root, { exclude: [] });
      const brandRejected: [string, string, string][] = [
        ["parent segment", "../x.png", '".." segment'],
        ["file symlink out of the repo", "link.png", "symlink that leaves the product repository"],
        [
          "directory symlink out of the repo",
          "dir-link/a.png",
          "symlink that leaves the product repository",
        ],
        [
          "explicit external symlink",
          join(outside, "link.png"),
          "outside the product repository and is a symlink",
        ],
        ["fifo", "pipe.png", "is not a regular file"],
      ];
      for (const [label, file, message] of brandRejected) {
        const run = await runCliCaptured(brandAdd(file), ctx());
        expect({ label, code: run.code }).toEqual({ label, code: ExitCode.Blocked });
        expect(run.stderr).toContain(message);
        expect(hashTree(root, { exclude: [] })).toEqual(heronBefore);
      }
      const brandOk = await runCliCaptured(brandAdd(join(outside, "a.png")), ctx());
      expect(brandOk.code).toBe(ExitCode.Ok);
      expect(brandOk.stdout).toContain("File: a.png (external)");
      for (const text of [...heronTexts(root), brandOk.stdout, brandOk.stderr]) {
        expect(text).not.toContain(outside);
      }

      const missing = await runCliCaptured(imageAdd(root, "nope.png"), ctx());
      expect(missing.code).toBe(ExitCode.Usage);
      expect(missing.stderr).toBe("File not found: nope.png\n");
    },
    SLOW,
  );
});
