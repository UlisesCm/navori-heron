/**
 * Pure model of the Penpot compose files (specs/0005 DR4): parse, interpolate, merge and check the invariants of R1.
 * It does not import `bun:test`, so `tests/live/penpot-compose.live.ts` can apply the same checks to the model
 * that real `docker compose config --format json` produces.
 */

/** A merged service: only the keys the invariants read are typed, the rest stays opaque. */
export type ComposeService = {
  image?: string;
  profiles?: string[];
  ports?: unknown[];
  environment?: Record<string, string>;
  [key: string]: unknown;
};

/** The merged compose model; top-level `x-*` blocks are kept, like `docker compose config` keeps them. */
export type ComposeModel = {
  services: Record<string, ComposeService>;
  [key: string]: unknown;
};

type Env = Readonly<Record<string, string>>;

const VAR = /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?])([^}]*))?\}/g;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Interpolates `${V}`, `${V:-d}`, `${V-d}`, `${V:?m}`, `${V?m}` and `$$` in every string of `value`.
 * `:` treats an empty value as unset. A failing `?` form throws with the compose message.
 */
export function interpolateCompose(value: unknown, env: Env): unknown {
  if (typeof value === "string") {
    return value.replace(VAR, (match, name?: string, op?: string, arg?: string) => {
      if (match === "$$") return "$";
      const key = name ?? "";
      const raw = env[key];
      const unset = raw === undefined || (op?.startsWith(":") === true && raw === "");
      if (op === undefined) return raw ?? "";
      if (op.endsWith("?")) {
        if (unset) throw new Error(`required variable ${key} is missing a value: ${arg ?? ""}`);
        return raw ?? "";
      }
      return unset ? (arg ?? "") : (raw ?? "");
    });
  }
  if (Array.isArray(value)) return value.map((item) => interpolateCompose(item, env));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolateCompose(v, env)]),
    );
  }
  return value;
}

/** `environment` in list form (`KEY=value`) becomes a map, as Compose does before merging. */
function normalizeEnvironment(service: Record<string, unknown>): Record<string, unknown> {
  const environment = service["environment"];
  if (!Array.isArray(environment)) return service;
  const map: Record<string, unknown> = {};
  for (const entry of environment) {
    const text = String(entry);
    const eq = text.indexOf("=");
    map[eq < 0 ? text : text.slice(0, eq)] = eq < 0 ? "" : text.slice(eq + 1);
  }
  return { ...service, environment: map };
}

/**
 * Deep-merges `over` onto `base`: maps merge by key, scalars are replaced and sequences are appended, except
 * `ports`, which is replaced because `Bun.YAML.parse` drops the `!override` tag the override puts on it (the
 * test checks that tag in the file text).
 */
function merge(base: unknown, over: unknown, key = ""): unknown {
  if (isRecord(base) && isRecord(over)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge(base[k], v, k) : v;
    return out;
  }
  if (Array.isArray(base) && Array.isArray(over))
    return key === "ports" ? over : [...base, ...over];
  return over;
}

/** Parses the compose file texts in order (later ones override earlier ones) and interpolates them with `env`. */
export function loadComposeModel(texts: readonly string[], env: Env): ComposeModel {
  let model: unknown = {};
  for (const text of texts) {
    const parsed: unknown = Bun.YAML.parse(text);
    if (!isRecord(parsed)) throw new Error("a compose file must be a mapping");
    const services = parsed["services"];
    const normalized = isRecord(services)
      ? {
          ...parsed,
          services: Object.fromEntries(
            Object.entries(services).map(([name, s]) => [
              name,
              isRecord(s) ? normalizeEnvironment(s) : s,
            ]),
          ),
        }
      : parsed;
    model = merge(model, normalized);
  }
  const resolved = interpolateCompose(model, env);
  if (!isRecord(resolved) || !isRecord(resolved["services"]))
    throw new Error("no services in the model");
  return resolved as ComposeModel;
}

/** Services Compose would start: those without `profiles`. */
export function activeServices(model: ComposeModel): [string, ComposeService][] {
  return Object.entries(model.services).filter(([, s]) => (s.profiles ?? []).length === 0);
}

const FORBIDDEN = [
  "change-this-insecure-key",
  "disable-secure-session-cookies",
  "disable-email-verification",
];

/** Ports of a service as `host_ip:published:target` text, from the short or the long (`config`) form. */
function portText(port: unknown): string {
  if (typeof port === "string" || typeof port === "number") return String(port);
  if (isRecord(port))
    return `${String(port["host_ip"] ?? "")}:${String(port["published"] ?? "")}:${String(port["target"] ?? "")}`;
  return "";
}

/** Collects every violation of R1 (P12.A1) in the merged model and throws one error listing them. */
export function assertPenpotComposeInvariants(model: ComposeModel, version = "2.17.2"): void {
  const bad: string[] = [];
  const text = JSON.stringify(model);
  for (const token of FORBIDDEN) if (text.includes(token)) bad.push(`model contains ${token}`);

  for (const [name, s] of Object.entries(model.services)) {
    if (/:latest$|^[^:]+$/.test(s.image ?? ""))
      bad.push(`${name} image is unpinned: ${s.image ?? "(none)"}`);
  }
  const active = new Map(activeServices(model));
  for (const name of ["penpot-frontend", "penpot-backend", "penpot-mcp", "penpot-exporter"]) {
    const image = active.get(name)?.image ?? "";
    if (!image.endsWith(`:${version}`))
      bad.push(`${name} image is not pinned to ${version}: ${image}`);
  }
  for (const name of ["penpot-frontend", "penpot-backend"]) {
    if (
      !(active.get(name)?.environment?.["PENPOT_FLAGS"] ?? "").split(/\s+/).includes("enable-mcp")
    ) {
      bad.push(`${name} lacks enable-mcp`);
    }
  }
  if (active.has("penpot-mailcatch")) bad.push("penpot-mailcatch is active");
  for (const [name, s] of active) {
    const env = s.environment ?? {};
    if (env["PENPOT_DATABASE_PASSWORD"] === "penpot" || env["POSTGRES_PASSWORD"] === "penpot") {
      bad.push(`${name} uses the default database password`);
    }
    if (env["PENPOT_TELEMETRY_ENABLED"] === "true") bad.push(`${name} has telemetry enabled`);
    for (const port of s.ports ?? []) {
      const p = portText(port);
      if (!p.startsWith("127.0.0.1:")) bad.push(`${name} publishes ${p} outside loopback`);
    }
  }
  if (bad.length > 0) throw new Error(`Penpot compose invariants violated:\n- ${bad.join("\n- ")}`);
}
