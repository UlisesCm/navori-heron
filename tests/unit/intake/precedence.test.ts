import { describe, expect, test } from "bun:test";
import {
  PRODUCT_CONTEXT_SECTIONS,
  type HeronEvent,
  type HeronState,
} from "../../../src/core/contracts/index.ts";
import { canTransition } from "../../../src/core/state/transitions.ts";
import {
  acknowledgeConflict,
  detectConflicts,
  reconcileConflicts,
  unacknowledgedCount,
} from "../../../src/intake/conflicts.ts";
import {
  COMPARABLE_FIELDS,
  NAME_KEYED_SECTIONS,
  SOURCE_PRECEDENCE,
  mergeCandidates,
  sourceRank,
} from "../../../src/intake/precedence.ts";
import {
  buildProductContext,
  countSections,
  withConflictIds,
} from "../../../src/intake/product-context.ts";
import { copyFixture } from "../../helpers/fixtures.ts";
import {
  actorValue,
  candidate,
  draftOf,
  loadMasterDraft,
  masterRef,
  requirementValue,
  stateValue,
} from "../../helpers/intake.ts";

const META = { adapter: "navori-master", mode: "full", stage: null } as const;
const PATHS = (...sources: Parameters<typeof masterRef>[1][]) =>
  sources.map((source) => masterRef("", source).path);

describe("source precedence (RN-7)", () => {
  // Covers: R3, R4
  test("applies source precedence and records the winning source", () => {
    const digest = candidate(
      "businessRules",
      "RN-1",
      requirementValue("RN-1", "Members pay monthly."),
      masterRef("§Rules", "DIGEST.md"),
    );
    const master = candidate(
      "businessRules",
      "RN-1",
      requirementValue("RN-1", "members pay monthly"),
      masterRef("§Rules"),
    );
    const decisions = candidate(
      "businessRules",
      "RN-1",
      requirementValue("RN-1", "Members pay yearly."),
      masterRef("§D1", "DECISIONS.md"),
    );
    const { merged, mismatches } = mergeCandidates(
      [digest, master, decisions],
      PATHS("DIGEST.md", "MASTER.md", "DECISIONS.md"),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sourceRef.source).toBe("DECISIONS.md");
    expect(merged[0]?.alsoIn).toEqual([]);
    expect(mismatches.map((m) => [m.winner.sourceRef.source, m.other.sourceRef.source])).toEqual([
      ["DECISIONS.md", "MASTER.md"],
      ["DECISIONS.md", "DIGEST.md"],
    ]);

    // equal after normalizeText -> alsoIn, no mismatch
    const equal = mergeCandidates([digest, master], PATHS("DIGEST.md", "MASTER.md"));
    expect(equal.merged[0]?.sourceRef.source).toBe("MASTER.md");
    expect(equal.merged[0]?.alsoIn.map((ref) => ref.source)).toEqual(["DIGEST.md"]);
    expect(equal.mismatches).toEqual([]);
  });

  // Covers: R4
  test("exposes precedence as data", () => {
    expect(SOURCE_PRECEDENCE[0]).toBe("DECISIONS.md");
    expect(sourceRank("ux.json")).toBeLessThan(sourceRank("UX.md"));
    expect(sourceRank("navori.config.json")).toBe(SOURCE_PRECEDENCE.length - 1);
    expect(COMPARABLE_FIELDS.decisions).toEqual(["question", "chosen"]);
    expect(NAME_KEYED_SECTIONS).toEqual(["actors", "entities"]);
  });

  // Covers: R4
  test("breaks ties by source order in the draft and then by appearance", () => {
    const a = candidate("unresolvedQuestions", "q", { text: "A" }, masterRef("§Q", "context"), 1);
    const b = candidate("unresolvedQuestions", "q", { text: "B" }, masterRef("§Q", "context"), 0);
    expect(mergeCandidates([a, b], PATHS("context")).merged[0]?.value).toEqual({
      text: "B",
    });
  });

  // Covers: R4
  test("skips lower-tier unpaired items of name-keyed sections and lists them", () => {
    const master = candidate(
      "actors",
      "member",
      actorValue("Member", { cannot: ["Delete"] }),
      masterRef("§Actors"),
    );
    const digestPaired = candidate(
      "actors",
      "member",
      actorValue("Member"),
      masterRef("§Actors", "DIGEST.md"),
    );
    const digestOther = candidate(
      "actors",
      "guest",
      actorValue("Guest"),
      masterRef("§Actors", "DIGEST.md"),
      1,
    );
    const { merged, findings } = mergeCandidates(
      [digestOther, digestPaired, master],
      PATHS("MASTER.md", "DIGEST.md"),
    );
    expect(merged.map((m) => m.key)).toEqual(["member"]);
    expect(merged[0]?.alsoIn.map((r) => r.source)).toEqual(["DIGEST.md"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "LOWER_TIER_ITEMS_SKIPPED",
      severity: "info",
    });
    expect(findings[0]?.issues).toEqual([{ pointer: "§Actors", message: "guest" }]);
  });

  // Covers: R4
  test("pairs ux.json actors by pinned id and unions fields only one source carries", () => {
    const master = candidate(
      "actors",
      "partner",
      actorValue("Partner", { id: "ACT-PARTNER", cannot: ["See member data"] }),
      masterRef("§Actors"),
    );
    const ux = candidate(
      "actors",
      "act-partner",
      actorValue("Partner", {
        id: "ACT-PARTNER",
        capabilities: ["See member data"],
      }),
      masterRef("/actors/0", "ux.json"),
    );
    const { merged } = mergeCandidates([ux, master], PATHS("MASTER.md", "ux.json"));
    expect(merged).toHaveLength(1);
    expect(merged[0]?.value).toMatchObject({
      cannot: ["See member data"],
      capabilities: ["See member data"],
    });
    expect(merged[0]?.alsoIn.map((r) => r.source)).toEqual(["ux.json"]);
  });

  // Covers: R3, R4
  test("unions global and screens of states under the same key", () => {
    const md = candidate(
      "states",
      "loading",
      stateValue("Loading", true),
      masterRef("§G", "UX.md"),
    );
    const json = candidate(
      "states",
      "loading",
      stateValue("Loading", false, ["SCR-1", "SCR-2"]),
      masterRef("/screens/0/states/0", "ux.json"),
    );
    const { merged } = mergeCandidates([md, json], PATHS("UX.md", "ux.json"));
    expect(merged[0]?.sourceRef.source).toBe("ux.json");
    expect(merged[0]?.value).toEqual({
      name: "Loading",
      global: true,
      screens: ["SCR-1", "SCR-2"],
    });
  });

  // Covers: R3, R4
  test("builds the 19 sections deterministically with sorted findings and counts", () => {
    const draft = draftOf(
      [
        candidate("businessRules", "RN-2", requirementValue("RN-2", "B"), masterRef("§R"), 1),
        candidate("businessRules", "RN-1", requirementValue("RN-1", "A"), masterRef("§R"), 0),
        candidate("unresolvedQuestions", "q", { text: "Q?" }, masterRef("§Q", "UX.md")),
      ],
      {
        sources: [
          { source: "MASTER.md", path: masterRef("").path, status: "used" },
          {
            source: "UX.md",
            path: masterRef("", "UX.md").path,
            status: "used",
          },
        ],
      },
    );
    const first = buildProductContext(draft, META);
    expect(Object.keys(first.context).slice(0, 3)).toEqual(["kind", "schemaVersion", "metadata"]);
    for (const section of PRODUCT_CONTEXT_SECTIONS) expect(first.context[section]).toBeArray();
    expect(first.context.businessRules.map((r) => r.id)).toEqual(["RN-1", "RN-2"]);
    expect(first.context.businessRules[0]?.conflicts).toEqual([]);
    expect(first.defined.requirements).toEqual(new Set(["RN-1", "RN-2"]));
    expect(first.defined.decisions).toBeNull();
    expect(countSections(first.context)).toMatchObject({
      businessRules: 2,
      unresolvedQuestions: 1,
      actors: 0,
    });
    expect(JSON.stringify(buildProductContext(draft, META).context)).toBe(
      JSON.stringify(first.context),
    );
  });

  // Covers: R3
  test("derives the ids each defining source declares and sorts findings", () => {
    const draft = draftOf(
      [
        candidate(
          "decisions",
          "D1",
          { id: "D1", question: "Q", chosen: "C", discarded: [], date: null },
          masterRef("§D1", "DECISIONS.md"),
        ),
        candidate(
          "traceability",
          "RF-1",
          {
            requirement: "RF-1",
            parts: ["P1", "P2"],
            journeys: [],
            flows: [],
            screens: [],
            patterns: [],
          },
          masterRef("/parts/0", "parts.json"),
        ),
        candidate("actors", "member", actorValue("Member"), masterRef("§Actors")),
      ],
      {
        sources: [
          {
            source: "DECISIONS.md",
            path: masterRef("", "DECISIONS.md").path,
            status: "used",
          },
          { source: "MASTER.md", path: masterRef("").path, status: "read" },
          {
            source: "parts.json",
            path: masterRef("", "parts.json").path,
            status: "used",
          },
        ],
        findings: [
          {
            code: "SOURCE_NO_ELEMENTS",
            severity: "info",
            message: "b",
            paths: ["b"],
            issues: [],
          },
          {
            code: "SOURCE_NO_ELEMENTS",
            severity: "info",
            message: "b",
            paths: ["a"],
            issues: [],
          },
          {
            code: "SOURCE_NO_ELEMENTS",
            severity: "info",
            message: "a",
            paths: ["a"],
            issues: [],
          },
          {
            code: "CONTEXT_INPUT_INVALID",
            severity: "error",
            message: "x",
            paths: [],
            issues: [],
          },
        ],
      },
    );
    const { context, defined } = buildProductContext(draft, META);
    expect(defined.decisions).toEqual(new Set(["D1"]));
    expect(defined.parts).toEqual(
      new Map([
        ["P1", new Set()],
        ["P2", new Set()],
      ]),
    );
    expect(defined.requirements).toEqual(new Set());
    expect(defined.masterActors).toBe(true);
    expect(
      context.metadata.findings.map((f) => `${f.code}/${f.paths[0] ?? ""}/${f.message}`),
    ).toEqual([
      "CONTEXT_INPUT_INVALID//x",
      "SOURCE_NO_ELEMENTS/a/a",
      "SOURCE_NO_ELEMENTS/a/b",
      "SOURCE_NO_ELEMENTS/b/b",
    ]);
  });

  // Covers: R3
  test("unions states when a candidate carries no screens", () => {
    const bare = { name: "Empty", global: true } as unknown as ReturnType<typeof stateValue>;
    const merged = mergeCandidates(
      [
        candidate("states", "empty", bare, masterRef("§UX", "UX.md")),
        candidate(
          "states",
          "empty",
          stateValue("Empty", false, ["S1"]),
          masterRef("/s", "ux.json"),
        ),
      ],
      PATHS("ux.json", "UX.md"),
    );
    expect(merged.merged[0]?.value).toMatchObject({
      global: true,
      screens: ["S1"],
    });
  });
});

const named = (source: Parameters<typeof masterRef>[1], name: string) =>
  candidate("actors", name, actorValue(name), masterRef("§Actors", source));

describe("skipped lower-tier items", () => {
  // Covers: R4
  test("orders the skipped findings by numeric source rank", () => {
    // Ranks come from SOURCE_PRECEDENCE (0..9 today); the sort is numeric so rank 10 would follow rank 9.
    const { findings } = mergeCandidates(
      [
        named("MASTER.md", "member"),
        named("navori.config.json", "ghost-config"),
        named("DIGEST.md", "ghost-digest"),
        named("context", "ghost-context"),
      ],
      PATHS("MASTER.md", "DIGEST.md", "context", "navori.config.json"),
    );
    expect(findings.map((f) => f.paths[0])).toEqual(
      PATHS("DIGEST.md", "context", "navori.config.json"),
    );
  });
});

describe("conflicts over the conflict fixture", () => {
  const event: HeronEvent = { type: "approve-gate", gate: "intake" };
  const state: HeronState = {
    kind: "HeronState",
    schemaVersion: 1,
    stateRevision: 1,
    mode: "full",
    phase: "initialized",
    designRevision: 0,
    artifacts: [],
    gates: [],
    stale: [],
    history: [],
  };
  const ack = {
    by: "ana",
    at: "2026-10-01T10:00:00.000Z",
    note: "accepted",
    runId: "run-20261001T100000Z-3f9a1c2b",
  } as const;

  // Covers: R5, R7
  test("records a CONFLICT and blocks the intake gate until acknowledged", () => {
    const built = buildProductContext(loadMasterDraft(copyFixture("conflict")), META);
    const detected = detectConflicts(built.context, built.mismatches, built.defined);
    const doc = reconcileConflicts(null, detected);
    expect(doc.conflicts).toHaveLength(1);
    const conflict = doc.conflicts[0];
    expect(conflict).toMatchObject({
      id: "CONFLICT-001",
      kind: "permission-contradiction",
      subject: "ACT-PARTNER · see member data",
      status: "open",
      winner: null,
      ack: null,
      files: ["specs/_master/01-mvp/MASTER.md", "specs/_master/01-mvp/ux.json"],
    });
    expect(conflict?.values.map((v) => v.value)).toEqual([
      "cannot: See member data",
      "capability: See member data",
    ]);
    expect(conflict?.impact).toContain("actors/ACT-PARTNER");
    const withIds = withConflictIds(built.context, doc);
    expect(withIds.actors.find((a) => a.id === "ACT-PARTNER")).toMatchObject({
      can: expect.arrayContaining(["Publish benefits"]),
      cannot: ["See member data"],
      capabilities: expect.arrayContaining(["See member data"]),
      conflicts: ["CONFLICT-001"],
    });

    const facts = (docNow: typeof doc) => ({
      productContextValid: true,
      unacknowledgedConflicts: unacknowledgedCount(docNow),
    });
    const blocked = canTransition(state, event, facts(doc));
    expect(blocked).toMatchObject({ ok: false, code: "PRECONDITION_UNMET" });
    const acknowledged = acknowledgeConflict(doc, "CONFLICT-001", ack);
    if (!acknowledged.ok) throw new Error(acknowledged.message);
    expect(canTransition(state, event, facts(acknowledged.doc)).ok).toBe(true);
  });
});
