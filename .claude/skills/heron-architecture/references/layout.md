# Estructura de carpetas y dependencias

`[E]` existe hoy · `[Pn]` planeado en la parte n · `[pre-P2]` cambio previo a P2. Un módulo [Pn] no se crea antes de su parte.

```text
bin/heron.ts                                   [E] solo importa cli
src/core/contracts/   common canonical-json version index heron-project heron-state mode-decision cli-envelope [E]
                      research (Reference, Provenance, SecurityFinding, BrandInput) [P2] · directions agent-run [P3]
                      product-context (ProductContext, Conflict) [P4] · design decisions validation manifest [P5] · penpot [P12]
src/core/state/       transitions gates stale lifecycle mode [E] · revise [P7]
src/core/store/       fs-port paths hash atomic lock file-store [E] · append-log [P2] · temp-dir [P3] · export-writer [P5]
src/security/         redact logger ssrf untrusted html [P2] · env [P3] · fetch/ (Fetcher) images/ (sharp) [P2]
src/intake/           ports detect probe ux-contract adapters/{navori-master,filesystem}/ [E] · adapters/{markdown,manual}/ precedence conflicts [P4]
src/research/         ports registry provenance brand render/ adapters/{manual,url,image,design-md}/ [P2] · brief [P3] · adapters/penpot/ [P6] · adapters/refero/ [P10]
src/agents/           ports registry roles context-pack invoke prompts tasks/<task> adapters/{claude-code,codex-cli,fake}/ [P3] · review-loop [P7]
src/tokens/           dtcg resolver contrast color brand-variant parity [P5]
src/design/           foundations components patterns screens layout design-md preview-html copy [P5] · ux-proposal [P7]
src/validation/       registry categories coverage validators/<id> [P5]
src/export/           manifest layout (lista pura de archivos de dist/) [P5]
src/penpot/           ports compiler/{plan,script,ids,templates} adapters/mcp/ [P12] · sync/drift [P6]
src/app/              context result version init status doctor gate [E] · write-run [pre-P2] · config [P3] · <familia>.ts por grupo de órdenes [P2+]
src/cli/              main args io envelope render commands/ [E] · output (emitResult) [pre-P2] · commands/<grupo> con CommandSpec [P2]
src/web/              server auth/ middleware/{csp,csrf} routes/*.tsx views/*.tsx api/v1/ [P8] · islands/ (navegador) [P8]
prompts/<role>/<task>@v<n>.md [P3]     templates/penpot/<op>@v<n>.penpot.js [P12]     tsconfig.islands.json [P8]
schemas/<kind>.v<n>.schema.json [E]    fixtures/<product>/ [E] · conflict/ unsupported-versions/ [P4]
infra/docker/ [P9]   infra/penpot/ [P12]   scripts/ [E] · scripts/transpiler.ts [P8]
docs/ architecture.md adr/0001-state-persistence.md [E] · adr/0002-store-write-zones.md [P3]
tests/ unit/<module>/ e2e/ contracts/ security/ web/ infra/ repo/ perf/ helpers/ [E parcial] · assets/<module>/ y assets/p1-workspaces/ [pre-P2]
```

Verifica con `ls` qué existe antes de afirmarlo: esta lista se escribió el 2026-09-30.

## Reglas de ubicación

- **Puertos** en `src/<module>/ports.ts`; los puertos de servicio junto a su implementación real; todos agregados en `AppContext`.
- **Adapters** en `src/<module>/adapters/<id>/index.ts`, con `<id>` igual al valor del enum (se descarta `sources/<kind>/`).
- **Contratos persistidos o exportados** solo en `core/contracts/`; los tipos internos de un módulo se quedan en él.
- **Tests:** mandan las rutas de `specs/_master/01-heron/parts.json`; los unitarios nuevos van en `tests/unit/<module>/`; en P4, `tests/unit/ux-contract.test.ts` se mueve con `git mv` a `tests/contracts/`.
- **Fixtures:** solo repos de producto; insumos sueltos en `tests/assets/<module>/` o generados en el test.
- **ADRs:** `docs/adr/NNNN-<slug>.md` en orden de aceptación, sin renumerar; uno por cada parte que MASTER lo pida y por cada dependencia nueva (RNF-15).
- No se renombran archivos de P1 (las rutas de `parts.json` ganan).

## Dependencias (tabla completa)

`file-store`, `lock`, `atomic`, `append-log`, `temp-dir` y `export-writer` solo los importa `app`. Entre módulos de dominio: solo el `ports.ts` ajeno con `import type`.

| Módulo | Puede importar (internos) | Vendors y efectos permitidos |
|---|---|---|
| `core/contracts` | hermanos | `zod`, ningún otro bare |
| `core/state` | `core/contracts` | ningún bare, sin `Bun` |
| `core/store` | `core/contracts` | `node:fs`, `node:path`, `node:crypto`; `node:os` y `mkdtemp` solo en `temp-dir.ts` |
| `security` | `core/contracts` | `fetch/**`: `node:dns`/`node:net`/`node:tls`, `fetch(`; `images/**`: `sharp`; nunca fs |
| `intake` | `core/contracts`, `STORE_READ` (= `core/store/{fs-port,paths,hash}.ts`), `security`, `type` de `*/ports.ts` | `zod` |
| `research` | idem intake | `adapters/refero/**`: `@modelcontextprotocol/sdk` |
| `agents` | idem intake, `prompts/` | `adapters/**`: `Bun.spawn`/`node:child_process` |
| `tokens` | `core/contracts` | `@terrazzo/parser`, `colorjs.io` |
| `design`, `validation` | `core/contracts`, `tokens`, `type` de `*/ports.ts` | consumen `ProductContext`, nunca el `UxContract` interno |
| `export` | `core/contracts` | — |
| `penpot` | `core/contracts`, `STORE_READ`, `security`, `templates/penpot/` | `adapters/mcp/**`: `@modelcontextprotocol/sdk`; `compiler/**` sin vendors |
| `app` | todo `src/` salvo `cli`/`web`; `package.json` (solo `version.ts`) | `node:os`; `process.env` solo en `context.ts`/`config.ts` |
| `cli` | `app`, `core/contracts`; `commands/web.ts` → `web/server.ts` | `node:util`, `node:readline`; `process.env` solo en `main.ts` |
| `web` (servidor) | `app`, `core/contracts`, `security` | `hono`, `hono/*`; `node:crypto` solo en `web/auth/**` |
| `web/islands` | relativos dentro de `islands/` + `import type` de `core/contracts` | navegador: sin `node:*`, `Bun` ni vendors |
| `bin` / `scripts` | `cli` / `core/contracts` | `node:fs` solo en `FS_SCRIPTS` |

## Composición entre módulos sin romper la regla

```ts
// P6 — src/research/ports.ts
import type { PenpotSession } from "../penpot/ports.ts";   // solo tipo
export type CaptureServices = { fetcher: Fetcher; fs: ReadonlyFs; penpot: PenpotSession | null };
// src/app/references.ts abre connectPenpot(…) solo para kind "penpot", la pasa en services y llama close() en finally.
// P7 — src/design/ux-proposal.ts recibe AgentInvoker (type de agents/ports.ts);
// src/agents/review-loop.ts recibe validate: (output: unknown) => Finding[]; app inyecta los validadores. agents nunca importa validation.
```

## Valores de configuración derivados (para quien edite `navori.config.json`)

`architectureRule`, `criticalAreas`, `criticalPaths`, `codeLanguage: "ts"` y `branchBase: "develop"` salen de este rulebook; los edita quien posee ese archivo, no esta skill.
