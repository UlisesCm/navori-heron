# ADR 0005: Frontera de proveedores de IA

- Estado: aceptada
- Fecha: 2026-10-01
- Referencias: `specs/0003-agents-directions/design.md` (DR5 a DR7, DR13, DR14, DR35 a DR45); `docs/agent-providers.md`; [ADR 0002](0002-store-write-zones.md); [ADR 0003](0003-research-source-boundary.md); D18

## Contexto

P3 hace que Heron use Claude Code y Codex CLI para el brief, el análisis de referencias y las tres direcciones visuales. Esos CLI son procesos externos con herramientas, sesión y configuración propias, y reciben texto de terceros (referencias, páginas, DESIGN.md) dentro del prompt. Lo que devuelven es dato no confiable hasta que se valida. Además corren con la suscripción del operador (DR35), así que cada llamada cuesta tokens de una cuota personal.

Hace falta una frontera que permita cambiar o añadir proveedores sin tocar los casos de uso, que mantenga a los agentes sin capacidad de actuar sobre el repo y que gaste pocos tokens.

## Decisión

1. **Un puerto, `AgentProvider`** (`src/agents/ports.ts`), con registro único en `src/agents/registry.ts`, que es el único importador de `src/agents/adapters/**` (`claude-code`, `codex-cli`, `fake`). Los casos de uso piden una tarea (`AGENT_TASKS`) y reciben un resultado tipado; no conocen argv, dialectos ni formatos de evento.
2. **Un solo sitio de spawn.** `bunProcessRunner` (`src/agents/process/bun-runner.ts`) es la única implementación de `ProcessRunner` y el único archivo con `Bun.spawn`, `Bun.which` y manejo de señales. Lanza en un grupo de procesos propio, con timeout, `SIGTERM` y `SIGKILL` tras un plazo, y cancela los lectores de salida.
3. **El agente no puede actuar.** Cada invocación lleva banderas de aislamiento fijas (`CLAUDE_FIXED_ARGS`, `CODEX_FIXED_ARGS`): sin herramientas, sin MCP, sin sesión persistente, sin configuración de usuario; Codex en sandbox `read-only`. El cwd es un directorio temporal vacío (`TempDirPort`). Codex además pasa por un monitor de eventos por lista blanca (`CODEX_ALLOWED_ITEM_TYPES`) que falla cerrado. Las banderas literales están en `docs/agent-providers.md`.
4. **Entorno por lista blanca** (`AGENT_ENV_ALLOWLIST`): el hijo no hereda el entorno del padre; las API keys y las rutas de nube o gateway no pasan, y `CLAUDE_CODE_OAUTH_TOKEN` pasa y se redacta.
5. **La salida es dato.** Solo JSON del schema, validado con Zod y con validadores de dominio; el redactor por valor corre antes de escribir y el escáner de texto no confiable solo registra hallazgos. Un run exitoso se guarda como `AgentRun`; un run fallido solo deja logs.
6. **Autenticación por suscripción con el binario oficial** (DR35), sin API key. Los términos se registran con fuentes y fecha en `docs/agent-providers.md` §Términos; el usuario aceptó el riesgo el 2026-10-01 (P3.A11) para uso individual.
7. **Economía de tokens como parte de la frontera** (DR39 a DR45): cache de resultados por clave de entrada, reparación compacta, prefijo estable, proyección y topes del pack (`PACK_LIMITS`), uso normalizado y presupuesto blando `agents.warnTokensPerDay`.
8. **Los tests nunca lanzan agentes reales.** El contexto de pruebas inyecta un runner que rechaza y el proveedor `fake`; la sonda viva (`tests/live/agents.live.ts`) queda fuera de `bun test` y de `bun run check`.

## Alternativas consideradas

- **API directa de Anthropic u OpenAI con API key.** Contradice D18 y cobra por token; descartada por el usuario (DR35). Sigue disponible como camino de salida si los términos cambian.
- **Agent SDK dentro del proceso.** Habilita herramientas y exige API key para productos de terceros; no encaja con DR35.
- **Heredar el entorno completo del padre.** Más simple, pero filtraría API keys, tokens de otros servicios y `HERON_*` al hijo, y haría que `ANTHROPIC_API_KEY` cambiara de cuenta en silencio. Descartada.
- **Tope duro de costo.** El usuario pidió no bloquear; el límite es estructural (3 invocaciones por comando) más un aviso diario (DR38).
- **Reparar continuando la conversación.** Las sesiones no se persisten por seguridad, así que cada reparación es una invocación nueva y compacta (DR43).

## Consecuencias

- Añadir un proveedor es un adapter más, una línea en el registro y su fila en la sonda; hereda runner, entorno, validación y telemetría.
- Cada actualización de Claude Code o Codex puede cambiar banderas o dialectos. `doctor` sondea las capacidades en `--help` y la sonda viva detecta divergencias: el 2026-10-01 corrigió el dialecto de Claude a draft-7 sin `$schema` (claude 2.1.287).
- La separación entre plantilla y datos es más débil en Codex (la plantilla va en stdin a nivel de usuario); lo compensan el sandbox y el monitor.
- Un descendiente que cree otra sesión escapa a `kill(-pid)`. En Claude no existen (sin herramientas); en Codex los contiene el sandbox sin red.
- La suscripción puede tener límites de uso ordinario. Heron no los controla; registra tokens y avisa, y el uso multiusuario u hospedado exige releer los términos (P9).
