// Covers: R6, R8
import { describe, expect, test } from "bun:test";
import { manualSource } from "../../../src/research/adapters/manual/index.ts";
import {
  availableSourceKinds,
  RESEARCH_SOURCES,
  sourceFor,
} from "../../../src/research/registry.ts";
import { captureRequest, captureServices, noIoFs } from "../../helpers/research.ts";

describe("manualSource", () => {
  test("captures a manual reference without any I/O", async () => {
    const services = captureServices({ fs: noIoFs });
    const result = await manualSource.capture(captureRequest({ kind: "manual" }, services));
    expect(result).toEqual({
      ok: true,
      captured: { capture: { kind: "manual" }, files: [], securityFindings: [] },
    });
    expect(manualSource.kind).toBe("manual");
  });

  test("reports an input meant for another source as data", async () => {
    const result = await manualSource.capture(
      captureRequest(
        { kind: "url", url: "https://example.com/", allowLocal: false },
        captureServices(),
      ),
    );
    expect(result).toMatchObject({ ok: false, failure: { code: "UNSUPPORTED_MEDIA_TYPE" } });
  });
});

describe("registry", () => {
  test("registers only the available kinds and answers null for the rest", () => {
    expect(availableSourceKinds()).toEqual(["manual", "url", "image", "design-md"]);
    expect(sourceFor("manual")).toBe(manualSource);
    expect(sourceFor("penpot")).toBeNull();
    expect(sourceFor("refero")).toBeNull();
    expect(Object.keys(RESEARCH_SOURCES).toSorted()).toEqual([
      "design-md",
      "image",
      "manual",
      "url",
    ]);
  });
});
