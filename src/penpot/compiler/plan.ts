import type { PenpotInspectData, PenpotSyncState } from "../../core/contracts/index.ts";
import type { InspectedFile, InspectedPage } from "../results.ts";
import type { ReviewPage } from "./nodes.ts";

export type PlannedWrite = {
  page: ReviewPage;
  targetPageId: string | null;
  reason: "missing" | "outdated";
};
export type ReviewPlan = {
  writes: PlannedWrite[];
  unchanged: string[];
  duplicates: { heronId: string; pageIds: string[] }[];
};

const ordered = (desired: readonly ReviewPage[]): ReviewPage[] =>
  desired.toSorted((a, b) => (a.heronId < b.heronId ? -1 : a.heronId > b.heronId ? 1 : 0));
function pagesById(inspected: InspectedFile): Map<string, InspectedPage[]> {
  const groups = new Map<string, InspectedPage[]>();
  for (const page of inspected.pages) {
    const group = groups.get(page.marks.id) ?? [];
    group.push(page);
    groups.set(page.marks.id, group);
  }
  return groups;
}

/** The first page in file order is authoritative; duplicate extras are never write targets. */
export function planReviewSync(
  desired: readonly ReviewPage[],
  inspected: InspectedFile,
): ReviewPlan {
  const plan: ReviewPlan = { writes: [], unchanged: [], duplicates: [] };
  const groups = pagesById(inspected);
  for (const page of ordered(desired)) {
    const [target, ...extras] = groups.get(page.heronId) ?? [];
    if (extras.length)
      plan.duplicates.push({ heronId: page.heronId, pageIds: extras.map((extra) => extra.pageId) });
    if (target?.marks.content === page.contentSha256) plan.unchanged.push(page.heronId);
    else
      plan.writes.push({
        page,
        targetPageId: target?.pageId ?? null,
        reason: target ? "outdated" : "missing",
      });
  }
  return plan;
}

/** Desired primaries, their duplicate extras, then unrelated Heron marks in file order. */
export function pageStatuses(
  desired: readonly ReviewPage[],
  inspected: InspectedFile,
): PenpotInspectData["pages"] {
  const statuses: PenpotInspectData["pages"] = [];
  const groups = pagesById(inspected);
  for (const page of ordered(desired)) {
    const [target, ...extras] = groups.get(page.heronId) ?? [];
    statuses.push({
      heronId: page.heronId,
      pageId: target?.pageId ?? null,
      name: target?.name ?? null,
      status: !target
        ? "missing"
        : target.marks.content === page.contentSha256
          ? "up-to-date"
          : "outdated",
    });
    for (const extra of extras)
      statuses.push({
        heronId: page.heronId,
        pageId: extra.pageId,
        name: extra.name,
        status: "duplicate",
      });
    groups.delete(page.heronId);
  }
  for (const page of inspected.pages)
    if (groups.has(page.marks.id))
      statuses.push({
        heronId: page.marks.id,
        pageId: page.pageId,
        name: page.name,
        status: "unknown",
      });
  return statuses;
}

/** Build the local record only from confirmed primary pages in the last inspection. */
export function reviewRecord(
  desired: readonly ReviewPage[],
  inspected: InspectedFile,
): PenpotSyncState | null {
  if (inspected.file === null) return null;
  const groups = pagesById(inspected);
  const entries: PenpotSyncState["entries"] = [];
  for (const page of ordered(desired)) {
    const target = groups.get(page.heronId)?.[0];
    if (target?.marks.content !== page.contentSha256) continue;
    entries.push({
      heronId: page.heronId,
      kind: page.kind,
      pageId: target.pageId,
      pageName: target.name,
      template: page.template,
      sourceSha256: page.sourceSha256,
      contentSha256: page.contentSha256,
      mode: page.mode,
    });
  }
  return {
    kind: "PenpotSyncState",
    schemaVersion: 1,
    scope: "review",
    file: inspected.file,
    penpotVersion: inspected.penpotVersion,
    entries,
  };
}
