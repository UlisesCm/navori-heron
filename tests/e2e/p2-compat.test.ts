// Covers: R18
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ExitCode,
  HERON_PROJECT_DOCUMENT,
  HERON_STATE_DOCUMENT,
  MODE_DECISION_DOCUMENT,
  parseVersionedDocument,
  type CliEnvelope,
  type DocumentSpec,
} from "../../src/core/contracts/index.ts";
import { runCliCaptured } from "../helpers/cli.ts";
import { copyP2Workspace } from "../helpers/fixtures.ts";

const copies: string[] = [];
afterEach(() => {
  for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function readDoc<T>(root: string, file: string, spec: DocumentSpec<T>): T {
  const raw: unknown = JSON.parse(readFileSync(join(root, ".heron", file), "utf8"));
  return parseVersionedDocument(raw, spec, file);
}

describe("P2 workspaces", () => {
  test("reads P2 workspaces without DOCUMENT_INVALID and keeps their research artifacts", async () => {
    const root = copyP2Workspace("membership-product");
    copies.push(root);
    const before = readDoc(root, "state.json", HERON_STATE_DOCUMENT);
    const researchBefore = before.artifacts.filter((a) => a.path.startsWith("research/"));
    expect(researchBefore.map((a) => a.path)).toEqual([
      "research/REFERENCES.md",
      "research/moodboards/index.html",
      "research/provenance.json",
      "research/references.json",
    ]);
    const projectBefore = readDoc(root, "project.json", HERON_PROJECT_DOCUMENT);

    const status = await runCliCaptured(["status", root, "--json"]);
    expect(status.code).toBe(ExitCode.Ok);
    const envelope = JSON.parse(status.stdout) as CliEnvelope;
    expect(envelope.findings.map((f) => f.code)).not.toContain("DOCUMENT_INVALID");

    // An outdated .gitignore makes the re-init write, so recordInit really runs over the research artifacts.
    writeFileSync(join(root, ".heron", ".gitignore"), "# outdated\n");
    const reinit = await runCliCaptured(["init", root]);
    expect(reinit.code).toBe(ExitCode.Ok);
    const after = readDoc(root, "state.json", HERON_STATE_DOCUMENT);
    expect(after.phase).toBe("researching");
    expect(after.stateRevision).toBe(before.stateRevision + 1);
    expect(after.artifacts.filter((a) => a.path.startsWith("research/"))).toEqual(researchBefore);
    expect(readDoc(root, "project.json", HERON_PROJECT_DOCUMENT).source).toEqual(
      projectBefore.source,
    );
    expect(readDoc(root, "intake/mode.json", MODE_DECISION_DOCUMENT).kind).toBe("ModeDecision");
    expect((await runCliCaptured(["references", "list", root])).stdout).toContain("REF-5");
  });
});
