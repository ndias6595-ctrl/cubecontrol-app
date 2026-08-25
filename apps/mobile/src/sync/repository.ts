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
import type {
  IrLibraryItem,
  MobileLibrary,
  PresetLibraryItem,
  ShowLibraryItem,
  SongLibraryItem,
} from "../library/types";

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
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function presetFromRecord(record: PresetRecord): PresetLibraryItem {
  return {
    id: record.id,
    kind: "preset",
    name: record.name,
    notes: record.notes,
    tags: [...record.tags],
    profile: record.profile,
    params: { ...record.params },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function songFromRecord(record: SongRecord): SongLibraryItem {
  return {
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
  };
}

function showFromRecord(record: ShowRecord): ShowLibraryItem {
  return {
    id: record.id,
    kind: "show",
    name: record.name,
    notes: record.notes,
    songIds: [...record.songIds],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function upsertRecord(library: MobileLibrary, record: SyncRecord): MobileLibrary {
  switch (record.kind) {
    case "preset": {
      const item = presetFromRecord(record);
      const exists = library.presets.some((p) => p.id === item.id);
      return {
        ...library,
        presets: exists
          ? library.presets.map((p) => (p.id === item.id ? item : p))
          : [item, ...library.presets],
      };
    }
    case "song": {
      const item = songFromRecord(record);
      const exists = library.songs.some((s) => s.id === item.id);
      return {
        ...library,
        songs: exists
          ? library.songs.map((s) => (s.id === item.id ? item : s))
          : [item, ...library.songs],
      };
    }
    case "show": {
      const item = showFromRecord(record);
      const exists = library.shows.some((s) => s.id === item.id);
      return {
        ...library,
        shows: exists
          ? library.shows.map((s) => (s.id === item.id ? item : s))
          : [item, ...library.shows],
      };
    }
    case "ir": {
      // Metadata-only: preserve the local `uri`; skip if the IR has no local file.
      const existing = library.irs.find((ir) => ir.id === record.id);
      if (existing === undefined) return library;
      const item: IrLibraryItem = {
        ...existing,
        name: record.name,
        notes: record.notes,
        tags: [...record.tags],
        profile: record.profile,
        updatedAt: record.updatedAt,
      };
      return {
        ...library,
        irs: library.irs.map((ir) => (ir.id === record.id ? item : ir)),
      };
    }
  }
}

function removeRecord(library: MobileLibrary, kind: SyncKind, id: string): MobileLibrary {
  switch (kind) {
    case "preset":
      return { ...library, presets: library.presets.filter((p) => p.id !== id) };
    case "song":
      return {
        ...library,
        songs: library.songs.filter((s) => s.id !== id),
        shows: library.shows.map((show) => ({
          ...show,
          songIds: show.songIds.filter((songId) => songId !== id),
        })),
      };
    case "show":
      return { ...library, shows: library.shows.filter((s) => s.id !== id) };
    case "ir":
      return { ...library, irs: library.irs.filter((ir) => ir.id !== id) };
  }
}

/**
 * Mobile `LibraryRepository`: maps the single-blob AsyncStorage library onto
 * the sync engine's record model. Holds a working copy mutated in place during
 * `sync()`; the host persists it once after the sync completes.
 */
export class MobileLibraryRepository implements LibraryRepository {
  current: MobileLibrary;

  constructor(initial: MobileLibrary) {
    this.current = initial;
  }

  snapshot(): Promise<readonly SyncRecord[]> {
    return Promise.resolve([
      ...this.current.presets.map(toPresetRecord),
      ...this.current.songs.map(toSongRecord),
      ...this.current.shows.map(toShowRecord),
      ...this.current.irs.map(toIrRecord),
    ]);
  }

  upsert(record: SyncRecord): Promise<void> {
    this.current = upsertRecord(this.current, record);
    return Promise.resolve();
  }

  remove(kind: SyncKind, id: string): Promise<void> {
    this.current = removeRecord(this.current, kind, id);
    return Promise.resolve();
  }

  mergeTwins(twins: readonly PresetTwin[], keep: TwinKeep): void {
    const stamp = new Date().toISOString();
    let library = this.current;
    for (const twin of twins) {
      const keepId = keep === "local" ? twin.localId : twin.remoteId;
      const dropId = keep === "local" ? twin.remoteId : twin.localId;
      library = {
        ...library,
        songs: library.songs.map((song) =>
          song.presetId === dropId ? { ...song, presetId: keepId, updatedAt: stamp } : song,
        ),
        presets: library.presets.filter((preset) => preset.id !== dropId),
      };
    }
    this.current = library;
  }
}
