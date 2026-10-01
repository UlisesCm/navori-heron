import { describe, expect, test } from "bun:test";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ExitCode,
  HERON_STATE_DOCUMENT,
  type CliEnvelope,
  type HeronState,
  type ReferencesAddData,
} from "../../src/core/contracts/index.ts";
import { openFileStore } from "../../src/core/store/file-store.ts";
import { nodeFs } from "../../src/core/store/fs-port.ts";
import { fixedContext, runCliCaptured } from "../helpers/cli.ts";
import { e2eSetup } from "../helpers/e2e.ts";
import { hashTree } from "../helpers/fixtures.ts";
import {
  PROVENANCE_FLAGS,
  fakeFetcher,
  heronTexts,
  makePng,
  readReferences,
  referenceArgs,
} from "../helpers/research.ts";

const { initialized } = e2eSetup();
const ASSETS = join(import.meta.dir, "..", "assets", "research");
const SLOW = 30_000; // the first sharp call loads the native binary

function readState(root: string): HeronState {
  const state = openFileStore(nodeFs, root, { create: false }).readDocument(
    "state.json",
    HERON_STATE_DOCUMENT,
  );
  if (state === null) throw new Error("state.json missing");
  return state;
}

const snapshot = (root: string) => hashTree(root, { exclude: [] });

/** Adds `count` complete manual references, each with a distinct origin. */
async function addMany(root: string, count: number): Promise<void> {
  for (let n = 1; n <= count; n += 1) {
    const run = await runCliCaptured([
      ...referenceArgs(root, ["origin"]),
      "--origin",
      `Source ${n}`,
    ]);
    expect(run.code).toBe(ExitCode.Ok);
  }
}

describe("heron references", () => {
  // Covers: R6
  test("adds a manual reference with complete provenance", async () => {
    const root = await initialized("no-ux");
    const run = await runCliCaptured(referenceArgs(root));
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.stderr).toBe("");
    expect(run.stdout).toBe(
      [
        "Reference REF-1 added (manual).",
        "Origin: Linear pricing page",
        "Mode: REFERENCE ONLY",
        "Captured: 2026-09-30T12:00:00.000Z",
        "Security findings: 0",
        "Phase: initialized -> researching",
        "State revision: 2",
        "References with provenance: 1/5",
        "",
      ].join("\n"),
    );
    const [reference, ...others] = readReferences(root).references;
    expect(others).toEqual([]);
    expect(reference).toEqual({
      id: "REF-1",
      source: "manual",
      origin: "Linear pricing page",
      capturedAt: "2026-09-30T12:00:00.000Z",
      mode: "reference-only",
      reason: "Shows a calm pricing table",
      studies: ["table density"],
      doNotCopy: ["brand colors"],
      influences: ["plan comparison layout"],
      capture: { kind: "manual" },
      crops: [],
      securityFindings: [],
      removed: null,
    });
    const state = readState(root);
    expect(state.phase).toBe("researching");
    expect(state.artifacts.map((artifact) => artifact.path)).toEqual([
      "intake/mode.json",
      "project.json",
      "research/REFERENCES.md",
      "research/moodboards/index.html",
      "research/provenance.json",
      "research/references.json",
    ]);
    expect(state.history.at(-1)).toMatchObject({
      command: "references add",
      transition: { from: "initialized", event: "reference-added", to: "researching" },
    });

    const json = await runCliCaptured([
      ...referenceArgs(root, ["origin"]),
      "--origin",
      "B",
      "--json",
    ]);
    const envelope = JSON.parse(json.stdout) as CliEnvelope;
    expect(envelope.command).toBe("references add");
    const data = envelope.data as ReferencesAddData;
    expect(data.references.map((item) => item.id)).toEqual(["REF-2"]);
    expect(data.counts).toMatchObject({ active: 2, withProvenance: 2, minimum: 5 });
  });

  // Covers: R7
  test("rejects a reference missing any provenance field", async () => {
    const root = await initialized("no-ux");
    const before = snapshot(root);
    const expected: [keyof typeof PROVENANCE_FLAGS, string][] = [
      ["source", "source (--source)"],
      ["origin", "origin (--origin)"],
      ["reason", "reason (--reason)"],
      ["study", "studies (--study)"],
      ["do-not-copy", "doNotCopy (--do-not-copy)"],
      ["influence", "influences (--influence)"],
    ];
    for (const [omitted, field] of expected) {
      const run = await runCliCaptured(referenceArgs(root, [omitted]));
      expect(run.code).toBe(ExitCode.Usage);
      expect(run.stdout).toBe("");
      expect(run.stderr).toContain("is missing required field(s)");
      expect(run.stderr).toContain(field);
      expect(run.stderr).toContain("Nothing was written.");
      expect(snapshot(root)).toEqual(before);
    }
    const several = await runCliCaptured(referenceArgs(root, ["reason", "do-not-copy"]));
    expect(several.code).toBe(ExitCode.Usage);
    expect(several.stderr).toBe(
      "Reference is missing required field(s): reason (--reason), doNotCopy (--do-not-copy). Nothing was written.\n",
    );
    const blank = await runCliCaptured([...referenceArgs(root, ["reason"]), "--reason", "   "]);
    expect(blank.code).toBe(ExitCode.Usage);
    expect(snapshot(root)).toEqual(before);
  });

  // Covers: R8
  test("lists, shows, compares and removes references without losing history", async () => {
    const root = await initialized("no-ux");
    await addMany(root, 2);
    expect(
      (
        await runCliCaptured([
          ...referenceArgs(root, ["study"]),
          "--study",
          "Table Density",
          "--study",
          "unique to the third",
        ])
      ).code,
    ).toBe(ExitCode.Ok);

    const compare = await runCliCaptured(["references", "compare", "REF-1", "REF-3", root]);
    expect(compare.code).toBe(ExitCode.Ok);
    expect(compare.stdout).toContain("Comparing REF-1, REF-3");
    expect(compare.stdout).toContain(
      "  REF-1: table density\n  REF-3: Table Density; unique to the third",
    );
    expect(compare.stdout).toContain("  Shared: table density");
    expect(compare.stdout).toContain("Influences:\n  REF-1: plan comparison layout");
    const none = await runCliCaptured(["references", "compare", "REF-1", "REF-2", root]);
    expect(none.stdout).toContain(
      "Do not copy:\n  REF-1: brand colors\n  REF-2: brand colors\n  Shared: brand colors",
    );

    const removed = await runCliCaptured([
      "references",
      "remove",
      "REF-1",
      root,
      "--reason",
      "off topic",
    ]);
    expect(removed.code).toBe(ExitCode.Ok);
    expect(removed.stdout).toBe(
      "Reference REF-1 removed.\nReferences with provenance: 2/5\nState revision: 5\n",
    );
    const list = await runCliCaptured(["references", "list", root]);
    expect(list.stdout).toContain("References: 2 active, 1 removed (research gate needs 5)");
    expect(list.stdout).not.toContain("REF-1");
    const all = await runCliCaptured(["references", "list", "--all", root]);
    expect(all.stdout).toContain(
      "REF-1    manual     2026-09-30T12:00:00.000Z  Source 1  (removed)",
    );
    const show = await runCliCaptured(["references", "show", "REF-1", root]);
    expect(show.stdout).toContain("REF-1 (manual) - removed");
    expect(show.stdout).toContain("Removed: 2026-09-30T12:00:00.000Z (off topic)");

    // The removed reference stays in references.json, ids are never reused and the history keeps every step.
    expect(readReferences(root).references.map((reference) => reference.id)).toEqual([
      "REF-1",
      "REF-2",
      "REF-3",
    ]);
    await runCliCaptured(referenceArgs(root));
    expect(readReferences(root).references.at(-1)?.id).toBe("REF-4");
    const state = readState(root);
    expect(state.history.map((entry) => entry.command)).toEqual([
      "init",
      "references add",
      "references add",
      "references add",
      "references remove",
      "references add",
    ]);
    expect(state.history.at(4)?.transition).toBeNull();

    const again = await runCliCaptured(["references", "remove", "REF-1", root]);
    expect(again.code).toBe(ExitCode.Usage);
    expect(again.stderr).toBe("Reference REF-1 is already removed.\n");
    const missing = await runCliCaptured(["references", "show", "REF-9", root]);
    expect(missing.code).toBe(ExitCode.Usage);
    expect(missing.stderr).toBe("Reference REF-9 not found in .heron/research/references.json.\n");
    const usage = await runCliCaptured(["references", "compare", "REF-1", "REF-1", root]);
    expect(usage.code).toBe(ExitCode.Usage);
    expect((await runCliCaptured(["references", "bogus"])).stderr).toContain(
      'Unknown references command "bogus". Expected: add, list, show, compare, remove, import.',
    );

    // Production phases freeze research (DR4); a hand-edited, invalid references.json is DOCUMENT_INVALID.
    const path = join(root, ".heron", "state.json");
    const frozen = readFileSync(path, "utf8").replace(
      '"phase": "researching"',
      '"phase": "direction-selected"',
    );
    writeFileSync(path, frozen);
    const blocked = await runCliCaptured(["references", "remove", "REF-2", root]);
    expect(blocked.code).toBe(ExitCode.Blocked);
    expect(blocked.stderr).toBe(
      'References cannot be removed from phase "direction-selected"; research is frozen once a direction is selected.\n',
    );
    writeFileSync(path, frozen.replace('"phase": "direction-selected"', '"phase": "researching"'));
    writeFileSync(join(root, ".heron", "research", "references.json"), "{ not json");
    const corrupt = await runCliCaptured(["references", "list", root]);
    expect(corrupt.code).toBe(ExitCode.Blocked);
    expect(corrupt.stderr).toContain("restore it from Git");
  });

  // Covers: R8, R9
  test("imports a reference batch all or nothing", async () => {
    const root = await initialized("no-ux");
    const batch = join(root, "batch.json");
    copyFileSync(join(ASSETS, "references-batch.json"), batch);
    const good = await runCliCaptured(["references", "import", batch, root]);
    expect(good.code).toBe(ExitCode.Ok);
    expect(good.stdout).toBe(
      [
        "Imported 2 reference(s): REF-1, REF-2.",
        "Security findings: 0",
        "Phase: initialized -> researching",
        "State revision: 2",
        "References with provenance: 2/5",
        "",
      ].join("\n"),
    );
    expect(readState(root).history.map((entry) => entry.command)).toEqual([
      "init",
      "references import",
    ]);
    const json = await runCliCaptured(["references", "import", batch, root, "--json"]);
    const data = (JSON.parse(json.stdout) as CliEnvelope).data;
    expect(data).toMatchObject({ batch: { file: "batch.json", items: 2 } });

    const fresh = await initialized("no-ux");
    const before = snapshot(fresh);
    const document = JSON.parse(readFileSync(batch, "utf8")) as {
      references: Record<string, unknown>[];
    };
    const [first = {}, second = {}] = document.references;
    const attempt = async (references: unknown[], name = "bad.json") => {
      const file = join(fresh, name);
      writeFileSync(file, JSON.stringify({ ...document, references }));
      const run = await runCliCaptured(["references", "import", file, fresh]);
      writeFileSync(file, "");
      return run;
    };
    const { reason: _reason, ...noReason } = second;
    const incomplete = await attempt([first, noReason]);
    expect(incomplete.code).toBe(ExitCode.Usage);
    expect(incomplete.stderr).toBe(
      "Batch item 2 is missing required field(s): reason (--reason). Nothing was written.\n",
    );
    const typo = await attempt([{ ...first, doNotcopy: ["x"] }]);
    expect(typo.code).toBe(ExitCode.Usage);
    expect(typo.stderr).toContain("is not a valid ReferenceBatch (");
    const local = await attempt([{ ...first, allowLocal: true }]);
    expect(local.code).toBe(ExitCode.Usage);
    expect(local.stderr).toContain("is not a valid ReferenceBatch (");
    const missingImage = await attempt([first, { ...second, source: "image", file: "nope.png" }]);
    expect(missingImage.code).toBe(ExitCode.Usage);
    expect(missingImage.stderr).toBe("File not found: nope.png\n");
    const outside = await attempt([first, { ...second, source: "image", file: "/etc/hosts" }]);
    expect(outside.code).toBe(ExitCode.Blocked);
    expect(outside.stderr).toContain("files of a ReferenceBatch must live inside it");
    const huge = await attempt(Array.from({ length: 201 }, () => first));
    expect(huge.code).toBe(ExitCode.Usage);
    expect(huge.stderr).toContain("has 201 references; the limit is 200.");
    const empty = await attempt([]);
    expect(empty.stderr).toContain("is not a valid ReferenceBatch (1 issue(s))");
    writeFileSync(join(fresh, "future.json"), JSON.stringify({ ...document, schemaVersion: 2 }));
    const future = await runCliCaptured([
      "references",
      "import",
      join(fresh, "future.json"),
      fresh,
    ]);
    expect(future.code).toBe(ExitCode.Usage);
    expect(future.stderr).toContain("is not a valid ReferenceBatch (1 issue(s))");
    writeFileSync(join(fresh, "broken.json"), "{ nope");
    const broken = await runCliCaptured([
      "references",
      "import",
      join(fresh, "broken.json"),
      fresh,
    ]);
    expect(broken.code).toBe(ExitCode.Usage);
    // Only the scratch files written by this test differ; .heron/ is untouched.
    const after = snapshot(fresh);
    for (const [path, hash] of before) expect(after.get(path)).toBe(hash);
    expect([...after.keys()].filter((path) => path.startsWith(".heron/"))).toEqual(
      [...before.keys()].filter((path) => path.startsWith(".heron/")),
    );
    expect(readState(fresh).stateRevision).toBe(1);
  });

  // Covers: R8
  test(
    "records crops with notes on image references",
    async () => {
      const root = await initialized("no-ux");
      writeFileSync(join(root, "shot.png"), await makePng(100, 50));
      const image = (...extra: string[]) =>
        runCliCaptured([
          ...referenceArgs(root, ["source"]),
          "--source",
          "image",
          "--screenshot",
          "--file",
          join(root, "shot.png"),
          ...extra,
        ]);
      const ok = await image("--crop", "10,10,20,20=Header = bar");
      expect(ok.code).toBe(ExitCode.Ok);
      expect(ok.stdout).toContain("Reference REF-1 added (image, screenshot).");
      expect(ok.stdout).toContain("File: shot.png (repo)");
      expect(ok.stdout).toContain("Crops: 1");
      expect(readReferences(root).references[0]?.crops).toEqual([
        { x: 10, y: 10, width: 20, height: 20, note: "Header = bar" },
      ]);
      const show = await runCliCaptured(["references", "show", "REF-1", root]);
      expect(show.stdout).toContain("1. 10,10 20x20: Header = bar");

      const before = snapshot(root);
      const outside = await image("--crop", "90,10,20,20=Too wide");
      expect(outside.code).toBe(ExitCode.Usage);
      expect(outside.stderr).toBe("Crop 1 (90,10 20x20) falls outside the 100x50 image.\n");
      const noNote = await image("--crop", "1,1,2,2=");
      expect(noNote.code).toBe(ExitCode.Usage);
      expect(noNote.stderr).toContain("Invalid reference input");
      const syntax = await image("--crop", "1,2");
      expect(syntax.code).toBe(ExitCode.Usage);
      expect(syntax.stderr).toContain('Invalid --crop "1,2"');
      const manual = await runCliCaptured(referenceArgs(root, [], ["--crop", "1,1,2,2=note"]));
      expect(manual.stderr).toContain("crops only apply to an image reference");
      expect(snapshot(root)).toEqual(before);
    },
    SLOW,
  );

  // Covers: R15
  test("allows the research gate only with five references with provenance", async () => {
    const root = await initialized("no-ux");
    await addMany(root, 4);
    const early = await runCliCaptured(["gate", "research", "approve", "--yes", root]);
    expect(early.code).toBe(ExitCode.Blocked);
    expect(early.stderr).toContain("at least 5 references with provenance are required (found 4)");
    const fifth = await runCliCaptured(referenceArgs(root, ["origin"], ["--origin", "Source 5"]));
    expect(fifth.stdout).toContain(
      "References with provenance: 5/5 (ready for: heron gate research approve)",
    );
    const approved = await runCliCaptured(["gate", "research", "approve", "--yes", root]);
    expect(approved.code).toBe(ExitCode.Ok);
    expect(approved.stdout).toContain("Phase: researching -> research-ready");

    // Removing a reference after approval drops the count below the minimum and invalidates the approval.
    const removed = await runCliCaptured(["references", "remove", "REF-5", root]);
    expect(removed.stdout).toContain("References with provenance: 4/5");
    const status = await runCliCaptured(["status", root]);
    expect(status.stdout).toContain("- research: invalidated");
  });

  // Covers: R9
  test("redacts secrets from origins before writing", async () => {
    const root = await initialized("no-ux");
    const canary = "CANARY-SECRET-9137";
    const origins = [
      `https://example.com/page?token=${canary}&key=${canary}&ok=1`,
      `https://user:${canary}@example.com/page`,
    ];
    for (const origin of origins) {
      const run = await runCliCaptured(referenceArgs(root, ["origin"], ["--origin", origin]));
      expect(run.code).toBe(ExitCode.Ok);
      expect(run.stdout + run.stderr).not.toContain(canary);
    }
    expect(readReferences(root).references[0]?.origin).toContain("ok=1");
    for (const text of heronTexts(root)) expect(text).not.toContain(canary);

    // A URL source refuses credentials outright and never echoes them.
    const ctx = fixedContext({ fetcher: fakeFetcher() });
    const url = await runCliCaptured(
      [
        ...referenceArgs(root, ["source", "origin"]),
        "--source",
        "url",
        "--url",
        `https://user:${canary}@example.com/`,
      ],
      ctx,
    );
    expect(url.code).toBe(ExitCode.Usage);
    expect(url.stderr).toBe("URLs with credentials are not accepted.\n");
    for (const text of heronTexts(root)) expect(text).not.toContain(canary);
  });

  // Covers: R8
  test("records fetch provenance for a page and refuses unavailable sources", async () => {
    const root = await initialized("no-ux");
    const fetcher = fakeFetcher({
      contentType: "text/html; charset=utf-8",
      body: new TextEncoder().encode("<h1>Pricing</h1>"),
    });
    const run = await runCliCaptured(
      [
        ...referenceArgs(root, ["source", "origin"]),
        "--source",
        "url",
        "--url",
        "https://example.com/pricing?token=abc",
      ],
      fixedContext({ fetcher }),
    );
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.stdout).toContain("Reference REF-1 added (url).");
    expect(run.stdout).toContain("Origin: https://example.com/pricing?token=REDACTED");
    expect(run.stdout).toContain("Fetched: https://example.com/pricing");
    expect(run.stdout).toMatch(
      /Content: research\/sources\/[0-9a-f]{64}\.txt \(untrusted, 16 bytes\)/,
    );
    expect(fetcher.transport.calls.map((call) => call.url)).toEqual([
      "https://93.184.216.34/pricing?token=abc",
    ]);

    const before = snapshot(root);
    const penpot = await runCliCaptured([...referenceArgs(root, ["source"]), "--source", "penpot"]);
    expect(penpot.code).toBe(ExitCode.DependencyUnavailable);
    expect(penpot.stderr).toBe(
      'Reference source "penpot" is not available in this version of Heron.\n',
    );
    const offline = await runCliCaptured([
      ...referenceArgs(root, ["source", "origin"]),
      "--source",
      "url",
      "--url",
      "https://example.com/",
    ]);
    expect(offline.code).toBe(ExitCode.DependencyUnavailable);
    expect(snapshot(root)).toEqual(before);
  });

  // Covers: R8
  test("reports an unexpected failure under the command of its action", async () => {
    const root = await initialized("no-ux");
    const ctx = fixedContext({
      fs: {
        ...nodeFs,
        readFileSync: () => {
          throw new Error("disk exploded");
        },
      },
    });
    const json = await runCliCaptured(["references", "list", root, "--json"], ctx);
    expect(json.code).toBe(ExitCode.Unexpected);
    const envelope = JSON.parse(json.stdout) as CliEnvelope;
    expect(envelope.command).toBe("references list");
    expect(envelope.findings.map((finding) => finding.code)).toEqual(["UNEXPECTED_ERROR"]);
    const text = await runCliCaptured(["references", "list", root], ctx);
    expect(text.stderr).toBe("Unexpected error: disk exploded\n");
  });
});
