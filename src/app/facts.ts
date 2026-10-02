import { join } from "node:path";
import {
  INTAKE_CONFLICTS_DOCUMENT,
  RESEARCH_REFERENCES_DOCUMENT,
  type BoundArtifact,
  type GateName,
  type HeronState,
  type RelativeArtifactPath,
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
import type { ResearchSettings } from "../research/ports.ts";
import { missingProvenance } from "../research/provenance.ts";
import { unacknowledgedCount } from "../intake/conflicts.ts";
import type { AppContext } from "./context.ts";
import { CONFLICTS_FILE, PRODUCT_CONTEXT_FILE, computeIntake } from "./intake.ts";
import { selectionOf, type Workspace } from "./workspace.ts";
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

/** referencesWithProvenance = active references in research/references.json with no `missingProvenance` field;
 * minReferences = settings.minReferences (D16: 5). Absent references.json -> 0.
 * Throws the store's document errors, which callers map with storeErrorResult. */
export function collectResearchFacts(
  store: FileStore,
  settings: Pick<ResearchSettings, "minReferences">,
): Pick<TransitionFacts, "referencesWithProvenance" | "minReferences"> {
  const document = store.readDocument("research/references.json", RESEARCH_REFERENCES_DOCUMENT);
  return {
    referencesWithProvenance:
      document?.references.filter(
        (reference) => reference.removed === null && missingProvenance(reference).length === 0,
      ).length ?? 0,
    minReferences: settings.minReferences,
  };
}

/** researchApprovalValid = the latest `research` decision is an approval whose bound artifacts still hash the same.
 * No decision or a rejection -> false (the precondition fails closed). */
export function collectDirectionFacts(
  store: FileStore,
  state: HeronState,
): Pick<TransitionFacts, "researchApprovalValid"> {
  const research = latestDecision(state, "research");
  if (research?.decision !== "approved") return { researchApprovalValid: false };
  const current = new Map<RelativeArtifactPath, Sha256Hex>();
  for (const artifact of research.artifacts) {
    const sha = store.sha256(artifact.path);
    if (sha !== null) current.set(artifact.path, sha);
  }
  return { researchApprovalValid: isApprovalValid(research, current).valid };
}

/** True when `path` holds exactly `text` (the bytes a regeneration would write). */
function storedEquals(store: FileStore, path: string, text: string): boolean {
  const onDisk = store.readBytes(path);
  return onDisk !== null && Buffer.compare(onDisk, new TextEncoder().encode(text)) === 0;
}

/** productContextValid = both intake documents exist and computeIntake reproduces them byte for byte;
 * unacknowledgedConflicts = unacknowledgedCount(stored). Always present (DR17). May throw document errors. */
export function collectIntakeFacts(
  ctx: AppContext,
  workspace: Workspace,
  store: FileStore,
): Pick<TransitionFacts, "productContextValid" | "unacknowledgedConflicts"> {
  const stored = store.readDocument(CONFLICTS_FILE, INTAKE_CONFLICTS_DOCUMENT);
  const unacknowledgedConflicts = unacknowledgedCount(stored);
  if (stored === null || store.readBytes(PRODUCT_CONTEXT_FILE) === null) {
    return { productContextValid: false, unacknowledgedConflicts };
  }
  const computed = computeIntake(
    ctx,
    {
      path: workspace.root,
      root: workspace.root,
      detection: workspace.detection,
      mode: workspace.mode,
      selection: selectionOf(workspace.project),
    },
    stored,
  );
  const productContextValid =
    computed.ok &&
    storedEquals(store, PRODUCT_CONTEXT_FILE, computed.value.texts.context) &&
    storedEquals(store, CONFLICTS_FILE, computed.value.texts.conflicts);
  return { productContextValid, unacknowledgedConflicts };
}
