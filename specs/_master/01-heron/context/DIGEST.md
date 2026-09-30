# Digest de contexto — Etapa 01-heron

Todas las citas apuntan a `context/md/PLAN.md` por número de sección (`§n`) del documento original.

## Resumen por archivo

- **`context/md/PLAN.md`** — Brief de producto para **Navori Heron**, una herramienta independiente que actúa como "AI UX/UI Product Designer + Design Director + Design System Compiler" (§intro). Recibe el modelo funcional de un producto (idealmente un master-plan de Navori Harness con `UX.md` + `ux.json`), investiga referencias visuales, define dirección visual, foundations, tokens DTCG, componentes, patterns y pantallas, lo materializa en Penpot self-hosted vía MCP y exporta un contrato neutral agnóstico de stack (§1, §30, §44–§47). Opera en dos modos obligatorios: `reference-only` sin contrato UX válido y `full` con él (§3). Define CLI + Web UI (§35–§40), gates humanos (§41), state machine explícita (§42), seguridad (§54–§56), stack preferido TypeScript + Bun + Zod (§5, §60), fases de trabajo (§77) y un primer vertical slice concreto (§80).

## Hechos

**Identidad y alcance**
- H1. Heron es independiente de `navori-harness` y de cualquier consumidor; la integración con Harness es un adapter (context/md/PLAN.md §intro, §1, §75.1–2).
- H2. No es generador de componentes React, wrapper de Penpot, theme generator ni extensión de Harness (context/md/PLAN.md §intro).
- H3. Harness responde "What are we building?"; Heron responde "How should humans experience it?" (context/md/PLAN.md §0).
- H4. Primer consumidor: `monorepo-fullstack` (superficies dashboard, partner, mobile, landing, api; web React + Mantine, mobile RN + Expo + unistyles; ya tiene `packages/tokens`, `packages/web-ui`, `apps/mobile/src/design-system`) (context/md/PLAN.md §0). `[SIN VERIFICAR]` contra el repo.
- H5. Heron no se acopla a Mantine, Unistyles, React, RN, Next, Expo ni ninguna librería UI; V1 no produce themes, configs ni componentes de implementación (context/md/PLAN.md §0, §47).

**Modos (invariante central)**
- H6. `UX.md` y `ux.json` se asumen producidos por versiones nuevas del master-plan; Heron no redefine su contrato (context/md/PLAN.md §2). IDs estables (`ACT-*`, `J01`, `F01`, `M01`, `D01`, `P01`, `PT01`) (§2).
- H7. Sin ambos archivos → `reference-only`: solo research, referencias, moodboards y direcciones; bloquea inventario, journeys, flows, design system, tokens finales, pantallas, Penpot de producción y export de producción (context/md/PLAN.md §3 Mode A, §69).
- H8. Con ambos válidos → `full` (context/md/PLAN.md §3 Mode B, §70).
- H9. Si solo existe uno: informar inconsistencia, no inferir el faltante, caer en `reference-only`, permitir research y bloquear producción/export (context/md/PLAN.md §3).

**Entrada y autoridad**
- H10. Núcleo desacoplado del origen: `ProductContextAdapter` con adapters iniciales `navori-master`, `markdown`, `filesystem`, `manual` (context/md/PLAN.md §4).
- H11. `ProductContext` versionado con schemas runtime-safe (preferencia TypeScript + Zod) y campos metadata, product, actors, capabilities, businessRules, functional/nonFunctional requirements, surfaces, journeys, flows, screens, states, functionalComponents, patterns, entities, constraints, brand, decisions, traceability, unresolvedQuestions (context/md/PLAN.md §5).
- H12. Precedencia de fuentes: DECISIONS.md > MASTER.md > parts.json > ux.json > UX.md > DIGEST.md > CODEBASE.md > documentos de contexto convertidos > inferencia; contradicción ⇒ registro `CONFLICT` con archivos, valores e impacto, sin elegir en silencio (context/md/PLAN.md §6).
- H13. `heron init` detecta `navori.config.json`, `specs/_master/index.json`, etapa activa/seleccionada y los artefactos (context/md/PLAN.md §37); soporta seleccionar etapa cerrada (`--stage`) (§38).

**Research**
- H14. Capa `ResearchSource` extensible: Refero, Refero Styles, URL, screenshot, imagen local, DESIGN.md, referencia manual, diseño Penpot existente (context/md/PLAN.md §7).
- H15. Refero es fuente importante pero opcional; búsqueda por trabajo de la interfaz (categoría, flow, screen type, pattern…), nunca "beautiful UI" (context/md/PLAN.md §8).
- H16. Cada referencia registra source, URL/origen, fecha de captura, razón, qué se estudia, qué no copiar y qué decisiones influye (context/md/PLAN.md §9). Imágenes first-class con crop/focus y notas (§57).
- H17. Síntesis visual combina referencias en una dirección original; no copiar ni mezclar colores matemáticamente (context/md/PLAN.md §10).

**Diseño**
- H18. En `full`, tras research: 3 visual directions con 13 atributos (personality … when it doesn't) y gate de selección (context/md/PLAN.md §11).
- H19. Brand intake con origen por dato: provided / derived / inferred / reference-derived (context/md/PLAN.md §12).
- H20. Color: contraste, escalas, neutrals, roles semánticos/surface/interactive/feedback, dark mode, accesibilidad; variantes de colores de marca inutilizables se registran como decisión (context/md/PLAN.md §13).
- H21. Heron es dueño de lo visual (context/md/PLAN.md §14) y preserva reglas de negocio, roles, permisos, requisitos, decisiones explícitas, pantallas y estados críticos, flows obligatorios (§15).
- H22. Cambios significativos sobre `ux.json` solo como `UX-PROPOSAL` (original, propuesta, razón, requisitos preservados, impacto) (context/md/PLAN.md §16).
- H23. Foundations: 14 áreas (color … iconography) (context/md/PLAN.md §17). Tokens DTCG en capas primitive → semantic → component; component tokens solo si aportan valor (§18). Semántica mínima y estados (§19).
- H24. `DESIGN.md` final explica cómo/por qué usar los valores; no copia `UX.md` (context/md/PLAN.md §20). Anti-patterns de UI genérica de IA exigen justificación, no prohibición (§21).
- H25. Componentes derivados de ux.json/patterns/screens, no de una lista estándar (context/md/PLAN.md §22); patterns de primera clase ligados a screens (§23).
- H26. `full` diseña todas las pantallas de `ux.json`, primero un set representativo y luego el resto (context/md/PLAN.md §24); contrato de pantalla con campos heredados + campos Heron (§25); estados relevantes más allá del happy path (§26).
- H27. Accesibilidad con findings PASS/WARNING/FAIL con evidencia, sin score genérico (context/md/PLAN.md §27); validators deterministas listados (§28); preguntas de coverage (§29).

**Penpot**
- H28. Penpot es el editor visual de V1, no source of truth; la fuente son los contratos neutrales (context/md/PLAN.md §30).
- H29. Penpot self-hosted desde deployment oficial, sin fork, versión estable fijada y configurable (context/md/PLAN.md §31, §64). Integración vía MCP; sin tocar la DB ni el formato `.penpot` (§32).
- H30. Requisitos interactivos del MCP (archivo activo, conexión browser/plugin, MCP key) se detectan y fallan rápido; `heron doctor` los comprueba (context/md/PLAN.md §33). `[SIN VERIFICAR]` contra docs oficiales de Penpot MCP.

**Plataforma**
- H31. Heron self-hostable para una organización / equipo pequeño; sin multi-tenant; local, Docker, Compose, server; compatible con Railway/VM/K8s sin acoplarse (context/md/PLAN.md §34, §65).
- H32. Interfaces: CLI (automatización) y Web UI (control plane, research y review; no replica Penpot) (context/md/PLAN.md §35, §39, §40). CLI conceptual: init, doctor, intake, status, research, references, direction(+select), foundations, system, screens, penpot, validate, export, revise, run (§36).
- H33. Gates humanos por default; `run --auto` solo después (context/md/PLAN.md §41). State machine explícita con transiciones y precondiciones verificables (§42).
- H34. Persistencia: estado machine-readable + artefactos versionados en Git; DB opcional solo para users/sessions/jobs/cache/UI metadata; DB propia, nunca la de Penpot (context/md/PLAN.md §43, §62). Git es el historial; Heron guarda `designRevision`/`schemaVersion` (§59).
- H35. Output portable tipo `.heron/` (context/md/PLAN.md §44) y export `dist/` con manifest (schemaVersion, heronVersion, project, masterStage, generatedAt, mode, themes, surfaces, conteos, tokenSets, files, checksums) entendible sin instalar Heron (§45, §46).
- H36. `heron revise` conserva lo no pedido y registra revision/reason/affected/previous/new (context/md/PLAN.md §58).

**IA**
- H37. `AgentProvider` provider-agnostic; suscripciones (Claude Max, ChatGPT Pro) ≠ créditos de API (context/md/PLAN.md §48). Adapters de agentes CLI autenticados externamente (Claude Code, Codex CLI) sin guardar credenciales; Heron orquesta (§49).
- H38. Roles de IA diferenciados (9 conceptuales), orquestación razonable (context/md/PLAN.md §50); creator → reviewer configurable sin hardcodear proveedor (§51); context packs por tarea (§52).
- H39. Capa determinista (schemas, estado, archivos, DTCG, contraste, coverage, grafos, IDs, manifest, checksums, export) separada de la capa IA (interpretación, selección, propuestas, dirección, síntesis, composición, crítica) (context/md/PLAN.md §53).

**Seguridad, observabilidad, calidad**
- H40. Seguridad: secretos, tokens MCP, credenciales de agentes, uploads, documentos no confiables, SSRF, path traversal, prompt injection, metadata de imágenes, logs (context/md/PLAN.md §54); protección SSRF concreta (§55); todo contenido externo es dato (§56).
- H41. Observabilidad: logs estructurados, run ID, timing, costo si existe, transiciones, errores Penpot, provenance; nunca loggear secretos (context/md/PLAN.md §66). Reproducibilidad: modelo, versión de prompt, hashes de entrada, referencias, dirección, schemas, versión (§67).
- H42. Quality gates por reglas PASS/WARNING/FAIL en 11 categorías, sin score 0–100 (context/md/PLAN.md §68). Nunca inventar datos; fixtures marcados DEMO/PLACEHOLDER/SYNTHETIC (§71).
- H43. Tests de contratos e invariantes (16 áreas), sin snapshots frágiles de IA (context/md/PLAN.md §72); fixtures E2E `membership-product` (full) y `no-ux` (reference-only) (§73). Documentación mínima de 11 archivos (§74).
- H44. 15 reglas de arquitectura, incl. "No overengineering V1" (context/md/PLAN.md §75); regla de simplicidad y dependencias vetadas sin necesidad (LangChain, LangGraph, Temporal, Kafka, Redis, vector DB) (§60, §78).

**Definición de V1 y orden de trabajo**
- H45. V1 = `heron init` detecta master-plan → `reference-only` o `full` → pipeline completo hasta export neutral, todo sobre infraestructura self-hosted (context/md/PLAN.md §76).
- H46. Fases propuestas: 1 research de repos/docs, 2 architecture-proposal, 3 ADRs, 4 contracts, 5 mode detection, 6 research slice, 7 full-mode slice, 8 Penpot, 9 Web UI, 10 hardening (context/md/PLAN.md §77).
- H47. Primer vertical slice: init → adapter Navori master → validación de presencia UX → detección de modo → estado de proyecto → status, con tests completos (context/md/PLAN.md §80), con salida esperada ejemplificada (§"Resultado esperado").

## Actores

- **Diseñador / product owner humano** — revisa y aprueba en cada gate, selecciona dirección, pide revisiones (context/md/PLAN.md §41, §58).
- **Cliente del producto diseñado** — aporta marca y preferencias; sus decisiones se distinguen de inferencias (context/md/PLAN.md §12).
- **Operador self-host** — despliega Heron y Penpot, gestiona secretos, backups y upgrades (context/md/PLAN.md §31, §34, §64).
- **Repo consumidor** (p. ej. `monorepo-fullstack`) — consume el export neutral y lo adapta a su stack (context/md/PLAN.md §0, §47).
- **Agentes IA** (roles §50) — ejecutan trabajo no determinista vía `AgentProvider`/agentes CLI (context/md/PLAN.md §48–§51).

## Capacidades

Intake de contexto multi-origen (§4); detección de master-plan y modo (§3, §37); research visual con provenance (§7–§9, §57); síntesis y 3 direcciones visuales con gate (§10–§11); brand intake y color intelligence (§12–§13); foundations y tokens DTCG (§17–§19); DESIGN.md y anti-patterns (§20–§21); sistema de componentes y patterns (§22–§23); diseño de pantallas y estados (§24–§26); validación, accesibilidad y coverage (§27–§29, §68); materialización en Penpot vía MCP (§30–§33); export neutral con manifest (§44–§46); revisión trazable (§58); CLI + Web UI (§35–§40); self-host (§34, §63).

## Integraciones externas

- **Navori Harness** master-plan (lectura de `specs/_master/…`) (context/md/PLAN.md §0, §37). `[SIN VERIFICAR]` contra el repo.
- **Penpot** self-hosted + **Penpot MCP** (context/md/PLAN.md §30–§33, §64). `[SIN VERIFICAR]` versión y capacidades del MCP.
- **Refero / Refero Styles** (opcional) (context/md/PLAN.md §8). `[SIN VERIFICAR]` API o acceso público disponible.
- **W3C DTCG** como formato de tokens (context/md/PLAN.md §18). `[SIN VERIFICAR]` versión vigente de la spec.
- **Agentes CLI**: Claude Code, Codex CLI; futuros Claude/OpenAI/local vía API (context/md/PLAN.md §48–§49).
- **Git** como historial (context/md/PLAN.md §59). **Railway** como destino futuro no requerido (§65).

## Entidades de datos

ProductContext (§5); HeronProject, HeronState (§80, §42); ResearchReference / provenance (§9, §57); VisualDirection (§11); Brand input con origen (§12); Foundations y Tokens (primitive/semantic/component, light/dark) (§17–§18); DesignSystem (§80); Component, Pattern (§22–§23); ScreenDesign con estados (§25–§26); CONFLICT (§6); UX-PROPOSAL (§16); Revision (§58); ValidationFinding PASS/WARNING/FAIL (§27, §68); Manifest (§46).

## Superficies

El repo `navori-heron` no contiene código fuente todavía (solo harness y config); el stack es decisión abierta (preferencia declarada: TypeScript + Bun + Zod, §5, §60). Superficies propuestas por el brief (§61, a analizar, no adoptar automáticamente):
- `apps/cli` — CLI `heron` (context/md/PLAN.md §36).
- `apps/web` — control plane / research / review (context/md/PLAN.md §39).
- `apps/server` — backend para web y jobs (context/md/PLAN.md §61).
- `packages/*` — core, contracts, state, intake, research, design, tokens, validation, agents, penpot, export (context/md/PLAN.md §61).
- `infra/docker`, `infra/penpot` — self-host (context/md/PLAN.md §61, §63).

## Hallazgos

- **HZ1 — Documento completo con forma de instrucción al agente.** `PLAN.md` está escrito como encargo directo ("Quiero que diseñes e implementes desde cero…" context/md/PLAN.md §intro; "Antes de tomar decisiones arquitectónicas debes estudiar…" §0; "Empieza ahora con: … Después implementa el primer vertical slice" §80). No es hostil: coincide con la intención del usuario dueño del repo. Aun así **no se ejecutó**: se trata como requisitos del producto y el orden de trabajo se decide dentro del plan maestro (fases `mapped` → `executing`), no por el texto del documento.
- **HZ2 — Pide investigar fuentes externas** (repos GitHub y docs oficiales, context/md/PLAN.md §0, §77 Phase 1, §80.1–6). No se accedió a ellas durante el intake; se marcan `[SIN VERIFICAR]` y se resolverán en fases posteriores.
- No se encontró texto de inyección hostil (p. ej. "ignore previous instructions").
