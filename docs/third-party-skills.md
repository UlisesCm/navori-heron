# Skills de terceros (vendored)

Fecha de vendoring de todas: 2026-09-30. Contenido upstream byte a byte, salvo la modificación local indicada.
Las skills marcadas con `disable-model-invocation: true` solo corren si se invocan por nombre explícito (asumen Penpot MCP / cuenta Refero / Playwright vivos) mientras se construye Heron.

## Penpot AI Kit (6 skills)

- Repo: https://github.com/penpot/penpot-ai-kit — commit `efbefc935ee43804502976aa5ec9659a8bb7e207`
- Licencia: CC-BY-4.0 (SPDX `CC-BY-4.0`) — texto: https://github.com/penpot/penpot-ai-kit/blob/efbefc935ee43804502976aa5ec9659a8bb7e207/LICENSE (copia local en `../.claude/skills/<skill>/LICENSE`)
- Skills y ruta upstream: `penpot-foundations`, `penpot-component-factory`, `penpot-audit-tokens`, `penpot-audit-accessibility`, `penpot-design-md`, `penpot-build-screen` → `skills/<nombre>/`
- Layout self-contained (réplica de `buildSelfContainedSkills` en `scripts/install/lib.mjs`, usado por `install-behavior.mjs` para Claude Code, sin reescritura de rutas): cada skill incluye su carpeta upstream (`SKILL.md`, `references/`, `scripts/`) + copia de `shared/` y `policies/` del kit dentro de `<skill>/shared/` y `<skill>/policies/`. (`workflows/` solo aplica a `penpot-router`, que no se vendoriza.)
- Modificación local: `disable-model-invocation: false` → `true` en el `SKILL.md` de las 6 (línea 4). Añadido `LICENSE` (copia del upstream) en cada directorio.
- Nota: los SKILL.md referencian `AGENTS.md`, `docs/` y `prompts/` del kit, que no se vendorizan (referencias colgantes, inocuas).
- Atribución (CC-BY-4.0): "Penpot AI Kit", https://github.com/penpot/penpot-ai-kit, © sus autores (Penpot), licenciado bajo Creative Commons Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/). Se incluye copia del texto de la licencia. Los archivos se redistribuyen con un único cambio: el valor de `disable-model-invocation` en el frontmatter.
- Actualizar: descargar el tarball en el nuevo SHA (`gh api repos/penpot/penpot-ai-kit/tarball/<sha>`), volver a copiar `skills/<nombre>/`, `shared/` y `policies/` en cada skill, re-aplicar `disable-model-invocation: true` y actualizar el SHA aquí.

## Anthropic skills (2 skills)

- Repo: https://github.com/anthropics/skills — commit `8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4`
- Licencia: Apache-2.0 (SPDX `Apache-2.0`) — texto en `../.claude/skills/<skill>/LICENSE.txt` (https://github.com/anthropics/skills/blob/8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4/skills/frontend-design/LICENSE.txt)
- `frontend-design` ← `skills/frontend-design/`. Sin modificaciones (queda invocable por el modelo).
- `webapp-testing` ← `skills/webapp-testing/` (incluye `examples/`, `scripts/`). Modificación: añadido `disable-model-invocation: true` al frontmatter (línea 5).
- Actualizar: re-descargar el directorio en el nuevo SHA y re-aplicar la modificación de `webapp-testing`.

## Refero

- Repo: https://github.com/referodesign/refero_skill — commit `a9b54a3e62a6391f5f5ab7a20e4ddb32fb79a27d` (VERSION 1.0.2)
- Licencia: MIT (SPDX `MIT`) — https://github.com/referodesign/refero_skill/blob/a9b54a3e62a6391f5f5ab7a20e4ddb32fb79a27d/LICENSE (copia en `../.claude/skills/refero-design/LICENSE`)
- `refero-design` ← `skills/refero-design/` (`SKILL.md`, `references/`, `agents/`).
- Modificación local: añadido `disable-model-invocation: true` al frontmatter (línea 4). Añadido `LICENSE` del repo.
- Actualizar: re-descargar en el nuevo SHA, copiar `skills/refero-design/` + `LICENSE` y re-aplicar la modificación.
