import {
  PRODUCT_CONTEXT_SECTIONS,
  type Conflict,
  type ConflictsAckData,
  type ConflictsListData,
  type IntakeData,
} from "../core/contracts/index.ts";
import { MODE_LABELS } from "./render.ts";

/** Text output of `heron intake`; findings are appended by the caller with renderFindings. */
export function renderIntakeText(data: IntakeData): string {
  const state = data.dryRun ? "not written (dry run)" : data.written ? "written" : "unchanged";
  const open = data.conflicts.length;
  const pending = data.conflicts.filter((c) => !c.acknowledged).length;
  return [
    `Product context (${MODE_LABELS[data.mode]}, adapter ${data.adapter}${data.stage === null ? "" : `, stage ${data.stage.dir}`}):`,
    `- intake/product-context.json: ${state}`,
    `- intake/conflicts.json: ${state}`,
    `Sections: ${PRODUCT_CONTEXT_SECTIONS.map((section) => `${section} ${data.counts[section]}`).join(", ")}`,
    `Conflicts: ${open === 0 ? "none" : `${open} open, ${pending} not acknowledged`}`,
    ...data.conflicts.map(
      (c) =>
        `- ${c.id} ${c.kind} ${c.subject}: ${c.acknowledged ? "acknowledged" : "not acknowledged"}`,
    ),
    ...(data.dryRun ? ["Dry run: nothing was written to .heron/"] : []),
  ].join("\n");
}

function renderConflict(c: Conflict): string {
  const ack = c.ack === null ? "not acknowledged" : `acknowledged by ${c.ack.by}`;
  return [
    `${c.id} [${c.status}, ${ack}] ${c.kind} · ${c.subject}`,
    `  Files: ${c.files.join(", ")}`,
    "  Values:",
    ...c.values.map((v) => `  - ${v.sourceRef.source} ${v.sourceRef.locator}: ${v.value}`),
    `  Impact: ${c.impact.length === 0 ? "none" : c.impact.join(", ")}`,
  ].join("\n");
}

/** Text output of `heron conflicts list`; `path` only for the "Run: heron intake" hint. */
export function renderConflictsListText(data: ConflictsListData, path: string): string {
  if (!data.tracked) return `No product context yet. Run: heron intake ${path}`;
  if (data.conflicts.length === 0) return "No open conflicts.";
  return data.conflicts.map(renderConflict).join("\n\n");
}

/** Text output of `heron conflicts ack`. */
export function renderConflictsAckText(data: ConflictsAckData): string {
  const { id, ack } = data.conflict;
  return [
    `${id} acknowledged by ${ack?.by ?? ""}: ${ack?.note ?? ""}`,
    `Conflicts not acknowledged: ${data.unacknowledged}`,
  ].join("\n");
}
