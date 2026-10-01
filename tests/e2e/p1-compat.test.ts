// Covers: R4
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
import { copyP1Workspace } from "../helpers/fixtures.ts";
import { referenceArgs } from "../helpers/research.ts";

const copies: string[] = [];
afterEach(() => {
  for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function readDoc<T>(root: string, file: string, spec: DocumentSpec<T>): T {
  const raw: unknown = JSON.parse(readFileSync(join(root, ".heron", file), "utf8"));
  return parseVersionedDocument(raw, spec, file);
}

describe("P1 workspaces", () => {
  test("reads P1 workspaces without DOCUMENT_INVALID and keeps their artifacts on re-init", async () => {
    for (const name of ["membership-product", "no-ux"] as const) {
      const root = copyP1Workspace(name);
      copies.push(root);
      const before = readDoc(root, "project.json", HERON_PROJECT_DOCUMENT);

      const status = await runCliCaptured(["status", root, "--json"]);
      expect(status.code).toBe(ExitCode.Ok);
      const envelope = JSON.parse(status.stdout) as CliEnvelope;
      expect(envelope.findings.map((f) => f.code)).not.toContain("DOCUMENT_INVALID");

      const reinit = await runCliCaptured(["init", root]);
      expect(reinit.code).toBe(ExitCode.Ok);
      const state = readDoc(root, "state.json", HERON_STATE_DOCUMENT);
      expect(state.artifacts.map((a) => a.path)).toEqual(["intake/mode.json", "project.json"]);
      expect(readDoc(root, "project.json", HERON_PROJECT_DOCUMENT).source).toEqual(before.source);
      expect(readDoc(root, "intake/mode.json", MODE_DECISION_DOCUMENT).kind).toBe("ModeDecision");
    }
  });

  test("adds references over P1 workspaces and keeps research artifacts on re-init", async () => {
    for (const name of ["membership-product", "no-ux"] as const) {
      const root = copyP1Workspace(name);
      copies.push(root);
      const before = readDoc(root, "project.json", HERON_PROJECT_DOCUMENT);

      const added = await runCliCaptured(referenceArgs(root));
      expect(added.code).toBe(ExitCode.Ok);
      expect(added.stdout).toContain("Phase: initialized -> researching");
      const withResearch = readDoc(root, "state.json", HERON_STATE_DOCUMENT);
      const researchPaths = withResearch.artifacts
        .map((artifact) => artifact.path)
        .filter((path) => path.startsWith("research/"));
      expect(researchPaths).toHaveLength(4);

      // An outdated .gitignore makes the re-init write, so recordInit really runs over the research artifacts.
      writeFileSync(join(root, ".heron", ".gitignore"), "# outdated\n");
      const reinit = await runCliCaptured(["init", root]);
      expect(reinit.code).toBe(ExitCode.Ok);
      const state = readDoc(root, "state.json", HERON_STATE_DOCUMENT);
      expect(state.stateRevision).toBe(withResearch.stateRevision + 1);
      expect(state.phase).toBe("researching");
      expect(state.artifacts.map((artifact) => artifact.path)).toEqual(
        withResearch.artifacts.map((artifact) => artifact.path),
      );
      expect(state.artifacts.filter((a) => a.path.startsWith("research/"))).toEqual(
        withResearch.artifacts.filter((a) => a.path.startsWith("research/")),
      );
      expect(readDoc(root, "project.json", HERON_PROJECT_DOCUMENT)).toEqual(before);
      expect((await runCliCaptured(["references", "list", root])).stdout).toContain("REF-1");
    }
  });
});
