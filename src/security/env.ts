/** Variables copied to the agent child process. CLAUDE_CODE_OAUTH_TOKEN passes by DR35.b (the redactor treats it as a secret). */
export const AGENT_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TZ",
  "TMPDIR",
  "TERM",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CODEX_HOME",
];

/** API credentials never passed to the child (DR35.a): the agent uses its own subscription login. */
export const AGENT_API_KEY_VARS: readonly string[] = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
];

/** Cloud/gateway routing variables never passed to the child (DR35.c). */
export const AGENT_ROUTE_VARS: readonly string[] = [
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "ANTHROPIC_BASE_URL",
];

export const FORBIDDEN_ENV_PREFIXES: readonly string[] = ["HERON_", "PENPOT_"];

export interface AgentEnv {
  env: Record<string, string>;
  /** AGENT_API_KEY_VARS + AGENT_ROUTE_VARS present in the parent, sorted. */
  ignored: string[];
}

/** Copies only AGENT_ENV_ALLOWLIST names with a non-empty value, then NO_COLOR=1; forbidden prefixes never copied. Keys sorted. */
export function buildAgentEnv(parent: Readonly<Record<string, string | undefined>>): AgentEnv {
  const picked: Record<string, string> = {};
  for (const name of AGENT_ENV_ALLOWLIST) {
    const value = parent[name];
    if (value === undefined || value === "") continue;
    if (FORBIDDEN_ENV_PREFIXES.some((prefix) => name.toUpperCase().startsWith(prefix))) continue;
    picked[name] = value;
  }
  picked["NO_COLOR"] = "1";
  const env: Record<string, string> = {};
  for (const name of Object.keys(picked).toSorted()) env[name] = picked[name] as string;
  const ignored = [...AGENT_API_KEY_VARS, ...AGENT_ROUTE_VARS]
    .filter((name) => parent[name] !== undefined && parent[name] !== "")
    .toSorted();
  return { env, ignored };
}
