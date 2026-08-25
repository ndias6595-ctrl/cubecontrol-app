-- CubeControl sync · Supabase schema (MVP: metadata-only)
-- Run in the Supabase SQL editor (or via supabase db push). Enables email
-- Magic Link auth; every table is multi-tenant and protected by RLS.
--
-- Conventions:
--   * `id`            — client-generated, globally unique (UUID / custom).
--   * `user_id`       — owning account; drives Row Level Security.
--   * `updated_at`    — CLIENT content version (ISO), used for last-write-wins.
--   * `deleted_at`    — soft-delete tombstone (NULL = alive).
--   * `seq`           — monotonic change cursor (drives incremental pulls).

create sequence if not exists sync_change_seq;

create table if not exists public.presets (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  notes       text not null default '',
  tags        jsonb not null default '[]'::jsonb,
  profile     text not null default 'otro',
  params      jsonb not null,
  updated_at  text not null,
  deleted_at  timestamptz,
  seq         bigint not null default nextval('sync_change_seq')
);

create table if not exists public.songs (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  notes       text not null default '',
  tags        jsonb not null default '[]'::jsonb,
  preset_id   text not null,
  ir_id       text,
  ir_cabinet  integer,
  ir_distance real,
  key         text,
  bpm         integer,
  delay_note  text,
  updated_at  text not null,
  deleted_at  timestamptz,
  seq         bigint not null default nextval('sync_change_seq')
);

create table if not exists public.shows (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  notes       text not null default '',
  song_ids    jsonb not null default '[]'::jsonb,
  updated_at  text not null,
  deleted_at  timestamptz,
  seq         bigint not null default nextval('sync_change_seq')
);

-- IR metadata only (WAV upload is a later phase).
create table if not exists public.irs (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  notes       text not null default '',
  tags        jsonb not null default '[]'::jsonb,
  profile     text not null default 'otro',
  byte_length integer,
  updated_at  text not null,
  deleted_at  timestamptz,
  seq         bigint not null default nextval('sync_change_seq')
);

create index if not exists presets_user_seq_idx on public.presets (user_id, seq);
create index if not exists songs_user_seq_idx   on public.songs   (user_id, seq);
create index if not exists shows_user_seq_idx   on public.shows   (user_id, seq);
create index if not exists irs_user_seq_idx     on public.irs     (user_id, seq);

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.presets enable row level security;
alter table public.songs   enable row level security;
alter table public.shows   enable row level security;
alter table public.irs     enable row level security;

create policy "presets_read_own" on public.presets for select using (auth.uid() = user_id);
create policy "presets_write_own" on public.presets for insert with check (auth.uid() = user_id);
create policy "presets_update_own" on public.presets for update using (auth.uid() = user_id);
create policy "presets_delete_own" on public.presets for delete using (auth.uid() = user_id);

create policy "songs_read_own"   on public.songs for select using (auth.uid() = user_id);
create policy "songs_write_own"  on public.songs for insert with check (auth.uid() = user_id);
create policy "songs_update_own" on public.songs for update using (auth.uid() = user_id);
create policy "songs_delete_own" on public.songs for delete using (auth.uid() = user_id);

create policy "shows_read_own"   on public.shows for select using (auth.uid() = user_id);
create policy "shows_write_own"  on public.shows for insert with check (auth.uid() = user_id);
create policy "shows_update_own" on public.shows for update using (auth.uid() = user_id);
create policy "shows_delete_own" on public.shows for delete using (auth.uid() = user_id);

create policy "irs_read_own"     on public.irs for select using (auth.uid() = user_id);
create policy "irs_write_own"    on public.irs for insert with check (auth.uid() = user_id);
create policy "irs_update_own"   on public.irs for update using (auth.uid() = user_id);
create policy "irs_delete_own"   on public.irs for delete using (auth.uid() = user_id);

-- ── Last-write-wins upserts ─────────────────────────────────────────────────
-- Each `push_*` function upserts and only overwrites when the incoming
-- `updated_at` is >= the stored one, so a stale push never clobbers a newer
-- edit. `seq` is bumped on every change so pulls stay monotonic.

create or replace function public.push_preset(
  p_id text, p_name text, p_notes text, p_tags jsonb, p_profile text,
  p_params jsonb, p_updated_at text, p_deleted_at timestamptz
) returns void language sql as $$
  insert into public.presets
    (id, user_id, name, notes, tags, profile, params, updated_at, deleted_at, seq)
  values
    (p_id, auth.uid(), p_name, p_notes, p_tags, p_profile, p_params,
     p_updated_at, p_deleted_at, nextval('sync_change_seq'))
  on conflict (id) do update set
    name = excluded.name,
    notes = excluded.notes,
    tags = excluded.tags,
    profile = excluded.profile,
    params = excluded.params,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at,
    seq = nextval('sync_change_seq')
  where excluded.updated_at >= public.presets.updated_at;
$$;

create or replace function public.push_song(
  p_id text, p_name text, p_notes text, p_tags jsonb, p_preset_id text,
  p_ir_id text, p_ir_cabinet integer, p_ir_distance real, p_key text,
  p_bpm integer, p_delay_note text, p_updated_at text, p_deleted_at timestamptz
) returns void language sql as $$
  insert into public.songs
    (id, user_id, name, notes, tags, preset_id, ir_id, ir_cabinet, ir_distance,
     key, bpm, delay_note, updated_at, deleted_at, seq)
  values
    (p_id, auth.uid(), p_name, p_notes, p_tags, p_preset_id, p_ir_id,
     p_ir_cabinet, p_ir_distance, p_key, p_bpm, p_delay_note,
     p_updated_at, p_deleted_at, nextval('sync_change_seq'))
  on conflict (id) do update set
    name = excluded.name,
    notes = excluded.notes,
    tags = excluded.tags,
    preset_id = excluded.preset_id,
    ir_id = excluded.ir_id,
    ir_cabinet = excluded.ir_cabinet,
    ir_distance = excluded.ir_distance,
    key = excluded.key,
    bpm = excluded.bpm,
    delay_note = excluded.delay_note,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at,
    seq = nextval('sync_change_seq')
  where excluded.updated_at >= public.songs.updated_at;
$$;

create or replace function public.push_show(
  p_id text, p_name text, p_notes text, p_song_ids jsonb,
  p_updated_at text, p_deleted_at timestamptz
) returns void language sql as $$
  insert into public.shows
    (id, user_id, name, notes, song_ids, updated_at, deleted_at, seq)
  values
    (p_id, auth.uid(), p_name, p_notes, p_song_ids,
     p_updated_at, p_deleted_at, nextval('sync_change_seq'))
  on conflict (id) do update set
    name = excluded.name,
    notes = excluded.notes,
    song_ids = excluded.song_ids,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at,
    seq = nextval('sync_change_seq')
  where excluded.updated_at >= public.shows.updated_at;
$$;

-- Tombstone a record (LWW: only if the incoming version is >= the stored one).
-- No-op when the row was never synced — the other devices don't have it either.

create or replace function public.delete_preset(p_id text, p_updated_at text)
returns void language sql as $$
  update public.presets
  set updated_at = p_updated_at, deleted_at = now(), seq = nextval('sync_change_seq')
  where id = p_id and deleted_at is null and p_updated_at >= updated_at;
$$;

create or replace function public.delete_song(p_id text, p_updated_at text)
returns void language sql as $$
  update public.songs
  set updated_at = p_updated_at, deleted_at = now(), seq = nextval('sync_change_seq')
  where id = p_id and deleted_at is null and p_updated_at >= updated_at;
$$;

create or replace function public.delete_show(p_id text, p_updated_at text)
returns void language sql as $$
  update public.shows
  set updated_at = p_updated_at, deleted_at = now(), seq = nextval('sync_change_seq')
  where id = p_id and deleted_at is null and p_updated_at >= updated_at;
$$;

create or replace function public.delete_ir(p_id text, p_updated_at text)
returns void language sql as $$
  update public.irs
  set updated_at = p_updated_at, deleted_at = now(), seq = nextval('sync_change_seq')
  where id = p_id and deleted_at is null and p_updated_at >= updated_at;
$$;

create or replace function public.push_ir(
  p_id text, p_name text, p_notes text, p_tags jsonb, p_profile text,
  p_byte_length integer, p_updated_at text, p_deleted_at timestamptz
) returns void language sql as $$
  insert into public.irs
    (id, user_id, name, notes, tags, profile, byte_length, updated_at, deleted_at, seq)
  values
    (p_id, auth.uid(), p_name, p_notes, p_tags, p_profile, p_byte_length,
     p_updated_at, p_deleted_at, nextval('sync_change_seq'))
  on conflict (id) do update set
    name = excluded.name,
    notes = excluded.notes,
    tags = excluded.tags,
    profile = excluded.profile,
    byte_length = excluded.byte_length,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at,
    seq = nextval('sync_change_seq')
  where excluded.updated_at >= public.irs.updated_at;
$$;
