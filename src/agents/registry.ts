import type { AgentProviderId } from "../core/contracts/index.ts";
import { claudeCodeProvider } from "./adapters/claude-code/index.ts";
import { codexCliProvider } from "./adapters/codex-cli/index.ts";
import { fakeProvider } from "./adapters/fake/index.ts";
import type { AgentProvider } from "./ports.ts";

/** One entry per `AgentProviderId`. */
export const AGENT_PROVIDERS: Readonly<Record<AgentProviderId, AgentProvider>> = {
  "claude-code": claudeCodeProvider,
  "codex-cli": codexCliProvider,
  fake: fakeProvider,
};

export function providerFor(id: AgentProviderId): AgentProvider {
  return AGENT_PROVIDERS[id];
}
