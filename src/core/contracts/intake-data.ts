import { z } from "zod";
import { HeronModeSchema, type HeronMode } from "./common.ts";
import { ADAPTER_IDS, type AdapterId } from "./heron-project.ts";
import { StageRefSchema, type StageRef } from "./mode-decision.ts";
import {
  ConflictIdSchema,
  ConflictSchema,
  PRODUCT_CONTEXT_SECTIONS,
  type Conflict,
  type ConflictId,
  type ProductContextSection,
} from "./product-context.ts";

export type ProductContextCounts = Record<ProductContextSection, number>;
export type ConflictSummary = {
  id: ConflictId;
  kind: string;
  subject: string;
  acknowledged: boolean;
};
export type IntakeData = {
  mode: HeronMode;
  adapter: AdapterId;
  stage: StageRef | null;
  dryRun: boolean;
  written: boolean; // false on dry run and when bytes did not change
  stateRevision: number | null; // null on dry run without .heron/
  counts: ProductContextCounts;
  conflicts: ConflictSummary[]; // status "open", by id
};
export type ConflictsListData = { tracked: boolean; conflicts: Conflict[] };
export type ConflictsAckData = {
  conflict: Conflict;
  stateRevision: number;
  unacknowledged: number;
};

// Transient output: plain z.object (DP7), unlike the persisted documents.
const count = z.number().int().min(0);
const ProductContextCountsSchema: z.ZodType<ProductContextCounts> = z.object(
  Object.fromEntries(PRODUCT_CONTEXT_SECTIONS.map((section) => [section, count])) as Record<
    ProductContextSection,
    typeof count
  >,
);
export const IntakeDataSchema: z.ZodType<IntakeData> = z.object({
  mode: HeronModeSchema,
  adapter: z.enum(ADAPTER_IDS),
  stage: StageRefSchema.nullable(),
  dryRun: z.boolean(),
  written: z.boolean(),
  stateRevision: z.number().int().nullable(),
  counts: ProductContextCountsSchema,
  conflicts: z.array(
    z.object({
      id: ConflictIdSchema,
      kind: z.string(),
      subject: z.string(),
      acknowledged: z.boolean(),
    }),
  ),
});
export const ConflictsListDataSchema: z.ZodType<ConflictsListData> = z.object({
  tracked: z.boolean(),
  conflicts: z.array(ConflictSchema),
});
export const ConflictsAckDataSchema: z.ZodType<ConflictsAckData> = z.object({
  conflict: ConflictSchema,
  stateRevision: z.number().int(),
  unacknowledged: count,
});
