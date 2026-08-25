import { useCallback, useEffect, useMemo, useState } from "react";
import type { PresetSlotId } from "@tonehub/cube-baby-protocol";
import type {
  IrLibraryItem,
  LibraryIndex,
  LibraryProfile,
  PresetLibraryItem,
  ShowLibraryItem,
  SongLibraryItem,
} from "../../electron/library/types";
import { FAVORITE_TAG } from "../../electron/library/types";
import type { LiveParamsSnapshot } from "../types/device";
import { MicDistanceRail } from "./cube-baby/MicDistanceRail";
import { DEFAULT_DELAY_NOTE, DELAY_NOTE_IDS, clampBpm, isDelayNoteId, type DelayNoteId } from "../music/delaySync";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { useI18n } from "../i18n";
import "./library-workspace.css";

export type LibrarySection = "tones" | "songs" | "shows" | "more";

type LibraryWorkspaceProps = {
  readonly busy: boolean;
  readonly liveParams: LiveParamsSnapshot;
  readonly irCabinet: number;
  readonly irDistance: number;
  readonly activeShowId: string | null;
  readonly activeSongIndex: number;
  readonly onIrDistanceChange: (d: number) => void;
  readonly onStatus: (message: string | null) => void;
  readonly onError: (message: string | null) => void;
  readonly onBusy: (busy: boolean) => void;
  readonly onApplyPreset: (params: LiveParamsSnapshot, label: string) => Promise<void>;
  readonly onApplySong: (song: SongLibraryItem) => Promise<void>;
  readonly onArmBank: (slots: {
    readonly A: SongLibraryItem | null;
    readonly B: SongLibraryItem | null;
    readonly C: SongLibraryItem | null;
  }) => Promise<void>;
  readonly onAssignSongToSlot: (song: SongLibraryItem, slot: PresetSlotId) => Promise<void>;
  readonly onActiveShowChange: (showId: string | null, songIndex?: number) => void;
  readonly onEnterStage: (showId: string) => void;
  readonly onCabinetApplied: (cabinet: number) => void;
};

const PROFILES: readonly LibraryProfile[] = ["ensayo", "directo", "grabacion", "otro"];

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

function isFavorite(tags: readonly string[]): boolean {
  return tags.includes(FAVORITE_TAG);
}

function toggleFavoriteTag(tags: readonly string[]): string[] {
  return isFavorite(tags)
    ? tags.filter((t) => t !== FAVORITE_TAG)
    : [...tags, FAVORITE_TAG];
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  } catch {
    return "";
  }
}

type SaveSheet = {
  readonly mode: "new" | "update";
  readonly id?: string;
  readonly name: string;
  readonly profile: LibraryProfile;
  readonly notes: string;
  readonly tags: string;
};

export function LibraryWorkspace(props: LibraryWorkspaceProps) {
  const {
    busy,
    liveParams,
    irCabinet,
    irDistance,
    activeShowId,
    activeSongIndex,
    onIrDistanceChange,
    onStatus,
    onError,
    onBusy,
    onApplyPreset,
    onApplySong,
    onArmBank,
    onAssignSongToSlot,
    onActiveShowChange,
    onEnterStage,
    onCabinetApplied,
  } = props;

  const { t } = useI18n();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const profileLabel = (p: LibraryProfile) => t(`lib.profile.${p}`);
  const [section, setSection] = useState<LibrarySection>("tones");
  const [index, setIndex] = useState<LibraryIndex>(emptyIndex());
  const [query, setQuery] = useState("");
  const [profileFilter, setProfileFilter] = useState<LibraryProfile | "all" | "favorites">("all");
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [selectedShowId, setSelectedShowId] = useState<string | null>(null);
  const [saveSheet, setSaveSheet] = useState<SaveSheet | null>(null);
  const [songDraft, setSongDraft] = useState<{
    step: 1 | 2;
    name: string;
    presetId: string;
    irId: string;
    notes: string;
    bpm: number | "";
    delayNote: DelayNoteId;
    id?: string;
  } | null>(null);
  const [armSlots, setArmSlots] = useState<{
    A: string | null;
    B: string | null;
    C: string | null;
  }>({ A: null, B: null, C: null });
  const [armOpen, setArmOpen] = useState(false);
  const [dragSongId, setDragSongId] = useState<string | null>(null);
  const [moreTab, setMoreTab] = useState<"irs" | "backups" | "export">("irs");
  const [grooveBpm, setGrooveBpm] = useState<number | "">("");
  const [grooveNote, setGrooveNote] = useState<DelayNoteId>(DEFAULT_DELAY_NOTE);

  const refresh = useCallback(async () => {
    const next = await window.tonehubDesktop.library.list();
    setIndex(next);
  }, []);

  useEffect(() => {
    void refresh().catch((err: unknown) => {
      onError(err instanceof Error ? err.message : String(err));
    });
  }, [refresh, onError]);

  useEffect(() => {
    return window.tonehubDesktop.sync.onSynced(() => {
      void refresh().catch(() => undefined);
    });
  }, [refresh]);

  useEffect(() => {
    if (activeShowId) setSelectedShowId(activeShowId);
  }, [activeShowId]);

  const filteredPresets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return index.presets.filter((p) => {
      if (profileFilter === "favorites" && !isFavorite(p.tags)) return false;
      if (profileFilter !== "all" && profileFilter !== "favorites" && p.profile !== profileFilter) {
        return false;
      }
      if (q === "") return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.notes.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [index.presets, query, profileFilter]);

  const filteredSongs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return index.songs.filter((s) => {
      if (q === "") return true;
      return s.name.toLowerCase().includes(q) || s.notes.toLowerCase().includes(q);
    });
  }, [index.songs, query]);

  const selectedShow = index.shows.find((s) => s.id === selectedShowId) ?? null;
  const selectedPreset = index.presets.find((p) => p.id === selectedPresetId) ?? null;
  const selectedSong = index.songs.find((s) => s.id === selectedSongId) ?? null;

  useEffect(() => {
    if (selectedSong === null) return;
    setGrooveBpm(selectedSong.bpm ?? "");
    setGrooveNote(isDelayNoteId(selectedSong.delayNote) ? selectedSong.delayNote : DEFAULT_DELAY_NOTE);
  }, [selectedSong]);

  async function runBusy(fn: () => Promise<void>) {
    onBusy(true);
    onError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      onBusy(false);
    }
  }

  async function persistPreset(sheet: SaveSheet) {
    await runBusy(async () => {
      const tags = sheet.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const item = await window.tonehubDesktop.library.savePreset({
        name: sheet.name,
        profile: sheet.profile,
        notes: sheet.notes,
        tags,
        params: liveParams,
        ...(sheet.mode === "update" && sheet.id ? { id: sheet.id } : {}),
      });
      setSelectedPresetId(item.id);
      setSaveSheet(null);
      onStatus(
        sheet.mode === "update"
          ? t("lib.toneUpdated", { name: item.name })
          : t("lib.toneSaved", { name: item.name }),
      );
    });
  }

  async function toggleFavorite(preset: PresetLibraryItem) {
    await runBusy(async () => {
      await window.tonehubDesktop.library.savePreset({
        id: preset.id,
        name: preset.name,
        notes: preset.notes,
        tags: toggleFavoriteTag(preset.tags),
        profile: preset.profile,
        params: preset.params,
      });
    });
  }

  async function deletePreset(id: string) {
    const ok = await confirm({
      title: t("lib.deleteToneTitle"),
      body: t("lib.deleteToneBody"),
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    await runBusy(async () => {
      await window.tonehubDesktop.library.deletePreset(id);
      if (selectedPresetId === id) setSelectedPresetId(null);
      onStatus(t("lib.toneDeleted"));
    });
  }

  async function saveSongFromDraft() {
    if (songDraft === null || songDraft.presetId === "") return;
    await runBusy(async () => {
      const item = await window.tonehubDesktop.library.saveSong({
        name: songDraft.name,
        notes: songDraft.notes,
        presetId: songDraft.presetId,
        ...(songDraft.irId ? { irId: songDraft.irId, irCabinet, irDistance } : {}),
        ...(songDraft.bpm === "" ? {} : { bpm: clampBpm(songDraft.bpm) }),
        delayNote: songDraft.delayNote,
        ...(songDraft.id ? { id: songDraft.id } : {}),
      });
      setSongDraft(null);
      setSelectedSongId(item.id);
      setSection("songs");
      onStatus(t("lib.songReady", { name: item.name }));
    });
  }

  async function saveSelectedSongGroove() {
    if (selectedSong === null) return;
    await runBusy(async () => {
      await window.tonehubDesktop.library.saveSong({
        id: selectedSong.id,
        name: selectedSong.name,
        notes: selectedSong.notes,
        tags: [...selectedSong.tags],
        presetId: selectedSong.presetId,
        ...(selectedSong.irId ? { irId: selectedSong.irId } : {}),
        ...(selectedSong.irCabinet === undefined ? {} : { irCabinet: selectedSong.irCabinet }),
        ...(selectedSong.irDistance === undefined ? {} : { irDistance: selectedSong.irDistance }),
        ...(grooveBpm === "" ? {} : { bpm: clampBpm(grooveBpm) }),
        delayNote: grooveNote,
        ...(selectedSong.key ? { key: selectedSong.key } : {}),
      });
      onStatus(t("groove.saved", { name: selectedSong.name }));
    });
  }

  async function deleteSong(id: string) {
    const ok = await confirm({
      title: t("lib.deleteSongTitle"),
      body: t("lib.deleteSongBody"),
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    await runBusy(async () => {
      await window.tonehubDesktop.library.deleteSong(id);
      if (selectedSongId === id) setSelectedSongId(null);
      onStatus(t("lib.songDeleted"));
    });
  }

  async function createShow() {
    await runBusy(async () => {
      const item = await window.tonehubDesktop.library.saveShow({
        name: t("lib.showNameDefault", { n: index.shows.length + 1 }),
        songIds: [],
      });
      setSelectedShowId(item.id);
      onActiveShowChange(item.id, 0);
      onStatus(t("lib.showCreated", { name: item.name }));
    });
  }

  async function updateShowSongs(show: ShowLibraryItem, songIds: string[]) {
    await runBusy(async () => {
      await window.tonehubDesktop.library.saveShow({
        id: show.id,
        name: show.name,
        notes: show.notes,
        songIds,
      });
    });
  }

  async function renameShow(show: ShowLibraryItem, name: string) {
    await runBusy(async () => {
      await window.tonehubDesktop.library.saveShow({
        id: show.id,
        name,
        notes: show.notes,
        songIds: [...show.songIds],
      });
    });
  }

  async function deleteShow(id: string) {
    const ok = await confirm({
      title: t("lib.deleteShowTitle"),
      body: t("lib.deleteShowBody"),
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    await runBusy(async () => {
      await window.tonehubDesktop.library.deleteShow(id);
      if (selectedShowId === id) setSelectedShowId(null);
      if (activeShowId === id) onActiveShowChange(null);
      onStatus(t("lib.showDeleted"));
    });
  }

  function onDropReorder(targetId: string) {
    if (selectedShow === null || dragSongId === null || dragSongId === targetId) {
      setDragSongId(null);
      return;
    }
    const ids = [...selectedShow.songIds];
    const from = ids.indexOf(dragSongId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) {
      setDragSongId(null);
      return;
    }
    ids.splice(from, 1);
    ids.splice(to, 0, dragSongId);
    setDragSongId(null);
    void updateShowSongs(selectedShow, ids);
  }

  async function confirmArm() {
    const resolve = (id: string | null) =>
      id === null ? null : (index.songs.find((s) => s.id === id) ?? null);
    await onArmBank({
      A: resolve(armSlots.A),
      B: resolve(armSlots.B),
      C: resolve(armSlots.C),
    });
    setArmOpen(false);
  }

  async function importIrFile(file: File | undefined) {
    if (file === undefined) return;
    await runBusy(async () => {
      const wav = new Uint8Array(await file.arrayBuffer());
      const item = await window.tonehubDesktop.library.importIrWav({
        name: file.name.replace(/\.wav$/i, ""),
        wav,
        profile: "otro",
      });
      onStatus(t("lib.irImported", { name: item.name }));
    });
  }

  async function loadIr(item: IrLibraryItem) {
    if (irCabinet !== 8) {
      const ok = await confirm({
        title: t("lib.irLoadTitle", { name: item.name, cab: irCabinet }),
        body: t("lib.irLoadBody"),
        tone: "danger",
        confirmLabel: t("common.follow"),
      });
      if (!ok) return;
      const ok2 = await confirm({
        title: t("lib.irLastTitle"),
        body: t("lib.irLastBody", { cab: irCabinet }),
        tone: "danger",
        requireTyped: `CAB${irCabinet}`,
        confirmLabel: t("lib.irWrite"),
      });
      if (!ok2) return;
    }
    await runBusy(async () => {
      const result = await window.tonehubDesktop.library.loadIrToPedal(item.id, irCabinet, {
        confirmFactoryIrOverwrite: irCabinet !== 8,
        distance: irDistance,
      });
      onCabinetApplied(result.cabinet);
      onStatus(
        t("lib.irApplied", { cab: result.cabinet, pct: Math.round(irDistance * 100) }),
      );
    });
  }

  async function exportShow() {
    if (selectedShow === null) return;
    await runBusy(async () => {
      const pack = await window.tonehubDesktop.library.exportShowAsPack(selectedShow.id);
      const exported = await window.tonehubDesktop.library.exportPack(pack.id);
      onStatus(
        exported
          ? t("lib.showExported", { path: exported.path })
          : t("lib.exportCancelled"),
      );
    });
  }

  return (
    <div className="lib-ws" aria-label={t("lib.aria")}>
      <header className="lib-ws__top">
        <div className="lib-ws__brand">
          <h1 className="lib-ws__title">{t("lib.title")}</h1>
          <p className="lib-ws__subtitle">{t("lib.subtitle")}</p>
        </div>
        <nav className="lib-ws__nav" aria-label={t("lib.navAria")}>
          {(
            [
              ["tones", t("lib.tones")],
              ["songs", t("lib.songs")],
              ["shows", t("lib.shows")],
              ["more", t("lib.more")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={section === id ? "lib-ws__nav-btn is-active" : "lib-ws__nav-btn"}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="lib-ws__body" aria-live="polite">
        {section === "tones" ? (
          <>
            <aside className="lib-ws__list-pane">
              <label className="lib-ws__search">
                <span className="visually-hidden">{t("lib.searchTones")}</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("lib.searchTonesPh")}
                  disabled={busy}
                />
              </label>
              <div className="lib-ws__chips" role="group" aria-label={t("lib.filters")}>
                <button
                  type="button"
                  className={profileFilter === "all" ? "lib-ws__chip is-on" : "lib-ws__chip"}
                  onClick={() => setProfileFilter("all")}
                >
                  {t("common.all")}
                </button>
                <button
                  type="button"
                  className={profileFilter === "favorites" ? "lib-ws__chip is-on" : "lib-ws__chip"}
                  onClick={() => setProfileFilter("favorites")}
                >
                  {t("common.favorites")}
                </button>
                {PROFILES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={profileFilter === p ? "lib-ws__chip is-on" : "lib-ws__chip"}
                    onClick={() => setProfileFilter(p)}
                  >
                    {profileLabel(p)}
                  </button>
                ))}
              </div>
              <ul className="lib-ws__rows">
                {filteredPresets.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={
                        selectedPresetId === p.id ? "lib-ws__row is-selected" : "lib-ws__row"
                      }
                      onClick={() => setSelectedPresetId(p.id)}
                    >
                      <span className="lib-ws__row-title">
                        {isFavorite(p.tags) ? "★ " : ""}
                        {p.name}
                      </span>
                      <span className="lib-ws__row-meta">
                        {profileLabel(p.profile)} · {formatDate(p.updatedAt)}
                      </span>
                    </button>
                  </li>
                ))}
                {filteredPresets.length === 0 ? (
                  <li className="lib-ws__empty">{t("lib.noToneMatch")}</li>
                ) : null}
              </ul>
              <div className="lib-ws__list-actions">
                <button
                  type="button"
                  className="lib-ws__primary"
                  disabled={busy}
                  onClick={() =>
                    setSaveSheet({
                      mode: "new",
                      name: t("lib.myTone"),
                      profile: "ensayo",
                      notes: "",
                      tags: "",
                    })
                  }
                >
                  {t("lib.saveLiveHere")}
                </button>
              </div>
            </aside>
            <main className="lib-ws__detail">
              {selectedPreset === null ? (
                <p className="lib-ws__placeholder">{t("lib.tonePickHint")}</p>
              ) : (
                <div className="lib-ws__detail-card">
                  <h2 className="lib-ws__detail-title">{selectedPreset.name}</h2>
                  <p className="lib-ws__detail-meta">
                    {profileLabel(selectedPreset.profile)}
                    {selectedPreset.notes ? ` · ${selectedPreset.notes}` : ""}
                  </p>
                  <div className="lib-ws__detail-actions">
                    <button
                      type="button"
                      className="lib-ws__primary lib-ws__primary--lg"
                      disabled={busy}
                      onClick={() =>
                        void onApplyPreset(
                          selectedPreset.params,
                          t("lib.toneMeta", { date: selectedPreset.name }),
                        )
                      }
                    >
                      {t("lib.applyLive")}
                    </button>
                    <button
                      type="button"
                      className="lib-ws__ghost"
                      disabled={busy}
                      onClick={() => void toggleFavorite(selectedPreset)}
                    >
                      {isFavorite(selectedPreset.tags) ? t("lib.unfavorite") : t("lib.favorite")}
                    </button>
                    <button
                      type="button"
                      className="lib-ws__ghost"
                      disabled={busy}
                      onClick={() =>
                        setSaveSheet({
                          mode: "update",
                          id: selectedPreset.id,
                          name: selectedPreset.name,
                          profile: selectedPreset.profile,
                          notes: selectedPreset.notes,
                          tags: selectedPreset.tags.filter((tag) => tag !== FAVORITE_TAG).join(", "),
                        })
                      }
                    >
                      {t("lib.updateWithLive")}
                    </button>
                    <button
                      type="button"
                      className="lib-ws__ghost"
                      disabled={busy}
                      onClick={() =>
                        void runBusy(async () => {
                          const exported = await window.tonehubDesktop.library.exportShare(
                            "preset",
                            selectedPreset.id,
                          );
                          onStatus(
                            exported
                              ? t("share.exported", { path: exported.path })
                              : t("common.cancelled"),
                          );
                        })
                      }
                    >
                      {t("share.action")}
                    </button>
                    <button
                      type="button"
                      className="lib-ws__danger"
                      disabled={busy}
                      onClick={() => void deletePreset(selectedPreset.id)}
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                </div>
              )}
            </main>
          </>
        ) : null}

        {section === "songs" ? (
          <>
            <aside className="lib-ws__list-pane">
              <label className="lib-ws__search">
                <span className="visually-hidden">{t("lib.searchSongs")}</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("lib.searchSongsPh")}
                  disabled={busy}
                />
              </label>
              <ul className="lib-ws__rows">
                {filteredSongs.map((s) => {
                  const tone = index.presets.find((p) => p.id === s.presetId);
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        className={
                          selectedSongId === s.id ? "lib-ws__row is-selected" : "lib-ws__row"
                        }
                        onClick={() => setSelectedSongId(s.id)}
                      >
                        <span className="lib-ws__row-title">{s.name}</span>
                        <span className="lib-ws__row-meta">
                          {tone?.name ?? t("lib.missingTone")}
                          {s.bpm !== undefined ? ` · ${s.bpm} BPM` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {filteredSongs.length === 0 ? (
                  <li className="lib-ws__empty">{t("lib.createSongHint")}</li>
                ) : null}
              </ul>
              <div className="lib-ws__list-actions">
                <button
                  type="button"
                  className="lib-ws__primary"
                  disabled={busy || index.presets.length === 0}
                  onClick={() =>
                    setSongDraft({
                      step: 1,
                      name: t("lib.newSong"),
                      presetId: index.presets[0]?.id ?? "",
                      irId: "",
                      notes: "",
                      bpm: "",
                      delayNote: DEFAULT_DELAY_NOTE,
                    })
                  }
                >
                  {t("lib.newSong")}
                </button>
              </div>
            </aside>
            <main className="lib-ws__detail">
              {songDraft !== null ? (
                <div className="lib-ws__detail-card">
                  <h2 className="lib-ws__detail-title">
                    {songDraft.step === 1 ? t("lib.songStep1") : t("lib.songStep2")}
                  </h2>
                  {songDraft.step === 1 ? (
                    <>
                      <label className="lib-ws__field">
                        {t("common.name")}
                        <input
                          value={songDraft.name}
                          onChange={(e) => setSongDraft({ ...songDraft, name: e.target.value })}
                        />
                      </label>
                      <div className="lib-ws__tempo-row" aria-label={t("groove.aria")}>
                        <label className="lib-ws__field lib-ws__field--inline">
                          {t("groove.bpm")}
                          <input
                            type="number"
                            min={40}
                            max={240}
                            inputMode="numeric"
                            disabled={busy}
                            value={songDraft.bpm}
                            placeholder="120"
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === "") {
                                setSongDraft({ ...songDraft, bpm: "" });
                                return;
                              }
                              const n = Number(raw);
                              setSongDraft({
                                ...songDraft,
                                bpm: Number.isFinite(n) ? n : "",
                              });
                            }}
                          />
                        </label>
                        <label className="lib-ws__field lib-ws__field--inline">
                          {t("groove.note")}
                          <select
                            disabled={busy}
                            value={songDraft.delayNote}
                            onChange={(e) =>
                              setSongDraft({
                                ...songDraft,
                                delayNote: (e.target.value as DelayNoteId) || DEFAULT_DELAY_NOTE,
                              })
                            }
                          >
                            {DELAY_NOTE_IDS.map((id) => (
                              <option key={id} value={id}>
                                {t(
                                  id === "1/4"
                                    ? "groove.note.quarter"
                                    : id === "1/8"
                                      ? "groove.note.eighth"
                                      : id === "1/8d"
                                        ? "groove.note.dottedEighth"
                                        : "groove.note.sixteenth",
                                )}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <ul className="lib-ws__pick">
                        {index.presets.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              className={
                                songDraft.presetId === p.id
                                  ? "lib-ws__row is-selected"
                                  : "lib-ws__row"
                              }
                              onClick={() => setSongDraft({ ...songDraft, presetId: p.id })}
                            >
                              <span className="lib-ws__row-title">{p.name}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      <div className="lib-ws__detail-actions">
                        <button
                          type="button"
                          className="lib-ws__primary"
                          onClick={() => setSongDraft({ ...songDraft, step: 2 })}
                        >
                          {t("common.next")}
                        </button>
                        <button
                          type="button"
                          className="lib-ws__ghost"
                          onClick={() => setSongDraft(null)}
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="lib-ws__detail-meta">{t("lib.songIrSkip")}</p>
                      <ul className="lib-ws__pick">
                        <li>
                          <button
                            type="button"
                            className={
                              songDraft.irId === "" ? "lib-ws__row is-selected" : "lib-ws__row"
                            }
                            onClick={() => setSongDraft({ ...songDraft, irId: "" })}
                          >
                            <span className="lib-ws__row-title">{t("lib.noIr")}</span>
                          </button>
                        </li>
                        {index.irs.map((ir) => (
                          <li key={ir.id}>
                            <button
                              type="button"
                              className={
                                songDraft.irId === ir.id
                                  ? "lib-ws__row is-selected"
                                  : "lib-ws__row"
                              }
                              onClick={() => setSongDraft({ ...songDraft, irId: ir.id })}
                            >
                              <span className="lib-ws__row-title">{ir.name}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      {songDraft.irId ? (
                        <MicDistanceRail
                          compact
                          value={irDistance}
                          onChange={onIrDistanceChange}
                          disabled={busy}
                        />
                      ) : null}
                      <div className="lib-ws__detail-actions">
                        <button
                          type="button"
                          className="lib-ws__primary lib-ws__primary--lg"
                          disabled={busy}
                          onClick={() => void saveSongFromDraft()}
                        >
                          {t("lib.saveSong")}
                        </button>
                        <button
                          type="button"
                          className="lib-ws__ghost"
                          onClick={() => setSongDraft({ ...songDraft, step: 1 })}
                        >
                          {t("common.back")}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : selectedSong === null ? (
                <p className="lib-ws__placeholder">{t("lib.songExplain")}</p>
              ) : (
                <div className="lib-ws__detail-card">
                  <h2 className="lib-ws__detail-title">{selectedSong.name}</h2>
                  <p className="lib-ws__detail-meta">
                    {t("lib.toneLabel")}{" "}
                    {index.presets.find((p) => p.id === selectedSong.presetId)?.name ?? "—"}
                    {selectedSong.irId
                      ? ` · IR: ${index.irs.find((i) => i.id === selectedSong.irId)?.name ?? "—"}`
                      : ""}
                    {selectedSong.bpm !== undefined
                      ? ` · ${selectedSong.bpm} BPM · ${selectedSong.delayNote ?? DEFAULT_DELAY_NOTE}`
                      : ""}
                    {selectedSong.key ? ` · ${selectedSong.key}` : ""}
                  </p>
                  <div className="lib-ws__tempo-row" aria-label={t("groove.aria")}>
                    <label className="lib-ws__field lib-ws__field--inline">
                      {t("groove.bpm")}
                      <input
                        type="number"
                        min={40}
                        max={240}
                        inputMode="numeric"
                        disabled={busy}
                        value={grooveBpm}
                        placeholder="120"
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "") {
                            setGrooveBpm("");
                            return;
                          }
                          const n = Number(raw);
                          setGrooveBpm(Number.isFinite(n) ? n : "");
                        }}
                      />
                    </label>
                    <label className="lib-ws__field lib-ws__field--inline">
                      {t("groove.note")}
                      <select
                        disabled={busy}
                        value={grooveNote}
                        onChange={(e) =>
                          setGrooveNote((e.target.value as DelayNoteId) || DEFAULT_DELAY_NOTE)
                        }
                      >
                        {DELAY_NOTE_IDS.map((id) => (
                          <option key={id} value={id}>
                            {t(
                              id === "1/4"
                                ? "groove.note.quarter"
                                : id === "1/8"
                                  ? "groove.note.eighth"
                                  : id === "1/8d"
                                    ? "groove.note.dottedEighth"
                                    : "groove.note.sixteenth",
                            )}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="lib-ws__detail-actions">
                    <button
                      type="button"
                      className="lib-ws__ghost"
                      disabled={busy}
                      onClick={() => void saveSelectedSongGroove()}
                    >
                      {t("groove.save")}
                    </button>
                    <button
                      type="button"
                      className="lib-ws__primary lib-ws__primary--lg"
                      disabled={busy}
                      onClick={() => void onApplySong(selectedSong)}
                    >
                      {t("lib.applySong")}
                    </button>
                    <button
                      type="button"
                      className="lib-ws__ghost"
                      disabled={busy}
                      onClick={() => void onAssignSongToSlot(selectedSong, "A")}
                    >
                      → Foot A
                    </button>
                    <button
                      type="button"
                      className="lib-ws__ghost"
                      disabled={busy}
                      onClick={() => void onAssignSongToSlot(selectedSong, "B")}
                    >
                      → Foot B
                    </button>
                    <button
                      type="button"
                      className="lib-ws__ghost"
                      disabled={busy}
                      onClick={() => void onAssignSongToSlot(selectedSong, "C")}
                    >
                      → Foot C
                    </button>
                    <button
                      type="button"
                      className="lib-ws__ghost"
                      disabled={busy}
                      onClick={() =>
                        void runBusy(async () => {
                          const exported = await window.tonehubDesktop.library.exportShare(
                            "song",
                            selectedSong.id,
                          );
                          onStatus(
                            exported
                              ? t("share.exported", { path: exported.path })
                              : t("common.cancelled"),
                          );
                        })
                      }
                    >
                      {t("share.action")}
                    </button>
                    <button
                      type="button"
                      className="lib-ws__danger"
                      disabled={busy}
                      onClick={() => void deleteSong(selectedSong.id)}
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                </div>
              )}
            </main>
          </>
        ) : null}

        {section === "shows" ? (
          <>
            <aside className="lib-ws__list-pane">
              <ul className="lib-ws__rows">
                {index.shows.map((show) => (
                  <li key={show.id}>
                    <button
                      type="button"
                      className={
                        selectedShowId === show.id ? "lib-ws__row is-selected" : "lib-ws__row"
                      }
                      onClick={() => {
                        setSelectedShowId(show.id);
                        onActiveShowChange(show.id, 0);
                      }}
                    >
                      <span className="lib-ws__row-title">{show.name}</span>
                      <span className="lib-ws__row-meta">
                        {t("lib.trackCount", { n: show.songIds.length })}
                      </span>
                    </button>
                  </li>
                ))}
                {index.shows.length === 0 ? (
                  <li className="lib-ws__empty">{t("lib.createShowHint")}</li>
                ) : null}
              </ul>
              <div className="lib-ws__list-actions">
                <button
                  type="button"
                  className="lib-ws__primary"
                  disabled={busy}
                  onClick={() => void createShow()}
                >
                  {t("lib.newShow")}
                </button>
              </div>
            </aside>
            <main className="lib-ws__detail">
              {selectedShow === null ? (
                <p className="lib-ws__placeholder">{t("lib.showExplain")}</p>
              ) : armOpen ? (
                <div className="lib-ws__detail-card">
                  <h2 className="lib-ws__detail-title">{t("lib.armBank")}</h2>
                  <p className="lib-ws__detail-meta">{t("lib.armHint")}</p>
                  <div className="lib-ws__arm">
                    {(["A", "B", "C"] as const).map((slot) => (
                      <label key={slot} className="lib-ws__arm-slot">
                        <span className="lib-ws__arm-letter">Foot {slot}</span>
                        <select
                          value={armSlots[slot] ?? ""}
                          disabled={busy}
                          onChange={(e) =>
                            setArmSlots({
                              ...armSlots,
                              [slot]: e.target.value === "" ? null : e.target.value,
                            })
                          }
                        >
                          <option value="">{t("common.empty")}</option>
                          {selectedShow.songIds.map((sid) => {
                            const song = index.songs.find((s) => s.id === sid);
                            return (
                              <option key={sid} value={sid}>
                                {song?.name ?? sid.slice(0, 8)}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    ))}
                  </div>
                  <div className="lib-ws__detail-actions">
                    <button
                      type="button"
                      className="lib-ws__primary lib-ws__primary--lg"
                      disabled={busy}
                      onClick={() => void confirmArm()}
                    >
                      {t("lib.writePedal")}
                    </button>
                    <button
                      type="button"
                      className="lib-ws__ghost"
                      onClick={() => setArmOpen(false)}
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="lib-ws__detail-card lib-ws__detail-card--wide">
                  <div className="lib-ws__show-head">
                    <input
                      className="lib-ws__show-name"
                      defaultValue={selectedShow.name}
                      key={selectedShow.id + selectedShow.updatedAt}
                      disabled={busy}
                      aria-label={t("lib.showName")}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name && name !== selectedShow.name) {
                          void renameShow(selectedShow, name);
                        }
                      }}
                    />
                    <div className="lib-ws__detail-actions lib-ws__detail-actions--inline">
                      <button
                        type="button"
                        className="lib-ws__primary"
                        disabled={busy || selectedShow.songIds.length === 0}
                        onClick={() => onEnterStage(selectedShow.id)}
                      >
                        {t("lib.stageMode")}
                      </button>
                      <button
                        type="button"
                        className="lib-ws__ghost"
                        disabled={busy || selectedShow.songIds.length === 0}
                        onClick={() => {
                          setArmSlots({
                            A: selectedShow.songIds[0] ?? null,
                            B: selectedShow.songIds[1] ?? null,
                            C: selectedShow.songIds[2] ?? null,
                          });
                          setArmOpen(true);
                        }}
                      >
                        {t("lib.armAbc")}
                      </button>
                      <button
                        type="button"
                        className="lib-ws__ghost"
                        disabled={busy}
                        onClick={() =>
                          void runBusy(async () => {
                            const exported = await window.tonehubDesktop.library.exportShare(
                              "show",
                              selectedShow.id,
                            );
                            onStatus(
                              exported
                                ? t("share.exported", { path: exported.path })
                                : t("common.cancelled"),
                            );
                          })
                        }
                      >
                        {t("share.action")}
                      </button>
                      <button
                        type="button"
                        className="lib-ws__ghost"
                        disabled={busy}
                        onClick={() => void exportShow()}
                      >
                        {t("lib.exportZip")}
                      </button>
                      <button
                        type="button"
                        className="lib-ws__danger"
                        disabled={busy}
                        onClick={() => void deleteShow(selectedShow.id)}
                      >
                        {t("lib.deleteShow")}
                      </button>
                    </div>
                  </div>

                  <ol className="lib-ws__cue" aria-label="Cue sheet">
                    {selectedShow.songIds.map((sid, i) => {
                      const song = index.songs.find((s) => s.id === sid);
                      const active = activeShowId === selectedShow.id && activeSongIndex === i;
                      return (
                        <li
                          key={`${sid}-${i}`}
                          className={active ? "lib-ws__cue-row is-active" : "lib-ws__cue-row"}
                          draggable={!busy}
                          onDragStart={() => setDragSongId(sid)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => onDropReorder(sid)}
                        >
                          <span className="lib-ws__cue-num" aria-hidden>
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <button
                            type="button"
                            className="lib-ws__cue-title"
                            disabled={busy || !song}
                            onClick={() => {
                              onActiveShowChange(selectedShow.id, i);
                              if (song) void onApplySong(song);
                            }}
                          >
                            {song?.name ?? t("lib.songDeleted")}
                          </button>
                          <span className="lib-ws__cue-handle" title={t("lib.dragReorder")}>
                            ⋮⋮
                          </span>
                          <button
                            type="button"
                            className="lib-ws__cue-remove"
                            aria-label={t("lib.removeFromShow", {
                              name: song?.name ?? t("lib.songWord"),
                            })}
                            disabled={busy}
                            onClick={() =>
                              void updateShowSongs(
                                selectedShow,
                                selectedShow.songIds.filter((_, idx) => idx !== i),
                              )
                            }
                          >
                            {t("lib.remove")}
                          </button>
                        </li>
                      );
                    })}
                  </ol>

                  <div className="lib-ws__add-song">
                    <p className="lib-ws__detail-meta">{t("lib.addSongToShow")}</p>
                    <div className="lib-ws__add-song-list">
                      {index.songs
                        .filter((s) => !selectedShow.songIds.includes(s.id))
                        .map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className="lib-ws__ghost"
                            disabled={busy}
                            onClick={() =>
                              void updateShowSongs(selectedShow, [...selectedShow.songIds, s.id])
                            }
                          >
                            + {s.name}
                          </button>
                        ))}
                      {index.songs.every((s) => selectedShow.songIds.includes(s.id)) ? (
                        <span className="lib-ws__empty">{t("lib.allSongsInShow")}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
            </main>
          </>
        ) : null}

        {section === "more" ? (
          <main className="lib-ws__detail lib-ws__detail--solo">
            <div className="lib-ws__chips" role="tablist" aria-label={t("lib.moreTools")}>
              {(
                [
                  ["irs", t("lib.irs")],
                  ["backups", t("lib.backups")],
                  ["export", t("lib.packs")],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={moreTab === id}
                  className={moreTab === id ? "lib-ws__chip is-on" : "lib-ws__chip"}
                  onClick={() => setMoreTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {moreTab === "irs" ? (
              <div className="lib-ws__detail-card">
                <h2 className="lib-ws__detail-title">{t("device.ir.title")}</h2>
                <MicDistanceRail
                  compact
                  value={irDistance}
                  onChange={onIrDistanceChange}
                  disabled={busy}
                />
                <label className="lib-ws__primary lib-ws__file">
                  {t("lib.importWav")}
                  <input
                    type="file"
                    accept=".wav,audio/wav"
                    hidden
                    disabled={busy}
                    onChange={(e) => void importIrFile(e.target.files?.[0])}
                  />
                </label>
                <ul className="lib-ws__rows lib-ws__rows--flat">
                  {index.irs.map((ir) => (
                    <li key={ir.id} className="lib-ws__flat-row">
                      <span>{ir.name}</span>
                      <button
                        type="button"
                        className="lib-ws__ghost"
                        disabled={busy}
                        onClick={() => void loadIr(ir)}
                      >
                        {t("lib.toPedalCab", { cab: irCabinet })}
                      </button>
                      <button
                        type="button"
                        className="lib-ws__danger"
                        disabled={busy}
                        onClick={() =>
                          void runBusy(async () => {
                            await window.tonehubDesktop.library.deleteIr(ir.id);
                            onStatus(t("lib.irDeleted"));
                          })
                        }
                      >
                        {t("common.delete")}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {moreTab === "backups" ? (
              <div className="lib-ws__detail-card">
                <h2 className="lib-ws__detail-title">{t("lib.backups")}</h2>
                <ul className="lib-ws__rows lib-ws__rows--flat">
                  {index.irBackups.map((b) => (
                    <li key={b.id} className="lib-ws__flat-row">
                      <span>
                        Cab {b.cabinet} · {formatDate(b.createdAt)}
                        {b.sourceName ? ` · ${b.sourceName}` : ""}
                      </span>
                      <button
                        type="button"
                        className="lib-ws__ghost"
                        disabled={busy}
                        onClick={() =>
                          void runBusy(async () => {
                            const ok = await confirm({
                              title: t("lib.restoreCabTitle", { cab: b.cabinet }),
                              body: t("lib.restoreCabBody"),
                              detail: b.sourceName
                                ? t("lib.backupMeta", { name: b.sourceName })
                                : formatDate(b.createdAt),
                              tone: "danger",
                              requireTyped: `CAB${b.cabinet}`,
                              confirmLabel: t("common.restore"),
                            });
                            if (!ok) return;
                            const result =
                              await window.tonehubDesktop.library.restoreIrBackup(b.id);
                            onCabinetApplied(result.cabinet);
                            onStatus(t("lib.backupRestored", { cab: result.cabinet }));
                          })
                        }
                      >
                        {t("common.restore")}
                      </button>
                    </li>
                  ))}
                  {index.irBackups.length === 0 ? (
                    <li className="lib-ws__empty">{t("lib.noBackups")}</li>
                  ) : null}
                </ul>
              </div>
            ) : null}
            {moreTab === "export" ? (
              <div className="lib-ws__detail-card">
                <h2 className="lib-ws__detail-title">{t("lib.packs")}</h2>
                <p className="lib-ws__detail-meta">{t("share.packsHint")}</p>
                <button
                  type="button"
                  className="lib-ws__primary"
                  disabled={busy}
                  onClick={() =>
                    void (async () => {
                      onError(null);
                      const inspect = await window.tonehubDesktop.library.inspectShare();
                      if (!inspect) {
                        onStatus(t("common.cancelled"));
                        return;
                      }
                      const ok = await confirm({
                        title: t("share.askTitle"),
                        body:
                          inspect.kind === "pack"
                            ? t("share.askPack", { name: inspect.name })
                            : t("share.askBody", {
                                name: inspect.name,
                                presets: inspect.presets,
                                songs: inspect.songs,
                                shows: inspect.shows,
                              }),
                        confirmLabel: t("share.load"),
                      });
                      if (!ok) return;
                      await runBusy(async () => {
                        if (inspect.kind === "pack") {
                          const pack = await window.tonehubDesktop.library.importPackPath(
                            inspect.path,
                          );
                          onStatus(t("lib.packImported", { name: pack.name }));
                          return;
                        }
                        const result = await window.tonehubDesktop.library.importShare(
                          inspect.payload,
                        );
                        onStatus(
                          t("share.imported", {
                            name: result.name,
                            presets: result.presets,
                            songs: result.songs,
                          }),
                        );
                      });
                    })()
                  }
                >
                  {t("share.importFile")}
                </button>
                <button
                  type="button"
                  className="lib-ws__ghost"
                  disabled={busy}
                  onClick={() =>
                    void runBusy(async () => {
                      const result = await window.tonehubDesktop.library.importPack();
                      onStatus(
                        result
                          ? t("lib.packImported", { name: result.pack.name })
                          : t("common.cancelled"),
                      );
                    })
                  }
                >
                  {t("lib.importPack")}
                </button>
                <ul className="lib-ws__rows lib-ws__rows--flat">
                  {index.packs.map((pack) => (
                    <li key={pack.id} className="lib-ws__flat-row">
                      <span>{pack.name}</span>
                      <button
                        type="button"
                        className="lib-ws__ghost"
                        disabled={busy}
                        onClick={() =>
                          void runBusy(async () => {
                            const exported = await window.tonehubDesktop.library.exportPack(
                              pack.id,
                            );
                            onStatus(
                              exported
                                ? t("lib.packExported", { path: exported.path })
                                : t("common.cancelled"),
                            );
                          })
                        }
                      >
                        {t("common.export")}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </main>
        ) : null}
      </div>

      {saveSheet !== null ? (
        <div
          className="lib-ws__sheet"
          role="dialog"
          aria-modal="true"
          aria-label={t("lib.saveToneDialog")}
        >
          <div className="lib-ws__sheet-card">
            <h2 className="lib-ws__detail-title">
              {saveSheet.mode === "update" ? t("lib.updateTone") : t("lib.saveToneLive")}
            </h2>
            <label className="lib-ws__field">
              {t("common.name")}
              <input
                value={saveSheet.name}
                onChange={(e) => setSaveSheet({ ...saveSheet, name: e.target.value })}
              />
            </label>
            <label className="lib-ws__field">
              {t("lib.profile")}
              <select
                value={saveSheet.profile}
                onChange={(e) =>
                  setSaveSheet({
                    ...saveSheet,
                    profile: e.target.value as LibraryProfile,
                  })
                }
              >
                {PROFILES.map((p) => (
                  <option key={p} value={p}>
                    {profileLabel(p)}
                  </option>
                ))}
              </select>
            </label>
            <details className="lib-ws__more-details">
              <summary>{t("lib.moreDetails")}</summary>
              <label className="lib-ws__field">
                {t("common.notes")}
                <input
                  value={saveSheet.notes}
                  onChange={(e) => setSaveSheet({ ...saveSheet, notes: e.target.value })}
                />
              </label>
              <label className="lib-ws__field">
                {t("lib.tags")}
                <input
                  value={saveSheet.tags}
                  onChange={(e) => setSaveSheet({ ...saveSheet, tags: e.target.value })}
                />
              </label>
            </details>
            <div className="lib-ws__detail-actions">
              <button
                type="button"
                className="lib-ws__primary lib-ws__primary--lg"
                disabled={busy}
                onClick={() => void persistPreset(saveSheet)}
              >
                {saveSheet.mode === "update" ? t("common.update") : t("common.save")}
              </button>
              <button
                type="button"
                className="lib-ws__ghost"
                onClick={() => setSaveSheet(null)}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmDialog}
    </div>
  );
}
