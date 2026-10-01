import type {
  DoctorData,
  Finding,
  StoredFinding,
  GateData,
  HarnessArtifactName,
  HeronMode,
  InitData,
  StatusData,
} from "../core/contracts/index.ts";

export const MODE_LABELS: Readonly<Record<HeronMode, "FULL PRODUCT" | "REFERENCE ONLY">> = {
  full: "FULL PRODUCT",
  "reference-only": "REFERENCE ONLY",
};

/** `(name + ":").padEnd(7) + " " + mark`: reproduces `UX.md:  ✓` and `ux.json: missing` (DP14). */
export function formatPresenceLine(name: HarnessArtifactName, present: boolean): string {
  return `${`${name}:`.padEnd(7)} ${present ? "✓" : "missing"}`;
}

/** `{CODE}: {message}` and each issue as `  {pointer}: {message}` (empty pointer shown as `(root)`). */
export function renderFindings(findings: readonly StoredFinding[]): string {
  return findings
    .flatMap((finding) => [
      `${finding.code}: ${finding.message}`,
      ...finding.issues.map(
        (issue) => `  ${issue.pointer === "" ? "(root)" : issue.pointer}: ${issue.message}`,
      ),
    ])
    .join("\n");
}

/** Joins non-empty blocks of lines with one blank line between them. */
function blocks(parts: readonly (readonly string[])[]): string {
  return parts
    .filter((lines) => lines.length > 0)
    .map((lines) => lines.join("\n"))
    .join("\n\n");
}

export function renderInitText(data: InitData): string {
  const { detection, mode } = data.decision;
  const header = ["Project detected", `Navori Master: ${detection.navoriMaster ? "yes" : "no"}`];
  if (detection.stageNotice !== null) header.push(detection.stageNotice);
  if (detection.navoriMaster) {
    const stage =
      detection.stageStatus === "selected" && detection.stage !== null
        ? detection.stage.dir
        : detection.stageStatus === "none"
          ? "none"
          : "unknown";
    header.push(`Stage: ${stage}`);
  }
  const presence =
    detection.artifacts.length > 0
      ? detection.artifacts.map((file) => formatPresenceLine(file.name, file.present))
      : detection.stageStatus === "not-applicable"
        ? [
            formatPresenceLine("UX.md", detection.uxMarkdown.present),
            formatPresenceLine("ux.json", detection.uxJson.present),
          ]
        : [];
  const declared = detection.harness?.ux ?? null;
  const shown = [...detection.findings, ...data.decision.findings].filter(
    (finding) => finding.code !== "STAGE_FALLBACK_LAST_CLOSED",
  );
  const summary = detection.uxJson.summary;
  const full = mode === "full" && summary !== null;
  return blocks([
    header,
    presence,
    declared === null ? [] : [`Harness UX declaration: ${declared}`],
    ["Mode:", MODE_LABELS[mode]],
    shown.length === 0 ? [] : [renderFindings(shown)],
    full ? ["Surfaces:", ...summary.surfaces.map((id) => `- ${id}`)] : [],
    full
      ? [`Screens: ${summary.screens}`, `Flows: ${summary.flows}`, `Patterns: ${summary.patterns}`]
      : [],
    mode === "full"
      ? ["Ready for research."]
      : ["Full product generation disabled.", "Visual research is available."],
    data.dryRun ? ["Dry run: nothing was written to .heron/"] : [],
  ]);
}

/** `Production blocked: ...` travels as an info MODE_BLOCKED finding (StatusData has no field for it). */
export function renderStatusText(data: StatusData, findings: readonly Finding[]): string {
  const blocked = findings.find((f) => f.code === "MODE_BLOCKED" && f.severity === "info");
  const rest = findings.filter((finding) => finding !== blocked);
  const modeLabel =
    data.persistedMode === data.liveMode
      ? MODE_LABELS[data.mode]
      : data.mode === data.persistedMode
        ? `${MODE_LABELS[data.mode]} (live: ${MODE_LABELS[data.liveMode]})`
        : `${MODE_LABELS[data.mode]} (persisted: ${MODE_LABELS[data.persistedMode]})`;
  return blocks([
    [
      `Stage: ${data.stage?.dir ?? "none"}`,
      `Navori Master: ${data.navoriMaster ? "yes" : "no"}`,
      `Mode: ${modeLabel}`,
      ...(blocked === undefined ? [] : [blocked.message]),
      `Phase: ${data.phase}`,
      `State revision: ${data.stateRevision}`,
    ],
    data.counts === null
      ? []
      : [
          `Screens: ${data.counts.screens}`,
          `Flows: ${data.counts.flows}`,
          `Patterns: ${data.counts.patterns}`,
        ],
    ["Gates:", ...data.gates.map((g) => `- ${g.gate}: ${g.status}`)],
    [
      data.stale.length === 0
        ? "Stale artifacts: none"
        : ["Stale artifacts:", ...data.stale.map((s) => `- ${s.path}: ${s.reason}`)].join("\n"),
      `Open conflicts: ${data.openConflicts === null ? "not tracked yet" : data.openConflicts}`,
      `Allowed commands: ${data.allowedCommands.join(", ")}`,
    ],
    rest.length === 0 ? [] : [renderFindings(rest)],
  ]);
}

/** One line per check (`STATUS(7) id(18) message`), `        Remedy: ...` when there is one, then the summary. */
export function renderDoctorText(data: DoctorData): string {
  const lines = data.checks.flatMap((check) => [
    `${check.status.padEnd(7)} ${check.id.padEnd(18)} ${check.message}`,
    ...(check.remedy === null ? [] : [`        Remedy: ${check.remedy}`]),
  ]);
  const count = (status: string): number =>
    data.checks.filter((check) => check.status === status).length;
  lines.push(`Summary: ${count("PASS")} PASS, ${count("WARNING")} WARNING, ${count("FAIL")} FAIL`);
  return lines.join("\n");
}

/** The decider comes from the persisted decision; GateData carries the rest. */
export function renderGateText(data: GateData, decidedBy: string): string {
  return [
    `Gate "${data.gate}" ${data.decision} by ${decidedBy}.`,
    `Bound artifacts: ${data.artifacts.length}`,
    `Phase: ${data.from} -> ${data.to}`,
    `State revision: ${data.stateRevision}`,
  ].join("\n");
}
