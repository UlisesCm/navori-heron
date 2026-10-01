/** Paths under .heron/ owned by research (design §10). */
export const RESEARCH_FILES = {
  references: "research/references.json",
  provenance: "research/provenance.json",
  markdown: "research/REFERENCES.md",
  moodboard: "research/moodboards/index.html",
  assets: "research/assets",
  sources: "research/sources",
  brief: "research/brief.json",
  analysis: "research/analysis.json",
  directions: "research/visual-directions.json",
  brand: "brand/brand.json",
  brandAssets: "brand/assets",
} as const;

/** `runs/<runId>.json`, relative to `.heron/` (design §15). */
export const runPath = (runId: string): string => `runs/${runId}.json`;
