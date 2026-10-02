import type {
  BrandAddData,
  Finding,
  ReferencesAddData,
  ReferencesCompareData,
  ReferencesImportData,
  ReferencesListData,
  ReferencesRemoveData,
  ReferencesShowData,
  ResearchCounts,
  ResearchRenderData,
  ResearchReference,
  SecurityFinding,
} from "../core/contracts/index.ts";
import { splitNotices, type TextOutput } from "./output.ts";
import { MODE_LABELS, renderFindings } from "./render.ts";

/** Free text of a reference (user input or fetched content) made safe for a terminal: control characters (C0, DEL, C1),
 * including ESC, are shown as \xNN so stored content can never drive the terminal. */
export function safeText(text: string): string {
  return [...text]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || (code >= 0x7f && code <= 0x9f)
        ? `\\x${code.toString(16).padStart(2, "0")}`
        : ch;
    })
    .join("");
}

const methodOf = (reference: ResearchReference): string =>
  reference.capture.kind === "image" ? `, ${reference.capture.method}` : "";

/** `- {code} (line {line}, offset {offset}): "{phrase}"` for text findings, `- {code}: {message}` for the rest. */
function findingLines(findings: readonly SecurityFinding[], owner: string): string[] {
  return findings.map((finding) => {
    const head = `- ${owner}${finding.code}`;
    return finding.line !== null && finding.offset !== null && finding.phrase !== null
      ? `${head} (line ${finding.line}, offset ${finding.offset}): "${safeText(finding.phrase)}"`
      : `${head}: ${safeText(finding.message)}`;
  });
}

/** Fetched, Redirects, File, Content, Image and Removed metadata lines, each only when the capture has them. */
function captureLines(reference: ResearchReference): string[] {
  const { capture } = reference;
  const lines: string[] = [];
  if ("fetch" in capture && capture.fetch !== null) {
    const { fetch } = capture;
    lines.push(
      `Fetched: ${safeText(fetch.finalUrl)} (HTTP ${fetch.status}, ${capture.content.mediaType}, ${capture.content.bytes} bytes)`,
    );
    if (fetch.redirects.length > 0) lines.push(`Redirects: ${fetch.redirects.length}`);
  }
  if ("file" in capture && capture.file !== null) {
    lines.push(`File: ${safeText(capture.file.name)} (${capture.file.location})`);
  }
  if ("content" in capture) {
    lines.push(`Content: ${capture.content.path} (untrusted, ${capture.content.bytes} bytes)`);
  }
  if (capture.kind === "image") {
    const { image } = capture;
    lines.push(
      `Image: ${image.path} (${image.width}x${image.height}, ${image.bytes} bytes)`,
      `Removed metadata: ${image.removedMetadata.length === 0 ? "none" : image.removedMetadata.join(", ")}`,
    );
  }
  return lines;
}

const provenanceLine = (counts: ResearchCounts, ready: boolean): string =>
  `References with provenance: ${counts.withProvenance}/${counts.minimum}${
    ready && counts.withProvenance >= counts.minimum
      ? " (ready for: heron gate research approve)"
      : ""
  }`;

export function renderReferencesAddText(data: ReferencesAddData): string {
  const [reference] = data.references;
  if (reference === undefined) return "";
  const lines = [
    `Reference ${reference.id} added (${reference.source}${methodOf(reference)}).`,
    `Origin: ${safeText(reference.origin)}`,
    `Mode: ${MODE_LABELS[reference.mode]}`,
    `Captured: ${reference.capturedAt}`,
    ...captureLines(reference),
  ];
  if (reference.crops.length > 0) lines.push(`Crops: ${reference.crops.length}`);
  lines.push(
    `Security findings: ${reference.securityFindings.length}`,
    ...findingLines(reference.securityFindings, ""),
    `Phase: ${data.phase.from} -> ${data.phase.to}`,
    `State revision: ${data.stateRevision}`,
    provenanceLine(data.counts, true),
  );
  return lines.join("\n");
}

export function renderReferencesImportText(data: ReferencesImportData): string {
  const findings = data.references.flatMap((reference) =>
    findingLines(reference.securityFindings, `${reference.id} `),
  );
  return [
    `Imported ${data.references.length} reference(s): ${data.references.map((reference) => reference.id).join(", ")}.`,
    `Security findings: ${findings.length}`,
    ...findings,
    `Phase: ${data.phase.from} -> ${data.phase.to}`,
    `State revision: ${data.stateRevision}`,
    provenanceLine(data.counts, true),
  ].join("\n");
}

export function renderReferencesListText(data: ReferencesListData): string {
  const { counts } = data;
  const lines = [
    `References: ${counts.active} active, ${counts.removed} removed (research gate needs ${counts.minimum})`,
  ];
  if (data.references.length === 0) lines.push("No references yet. See: heron --help");
  for (const reference of data.references) {
    lines.push(
      `${reference.id.padEnd(8)} ${reference.source.padEnd(10)} ${reference.capturedAt}  ${safeText(reference.origin)}${reference.removed ? "  (removed)" : ""}`,
    );
  }
  return lines.join("\n");
}

export function renderReferencesShowText(data: ReferencesShowData): string {
  const { reference } = data;
  const list = (title: string, items: readonly string[]): string[] => [
    `${title}:`,
    ...items.map((item) => `- ${safeText(item)}`),
  ];
  const lines = [
    `${reference.id} (${reference.source}${methodOf(reference)})${reference.removed === null ? "" : " - removed"}`,
    `Origin: ${safeText(reference.origin)}`,
    `Mode: ${MODE_LABELS[reference.mode]}`,
    `Captured: ${reference.capturedAt}`,
    `Reason: ${safeText(reference.reason)}`,
    ...list("Studies", reference.studies),
    ...list("Do not copy", reference.doNotCopy),
    ...list("Influences", reference.influences),
    ...captureLines(reference),
  ];
  if (reference.crops.length > 0) {
    lines.push(
      "Crops:",
      ...reference.crops.map(
        (crop, index) =>
          `${index + 1}. ${crop.x},${crop.y} ${crop.width}x${crop.height}: ${safeText(crop.note)}`,
      ),
    );
  }
  lines.push(
    `Security findings: ${reference.securityFindings.length}`,
    ...findingLines(reference.securityFindings, ""),
  );
  if (reference.removed !== null) {
    const reason =
      reference.removed.reason === null ? "" : ` (${safeText(reference.removed.reason)})`;
    lines.push(`Removed: ${reference.removed.at}${reason}`);
  }
  return lines.join("\n");
}

const joined = (items: readonly string[]): string => items.map(safeText).join("; ");

export function renderReferencesCompareText(data: ReferencesCompareData): string {
  const { references, shared } = data;
  const each = (title: string, value: (reference: ResearchReference) => string): string[] => [
    `${title}:`,
    ...references.map((reference) => `  ${reference.id}: ${value(reference)}`),
  ];
  const listed = (
    title: string,
    items: (reference: ResearchReference) => readonly string[],
    common: readonly string[],
  ): string[] => [
    ...each(title, (reference) => joined(items(reference))),
    `  Shared: ${common.length === 0 ? "none" : joined(common)}`,
  ];
  return [
    `Comparing ${references.map((reference) => reference.id).join(", ")}`,
    ...each("Source", (reference) => `${reference.source}${methodOf(reference)}`),
    ...each("Origin", (reference) => safeText(reference.origin)),
    ...each("Reason", (reference) => safeText(reference.reason)),
    ...listed("Studies", (reference) => reference.studies, shared.studies),
    ...listed("Do not copy", (reference) => reference.doNotCopy, shared.doNotCopy),
    ...listed("Influences", (reference) => reference.influences, shared.influences),
    ...each("Crops", (reference) => String(reference.crops.length)),
    ...each("Security findings", (reference) => String(reference.securityFindings.length)),
  ].join("\n");
}

export function renderReferencesRemoveText(data: ReferencesRemoveData): string {
  return [
    `Reference ${data.removed.id} removed.`,
    provenanceLine(data.counts, false),
    `State revision: ${data.stateRevision}`,
  ].join("\n");
}

export function renderBrandAddText(data: BrandAddData): string {
  const { input } = data;
  const lines = [
    `Brand input ${input.id} added (${input.kind}, ${input.origin}).`,
    `Value: ${safeText(input.value)}`,
  ];
  if (input.file !== null)
    lines.push(`File: ${safeText(input.file.name)} (${input.file.location})`);
  if (input.image !== null) {
    const { image } = input;
    lines.push(
      `Image: ${image.path} (${image.width}x${image.height}, ${image.bytes} bytes)`,
      `Removed metadata: ${image.removedMetadata.length === 0 ? "none" : image.removedMetadata.join(", ")}`,
    );
  }
  if (input.derivedFrom !== null) lines.push(`Derived from: ${input.derivedFrom}`);
  if (input.note !== null) lines.push(`Note: ${safeText(input.note)}`);
  lines.push(`State revision: ${data.stateRevision}`);
  return lines.join("\n");
}

export function renderResearchRenderText(data: ResearchRenderData): string {
  const { counts } = data;
  return [
    `Research outputs (${data.mode}, locale ${data.locale}):`,
    ...data.outputs.map(
      (output) => `- ${output.path}: ${output.written ? "written" : "unchanged"}`,
    ),
    `References: ${counts.active} active, ${counts.removed} removed; brand inputs: ${counts.brandInputs}`,
    "Open in a browser: .heron/research/moodboards/index.html",
    `State revision: ${data.stateRevision}`,
  ].join("\n");
}

/** Text first, then the findings that are not notices; notices go to stderr. */
export function withFindings(text: string, findings: readonly Finding[]): TextOutput {
  const { notices, rest } = splitNotices(findings);
  const tail = renderFindings(rest);
  return {
    stdout: tail === "" ? text : `${text}\n\n${tail}`,
    stderr: renderFindings(notices),
  };
}
