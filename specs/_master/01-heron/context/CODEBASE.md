# CODEBASE — navori-heron (etapa 01-heron, fase `transcribed`)

Fuentes base: `navori.config.json` y `CLAUDE.md` (raíz del repo). Verificaciones adicionales con `find`, `ls` y `git`, citadas en línea.

## Stack

- **No hay código fuente de producto.** `find . -path ./.git -prune -o -path '*/node_modules' -prune -o -type f \( -name '*.ts' -o -name '*.js' -o -name '*.py' -o -name 'package.json' -o -name 'bun.lock*' -o -name 'tsconfig.json' \) -print` devolvió 0 resultados. Los únicos archivos fuera de `.claude/`, `.codex/` y `.navori/` son: `.mcp.json`, `navori.config.json`, `.gitignore`, `CLAUDE.md`, `progress/{current,history}.md` y `specs/_master/**` (salida de `find`).
- **No existe manifiesto de runtime ni de paquetes** (sin `package.json`, `bun.lock*`, `tsconfig.json`; mismo `find`).
- `navori.config.json` declara: `project.codeLanguage: "unknown"` (línea 83), `project.posture: "greenfield"` (línea 75), `project.libraries: []` y `project.libraryMigrations: []` (líneas 81-82), `language: "es"` (línea 9).
- Engines del harness: `["claude"]` (`navori.config.json:5-7`). Plugins habilitados: `engram`, `gh`, `codegraph`, `jscpd`, `semgrep`, `tgrep` (`navori.config.json:48-67`). `.mcp.json` registra los servidores MCP `engram` y `codegraph`.
- **El stack del producto es una DECISIÓN ABIERTA.** El brief declara una *preferencia* (no un hecho adoptado) por TypeScript + Bun + Zod: `specs/_master/01-heron/context/DIGEST.md:7` (citando §5 y §60 de `context/md/PLAN.md`) y `DIGEST.md:105` ("el stack es decisión abierta (preferencia declarada: TypeScript + Bun + Zod)"). `codeLanguage` sigue en `unknown`, por lo que la preferencia aún no está reflejada en la config.

## Estructura

Árbol de primer nivel (`ls -A` en la raíz): `.claude`, `.codex`, `.git`, `.gitignore`, `.mcp.json`, `.navori`, `CLAUDE.md`, `navori.config.json`, `progress`, `specs`.

| Ruta | Tipo | Qué es (fuente) |
|------|------|-----------------|
| `.claude/` | harness | `agents/`, `context/`, `hooks/`, `scripts/`, `skills/`, `settings.json`, `.gitignore` (`ls -A .claude`) |
| `.codex/` | harness | Solo contiene `.gitignore` (`ls -A .codex`); `engines` no incluye `codex` (`navori.config.json:5-7`) |
| `.navori/` | harness | `state/` y `.gitignore` (`ls -A .navori`) |
| `.mcp.json` | harness | Servidores MCP `engram` y `codegraph` |
| `CLAUDE.md`, `navori.config.json` | harness | Instrucciones y configuración del harness |
| `progress/` | harness | `current.md` (15 líneas, estado `idle`, plantilla sin tarea) y `history.md` (11 líneas) (`wc -l`, `progress/current.md:3`) |
| `specs/_master/` | harness (specs) | `INDEX.md`, `index.json` y la etapa `01-heron/` (`context/`, `plans/` vacío, `state.json`) |
| Código de producto | — | **No existe** (ver Stack) |

- **Git:** `git log` responde `fatal: your current branch 'main' does not have any commits yet`; `git status` muestra `On branch main` / `No commits yet` con todo sin trackear. No hay historia de commits.
- **`.gitignore` raíz:** contiene una sola entrada, `progress/` (salida de `cat .gitignore`).
- **[SIN VERIFICAR] / placeholders a corregir más adelante (no se edita la config aquí):**
  - `project.criticalAreas` = `["ej: src/auth", "src/billing"]` (`navori.config.json:70-73`). Las rutas `src/auth` y `src/billing` no existen (no hay `src/`) y el primer valor conserva el prefijo "ej:". No corresponden a este proyecto.
  - `project.architectureRule` = `"ej: axios → service → adapter → component; forms = mantine + zod"` (`navori.config.json:77`). Es texto de ejemplo; menciona axios/mantine, sin relación verificada con el brief.
  - Ambos valores se propagan a `CLAUDE.md` (sección "Contexto del proyecto", líneas 157-158), donde el reviewer marcaría como HIGH cualquier desviación de esa regla. Mientras sean placeholders, esa regla no es aplicable.
  - `project.criticalPaths: []`, `legacyPaths: []`, `testsExclude: []`, `localSkills: []` están vacíos (`navori.config.json:69,74,79,80`).

## Convenciones

Impuestas por `CLAUDE.md` y `navori.config.json`; aplican al código futuro:

- **Idioma:** código, identificadores y comentarios (JSDoc/docstrings) en inglés; chat en español MX; docs y copy de UI siguen el idioma del proyecto, `es` (`CLAUDE.md:4,7`; `navori.config.json:9`).
- **Tipado fuerte:** `any` prohibido; usar `unknown` + narrowing; tipar explícitamente parámetros, retornos, callbacks, eventos, props, hooks y respuestas de servicios. Excepción solo con `// any justified: <reason>` (`CLAUDE.md:34-38`).
- **SDD:** se propone spec para features completos, cambios de auth/seguridad/permisos, datos sensibles o alcance > ~2 días. Estructura `specs/<feature>/{requirements.md, design.md, tasks.md}`, requisitos EARS `R<n>`, cada `R<n>` cubierto por ≥1 test con `// Covers: R<n>`. Es opt-in (`CLAUDE.md:59-67`).
- **Commits:** `conventional-es` (`navori.config.json:12`); atómicos, sin rastro de IA (`Co-Authored-By`, "Generated with…") (`CLAUDE.md:30`).
- **Branching:** `branchBase: "main"` (`navori.config.json:10`). Hoy `main` no tiene commits (ver Estructura).
- **Harness versionado:** `gitignoreHarness: "off"` (`navori.config.json:11`), es decir, `.claude/`, `CLAUDE.md` y `navori.config.json` se versionan. Nota: el `.gitignore` raíz excluye `progress/`, por lo que `progress/` no se versiona.
- **Tests:** `testsForNewCode: "when-applicable"` y `reviewRigor: "pragmatic"` (`navori.config.json:76,78`); `CLAUDE.md:159-160`: exigidos para lógica no trivial, opcionales para código simple. El reviewer bloquea solo issues ≥80 (`CLAUDE.md:156`).
- **Operaciones seguras:** DB/infra en solo lectura por defecto; comandos destructivos requieren confirmación del usuario (`CLAUDE.md:41-55`).
- **Quality gate: NO configurado.** `grep -n -i 'gate\|scripts\|lint' navori.config.json` no devolvió coincidencias, y no hay manifiesto con scripts de lint/test/typecheck. `CLAUDE.md:155` exige que "el quality gate igual debe pasar" en greenfield, pero no define qué comandos lo componen. Queda por definir junto con la decisión de stack.
- **Modo de auditoría:** `audit.mode: "opt-in"` (`navori.config.json:13-15`).

## Specs

- Bajo `specs/` solo existe `specs/_master/` (`ls -R specs`), con `INDEX.md`, `index.json` y la etapa `01-heron/`.
- `specs/_master/01-heron/`: `state.json` (`phase: "transcribed"`, `mode: "template"`, historial `context` → `transcribed`, ambos con fecha 2026-09-30), `context/` (`DIGEST.md`, `INTAKE.md`, `md/PLAN.md`, `raw/PLAN.md`, `raw/.gitignore`) y `plans/` (vacío).
- No existen specs de feature (`requirements.md` / `design.md` / `tasks.md`) en este repo; solo el master-plan en preparación. Fuente: `find` sobre el repo, sin archivos con esos nombres.
- `progress/current.md`: estado `idle`, con plantilla sin completar (`progress/current.md:3-5`); `progress/history.md`: 11 líneas (no se detalló su contenido).
- El brief fuente es `context/md/PLAN.md` (Navori Heron: AI UX/UI Product Designer + Design System Compiler), resumido en `context/DIGEST.md:7`.
