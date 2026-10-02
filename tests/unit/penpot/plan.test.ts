// Covers: R11, R15, R17
import { describe, expect, test } from "bun:test";
import asset from "../../assets/penpot/direction-proposal.json" with { type: "json" };
import {
  canonicalJson,
  PenpotSyncStateSchema,
  VisualDirectionsSchema,
} from "../../../src/core/contracts/index.ts";
import { buildProposalPage } from "../../../src/penpot/compiler/proposal-page.ts";
import { resolvePenpotCopy } from "../../../src/penpot/compiler/copy.ts";
import { pageStatuses, planReviewSync, reviewRecord } from "../../../src/penpot/compiler/plan.ts";
import type { ReviewPage } from "../../../src/penpot/compiler/nodes.ts";
import { penpotTemplate } from "../../../src/penpot/compiler/templates.ts";
import { renderScript, reviewScriptData } from "../../../src/penpot/compiler/script.ts";
import {
  InspectedFileSchema,
  WrittenPageSchema,
  type InspectedFile,
  type InspectedPage,
} from "../../../src/penpot/results.ts";
import { createFakePenpot, runPenpotScript } from "../../helpers/fake-penpot.ts";

const template = penpotTemplate("review-page");
const desired = VisualDirectionsSchema.parse(asset).directions.map((direction) =>
  buildProposalPage(direction, {
    mode: "reference-only",
    copy: resolvePenpotCopy("en"),
    template: template.ref,
  }),
);
const inspectedPage = (
  page: ReviewPage,
  pageId: string,
  content: string | null = page.contentSha256,
): InspectedPage => ({
  pageId,
  name: `Observed ${pageId}`,
  marks: {
    id: page.heronId,
    content,
    source: page.sourceSha256,
    template: "review-page@v1",
    mode: page.mode,
  },
});
const inspection = (pages: InspectedPage[] = []): InspectedFile => ({
  heron: "inspect@v1",
  file: { id: "file-id", name: "SYNTHETIC file" },
  penpotVersion: "2.17.2",
  pages,
  unmanagedPages: 1,
});

describe("review sync plan", () => {
  test("plans writes only for missing or outdated pages and reports duplicates", () => {
    const [a, b, c] = desired;
    if (!a || !b || !c) throw new Error("three directions required");
    const read = inspection([
      inspectedPage(b, "b-primary", null),
      inspectedPage(a, "a-primary"),
      inspectedPage(b, "b-extra"),
      inspectedPage(a, "a-extra", "old"),
    ]);
    const before = canonicalJson({ desired, read });
    expect(planReviewSync(desired.toReversed(), read)).toEqual({
      writes: [
        { page: b, targetPageId: "b-primary", reason: "outdated" },
        { page: c, targetPageId: null, reason: "missing" },
      ],
      unchanged: [a.heronId],
      duplicates: [
        { heronId: a.heronId, pageIds: ["a-extra"] },
        { heronId: b.heronId, pageIds: ["b-extra"] },
      ],
    });
    expect(canonicalJson({ desired, read })).toBe(before);
    for (const content of ["", "stale", null])
      expect(
        planReviewSync([a], inspection([inspectedPage(a, "primary", content)])).writes[0]?.reason,
      ).toBe("outdated");
    expect(planReviewSync([], inspection())).toEqual({ writes: [], unchanged: [], duplicates: [] });
    expect(
      planReviewSync(desired.toReversed(), inspection()).writes.map((write) => write.page.heronId),
    ).toEqual(desired.map((page) => page.heronId));
  });

  test("reports primary status, duplicate extras and unknown Heron marks", () => {
    const a = desired[0]!;
    const b = desired[1]!;
    const read = inspection([
      inspectedPage(a, "primary"),
      inspectedPage(a, "extra"),
      inspectedPage(b, "old", ""),
      {
        ...inspectedPage(a, "foreign"),
        marks: { ...inspectedPage(a, "foreign").marks, id: "heron:future" },
      },
    ]);
    expect(pageStatuses(desired, read).map(({ pageId, status }) => ({ pageId, status }))).toEqual([
      { pageId: "primary", status: "up-to-date" },
      { pageId: "extra", status: "duplicate" },
      { pageId: "old", status: "outdated" },
      { pageId: null, status: "missing" },
      { pageId: "foreign", status: "unknown" },
    ]);
    expect(pageStatuses([], inspection())).toEqual([]);
  });

  test("records only confirmed primary pages and remains deterministic without timestamps", () => {
    const a = desired[0]!;
    const b = desired[1]!;
    const c = desired[2]!;
    const read = inspection([
      inspectedPage(c, "c"),
      inspectedPage(b, "b", null),
      inspectedPage(b, "b-extra"),
      inspectedPage(a, "a"),
    ]);
    const record = reviewRecord(desired.toReversed(), read);
    if (record === null) throw new Error("bound file must produce a record");
    expect(record?.entries.map((entry) => entry.heronId)).toEqual([a.heronId, c.heronId]);
    expect(record?.entries[0]).toEqual({
      heronId: a.heronId,
      kind: a.kind,
      pageId: "a",
      pageName: "Observed a",
      template: a.template,
      sourceSha256: a.sourceSha256,
      contentSha256: a.contentSha256,
      mode: a.mode,
    });
    expect(PenpotSyncStateSchema.parse(record)).toEqual(record);
    expect(canonicalJson(record)).toBe(canonicalJson(reviewRecord(desired, read)));
    expect(canonicalJson(record)).not.toContain("timestamp");
    expect(reviewRecord(desired, { ...read, file: null })).toBeNull();
    expect(reviewRecord(desired, inspection())?.entries).toEqual([]);
    expect(
      reviewRecord(desired, { ...read, file: { id: "file-id", name: "Renamed" } })?.file.name,
    ).toBe("Renamed");
    expect(reviewRecord(desired, { ...read, penpotVersion: "2.18.0" })?.penpotVersion).toBe(
      "2.18.0",
    );
  });

  test("validates bounded template results and converges after confirmed writes", async () => {
    const fake = createFakePenpot();
    const inspect = async (): Promise<InspectedFile> => {
      const script = renderScript(penpotTemplate("inspect"), {});
      if (!script.ok) throw new Error("inspect must fit");
      return InspectedFileSchema.parse(await runPenpotScript(fake, script.code));
    };
    const firstPlan = planReviewSync(desired, await inspect());
    expect(firstPlan.writes).toHaveLength(3);
    for (const write of firstPlan.writes) {
      const script = renderScript(template, reviewScriptData(write.page, write.targetPageId));
      if (!script.ok) throw new Error("proposal must fit");
      expect(WrittenPageSchema.parse(await runPenpotScript(fake, script.code)).outcome).toBe(
        "written",
      );
    }
    const read = await inspect();
    expect(planReviewSync(desired, read).writes).toEqual([]);
    expect(reviewRecord(desired, read)?.entries).toHaveLength(3);
    expect(
      InspectedFileSchema.safeParse({
        ...read,
        pages: Array.from({ length: 501 }, () => read.pages[0]),
      }).success,
    ).toBe(false);
    for (const invalid of [
      { ...read, heron: "inspect@v2" },
      { ...read, penpotVersion: "x".repeat(41) },
      { ...read, unmanagedPages: -1 },
      { ...read, file: { id: "", name: "" } },
      { ...read, pages: [{ ...read.pages[0], name: "x".repeat(201) }] },
    ])
      expect(InspectedFileSchema.safeParse(invalid).success).toBe(false);
    expect(InspectedFileSchema.parse({ ...read, file: null, pages: [] }).file).toBeNull();
    const written = {
      heron: "review-page@v1",
      pageId: "page",
      outcome: "written",
      created: true,
      shapes: 0,
      fontFallbacks: [],
      humanShapes: [],
    };
    for (const outcome of ["written", "conflict", "human-shapes"])
      expect(WrittenPageSchema.safeParse({ ...written, outcome }).success).toBe(true);
    for (const invalid of [
      { ...written, shapes: -1 },
      { ...written, shapes: 0.5 },
      { ...written, humanShapes: Array.from({ length: 11 }, () => "human") },
      { ...written, fontFallbacks: ["x".repeat(201)] },
      { ...written, outcome: "unexpected" },
    ])
      expect(WrittenPageSchema.safeParse(invalid).success).toBe(false);
  });
});
