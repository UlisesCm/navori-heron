# Proveedores de agentes (P3)

Esta página documenta cómo Heron usa Claude Code y Codex CLI como agentes: requisitos, banderas literales, entorno del hijo, configuración, economía de tokens, `doctor` y los términos de uso con una suscripción (§Términos, P3.A11). La frontera de diseño está en el [ADR 0005](adr/0005-ai-provider-boundary.md); las defensas, en [docs/security.md](security.md#agentes-p3).

## Requisitos y sonda viva

| Proveedor     | Binario  | Mínimo                            | Probado en vivo (2026-10-01) |
| ------------- | -------- | --------------------------------- | ---------------------------- |
| `claude-code` | `claude` | 2.1.259                           | 2.1.287                      |
| `codex-cli`   | `codex`  | sonda de capacidades por `--help` | 0.159.3                      |

Heron no instala ni actualiza los CLI: el operador inicia sesión él mismo (`claude`, `codex login`). `heron doctor` informa si falta el binario, si la versión es menor al mínimo, si `--help` no lista alguna bandera de aislamiento o si no hay sesión (WARNING; P1 y P2 siguen funcionando sin IA).

La sonda viva (`HERON_LIVE_AGENTS=1 bun run test:live`, `tests/live/agents.live.ts`) queda fuera de `bun test` y de `bun run check`: lanza los CLI reales con la sesión del operador. Resultados del 2026-10-01:

- **claude 2.1.287:** el validador de `--json-schema` rechazó el `$schema` de draft 2020-12 (`no schema with key or ref "https://json-schema.org/draft/2020-12/schema"`, exit 1). El dialecto de Claude es **draft-7 sin `$schema`** (`toProviderSchema(schema, "claude")`). Una respuesta trivial dio `inputTokens: 2` con `cachedInputTokens: 706` en la API de Anthropic, de ahí la normalización de uso (§Economía de tokens).
- **codex 0.159.3:** `turn.completed.usage` trae `input_tokens`, `cached_input_tokens`, `output_tokens` más `cache_write_input_tokens` y `reasoning_output_tokens` (estas dos hoy no se suman). `cached_input_tokens` salió en 0, así que la inclusión de lo cacheado en `input_tokens` no se observó y se apoya solo en la documentación de OpenAI.

## Banderas literales

El argv es siempre un arreglo (nunca una cadena de shell). El pack viaja por stdin, nunca como argumento. Nunca se usa `--bare`.

**Claude Code** (`CLAUDE_FIXED_ARGS`, `src/agents/adapters/claude-code/index.ts`):

```text
-p --output-format json --tools "" --disallowedTools "mcp__*" --strict-mcp-config
--no-session-persistence --safe-mode --restricted --permission-mode dontAsk --permission-prompts none
```

más `--json-schema <schema>`, `--system-prompt <plantilla>` y, solo si el operador configuró uno, `--model <modelo>`.

**Codex CLI** (`CODEX_FIXED_ARGS`, `src/agents/adapters/codex-cli/index.ts`):

```text
exec --sandbox read-only --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules
--json --color never --disable <feature>... -c web_search="disabled"
```

más `--output-schema <archivo>`, `-o <archivo>`, `-m <modelo>` (opcional) y `-` (el prompt va por stdin). Codex no tiene `--system-prompt`: la plantilla va primero en stdin, dentro de `<heron-instructions>` (DR29), con una separación de roles más débil que en Claude.

**Monitor de Codex.** `--json` emite eventos y Heron solo admite los de la lista blanca: `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.started`, `item.updated`, `item.completed` y `error`, con ítems de tipo `agent_message` o `reasoning` (`CODEX_ALLOWED_ITEM_TYPES`). Cualquier otro (ítem de herramienta, evento desconocido, línea no JSON) detiene el proceso y termina en `AGENT_POLICY_VIOLATION` (exit 3). Es el control principal porque `unified_exec` no se desactiva en 0.159.x.

El cwd del hijo es un directorio temporal vacío y privado, y se lanza en un grupo de procesos propio: al vencer `timeoutMs` se envía `SIGTERM` al grupo y `SIGKILL` tras 3 s.

## Entorno del hijo

`buildAgentEnv` copia solo `AGENT_ENV_ALLOWLIST` (`src/security/env.ts`) y agrega `NO_COLOR=1`: `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, locale (`LANG`, `LC_*`), `TZ`, `TMPDIR`, `TERM`, `XDG_*_HOME`, certificados (`SSL_CERT_FILE`, `SSL_CERT_DIR`, `NODE_EXTRA_CA_CERTS`), proxies (`HTTP(S)_PROXY`, `NO_PROXY` en ambas capitalizaciones), `CLAUDE_CONFIG_DIR`, `CODEX_HOME` y `CLAUDE_CODE_OAUTH_TOKEN`.

- Nunca pasan `HERON_*` ni `PENPOT_*`.
- Nunca pasan las API keys (`AGENT_API_KEY_VARS`: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, `CODEX_API_KEY`) ni las rutas de nube o gateway (`AGENT_ROUTE_VARS`: `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `ANTHROPIC_BASE_URL`). Si estaban presentes, el comando lo informa con `AGENT_ENV_IGNORED`.
- `CLAUDE_CODE_OAUTH_TOKEN` pasa (DR35.b) y el redactor lo trata como secreto en todo sink.
- Para Claude, Heron fija `CLAUDE_CODE_MAX_OUTPUT_TOKENS` por tarea (brief 4 000, analyze 8 000, direction-propose 16 000, probe 500).

## Configuración (`agents` en `project.json`)

```json
{
  "agents": {
    "roles": { "creator": "claude-code", "reviewer": "codex-cli" },
    "models": { "claude-code": "<modelo>" },
    "timeoutMs": 600000,
    "contextBudgetChars": 120000,
    "warnTokensPerDay": 2000000
  }
}
```

Todo es opcional. Defaults: `creator` = `claude-code`, `reviewer` = `codex-cli`, sin modelo (cada CLI usa el suyo; el modelo pedido y el reportado quedan en `AgentRun`), `timeoutMs` 600 000 (rango 1 000 a 3 600 000), `contextBudgetChars` 120 000 (10 000 a 1 000 000) y sin aviso de presupuesto. Las tareas de P3 usan el rol `creator`; Codex se ejercita al intercambiar `roles` y en `doctor --deep`.

**Nota operativa.** `project.json` es un artefacto ligado (bound): el gate y la huella de entradas lo cubren. Si editas `agents` a mano, los comandos de escritura detectan el cambio y se niegan hasta que ejecutes `heron init` para volver a ligarlo. Una configuración inválida da `AGENT_CONFIG_INVALID` (exit 2, con punteros `/agents/...`) solo en los comandos de agente y en `doctor`; el resto de Heron no se ve afectado (DR21).

## Comandos

- `heron research brief [path] [--query <facet>:<text>]... [--reset-queries] [--force]`
- `heron research analyze [path] [--ref <REF-n>]... [--force]`
- `heron direction propose [path] [--force]`
- `heron direction select <DIR-x> [path] [--note <text>]`

Cada comando de agente hace hasta 3 invocaciones fuera del lock (1 más 2 reparaciones) y solo el commit toma el lock; si otro comando escribió, exit 6 y la salida se descarta. Exit: 2 entrada, configuración o pack; 3 fase, precondición o `policy-violation`; 4 salida inválida; 5 agente no disponible, falla o `timeout`; 6 lock o revisión. **`--force`** salta la cache de resultados y vuelve a preguntar al agente.

## Economía de tokens

Sin tope duro de costo (DR38), pero con patrones que ahorran tokens y un límite estructural: máximo 3 invocaciones por comando, sin reintento ante `timeout`.

- **Cache por run (DR39).** `agentCacheKey` es el sha256 de tarea, plantilla (id, versión, sha256), schema (dialecto, sha256), proveedor, modelo pedido y sha256 del pack. `research brief` y `direction propose` no invocan si la clave coincide con la del documento vigente, el documento conserva el sha256 de las salidas del run (no se editó a mano), existe `runs/<runId>.json` y no se pasó `--force`: responden exit 0 con `AGENT_RUN_REUSED`, sin escribir. `research analyze` aplica lo mismo por referencia (`inputKey`) y solo envía las que cambiaron. La comprobación de edición manual de `direction propose` **excluye `selection`** (estado del usuario): elegir una dirección no obliga a volver a preguntar.
- **Reparación compacta (DR43).** Máximo 2 reparaciones, para un total de 3 invocaciones. Las sesiones no se persisten, así que cada reparación es una invocación nueva y pequeña: plantilla `shared/repair`, hechos mínimos de la tarea, la salida previa (hasta 32 000 caracteres) y los issues. Nunca reenvía el pack original. No repara `timeout`, `failed`, `policy-violation` ni `unavailable`.
- **Orden apto para la cache de prompt (DR41).** Prefijo estático primero (plantilla, schema, cabecera e ítems estáticos del pack) y datos variables al final, en orden determinista. Ningún prompt lleva `runId`, fechas, duraciones, ids aleatorios ni rutas absolutas.
- **Menos entrada.** Proyección por tarea y `PACK_LIMITS` (DR40): hasta 30 referencias por pack (`research analyze` procesa las primeras 30 pendientes y lista el resto para la siguiente corrida), 6 000 caracteres de texto externo por referencia, 20 insumos de marca y 20 consultas; HTML a texto antes de truncar; sin imágenes (DR37). Si el pack supera `contextBudgetChars` se recortan primero los ítems recortables. `direction propose` parte de los análisis guardados, no de fuentes crudas (DR44).
- **Menos contexto del agente (DR6).** Sin herramientas, MCP, `CLAUDE.md`, plugins, skills ni memoria en cada llamada (banderas arriba).
- **Salida corta.** Solo JSON del schema, con topes en arrays y strings (DR42).
- **Medir y avisar (DR45).** Cada invocación registra `AgentUsage` en el log local `.heron/logs/<fecha>.jsonl` (retención de 30 días). Semántica normalizada: **`inputTokens` es el total de entrada procesada, incluida la lectura y la escritura de cache; `cachedInputTokens` es el subconjunto leído de cache**; `outputTokens` y `costUsd` (con `costIsEstimate`) completan el registro. En Claude, `inputTokens` = `input_tokens` + `cache_creation_input_tokens` + `cache_read_input_tokens`. `status` muestra el total del día y `doctor` el check `agents.usage`. El **presupuesto blando `agents.warnTokensPerDay`** (entero >= 1 000, entrada más salida del día UTC, por workspace y no por cuenta) solo avisa con `AGENT_BUDGET_WARNING`: nada se bloquea.
- **`doctor --deep` es el único camino de `doctor` que gasta tokens**: además de la sonda base lanza la tarea `probe` por proveedor asignado (tope de salida de 500 tokens, `deepTimeoutMs` de 60 s). Sin `--deep`, `doctor` solo ejecuta `--version` y `auth status` (4 s cada uno) y no consume tokens.

## `doctor`

Sin `--deep`, por cada proveedor asignado a un rol: versión, capacidades (banderas en `--help`) y sesión (`auth status`, con stdout descartado; nunca lee `~/.claude`, `~/.codex` ni el llavero). Ausente, viejo o sin sesión es WARNING, un proveedor `fake` asignado también, y `agents` inválido es el WARNING `agents.config`. Con `--deep`, una falla pasa a FAIL de dependencia (exit 5).

## Pendiente de verificación manual

P3.A11 está registrado en §Términos, con la decisión del usuario del 2026-10-01 (`Aprobado` queda a su lectura de esta página). El recorrido de P3.A12 (Codex como `creator` con `agents.roles` intercambiado, `doctor --deep` y demás pasos de `specs/0003-agents-directions/design.md` §Testing strategy) lo ejecuta el usuario con `HERON_LIVE_AGENTS=1 bun run test:live` como paso previo. Este documento no los da por cerrados.

## Términos

Registro de lo que los términos oficiales dicen sobre el uso programático de los CLI con una suscripción (DR35 de `specs/0003-agents-directions/design.md`). Fecha de consulta de todas las fuentes: 2026-10-01. Las citas son textuales y cortas; lo que no se pudo leer se marca `[SIN VERIFICAR]` y no se infiere.

### Uso evaluado (DR35)

Heron lanza el binario oficial sin modificar (`claude -p`, `codex exec`) como proceso hijo, con la sesión de suscripción del propio operador (Claude Max, plan de ChatGPT), en su máquina y a demanda. Reenvía `CLAUDE_CODE_OAUTH_TOKEN` si el operador lo exportó. Nunca pasa API keys (`AGENT_API_KEY_VARS`) ni rutas de nube o gateway (`AGENT_ROUTE_VARS`) al hijo.

### Fuentes

#### Anthropic: Términos de consumo

- URL: https://www.anthropic.com/legal/consumer-terms
- Consultado: 2026-10-01 (HTTP 200)
- Cita: prohíbe "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise."
- Lectura: el acceso con script a la suscripción está prohibido salvo permiso explícito. La permisión explícita que existe es la de la fuente siguiente.

#### Anthropic: Legal y cumplimiento de Claude Code

- URL: https://code.claude.com/docs/en/legal-and-compliance
- Consultado: 2026-10-01 (HTTP 200)
- Cita: "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
- Cita: "Developers building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider."
- Cita: "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users."
- Cita: la restricción no impide que "an end user from signing in to the unmodified Claude Code binary with their own Claude subscription".
- Cita: "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."

#### Anthropic: Autenticación de Claude Code

- URL: https://code.claude.com/docs/en/authentication
- Consultado: 2026-10-01 (HTTP 200)
- Cita: "In non-interactive mode (-p), the key is always used when present." (se refiere a `ANTHROPIC_API_KEY`; por eso Heron no la pasa al hijo).
- Cita: `CLAUDE_CODE_OAUTH_TOKEN` es "A long-lived OAuth token generated by claude setup-token. Use this for CI pipelines and scripts where browser login isn't available." y "This token authenticates with your Claude subscription and requires a Pro, Max, Team, or Enterprise plan."

#### OpenAI: Codex, modo no interactivo

- URL: https://developers.openai.com/codex/noninteractive
- Consultado: 2026-10-01 (HTTP 200). La URL citada en el diseño, https://platform.openai.com/docs/codex/non-interactive-mode, responde HTTP 404 hoy.
- Cita: "API keys are the right default for automation because they are simpler to provision and rotate. Use this path only if you specifically need to run as your Codex account." (sobre la autenticación gestionada por ChatGPT en CI/CD).
- Cita: "Do not use this workflow for public or open-source repositories."
- Lectura: la doc de Codex describe `codex exec` con la cuenta de ChatGPT como un camino soportado pero "advanced"; no es una licencia general. La frase del diseño de que una API key "takes precedence" no aparece en esta página: queda `[SIN VERIFICAR]` en esta fuente.

#### OpenAI: Codex, autenticación

- URL: https://developers.openai.com/codex/auth
- Consultado: 2026-10-01 (HTTP 200)
- Cita: "Codex CLI Run codex login, then complete the browser flow. This is the default authentication path when no valid session is available."
- Cita: los access tokens de Codex son "intended for trusted scripts, schedulers, and private CI runners" y los crean miembros de un workspace Enterprise cuando un admin lo permite.
- Cita: "API keys are still the recommended default for automation."

#### OpenAI: Términos de uso

- URLs: https://openai.com/policies/terms-of-use/, https://openai.com/policies/row-terms-of-use/, https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- Consultado: 2026-10-01. HTTP 403 en las tres (re-intentado en T1, también con `User-Agent` de navegador). `[SIN VERIFICAR]` (2026-10-01): no se leyó su contenido y no se infiere.

#### Fuente no oficial (solo contexto, no evidencia)

- https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use (citada en el diseño; no se re-consultó en T1).

### Conclusión (DR35, para P3.A11)

- **Anthropic, binario oficial con la suscripción del propio operador: defendible, pero por lectura de la política y no por una cláusula que cubra la automatización.** Los términos de consumo prohíben el acceso por script salvo que Anthropic lo permita explícitamente. La página de Claude Code lo permite para el usuario final que inicia sesión en el binario sin modificar con su suscripción, y documenta `CLAUDE_CODE_OAUTH_TOKEN` para "CI pipelines and scripts". Aun así, ninguna página dice textualmente que `claude -p` lanzado desde una herramienta de terceros con Max esté permitido.
- **Anthropic, riesgo explícito:** a quienes construyen productos o servicios les pide API key, prohíbe enrutar solicitudes con credenciales Free/Pro/Max "on behalf of their users" y los límites de Max suponen "ordinary, individual usage". Heron es una herramienta local del propio operador (un usuario, su máquina, a demanda), pero un uso intensivo o en lote (los agentes de Heron no tienen tope duro, DR38) podría salir de "ordinary, individual usage". Heron no puede garantizar ese límite.
- **OpenAI, Codex con plan de ChatGPT: NO verificado.** Los términos de uso de OpenAI y su artículo de ayuda devolvieron 403. La documentación de Codex sí describe `codex exec` con la cuenta de ChatGPT, pero como camino "advanced" y con las API keys como "recommended default for automation"; no hay una cláusula que autorice o prohíba el uso de Heron. Decirlo permitido sería inferir.
- **Resultado:** los términos no permiten con claridad el uso de DR35 como una autorización textual. Para Claude es defendible con el binario oficial y la sesión del propio operador; para Codex está sin verificar. El usuario decide en P3.A11 si acepta ese riesgo. Si no, la alternativa es API key (descartada en DR35 por contradecir D18 y cobrar por token).

### Decisión (P3.A11)

El usuario leyó la conclusión anterior y el 2026-10-01 decidió mantener DR35 (suscripción con el binario oficial) y **aceptar el riesgo**. Los hallazgos no cambian: para Claude es una zona gris (sin cláusula explícita para la automatización) y para Codex los términos de OpenAI siguen sin verificar (403).

- **Alcance:** uso personal o individual, con el binario oficial sin modificar y la sesión de suscripción del propio operador, en su máquina y a demanda. No cubre uso multiusuario, hospedado ni revender o intermediar credenciales de suscripción.
- **Mitigaciones ya diseñadas:** economía de tokens (R19–R21, DR39–DR45); límite estructural de ≤ 3 invocaciones por comando y registro de tokens, costo estimado y duración, con un umbral diario configurable que avisa sin bloquear (DR38); y Codex no se usa por defecto, porque las tareas de P3 usan el rol `creator` y Codex solo se ejercita al intercambiar `agents.roles` (P3.A12) y en `doctor --deep` (DR26), a la espera de su rol de reviewer en P7.
- **Disparador de revisión:** volver a leer estos términos cuando las páginas de OpenAI sean accesibles y, en todo caso, antes de cualquier uso multiusuario u hospedado (por ejemplo, el self-host de P9).
