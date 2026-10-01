import { join } from "node:path";
import {
  RESEARCH_REFERENCES_DOCUMENT,
  type BoundArtifact,
  type GateName,
  type HeronState,
  type RelativeArtifactPath,
  type ResearchReference,
  type Sha256Hex,
} from "../core/contracts/index.ts";
import {
  GATE_BINDINGS,
  invalidatedGates,
  isApprovalValid,
  latestDecision,
} from "../core/state/gates.ts";
import { compareStrings } from "../core/state/stale.ts";
import type { TransitionFacts } from "../core/state/transitions.ts";
import type { FileStore } from "../core/store/file-store.ts";
import type { ReadonlyFs } from "../core/store/fs-port.ts";
const GLOB_SUFFIX = "/**";

/** Files under `dir` (relative to .heron/), recursively; symlinks are never followed. */
function listFiles(fs: ReadonlyFs, heronDir: string, dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(join(heronDir, dir));
  } catch {
    return out;
  }
  for (const entry of entries) {
    const relative = `${dir}/${entry}`;
    const stat = fs.lstatSync(join(heronDir, relative));
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) out.push(...listFiles(fs, heronDir, relative));
    else if (stat.isFile()) out.push(relative);
  }
  return out;
}

/** Existing files matching GATE_BINDINGS[gate] (exact paths or `dir/**`), hashed, sorted by path. */
export function boundArtifacts(fs: ReadonlyFs, store: FileStore, gate: GateName): BoundArtifact[] {
  const paths = new Set<string>();
  for (const pattern of GATE_BINDINGS[gate]) {
    if (pattern.endsWith(GLOB_SUFFIX)) {
      const dir = pattern.slice(0, -GLOB_SUFFIX.length);
      for (const file of listFiles(fs, store.heronDir, dir)) paths.add(file);
    } else {
      paths.add(pattern);
    }
  }
  const artifacts: BoundArtifact[] = [];
  for (const path of [...paths].toSorted(compareStrings)) {
    const sha256 = store.sha256(path);
    if (sha256 !== null) artifacts.push({ path, sha256 });
  }
  return artifacts;
}

/** P1 fills invalidatedGates and intakeApprovalValid (isApprovalValid over the store) and, when gate != null,
 * boundArtifactCount; every other fact stays absent so its precondition fails closed. */
export function collectTransitionFacts(
  store: FileStore,
  state: HeronState,
  gate: GateName | null,
  fs: ReadonlyFs,
): TransitionFacts {
  const current = new Map<RelativeArtifactPath, Sha256Hex>();
  for (const decision of state.gates) {
    for (const artifact of decision.artifacts) {
      const sha = store.sha256(artifact.path);
      if (sha !== null) current.set(artifact.path, sha);
    }
  }
  const intake = latestDecision(state, "intake");
  const facts: TransitionFacts = {
    invalidatedGates: invalidatedGates(state, current),
    intakeApprovalValid: intake?.decision === "approved" && isApprovalValid(intake, current).valid,
  };
  if (gate !== null) facts.boundArtifactCount = boundArtifacts(fs, store, gate).length;
  return facts;
}

/** A reference counts toward D16 when every RN-11 field is present (the schema already enforces the bounds). */
function hasProvenance(reference: ResearchReference): boolean {
  return (
    reference.removed === null &&
    reference.origin.trim() !== "" &&
    reference.reason.trim() !== "" &&
    reference.studies.length > 0 &&
    reference.doNotCopy.length > 0 &&
    reference.influences.length > 0
  );
}

/** referencesWithProvenance = active references in research/references.json with complete provenance;
 * minReferences = settings.minReferences (D16: 5). Absent references.json -> 0.
 * Throws the store's document errors, which callers map with storeErrorResult. */
export function collectResearchFacts(
  store: FileStore,
  settings: { minReferences: number },
): Pick<TransitionFacts, "referencesWithProvenance" | "minReferences"> {
  const document = store.readDocument("research/references.json", RESEARCH_REFERENCES_DOCUMENT);
  return {
    referencesWithProvenance: document?.references.filter(hasProvenance).length ?? 0,
    minReferences: settings.minReferences,
  };
}
