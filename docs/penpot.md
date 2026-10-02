# Penpot (P12)

Heron dibuja y lee las propuestas visuales en un Penpot **autoalojado** a través del servidor MCP oficial de Penpot. Esta guía cubre la infraestructura de `infra/penpot/`, las cuentas, la conexión MCP y las órdenes de Heron. Decisiones y justificación: [ADR 0007](adr/0007-penpot-boundary.md) y `specs/0005-penpot-base/design.md`.

## Requisitos

- **Docker Engine con el plugin Compose v2.** Versión soportada: la probada, **Docker 29.4.0 con Compose 5.1.2** (2026-10-01). El override usa `!override`, cuya versión mínima no se afirma: con cualquier otra versión corre `HERON_LIVE_COMPOSE=1 bun run test:live:compose` (necesita Docker, no la red). Podman y Compose v1 no se probaron.
- **Navegador: Chrome o Edge estables** (Chromium). Su ajuste por sitio mantiene activa la pestaña en segundo plano, que el MCP necesita; Firefox y Safari no lo tienen y no se prueban en P12 (<https://help.penpot.app/mcp/>). Con el default `http://localhost:9001` y las cookies seguras activas, el login depende de que el navegador acepte cookies `Secure` en `localhost`; para otros navegadores u hosts remotos usa HTTPS con proxy (ver HTTPS y websocket).
- Bun 1.4.2 para Heron. Docker no hace falta para `bun run check`.

## Instalación

Todo se opera con los scripts de `infra/penpot/` (POSIX sh) desde la raíz del repo:

```sh
infra/penpot/init-env           # crea infra/penpot/.env una vez, modo 0600, con secretos aleatorios
infra/penpot/compose up -d      # arranca Penpot (proyecto Compose "penpot")
infra/penpot/compose ps
```

- `init-env` copia `.env.example` y genera `PENPOT_SECRET_KEY` y `PENPOT_DB_PASSWORD` con `openssl rand -hex`. Si `.env` ya existe sale con 1 sin tocarlo. `PENPOT_ENV_FILE` cambia la ruta.
- `infra/penpot/compose <args>` es `docker compose -p penpot --env-file .env -f docker-compose.yaml -f compose.override.yaml <args>`, precedido de guardas: sale con 2 sin llamar a Docker si `.env` falta, tiene bits de grupo u otros, o si `PENPOT_EXTRA_FLAGS` (del shell o de `.env`) contiene `disable-secure-session-cookies` o `disable-email-verification`. `infra/penpot/compose --check` solo valida.
- **Llamar `docker compose` directo se salta esas guardas.** Úsalo solo con `-f` de ambos archivos y sabiendo lo que haces.
- `docker-compose.yaml` es la copia byte a byte del compose oficial del tag fijado (sha256 en `docker-compose.yaml.sha256`); **no se edita**. Todo ajuste va en `compose.override.yaml`, que quita los defaults inseguros del oficial: `PENPOT_VERSION` sin respaldo (el oficial cae a 2.16), la clave `change-this-insecure-key`, la contraseña de base `penpot`, `disable-email-verification`, `disable-secure-session-cookies`, `penpot-mailcatch` activo con `latest` y publicado, el frontend en `0.0.0.0` y la telemetría activa.
- Las imágenes `postgres:15` y `valkey/valkey:8.1` quedan como las fija el compose oficial (mayor o menor fijada, no `latest`): fijar parche o digest divergiría del compose oficial que se quiere seguir sin editar.
- Por default Penpot escucha solo en `127.0.0.1:9001` (`PENPOT_BIND_ADDRESS`, `PENPOT_HTTP_PORT`).

### Persistencia y volúmenes

Los datos viven en los volúmenes `penpot_postgres_v15` (base) y `penpot_assets` (archivos subidos), con prefijo del proyecto (`penpot_penpot_postgres_v15`, `penpot_penpot_assets`). `compose down` los conserva; `compose down -v` los **borra**.

## Cuentas

El registro está cerrado (`disable-registration`). Los perfiles se crean desde la línea de comandos, que con el registro desactivado es la vía oficial:

```sh
infra/penpot/compose exec penpot-backend python3 manage.py create-profile
```

La verificación de email sigue activa (default de 2.17.2). El spike S2 confirma que un perfil creado así entra sin verificar email; si no, la decisión de cuentas se reabre (DR35). Para invitar a alguien sin cuenta, créale primero el perfil. SMTP es opcional: `PENPOT_EXTRA_FLAGS=enable-smtp` más `PENPOT_SMTP_*` en `.env`; sin ellos Penpot no envía correo.

## HTTPS y websocket

Para otro host u otro navegador que el de `localhost`, pon Penpot detrás de un reverse proxy con TLS y fija `PENPOT_PUBLIC_URI` (en `.env`) a la URL pública exacta, p. ej. `https://penpot.example.com`; Heron usa ese mismo valor como `PENPOT_URL`. El proxy debe reenviar al frontend de Penpot (`PENPOT_BIND_ADDRESS`/`PENPOT_HTTP_PORT`) incluyendo el **websocket** (cabeceras `Upgrade` y `Connection`) en `/ws/` y en **`/mcp/ws`** (el plugin integrado se conecta ahí), y aceptar cuerpos de hasta 256 KiB en `/mcp/stream` (S7). El proxy TLS concreto queda fuera de P12. No reactives `disable-secure-session-cookies`.

## MCP

1. En Penpot, abre un archivo y activa la integración MCP en el perfil (**Integrations**, "MCP Server") y genera la **key**. Se muestra una sola vez y no es recuperable: guárdala fuera de todo repo.
2. En el archivo, conecta el plugin integrado ("Remote MCP"): **Main menu → MCP Server → Connect** (la etiqueta exacta se confirma en S1).
3. El MCP está activo en **una sola pestaña** a la vez; mantén esa pestaña en primer plano o aplica el ajuste de pestaña activa de Chrome/Edge para el sitio.
4. Heron habla con `<PENPOT_URL>/mcp/stream?userToken=<key>` a través del frontend; el contenedor `penpot-mcp` no publica puertos. La página de Integrations entrega la URL **con la key incluida**: no la pegues como `PENPOT_URL`, Heron la rechaza.
5. `sync` cambia la página activa de la vista (`openPage`): no edites el archivo mientras corre (DR29).

## Configuración de Heron

Dos variables, **solo en el shell** (o un gestor de secretos), nunca en un archivo del repo:

```sh
export PENPOT_URL=http://localhost:9001                         # mismo valor que PENPOT_PUBLIC_URI
export PENPOT_MCP_KEY_FILE=~/.config/heron/penpot-mcp-key        # archivo 0600 fuera de todo repo
# o bien PENPOT_MCP_KEY=<key>; definir ambas es un error de uso
```

Heron **no lee `.env`** (DR43). Desde el PR #16 ya integrado (T14, el lanzador), `bun run heron` y el ejecutable `heron` corren con `--no-env-file --config=/dev/null`, para que un repo no pueda fijar `PENPOT_URL` ni ejecutar un `preload`. `bun bin/heron.ts` a mano en un directorio no confiable no tiene esa protección. `heron penpot link` guarda `enabled: true` y el `fileId` en `project.json`, nunca la URL ni la versión (`url: null`, `version: null`).

`PENPOT_URL` es la URL base, sin credenciales, query, fragmento ni `/mcp/stream`. HTTPS admite destinos locales explícitos; HTTP solo loopback (`localhost`, IPv4/IPv6). Heron no sigue redirecciones. La key debe ser el valor, no la URL completa de Integrations. El archivo se lee como UTF-8 estricto, regular, de hasta 8 KiB, y se recortan los espacios de sus extremos; vacío, ilegible o controles son errores.

## Órdenes de Heron

Con `.heron/` inicializado y el archivo correcto abierto con el plugin conectado:

```text
heron penpot link [path] [--file-id <uuid>] [--json]
heron penpot doctor [path] [--json]
heron penpot inspect [path] [--json]
heron penpot sync [path] [--proposals] [--references] [--dry-run] [--json]
```

El path por default es `.`. Sin `bun link`, usa `bun run heron penpot ...` desde el repo de Heron. No hay `--url`, `unlink` ni sync de sistema completo sin banderas en P12 (P6).

- **link:** inspecciona y vincula el archivo conectado; `--file-id` exige que coincida con ese UUID antes de escribir. Volver a vincular el mismo archivo no escribe; cambiarlo avisa. No crea un archivo Penpot ni dibuja páginas.
- **doctor:** siete checks ordenados: `penpot.config`, `penpot.url`, `penpot.key`, `penpot.mcp`, `penpot.plugin`, `penpot.file`, `penpot.version`. Un fallo deja los siguientes como `Skipped`; permisos abiertos y versión no probada son WARNING. `heron doctor` agrega esos checks solo en un workspace vinculado y los ejecuta en paralelo con los de agentes. Ninguno escribe ni gasta tokens de IA sin `--deep` del doctor general.
- **inspect:** muestra archivo, versión y páginas `missing`, `outdated`, `up-to-date`, `duplicate` o `unknown`, sin abrir páginas, escribir ni tomar lock. Si hay otro archivo conectado, avisa y muestra `bound: no`; no lo adopta.
- **sync --proposals:** exige direcciones válidas y no obsoletas; crea una página por dirección con geometría común, paleta/contraste, escala, componentes y composición `SYNTHETIC`. No crea pantallas productivas. `reference-only` conserva su banda y marca `REFERENCE ONLY`.
- **sync --references:** exige referencias activas; crea una página de tarjetas de texto con provenance y notas, sin imágenes. El prefijo máximo que cabe se informa si se trunca (hasta 48 tarjetas, 5 ítems por lista, 200 puntos de código por texto).
- **--dry-run:** inspecciona y devuelve `would-create`, `would-update` y `unchanged`; no escribe en Penpot, `.heron/` ni logs. Se pueden combinar `--proposals --references`.

Ejemplo de recorrido, sin aprobar automáticamente ningún gate:

```sh
heron penpot link ../producto --file-id <uuid>
heron penpot doctor ../producto
heron penpot sync ../producto --proposals --references --dry-run
heron penpot sync ../producto --proposals --references
heron penpot inspect ../producto
heron penpot sync ../producto --proposals --references  # sin cambios: 0 escrituras
```

### Idempotencia y recuperación

El plan elige la primera página con cada marca `heron` y avisa duplicados; no los borra. Solo sustituye formas propias. Una forma humana dentro de un tablero de Heron bloquea la reescritura: muévela fuera del tablero antes de repetir. Las formas humanas externas se conservan; una edición dentro de una forma marcada no se detecta aún (drift, P6).

Sync verifica el archivo vinculado antes de escribir, detiene el plan al primer fallo y vuelve a inspeccionar. El registro `.heron/penpot/review-sync.json` incluye solo páginas confirmadas; no escribe el estado productivo `penpot/sync-state.json`. Las banderas gobiernan escrituras, no borran del registro otras páginas actuales confirmadas. Sin cambios, la segunda corrida hace una lectura, cero escrituras remotas y deja `.heron/` intacto.

La red corre fuera del lock: una modificación local concurrente produce exit 6 y no revierte Penpot. Repetir reconcilia las páginas ya escritas. Un timeout tampoco cancela necesariamente el script remoto: espera a que termine y Penpot esté libre antes de repetir. No edites el archivo mientras corre sync; este cambia la página activa y no restaura la anterior.

Todo script se mide completo en UTF-8 con presupuesto de **32 KiB**, elegido por Heron tras el spike, no límite oficial de Penpot. Las propuestas que exceden el presupuesto fallan antes de conectar; References recorta su prefijo. El JSON de transporte es compacto y determinista sin alterar las huellas locales.

### Códigos de salida y fallos

| Código | Situación                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------- |
| 0      | Éxito; avisos por duplicados, permisos o versión no probada no bloquean                                 |
| 2      | Uso/configuración inválida, ambas variables de key, UUID inválido o sync sin banderas                   |
| 3      | Workspace o precondiciones bloqueados, otro archivo antes de escribir, formas humanas en tablero propio |
| 4      | Doctor: falla de workspace o archivo vinculado; propuesta que excede el presupuesto del script          |
| 5      | Configuración ausente, transporte/key/plugin/MCP/script fallidos; sync puede traer datos parciales      |
| 6      | Lock o revisión local concurrente; repetir tras terminar el escritor                                    |

`--json` produce un único `CliEnvelope` en stdout, también en fallos. Un sync parcial conserva `data.pages` y `data.writes` y emite `PENPOT_SYNC_PARTIAL`; revisa `ok` y `code`, no solo la presencia de datos. Los fallos de escrituras normales pueden agregar un evento redactado `penpot.error`, una vez por invocación, en el workspace objetivo.

Si aparece `PENPOT_PLUGIN_NOT_CONNECTED`, abre el archivo y usa **Main menu → MCP Server → Connect** (en español, Menú principal → Servidor MCP → Conectar). El handshake puede pasar con key equivocada o plugin desconectado: no demuestra que se pueda inspeccionar. Si se rechaza la key, revisa o rota el valor fuera del repo; no compartas la URL de Integrations ni logs crudos.

## Secretos

- `init-env` genera los secretos con `openssl rand -hex` y deja `.env` en 0600; `.gitignore` ignora `.env` y `.env.*` salvo `.env.example`. Nada secreto se versiona ni se imprime.
- `PENPOT_DB_PASSWORD` se fija **antes del primer `up`**: Postgres la toma solo al inicializar el volumen. Cambiarla después exige `ALTER ROLE` dentro del contenedor y luego editar `.env`.
- Rotar `PENPOT_SECRET_KEY` puede invalidar sesiones y tokens: vuelve a entrar y, si la MCP key es rechazada, genera otra.
- `docker compose config` imprime los secretos interpolados: córrelo solo con `tests/assets/infra/penpot.synthetic.env`. `infra/penpot/compose config --services` no los imprime.
- La key viaja en la query (`?userToken=`): todo log de acceso del frontend o de un proxy que registre la línea de la petición la contiene. Reduce la retención y rota la key si se filtra. **Confirmado en S8 (2026-10-02): el access log del frontend de 2.17.2 registra la key real en `?userToken=`.** No compartas la salida cruda de `compose logs`; redacta la query antes de cualquier diagnóstico que salga de la máquina.
- Un `PENPOT_MCP_KEY_FILE` con bits de grupo u otros produce un aviso (`PENPOT_KEY_FILE_PERMISSIONS`), no un rechazo, para no romper montajes de solo lectura.

## Fuentes y egreso a terceros

- La telemetría de Penpot está desactivada por default (`PENPOT_TELEMETRY_ENABLED=false`).
- El proveedor de **Google Fonts** queda activo: el navegador pide fuentes a Google (egreso a un tercero). Se conserva porque las propuestas comparan tipografía y sin el proveedor las familias caen a la fuente por default. Opt-out: `PENPOT_EXTRA_FLAGS=disable-google-fonts-provider`, con la consecuencia de que Heron usa `PENPOT_FONT_FALLBACK`. S6 (2026-10-02): `Inter` está disponible, pero `fonts.findByName("Inter")` devuelve `Inter Tight`; la búsqueda es por coincidencia parcial. `fonts.all.find(font => font.name === "Inter")` devuelve la familia exacta y una familia inexistente devuelve `null`. DR25 ya exige selección exacta de nombre completo, sin distinguir mayúsculas, antes de aplicar la fuente.
- Fuera de eso, Penpot no contacta a terceros salvo el SMTP que configures.

## Backups

Haz respaldo **antes de cualquier upgrade**, con Penpot arriba:

```sh
infra/penpot/compose exec -T penpot-postgres pg_dump -U penpot penpot > penpot-db.sql
docker run --rm -v penpot_penpot_assets:/data -v "$PWD":/backup alpine tar czf /backup/penpot-assets.tgz -C /data .
```

Los respaldos contienen el diseño de clientes: guárdalos fuera del repo y con permisos restringidos. Restaurar requiere el mismo `PENPOT_SECRET_KEY`. El ensayo de restauración y los requisitos de hardware son de P9.

## Upgrade

1. Respaldo (sección anterior).
2. `PENPOT_VERSION=<x.y.z> infra/penpot/fetch-compose --update` registra versión y sha256 nuevos en `.env.example` y `docker-compose.yaml.sha256` (confianza en el primer uso: revisa el diff del compose y del override antes de aceptarlo).
3. Ajusta `compose.override.yaml` si el compose nuevo agrega servicios o bloques `x-*` (2.18.1 agrega `penpot-admin-console` y `x-database` con contraseña `penpot`).
4. `HERON_LIVE_COMPOSE=1 bun run test:live:compose`, luego `infra/penpot/compose pull && infra/penpot/compose up -d`. Actualiza `PENPOT_VERSION` en tu `.env` (no se sobrescribe).

**Regla de evidencia:** todo PR que toque `infra/penpot/` adjunta la salida de `HERON_LIVE_COMPOSE=1 bun run test:live:compose` (versión de Compose y aserciones en PASS sobre la salida real de `docker compose config`). CI no tiene Docker (DR41). Verificar el compose vendorizado: `PENPOT_VERSION=2.17.2 infra/penpot/fetch-compose && shasum -a 256 -c infra/penpot/docker-compose.yaml.sha256` (descarga, necesita red).

## Versiones

- 2026-10-01: **2.17.2 fijada (D7)**. Se programó la sonda aislada de 2.18.x por el bug del plugin integrado self-hosted [#12003](https://github.com/penpot/penpot/issues/12003).
- 2026-10-02: **2.18.1 probada en instancia aislada (T13): PASS, 0 comprobaciones fallidas; se conserva 2.17.2 fijada.** El plugin integrado conectó en Chrome incógnito mediante `http://localhost:9002`; el fallo #12003 **no se reprodujo en este entorno local**. El issue sigue abierto y las [notas de 2.18.1](https://github.com/penpot/penpot/releases/tag/2.18.1) no anuncian su corrección: esta prueba HTTP loopback no demuestra una solución general para el despliegue HTTPS con reverse proxy del reporte. No se actualizaron los servicios ni los volúmenes de la instancia 2.17.2. `PENPOT_TESTED_VERSIONS` conserva `["2.17.2"]` según la política de T13: cambia solo si se sube la versión fijada.
- Docker 29.4.0 / Compose 5.1.2 (2026-10-01).

### Evidencia T13 — 2.18.1 aislada

Compose oficial del tag `2.18.1`, proyecto `heron-t13-218`, puerto `127.0.0.1:9002`, red y volúmenes nuevos, secretos nuevos en 0600 fuera del repo. El override temporal adaptó `penpot-admin-console` (imagen fijada y contraseña de DB privada) y los flags del exporter (2.18.1 hereda flags inseguros del compose oficial). Las guardas R1 y las comprobaciones adicionales de aislamiento pasaron antes de iniciar los contenedores. No se editó `infra/penpot/` ni se reutilizaron datos de la instancia actual.

Cuenta y archivo desechables; el usuario hizo login, habilitó MCP, generó y guardó la key fuera del repo y conectó el plugin. Archivo: `81393c30-ef74-81fb-8008-bac02a1b685a`. Comando, con la key ya guardada de forma privada:

```sh
HERON_LIVE_PENPOT=1 PENPOT_URL=http://localhost:9002 \
  bun run test:live:penpot -- --file-id 81393c30-ef74-81fb-8008-bac02a1b685a
```

```text
PASS handshake and execute_code offered
PASS bound disposable file (before any mutation)
PASS penpot.version format -- 2.18.1
PASS JSON result and string log envelope
PASS Tool execution failed classified
PASS wrong key rejected or no plugin
PASS fonts.findByName and exact selection
PASS substring family observation
PASS 32 KiB escaped script and RPC body -- script=32768 B; RPC<=65611 B
PASS production review template guard
PASS production review template proposal
PASS second sync plans zero writes
PASS inactive page and descendant marks
PASS human inside owned board blocks rewrite and survives
penpot.live: PASS; 0 failed checks
```

**P12.A7 aprobado por el usuario el 2026-10-02**, tras leer el resultado y confirmar la conservación de 2.17.2. La sonda no implica un upgrade.

## Recorrido P12.A8 sobre monorepo-fullstack (pendiente)

Prerequisito: **P3.A12 aprobado**, con brief, análisis y tres direcciones generadas mediante Claude Code y Codex reales sobre `monorepo-fullstack`. Un fixture SYNTHETIC o un proveedor `fake` no satisface esa aceptación. No se declara A8 aprobada por haber pasado T12 o T13.

1. En Penpot 2.17.2 abre un archivo dedicado **Heron — monorepo-fullstack** en Chrome, activa MCP y conecta el plugin. Configura URL y key en el shell; no uses el archivo desechable de las sondas como evidencia del producto.
2. Desde Heron corre `heron penpot link ../monorepo-fullstack --file-id <uuid>`; verifica `enabled: true`, el archivo correcto y `url: null` en `project.json`.
3. `heron doctor ../monorepo-fullstack`: los siete checks Penpot deben pasar.
4. `heron penpot sync ../monorepo-fullstack --proposals`: tres páginas. Repite: `0 page(s) written, 3 unchanged`.
5. `heron penpot sync ../monorepo-fullstack --references` y `heron penpot inspect ../monorepo-fullstack`.
6. **Comparación lado a lado (DR38):** abre el mismo archivo en tres ventanas del navegador, una por página de propuesta, colócalas lado a lado y usa el mismo zoom. La comparación se hace después de escribir; solo una ventana necesita el MCP. Revisa alineación de secciones, los 13 atributos, paleta/contraste, escala tipográfica, componentes y composición `SYNTHETIC`, con la banda `REFERENCE ONLY`.
7. Compara el estado Git de `.heron/` antes y después: los cambios del recorrido deben limitarse a `project.json`, `penpot/review-sync.json` y `state.json`; sin `design/**`, `validation/**` ni export. No comitees trabajo previo ajeno como parte de esta evidencia.
8. El usuario revisa y responde **Aprobado**. Solo entonces se agrega la fecha y "2.17.2 verificada con Heron sobre monorepo-fullstack (P12.A8)" en Versiones y se registra `navori master part P12 --accept A8 … --approved-by user`.

Estado al 2026-10-02: **pendiente**, no sustituido por A7 ni pruebas automatizadas.

## Criterio de salida del Lote 1 (manual)

Antes del Lote 2 y sin Heron, con `infra/penpot/` y esta guía:

1. `infra/penpot/init-env` y `infra/penpot/compose up -d`; `HERON_LIVE_COMPOSE=1 bun run test:live:compose`.
2. Crear un perfil (Cuentas), iniciar sesión en Chrome en `http://localhost:9001`, abrir un archivo de prueba, activar MCP, generar la key y conectar el plugin integrado (MCP).
3. Con un cliente MCP (por ejemplo el inspector oficial) apuntando a `http://localhost:9001/mcp/stream?userToken=<key>`, ejecutar el spike con la herramienta `execute_code`:

| Id  | Comprobación                                                                                                                                                                                                        | Esperado                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| S1  | `up -d`, login, MCP activado, key, plugin conectado; anota versión de Chrome y etiqueta exacta del botón                                                                                                            | Conecta; "Main menu → MCP Server → Connect"                                                                      |
| S2  | `create-profile` con verificación de email activa; ese perfil inicia sesión                                                                                                                                         | Entra sin verificar email                                                                                        |
| S3  | `return { ok: 1 }`; `throw new Error("heron-spike")`; una key equivocada                                                                                                                                            | Texto `{ "result", "log" }`; `Tool execution failed: …`; 401/403 o "No Penpot instance connected for user token" |
| S4  | `return penpot.version`                                                                                                                                                                                             | Cadena que empieza con `2.17.2`                                                                                  |
| S5  | `createPage()`, `await openPage(p)`, un tablero con un rectángulo hijo y marcas `heron` (`setSharedPluginData`) en página, tablero y rectángulo; con otra página activa, leer esas marcas desde `currentFile.pages` | Se crea en la página abierta; las marcas se leen sin abrir la página                                             |
| S6  | `penpot.fonts.findByName("Inter")` y `findByName("Heron Missing Font")`                                                                                                                                             | Una fuente y `null`/`undefined`                                                                                  |
| S7  | Un `execute_code` de ~256 KiB (comentario de relleno + `return 1`) por `/mcp/stream`; anota la duración                                                                                                             | Pasa en menos de 10 s                                                                                            |
| S8  | `infra/penpot/compose logs penpot-frontend` tras S3 (informativo)                                                                                                                                                   | Anota si el log registra `?userToken=`                                                                           |

El PR registra las versiones (Docker, Compose, Chrome), la salida de `test:live:compose`, cada resultado de S1–S8 y el commit de la spec que los asienta en sus DR o activa su respaldo (`design.md` § Spike). Si S1 falla, P12 se detiene y se revisa D7; si S2 falla, la decisión de cuentas vuelve al usuario.

## Evidencia del spike S1–S8 (2026-10-02)

Entorno: Penpot **2.17.2**, Docker **29.4.0**, Compose **5.1.2**, Chrome **154.0.8037.98**, Bun **1.4.2**, acceso `http://localhost:9001`. Cuenta y archivo desechables; no se usaron diseños del usuario. Archivo de prueba: `a0ce7988-853a-8093-8008-ba9507529e93`. La key no forma parte de esta evidencia.

```text
$ HERON_LIVE_COMPOSE=1 bun run test:live:compose
Docker Compose version v5.1.2
PASS assertPenpotComposeInvariants on the real docker compose config
PASS config --services lists no penpot-mailcatch
```

El spike se ejecutó con un cliente Streamable HTTP desechable en Bun, fuera del repo; protocolo `2025-11-25`, servidor `penpot` `1.0.0`. Herramientas anunciadas: `execute_code`, `high_level_overview`, `penpot_api_info`, `export_shape`.

| Id  | Resultado observado                                                                                                                                                                                                                                                        | Consecuencia                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| S1  | Login y conexión correctos. Con la key habilitada, el archivo nuevo conectó automáticamente el plugin; en español, **Menú principal → Servidor MCP → Desconectar** confirma la conexión. No hay submenú Archivo para MCP en este entorno.                                  | Ajustar la guía y los remedios de DR21/DR42 al menú real.                                                          |
| S2  | El perfil creado por `manage.py create-profile` entró al dashboard sin verificar email manualmente, manteniendo cookies seguras y verificación de email activas.                                                                                                           | DR35 confirmado; no se necesita SMTP para este flujo.                                                              |
| S3  | `return { ok: 1 }` devuelve texto JSON con `result` y `log: ""`. El error devuelve `Tool execution failed: Error: Error handling task: heron-spike` sin `isError`. La key incorrecta admite handshake; al ejecutar devuelve `No Penpot instance connected for user token`. | DR10 confirmado; no asumir que handshake implica key válida o plugin conectado.                                    |
| S4  | `penpot.version` devuelve la cadena `2.17.2`.                                                                                                                                                                                                                              | DR22 confirmado.                                                                                                   |
| S5  | `createPage`, `await openPage`, tablero y rectángulo hijo funcionaron. Desde otra página se leyeron las marcas `heron` de la página, tablero y rectángulo; la página activa no cambió al leer.                                                                             | No se necesita índice alternativo ni abrir páginas para inspeccionar (DR14/DR15/DR29).                             |
| S6  | Búsqueda parcial de `Inter` devolvió `Inter Tight`; búsqueda exacta en `fonts.all` devolvió `Inter` (`gfont-inter`). `Heron Missing Font` devolvió `null`.                                                                                                                 | Corregir selección de familia en DR25 antes de T6–T7.                                                              |
| S7  | 262 144 bytes: HTTP 413 (9 ms). 131 072 bytes: HTTP 413 (10 ms). **65 536 bytes: `result: 1` (17 ms)**.                                                                                                                                                                    | El tope debe considerar el escape JSON del transporte: ver prueba adicional abajo; resolver DR11/DR30 antes de T6. |
| S8  | El access log del frontend contiene la key real. La comprobación solo emitió un booleano y un contador, nunca el token.                                                                                                                                                    | Redactar `userToken` antes de compartir logs; la key sigue fuera del repo.                                         |

**Causa de S7:** el contenedor MCP usa `express.json()` sin opciones (`/opt/penpot/mcp/index.js:16722`); `body-parser@2.2.2` fija por default `100kb` en `lib/utils.js:63–65`. El límite es del parser del MCP, no del nginx. No se alteró el servidor para evitar el rechazo.

**S7 adicional (cuerpo JSON real):** 65 536 bytes de script con barras invertidas en el comentario generan 131 162 bytes de cuerpo RPC y HTTP 413. Con 32 768 bytes de script, el cuerpo mide 65 626 bytes y devuelve `result: 1` en 81 ms. **64 KiB no es un presupuesto seguro para contenido escapado**; se propone 32 KiB para el script completo y recortar References por tamaño real antes de enviar, sin aumentar el límite del servidor.

**Estado de salida:** el usuario aprobó los ajustes el 2026-10-02: presupuesto de 32 KiB, prefijo References por bytes reales y fuentes exactas. T6–T11 los implementaron y la sonda T12 siguiente los valida con Heron. Esta evidencia no sustituye las aceptaciones manuales P12.A7/P12.A8.

### Fundamento oficial de los ajustes

[Express 5](https://expressjs.com/en/5x/api/express/#express.json) documenta 100kb por cuerpo JSON; el [servidor MCP de Penpot 2.17.2](https://github.com/penpot/penpot/blob/2.17.2/mcp/packages/server/src/PenpotMcpServer.ts#L373-L378) no cambia ese default. **32 KiB es el presupuesto de Heron elegido por el usuario con el spike**, no una especificación oficial de Penpot. References conserva el prefijo más largo que quepa al renderizar el script final, hasta el techo de 48 tarjetas; informa cada referencia omitida y no divide la página.

La [Plugin API oficial](https://doc.plugins.penpot.app/interfaces/FontsContext) expone `fonts.all`; la [implementación fijada](https://github.com/penpot/penpot/blob/2.17.2/frontend/src/app/plugins/fonts.cljs#L109-L118) explica por qué `findByName` puede seleccionar otra familia. Heron compara el nombre completo, sin distinguir mayúsculas, y usa fallback si esa familia no existe.

## Sonda viva con Heron — T12 (2026-10-02)

La sonda es opt-in y **muta exclusivamente un archivo desechable**; verifica el `fileId` antes de escribir y no limpia sus fixtures. No la recoge `bun test`. Con Penpot abierto y el plugin MCP conectado en Chrome:

```sh
HERON_LIVE_PENPOT=1 bun run test:live:penpot -- --file-id <uuid-del-archivo-desechable>
```

Requiere `PENPOT_URL` y exactamente una de `PENPOT_MCP_KEY` o `PENPOT_MCP_KEY_FILE`, como en Configuración. No imprime la key, la URL de transporte, errores crudos ni logs del plugin. Si Chrome está cerrado, el handshake puede pasar pero `inspect` responde `plugin-not-connected`: abre el archivo y reconecta el plugin antes de repetir.

Resultado contra **2.17.2**, mismo entorno y archivo del spike:

```text
PASS handshake and execute_code offered
PASS bound disposable file (before any mutation)
PASS penpot.version format -- 2.17.2
PASS JSON result and string log envelope
PASS Tool execution failed classified
PASS wrong key rejected or no plugin
PASS fonts.findByName and exact selection
PASS substring family observation
PASS 32 KiB escaped script and RPC body -- script=32768 B; RPC<=65611 B
PASS production review template guard
PASS production review template proposal
PASS second sync plans zero writes
PASS inactive page and descendant marks
PASS human inside owned board blocks rewrite and survives
penpot.live: PASS; 0 failed checks
```

La prueba de RPC mide una envoltura JSON conservadora con el id entero de máxima anchura segura; no confunde bytes del script con bytes del cuerpo. La propuesta usa el fixture SYNTHETIC completo y la plantilla productiva; la guarda humana compara contenido, nombre e identidades de hijos antes y después del intento bloqueado.

**Diferencia descubierta y corregida antes de congelar `@v1`:** una marca ausente devuelve `null`, no la cadena vacía que sugieren los tipos oficiales. El doble anterior ocultaba un `TypeError` al probar `startsWith`; ahora reproduce `string | null` y la plantilla normaliza la ausencia. Las plantillas `inspect@v1` y `review-page@v1` se congelan al integrar T12; todo cambio posterior requiere nueva versión (DR13/DR44).
