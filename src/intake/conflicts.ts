import {
  CONFLICT_KINDS,
  canonicalJson,
  type Conflict,
  type ConflictAck,
  type ConflictId,
  type ConflictKind,
  type ConflictValue,
  type IntakeConflicts,
  type ProductContext,
  type ProductContextSection,
  type RelativeArtifactPath,
  type Sha256Hex,
  type SourceKind,
  type SourceRef,
} from "../core/contracts/index.ts";
import { sha256Hex } from "../core/store/hash.ts";
import type { ValueMismatch } from "./precedence.ts";
import { elementKey, type DefinedIds, type DetectedConflict } from "./product-context.ts";
import { compareText, normalizeText } from "./text.ts";

type Fields = Record<string, unknown>;
type Element = Fields & { sourceRef: SourceRef; alsoIn: SourceRef[] };

const NOT_DECLARED = "(not declared)";
const NOT_DEFINED = "(not defined)";

/** Identity of a conflict (DR5): sha256 of the canonical `{kind, subject, values}` with the value pairs
 * `[source, normalizeText(value)]` sorted; paths and locators never take part. */
export function conflictFingerprint(
  conflict: Pick<DetectedConflict, "kind" | "subject" | "values">,
): Sha256Hex {
  const values = conflict.values
    .map((value): [string, string] => [value.sourceRef.source, normalizeText(value.value)])
    .toSorted((a, b) => compareText(a[0], b[0]) || compareText(a[1], b[1]));
  const text = canonicalJson({
    kind: conflict.kind,
    subject: conflict.subject,
    values,
  });
  return sha256Hex(new TextEncoder().encode(text));
}

function elementsOf(context: ProductContext, section: ProductContextSection): Element[] {
  return context[section] as unknown as Element[];
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Section/field pairs that cite an actor id, and those that cite a requirement id. */
const ACTOR_CITERS: readonly (readonly [ProductContextSection, string])[] = [
  ["surfaces", "actors"],
  ["journeys", "actor"],
  ["flows", "actor"],
  ["screens", "actors"],
  ["screens", "permissions"],
];
const REQUIREMENT_CITERS: readonly (readonly [ProductContextSection, string])[] = [
  ["surfaces", "requirements"],
  ["journeys", "requirements"],
  ["flows", "requirements"],
  ["screens", "requirements"],
  ["patterns", "requirements"],
  ["traceability", "requirement"],
  ["businessRules", "derivedFrom"],
  ["functionalRequirements", "derivedFrom"],
  ["nonFunctionalRequirements", "derivedFrom"],
];

/** `<section>/<key>` of every element whose `field` holds `id`, sorted. */
function citers(
  context: ProductContext,
  id: string,
  places: readonly (readonly [ProductContextSection, string])[],
): string[] {
  const found = places.flatMap(([section, field]) =>
    elementsOf(context, section)
      .filter((element) => strings(element[field]).includes(id))
      .map((element) => `${section}/${elementKey(element as never)}`),
  );
  return [...new Set(found)].toSorted(compareText);
}

function filesOf(values: readonly ConflictValue[]): RelativeArtifactPath[] {
  return [...new Set(values.map((value) => value.sourceRef.path))].toSorted(compareText);
}

function detected(
  kind: ConflictKind,
  subject: string,
  values: [ConflictValue, ConflictValue],
  impact: readonly string[],
  winner: SourceRef | null,
): DetectedConflict {
  const base = { kind, subject, values };
  return {
    ...base,
    files: filesOf(values),
    impact: [...new Set(impact)].toSorted(compareText),
    winner,
    fingerprint: conflictFingerprint(base),
  };
}

function refOf(element: Element, source: SourceKind): SourceRef | undefined {
  return [element.sourceRef, ...element.alsoIn].find((ref) => ref.source === source);
}

function sourcePath(context: ProductContext, source: SourceKind): RelativeArtifactPath | null {
  return context.metadata.sources.find((record) => record.source === source)?.path ?? null;
}

function actorConflicts(context: ProductContext, defined: DefinedIds): DetectedConflict[] {
  const out: DetectedConflict[] = [];
  const masterPath = sourcePath(context, "MASTER.md");
  const actors = elementsOf(context, "actors");
  if (defined.masterActors && masterPath !== null) {
    for (const ux of defined.uxActors) {
      const paired = actors.some((actor) =>
        [actor.sourceRef, ...actor.alsoIn].some(
          (ref) => ref.path === ux.ref.path && ref.locator === ux.ref.locator,
        ),
      );
      if (paired) continue;
      out.push(
        detected(
          "actor-unknown",
          ux.id,
          [
            {
              sourceRef: { source: "MASTER.md", path: masterPath, locator: "" },
              value: NOT_DECLARED,
            },
            { sourceRef: ux.ref, value: `${ux.id} ${ux.name}` },
          ],
          [`actors/${ux.id}`, ...citers(context, ux.id, ACTOR_CITERS)],
          null,
        ),
      );
    }
  }
  for (const actor of actors) {
    const master = refOf(actor, "MASTER.md");
    const ux = refOf(actor, "ux.json");
    if (master === undefined || ux === undefined) continue;
    const id = typeof actor["id"] === "string" ? actor["id"] : String(actor["name"] ?? "");
    const clashes = (
      [
        ["capability", "capabilities", "cannot"],
        ["forbidden", "forbiddenActions", "can"],
      ] as const
    ).flatMap(([uxLabel, uxField, masterField]) => {
      const forbidden = new Map(
        strings(actor[masterField]).map((text) => [normalizeText(text), text]),
      );
      return strings(actor[uxField]).flatMap((text) => {
        const masterText = forbidden.get(normalizeText(text));
        return masterText === undefined ? [] : [{ uxLabel, masterField, masterText, text }];
      });
    });
    for (const clash of clashes) {
      out.push(
        detected(
          "permission-contradiction",
          `${id} · ${normalizeText(clash.text)}`,
          [
            {
              sourceRef: master,
              value: `${clash.masterField === "cannot" ? "cannot" : "can"}: ${clash.masterText}`,
            },
            { sourceRef: ux, value: `${clash.uxLabel}: ${clash.text}` },
          ],
          [`actors/${elementKey(actor as never)}`, ...citers(context, id, ACTOR_CITERS)],
          null,
        ),
      );
    }
  }
  return out;
}

const REQUIREMENT_ID = /^(?:RN|RF|RNF)-\d+$/;
const PART_ID = /^P\d+$/;
const CRITERION_ID = /^P\d+\.A\d+$/;
const DECISION_ID = /^D\d+$/;

type Citation = { id: string; source: SourceKind; ref: SourceRef; at: string };

/** Ids that `ux.json`, `parts.json` or a requirement's `derivedFrom` cite, with who cites them. */
function citations(context: ProductContext): Citation[] {
  const out: Citation[] = [];
  const add = (
    element: Element,
    section: ProductContextSection,
    ids: string[],
    only?: SourceKind[],
  ) => {
    for (const ref of [element.sourceRef, ...element.alsoIn]) {
      if (only !== undefined && !only.includes(ref.source)) continue;
      for (const id of ids)
        out.push({
          id,
          source: ref.source,
          ref,
          at: `${section}/${elementKey(element as never)}`,
        });
    }
  };
  const citing: SourceKind[] = ["ux.json", "parts.json"];
  for (const [section, field] of REQUIREMENT_CITERS) {
    for (const element of elementsOf(context, section)) {
      if (field === "derivedFrom") add(element, section, strings(element[field]));
      else add(element, section, strings(element[field]), citing);
    }
  }
  for (const element of elementsOf(context, "traceability")) {
    // parts.json defines parts: only another source citing them can be wrong.
    add(element, "traceability", strings(element["parts"]), ["ux.json"]);
  }
  return out;
}

function referenceConflicts(context: ProductContext, defined: DefinedIds): DetectedConflict[] {
  const groups = new Map<string, { citation: Citation; definer: SourceKind; ats: string[] }>();
  for (const citation of citations(context)) {
    const { id } = citation;
    let definer: SourceKind | null = null;
    if (REQUIREMENT_ID.test(id) && defined.requirements !== null && !defined.requirements.has(id)) {
      definer = "MASTER.md";
    } else if (defined.parts !== null && (PART_ID.test(id) || CRITERION_ID.test(id))) {
      const part = id.split(".")[0] ?? id;
      const criteria = defined.parts.get(part);
      if (criteria === undefined || (CRITERION_ID.test(id) && !criteria.has(id))) {
        definer = "parts.json";
      }
    } else if (DECISION_ID.test(id) && defined.decisions !== null && !defined.decisions.has(id)) {
      definer = "DECISIONS.md";
    }
    if (definer === null) continue;
    const key = `${id}\u0000${citation.source}`;
    const group = groups.get(key) ?? { citation, definer, ats: [] };
    group.ats.push(citation.at);
    groups.set(key, group);
  }
  const out: DetectedConflict[] = [];
  for (const { citation, definer, ats } of groups.values()) {
    const path = sourcePath(context, definer);
    if (path === null) continue;
    out.push(
      detected(
        "reference-unknown",
        citation.id,
        [
          {
            sourceRef: { source: definer, path, locator: "" },
            value: NOT_DEFINED,
          },
          { sourceRef: citation.ref, value: citation.id },
        ],
        ats,
        null,
      ),
    );
  }
  return out;
}

function mismatchConflicts(context: ProductContext, mismatches: readonly ValueMismatch[]) {
  return mismatches.map((m) =>
    detected(
      "value-mismatch",
      `${m.section}/${m.key}`,
      [m.winner, m.other],
      [`${m.section}/${m.key}`, ...citers(context, m.key, REQUIREMENT_CITERS)],
      m.winner.sourceRef,
    ),
  );
}

/** The closed catalog of deterministic conflicts (DR4), numbered by (kind, subject) order. Pure. */
export function detectConflicts(
  context: ProductContext,
  mismatches: readonly ValueMismatch[],
  defined: DefinedIds,
): DetectedConflict[] {
  const all = [
    ...actorConflicts(context, defined),
    ...mismatchConflicts(context, mismatches),
    ...referenceConflicts(context, defined),
  ];
  const unique = new Map(all.map((conflict) => [conflict.fingerprint, conflict]));
  return [...unique.values()].toSorted(
    (a, b) =>
      CONFLICT_KINDS.indexOf(a.kind) - CONFLICT_KINDS.indexOf(b.kind) ||
      compareText(a.subject, b.subject) ||
      compareText(a.fingerprint, b.fingerprint),
  );
}

const ID_NUMBER = /^CONFLICT-(\d+)$/;

function formatId(n: number): ConflictId {
  return `CONFLICT-${String(n).padStart(3, "0")}`;
}

/** Matches by fingerprint (DR5): an open one keeps id and ack, a resolved one reopens with both, a new one gets
 * `CONFLICT-{max+1}` in detection order, an open one no longer detected becomes resolved. Ids are never reused. */
export function reconcileConflicts(
  previous: IntakeConflicts | null,
  detectedNow: readonly DetectedConflict[],
): IntakeConflicts {
  const before = previous?.conflicts ?? [];
  const byFingerprint = new Map(before.map((conflict) => [conflict.fingerprint, conflict]));
  let next =
    Math.max(0, ...before.map((conflict) => Number(ID_NUMBER.exec(conflict.id)?.[1] ?? 0))) + 1;
  const seen = new Set<string>();
  const current: Conflict[] = detectedNow.map((found) => {
    seen.add(found.fingerprint);
    const known = byFingerprint.get(found.fingerprint);
    return {
      ...found,
      id: known?.id ?? formatId(next++),
      status: "open",
      ack: known?.ack ?? null,
    };
  });
  const gone: Conflict[] = before
    .filter((conflict) => !seen.has(conflict.fingerprint))
    .map((conflict) => ({ ...conflict, status: "resolved" }));
  return {
    kind: "IntakeConflicts",
    schemaVersion: 1,
    conflicts: [...current, ...gone].toSorted((a, b) => compareText(a.id, b.id)),
  };
}

export type AckOutcome =
  | { ok: true; doc: IntakeConflicts; conflict: Conflict }
  | {
      ok: false;
      code: "CONFLICT_NOT_FOUND" | "CONFLICT_ALREADY_ACKNOWLEDGED";
      message: string;
    };

/** Records `ack` on conflict `id`; never mutates `doc`. */
export function acknowledgeConflict(
  doc: IntakeConflicts,
  id: ConflictId,
  ack: ConflictAck,
): AckOutcome {
  const found = doc.conflicts.find((conflict) => conflict.id === id);
  if (found === undefined) {
    return {
      ok: false,
      code: "CONFLICT_NOT_FOUND",
      message: `${id} is not a known conflict`,
    };
  }
  if (found.ack !== null) {
    return {
      ok: false,
      code: "CONFLICT_ALREADY_ACKNOWLEDGED",
      message: `${id} is already acknowledged`,
    };
  }
  const conflict: Conflict = { ...found, ack };
  return {
    ok: true,
    conflict,
    doc: {
      ...doc,
      conflicts: doc.conflicts.map((item) => (item.id === id ? conflict : item)),
    },
  };
}

/** Open conflicts without acknowledgement; 0 without a document. */
export function unacknowledgedCount(doc: IntakeConflicts | null): number {
  return doc?.conflicts.filter((c) => c.status === "open" && c.ack === null).length ?? 0;
}
