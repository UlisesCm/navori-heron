import { z } from "zod";
import { TemplateRefSchema, type TemplateRef } from "./agents.ts";
import {
  HeronModeSchema,
  RelativeArtifactPathSchema,
  Sha256HexSchema,
  type HeronMode,
  type RelativeArtifactPath,
  type Sha256Hex,
} from "./common.ts";
import type { DocumentSpec } from "./version.ts";

/** Complete at birth: P12 writes "review"; P6 writes "system" (DR16). */
export const PENPOT_SYNC_SCOPES = ["review", "system"] as const;
export type PenpotSyncScope = (typeof PENPOT_SYNC_SCOPES)[number];

/** Both fields come from Penpot and are untrusted. */
export type PenpotFileRef = { id: string; name: string };
const PenpotFileRefSchema: z.ZodType<PenpotFileRef> = z.looseObject({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
});

/** e.g. "heron:proposal:DIR-A", "heron:references". */
export type PenpotSyncEntry = {
  heronId: string;
  kind: string; // P12: "proposal-page" | "references-page"; P6 adds kinds without a bump
  pageId: string;
  pageName: string;
  template: TemplateRef;
  sourceSha256: Sha256Hex;
  contentSha256: Sha256Hex;
  mode: HeronMode;
};
const PenpotSyncEntrySchema: z.ZodType<PenpotSyncEntry> = z.looseObject({
  heronId: z.string().regex(/^heron:[a-z][a-z0-9-]*(?::[A-Za-z0-9-]+)*$/),
  kind: z.string().regex(/^[a-z][a-z-]*$/),
  pageId: z.string().min(1).max(64),
  pageName: z.string().max(200),
  template: TemplateRefSchema,
  sourceSha256: Sha256HexSchema,
  contentSha256: Sha256HexSchema,
  mode: HeronModeSchema,
});

/** Confirmed pages only (DR16), sorted by heronId, no timestamps. */
export type PenpotSyncState = {
  kind: "PenpotSyncState";
  schemaVersion: 1;
  scope: PenpotSyncScope;
  file: PenpotFileRef;
  penpotVersion: string;
  entries: PenpotSyncEntry[];
};
export const PenpotSyncStateSchema: z.ZodType<PenpotSyncState> = z.looseObject({
  kind: z.literal("PenpotSyncState"),
  schemaVersion: z.literal(1),
  scope: z.enum(PENPOT_SYNC_SCOPES),
  file: PenpotFileRefSchema,
  penpotVersion: z.string().min(1).max(40),
  entries: z.array(PenpotSyncEntrySchema),
});
export const PENPOT_SYNC_STATE_DOCUMENT: DocumentSpec<PenpotSyncState> = {
  kind: "PenpotSyncState",
  schemaVersion: 1,
  schema: PenpotSyncStateSchema,
  schemaFile: "penpot-sync-state.v1.schema.json",
};

// ---- CLI data (transient, plain z.object) ----
export type PenpotPageStatus = "up-to-date" | "outdated" | "missing" | "duplicate" | "unknown";
export type PenpotLinkData = {
  file: PenpotFileRef;
  penpotVersion: string;
  previousFileId: string | null;
  written: RelativeArtifactPath[];
  stateRevision: number | null;
};
export type PenpotInspectData = {
  penpotVersion: string;
  file: PenpotFileRef | null;
  bound: { fileId: string | null; matches: boolean };
  pages: {
    heronId: string;
    pageId: string | null;
    name: string | null;
    status: PenpotPageStatus;
  }[];
  unmanagedPages: number;
};
export type PenpotSyncAction =
  | "created"
  | "updated"
  | "unchanged"
  | "would-create"
  | "would-update";
export type PenpotSyncData = {
  dryRun: boolean;
  mode: HeronMode;
  file: PenpotFileRef;
  pages: { heronId: string; action: PenpotSyncAction; pageId: string | null }[];
  writes: number;
  written: RelativeArtifactPath[];
  stateRevision: number | null;
};

const TransientFileRefSchema: z.ZodType<PenpotFileRef> = z.object({
  id: z.string(),
  name: z.string(),
});
export const PenpotLinkDataSchema: z.ZodType<PenpotLinkData> = z.object({
  file: TransientFileRefSchema,
  penpotVersion: z.string(),
  previousFileId: z.string().nullable(),
  written: z.array(RelativeArtifactPathSchema),
  stateRevision: z.number().int().nullable(),
});
export const PenpotInspectDataSchema: z.ZodType<PenpotInspectData> = z.object({
  penpotVersion: z.string(),
  file: TransientFileRefSchema.nullable(),
  bound: z.object({ fileId: z.string().nullable(), matches: z.boolean() }),
  pages: z.array(
    z.object({
      heronId: z.string(),
      pageId: z.string().nullable(),
      name: z.string().nullable(),
      status: z.enum(["up-to-date", "outdated", "missing", "duplicate", "unknown"]),
    }),
  ),
  unmanagedPages: z.number().int().min(0),
});
export const PenpotSyncDataSchema: z.ZodType<PenpotSyncData> = z.object({
  dryRun: z.boolean(),
  mode: HeronModeSchema,
  file: TransientFileRefSchema,
  pages: z.array(
    z.object({
      heronId: z.string(),
      action: z.enum(["created", "updated", "unchanged", "would-create", "would-update"]),
      pageId: z.string().nullable(),
    }),
  ),
  writes: z.number().int().min(0),
  written: z.array(RelativeArtifactPathSchema),
  stateRevision: z.number().int().nullable(),
});
