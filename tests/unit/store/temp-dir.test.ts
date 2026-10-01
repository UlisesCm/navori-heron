// Covers: R1
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeTempDirs } from "../../../src/core/store/temp-dir.ts";

describe("nodeTempDirs", () => {
  test("creates private empty directories and disposes them", () => {
    const ws = nodeTempDirs.create("heron-agent");
    try {
      expect(ws.path.startsWith(tmpdir()) || ws.path.includes("heron-agent-")).toBe(true);
      expect(readdirSync(ws.path)).toEqual([]);
      expect(statSync(ws.path).mode & 0o777).toBe(0o700);

      const file = ws.writeFile("out.json", '{"a":1}');
      expect(file).toBe(join(ws.path, "out.json"));
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(ws.readFile("out.json")).toBe('{"a":1}');
      expect(ws.readFile("missing.json")).toBeNull();

      // names and prefixes are validated: no separators, no traversal, no uppercase
      expect(() => ws.writeFile("a/b", "x")).toThrow();
      expect(() => ws.writeFile("../x", "x")).toThrow();
      expect(() => ws.writeFile("a..b", "x")).toThrow();
      expect(() => ws.writeFile("A.json", "x")).toThrow();
      expect(() => nodeTempDirs.create("Bad/Prefix")).toThrow();
      expect(() => nodeTempDirs.create("1abc")).toThrow();
    } finally {
      ws.dispose();
    }
    expect(existsSync(ws.path)).toBe(false);
    expect(ws.readFile("out.json")).toBeNull();
    expect(() => {
      ws.dispose();
    }).not.toThrow(); // idempotent
    expect(nodeTempDirs.create("heron-agent").path).not.toBe(ws.path);
  });
});
