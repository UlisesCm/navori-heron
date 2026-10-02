import type {
  DoctorData,
  Finding,
  PenpotInspectData,
  PenpotLinkData,
  PenpotSyncData,
} from "../core/contracts/index.ts";
import { MODE_LABELS, renderDoctorText } from "./render.ts";
import { splitNotices, type TextOutput } from "./output.ts";

/** Remote free text is data, never terminal control sequences (C0, DEL, C1). */
export function escapePenpotText(text: string): string {
  return [...text]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || (code >= 0x7f && code <= 0x9f)
        ? `\\u{${code.toString(16).padStart(2, "0")}}`
        : ch;
    })
    .join("");
}

export function renderPenpotLinkText(data: PenpotLinkData): string {
  return `Linked to Penpot file "${escapePenpotText(data.file.name)}" (${escapePenpotText(data.file.id)}) · Penpot ${escapePenpotText(data.penpotVersion)}`;
}
export function renderPenpotInspectText(data: PenpotInspectData): string {
  const file =
    data.file === null
      ? "no connected file"
      : `file "${escapePenpotText(data.file.name)}" (${escapePenpotText(data.file.id)})`;
  return [
    `Penpot ${escapePenpotText(data.penpotVersion)} · ${file} · bound: ${data.bound.matches ? "yes" : `no (bound to ${escapePenpotText(data.bound.fileId ?? "none")})`}`,
    `Heron pages (${data.pages.length} managed, ${data.unmanagedPages} other):`,
    ...data.pages.map(
      (page) =>
        `  ${escapePenpotText(page.heronId)}  "${escapePenpotText(page.name ?? "—")}"  ${page.status === "up-to-date" ? "up to date" : page.status}`,
    ),
  ].join("\n");
}
export function renderPenpotSyncText(data: PenpotSyncData, path: string): string {
  const unchanged = data.pages.filter((page) => page.action === "unchanged").length;
  if (data.dryRun)
    return `Dry run: would create ${data.pages.filter((page) => page.action === "would-create").length}, update ${data.pages.filter((page) => page.action === "would-update").length}; ${unchanged} unchanged. Nothing was written.`;
  return [
    `Penpot sync (${MODE_LABELS[data.mode]}): ${data.writes} page(s) written, ${unchanged} unchanged · file "${escapePenpotText(data.file.name)}"`,
    ...data.pages.map((page) => `  ${escapePenpotText(page.heronId)}  ${page.action}`),
    `Next: compare the pages in Penpot, then: heron direction select <DIR-x> ${escapePenpotText(path)}`,
  ].join("\n");
}
const line = (finding: Finding): string => `${finding.code}: ${escapePenpotText(finding.message)}`;
export function renderPenpotFindings(text: string, findings: readonly Finding[]): TextOutput {
  const { rest, notices } = splitNotices(findings);
  return { stdout: [text, ...rest.map(line)].join("\n"), stderr: notices.map(line).join("\n") };
}
export function renderPenpotDoctorText(data: DoctorData): string {
  return renderDoctorText({
    checks: data.checks.map((check) => ({
      ...check,
      message: escapePenpotText(check.message),
      remedy: check.remedy === null ? null : escapePenpotText(check.remedy),
    })),
  });
}
