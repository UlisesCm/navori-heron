import type {
  HeronMode,
  ProductContextSection,
  RelativeArtifactPath,
  SourceKind,
  SourceRef,
} from "../../src/core/contracts/index.ts";
import { nodeFs } from "../../src/core/store/fs-port.ts";
import { navoriMasterAdapter } from "../../src/intake/adapters/navori-master/index.ts";
import { DEFAULT_INPUT_LIMITS, type Candidate, type ContextDraft } from "../../src/intake/ports.ts";

const STAGE = "specs/_master/01-mvp";
const PATHS: Readonly<Record<SourceKind, RelativeArtifactPath>> = {
  "DECISIONS.md": `${STAGE}/DECISIONS.md`,
  "MASTER.md": `${STAGE}/MASTER.md`,
  "parts.json": `${STAGE}/parts.json`,
  "ux.json": `${STAGE}/ux.json`,
  "UX.md": `${STAGE}/UX.md`,
  "DIGEST.md": `${STAGE}/context/DIGEST.md`,
  "CODEBASE.md": `${STAGE}/context/CODEBASE.md`,
  context: `${STAGE}/context/md/brand.md`,
  manual: "context.json",
  "navori.config.json": "navori.config.json",
};

/** Source reference with the conventional path of `source` in the 01-mvp stage. */
export function masterRef(locator: string, source: SourceKind = "MASTER.md"): SourceRef {
  return { source, path: PATHS[source], locator };
}

/** Candidate double: `order` defaults to 0 and `ref` to a MASTER.md locator. */
export function candidate<S extends ProductContextSection>(
  section: S,
  key: string,
  value: Extract<Candidate, { section: S }>["value"],
  ref: SourceRef = masterRef("§Test"),
  order = 0,
): Candidate {
  // TypeScript cannot correlate `section` with `value` through the generic; the signature does.
  return { section, key, value, ref, order } as Candidate;
}

/** Draft double with the given candidates, no findings and no UX reader. */
export function draftOf(
  candidates: Candidate[],
  overrides: Partial<ContextDraft> = {},
): ContextDraft {
  return {
    sources: [],
    candidates,
    uxReader: null,
    uxExtensions: [],
    findings: [],
    ...overrides,
  };
}

/** Business-rule/requirement value with the given id and text. */
export function requirementValue(
  id: string,
  text: string,
): Extract<Candidate, { section: "businessRules" }>["value"] {
  return { id, text, derivedFrom: [] };
}

/** Actor value; every list defaults to empty. */
export function actorValue(
  name: string,
  overrides: Partial<Extract<Candidate, { section: "actors" }>["value"]> = {},
): Extract<Candidate, { section: "actors" }>["value"] {
  return {
    id: null,
    name,
    goal: null,
    can: [],
    cannot: [],
    capabilities: [],
    forbiddenActions: [],
    constraints: [],
    surfaces: [],
    relations: [],
    extensions: [],
    ...overrides,
  };
}

/** Global/per-screen state value. */
export function stateValue(
  name: string,
  global: boolean,
  screens: string[] = [],
): Extract<Candidate, { section: "states" }>["value"] {
  return { name, global, screens };
}

/** Detects and loads the navori-master draft of the repository at `root`; throws when it cannot. */
export function loadMasterDraft(root: string, mode: HeronMode = "full"): ContextDraft {
  const request = { root, stage: null, fs: nodeFs, limits: DEFAULT_INPUT_LIMITS };
  const detected = navoriMasterAdapter.detect(request);
  if (detected.kind !== "detected") throw new Error(`navori-master not detected in ${root}`);
  const loaded = navoriMasterAdapter.load({ ...request, report: detected.report, mode });
  if (!loaded.ok) throw new Error(loaded.message);
  return loaded.draft;
}
