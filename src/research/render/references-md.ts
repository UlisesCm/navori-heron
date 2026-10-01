import {
  RelativeArtifactPathSchema,
  type BrandInput,
  type HeronMode,
  type ResearchCounts,
  type ResearchReference,
  type SecurityFinding,
} from "../../core/contracts/index.ts";
import { escapeMarkdownText as text } from "../../security/markdown.ts";
import { byIdNumber } from "../provenance.ts";
import { formatCopy, type ResearchCopy } from "./copy.ts";

export type ResearchModel = {
  mode: HeronMode;
  references: ResearchReference[]; // every reference, removed ones included
  brand: BrandInput[];
  counts: ResearchCounts;
};

/** Paths go between backticks only after RelativeArtifactPathSchema accepts them (and carry no backtick). */
function codeSpan(path: string): string {
  return RelativeArtifactPathSchema.safeParse(path).success && !path.includes("`")
    ? `\`${path}\``
    : text(path);
}

const bullets = (items: readonly string[]): string[] => items.map((item) => `  - ${text(item)}`);

function findingLine(finding: SecurityFinding, copy: ResearchCopy): string {
  const where =
    finding.line === null || finding.offset === null
      ? ""
      : ` (${formatCopy(copy.lineOffset, { line: finding.line, offset: finding.offset })})`;
  return `  - \`${finding.code}\`${where}${finding.phrase === null ? "" : `: ${text(finding.phrase)}`}`;
}

function captureLines(reference: ResearchReference, copy: ResearchCopy): string[] {
  const { capture } = reference;
  const lines: string[] = [];
  if (capture.kind === "image" || (capture.kind === "design-md" && capture.file !== null)) {
    const file = capture.file;
    if (file !== null) {
      const where = file.location === "repo" ? copy.fileRepo : copy.fileExternal;
      lines.push(`- ${copy.file}: ${text(file.name)} (${where})`);
    }
  }
  if (capture.kind === "image") {
    const { image } = capture;
    lines.push(`- ${copy.image}: ${codeSpan(image.path)} (${image.width}x${image.height})`);
    if (reference.crops.length > 0) {
      lines.push(`- ${copy.crops}:`);
      reference.crops.forEach((crop, index) => {
        lines.push(
          `  ${index + 1}. ${crop.x},${crop.y} ${crop.width}x${crop.height}: ${text(crop.note)}`,
        );
      });
    }
  }
  if (capture.kind === "url" || capture.kind === "design-md") {
    lines.push(`- ${copy.content}: ${codeSpan(capture.content.path)}`);
  }
  return lines;
}

function referenceSection(reference: ResearchReference, copy: ResearchCopy): string[] {
  const method = reference.capture.kind === "image" ? ` (${reference.capture.method})` : "";
  const lines = [
    `## ${text(reference.id)} · ${text(reference.source)}${method}`,
    "",
    `- ${copy.origin}: ${text(reference.origin)}`,
    `- ${copy.capturedAt}: ${text(reference.capturedAt)}`,
    `- ${copy.mode}: \`${reference.mode}\``,
    `- ${copy.reason}: ${text(reference.reason)}`,
    `- ${copy.studies}:`,
    ...bullets(reference.studies),
    `- ${copy.doNotCopy}:`,
    ...bullets(reference.doNotCopy),
    `- ${copy.influences}:`,
    ...bullets(reference.influences),
    ...captureLines(reference, copy),
  ];
  if (reference.securityFindings.length > 0) {
    lines.push(
      `- ${copy.securityFindings}:`,
      ...reference.securityFindings.map((finding) => findingLine(finding, copy)),
    );
  }
  return [...lines, ""];
}

function brandTable(brand: readonly BrandInput[], copy: ResearchCopy): string[] {
  if (brand.length === 0) return [];
  return [
    `## ${copy.brandSection}`,
    "",
    `| ID | ${copy.brandKind} | ${copy.brandOrigin} | ${copy.brandValue} | ${copy.brandNote} |`,
    "|---|---|---|---|---|",
    ...byIdNumber(brand).map(
      (input) =>
        `| ${text(input.id)} | ${text(input.kind)} | ${text(input.origin)} | ${text(input.value)} | ${input.note === null ? copy.none : text(input.note)} |`,
    ),
    "",
  ];
}

/** REFERENCES.md, derived from the JSON documents: pure, deterministic, every user or external text escaped. */
export function renderReferencesMarkdown(model: ResearchModel, copy: ResearchCopy): string {
  const sorted = byIdNumber(model.references);
  const active = sorted.filter((reference) => reference.removed === null);
  const removed = sorted.filter((reference) => reference.removed !== null);
  const lines = [
    `# ${copy.referencesTitle}`,
    "",
    `> ${copy.modeLabel}: \`${model.mode}\` · ${copy.generatedNotice}`,
    `> ${copy.untrustedNotice}`,
    "",
    formatCopy(copy.countsLine, {
      active: model.counts.active,
      removed: model.counts.removed,
      brand: model.counts.brandInputs,
    }),
    "",
    ...active.flatMap((reference) => referenceSection(reference, copy)),
    ...brandTable(model.brand, copy),
  ];
  if (removed.length > 0) {
    lines.push(`## ${copy.removedSection}`, "");
    for (const reference of removed) {
      const note = reference.removed?.reason;
      lines.push(
        `- ${text(reference.id)} (${text(reference.removed?.at ?? "")})${note === null || note === undefined ? "" : `: ${text(note)}`}`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
