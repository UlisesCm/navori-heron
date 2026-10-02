import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createFakeProvider,
  fakeProvider,
  type FakeStep,
} from "../../src/agents/adapters/fake/index.ts";
import type {
  AgentProvider,
  AgentRequest,
  ProcessOutcome,
  ProcessRunner,
  ProcessSpec,
} from "../../src/agents/ports.ts";
import type { AgentStepInput } from "../../src/app/agent-task.ts";
import type { AppContext } from "../../src/app/context.ts";
import { runInit } from "../../src/app/init.ts";
import { loadWorkspace, type Workspace } from "../../src/app/workspace.ts";
import { AGENT_TASKS } from "../../src/agents/tasks.ts";
import type {
  AgentProviderId,
  AgentSettingsInput,
  ResearchBriefOutput,
} from "../../src/core/contracts/index.ts";
import { copyFixture } from "./fixtures.ts";

/** Writes an executable POSIX shell script `<dir>/<name>` (a fake agent CLI) and returns its path. */
export function writeFakeAgentBin(dir: string, name: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** The child environment for a fake-bin run: only `binDir` and the system tools on PATH, no parent variables. */
export function fakeBinEnv(
  binDir: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { PATH: `${binDir}:/usr/bin:/bin`, HOME: binDir, ...extra };
}

/** What `fixedContext` injects (DR30): any attempt to launch a real agent CLI fails the test. */
export const refusingRunner: ProcessRunner = {
  run(spec: ProcessSpec): Promise<ProcessOutcome> {
    throw new Error(`refusingRunner: tests must not spawn ${spec.command}`);
  },
};

/** A scripted fake provider (the n-th call returns the n-th step) that records every request it receives. */
export function scriptedProvider(
  script: readonly FakeStep[],
  id: AgentProviderId = "fake",
): { provider: AgentProvider; requests: AgentRequest[] } {
  const inner = createFakeProvider(script, id);
  const requests: AgentRequest[] = [];
  return {
    requests,
    provider: {
      ...inner,
      invoke: (request, services) => {
        requests.push(request);
        return inner.invoke(request, services);
      },
    },
  };
}

/** Sets `agents` in `<root>/.heron/project.json` (hand-editing, as a user would); `raw` may be deliberately invalid. */
export function withAgentSettings(root: string, raw: AgentSettingsInput | unknown): void {
  const file = join(root, ".heron", "project.json");
  const project = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  project["agents"] = raw;
  writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`);
}

/** A valid `research-brief` output (SYNTHETIC test data). */
export const BRIEF_OUTPUT: ResearchBriefOutput = {
  queries: [1, 2, 3].map((n) => ({
    facet: "visual-style",
    job: `job ${n}`,
    query: `query ${n}`,
    question: `question ${n}`,
    rationale: `rationale ${n}`,
  })),
} as ResearchBriefOutput;

/** Copies the no-ux fixture into a temp dir and runs `heron init` on it; returns its root. */
export async function initializedRoot(ctx: AppContext): Promise<string> {
  const root = copyFixture("no-ux");
  const init = await runInit(ctx, {
    path: root,
    stage: null,
    dryRun: false,
    locale: null,
  });
  if (!init.ok) throw new Error("init failed in the test helper");
  return root;
}

/** Loads the workspace at `root` (read-only snapshot). */
export function openWorkspace(ctx: AppContext, root: string): Workspace {
  const loaded = loadWorkspace(ctx, root);
  if (!loaded.ok) throw new Error("workspace did not load in the test helper");
  return loaded.workspace;
}

/** A `research-brief` step with one task-input item; override any field. */
export function briefStep(
  workspace: Workspace,
  overrides: Partial<AgentStepInput<ResearchBriefOutput>> = {},
): AgentStepInput<ResearchBriefOutput> {
  return {
    workspace,
    spec: AGENT_TASKS["research-brief"],
    items: [
      {
        kind: "task-input",
        id: "task-input",
        trust: "heron",
        priority: 0,
        content: "facets: visual-style\nvalid ids: REF-1",
        findings: 0,
      },
    ],
    inputs: [],
    references: [],
    validate: () => [],
    command: "research brief",
    overBudgetRemedy: "Raise agents.contextBudgetChars.",
    previous: null,
    force: false,
    ...overrides,
  };
}

/** The deterministic `fake` provider with a call counter: `requests` grows once per provider invocation. */
export function countingFake(): { provider: AgentProvider; requests: AgentRequest[] } {
  const requests: AgentRequest[] = [];
  return {
    requests,
    provider: {
      ...fakeProvider,
      invoke: (request, services) => {
        requests.push(request);
        return fakeProvider.invoke(request, services);
      },
    },
  };
}
