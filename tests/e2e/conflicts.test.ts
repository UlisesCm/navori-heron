import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ExitCode,
  INTAKE_CONFLICTS_DOCUMENT,
  type CliEnvelope,
  type ConflictsAckData,
  type ConflictsListData,
} from "../../src/core/contracts/index.ts";
import { fixedContext, runCliCaptured } from "../helpers/cli.ts";
import { e2eSetup } from "../helpers/e2e.ts";
import { hashTree } from "../helpers/fixtures.ts";

const { initialized } = e2eSetup();

const stored = (root: string) =>
  INTAKE_CONFLICTS_DOCUMENT.schema.parse(
    JSON.parse(readFileSync(join(root, ".heron", "intake", "conflicts.json"), "utf8")),
  );

describe("heron conflicts", () => {
  // Covers: R6
  test("lists and acknowledges conflicts with a note and an identity", async () => {
    const root = await initialized("conflict");
    const untracked = await runCliCaptured(["conflicts", "list", root]);
    expect(untracked.stdout).toBe(`No product context yet. Run: heron intake ${root}\n`);
    expect((await runCliCaptured(["intake", root])).code).toBe(ExitCode.Ok);

    const list = await runCliCaptured(["conflicts", "list", root]);
    expect(list.code).toBe(ExitCode.Ok);
    expect(list.stdout).toContain("CONFLICT-001 [open, not acknowledged] permission-contradiction");
    expect(list.stdout).toContain("  Files: ");
    expect(list.stdout).toContain("  Impact: ");

    const snapshot = hashTree(root, { exclude: [] });
    const noNote = await runCliCaptured(["conflicts", "ack", "CONFLICT-001", "--yes", root]);
    expect(noNote.code).toBe(ExitCode.Usage);
    expect(noNote.stderr).toBe("heron conflicts ack requires --note <text>.\n");
    const noTty = await runCliCaptured(["conflicts", "ack", "CONFLICT-001", "--note", "ok", root]);
    expect(noTty.code).toBe(ExitCode.Usage);
    expect(noTty.stderr).toContain("needs an interactive terminal or --yes");
    const unknown = await runCliCaptured([
      "conflicts",
      "ack",
      "CONFLICT-099",
      "--note",
      "ok",
      "--yes",
      root,
    ]);
    expect(unknown.code).toBe(ExitCode.Usage);
    expect(unknown.stderr).toBe("CONFLICT-099 not found in .heron/intake/conflicts.json.\n");
    const anonymous = await runCliCaptured(
      ["conflicts", "ack", "CONFLICT-001", "--note", "ok", "--yes", root],
      fixedContext({ identity: { current: () => " " } }),
    );
    expect(anonymous.code).toBe(ExitCode.Usage);
    expect(hashTree(root, { exclude: [] })).toEqual(snapshot);

    const ack = await runCliCaptured([
      "conflicts",
      "ack",
      "CONFLICT-001",
      "--note",
      "Partners may see member data",
      "--yes",
      "--json",
      root,
    ]);
    expect(ack.code).toBe(ExitCode.Ok);
    const data = (JSON.parse(ack.stdout) as CliEnvelope & { data: ConflictsAckData }).data;
    expect(data.unacknowledged).toBe(0);
    expect(data.conflict.ack).toMatchObject({ by: "tester", note: "Partners may see member data" });
    expect(stored(root).conflicts[0]?.ack).toEqual(data.conflict.ack);
    const after = hashTree(root, { exclude: [] });
    expect(
      [...after.keys()].filter((path) => after.get(path) !== snapshot.get(path)).toSorted(),
    ).toEqual([".heron/intake/conflicts.json", ".heron/state.json"]);

    const again = await runCliCaptured([
      "conflicts",
      "ack",
      "CONFLICT-001",
      "--note",
      "again",
      "--yes",
      root,
    ]);
    expect(again.code).toBe(ExitCode.Usage);
    expect(again.stderr).toContain("CONFLICT-001 was already acknowledged by tester at ");

    const text = await runCliCaptured(["conflicts", "list", root]);
    expect(text.stdout).toContain("[open, acknowledged by tester]");
    const json = JSON.parse((await runCliCaptured(["conflicts", "list", "--json", root])).stdout);
    expect((json as CliEnvelope & { data: ConflictsListData }).data.tracked).toBe(true);

    // The intake that follows keeps the acknowledgement and writes nothing.
    const rerun = await runCliCaptured(["intake", root]);
    expect(rerun.stdout).toContain("- intake/conflicts.json: unchanged");
  });

  // Covers: R7
  test("blocks the intake gate while a conflict is not acknowledged", async () => {
    const root = await initialized("conflict");
    expect((await runCliCaptured(["intake", root])).code).toBe(ExitCode.Ok);
    const blocked = await runCliCaptured(["gate", "intake", "approve", "--yes", root]);
    expect(blocked.code).toBe(ExitCode.Blocked);
    expect(blocked.stderr).toContain(
      'Precondition "intake-context-valid" is not met for "approve-gate:intake" from phase "initialized": 1 conflict(s) are not acknowledged.',
    );
    const ack = await runCliCaptured([
      "conflicts",
      "ack",
      "CONFLICT-001",
      "--note",
      "reviewed",
      "--yes",
      root,
    ]);
    expect(ack.code).toBe(ExitCode.Ok);
    expect(ack.stdout).toBe(
      "CONFLICT-001 acknowledged by tester: reviewed\nConflicts not acknowledged: 0\n",
    );
    const approved = await runCliCaptured(["gate", "intake", "approve", "--yes", root]);
    expect(approved.code).toBe(ExitCode.Ok);

    const status = await runCliCaptured(["status", root]);
    expect(status.stdout).toContain("- intake: approved");
  });
});
