import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BRAND_INPUTS_DOCUMENT,
  BRAND_KINDS,
  ExitCode,
  type BrandAddData,
  type CliEnvelope,
} from "../../src/core/contracts/index.ts";
import { openFileStore } from "../../src/core/store/file-store.ts";
import { nodeFs } from "../../src/core/store/fs-port.ts";
import { fixedContext, runCliCaptured } from "../helpers/cli.ts";
import { e2eSetup } from "../helpers/e2e.ts";
import { hashTree } from "../helpers/fixtures.ts";
import { makePng, referenceArgs } from "../helpers/research.ts";

const { initialized } = e2eSetup();
const SLOW = 30_000; // the first sharp call loads the native binary

const brandArgs = (root: string, ...extra: string[]): string[] => ["brand", "add", root, ...extra];

describe("heron brand add", () => {
  // Covers: R14
  test("requires an origin for every brand input", async () => {
    const root = await initialized("no-ux");
    const before = hashTree(root, { exclude: [] });
    for (const kind of BRAND_KINDS) {
      const run = await runCliCaptured(brandArgs(root, "--kind", kind, "--value", "x"));
      expect({ kind, code: run.code }).toEqual({ kind, code: ExitCode.Usage });
      expect(run.stderr).toBe(
        "Brand input is missing required field(s): origin (--origin provided, derived, inferred or reference-derived). Nothing was written.\n",
      );
    }
    const unknown = await runCliCaptured(
      brandArgs(root, "--kind", "logo", "--value", "x", "--origin", "guessed"),
    );
    expect(unknown.code).toBe(ExitCode.Usage);
    expect(unknown.stderr).toContain('unknown origin "guessed"');
    expect(hashTree(root, { exclude: [] })).toEqual(before);

    const ok = await runCliCaptured(
      brandArgs(root, "--kind", "brand-color", "--value", "#112233", "--origin", "provided"),
    );
    expect(ok.code).toBe(ExitCode.Ok);
    expect(ok.stdout).toContain(
      "Brand input BRAND-1 added (brand-color, provided).\nValue: #112233\n",
    );
    const doc = openFileStore(nodeFs, root, { create: false }).readDocument(
      "brand/brand.json",
      BRAND_INPUTS_DOCUMENT,
    );
    expect(doc?.inputs.map((input) => input.id)).toEqual(["BRAND-1"]);
  });

  // Covers: R14
  test("ties reference-derived inputs to an active reference", async () => {
    const root = await initialized("no-ux");
    const base = ["--kind", "liked-reference", "--value", "tone", "--origin", "reference-derived"];
    const missing = await runCliCaptured(brandArgs(root, ...base));
    expect(missing.code).toBe(ExitCode.Usage);
    expect(missing.stderr).toContain("origin reference-derived needs --reference");
    const unknown = await runCliCaptured(brandArgs(root, ...base, "--reference", "REF-1"));
    expect(unknown.code).toBe(ExitCode.Usage);
    expect(unknown.stderr).toBe(
      "Invalid brand input: REF-1 is not an active reference. Nothing was written.\n",
    );
    expect((await runCliCaptured(referenceArgs(root))).code).toBe(ExitCode.Ok);
    const json = await runCliCaptured([
      ...brandArgs(root, ...base, "--reference", "REF-1", "--note", "n", "--json"),
    ]);
    expect(json.code).toBe(ExitCode.Ok);
    const envelope = JSON.parse(json.stdout) as CliEnvelope;
    const data = envelope.data as BrandAddData;
    expect([envelope.command, data.input.derivedFrom, data.input.note]).toEqual([
      "brand add",
      "REF-1",
      "n",
    ]);
    expect(data.written).toEqual([
      "brand/brand.json",
      "research/REFERENCES.md",
      "research/moodboards/index.html",
    ]);
  });

  // Covers: R14
  test(
    "sanitizes a brand image from --file into brand/assets",
    async () => {
      const root = await initialized("no-ux");
      writeFileSync(join(root, "logo.png"), await makePng(40, 20));
      const run = await runCliCaptured(
        brandArgs(
          root,
          "--kind",
          "logo",
          "--value",
          "Primary logo",
          "--origin",
          "provided",
          "--file",
          "logo.png",
        ),
        fixedContext({ cwd: root }),
      );
      expect(run.code).toBe(ExitCode.Ok);
      expect(run.stdout).toMatch(
        /File: logo\.png \(repo\)\nImage: brand\/assets\/[0-9a-f]{64}\.webp \(40x20, \d+ bytes\)\nRemoved metadata: none\n/,
      );
      const missing = await runCliCaptured(
        brandArgs(
          root,
          "--kind",
          "logo",
          "--value",
          "x",
          "--origin",
          "provided",
          "--file",
          "nope.png",
        ),
        fixedContext({ cwd: root }),
      );
      expect(missing.code).toBe(ExitCode.Usage);
    },
    SLOW,
  );

  test("rejects unknown subcommands", async () => {
    const root = await initialized("no-ux");
    const run = await runCliCaptured(["brand", "list", root]);
    expect(run.code).toBe(ExitCode.Usage);
    expect(run.stderr).toContain('Unknown brand command "list". Expected: add.');
  });
});
