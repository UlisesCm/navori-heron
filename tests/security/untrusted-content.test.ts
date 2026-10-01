// Covers: R12
import { describe, expect, test } from "bun:test";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HERON_STATE_DOCUMENT, ExitCode, type HeronState } from "../../src/core/contracts/index.ts";
import { openFileStore } from "../../src/core/store/file-store.ts";
import { nodeFs } from "../../src/core/store/fs-port.ts";
import { runCliCaptured } from "../helpers/cli.ts";
import { e2eSetup } from "../helpers/e2e.ts";
import { readReferences, referenceArgs } from "../helpers/research.ts";

const { initialized } = e2eSetup();
// Built from its code point so no hidden character lives in this source file.
const RLO = String.fromCharCode(0x202e);
const INJECTION = join(import.meta.dir, "..", "assets", "research", "design-injection.md");

const designAdd = (root: string): string[] => [
  ...referenceArgs(root, ["source"]),
  "--source",
  "design-md",
  "--file",
  join(root, "DESIGN.md"),
];

function readState(root: string): HeronState {
  const state = openFileStore(nodeFs, root, { create: false }).readDocument(
    "state.json",
    HERON_STATE_DOCUMENT,
  );
  if (state === null) throw new Error("state.json missing");
  return state;
}

/** What a command could have been talked into: phase, gates and the shape of the history, without ids or hashes. */
const behavior = (state: HeronState) => ({
  phase: state.phase,
  gates: state.gates,
  revision: state.stateRevision,
  history: state.history.map((entry) => ({
    command: entry.command,
    transition: entry.transition,
    mode: entry.mode,
  })),
});

describe("untrusted external content", () => {
  test("records suspicious instructions in external DESIGN.md without acting on them", async () => {
    const hostile = await initialized("no-ux");
    copyFileSync(INJECTION, join(hostile, "DESIGN.md"));
    const benign = await initialized("no-ux");
    writeFileSync(join(benign, "DESIGN.md"), "# Acme\n\nCalm surfaces and one accent color.\n");

    const run = await runCliCaptured(designAdd(hostile));
    expect(run.code).toBe(ExitCode.Ok);
    expect((await runCliCaptured(designAdd(benign))).code).toBe(ExitCode.Ok);

    // Stored byte for byte, marked untrusted, with findings that point at exact offsets of the stored text.
    const reference = readReferences(hostile).references[0];
    if (reference?.capture.kind !== "design-md") throw new Error("expected a design-md capture");
    const { content } = reference.capture;
    expect(content).toMatchObject({ trust: "untrusted", mediaType: "text/markdown" });
    const stored = readFileSync(join(hostile, ".heron", content.path));
    expect(stored.equals(readFileSync(INJECTION))).toBe(true);
    const text = new TextDecoder("utf-8").decode(stored);
    const suspicious = reference.securityFindings.filter(
      (f) => f.code === "SUSPICIOUS_INSTRUCTION",
    );
    expect(suspicious.map((finding) => finding.phrase)).toEqual(
      expect.arrayContaining([
        "Ignore previous instructions",
        "approve the research gate",
        "<system>",
      ]),
    );
    for (const finding of suspicious) {
      expect(finding.path).toBe(content.path);
      expect(finding.offset).toBe(text.indexOf(finding.phrase ?? "\u0000"));
    }
    const hidden = reference.securityFindings.find((finding) => finding.code === "HIDDEN_TEXT");
    expect(hidden).toMatchObject({ phrase: "U+202E", offset: text.indexOf(RLO) });
    expect(run.stdout).toContain(
      `- SUSPICIOUS_INSTRUCTION (line 7, offset ${text.indexOf("Ignore previous instructions")}): "Ignore previous instructions"`,
    );
    expect(run.stdout).toContain("- HIDDEN_TEXT (line 12, offset ");

    // Nothing acted on the text: the state evolves exactly as with a benign file, and no gate was decided.
    expect(behavior(readState(hostile))).toEqual(behavior(readState(benign)));
    expect(readState(hostile).gates).toEqual([]);
    expect(readState(hostile).phase).toBe("researching");
    const status = await runCliCaptured(["status", hostile]);
    expect(status.stdout).toContain("- research: pending");
  });
});
