import type { BrandInput, ResearchReference, SecurityFinding } from "../../core/contracts/index.ts";
import { escapeHtml as esc } from "../../security/html.ts";
import { byIdNumber } from "../provenance.ts";
import { formatCopy, type ResearchCopy, type SupportedLocale } from "./copy.ts";
import type { ResearchModel } from "./references-md.ts";

/** Exact text; hashed as UTF-8. Changing it requires recomputing MOODBOARD_STYLE_HASH and MOODBOARD_CSP. */
export const MOODBOARD_CSS =
  ':root{color-scheme:light;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.45;color:#1f2328;background:#ffffff}body{margin:0 auto;max-width:72rem;padding:1.5rem}header{border-bottom:1px solid #d0d7de;margin-bottom:1.5rem}.mode{display:inline-block;padding:.125rem .5rem;border:1px solid #9a6700;border-radius:.25rem;color:#7d4e00;background:#fff8c5;font-weight:600}.cards{list-style:none;margin:0;padding:0;display:grid;gap:1.5rem;grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))}.card{border:1px solid #d0d7de;border-radius:.5rem;padding:1rem;background:#ffffff}.card h3{margin:0 0 .75rem;font-size:1.05rem}figure{margin:0 0 .75rem}svg{display:block;width:100%;height:auto;background:#f6f8fa}.crop{fill:none;stroke:#cf222e;stroke-width:3;vector-effect:non-scaling-stroke}.crop-label{fill:#cf222e;font-weight:700}dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem .75rem;margin:0}dt{font-weight:600;color:#59636e}dd{margin:0;overflow-wrap:anywhere}dd ul,.crops,.findings{margin:0;padding-left:1.1rem}.findings{color:#9a6700}.untrusted{font-size:.85rem;color:#59636e}.brand{margin-top:2rem}table{border-collapse:collapse}th,td{border:1px solid #d0d7de;padding:.25rem .5rem;text-align:left;overflow-wrap:anywhere}';
/** base64(sha256(MOODBOARD_CSS)); asserted by test (crypto lives only in core/store/hash.ts). */
export const MOODBOARD_STYLE_HASH = "rzwy3TcAlO0YYabGSUiakKOAEXNk+YnBxCXu4PfJK4E=";
/** Goes in a <meta http-equiv>: frame-ancestors does not apply there. */
export const MOODBOARD_CSP = `default-src 'none'; script-src 'none'; img-src 'self'; style-src 'sha256-${MOODBOARD_STYLE_HASH}'; base-uri 'none'; form-action 'none'`;

/** The only resource a card may reference: a sanitized asset named by its sha256. */
const ASSET_PATH = /^(?:research|brand)\/assets\/[0-9a-f]{64}\.webp$/;

const list = (items: readonly string[]): string =>
  `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;

function figure(reference: ResearchReference, copy: ResearchCopy): string[] {
  const { capture } = reference;
  if (capture.kind !== "image" || !ASSET_PATH.test(capture.image.path)) return [];
  const { width, height, path } = capture.image;
  const size = Math.max(14, Math.round(width / 50));
  const pad = Math.round(size / 4);
  return [
    `<figure><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(copy.imageAlt)}">`,
    `<image href="../../${path}" x="0" y="0" width="${width}" height="${height}"/>`,
    ...reference.crops.flatMap((crop, index) => [
      `<rect class="crop" x="${crop.x}" y="${crop.y}" width="${crop.width}" height="${crop.height}"/>`,
      `<text class="crop-label" x="${crop.x + pad}" y="${crop.y + size}" font-size="${size}">${index + 1}</text>`,
    ]),
    "</svg></figure>",
  ];
}

function findingItem(finding: SecurityFinding, copy: ResearchCopy): string {
  const where =
    finding.line === null || finding.offset === null
      ? ""
      : ` (${esc(formatCopy(copy.lineOffset, { line: finding.line, offset: finding.offset }))})`;
  return `<li>${esc(finding.code)}${where}${finding.phrase === null ? "" : `: ${esc(finding.phrase)}`}</li>`;
}

function card(reference: ResearchReference, copy: ResearchCopy): string[] {
  const { capture } = reference;
  const method = capture.kind === "image" ? ` (${esc(capture.method)})` : "";
  const lines = [
    `<li class="card" id="${esc(reference.id)}"><article>`,
    `<h3>${esc(reference.id)} · ${esc(reference.source)}${method}</h3>`,
    ...figure(reference, copy),
    "<dl>",
    `<dt>${esc(copy.origin)}</dt><dd>${esc(reference.origin)}</dd>`,
    `<dt>${esc(copy.capturedAt)}</dt><dd>${esc(reference.capturedAt)}</dd>`,
    `<dt>${esc(copy.mode)}</dt><dd>${esc(reference.mode)}</dd>`,
    `<dt>${esc(copy.reason)}</dt><dd>${esc(reference.reason)}</dd>`,
    `<dt>${esc(copy.studies)}</dt><dd>${list(reference.studies)}</dd>`,
    `<dt>${esc(copy.doNotCopy)}</dt><dd>${list(reference.doNotCopy)}</dd>`,
    `<dt>${esc(copy.influences)}</dt><dd>${list(reference.influences)}</dd>`,
    "</dl>",
  ];
  if (reference.crops.length > 0) {
    lines.push(
      `<ol class="crops">${reference.crops
        .map(
          (crop) => `<li>${crop.x},${crop.y} ${crop.width}x${crop.height}: ${esc(crop.note)}</li>`,
        )
        .join("")}</ol>`,
    );
  }
  if (reference.securityFindings.length > 0) {
    lines.push(
      `<ul class="findings">${reference.securityFindings.map((finding) => findingItem(finding, copy)).join("")}</ul>`,
    );
  }
  if (capture.kind === "url" || capture.kind === "design-md") {
    lines.push(`<p class="untrusted">${esc(copy.content)}: ${esc(capture.content.path)}</p>`);
  }
  return [...lines, "</article></li>"];
}

function brandSection(brand: readonly BrandInput[], copy: ResearchCopy): string[] {
  if (brand.length === 0) return [];
  const head = [copy.brandKind, copy.brandOrigin, copy.brandValue, copy.brandNote];
  return [
    `<section class="brand"><h2>${esc(copy.brandSection)}</h2><table><thead><tr><th>ID</th>${head.map((cell) => `<th>${esc(cell)}</th>`).join("")}</tr></thead>`,
    `<tbody>${byIdNumber(brand)
      .map((input) => {
        const cells = [input.id, input.kind, input.origin, input.value, input.note ?? copy.none];
        return `<tr>${cells.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`;
      })
      .join("")}</tbody></table></section>`,
  ];
}

/** Static moodboard: no scripts, no external resources, every text escaped, crops drawn as SVG over the sanitized
 * asset. Deterministic: no generation date or tool version. */
export function renderMoodboardHtml(
  model: ResearchModel,
  copy: ResearchCopy,
  locale: SupportedLocale,
): string {
  const active = byIdNumber(model.references).filter((reference) => reference.removed === null);
  const lines = [
    "<!doctype html>",
    `<html lang="${esc(locale)}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${MOODBOARD_CSP}">`,
    '<meta name="referrer" content="no-referrer">',
    `<title>${esc(copy.moodboardTitle)}</title>`,
    `<style>${MOODBOARD_CSS}</style>`,
    "</head>",
    "<body>",
    "<header>",
    `<h1>${esc(copy.moodboardTitle)}</h1>`,
    `<p class="mode">${esc(copy.modeLabel)}: ${esc(model.mode)}</p>`,
    `<p>${esc(copy.generatedNotice)} ${esc(copy.untrustedNotice)}</p>`,
    `<p>${esc(formatCopy(copy.countsLine, { active: model.counts.active, removed: model.counts.removed, brand: model.counts.brandInputs }))}</p>`,
    "</header>",
    "<main>",
    '<ol class="cards">',
    ...active.flatMap((reference) => card(reference, copy)),
    "</ol>",
    ...brandSection(model.brand, copy),
    "</main>",
    "</body>",
    "</html>",
  ];
  return `${lines.join("\n")}\n`;
}
