import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PresetSlotId } from "@tonehub/cube-baby-protocol";
import type {
  IrBackupItem,
  IrLibraryItem,
  LibraryIndex,
  LibraryProfile,
  LiveParamsSnapshot,
  LiveSnapshot,
  PackLibraryItem,
  PackManifest,
  PresetLibraryItem,
  ShowLibraryItem,
  SlotDiffRow,
  SongLibraryItem,
} from "./types.js";
import { SHARE_FORMAT, parseSharePayload, type SharePayload } from "./shareFormat.js";
import { LIVE_PARAM_NAMES } from "@tonehub/cube-baby-protocol";

const INDEX_NAME = "index.json";

function emptyIndex(): LibraryIndex {
  return {
    format: "tonehub-library-index-v1",
    presets: [],
    irs: [],
    irBackups: [],
    packs: [],
    songs: [],
    shows: [],
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export class LibraryStore {
  readonly root: string;
  readonly #userDataPath: string;
  #undo: LiveSnapshot[] = [];
  #redo: LiveSnapshot[] = [];

  constructor(userDataPath: string) {
    this.#userDataPath = userDataPath;
    this.root = path.join(userDataPath, "CubeControl", "library");
  }

  presetsDir(): string {
    return path.join(this.root, "presets");
  }
  irDir(): string {
    return path.join(this.root, "ir");
  }
  historyIrDir(): string {
    return path.join(this.root, "history", "ir");
  }
  packsDir(): string {
    return path.join(this.root, "packs");
  }
  songsDir(): string {
    return path.join(this.root, "songs");
  }
  showsDir(): string {
    return path.join(this.root, "shows");
  }

  async ensure(): Promise<void> {
    await this.#migrateLegacyToneHubFolder();
    await mkdir(this.presetsDir(), { recursive: true });
    await mkdir(this.irDir(), { recursive: true });
    await mkdir(this.historyIrDir(), { recursive: true });
    await mkdir(this.packsDir(), { recursive: true });
    await mkdir(this.songsDir(), { recursive: true });
    await mkdir(this.showsDir(), { recursive: true });
    const indexPath = path.join(this.root, INDEX_NAME);
    try {
      await readFile(indexPath, "utf8");
    } catch {
      await this.#writeIndex(emptyIndex());
    }
  }

  /** Keep presets/IRs if the user already had data under the old ToneHub folder. */
  async #migrateLegacyToneHubFolder(): Promise<void> {
    const legacyRoot = path.join(this.#userDataPath, "ToneHub", "library");
    const nextAppRoot = path.join(this.#userDataPath, "CubeControl");
    try {
      await access(path.join(this.root, INDEX_NAME));
      return; // already on CubeControl
    } catch {
      // continue
    }
    try {
      await access(path.join(legacyRoot, INDEX_NAME));
    } catch {
      return;
    }
    await mkdir(nextAppRoot, { recursive: true });
    try {
      await rename(legacyRoot, this.root);
    } catch {
      // If rename fails (cross-device), leave legacy in place; fresh library will be created.
    }
  }

  async list(): Promise<LibraryIndex> {
    await this.ensure();
    return this.#readIndex();
  }

  async savePreset(input: {
    readonly name: string;
    readonly notes?: string;
    readonly tags?: readonly string[];
    readonly profile?: LibraryProfile;
    readonly params: LiveParamsSnapshot;
    readonly id?: string;
  }): Promise<PresetLibraryItem> {
    await this.ensure();
    const index = await this.#readIndex();
    const stamp = nowIso();
    const id = input.id ?? randomUUID();
    const existing = index.presets.find((item) => item.id === id);
    const item: PresetLibraryItem = {
      id,
      kind: "preset",
      name: input.name.trim() || "Preset sin nombre",
      notes: input.notes?.trim() ?? "",
      tags: [...(input.tags ?? [])],
      profile: input.profile ?? "otro",
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp,
      params: { ...input.params },
    };
    const next = {
      ...index,
      presets: existing
        ? index.presets.map((p) => (p.id === id ? item : p))
        : [item, ...index.presets],
    };
    await writeFile(path.join(this.presetsDir(), `${id}.json`), `${JSON.stringify(item, null, 2)}\n`);
    await this.#writeIndex(next);
    return item;
  }

  async deletePreset(id: string): Promise<void> {
    const index = await this.#readIndex();
    await rm(path.join(this.presetsDir(), `${id}.json`), { force: true });
    await this.#writeIndex({
      ...index,
      presets: index.presets.filter((item) => item.id !== id),
    });
  }

  async importIrWav(input: {
    readonly name: string;
    readonly notes?: string;
    readonly tags?: readonly string[];
    readonly profile?: LibraryProfile;
    readonly wav: Uint8Array;
  }): Promise<IrLibraryItem> {
    await this.ensure();
    const index = await this.#readIndex();
    const id = randomUUID();
    const stamp = nowIso();
    const wavFile = `${id}.wav`;
    await writeFile(path.join(this.irDir(), wavFile), input.wav);
    const item: IrLibraryItem = {
      id,
      kind: "ir",
      name: input.name.trim() || "IR sin nombre",
      notes: input.notes?.trim() ?? "",
      tags: [...(input.tags ?? [])],
      profile: input.profile ?? "otro",
      createdAt: stamp,
      updatedAt: stamp,
      wavFile,
      byteLength: input.wav.byteLength,
    };
    await writeFile(path.join(this.irDir(), `${id}.json`), `${JSON.stringify(item, null, 2)}\n`);
    await this.#writeIndex({ ...index, irs: [item, ...index.irs] });
    return item;
  }

  async readIrWav(id: string): Promise<Uint8Array> {
    const index = await this.#readIndex();
    const item = index.irs.find((ir) => ir.id === id);
    if (item === undefined) throw new Error(`IR ${id} no está en la biblioteca`);
    return new Uint8Array(await readFile(path.join(this.irDir(), item.wavFile)));
  }

  async deleteIr(id: string): Promise<void> {
    const index = await this.#readIndex();
    const item = index.irs.find((ir) => ir.id === id);
    if (item === undefined) return;
    await rm(path.join(this.irDir(), item.wavFile), { force: true });
    await rm(path.join(this.irDir(), `${id}.json`), { force: true });
    await this.#writeIndex({ ...index, irs: index.irs.filter((ir) => ir.id !== id) });
  }

  async saveSong(input: {
    readonly name: string;
    readonly notes?: string;
    readonly tags?: readonly string[];
    readonly presetId: string;
    readonly irId?: string;
    readonly irCabinet?: number;
    readonly irDistance?: number;
    readonly key?: string;
    readonly bpm?: number;
    readonly delayNote?: "1/4" | "1/8" | "1/8d" | "1/16";
    readonly id?: string;
  }): Promise<SongLibraryItem> {
    await this.ensure();
    const index = await this.#readIndex();
    if (!index.presets.some((p) => p.id === input.presetId)) {
      throw new Error("El tono ligado a la canción no existe");
    }
    if (input.irId !== undefined && !index.irs.some((ir) => ir.id === input.irId)) {
      throw new Error("El IR ligado a la canción no existe");
    }
    const stamp = nowIso();
    const id = input.id ?? randomUUID();
    const existing = index.songs.find((item) => item.id === id);
    const item: SongLibraryItem = {
      id,
      kind: "song",
      name: input.name.trim() || "Canción sin nombre",
      notes: input.notes?.trim() ?? "",
      tags: [...(input.tags ?? [])],
      presetId: input.presetId,
      ...(input.irId === undefined ? {} : { irId: input.irId }),
      ...(input.irCabinet === undefined ? {} : { irCabinet: input.irCabinet }),
      ...(input.irDistance === undefined ? {} : { irDistance: input.irDistance }),
      ...(input.key === undefined || input.key.trim() === "" ? {} : { key: input.key.trim() }),
      ...(input.bpm === undefined || !Number.isFinite(input.bpm) ? {} : { bpm: input.bpm }),
      ...(input.delayNote === undefined ? {} : { delayNote: input.delayNote }),
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp,
    };
    const next = {
      ...index,
      songs: existing
        ? index.songs.map((s) => (s.id === id ? item : s))
        : [item, ...index.songs],
    };
    await writeFile(path.join(this.songsDir(), `${id}.json`), `${JSON.stringify(item, null, 2)}\n`);
    await this.#writeIndex(next);
    return item;
  }

  async deleteSong(id: string): Promise<void> {
    const index = await this.#readIndex();
    await rm(path.join(this.songsDir(), `${id}.json`), { force: true });
    await this.#writeIndex({
      ...index,
      songs: index.songs.filter((item) => item.id !== id),
      shows: index.shows.map((show) => ({
        ...show,
        songIds: show.songIds.filter((songId) => songId !== id),
      })),
    });
  }

  async saveShow(input: {
    readonly name: string;
    readonly notes?: string;
    readonly songIds: readonly string[];
    readonly id?: string;
  }): Promise<ShowLibraryItem> {
    await this.ensure();
    const index = await this.#readIndex();
    const stamp = nowIso();
    const id = input.id ?? randomUUID();
    const existing = index.shows.find((item) => item.id === id);
    const known = new Set(index.songs.map((s) => s.id));
    const songIds = input.songIds.filter((songId) => known.has(songId));
    const item: ShowLibraryItem = {
      id,
      kind: "show",
      name: input.name.trim() || "Show sin nombre",
      notes: input.notes?.trim() ?? "",
      songIds,
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp,
    };
    const next = {
      ...index,
      shows: existing
        ? index.shows.map((s) => (s.id === id ? item : s))
        : [item, ...index.shows],
    };
    await writeFile(path.join(this.showsDir(), `${id}.json`), `${JSON.stringify(item, null, 2)}\n`);
    await this.#writeIndex(next);
    return item;
  }

  async deleteShow(id: string): Promise<void> {
    const index = await this.#readIndex();
    await rm(path.join(this.showsDir(), `${id}.json`), { force: true });
    await this.#writeIndex({
      ...index,
      shows: index.shows.filter((item) => item.id !== id),
    });
  }

  /**
   * Sync write path: store an exact record verbatim (preserving `createdAt` and
   * `updatedAt`) so last-write-wins is stable across devices. No UI validation
   * and no timestamp stamping — the sync engine owns the version.
   */
  async upsertPreset(item: PresetLibraryItem): Promise<void> {
    await this.ensure();
    const index = await this.#readIndex();
    const exists = index.presets.some((preset) => preset.id === item.id);
    await writeFile(
      path.join(this.presetsDir(), `${item.id}.json`),
      `${JSON.stringify(item, null, 2)}\n`,
    );
    await this.#writeIndex({
      ...index,
      presets: exists
        ? index.presets.map((preset) => (preset.id === item.id ? item : preset))
        : [item, ...index.presets],
    });
  }

  async upsertSong(item: SongLibraryItem): Promise<void> {
    await this.ensure();
    const index = await this.#readIndex();
    const exists = index.songs.some((song) => song.id === item.id);
    await writeFile(
      path.join(this.songsDir(), `${item.id}.json`),
      `${JSON.stringify(item, null, 2)}\n`,
    );
    await this.#writeIndex({
      ...index,
      songs: exists
        ? index.songs.map((song) => (song.id === item.id ? item : song))
        : [item, ...index.songs],
    });
  }

  async upsertShow(item: ShowLibraryItem): Promise<void> {
    await this.ensure();
    const index = await this.#readIndex();
    const exists = index.shows.some((show) => show.id === item.id);
    await writeFile(
      path.join(this.showsDir(), `${item.id}.json`),
      `${JSON.stringify(item, null, 2)}\n`,
    );
    await this.#writeIndex({
      ...index,
      shows: exists
        ? index.shows.map((show) => (show.id === item.id ? item : show))
        : [item, ...index.shows],
    });
  }

  /**
   * Update IR metadata in place (metadata-only sync). Leaves the WAV file and
   * `wavFile` untouched; a remote-only IR with no local WAV is skipped.
   */
  async updateIrMeta(
    id: string,
    meta: {
      readonly name: string;
      readonly notes: string;
      readonly tags: readonly string[];
      readonly profile: LibraryProfile;
      readonly byteLength?: number;
      readonly updatedAt: string;
    },
  ): Promise<void> {
    const index = await this.#readIndex();
    const existing = index.irs.find((ir) => ir.id === id);
    if (existing === undefined) return;
    const item: IrLibraryItem = {
      ...existing,
      name: meta.name,
      notes: meta.notes,
      tags: [...meta.tags],
      profile: meta.profile,
      ...(meta.byteLength === undefined ? {} : { byteLength: meta.byteLength }),
      updatedAt: meta.updatedAt,
    };
    await writeFile(path.join(this.irDir(), `${id}.json`), `${JSON.stringify(item, null, 2)}\n`);
    await this.#writeIndex({
      ...index,
      irs: index.irs.map((ir) => (ir.id === id ? item : ir)),
    });
  }

  /** Build a pack from a show (presets + IRs referenced by its songs). */
  async exportShowAsPack(showId: string): Promise<PackLibraryItem> {
    const index = await this.#readIndex();
    const show = index.shows.find((s) => s.id === showId);
    if (show === undefined) throw new Error("Show no encontrado");
    const presetIds: string[] = [];
    const irIds: string[] = [];
    for (const songId of show.songIds) {
      const song = index.songs.find((s) => s.id === songId);
      if (song === undefined) continue;
      if (!presetIds.includes(song.presetId)) presetIds.push(song.presetId);
      if (song.irId !== undefined && !irIds.includes(song.irId)) irIds.push(song.irId);
    }
    return this.createPack({
      name: `Show · ${show.name}`,
      notes: show.notes || `Exportado desde show ${show.id}`,
      presetIds,
      irIds,
    });
  }

  async saveIrBackup(input: {
    readonly cabinet: number;
    readonly romSlot: number;
    readonly sector: Uint8Array;
    readonly sourceName?: string;
  }): Promise<IrBackupItem> {
    await this.ensure();
    const index = await this.#readIndex();
    const id = randomUUID();
    const stamp = nowIso();
    const binFile = `cab${input.cabinet}-rom${input.romSlot}-${stamp.replace(/[:.]/g, "")}-${id.slice(0, 8)}.bin`;
    await writeFile(path.join(this.historyIrDir(), binFile), input.sector);
    const item: IrBackupItem = {
      id,
      kind: "ir-backup",
      cabinet: input.cabinet,
      romSlot: input.romSlot,
      createdAt: stamp,
      binFile,
      ...(input.sourceName ? { sourceName: input.sourceName } : {}),
    };
    const irBackups = [item, ...index.irBackups].slice(0, 40);
    // prune files not in index
    const keep = new Set(irBackups.map((b) => b.binFile));
    for (const old of index.irBackups) {
      if (!keep.has(old.binFile)) {
        await rm(path.join(this.historyIrDir(), old.binFile), { force: true });
      }
    }
    await this.#writeIndex({ ...index, irBackups });
    return item;
  }

  async readIrBackup(id: string): Promise<Uint8Array> {
    const index = await this.#readIndex();
    const item = index.irBackups.find((b) => b.id === id);
    if (item === undefined) throw new Error(`backup IR ${id} no encontrado`);
    return new Uint8Array(await readFile(path.join(this.historyIrDir(), item.binFile)));
  }

  pushUndo(snapshot: Omit<LiveSnapshot, "id" | "createdAt"> & { readonly id?: string }): void {
    this.#undo.push({
      id: snapshot.id ?? randomUUID(),
      label: snapshot.label,
      createdAt: nowIso(),
      params: { ...snapshot.params },
      activeSlot: snapshot.activeSlot,
    });
    if (this.#undo.length > 40) this.#undo.shift();
    this.#redo = [];
  }

  undoState(): { readonly undoCount: number; readonly redoCount: number } {
    return { undoCount: this.#undo.length, redoCount: this.#redo.length };
  }

  popUndo(current: {
    readonly params: LiveParamsSnapshot;
    readonly activeSlot: PresetSlotId;
    readonly label?: string;
  }): LiveSnapshot | null {
    const prev = this.#undo.pop();
    if (prev === undefined) return null;
    this.#redo.push({
      id: randomUUID(),
      label: current.label ?? "antes de undo",
      createdAt: nowIso(),
      params: { ...current.params },
      activeSlot: current.activeSlot,
    });
    return prev;
  }

  popRedo(current: {
    readonly params: LiveParamsSnapshot;
    readonly activeSlot: PresetSlotId;
    readonly label?: string;
  }): LiveSnapshot | null {
    const next = this.#redo.pop();
    if (next === undefined) return null;
    this.#undo.push({
      id: randomUUID(),
      label: current.label ?? "antes de redo",
      createdAt: nowIso(),
      params: { ...current.params },
      activeSlot: current.activeSlot,
    });
    return next;
  }

  compareSlots(bank: {
    readonly slots: readonly [
      { readonly slot: PresetSlotId } & LiveParamsSnapshot,
      { readonly slot: PresetSlotId } & LiveParamsSnapshot,
      { readonly slot: PresetSlotId } & LiveParamsSnapshot,
    ];
  }): SlotDiffRow[] {
    const a = bank.slots[0];
    const b = bank.slots[1];
    const c = bank.slots[2];
    return LIVE_PARAM_NAMES.map((param) => {
      const va = a[param];
      const vb = b[param];
      const vc = c[param];
      return {
        param,
        a: va,
        b: vb,
        c: vc,
        differs: !(va === vb && vb === vc),
      };
    });
  }

  async createPack(input: {
    readonly name: string;
    readonly notes?: string;
    readonly presetIds: readonly string[];
    readonly irIds: readonly string[];
    readonly bankJson?: string;
  }): Promise<PackLibraryItem> {
    await this.ensure();
    const index = await this.#readIndex();
    const id = randomUUID();
    const stamp = nowIso();
    const packDir = path.join(this.packsDir(), id);
    await mkdir(packDir, { recursive: true });
    await mkdir(path.join(packDir, "presets"), { recursive: true });
    await mkdir(path.join(packDir, "ir"), { recursive: true });

    for (const presetId of input.presetIds) {
      const preset = index.presets.find((p) => p.id === presetId);
      if (preset === undefined) continue;
      await writeFile(
        path.join(packDir, "presets", `${presetId}.json`),
        `${JSON.stringify(preset, null, 2)}\n`,
      );
    }
    for (const irId of input.irIds) {
      const ir = index.irs.find((item) => item.id === irId);
      if (ir === undefined) continue;
      await writeFile(
        path.join(packDir, "ir", `${irId}.json`),
        `${JSON.stringify(ir, null, 2)}\n`,
      );
      await writeFile(
        path.join(packDir, "ir", ir.wavFile),
        await readFile(path.join(this.irDir(), ir.wavFile)),
      );
    }
    if (input.bankJson !== undefined) {
      await writeFile(path.join(packDir, "bank.json"), input.bankJson, "utf8");
    }

    const manifest: PackManifest = {
      format: "tonehub-pack-v1",
      name: input.name.trim() || "Pack",
      notes: input.notes?.trim() ?? "",
      createdAt: stamp,
      presetIds: [...input.presetIds],
      irIds: [...input.irIds],
      bankIncluded: input.bankJson !== undefined,
    };
    await writeFile(path.join(packDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    const item: PackLibraryItem = {
      id,
      kind: "pack",
      name: manifest.name,
      notes: manifest.notes,
      createdAt: stamp,
      updatedAt: stamp,
      presetIds: manifest.presetIds,
      irIds: manifest.irIds,
      hasBank: manifest.bankIncluded,
    };
    await this.#writeIndex({ ...index, packs: [item, ...index.packs] });
    return item;
  }

  async exportPackZip(packId: string, destZipPath: string): Promise<string> {
    const JSZip = (await import("jszip")).default;
    const packDir = path.join(this.packsDir(), packId);
    const zip = new JSZip();
    await this.#addDirToZip(zip, packDir, "");
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await writeFile(destZipPath, buffer);
    return destZipPath;
  }

  async importPackZip(zipBytes: Uint8Array): Promise<PackLibraryItem> {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(zipBytes);
    const manifestFile = zip.file("manifest.json");
    if (manifestFile === null) throw new Error("pack inválido: falta manifest.json");
    const manifest = JSON.parse(await manifestFile.async("string")) as PackManifest;
    if (manifest.format !== "tonehub-pack-v1") throw new Error("formato de pack no soportado");

    await this.ensure();
    const index = await this.#readIndex();
    const importedPresetIds: string[] = [];
    const importedIrIds: string[] = [];

    for (const presetId of manifest.presetIds) {
      const file = zip.file(`presets/${presetId}.json`);
      if (file === null) continue;
      const preset = JSON.parse(await file.async("string")) as PresetLibraryItem;
      const newId = randomUUID();
      const item: PresetLibraryItem = {
        ...preset,
        id: newId,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await writeFile(
        path.join(this.presetsDir(), `${newId}.json`),
        `${JSON.stringify(item, null, 2)}\n`,
      );
      index.presets.unshift(item);
      importedPresetIds.push(newId);
    }

    for (const irId of manifest.irIds) {
      const metaFile = zip.file(`ir/${irId}.json`);
      if (metaFile === null) continue;
      const meta = JSON.parse(await metaFile.async("string")) as IrLibraryItem;
      const wavFile = zip.file(`ir/${meta.wavFile}`);
      if (wavFile === null) continue;
      const newId = randomUUID();
      const wavName = `${newId}.wav`;
      const wav = new Uint8Array(await wavFile.async("uint8array"));
      await writeFile(path.join(this.irDir(), wavName), wav);
      const item: IrLibraryItem = {
        ...meta,
        id: newId,
        wavFile: wavName,
        byteLength: wav.byteLength,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await writeFile(path.join(this.irDir(), `${newId}.json`), `${JSON.stringify(item, null, 2)}\n`);
      index.irs.unshift(item);
      importedIrIds.push(newId);
    }

    let bankJson: string | undefined;
    const bankFile = zip.file("bank.json");
    if (bankFile !== null) bankJson = await bankFile.async("string");

    // Persist imported presets/IRs first; createPack re-reads the index.
    await this.#writeIndex(index);
    return this.createPack({
      name: `${manifest.name} (import)`,
      notes: manifest.notes,
      presetIds: importedPresetIds,
      irIds: importedIrIds,
      ...(bankJson === undefined ? {} : { bankJson }),
    });
  }

  async buildShare(kind: "preset" | "song" | "show", id: string): Promise<SharePayload> {
    const index = await this.list();
    if (kind === "preset") {
      const preset = index.presets.find((item) => item.id === id);
      if (preset === undefined) throw new Error("Tono no encontrado");
      return {
        format: SHARE_FORMAT,
        kind: "preset",
        name: preset.name,
        createdAt: nowIso(),
        presets: [
          {
            name: preset.name,
            notes: preset.notes,
            tags: [...preset.tags],
            profile: preset.profile,
            params: { ...preset.params },
          },
        ],
        songs: [],
        shows: [],
      };
    }
    if (kind === "song") {
      const song = index.songs.find((item) => item.id === id);
      if (song === undefined) throw new Error("Canción no encontrada");
      const preset = index.presets.find((item) => item.id === song.presetId);
      if (preset === undefined) throw new Error("Tono de la canción no encontrado");
      return {
        format: SHARE_FORMAT,
        kind: "song",
        name: song.name,
        createdAt: nowIso(),
        presets: [
          {
            name: preset.name,
            notes: preset.notes,
            tags: [...preset.tags],
            profile: preset.profile,
            params: { ...preset.params },
          },
        ],
        songs: [
          {
            name: song.name,
            notes: song.notes,
            tags: [...song.tags],
            presetIndex: 0,
            ...(song.bpm !== undefined ? { bpm: song.bpm } : {}),
            ...(song.delayNote ? { delayNote: song.delayNote } : {}),
            ...(song.key ? { key: song.key } : {}),
          },
        ],
        shows: [],
      };
    }
    const show = index.shows.find((item) => item.id === id);
    if (show === undefined) throw new Error("Show no encontrado");
    const usedPresets: PresetLibraryItem[] = [];
    const usedSongs: SongLibraryItem[] = [];
    for (const songId of show.songIds) {
      const song = index.songs.find((item) => item.id === songId);
      if (!song) continue;
      if (!usedPresets.some((item) => item.id === song.presetId)) {
        const preset = index.presets.find((item) => item.id === song.presetId);
        if (!preset) continue;
        usedPresets.push(preset);
      }
      usedSongs.push(song);
    }
    if (usedPresets.length === 0) throw new Error("El show no tiene tonos para compartir");
    return {
      format: SHARE_FORMAT,
      kind: "show",
      name: show.name,
      createdAt: nowIso(),
      presets: usedPresets.map((preset) => ({
        name: preset.name,
        notes: preset.notes,
        tags: [...preset.tags],
        profile: preset.profile,
        params: { ...preset.params },
      })),
      songs: usedSongs.map((song) => ({
        name: song.name,
        notes: song.notes,
        tags: [...song.tags],
        presetIndex: Math.max(
          0,
          usedPresets.findIndex((item) => item.id === song.presetId),
        ),
        ...(song.bpm !== undefined ? { bpm: song.bpm } : {}),
        ...(song.delayNote ? { delayNote: song.delayNote } : {}),
        ...(song.key ? { key: song.key } : {}),
      })),
      shows: [{ name: show.name, notes: show.notes, songIndexes: usedSongs.map((_, i) => i) }],
    };
  }

  async importShare(payload: SharePayload): Promise<{
    readonly name: string;
    readonly presets: number;
    readonly songs: number;
    readonly shows: number;
  }> {
    await this.ensure();
    const parsed = parseSharePayload(payload);
    if (parsed === null) throw new Error("archivo CubeControl no reconocido");
    const stamp = nowIso();
    const index = await this.#readIndex();
    const presets: PresetLibraryItem[] = [];
    for (const preset of parsed.presets) {
      const id = randomUUID();
      const item: PresetLibraryItem = {
        id,
        kind: "preset",
        name: preset.name,
        notes: preset.notes,
        tags: [...preset.tags],
        profile: preset.profile,
        params: preset.params as LiveParamsSnapshot,
        createdAt: stamp,
        updatedAt: stamp,
      };
      await writeFile(
        path.join(this.presetsDir(), `${id}.json`),
        `${JSON.stringify(item, null, 2)}\n`,
      );
      presets.push(item);
      index.presets.unshift(item);
    }
    const songs: SongLibraryItem[] = [];
    for (const song of parsed.songs) {
      const id = randomUUID();
      const presetId = presets[song.presetIndex]?.id ?? presets[0]!.id;
      const item: SongLibraryItem = {
        id,
        kind: "song",
        name: song.name,
        notes: song.notes,
        tags: [...song.tags],
        presetId,
        ...(song.bpm !== undefined ? { bpm: song.bpm } : {}),
        ...(song.delayNote === "1/4" ||
        song.delayNote === "1/8" ||
        song.delayNote === "1/8d" ||
        song.delayNote === "1/16"
          ? { delayNote: song.delayNote }
          : {}),
        ...(song.key ? { key: song.key } : {}),
        createdAt: stamp,
        updatedAt: stamp,
      };
      await writeFile(path.join(this.songsDir(), `${id}.json`), `${JSON.stringify(item, null, 2)}\n`);
      songs.push(item);
      index.songs.unshift(item);
    }
    const shows: ShowLibraryItem[] = [];
    for (const show of parsed.shows) {
      const id = randomUUID();
      const item: ShowLibraryItem = {
        id,
        kind: "show",
        name: show.name,
        notes: show.notes,
        songIds: show.songIndexes
          .map((songIndex) => songs[songIndex]?.id)
          .filter((songId): songId is string => typeof songId === "string"),
        createdAt: stamp,
        updatedAt: stamp,
      };
      await writeFile(path.join(this.showsDir(), `${id}.json`), `${JSON.stringify(item, null, 2)}\n`);
      shows.push(item);
      index.shows.unshift(item);
    }
    await this.#writeIndex(index);
    return {
      name: parsed.name,
      presets: presets.length,
      songs: songs.length,
      shows: shows.length,
    };
  }

  libraryFingerprint(): string {
    return createHash("sha1").update(this.root).digest("hex").slice(0, 8);
  }

  async #addDirToZip(zip: import("jszip"), dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await this.#addDirToZip(zip, full, rel);
      } else {
        zip.file(rel, await readFile(full));
      }
    }
  }

  async #readIndex(): Promise<LibraryIndex> {
    const raw = await readFile(path.join(this.root, INDEX_NAME), "utf8");
    const parsed = JSON.parse(raw) as Partial<LibraryIndex>;
    if (parsed.format !== "tonehub-library-index-v1") {
      throw new Error("índice de biblioteca corrupto");
    }
    return {
      format: "tonehub-library-index-v1",
      presets: parsed.presets ?? [],
      irs: parsed.irs ?? [],
      irBackups: parsed.irBackups ?? [],
      packs: parsed.packs ?? [],
      songs: parsed.songs ?? [],
      shows: parsed.shows ?? [],
    };
  }

  async #writeIndex(index: LibraryIndex): Promise<void> {
    await writeFile(path.join(this.root, INDEX_NAME), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  }
}
