import { z } from "zod";
import {
  HeronModeSchema,
  IsoDateTimeSchema,
  RelativeArtifactPathSchema,
  Sha256HexSchema,
  type HeronMode,
  type IsoDateTime,
  type RelativeArtifactPath,
  type Sha256Hex,
} from "./common.ts";
import { HERON_PHASES, type HeronPhase } from "./heron-state.ts";
import {
  BrandInputSchema,
  ReferenceIdSchema,
  RESEARCH_SOURCE_KINDS,
  ResearchReferenceSchema,
  type BrandInput,
  type ReferenceId,
  type ResearchReference,
  type ResearchSourceKind,
} from "./research.ts";

export type ResearchCounts = {
  active: number;
  removed: number;
  withProvenance: number;
  minimum: number;
  brandInputs: number;
};
export type ReferenceSummary = {
  id: ReferenceId;
  source: ResearchSourceKind;
  origin: string;
  capturedAt: IsoDateTime;
  mode: HeronMode;
  removed: boolean;
  crops: number;
  securityFindings: number;
};
/** `references`: the one added. */
export type ReferencesAddData = {
  references: ResearchReference[];
  phase: { from: HeronPhase; to: HeronPhase };
  stateRevision: number;
  counts: ResearchCounts;
  written: RelativeArtifactPath[];
};
/** `batch.file`: repo-relative POSIX. */
export type ReferencesImportData = ReferencesAddData & { batch: { file: string; items: number } };
export type ReferencesListData = {
  references: ReferenceSummary[];
  counts: ResearchCounts;
  includeRemoved: boolean;
};
export type ReferencesShowData = { reference: ResearchReference; counts: ResearchCounts };
export type ReferencesCompareData = {
  references: ResearchReference[];
  shared: { studies: string[]; doNotCopy: string[]; influences: string[] };
};
export type ReferencesRemoveData = {
  removed: ResearchReference;
  stateRevision: number;
  counts: ResearchCounts;
  written: RelativeArtifactPath[];
};
export type BrandAddData = {
  input: BrandInput;
  stateRevision: number;
  written: RelativeArtifactPath[];
};
export type ResearchOutputStatus = {
  path: RelativeArtifactPath;
  sha256: Sha256Hex;
  written: boolean;
};
export type ResearchRenderData = {
  mode: HeronMode;
  locale: string;
  outputs: ResearchOutputStatus[];
  counts: ResearchCounts;
  stateRevision: number;
};

// Transient output: plain z.object (DP7), unlike the persisted documents.
const count = z.number().int().min(0);
const revision = z.number().int();
const paths = z.array(RelativeArtifactPathSchema);
export const ResearchCountsSchema: z.ZodType<ResearchCounts> = z.object({
  active: count,
  removed: count,
  withProvenance: count,
  minimum: count,
  brandInputs: count,
});
export const ReferenceSummarySchema: z.ZodType<ReferenceSummary> = z.object({
  id: ReferenceIdSchema,
  source: z.enum(RESEARCH_SOURCE_KINDS),
  origin: z.string(),
  capturedAt: IsoDateTimeSchema,
  mode: HeronModeSchema,
  removed: z.boolean(),
  crops: count,
  securityFindings: count,
});
const addFields = {
  references: z.array(ResearchReferenceSchema),
  phase: z.object({ from: z.enum(HERON_PHASES), to: z.enum(HERON_PHASES) }),
  stateRevision: revision,
  counts: ResearchCountsSchema,
  written: paths,
};
export const ReferencesAddDataSchema: z.ZodType<ReferencesAddData> = z.object(addFields);
export const ReferencesImportDataSchema: z.ZodType<ReferencesImportData> = z.object({
  ...addFields,
  batch: z.object({ file: z.string(), items: count }),
});
export const ReferencesListDataSchema: z.ZodType<ReferencesListData> = z.object({
  references: z.array(ReferenceSummarySchema),
  counts: ResearchCountsSchema,
  includeRemoved: z.boolean(),
});
export const ReferencesShowDataSchema: z.ZodType<ReferencesShowData> = z.object({
  reference: ResearchReferenceSchema,
  counts: ResearchCountsSchema,
});
export const ReferencesCompareDataSchema: z.ZodType<ReferencesCompareData> = z.object({
  references: z.array(ResearchReferenceSchema),
  shared: z.object({
    studies: z.array(z.string()),
    doNotCopy: z.array(z.string()),
    influences: z.array(z.string()),
  }),
});
export const ReferencesRemoveDataSchema: z.ZodType<ReferencesRemoveData> = z.object({
  removed: ResearchReferenceSchema,
  stateRevision: revision,
  counts: ResearchCountsSchema,
  written: paths,
});
export const BrandAddDataSchema: z.ZodType<BrandAddData> = z.object({
  input: BrandInputSchema,
  stateRevision: revision,
  written: paths,
});
export const ResearchOutputStatusSchema: z.ZodType<ResearchOutputStatus> = z.object({
  path: RelativeArtifactPathSchema,
  sha256: Sha256HexSchema,
  written: z.boolean(),
});
export const ResearchRenderDataSchema: z.ZodType<ResearchRenderData> = z.object({
  mode: HeronModeSchema,
  locale: z.string(),
  outputs: z.array(ResearchOutputStatusSchema),
  counts: ResearchCountsSchema,
  stateRevision: revision,
});
