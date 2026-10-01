import { z } from "zod";
import type { DocumentSpec } from "./version.ts";

export const ADAPTER_IDS = ["navori-master", "filesystem"] as const; // P4 appends "markdown", "manual"
export type AdapterId = (typeof ADAPTER_IDS)[number];
export const STAGE_SELECTIONS = ["explicit", "active", "last-closed"] as const;
export type StageSelection = (typeof STAGE_SELECTIONS)[number];

export type HeronProject = {
  kind: "HeronProject";
  schemaVersion: 1;
  source: {
    adapter: AdapterId;
    specsDir: string | null; // repo-relative; null for filesystem
    stage: { dir: string; selection: StageSelection } | null; // null for filesystem or no stage
  };
  penpot: { enabled: boolean; url: string | null; fileId: string | null; version: string | null };
};

export const HeronProjectSchema: z.ZodType<HeronProject> = z.looseObject({
  kind: z.literal("HeronProject"),
  schemaVersion: z.literal(1),
  source: z.looseObject({
    adapter: z.enum(ADAPTER_IDS),
    specsDir: z.string().nullable(),
    stage: z.looseObject({ dir: z.string(), selection: z.enum(STAGE_SELECTIONS) }).nullable(),
  }),
  penpot: z.looseObject({
    enabled: z.boolean(),
    url: z.string().nullable(),
    fileId: z.string().nullable(),
    version: z.string().nullable(),
  }),
});

export const HERON_PROJECT_DOCUMENT: DocumentSpec<HeronProject> = {
  kind: "HeronProject",
  schemaVersion: 1,
  schema: HeronProjectSchema,
  schemaFile: "heron-project.v1.schema.json",
};
