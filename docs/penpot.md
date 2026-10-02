# Penpot (P12)

Heron dibuja y lee las propuestas visuales en un Penpot **autoalojado** a través del servidor MCP oficial de Penpot. Esta guía cubre la infraestructura de `infra/penpot/`, las cuentas, la conexión MCP y la configuración de Heron. Las órdenes `heron penpot` se documentan cuando existan (T20). Decisiones y justificación: `specs/0005-penpot-base/design.md` (DR1–DR4, DR33–DR43, DR47).

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
2. En el archivo, conecta el plugin integrado ("Remote MCP"): **File → MCP Server → Connect** (la etiqueta exacta se confirma en S1).
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

Heron **no lee `.env`** (DR43). Una vez integrado el PR #16 (T14, el lanzador), `bun run heron` y el ejecutable `heron` corren con `--no-env-file --config=/dev/null`, para que un repo no pueda fijar `PENPOT_URL` ni ejecutar un `preload`; hasta entonces esa defensa no existe. `bun bin/heron.ts` a mano en un directorio no confiable no la tiene nunca. La orden `heron penpot link` (caso de uso en T16, CLI en T19) guardará en `project.json` solo el `fileId`, nunca la URL (DR33); todavía no está disponible.

## Secretos

- `init-env` genera los secretos con `openssl rand -hex` y deja `.env` en 0600; `.gitignore` ignora `.env` y `.env.*` salvo `.env.example`. Nada secreto se versiona ni se imprime.
- `PENPOT_DB_PASSWORD` se fija **antes del primer `up`**: Postgres la toma solo al inicializar el volumen. Cambiarla después exige `ALTER ROLE` dentro del contenedor y luego editar `.env`.
- Rotar `PENPOT_SECRET_KEY` puede invalidar sesiones y tokens: vuelve a entrar y, si la MCP key es rechazada, genera otra.
- `docker compose config` imprime los secretos interpolados: córrelo solo con `tests/assets/infra/penpot.synthetic.env`. `infra/penpot/compose config --services` no los imprime.
- La key viaja en la query (`?userToken=`): todo log de acceso del frontend o de un proxy que registre la línea de la petición la contiene. Reduce la retención y rota la key si se filtra. [SIN VERIFICAR: S8 anota aquí si el nginx del frontend de 2.17.2 la registra.]
- Un `PENPOT_MCP_KEY_FILE` con bits de grupo u otros produce un aviso (`PENPOT_KEY_FILE_PERMISSIONS`), no un rechazo, para no romper montajes de solo lectura.

## Fuentes y egreso a terceros

- La telemetría de Penpot está desactivada por default (`PENPOT_TELEMETRY_ENABLED=false`).
- El proveedor de **Google Fonts** queda activo: el navegador pide fuentes a Google (egreso a un tercero). Se conserva porque las propuestas comparan tipografía y sin el proveedor las familias caen a la fuente por default. Opt-out: `PENPOT_EXTRA_FLAGS=disable-google-fonts-provider`, con la consecuencia de que Heron usa `PENPOT_FONT_FALLBACK`. [SIN VERIFICAR: S6 anota la disponibilidad por nombre.]
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

- 2026-10-01: **2.17.2 fijada (D7); sonda de 2.18.x pendiente (T13)**. 2.18.0 tiene abierto el bug #12003 (el plugin integrado self-hosted conecta `/mcp/ws` sin `userToken`); 2.18.1 no lo menciona.
- Docker 29.4.0 / Compose 5.1.2 (2026-10-01).

## Criterio de salida del Lote 1 (manual)

Antes del Lote 2 y sin Heron, con `infra/penpot/` y esta guía:

1. `infra/penpot/init-env` y `infra/penpot/compose up -d`; `HERON_LIVE_COMPOSE=1 bun run test:live:compose`.
2. Crear un perfil (Cuentas), iniciar sesión en Chrome en `http://localhost:9001`, abrir un archivo de prueba, activar MCP, generar la key y conectar el plugin integrado (MCP).
3. Con un cliente MCP (por ejemplo el inspector oficial) apuntando a `http://localhost:9001/mcp/stream?userToken=<key>`, ejecutar el spike con la herramienta `execute_code`:

| Id  | Comprobación                                                                                                                                                                                                        | Esperado                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| S1  | `up -d`, login, MCP activado, key, plugin conectado; anota versión de Chrome y etiqueta exacta del botón                                                                                                            | Conecta; "File → MCP Server → Connect"                                                                           |
| S2  | `create-profile` con verificación de email activa; ese perfil inicia sesión                                                                                                                                         | Entra sin verificar email                                                                                        |
| S3  | `return { ok: 1 }`; `throw new Error("heron-spike")`; una key equivocada                                                                                                                                            | Texto `{ "result", "log" }`; `Tool execution failed: …`; 401/403 o "No Penpot instance connected for user token" |
| S4  | `return penpot.version`                                                                                                                                                                                             | Cadena que empieza con `2.17.2`                                                                                  |
| S5  | `createPage()`, `await openPage(p)`, un tablero con un rectángulo hijo y marcas `heron` (`setSharedPluginData`) en página, tablero y rectángulo; con otra página activa, leer esas marcas desde `currentFile.pages` | Se crea en la página abierta; las marcas se leen sin abrir la página                                             |
| S6  | `penpot.fonts.findByName("Inter")` y `findByName("Heron Missing Font")`                                                                                                                                             | Una fuente y `null`/`undefined`                                                                                  |
| S7  | Un `execute_code` de ~256 KiB (comentario de relleno + `return 1`) por `/mcp/stream`; anota la duración                                                                                                             | Pasa en menos de 10 s                                                                                            |
| S8  | `infra/penpot/compose logs penpot-frontend` tras S3 (informativo)                                                                                                                                                   | Anota si el log registra `?userToken=`                                                                           |

El PR registra las versiones (Docker, Compose, Chrome), la salida de `test:live:compose`, cada resultado de S1–S8 y el commit de la spec que los asienta en sus DR o activa su respaldo (`design.md` § Spike). Si S1 falla, P12 se detiene y se revisa D7; si S2 falla, la decisión de cuentas vuelve al usuario.
