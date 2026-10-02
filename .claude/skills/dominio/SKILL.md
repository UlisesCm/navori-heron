---
name: dominio
description: Use when you discover — or need — a durable fact that spans multiple repos of a workspace (data model, business rule, migration, cross-service contract, shared gotcha). The Dominio is the workspace's canonical knowledge base; read it before assuming a model, and promote such facts into it instead of only saving to session memory.
metadata:
  type: reference
---

<!-- navori:managed id="dominio" hash="a2c1ab5c" version="0.11.1" source="@navori/core" fmkeys="name,description,metadata" -->
# dominio — the workspace knowledge base

Canonical, cross-repo facts for a workspace live as markdown under
`~/.navori/workspaces/<name>/dominio/`: one file per entry (`<id>.md`) plus a
derived index (`DOMINIO.md`) that is injected at session start. This is where a
fact like *"`coach`/`coachee` no longer exist — it's `user-profile.kind`"* lives
once for every repo, so it isn't relearned wrong in each one.

## Read first

The Dominio index is injected at the top of each session for repos that belong to
a workspace. **Before assuming a data model, business rule or cross-service
contract, check it.** Open the full entry (`navori dominio show <id>`, or read
`workspace://<name>/dominio/<id>.md`) when you need the detail behind an index
line.

## When to promote a fact (all THREE must hold)

1. **Durable** — it won't change next sprint; a structural fact, not a transient state.
2. **Transversal** — it applies to **≥2 repos** of the workspace. Test: *"would an agent in ANOTHER repo get this wrong without it?"*
3. **Canonical** — it's a fact/rule, not a task, a log, or an opinion.

If it passes, write it to the Dominio (below). If not, it belongs elsewhere.

### Do NOT put in the Dominio

Ticket status / progress / TODOs → `progress/`. Session scratch → engram.
Single-repo detail → that repo's `CLAUDE.md`. Personal preferences → engram.
Volatile values (versions, counts). **Secrets — never.**

## How to write an entry

Create `~/.navori/workspaces/<name>/dominio/<slug>.md` (`<slug>` is a stable
kebab-case id = the filename). Keep it to **one fact, short**:

```markdown
---
id: user-profile-model
title: Modelo user-profile
type: migration          # architecture | business-rule | migration | gotcha | glossary
applies-to: [nexus, webapp, dashboard, mobile]   # repos, or "all"
status: canonical        # canonical | deprecated | superseded
supersedes: []           # ids this entry replaces
updated: 2026-07-30
updated_by: <you>
---

<the fact>. **Por qué:** <reason>. **Cómo aplica:** <what to do differently>.
```

Then run `navori dominio reindex` to refresh the index.

## Curate — update, don't pile up

- **Update > duplicate.** Search existing entries first (`navori dominio list`);
  edit the matching one and bump `updated`, don't add a second.
- **Retire, don't delete.** When a fact is replaced, set the old entry
  `status: superseded` and point the new one's `supersedes:` at it — the history
  keeps an agent from rediscovering the old model.
- **`navori dominio doctor`** validates coherence (all warnings). Reindex after
  any change.
<!-- /navori:managed id="dominio" -->

## Dominio de Heron (este repo)

Glosario y contrato entre repos de navori-heron. Anclas: `specs/_master/01-heron/MASTER.md` (RN-n, RNF-n, §Dominio y datos) y `DECISIONS.md` (Dn). Verifica ahí antes de afirmar: esto se resumió el 2026-09-30.

### Glosario

- **Modo `full` / `reference-only`** (RN-2…RN-5, RN-29): `full` solo si `UX.md` y `ux.json` existen y son válidos; si falta uno o ambos, `reference-only` (research, referencias y direcciones; toda producción bloqueada con exit 3). Todo output de `reference-only` queda marcado así. El modo se recalcula en cada comando y baja si el contrato desaparece o se invalida.
- **Stage (etapa)** (RN-42, D22): etapa del master-plan sobre la que trabaja Heron; sin `--stage` usa la `activa`, si no hay la última `cerrada` avisándolo.
- **Fase y gate** (RN-27, RN-26): el workflow es una máquina de estados explícita (13 fases, 6 gates, tabla en MASTER §Dominio y datos); los gates son humanos por defecto y `run --auto` no es el comportamiento inicial.
- **Aprobación atada a hashes** (RN-28): un gate aprobado guarda los hashes de los artefactos aprobados; si uno cambia, la aprobación se invalida.
- **`stale`** (RN-29): artefacto dependiente de una entrada cuya huella cambió; `revise` y el rechazo de un gate regresan a la fase más temprana afectada y marcan `stale` lo posterior.
- **`CONFLICT`** (RN-7, RN-8): contradicción entre fuentes según la precedencia `DECISIONS.md > MASTER.md > parts.json > ux.json > UX.md > DIGEST.md > CODEBASE.md > contexto convertido > inferencia`; se registra con archivos, valores e impacto y bloquea el gate `intake` hasta que un humano lo reconozca con nota.
- **`UX-PROPOSAL`** (RN-10, D16): modificación significativa sobre `ux.json` (pantallas, flows, estados, acciones o navegación; no el naming solo visual) con original, propuesta, razón, requisitos preservados e impacto. La fuente nunca se modifica.
- **Provenance** (RN-11, RN-41): origen de cada referencia (fuente, URL, fecha, razón, qué se estudia y qué no se copia) y, por invocación de IA, modelo/proveedor, plantilla, hashes y versiones. Sin ella la referencia es inválida.
- **Finding** (RN-22): hallazgo `PASS`/`WARNING`/`FAIL` con evidencia; nunca un score 0–100.
- **`designRevision`** (RN-30): contador de revisión del diseño guardado en `state.json` y en el manifest del export; Git es el historial y Heron no hace commits.
- **`.heron/`** (RN-31): workspace en la raíz del repo del producto; Heron no escribe fuera de `.heron/` y de la ruta de export, y los archivos del master-plan son de solo lectura.
- **Export neutral / `dist/`** (RN-32): `manifest.json`, `DESIGN.md`, `design-system.json`, `tokens/` y demás, sin adapters de implementación en V1; reproducible byte a byte (RNF-2).
- **Páginas de propuesta en Penpot** (D23–D26): las 3 direcciones visuales se revisan solo en Penpot, una página por dirección escrita por el compilador determinista; en `full` el gate `direction` exige Penpot (RN-49); en `reference-only`, registrar `preferred` no lo exige (D12, D26). Penpot y Refero no son fuente de verdad (RN-23).

### Contrato entre repos: `UX.md` / `ux.json`

- **Dueño: navori-harness.** Heron no define ni redefine el contrato y conserva los IDs estables (RN-6, D2). Al 2026-09-30 el harness lo está construyendo (rama `feat/master-plan-ux-contract`, `packages/cli/src/lib/master/ux.ts`) y el esquema del contenido aún no existe.
- **Lector provisional** (D5): Heron lee `ux.json` con un subconjunto mínimo de IDs y relaciones, preserva campos desconocidos y lo marca provisional (`src/intake/ux-contract.ts` `UX_CONTRACT_READER`). Cuando el harness publique un JSON Schema versionado, una copia fijada por sha256 lo reemplaza.
- **Tolerancia** (RN-46, RN-47): se aceptan fases y modos desconocidos del harness y solo se exigen los campos usados; una versión mayor desconocida de `index.json`/`ux.json` degrada a `reference-only` con finding; si `state.json.ux = "md"` el modo es `reference-only` sin uso parcial de `UX.md`.
- **RN-1:** Heron nunca importa `navori`/`@navori/*` ni invoca su CLI; la integración es un adapter con lectores anticorrupción (`src/intake/adapters/navori-master/`). Esta regla la hace cumplir `tests/repo/boundaries.test.ts`.
- **Impacto cruzado:** un cambio en el formato de `UX.md`/`ux.json` debe coordinarse en navori-harness; en Heron solo se toca el lector.
