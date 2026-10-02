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

  // Covers: R18
  test("runs intake and approves the intake gate over a P2 workspace without invalidating research", async () => {
    const root = copyP2Workspace("membership-product");
    copies.push(root);
    expect((await runCliCaptured(["gate", "research", "approve", "--yes", root])).code).toBe(
      ExitCode.Ok,
    );
    const before = readDoc(root, "state.json", HERON_STATE_DOCUMENT);
    const researchBefore = before.artifacts.filter((a) => a.path.startsWith("research/"));
    expect(before.gates.at(-1)).toMatchObject({ gate: "research", decision: "approved" });
    const researchFiles = researchBefore.map((a) => [
      a.path,
      readFileSync(join(root, ".heron", a.path), "utf8"),
    ]);

    const intake = await runCliCaptured(["intake", root]);
    expect(intake.code).toBe(ExitCode.Ok);
    const approve = await runCliCaptured(["gate", "intake", "approve", "--yes", root]);
    expect(approve.code).toBe(ExitCode.Ok);

    const after = readDoc(root, "state.json", HERON_STATE_DOCUMENT);
    expect(after.artifacts.filter((a) => a.path.startsWith("research/"))).toEqual(researchBefore);
    expect(
      researchFiles.map(([path]) => [path, readFileSync(join(root, ".heron", path ?? ""), "utf8")]),
    ).toEqual(researchFiles);
    expect(after.stale).toEqual([]);
    expect(after.gates.filter((g) => g.gate === "research")).toEqual(
      before.gates.filter((g) => g.gate === "research"),
    );
    const gates = after.gates.map((g) => `${g.gate}:${g.decision}`);
    expect(gates).toEqual(expect.arrayContaining(["research:approved", "intake:approved"]));
    const status = JSON.parse(
      (await runCliCaptured(["status", root, "--json"])).stdout,
    ) as CliEnvelope;
    expect(status.findings.map((f) => f.code)).not.toContain("DOCUMENT_INVALID");
    expect(status.data).toMatchObject({
      gates: expect.arrayContaining([
        { gate: "research", status: "approved" },
        { gate: "intake", status: "approved" },
      ]),
    });
  });
});
