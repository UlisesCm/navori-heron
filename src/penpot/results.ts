import { z } from "zod";
import type { PenpotFileRef } from "../core/contracts/index.ts";

export type InspectedPage = {
  pageId: string;
  name: string;
  marks: {
    id: string;
    content: string | null;
    source: string | null;
    template: string | null;
    mode: string | null;
  };
};
export type InspectedFile = {
  heron: "inspect@v1";
  penpotVersion: string;
  file: PenpotFileRef | null;
  pages: InspectedPage[];
  unmanagedPages: number;
};
export type WrittenPage = {
  heron: "review-page@v1";
  pageId: string;
  outcome: "written" | "conflict" | "human-shapes";
  created: boolean;
  shapes: number;
  fontFallbacks: string[];
  humanShapes: string[];
};

const id = z.string().min(1).max(64);
const name = z.string().max(200);
const mark = z.string().max(200).nullable();
const count = z.number().int().min(0);
export const InspectedFileSchema: z.ZodType<InspectedFile> = z.object({
  heron: z.literal("inspect@v1"),
  penpotVersion: z.string().min(1).max(40),
  file: z.object({ id, name }).nullable(),
  pages: z
    .array(
      z.object({
        pageId: id,
        name,
        marks: z.object({
          id: z.string().min(1).max(200),
          content: mark,
          source: mark,
          template: mark,
          mode: mark,
        }),
      }),
    )
    .max(500),
  unmanagedPages: count,
});
export const WrittenPageSchema: z.ZodType<WrittenPage> = z.object({
  heron: z.literal("review-page@v1"),
  pageId: id,
  outcome: z.enum(["written", "conflict", "human-shapes"]),
  created: z.boolean(),
  shapes: count,
  fontFallbacks: z.array(name).max(500),
  humanShapes: z.array(name).max(10),
});
