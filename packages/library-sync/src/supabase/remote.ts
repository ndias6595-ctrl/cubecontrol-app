import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyncChange, SyncPullResult, SyncRemote } from "../remote";
import type {
  IrRecord,
  LiveParamsSnapshot,
  PresetRecord,
  ShowRecord,
  SongRecord,
  SyncRecord,
} from "../types";

/**
 * Supabase-backed `SyncRemote`. Postgres RLS filters rows to the signed-in
 * user; the monotonic `seq` column drives incremental pulls so the cursor has
 * no clock-skew dependency. Shared by the desktop and mobile apps.
 */

interface PresetRow {
  readonly id: string;
  readonly name: string;
  readonly notes: string;
  readonly tags: unknown;
  readonly profile: string;
  readonly params: unknown;
  readonly updated_at: string;
  readonly deleted_at: string | null;
  readonly seq: number;
}

interface SongRow {
  readonly id: string;
  readonly name: string;
  readonly notes: string;
  readonly tags: unknown;
  readonly preset_id: string;
  readonly ir_id: string | null;
  readonly ir_cabinet: number | null;
  readonly ir_distance: number | null;
  readonly key: string | null;
  readonly bpm: number | null;
  readonly delay_note: string | null;
  readonly updated_at: string;
  readonly deleted_at: string | null;
  readonly seq: number;
}

interface ShowRow {
  readonly id: string;
  readonly name: string;
  readonly notes: string;
  readonly song_ids: unknown;
  readonly updated_at: string;
  readonly deleted_at: string | null;
  readonly seq: number;
}

interface IrRow {
  readonly id: string;
  readonly name: string;
  readonly notes: string;
  readonly tags: unknown;
  readonly profile: string;
  readonly byte_length: number | null;
  readonly updated_at: string;
  readonly deleted_at: string | null;
  readonly seq: number;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asParams(value: unknown): LiveParamsSnapshot {
  return (value ?? {}) as LiveParamsSnapshot;
}

function presetRecord(row: PresetRow): PresetRecord {
  return {
    kind: "preset",
    id: row.id,
    name: row.name,
    notes: row.notes,
    tags: asStringArray(row.tags),
    profile: row.profile as PresetRecord["profile"],
    params: asParams(row.params),
    createdAt: row.updated_at,
    updatedAt: row.updated_at,
  };
}

function songRecord(row: SongRow): SongRecord {
  return {
    kind: "song",
    id: row.id,
    name: row.name,
    notes: row.notes,
    tags: asStringArray(row.tags),
    presetId: row.preset_id,
    ...(row.ir_id === null ? {} : { irId: row.ir_id }),
    ...(row.ir_cabinet === null ? {} : { irCabinet: row.ir_cabinet }),
    ...(row.ir_distance === null ? {} : { irDistance: row.ir_distance }),
    ...(row.key === null || row.key === "" ? {} : { key: row.key }),
    ...(row.bpm === null ? {} : { bpm: row.bpm }),
    ...(row.delay_note === null
      ? {}
      : { delayNote: row.delay_note as NonNullable<SongRecord["delayNote"]> }),
    createdAt: row.updated_at,
    updatedAt: row.updated_at,
  };
}

function showRecord(row: ShowRow): ShowRecord {
  return {
    kind: "show",
    id: row.id,
    name: row.name,
    notes: row.notes,
    songIds: asStringArray(row.song_ids),
    createdAt: row.updated_at,
    updatedAt: row.updated_at,
  };
}

function irRecord(row: IrRow): IrRecord {
  return {
    kind: "ir",
    id: row.id,
    name: row.name,
    notes: row.notes,
    tags: asStringArray(row.tags),
    profile: row.profile as IrRecord["profile"],
    ...(row.byte_length === null ? {} : { byteLength: row.byte_length }),
    createdAt: row.updated_at,
    updatedAt: row.updated_at,
  };
}

export class SupabaseRemote implements SyncRemote {
  readonly #client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.#client = client;
  }

  async pull(since: string | null): Promise<SyncPullResult> {
    const sinceSeq = since === null ? 0 : Number(since) || 0;
    const changes: SyncChange[] = [];
    let maxSeq = sinceSeq;

    const collect = (
      record: SyncRecord,
      row: { readonly updated_at: string; readonly deleted_at: string | null; readonly seq: number },
    ): void => {
      changes.push(
        row.deleted_at === null
          ? { kind: record.kind, id: record.id, updatedAt: row.updated_at, deleted: false, record }
          : { kind: record.kind, id: record.id, updatedAt: row.updated_at, deleted: true },
      );
      maxSeq = Math.max(maxSeq, row.seq);
    };

    const presetRows = await this.#client.from("presets").select("*").gt("seq", sinceSeq);
    if (presetRows.error) throw presetRows.error;
    for (const row of (presetRows.data ?? []) as PresetRow[]) collect(presetRecord(row), row);

    const songRows = await this.#client.from("songs").select("*").gt("seq", sinceSeq);
    if (songRows.error) throw songRows.error;
    for (const row of (songRows.data ?? []) as SongRow[]) collect(songRecord(row), row);

    const showRows = await this.#client.from("shows").select("*").gt("seq", sinceSeq);
    if (showRows.error) throw showRows.error;
    for (const row of (showRows.data ?? []) as ShowRow[]) collect(showRecord(row), row);

    const irRows = await this.#client.from("irs").select("*").gt("seq", sinceSeq);
    if (irRows.error) throw irRows.error;
    for (const row of (irRows.data ?? []) as IrRow[]) collect(irRecord(row), row);

    return { changes, cursor: String(maxSeq) };
  }

  async push(changes: readonly SyncChange[]): Promise<void> {
    for (const change of changes) {
      if (change.deleted) {
        await this.#pushDelete(change);
      } else {
        await this.#pushUpsert(change.record);
      }
    }
  }

  async #pushDelete(change: Extract<SyncChange, { readonly deleted: true }>): Promise<void> {
    const fn = deleteFunction(change.kind);
    const { error } = await this.#client.rpc(fn, {
      p_id: change.id,
      p_updated_at: change.updatedAt,
    });
    if (error) throw error;
  }

  async #pushUpsert(record: SyncRecord): Promise<void> {
    switch (record.kind) {
      case "preset": {
        const { error } = await this.#client.rpc("push_preset", {
          p_id: record.id,
          p_name: record.name,
          p_notes: record.notes,
          p_tags: record.tags,
          p_profile: record.profile,
          p_params: record.params,
          p_updated_at: record.updatedAt,
          p_deleted_at: null,
        });
        if (error) throw error;
        return;
      }
      case "song": {
        const { error } = await this.#client.rpc("push_song", {
          p_id: record.id,
          p_name: record.name,
          p_notes: record.notes,
          p_tags: record.tags,
          p_preset_id: record.presetId,
          p_ir_id: record.irId ?? null,
          p_ir_cabinet: record.irCabinet ?? null,
          p_ir_distance: record.irDistance ?? null,
          p_key: record.key ?? null,
          p_bpm: record.bpm ?? null,
          p_delay_note: record.delayNote ?? null,
          p_updated_at: record.updatedAt,
          p_deleted_at: null,
        });
        if (error) throw error;
        return;
      }
      case "show": {
        const { error } = await this.#client.rpc("push_show", {
          p_id: record.id,
          p_name: record.name,
          p_notes: record.notes,
          p_song_ids: record.songIds,
          p_updated_at: record.updatedAt,
          p_deleted_at: null,
        });
        if (error) throw error;
        return;
      }
      case "ir": {
        const { error } = await this.#client.rpc("push_ir", {
          p_id: record.id,
          p_name: record.name,
          p_notes: record.notes,
          p_tags: record.tags,
          p_profile: record.profile,
          p_byte_length: record.byteLength ?? null,
          p_updated_at: record.updatedAt,
          p_deleted_at: null,
        });
        if (error) throw error;
        return;
      }
    }
  }
}

function deleteFunction(kind: SyncRecord["kind"]): string {
  switch (kind) {
    case "preset":
      return "delete_preset";
    case "song":
      return "delete_song";
    case "show":
      return "delete_show";
    case "ir":
      return "delete_ir";
  }
}
