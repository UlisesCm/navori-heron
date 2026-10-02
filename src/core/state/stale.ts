import {
  HERON_PHASES,
  type HeronPhase,
  type HeronState,
  type RelativeArtifactPath,
  type StaleEntry,
} from "../contracts/index.ts";

/** Artifacts (globs relative to .heron/) produced when entering each phase. */
export const PHASE_ARTIFACTS: Readonly<Record<HeronPhase, readonly string[]>> = {
  initialized: ["project.json", "intake/mode.json"],
  "intake-ready": ["intake/product-context.json", "intake/conflicts.json"],
  researching: [
    "research/references.json",
    "research/provenance.json",
    "research/REFERENCES.md",
    "research/moodboards/**",
    "research/assets/**",
    "research/sources/**",
    "research/brief.json",
    "research/analysis.json",
    "brand/**",
  ],
  "research-ready": [],
  "directions-ready": ["research/visual-directions.json", "penpot/review-sync.json"],
  "direction-selected": [],
  "foundations-ready": ["design/foundations/**", "design/tokens/**", "design/DESIGN.md"],
  "representative-screens-ready": ["design/screens/**"],
  "system-ready": ["design/design-system.json", "design/components/**", "design/patterns/**"],
  "screens-ready": ["design/screens/**"],
  "penpot-synced": ["penpot/sync-state.json"],
  validated: ["validation/**"],
  exported: [],
};

const SYSTEM_DEPS: readonly string[] = ["design/screens/**", "design/tokens/**"];

/** Dependent glob -> globs it depends on (closure computed transitively). */
export const ARTIFACT_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  "intake/product-context.json": ["intake/mode.json"],
  "intake/conflicts.json": ["intake/product-context.json"],
  "research/analysis.json": ["research/references.json"],
  "research/visual-directions.json": [
    "research/references.json",
    "intake/product-context.json",
    "research/analysis.json",
    "research/brief.json",
  ],
  "design/foundations/**": ["research/visual-directions.json", "intake/product-context.json"],
  "design/tokens/**": ["design/foundations/**"],
  "design/DESIGN.md": ["design/tokens/**"],
  "design/screens/**": ["design/tokens/**", "intake/product-context.json"],
  "design/design-system.json": SYSTEM_DEPS,
  "design/components/**": SYSTEM_DEPS,
  "design/patterns/**": SYSTEM_DEPS,
  "penpot/review-sync.json": ["research/visual-directions.json", "research/references.json"],
  "penpot/sync-state.json": ["design/**"],
  "validation/**": ["design/**", "penpot/sync-state.json"],
};

/** Locale-independent code-unit comparison, used for every deterministic ordering in the state domain. */
export function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Linear wildcard match: "*" matches any run of chars (incl. empty); all else is literal. No RegExp (ReDoS-safe). */
function segmentMatches(segment: string, pattern: string): boolean {
  let s = 0;
  let p = 0;
  let star = -1;
  let mark = 0;
  while (s < segment.length) {
    if (p < pattern.length && pattern[p] === "*") {
      star = p;
      mark = s;
      p += 1;
    } else if (p < pattern.length && pattern[p] === segment[s]) {
      s += 1;
      p += 1;
    } else if (star === -1) {
      return false;
    } else {
      mark += 1;
      s = mark;
      p = star + 1;
    }
  }
  while (p < pattern.length && pattern[p] === "*") p += 1;
  return p === pattern.length;
}

function matchSegments(path: readonly string[], pattern: readonly string[]): boolean {
  const [head, ...rest] = pattern;
  if (head === undefined) return path.length === 0;
  if (head === "**") {
    for (let skip = 0; skip <= path.length; skip += 1) {
      if (matchSegments(path.slice(skip), rest)) return true;
    }
    return false;
  }
  const [first, ...remaining] = path;
  return first !== undefined && segmentMatches(first, head) && matchSegments(remaining, rest);
}

/** Segments split on "/"; "**" matches zero or more segments, "*" any chars within one segment; nothing else is special. */
export function matchesGlob(path: string, pattern: string): boolean {
  return matchSegments(path.split("/"), pattern.split("/"));
}

/** Dependent glob keys affected, transitively, by the changed paths. */
function affectedKeys(changed: readonly string[]): Set<string> {
  const affected = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [key, deps] of Object.entries(ARTIFACT_DEPENDENCIES)) {
      if (affected.has(key)) continue;
      // A key is used as a path sample to test overlap with dependency globs ("**" acts as a literal segment).
      const hit = deps.some(
        (dep) =>
          changed.some((path) => matchesGlob(path, dep)) ||
          [...affected].some((other) => matchesGlob(other, dep)),
      );
      if (hit) {
        affected.add(key);
        grew = true;
      }
    }
  }
  return affected;
}

function withStale(
  state: HeronState,
  paths: readonly RelativeArtifactPath[],
  reason: string,
): HeronState {
  const known = new Set(state.stale.map((entry) => entry.path));
  const added: StaleEntry[] = [...new Set(paths)]
    .filter((path) => !known.has(path))
    .map((path) => ({ path, reason, since: state.stateRevision }));
  if (added.length === 0) return state;
  const stale = [...state.stale, ...added].toSorted((a, b) => compareStrings(a.path, b.path));
  return { ...state, stale };
}

/** Adds a StaleEntry for every state.artifacts path that transitively depends on a changed path. */
export function propagateStale(
  state: HeronState,
  changed: readonly RelativeArtifactPath[],
  reason: string,
): HeronState {
  if (changed.length === 0) return state;
  const keys = [...affectedKeys(changed)];
  const paths = state.artifacts
    .map((artifact) => artifact.path)
    .filter((path) => keys.some((key) => matchesGlob(path, key)));
  return withStale(state, paths, reason);
}

/** Adds a StaleEntry for every state.artifacts path produced by a phase after `phase`. */
export function markStaleAfter(state: HeronState, phase: HeronPhase, reason: string): HeronState {
  const later = HERON_PHASES.slice(HERON_PHASES.indexOf(phase) + 1).flatMap(
    (next) => PHASE_ARTIFACTS[next],
  );
  const paths = state.artifacts
    .map((artifact) => artifact.path)
    .filter((path) => later.some((glob) => matchesGlob(path, glob)));
  return withStale(state, paths, reason);
}
