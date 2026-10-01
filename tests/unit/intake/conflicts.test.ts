import { describe, expect, test } from "bun:test";
import type { IntakeConflicts, SourceKind } from "../../../src/core/contracts/index.ts";
import {
  acknowledgeConflict,
  conflictFingerprint,
  detectConflicts,
  reconcileConflicts,
  unacknowledgedCount,
} from "../../../src/intake/conflicts.ts";
import { buildProductContext, withConflictIds } from "../../../src/intake/product-context.ts";
import type { Candidate, ContextDraft } from "../../../src/intake/ports.ts";
import {
  actorValue,
  candidate,
  draftOf,
  masterRef,
  requirementValue,
} from "../../helpers/intake.ts";

const META = { adapter: "navori-master", mode: "full", stage: null } as const;
const USED: SourceKind[] = ["DECISIONS.md", "MASTER.md", "parts.json", "ux.json", "DIGEST.md"];

const ux = (locator: string) => masterRef(locator, "ux.json");

function draft(extra: Candidate[] = []): ContextDraft {
  return draftOf(
    [
      candidate(
        "actors",
        "partner",
        actorValue("Partner", {
          id: "ACT-PARTNER",
          can: ["Invite members"],
          cannot: ["See member data"],
        }),
        masterRef("§Actors"),
      ),
      candidate(
        "actors",
        "partner",
        actorValue("Partner", {
          id: "ACT-PARTNER",
          capabilities: ["see member data."],
        }),
        ux("/actors/0"),
      ),
      candidate("actors", "guest", actorValue("Guest", { id: "ACT-GUEST" }), ux("/actors/1")),
      candidate(
        "businessRules",
        "RN-1",
        requirementValue("RN-1", "Members pay monthly"),
        masterRef("§Rules"),
      ),
      candidate(
        "businessRules",
        "RN-1",
        requirementValue("RN-1", "Members pay yearly"),
        masterRef("§Rules", "DIGEST.md"),
      ),
      candidate(
        "functionalRequirements",
        "RF-1",
        requirementValue("RF-1", "Invite a member"),
        masterRef("§Functional"),
      ),
      candidate(
        "traceability",
        "RF-9",
        {
          requirement: "RF-9",
          parts: [],
          journeys: [],
          flows: [],
          screens: [],
          patterns: [],
        },
        ux("/traceability/0"),
      ),
      ...extra,
    ],
    {
      sources: USED.map((source) => ({
        source,
        path: masterRef("", source).path,
        status: "used",
      })),
    },
  );
}

function run(extra: Candidate[] = []) {
  const built = buildProductContext(draft(extra), META);
  const defined = {
    ...built.defined,
    requirements: new Set(["RN-1", "RF-1"]),
    uxActors: built.defined.uxActors,
  };
  return {
    ...built,
    defined,
    detected: detectConflicts(built.context, built.mismatches, defined),
  };
}

describe("conflict detection", () => {
  // Covers: R5, R7
  test("detects each conflict kind deterministically", () => {
    const first = run();
    expect(first.detected.map((c) => [c.kind, c.subject])).toEqual([
      ["actor-unknown", "ACT-GUEST"],
      ["permission-contradiction", "ACT-PARTNER · see member data"],
      ["value-mismatch", "businessRules/RN-1"],
      ["reference-unknown", "RF-9"],
    ]);
    expect(run().detected).toEqual(first.detected);
    const mismatch = first.detected.find((c) => c.kind === "value-mismatch");
    expect(mismatch?.winner?.source).toBe("MASTER.md");
    expect(mismatch?.values.length).toBe(2);
    const reference = first.detected.find((c) => c.kind === "reference-unknown");
    expect(reference?.values[0]?.value).toBe("(not defined)");
    expect(reference?.impact).toEqual(["traceability/RF-9"]);
    // an id that the master defines is not a conflict; a missing defining source skips the check
    const skipped = detectConflicts(first.context, first.mismatches, {
      ...first.defined,
      requirements: null,
    });
    expect(skipped.some((c) => c.kind === "reference-unknown")).toBe(false);
  });

  // Covers: R5
  test("reports an unknown part criterion against the declared criteria", () => {
    const built = run([
      candidate(
        "traceability",
        "RF-1",
        {
          requirement: "RF-1",
          parts: ["P1.A2"],
          journeys: [],
          flows: [],
          screens: [],
          patterns: [],
        },
        masterRef("/traceability/1", "ux.json"),
      ),
    ]);
    const subjects = (parts: Map<string, Set<string>>) =>
      detectConflicts(built.context, built.mismatches, {
        ...built.defined,
        parts,
      }).filter((c) => c.subject === "P1.A2");
    expect(subjects(new Map([["P1", new Set<string>()]]))).toHaveLength(1);
    expect(subjects(new Map([["P1", new Set(["P1.A1"])]]))).toHaveLength(1);
    expect(subjects(new Map([["P1", new Set(["P1.A1", "P1.A2"])]]))).toHaveLength(0);
  });
});

describe("conflict identity", () => {
  const ack = {
    by: "ana",
    at: "2026-10-01T10:00:00.000Z",
    note: "accepted",
    runId: "run-20261001T100000Z-3f9a1c2b",
  };

  // Covers: R5, R7
  test("keeps conflict ids and acknowledgements stable across runs", () => {
    const { detected, context } = run();
    const first = reconcileConflicts(null, detected);
    expect(first.conflicts.map((c) => c.id)).toEqual([
      "CONFLICT-001",
      "CONFLICT-002",
      "CONFLICT-003",
      "CONFLICT-004",
    ]);
    expect(unacknowledgedCount(first)).toBe(4);
    expect(unacknowledgedCount(null)).toBe(0);

    const acked = acknowledgeConflict(first, "CONFLICT-003", ack);
    expect(acked.ok).toBe(true);
    if (!acked.ok) return;
    expect(unacknowledgedCount(acked.doc)).toBe(3);
    expect(acknowledgeConflict(acked.doc, "CONFLICT-003", ack)).toMatchObject({
      ok: false,
      code: "CONFLICT_ALREADY_ACKNOWLEDGED",
    });
    expect(acknowledgeConflict(first, "CONFLICT-099", ack)).toMatchObject({
      ok: false,
      code: "CONFLICT_NOT_FOUND",
    });

    // same detection: same doc; a conflict that disappears resolves and reopens with its ack
    expect(reconcileConflicts(acked.doc, detected)).toEqual(acked.doc);
    const without = detected.filter((c) => c.subject !== "businessRules/RN-1");
    const resolved = reconcileConflicts(acked.doc, without);
    expect(resolved.conflicts.find((c) => c.id === "CONFLICT-003")?.status).toBe("resolved");
    const reopened = reconcileConflicts(resolved, detected);
    expect(reopened).toEqual(acked.doc);

    // reordered sources / moved locators keep the fingerprint; a new value is a new conflict
    const [one] = detected;
    if (one === undefined) throw new Error("no conflicts");
    const moved = {
      ...one,
      values: one.values.toReversed().map((v) => ({
        ...v,
        sourceRef: { ...v.sourceRef, locator: "/moved", path: "x/y.md" },
      })),
    };
    expect(conflictFingerprint(moved)).toBe(conflictFingerprint(one));
    const another = { ...one, subject: "ACT-OTHER" };
    expect(conflictFingerprint(another)).not.toBe(conflictFingerprint(one));
    const grown = reconcileConflicts(acked.doc, [
      ...detected,
      { ...another, fingerprint: "f".repeat(64) },
    ]);
    expect(grown.conflicts.at(-1)?.id).toBe("CONFLICT-005");

    // withConflictIds lists open conflicts on the elements they impact
    const tagged = withConflictIds(context, acked.doc);
    expect(tagged.businessRules.find((e) => e.id === "RN-1")?.conflicts).toEqual(["CONFLICT-003"]);
    expect(tagged.businessRules.find((e) => e.id === "RN-1")?.conflicts).not.toBe(undefined);
    const none: IntakeConflicts = { ...acked.doc, conflicts: [] };
    expect(withConflictIds(tagged, none).businessRules[0]?.conflicts).toEqual([]);
  });
});
