// Covers: R4
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
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
});
