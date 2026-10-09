# Heron Web Engine — Requisitos

## Estado y autoridad

Plan nuevo solicitado por el usuario para sustituir el rumbo CLI-first por una aplicación web conectada a GitHub. Esta spec describe el objetivo; no afirma que ya esté implementado ni modifica el estado generado de la etapa `01-heron`.

La implementación comienza por E1. Las decisiones de arquitectura de esta spec deben incorporarse a las reglas activas antes de mover código. El master anterior y sus evidencias se conservan como historia; ninguna parte pendiente se declara entregada por esta transición.

## Punto de partida

- Análisis inicial: `main`, `c3c4630`, con P1 implementada.
- Base de publicación del plan: `develop`, `2c55af6`, después de `git fetch origin develop main`. Incluye research, agentes, ProductContext, Penpot y specs `0002`–`0005`; el PR conserva esos módulos y dependencias. E1 debe evaluarlos antes de reconstruir o retirar código.
- `navori doctor` pasó durante el análisis inicial. Al preparar el PR se instalaron dependencias locales y pasó el nuevo gate sobre la base develop: format, lint, typecheck, jscpd y ast-grep. Esto no equivale a aceptar funcionalmente todo el código heredado.
- Fuentes: conversación de rediseño; `docs/architecture.md`; `docs/adr/0001-state-persistence.md`; `specs/_master/01-heron/MASTER.md`; código actual de `src/app`, `src/core` y `src/intake`.

## Producto

Un operador conecta GitHub, selecciona un repositorio y rama, revisa el contexto extraído, aporta marca y referencias, aprueba una dirección visual y obtiene un design system neutral. Todo el recorrido ocurre en el navegador, sin instalar ni operar una CLI de Heron.

Alcance inicial: aplicación autohospedable de una organización, sin SaaS multi-tenant. GitHub sólo lectura y descarga de resultados en V1. Publicar PRs y sincronizar Penpot son extensiones posteriores, no requisitos para completar el recorrido.

## Requisitos EARS

- **R1** — ANTES de sustituir módulos existentes, el proyecto DEBERÁ registrar por módulo y spec si se conserva, adapta o retira, con referencia al commit de origen y prueba de regresión asociada; ninguna limpieza borrará historia ni datos de producto.
- **R2** — CUANDO un operador autorizado utilice la aplicación, el sistema DEBERÁ permitir completar conexión, análisis, revisión, generación y descarga desde el navegador, sin comandos de terminal.
- **R3** — CUANDO el operador conecte una GitHub App, el sistema DEBERÁ limitar el acceso a instalaciones y repositorios autorizados, mantener credenciales exclusivamente en servidor y rechazar sesiones no autorizadas, CSRF y retornos OAuth inválidos.
- **R4** — CUANDO se seleccione una rama, el sistema DEBERÁ resolver un commit SHA y asociar todos los archivos y resultados de ese análisis a ese SHA; mover la rama no alterará un análisis existente.
- **R5** — CUANDO se ingiera un repositorio, el sistema DEBERÁ mostrar un inventario seleccionable de fuentes relevantes con ruta, hash, motivo y exclusiones, sin ejecutar código, instalar dependencias ni seguir symlinks o submódulos.
- **R6** — CUANDO falte un contrato UX, el sistema DEBERÁ permitir construir y corregir un borrador de contexto con procedencia y distinción entre información extraída, aportada e inferida; los conflictos y campos obligatorios pendientes bloquearán su aprobación.
- **R7** — CUANDO se apruebe contexto o dirección, el sistema DEBERÁ registrar actor, revisión y hashes; un cambio de las entradas vinculadas invalidará la aprobación y bloqueará resultados finales hasta una nueva aprobación.
- **R8** — CUANDO se solicite generación, el sistema DEBERÁ crear un trabajo durable con progreso, cancelación y resultado observable; una entrega duplicada o un worker reiniciado no publicará dos revisiones del mismo trabajo.
- **R9** — CUANDO se invoque un proveedor IA, el sistema DEBERÁ enviar sólo fuentes seleccionadas dentro del presupuesto, tratar su contenido como datos no confiables y validar la respuesta contra un contrato; ni el proveedor ni su respuesta tendrán capacidad para aprobar, ejecutar código o escribir en GitHub.
- **R10** — CUANDO el contexto esté aprobado, el sistema DEBERÁ producir tres propuestas visuales revisables en la web y exigir selección humana antes de generar el design system final; Penpot no será precondición.
- **R11** — CUANDO se genere un sistema, el sistema DEBERÁ producir tokens DTCG, documentación `DESIGN.md`, catálogo neutral de componentes y un reporte de validación con evidencia; un FAIL bloqueará la descarga final.
- **R12** — CUANDO se descargue una revisión aprobada, el sistema DEBERÁ entregar un paquete con manifest, schemas, provenance y hashes verificables, reproducible byte a byte para los mismos artefactos y fecha de export fijada.
- **R13** — SI una operación falla o compite con otra revisión, el sistema DEBERÁ conservar la última revisión publicada completa, rechazar commits obsoletos y no exponer artefactos parciales como resultados aprobados.
- **R14** — CUANDO se revoque GitHub o elimine un proyecto con confirmación, el sistema DEBERÁ impedir nuevas lecturas y retirar los datos y credenciales que le correspondan, informando la política de backups; ningún secreto canario aparecerá en logs, prompts, export ni respuestas web.
- **R15** — ANTES de cerrar V1, el proyecto DEBERÁ medir latencia y memoria del compilador TS sobre el corpus representativo y registrar una decisión de conservar TS o investigar un hotspot; SI posteriormente se propone Rust, su adopción DEBERÁ exigir paridad de corpus y beneficio total medido incluyendo IPC y distribución.

## Criterios de operación

- GitHub: máximo 5 MiB por archivo textual, 50 MiB de texto total seleccionado y 2,000 archivos por análisis; al excederse se informa el límite y se pide reducir selección, sin truncamiento silencioso.
- Peticiones externas: timeout de 30 s; proveedor IA: 600 s por intento, máximo dos reparaciones de salida. Un retry de proveedor puede tener costo aunque no publique una revisión duplicada.
- Context pack: máximo 120,000 caracteres; el usuario ve exclusiones antes de generar.
- Worker: lease de 30 s, heartbeat cada 10 s; cancelación observada en un máximo de 5 s durante ejecución normal. Credenciales nunca incluidas en el payload durable del trabajo.
- API de consulta: p95 ≤ 300 ms con 100 proyectos y 10 solicitudes concurrentes en el entorno documentado de benchmark, excluyendo llamadas a GitHub/IA.
- Accesibilidad: recorrido principal usable por teclado, controles etiquetados y sin fallos serios/críticos del analizador automatizado; revisión manual de foco y errores.
- Seguridad de ingesta: excluir `.env*`, claves privadas, credenciales conocidas, binarios y directorios generados por defecto; no prometer que los detectores identifican todo secreto. El operador confirma las fuentes que se enviarán al proveedor.

## Fuera de V1

SaaS multi-tenant, CLI pública nueva, ejecución del repo, agentes autenticados por sesiones de escritorio, PR automático, scraping arbitrario, ediciones bidireccionales de Penpot, generación de React/Vue, migración destructiva de `.heron/` y reescritura general en Rust.
