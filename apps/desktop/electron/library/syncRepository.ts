import type {
  IrRecord,
  LibraryRepository,
  PresetRecord,
  PresetTwin,
  ShowRecord,
  SongRecord,
  SyncKind,
  SyncRecord,
  TwinKeep,
} from "@tonehub/library-sync";
import type { LibraryStore } from "./libraryStore";
import type {
  IrLibraryItem,
  PresetLibraryItem,
  ShowLibraryItem,
  SongLibraryItem,
} from "./types";

function toPresetRecord(item: PresetLibraryItem): PresetRecord {
  return {
    kind: "preset",
    id: item.id,
    name: item.name,
    notes: item.notes,
    tags: [...item.tags],
    profile: item.profile,
    params: { ...item.params },
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toSongRecord(item: SongLibraryItem): SongRecord {
  return {
    kind: "song",
    id: item.id,
    name: item.name,
    notes: item.notes,
    tags: [...item.tags],
    presetId: item.presetId,
    ...(item.irId === undefined ? {} : { irId: item.irId }),
    ...(item.irCabinet === undefined ? {} : { irCabinet: item.irCabinet }),
    ...(item.irDistance === undefined ? {} : { irDistance: item.irDistance }),
    ...(item.key === undefined ? {} : { key: item.key }),
    ...(item.bpm === undefined ? {} : { bpm: item.bpm }),
    ...(item.delayNote === undefined ? {} : { delayNote: item.delayNote }),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toShowRecord(item: ShowLibraryItem): ShowRecord {
  return {
    kind: "show",
    id: item.id,
    name: item.name,
    notes: item.notes,
    songIds: [...item.songIds],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toIrRecord(item: IrLibraryItem): IrRecord {
  return {
    kind: "ir",
    id: item.id,
    name: item.name,
    notes: item.notes,
    tags: [...item.tags],
    profile: item.profile,
    byteLength: item.byteLength,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/**
 * Adapter from the desktop `LibraryStore` to the platform-agnostic
 * `LibraryRepository` contract used by the sync engine.
 */
export class DesktopLibraryRepository implements LibraryRepository {
  readonly #store: LibraryStore;

  constructor(store: LibraryStore) {
    this.#store = store;
  }

  async snapshot(): Promise<readonly SyncRecord[]> {
    const index = await this.#store.list();
    return [
      ...index.presets.map(toPresetRecord),
      ...index.songs.map(toSongRecord),
      ...index.shows.map(toShowRecord),
      ...index.irs.map(toIrRecord),
    ];
  }

  async upsert(record: SyncRecord): Promise<void> {
    switch (record.kind) {
      case "preset":
        await this.#store.upsertPreset({
          id: record.id,
          kind: "preset",
          name: record.name,
          notes: record.notes,
          tags: [...record.tags],
          profile: record.profile,
          params: { ...record.params },
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        });
        return;
      case "song":
        await this.#store.upsertSong({
          id: record.id,
          kind: "song",
          name: record.name,
          notes: record.notes,
          tags: [...record.tags],
          presetId: record.presetId,
          ...(record.irId === undefined ? {} : { irId: record.irId }),
          ...(record.irCabinet === undefined ? {} : { irCabinet: record.irCabinet }),
          ...(record.irDistance === undefined ? {} : { irDistance: record.irDistance }),
          ...(record.key === undefined ? {} : { key: record.key }),
          ...(record.bpm === undefined ? {} : { bpm: record.bpm }),
          ...(record.delayNote === undefined ? {} : { delayNote: record.delayNote }),
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        });
        return;
      case "show":
        await this.#store.upsertShow({
          id: record.id,
          kind: "show",
          name: record.name,
          notes: record.notes,
          songIds: [...record.songIds],
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        });
        return;
      case "ir":
        await this.#store.updateIrMeta(record.id, {
          name: record.name,
          notes: record.notes,
          tags: [...record.tags],
          profile: record.profile,
          ...(record.byteLength === undefined ? {} : { byteLength: record.byteLength }),
          updatedAt: record.updatedAt,
        });
        return;
    }
  }

  async remove(kind: SyncKind, id: string): Promise<void> {
    switch (kind) {
      case "preset":
        await this.#store.deletePreset(id);
        return;
      case "song":
        await this.#store.deleteSong(id);
        return;
      case "show":
        await this.#store.deleteShow(id);
        return;
      case "ir":
        await this.#store.deleteIr(id);
        return;
    }
  }

  async mergeTwins(twins: readonly PresetTwin[], keep: TwinKeep): Promise<void> {
    const stamp = new Date().toISOString();
    const index = await this.#store.list();
    for (const twin of twins) {
      const keepId = keep === "local" ? twin.localId : twin.remoteId;
      const dropId = keep === "local" ? twin.remoteId : twin.localId;
      for (const song of index.songs) {
        if (song.presetId !== dropId) continue;
        await this.#store.upsertSong({ ...song, presetId: keepId, updatedAt: stamp });
      }
      if (index.presets.some((preset) => preset.id === dropId)) {
        await this.#store.deletePreset(dropId);
      }
    }
  }
}
