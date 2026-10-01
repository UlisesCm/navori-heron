// Covers: R2
import { describe, expect, test } from "bun:test";
import {
  AGENT_API_KEY_VARS,
  AGENT_ENV_ALLOWLIST,
  AGENT_ROUTE_VARS,
  buildAgentEnv,
} from "../../../src/security/env.ts";

describe("buildAgentEnv", () => {
  // Covers: R2
  test("builds the child environment from the allowlist only", () => {
    const parent: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      HOME: "/home/u",
      LANG: "",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-secret-value",
      HERON_PROFILE: "x",
      PENPOT_TOKEN: "y",
      UNLISTED_VAR: "z",
      AWS_SECRET_ACCESS_KEY: "aws",
      ANTHROPIC_API_KEY: "k1",
      OPENAI_API_KEY: "k2",
      CLAUDE_CODE_USE_BEDROCK: "1",
      ANTHROPIC_BASE_URL: "https://gw.example",
    };
    const { env, ignored } = buildAgentEnv(parent);
    expect(env).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-secret-value",
      HOME: "/home/u",
      NO_COLOR: "1",
      PATH: "/usr/bin",
    });
    expect(Object.keys(env)).toEqual(Object.keys(env).toSorted());
    expect(ignored).toEqual([
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_BASE_URL",
      "CLAUDE_CODE_USE_BEDROCK",
      "OPENAI_API_KEY",
    ]);
    for (const name of [...AGENT_API_KEY_VARS, ...AGENT_ROUTE_VARS]) {
      expect(AGENT_ENV_ALLOWLIST).not.toContain(name);
    }
    expect(buildAgentEnv({}).ignored).toEqual([]);
    expect(buildAgentEnv({ ANTHROPIC_API_KEY: "" }).ignored).toEqual([]);
  });
});
