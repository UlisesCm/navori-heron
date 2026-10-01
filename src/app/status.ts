import {
  GATE_NAMES,
  INTAKE_CONFLICTS_DOCUMENT,
  type DetectionReport,
  type Finding,
  type StoredFinding,
  type GateName,
  type RelativeArtifactPath,
  type Sha256Hex,
  type StatusData,
} from "../core/contracts/index.ts";
import {
  gateStatuses,
  invalidatedGates,
  isApprovalValid,
  latestDecision,
} from "../core/state/gates.ts";
import { describeModeBlock } from "../core/state/mode.ts";
import { compareStrings } from "../core/state/stale.ts";
import { allowedEvents } from "../core/state/transitions.ts";
import type { AppContext } from "./context.ts";
import { unacknowledgedCount } from "../intake/conflicts.ts";
import { collectIntakeFacts } from "./facts.ts";
import { CONFLICTS_FILE } from "./intake.ts";
import { assetBytes } from "./research-store.ts";
import { makeFinding, storeErrorResult, type UseCaseResult } from "./result.ts";
import { loadWorkspace, type Workspace } from "./workspace.ts";

const mib = (value: number): string => (value / 1_048_576).toFixed(1);

export type StatusInput = { path: string };

/** path -> sha256 (null when absent) of every input file a detection looked at. */
function inputHashes(report: DetectionReport<StoredFinding>): Map<string, Sha256Hex | null> {
  const map = new Map<string, Sha256Hex | null>();
  for (const file of [...report.artifacts, report.uxMarkdown, report.uxJson]) {
    map.set(file.path, file.present ? file.sha256 : null);
  }
  map.delete("");
  return map;
}

function changedInputs(
  persisted: DetectionReport<StoredFinding>,
  live: DetectionReport<StoredFinding>,
): string[] {
  const before = inputHashes(persisted);
  const after = inputHashes(live);
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths]
    .filter((path) => (before.get(path) ?? null) !== (after.get(path) ?? null))
    .toSorted(compareStrings);
}

/** Read-only: no lock, no writes (DP16). */
export async function runStatus(
  ctx: AppContext,
  input: StatusInput,
): Promise<UseCaseResult<StatusData>> {
  try {
    const loaded = loadWorkspace(ctx, input.path);
    return loaded.ok ? readStatus(ctx, loaded.workspace, input.path) : loaded.result;
  } catch (error) {
    const mapped = storeErrorResult<StatusData>(error);
    if (mapped === null) throw error;
    return mapped;
  }
}

function readStatus(
  ctx: AppContext,
  workspace: Workspace,
  path: string,
): UseCaseResult<StatusData> {
  const { store, state, persisted, live, detection, mode: effective, blocked } = workspace;
  const findings: Finding[] = [];
  const inputsChanged = changedInputs(persisted.detection, detection);
  if (inputsChanged.length > 0) {
    findings.push(
      makeFinding(
        "INPUTS_CHANGED",
        "warning",
        `Inputs changed since the last heron init: ${inputsChanged.join(", ")}. Run: heron init ${path}`,
        inputsChanged,
      ),
    );
  }

  const bytes = assetBytes(ctx.fs, store.heronDir);
  if (bytes > ctx.research.assetWarningBytes) {
    findings.push(
      makeFinding(
        "ASSETS_LARGE",
        "warning",
        `Images in .heron/ use ${mib(bytes)} MiB (threshold ${mib(ctx.research.assetWarningBytes)} MiB); every reference image is versioned in Git (D15).`,
      ),
    );
  }

  // Freshness is regenerate-and-compare (DR2): only a contributing source change shows up. Untracked: no finding.
  const stored = store.readDocument(CONFLICTS_FILE, INTAKE_CONFLICTS_DOCUMENT);
  if (stored !== null && !collectIntakeFacts(ctx, workspace, store).productContextValid) {
    findings.push(
      makeFinding(
        "PRODUCT_CONTEXT_STALE",
        "warning",
        `The product context is out of date: its sources, the mode or the Heron extractor changed since the last heron intake. Run: heron intake ${path}`,
      ),
    );
  }
  for (const conflict of stored?.conflicts ?? []) {
    if (conflict.status !== "open" || conflict.ack !== null) continue;
    findings.push(
      makeFinding(
        "CONFLICT_OPEN",
        "warning",
        `${conflict.id} (${conflict.kind}) on ${conflict.subject} is not acknowledged. Run: heron conflicts ack ${conflict.id} ${path} --note <text>`,
      ),
    );
  }

  const current = new Map<RelativeArtifactPath, Sha256Hex>();
  for (const decision of state.gates) {
    for (const artifact of decision.artifacts) {
      const sha = store.sha256(artifact.path);
      if (sha !== null) current.set(artifact.path, sha);
    }
  }
  for (const gate of invalidatedGates(state, current)) {
    const decision = latestDecision(state, gate);
    const validity = decision === null ? null : isApprovalValid(decision, current);
    if (validity !== null && !validity.valid) {
      findings.push(
        makeFinding(
          "GATE_APPROVAL_INVALIDATED",
          "warning",
          `Gate "${gate}" approval is no longer valid: changed [${validity.changed.join(", ")}], missing [${validity.missing.join(", ")}].`,
          [...validity.changed, ...validity.missing],
        ),
      );
    }
  }

  const statuses = gateStatuses(state, current);
  const gatesWithRows = new Set<GateName>();
  let canAddReferences = false;
  for (const event of allowedEvents({ ...state, mode: effective })) {
    if (event.type === "approve-gate" || event.type === "reject-gate")
      gatesWithRows.add(event.gate);
    if (event.type === "reference-added") canAddReferences = true;
  }
  const data: StatusData = {
    adapter: detection.adapter,
    navoriMaster: detection.navoriMaster,
    stage: detection.stage,
    mode: effective,
    persistedMode: state.mode,
    liveMode: live.mode,
    phase: state.phase,
    stateRevision: state.stateRevision,
    counts: effective === "full" ? live.detection.uxJson.summary : null,
    gates: GATE_NAMES.map((gate) => ({ gate, status: statuses[gate] })),
    stale: state.stale,
    inputsChanged,
    openConflicts: stored === null ? null : unacknowledgedCount(stored),
    agentUsage: null, // totals arrive with the agent log reader (P3 later task)
    allowedCommands: [
      "heron init",
      "heron status",
      "heron doctor",
      ...GATE_NAMES.filter((gate) => gatesWithRows.has(gate)).map(
        (gate) => `heron gate ${gate} approve|reject`,
      ),
      ...(canAddReferences ? ["heron references add|import"] : []),
      "heron references list|show|compare|remove",
      "heron brand add",
      "heron research render",
      "heron intake",
      "heron conflicts list|ack",
    ],
  };
  if (effective === "reference-only") {
    // Carries the cause of "Production blocked: ..." to the renderer (StatusData has no field for it).
    findings.push(
      makeFinding("MODE_BLOCKED", "info", `Production blocked: ${describeModeBlock(blocked)}`),
    );
  }
  return { ok: true, data, findings, next: [] };
}
