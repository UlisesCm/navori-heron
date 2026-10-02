import {
  RelativeArtifactPathSchema,
  type BrandInput,
  type HeronMode,
  type ResearchAnalysis,
  type ResearchBrief,
  type ResearchCounts,
  type ResearchReference,
  type SecurityFinding,
  type VisualDirection,
  type VisualDirections,
} from "../../core/contracts/index.ts";
import { escapeMarkdownText as text } from "../../security/markdown.ts";
import { byIdNumber } from "../provenance.ts";
import { formatCopy, type ResearchCopy } from "./copy.ts";

/** Agent documents (null = absent); a section renders only when its document exists (DR24). */
export type AgentDocuments = {
  brief: ResearchBrief | null;
  analysis: ResearchAnalysis | null;
  directions: VisualDirections | null;
};

export type ResearchModel = {
  mode: HeronMode;
  agent?: AgentDocuments;
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

const labeled = (label: string, items: readonly string[]): string[] => [
  `- ${label}:`,
  ...bullets(items),
];

function briefSection(brief: ResearchBrief, copy: ResearchCopy): string[] {
  const lines = [`## ${copy.briefSection}`, ""];
  for (const query of brief.queries) {
    const origin = query.origin === "provided" ? copy.originProvided : copy.originInferred;
    lines.push(
      `- ${text(query.id)} · ${text(query.facet)} (${origin}): ${text(query.query)}`,
      `  - ${copy.briefJob}: ${text(query.job)}`,
    );
    if (query.question !== null) lines.push(`  - ${copy.briefQuestion}: ${text(query.question)}`);
    if (query.rationale !== null)
      lines.push(`  - ${copy.briefRationale}: ${text(query.rationale)}`);
  }
  return [...lines, ""];
}

/** answersQueries is filtered against the ids of the current brief (DR28); no brief -> no ids to vouch for. */
function analysisSection(
  analysis: ResearchAnalysis,
  brief: ResearchBrief | null,
  copy: ResearchCopy,
): string[] {
  const current = new Set(brief?.queries.map((query) => query.id) ?? []);
  const lines = [`## ${copy.analysisSection}`, "", `> ${copy.inferredNotice}`, ""];
  for (const item of analysis.analyses.toSorted(
    (a, b) => Number(a.reference.slice(4)) - Number(b.reference.slice(4)),
  )) {
    lines.push(`### ${text(item.reference)} (${copy.originInferred})`, "");
    for (const observation of item.observations) {
      lines.push(`- ${text(observation.aspect)}: ${text(observation.note)}`);
    }
    lines.push(`- ${copy.facets}: ${item.facets.map(text).join(", ")}`);
    if (item.suggestedDoNotCopy.length > 0) {
      lines.push(...labeled(copy.suggestedDoNotCopy, item.suggestedDoNotCopy));
    }
    const answers = item.answersQueries.filter((id) => current.has(id));
    if (answers.length > 0) lines.push(`- ${copy.answersQueries}: ${answers.map(text).join(", ")}`);
    lines.push("");
  }
  return lines;
}

function directionSection(direction: VisualDirection, copy: ResearchCopy): string[] {
  const { attributes, proposal } = direction;
  const lines = [
    `### ${text(direction.id)} · ${text(direction.name)}`,
    "",
    `- ${copy.summary}: ${text(direction.summary)}`,
  ];
  for (const key of [
    "personality",
    "density",
    "surfaceTreatment",
    "typographyStrategy",
    "colorStrategy",
    "imageryStrategy",
    "navigationCharacter",
    "componentWeight",
    "motionCharacter",
  ] as const) {
    lines.push(`- ${copy[key]}: ${text(attributes[key])}`);
  }
  lines.push(`- ${copy.directionReferences}:`);
  for (const reference of attributes.references) {
    lines.push(
      `  - ${text(reference.reference)}`,
      ...reference.takes.map((item) => `    - ${copy.takes}: ${text(item)}`),
      ...reference.doNotCopy.map((item) => `    - ${copy.doNotCopy}: ${text(item)}`),
    );
  }
  lines.push(
    ...labeled(copy.risks, attributes.risks),
    ...labeled(copy.whenItFits, attributes.whenItFits),
    ...labeled(copy.whenItDoesnt, attributes.whenItDoesnt),
    `- ${copy.palette}:`,
    ...proposal.palette.colors.map(
      (color) =>
        `  - ${text(color.id)} ${text(color.name)} ${text(color.hex)} (${text(color.role)})`,
    ),
    ...proposal.palette.pairs.map(
      (pair) =>
        `  - ${copy.contrast} ${text(pair.foreground)}/${text(pair.background)} (${text(pair.usage)}): ${pair.contrast.ratio.toFixed(2)} / ${pair.contrast.threshold.toFixed(2)} ${pair.contrast.passes ? copy.passes : copy.fails}`,
    ),
    "",
  );
  return lines;
}

function directionsSection(directions: VisualDirections, copy: ResearchCopy): string[] {
  const lines = [`## ${copy.directionsSection}`, "", `> ${copy.directionsNotice}`, ""];
  for (const direction of directions.directions) lines.push(...directionSection(direction, copy));
  const { selection } = directions;
  if (selection !== null) {
    lines.push(
      `- ${copy.selection}: ${text(selection.direction)} (${text(selection.status)}) · ${text(selection.decidedBy)} · ${text(selection.decidedAt)}${selection.note === null ? "" : `: ${text(selection.note)}`}`,
      "",
    );
  }
  return lines;
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
    ...(model.agent?.brief ? briefSection(model.agent.brief, copy) : []),
    ...(model.agent?.analysis
      ? analysisSection(model.agent.analysis, model.agent.brief, copy)
      : []),
    ...(model.agent?.directions ? directionsSection(model.agent.directions, copy) : []),
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
