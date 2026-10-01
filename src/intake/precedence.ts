import {
  SOURCE_KINDS,
  type ConflictValue,
  type Finding,
  type ProductContextSection,
  type RelativeArtifactPath,
  type SourceKind,
  type SourceRef,
} from "../core/contracts/index.ts";
import type { Candidate } from "./ports.ts";
import { actorKeys, compareText, normalizeText } from "./text.ts";

/** RN-7 order first; "manual" and "navori.config.json" never compete (DR3). Lower index wins. */
export const SOURCE_PRECEDENCE: readonly SourceKind[] = SOURCE_KINDS;

/** Position of `kind` in `SOURCE_PRECEDENCE`; 0 is the highest precedence. */
export function sourceRank(kind: SourceKind): number {
  return SOURCE_PRECEDENCE.indexOf(kind);
}

/** Fields compared after `normalizeText` when two sources carry the same element (DR3). */
export const COMPARABLE_FIELDS: Readonly<
  Partial<Record<ProductContextSection, readonly string[]>>
> = {
  businessRules: ["text"],
  functionalRequirements: ["text"],
  nonFunctionalRequirements: ["text"],
  capabilities: ["text"],
  decisions: ["question", "chosen"],
  product: ["value"],
};

/** Sections whose elements are paired by name; lower-tier unpaired items are skipped (DR21). */
export const NAME_KEYED_SECTIONS: readonly ProductContextSection[] = ["actors", "entities"];

export type ValueMismatch = {
  section: ProductContextSection;
  key: string;
  winner: ConflictValue;
  other: ConflictValue;
};
export type MergedElement = {
  section: ProductContextSection;
  key: string;
  value: Candidate["value"];
  sourceRef: SourceRef;
  alsoIn: SourceRef[];
};

type Fields = Record<string, unknown>;

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.values(value).every(isEmpty);
  return false;
}

function sameRef(a: SourceRef, b: SourceRef): boolean {
  return a.source === b.source && a.path === b.path && a.locator === b.locator;
}

/** Union of two string lists keeping first-seen order. */
function unionStrings(a: unknown, b: unknown): string[] {
  return [...new Set([...(a as string[]), ...(b as string[])])];
}

/** Fills the winner's empty fields from the others, in precedence order; states also union
 * `global` (any) and `screens` (UX.md global states + ux.json per-screen states, spec T6 note). */
function unionFields(section: ProductContextSection, group: readonly Candidate[]): Fields {
  const result: Fields = { ...(group[0]?.value as Fields) };
  for (const other of group.slice(1)) {
    for (const [field, value] of Object.entries(other.value as Fields)) {
      if (isEmpty(result[field]) && !isEmpty(value)) result[field] = value;
    }
    if (section === "states") {
      result["global"] = result["global"] === true || (other.value as Fields)["global"] === true;
      result["screens"] = unionStrings(result["screens"], (other.value as Fields)["screens"]);
    }
  }
  return result;
}

function compareCandidates(
  a: Candidate,
  b: Candidate,
  sourceOrder: readonly RelativeArtifactPath[],
) {
  const index = (c: Candidate): number => {
    const at = sourceOrder.indexOf(c.ref.path);
    return at === -1 ? sourceOrder.length : at;
  };
  return (
    sourceRank(a.ref.source) - sourceRank(b.ref.source) || index(a) - index(b) || a.order - b.order
  );
}

function pinnedId(candidate: Candidate): string | null {
  const id = (candidate.value as Fields)["id"];
  return typeof id === "string" && id !== "" ? id : null;
}

/** Groups sorted candidates by (section, key); name-keyed sections pair by pinned id, then key (DR21). */
function groupCandidates(sorted: readonly Candidate[]): Candidate[][] {
  const groups: Candidate[][] = [];
  const byKey = new Map<string, Candidate[]>();
  const byId = new Map<string, Candidate[]>();
  for (const candidate of sorted) {
    const named = NAME_KEYED_SECTIONS.includes(candidate.section);
    const id = named ? pinnedId(candidate) : null;
    const keys = named ? actorKeys(candidate.key).keys : [];
    const lookup = `${candidate.section}\u0000${candidate.key}`;
    let group =
      (id === null ? undefined : byId.get(`${candidate.section}\u0000${id}`)) ??
      (named
        ? keys.map((k) => byKey.get(`${candidate.section}\u0000${k}`)).find(Boolean)
        : undefined) ??
      byKey.get(lookup);
    if (group === undefined) {
      group = [];
      groups.push(group);
    }
    group.push(candidate);
    byKey.set(lookup, group);
    for (const k of keys) byKey.set(`${candidate.section}\u0000${k}`, group);
    if (id !== null) byId.set(`${candidate.section}\u0000${id}`, group);
  }
  return groups;
}

function comparedText(candidate: Candidate, field: string): string {
  const value = (candidate.value as Fields)[field];
  return typeof value === "string" ? value : "";
}

/** Merges candidates by (section, key): lowest-rank source wins, equal comparable values go to
 * `alsoIn`, different ones to `mismatches`, lower-tier unpaired name-keyed items are skipped. */
export function mergeCandidates(
  candidates: readonly Candidate[],
  sourceOrder: readonly RelativeArtifactPath[],
): {
  merged: MergedElement[];
  mismatches: ValueMismatch[];
  findings: Finding[];
} {
  const sorted = candidates.toSorted((a, b) => compareCandidates(a, b, sourceOrder));
  const topRank = new Map<ProductContextSection, number>();
  for (const c of sorted) {
    if (!topRank.has(c.section)) topRank.set(c.section, sourceRank(c.ref.source));
  }

  const merged: MergedElement[] = [];
  const mismatches: ValueMismatch[] = [];
  const skipped = new Map<string, Candidate[]>(); // "<section index>:<rank>" -> skipped winners
  for (const group of groupCandidates(sorted)) {
    const winner = group[0];
    if (winner === undefined) continue;
    if (
      NAME_KEYED_SECTIONS.includes(winner.section) &&
      sourceRank(winner.ref.source) > (topRank.get(winner.section) ?? 0)
    ) {
      const id = `${winner.section}\u0000${sourceRank(winner.ref.source)}`;
      skipped.set(id, [...(skipped.get(id) ?? []), winner]);
      continue;
    }
    const fields = COMPARABLE_FIELDS[winner.section] ?? [];
    const alsoIn: SourceRef[] = [];
    for (const other of group.slice(1)) {
      const differing = fields.find((field) => {
        const a = comparedText(winner, field);
        const b = comparedText(other, field);
        return a !== "" && b !== "" && normalizeText(a) !== normalizeText(b);
      });
      if (differing === undefined) {
        if (!sameRef(other.ref, winner.ref) && !alsoIn.some((ref) => sameRef(ref, other.ref))) {
          alsoIn.push(other.ref);
        }
        continue;
      }
      const label = fields.length > 1 ? `${differing}: ` : "";
      mismatches.push({
        section: winner.section,
        key: winner.key,
        winner: {
          sourceRef: winner.ref,
          value: `${label}${comparedText(winner, differing)}`,
        },
        other: {
          sourceRef: other.ref,
          value: `${label}${comparedText(other, differing)}`,
        },
      });
    }
    merged.push({
      section: winner.section,
      key: winner.key,
      // TypeScript cannot correlate the section with the unioned value; the candidates already did.
      value: unionFields(winner.section, group) as Candidate["value"],
      sourceRef: winner.ref,
      alsoIn,
    });
  }

  const findings: Finding[] = [...skipped.entries()]
    .toSorted(([a], [b]) => compareText(a, b))
    .map(([, items]) => {
      const first = items[0] as Candidate;
      const issues = items
        .map((c) => ({ pointer: c.ref.locator, message: c.key }))
        .toSorted((a, b) => compareText(a.pointer, b.pointer) || compareText(a.message, b.message));
      return {
        code: "LOWER_TIER_ITEMS_SKIPPED",
        severity: "info",
        message: `${items.length} ${first.section} item(s) from ${first.ref.source} without a match in a higher-precedence source were skipped`,
        paths: [first.ref.path],
        issues,
      };
    });
  return { merged, mismatches, findings };
}
