import { afterEach, expect } from "bun:test";
import { rmSync } from "node:fs";
import { ExitCode } from "../../src/core/contracts/index.ts";
import { runCliCaptured } from "./cli.ts";
import { copyFixture, type FixtureName } from "./fixtures.ts";

/** Shared e2e setup: fixture copies are tracked and removed after each test. */
export const e2eSetup = () => {
  const copies: string[] = [];

  /** Copies a fixture without initializing it. */
  const fresh = (name: FixtureName): string => {
    const root = copyFixture(name);
    copies.push(root);
    return root;
  };

  /** Copies a fixture and runs `heron init` on it, expecting success. */
  const initialized = async (name: FixtureName): Promise<string> => {
    const root = fresh(name);
    expect((await runCliCaptured(["init", root])).code).toBe(ExitCode.Ok);
    return root;
  };

  afterEach(() => {
    for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  return { fresh, initialized };
};
