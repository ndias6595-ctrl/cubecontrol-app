# CubeControl · Cloud sync (MVP)

Sync de la **library** (tonos, canciones, shows y metadatos de IR) entre
**un músico / dos dispositivos** (desktop + Android), offline-first, con
Supabase. Backend: Postgres + Auth + RLS.

La cuenta es **una sola library en la nube**. La nube **solo sincroniza
metadatos** y nunca dispara SysEx al pedal. Los WAV de IR viajan por pack ZIP /
`.cubecontrol.json`, no por sync. Ver [`open-core.md`](open-core.md).

## Cómo decide qué tocar

Cada ítem tiene un `id`. Mismo id = el mismo tono/canción/show.

- Sin cambios de `updatedAt` desde el último push → no se sube.
- `updatedAt` más nuevo en este aparato → se sube (last-write-wins).
- `updatedAt` más nuevo en la nube → se baja y pisa el local.
- Id nuevo → se agrega.
- Borrado local → tombstone (`deleted_at`).

No se fusionan knobs. No se unen tonos por nombre en el sync de todos los días.

## Primer sync

Si este aparato **nunca** sincronizó (`cursor` vacío) y **los dos lados tienen
datos**, no se mezcla a ciegas. La UI pide:

- **Usar la nube** — el local se alinea al servidor (ítems solo-locales se van).
- **Subir este dispositivo** — la nube pasa a ser esta library.
- **Cancelar**.

Si hay presets con **mismo nombre y mismos knobs** pero distinto id (nacidos
dos veces), se ofrece **unirlos** (las canciones apuntan al id que se queda).

Si el local está vacío, se baja la nube. Si la nube está vacía, se sube este
aparato. Eso corre sin diálogo.

El auto-sync (desktop 2.5 s tras editar; móvil igual + al volver a primer plano)
**no** corre ese conflicto: espera a que elijas en el panel.

## Arquitectura

```
apps/desktop                     apps/mobile
   │                                  │
   ▼                                  ▼
LibraryRepository (adapter)      (mismo contrato)
   │
   ▼
@tonehub/library-sync  ← tipos + motor LWW + primer-sync + gemelos
   │
   ▼
SyncRemote ← supabaseRemote
```

- Cursor de pull: `sync_change_seq` (sin skew de reloj).
- Tests: `packages/library-sync` (`vitest`).

## Setup

1. Proyecto en [supabase.com](https://supabase.com) (free tier).
2. Auth → Email (Magic Link).
3. SQL: [`packages/library-sync/sql/schema.sql`](../packages/library-sync/sql/schema.sql).
4. Redirect: `cubecontrol://auth/callback`.
5. Desktop puede usar `apps/desktop/.env`; si no, los defaults públicos del
   paquete (anon key). Nunca `service_role` en el cliente.

## Auth

Magic link `cubecontrol://`. Desktop también acepta OTP por código.
Sesión: `userData/CubeControl/sync/session.json` (PC) o AsyncStorage (móvil).
