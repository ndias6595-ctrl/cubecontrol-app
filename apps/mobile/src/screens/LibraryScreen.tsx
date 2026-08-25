import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Button } from "../components/Button";
import { SafetyGate } from "../components/SafetyGate";
import { SessionBanner } from "../components/SessionBanner";
import { SyncPanel } from "../components/SyncPanel";
import { pickWavFile, pickShareFile, shareJsonFile, alertFilesError } from "../device/files";
import { useI18n } from "../i18n";
import { applySongMaybeIr } from "../library/applySongIr";
import { buildPresetShare, buildShowShare, buildSongShare } from "../library/shareBuild";
import { shareFileName } from "../library/shareFormat";
import { loadIncomingCubeFile } from "../library/openIncoming";
import {
  FAVORITE_TAG,
  LIBRARY_PROFILES,
  isFavorite,
  type LibraryProfile,
} from "../library/types";
import {
  DEFAULT_DELAY_NOTE,
  DELAY_NOTE_IDS,
  clampBpm,
  type DelayNoteId,
} from "../music/delaySync";
import { useApp } from "../store/AppStore";
import { colors, fonts, HIT } from "../theme/tokens";
import { confirmAction } from "../ui/confirm";
import { confirmIrCabinetWrite } from "../ui/irConfirm";

type Section = "tones" | "songs" | "shows" | "more";
type ProfileFilter = LibraryProfile | "all" | "favorites";

const CABS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

export function LibraryScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const app = useApp();
  const [section, setSection] = useState<Section>("tones");
  const [query, setQuery] = useState("");
  const [profileFilter, setProfileFilter] = useState<ProfileFilter>("all");
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [selectedShowId, setSelectedShowId] = useState<string | null>(app.activeShowId);
  const [saveSheet, setSaveSheet] = useState<{
    mode: "new" | "update";
    id?: string;
    name: string;
    profile: LibraryProfile;
    notes: string;
    tags: string;
  } | null>(null);
  const [songDraft, setSongDraft] = useState<{
    step: 1 | 2;
    name: string;
    presetId: string;
    irId: string;
    notes: string;
    bpm: number | "";
    delayNote: DelayNoteId;
  } | null>(null);
  const [armSlots, setArmSlots] = useState<{ A: string | null; B: string | null; C: string | null }>({
    A: null,
    B: null,
    C: null,
  });
  const [armOpen, setArmOpen] = useState(false);
  const [showName, setShowName] = useState("");
  const [showGate, setShowGate] = useState(false);
  const [pendingArm, setPendingArm] = useState(false);
  const [pendingIrId, setPendingIrId] = useState<string | null>(null);

  const profileLabel = (p: LibraryProfile) => t(`lib.profile.${p}`);

  const filteredPresets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return app.library.presets.filter((p) => {
      if (profileFilter === "favorites" && !isFavorite(p.tags)) return false;
      if (profileFilter !== "all" && profileFilter !== "favorites" && p.profile !== profileFilter) {
        return false;
      }
      if (q === "") return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.notes.toLowerCase().includes(q) ||
        p.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [app.library.presets, query, profileFilter]);

  const filteredSongs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return app.library.songs.filter((s) => {
      if (q === "") return true;
      return s.name.toLowerCase().includes(q) || s.notes.toLowerCase().includes(q);
    });
  }, [app.library.songs, query]);

  const selectedPreset = app.library.presets.find((p) => p.id === selectedPresetId) ?? null;
  const selectedSong = app.library.songs.find((s) => s.id === selectedSongId) ?? null;
  const selectedShow =
    app.library.shows.find((s) => s.id === selectedShowId) ?? app.library.shows[0] ?? null;

  async function persistSaveSheet() {
    if (!saveSheet) return;
    const tags = saveSheet.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    await app.savePreset({
      name: saveSheet.name,
      profile: saveSheet.profile,
      notes: saveSheet.notes,
      tags,
      ...(saveSheet.mode === "update" && saveSheet.id ? { id: saveSheet.id } : {}),
    });
    setSaveSheet(null);
  }

  async function persistSongDraft() {
    if (!songDraft || songDraft.presetId === "") return;
    await app.saveSong({
      name: songDraft.name,
      notes: songDraft.notes,
      presetId: songDraft.presetId,
      delayNote: songDraft.delayNote,
      ...(songDraft.bpm === "" ? {} : { bpm: clampBpm(songDraft.bpm) }),
      ...(songDraft.irId
        ? { irId: songDraft.irId, irCabinet: app.irCabinet, irDistance: app.irDistance }
        : {}),
    });
    setSongDraft(null);
    setSection("songs");
  }

  async function sharePayload(kind: "preset" | "song" | "show") {
    try {
      if (kind === "preset") {
        if (!selectedPreset) return;
        const payload = buildPresetShare(selectedPreset);
        await shareJsonFile(shareFileName(payload.name), JSON.stringify(payload, null, 2));
        return;
      }
      if (kind === "song") {
        if (!selectedSong) return;
        const preset = app.library.presets.find((item) => item.id === selectedSong.presetId);
        if (!preset) return;
        const payload = buildSongShare(selectedSong, preset);
        await shareJsonFile(shareFileName(payload.name), JSON.stringify(payload, null, 2));
        return;
      }
      if (!selectedShow) return;
      const payload = buildShowShare(selectedShow, app.library.songs, app.library.presets);
      await shareJsonFile(shareFileName(payload.name), JSON.stringify(payload, null, 2));
    } catch (err) {
      alertFilesError(err);
    }
  }

  async function importShareFile() {
    try {
      const file = await pickShareFile();
      if (!file) return;
      const incoming = await loadIncomingCubeFile(file.uri);
      if (incoming.kind === "pack") {
        const ok = await confirmAction({
          title: t("share.askTitle"),
          message: t("share.askPack", {
            name: incoming.pack.name,
            presets: incoming.pack.presets.length,
            irs: incoming.pack.irs.length,
          }),
          confirmLabel: t("share.load"),
          cancelLabel: t("common.cancel"),
        });
        if (!ok) return;
        await app.importPack(incoming.pack);
        return;
      }
      const ok = await confirmAction({
        title: t("share.askTitle"),
        message: t("share.askBody", {
          name: incoming.payload.name,
          presets: incoming.payload.presets.length,
          songs: incoming.payload.songs.length,
          shows: incoming.payload.shows.length,
        }),
        confirmLabel: t("share.load"),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
      await app.importShare(incoming.payload);
    } catch (err) {
      alertFilesError(err);
    }
  }

  async function writeArm() {
    const ok = await confirmAction({
      title: t("lib.armBank"),
      message: t("studio.saveBody"),
      confirmLabel: t("lib.writePedal"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    if (!app.safetyAccepted) {
      setPendingArm(true);
      setShowGate(true);
      return;
    }
    await app.armBank(armSlots);
    setArmOpen(false);
  }

  async function sendIr(id: string) {
    const ir = app.library.irs.find((item) => item.id === id);
    if (!ir) return;
    const ok = await confirmIrCabinetWrite(t, app.irCabinet, ir.name);
    if (!ok) return;
    if (!app.safetyAccepted) {
      setPendingIrId(id);
      setShowGate(true);
      return;
    }
    await app.loadLibraryIr(id);
  }

  if (showGate) {
    return (
      <SafetyGate
        onAccepted={() => {
          void app.acceptSafety().then(() => {
            setShowGate(false);
            if (pendingArm) {
              setPendingArm(false);
              void app.armBank(armSlots).then(() => setArmOpen(false));
            }
            if (pendingIrId) {
              const id = pendingIrId;
              setPendingIrId(null);
              void app.loadLibraryIr(id);
            }
          });
        }}
        onCancel={() => {
          setShowGate(false);
          setPendingArm(false);
          setPendingIrId(null);
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title} accessibilityRole="header">
          {t("lib.title")}
        </Text>
        <Text style={styles.sub}>{t("lib.subtitle")}</Text>
        {app.connection === null ? <Text style={styles.warn}>{t("lib.offlineHint")}</Text> : null}
        <SessionBanner error={app.error} status={app.status} busy={app.busy} />
        <SyncPanel />

        <View style={styles.segs} accessibilityRole="tablist" accessibilityLabel={t("lib.navAria")}>
          {(["tones", "songs", "shows", "more"] as const).map((id) => (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected: section === id }}
              onPress={() => {
                setSection(id);
                setQuery("");
              }}
              style={[styles.seg, section === id && styles.segOn]}
            >
              <Text style={[styles.segLabel, section === id && styles.segLabelOn]}>
                {t(`lib.${id}`)}
              </Text>
            </Pressable>
          ))}
        </View>

        {section === "tones" ? (
          <View style={styles.block}>
            <TextInput
              accessibilityLabel={t("lib.searchTones")}
              placeholder={t("lib.searchTonesPh")}
              placeholderTextColor={colors.muted2}
              value={query}
              onChangeText={setQuery}
              style={styles.input}
            />
            <View style={styles.chips} accessibilityRole="tablist" accessibilityLabel={t("lib.filters")}>
              {(
                [
                  ["all", t("common.all")],
                  ["favorites", t("common.favorites")],
                  ...LIBRARY_PROFILES.map((p) => [p, profileLabel(p)] as const),
                ] as const
              ).map(([id, label]) => (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: profileFilter === id }}
                  onPress={() => setProfileFilter(id)}
                  style={[styles.chip, profileFilter === id && styles.chipOn]}
                >
                  <Text style={[styles.chipLabel, profileFilter === id && styles.chipLabelOn]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {filteredPresets.length === 0 ? <Text style={styles.empty}>{t("lib.noToneMatch")}</Text> : null}
            {filteredPresets.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={p.name}
                onPress={() => setSelectedPresetId(p.id)}
                style={[styles.row, selectedPresetId === p.id && styles.rowOn]}
              >
                <Text style={styles.rowTitle}>
                  {isFavorite(p.tags) ? "★ " : ""}
                  {p.name}
                </Text>
                <Text style={styles.rowMeta}>
                  {profileLabel(p.profile)} · {formatDate(p.updatedAt)}
                </Text>
              </Pressable>
            ))}
            <Button
              label={t("lib.saveLiveHere")}
              disabled={app.live === null || app.busy}
              onPress={() =>
                setSaveSheet({
                  mode: "new",
                  name: t("lib.myTone"),
                  profile: "ensayo",
                  notes: "",
                  tags: "",
                })
              }
            />

            {saveSheet ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {saveSheet.mode === "update" ? t("lib.updateTone") : t("lib.saveToneDialog")}
                </Text>
                <TextInput
                  accessibilityLabel={t("common.name")}
                  value={saveSheet.name}
                  onChangeText={(name) => setSaveSheet({ ...saveSheet, name })}
                  style={styles.input}
                />
                <Text style={styles.label}>{t("lib.profile")}</Text>
                <View style={styles.chips}>
                  {LIBRARY_PROFILES.map((p) => (
                    <Pressable
                      key={p}
                      onPress={() => setSaveSheet({ ...saveSheet, profile: p })}
                      style={[styles.chip, saveSheet.profile === p && styles.chipOn]}
                    >
                      <Text style={[styles.chipLabel, saveSheet.profile === p && styles.chipLabelOn]}>
                        {profileLabel(p)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  accessibilityLabel={t("common.notes")}
                  placeholder={t("common.notes")}
                  placeholderTextColor={colors.muted2}
                  value={saveSheet.notes}
                  onChangeText={(notes) => setSaveSheet({ ...saveSheet, notes })}
                  style={styles.input}
                />
                <TextInput
                  accessibilityLabel={t("lib.tags")}
                  placeholder={t("lib.tags")}
                  placeholderTextColor={colors.muted2}
                  value={saveSheet.tags}
                  onChangeText={(tags) => setSaveSheet({ ...saveSheet, tags })}
                  style={styles.input}
                />
                <Button label={t("lib.saveToneLive")} disabled={app.busy} onPress={() => void persistSaveSheet()} />
                <Button variant="ghost" label={t("common.cancel")} onPress={() => setSaveSheet(null)} />
              </View>
            ) : null}

            {selectedPreset && !saveSheet ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{selectedPreset.name}</Text>
                <Text style={styles.empty}>
                  {profileLabel(selectedPreset.profile)}
                  {selectedPreset.notes ? ` · ${selectedPreset.notes}` : ""}
                </Text>
                <Button
                  label={t("lib.applyLive")}
                  disabled={app.busy || app.connection === null}
                  onPress={() => void app.applyTone(selectedPreset.id)}
                />
                <Button
                  variant="secondary"
                  label={t("share.action")}
                  onPress={() => void sharePayload("preset")}
                />
                <Button
                  variant="secondary"
                  label={isFavorite(selectedPreset.tags) ? t("lib.unfavorite") : t("lib.favorite")}
                  onPress={() => void app.toggleFavorite(selectedPreset.id)}
                />
                <Button
                  variant="secondary"
                  label={t("lib.updateWithLive")}
                  disabled={app.live === null || app.busy}
                  onPress={() =>
                    setSaveSheet({
                      mode: "update",
                      id: selectedPreset.id,
                      name: selectedPreset.name,
                      profile: selectedPreset.profile,
                      notes: selectedPreset.notes,
                      tags: selectedPreset.tags.filter((tag) => tag !== FAVORITE_TAG).join(", "),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  label={t("common.delete")}
                  onPress={() => {
                    void confirmAction({
                      title: t("lib.deleteToneTitle"),
                      message: t("lib.deleteToneBody"),
                      confirmLabel: t("common.delete"),
                      cancelLabel: t("common.cancel"),
                      destructive: true,
                    }).then((ok) => {
                      if (!ok) return;
                      void app.deletePreset(selectedPreset.id).then(() => setSelectedPresetId(null));
                    });
                  }}
                />
              </View>
            ) : !saveSheet && selectedPreset === null ? (
              <Text style={styles.empty}>{t("lib.tonePickHint")}</Text>
            ) : null}
          </View>
        ) : null}

        {section === "songs" ? (
          <View style={styles.block}>
            <TextInput
              accessibilityLabel={t("lib.searchSongs")}
              placeholder={t("lib.searchSongsPh")}
              placeholderTextColor={colors.muted2}
              value={query}
              onChangeText={setQuery}
              style={styles.input}
            />
            {filteredSongs.length === 0 ? <Text style={styles.empty}>{t("lib.createSongHint")}</Text> : null}
            {filteredSongs.map((s) => {
              const tone = app.library.presets.find((p) => p.id === s.presetId);
              return (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  accessibilityLabel={s.name}
                  onPress={() => setSelectedSongId(s.id)}
                  style={[styles.row, selectedSongId === s.id && styles.rowOn]}
                >
                  <Text style={styles.rowTitle}>{s.name}</Text>
                  <Text style={styles.rowMeta}>
                    {tone?.name ?? t("lib.missingTone")}
                    {s.bpm !== undefined ? ` · ${s.bpm} BPM` : ""}
                  </Text>
                </Pressable>
              );
            })}
            <Button
              label={t("lib.newSong")}
              disabled={app.busy || app.library.presets.length === 0}
              onPress={() =>
                setSongDraft({
                  step: 1,
                  name: t("lib.newSong"),
                  presetId: app.library.presets[0]?.id ?? "",
                  irId: "",
                  notes: "",
                  bpm: "",
                  delayNote: DEFAULT_DELAY_NOTE,
                })
              }
            />

            {songDraft ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {songDraft.step === 1 ? t("lib.songStep1") : t("lib.songStep2")}
                </Text>
                {songDraft.step === 1 ? (
                  <>
                    <TextInput
                      accessibilityLabel={t("common.name")}
                      value={songDraft.name}
                      onChangeText={(name) => setSongDraft({ ...songDraft, name })}
                      style={styles.input}
                    />
                    <TextInput
                      accessibilityLabel={t("groove.bpm")}
                      placeholder={t("groove.bpm")}
                      placeholderTextColor={colors.muted2}
                      keyboardType="number-pad"
                      value={songDraft.bpm === "" ? "" : String(songDraft.bpm)}
                      onChangeText={(raw) => {
                        if (raw === "") {
                          setSongDraft({ ...songDraft, bpm: "" });
                          return;
                        }
                        const n = Number(raw);
                        setSongDraft({ ...songDraft, bpm: Number.isFinite(n) ? n : "" });
                      }}
                      style={styles.input}
                    />
                    <View style={styles.notes}>
                      {DELAY_NOTE_IDS.map((note) => (
                        <Button
                          key={note}
                          variant={note === songDraft.delayNote ? "primary" : "secondary"}
                          label={t(
                            note === "1/4"
                              ? "groove.note.quarter"
                              : note === "1/8"
                                ? "groove.note.eighth"
                                : note === "1/8d"
                                  ? "groove.note.dottedEighth"
                                  : "groove.note.sixteenth",
                          )}
                          onPress={() => setSongDraft({ ...songDraft, delayNote: note })}
                          style={styles.note}
                        />
                      ))}
                    </View>
                    {app.library.presets.map((p) => (
                      <Pressable
                        key={p.id}
                        onPress={() => setSongDraft({ ...songDraft, presetId: p.id })}
                        style={[styles.row, songDraft.presetId === p.id && styles.rowOn]}
                      >
                        <Text style={styles.rowTitle}>{p.name}</Text>
                      </Pressable>
                    ))}
                    <Button label={t("common.next")} onPress={() => setSongDraft({ ...songDraft, step: 2 })} />
                    <Button variant="ghost" label={t("common.cancel")} onPress={() => setSongDraft(null)} />
                  </>
                ) : (
                  <>
                    <Text style={styles.empty}>{t("lib.songIrSkip")}</Text>
                    <Pressable
                      onPress={() => setSongDraft({ ...songDraft, irId: "" })}
                      style={[styles.row, songDraft.irId === "" && styles.rowOn]}
                    >
                      <Text style={styles.rowTitle}>{t("lib.noIr")}</Text>
                    </Pressable>
                    {app.library.irs.map((ir) => (
                      <Pressable
                        key={ir.id}
                        onPress={() => setSongDraft({ ...songDraft, irId: ir.id })}
                        style={[styles.row, songDraft.irId === ir.id && styles.rowOn]}
                      >
                        <Text style={styles.rowTitle}>{ir.name}</Text>
                      </Pressable>
                    ))}
                    <Button label={t("lib.saveSong")} disabled={app.busy} onPress={() => void persistSongDraft()} />
                    <Button
                      variant="secondary"
                      label={t("lib.songStep1")}
                      onPress={() => setSongDraft({ ...songDraft, step: 1 })}
                    />
                    <Button variant="ghost" label={t("common.cancel")} onPress={() => setSongDraft(null)} />
                  </>
                )}
              </View>
            ) : null}

            {selectedSong && !songDraft ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{selectedSong.name}</Text>
                <Text style={styles.empty}>{t("lib.songExplain")}</Text>
                <Text style={styles.rowMeta}>
                  {t("lib.toneLabel")}{" "}
                  {app.library.presets.find((p) => p.id === selectedSong.presetId)?.name ?? t("lib.missingTone")}
                </Text>
                {selectedSong.irId && !app.library.irs.some((ir) => ir.id === selectedSong.irId) ? (
                  <>
                    <Text style={styles.warn}>
                      {t("lib.irMissingOnDevice")}. {t("lib.irMissingHint")}
                    </Text>
                    <Button
                      variant="secondary"
                      label={t("lib.importPack")}
                      onPress={() => void importShareFile()}
                    />
                  </>
                ) : null}
                <Button
                  label={t("lib.applySong")}
                  disabled={app.busy || app.connection === null}
                  onPress={() => void applySongMaybeIr(t, selectedSong, app.library, app)}
                />
                <Button
                  variant="secondary"
                  label={t("share.action")}
                  onPress={() => void sharePayload("song")}
                />
                <Button
                  variant="ghost"
                  label={t("common.delete")}
                  onPress={() => {
                    void confirmAction({
                      title: t("lib.deleteSongTitle"),
                      message: t("lib.deleteSongBody"),
                      confirmLabel: t("common.delete"),
                      cancelLabel: t("common.cancel"),
                      destructive: true,
                    }).then((ok) => {
                      if (!ok) return;
                      void app.deleteSong(selectedSong.id).then(() => setSelectedSongId(null));
                    });
                  }}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {section === "shows" ? (
          <View style={styles.block}>
            {app.library.shows.length === 0 ? <Text style={styles.empty}>{t("lib.createShowHint")}</Text> : null}
            {app.library.shows.map((show) => (
              <Pressable
                key={show.id}
                accessibilityRole="button"
                accessibilityLabel={show.name}
                onPress={() => {
                  setSelectedShowId(show.id);
                  app.setActiveShow(show.id, 0);
                  setShowName(show.name);
                  setArmOpen(false);
                }}
                style={[styles.row, selectedShow?.id === show.id && styles.rowOn]}
              >
                <Text style={styles.rowTitle}>{show.name}</Text>
                <Text style={styles.rowMeta}>{t("lib.trackCount", { n: show.songIds.length })}</Text>
              </Pressable>
            ))}
            <Button
              label={t("lib.newShow")}
              onPress={() => {
                void app.saveShow(t("lib.showNameDefault", { n: app.library.shows.length + 1 })).then((id) => {
                  setSelectedShowId(id);
                  setShowName(t("lib.showNameDefault", { n: app.library.shows.length + 1 }));
                  setArmOpen(false);
                });
              }}
            />

            {selectedShow ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{selectedShow.name}</Text>
                <Text style={styles.empty}>{t("lib.showExplain")}</Text>
                <TextInput
                  accessibilityLabel={t("lib.showName")}
                  value={showName || selectedShow.name}
                  onChangeText={setShowName}
                  onEndEditing={() => {
                    const name = showName.trim();
                    if (name) void app.renameShow(selectedShow.id, name);
                  }}
                  style={styles.input}
                />
                {selectedShow.songIds.map((id, index) => {
                  const song = app.library.songs.find((item) => item.id === id);
                  if (!song) return null;
                  return (
                    <View key={id} style={styles.showSong}>
                      <View style={styles.showSongText}>
                        <Text style={styles.rowTitle}>{song.name}</Text>
                      </View>
                      <Button
                        variant="ghost"
                        label="↑"
                        disabled={index === 0}
                        onPress={() => void app.moveSongInShow(selectedShow.id, id, -1)}
                        style={styles.tiny}
                      />
                      <Button
                        variant="ghost"
                        label="↓"
                        disabled={index === selectedShow.songIds.length - 1}
                        onPress={() => void app.moveSongInShow(selectedShow.id, id, 1)}
                        style={styles.tiny}
                      />
                      <Button
                        variant="ghost"
                        label={t("lib.remove")}
                        onPress={() => void app.removeSongFromShow(selectedShow.id, id)}
                        style={styles.tiny}
                      />
                    </View>
                  );
                })}
                <Text style={styles.label}>{t("lib.addSongToShow")}</Text>
                {app.library.songs.filter((song) => !selectedShow.songIds.includes(song.id)).length === 0 ? (
                  <Text style={styles.empty}>{t("lib.allSongsInShow")}</Text>
                ) : (
                  app.library.songs
                    .filter((song) => !selectedShow.songIds.includes(song.id))
                    .map((song) => (
                      <Button
                        key={song.id}
                        variant="secondary"
                        label={song.name}
                        onPress={() => void app.addSongToShow(selectedShow.id, song.id)}
                      />
                    ))
                )}
                <Button
                  label={t("lib.stageMode")}
                  disabled={selectedShow.songIds.length === 0}
                  onPress={() => {
                    app.setActiveShow(selectedShow.id, 0);
                    router.push("/(tabs)/stage");
                  }}
                />
                <Button
                  variant="secondary"
                  label={t("share.action")}
                  disabled={selectedShow.songIds.length === 0}
                  onPress={() => void sharePayload("show")}
                />
                <Button
                  variant="secondary"
                  label={t("lib.armAbc")}
                  disabled={selectedShow.songIds.length === 0}
                  onPress={() => setArmOpen((open) => !open)}
                />
                {armOpen ? (
                  <>
                    <Text style={styles.empty}>{t("lib.armHint")}</Text>
                    {(["A", "B", "C"] as const).map((slot) => (
                      <View key={slot} style={styles.armRow}>
                        <Text style={styles.rowTitle}>Foot {slot}</Text>
                        <View style={styles.armSongs}>
                          {selectedShow.songIds.map((id) => {
                            const song = app.library.songs.find((item) => item.id === id);
                            if (!song) return null;
                            const on = armSlots[slot] === id;
                            return (
                              <Button
                                key={`${slot}-${id}`}
                                variant={on ? "primary" : "secondary"}
                                label={song.name}
                                onPress={() =>
                                  setArmSlots((prev) => ({ ...prev, [slot]: on ? null : id }))
                                }
                                style={styles.note}
                              />
                            );
                          })}
                        </View>
                      </View>
                    ))}
                    <Button
                      label={t("lib.writePedal")}
                      disabled={app.busy || app.connection === null || (!armSlots.A && !armSlots.B && !armSlots.C)}
                      onPress={() => void writeArm()}
                    />
                  </>
                ) : null}
                <Button
                  variant="ghost"
                  label={t("lib.deleteShow")}
                  onPress={() => {
                    void confirmAction({
                      title: t("lib.deleteShowTitle"),
                      message: t("lib.deleteShowBody"),
                      confirmLabel: t("common.delete"),
                      cancelLabel: t("common.cancel"),
                      destructive: true,
                    }).then((ok) => {
                      if (!ok) return;
                      void app.deleteShow(selectedShow.id).then(() => setSelectedShowId(null));
                    });
                  }}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {section === "more" ? (
          <View style={styles.block}>
            <Text style={styles.cardTitle}>{t("lib.moreTools")}</Text>
            <Text style={styles.empty}>{t("lib.irs")}</Text>
            <Text style={styles.label}>{t("device.ir.cabinet")}</Text>
            <View style={styles.cabs}>
              {CABS.map((cab) => (
                <Pressable
                  key={cab}
                  accessibilityRole="button"
                  accessibilityLabel={`Cab ${cab}`}
                  accessibilityState={{ selected: app.irCabinet === cab }}
                  onPress={() => app.setIrCabinet(cab)}
                  style={[styles.cab, app.irCabinet === cab && styles.cabOn]}
                >
                  <Text style={[styles.cabLabel, app.irCabinet === cab && styles.cabLabelOn]}>{cab}</Text>
                </Pressable>
              ))}
            </View>
            <Button
              label={t("lib.importWav")}
              onPress={() => {
                void pickWavFile()
                  .then((file) => {
                    if (!file) return;
                    void app.importIr(file.uri, file.name);
                  })
                  .catch(alertFilesError);
              }}
            />
            {app.library.irs.length === 0 ? <Text style={styles.empty}>{t("lib.noIrs")}</Text> : null}
            {app.library.irs.map((ir) => (
              <View key={ir.id} style={styles.card}>
                <Text style={styles.rowTitle}>{ir.name}</Text>
                <Button
                  label={t("lib.toPedalCab", { cab: app.irCabinet })}
                  disabled={app.busy || app.connection === null}
                  onPress={() => void sendIr(ir.id)}
                />
                <Button variant="ghost" label={t("common.delete")} onPress={() => void app.deleteIr(ir.id)} />
              </View>
            ))}
            <Text style={styles.empty}>{t("share.packsHint")}</Text>
            <Button label={t("share.importFile")} onPress={() => void importShareFile()} />
            <Button label={t("lib.importPack")} onPress={() => void importShareFile()} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 22, paddingBottom: 28, gap: 14 },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: colors.muted, marginTop: -6 },
  segs: { flexDirection: "row", gap: 6 },
  seg: {
    flex: 1,
    minHeight: HIT,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.green,
    paddingHorizontal: 4,
  },
  segOn: { backgroundColor: colors.green },
  segLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.green },
  segLabelOn: { color: colors.onAccent },
  block: { gap: 10 },
  empty: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: colors.muted },
  label: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  row: { paddingVertical: 12, paddingHorizontal: 12, backgroundColor: colors.surface, minHeight: HIT },
  rowOn: { backgroundColor: colors.greenMuted },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  rowMeta: { fontFamily: fonts.body, fontSize: 16, color: colors.muted, marginTop: 2 },
  warn: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.warn, marginTop: 8 },
  input: {
    minHeight: HIT,
    borderWidth: 1.5,
    borderColor: colors.line,
    paddingHorizontal: 12,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.cream,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: HIT - 8,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  chipOn: { backgroundColor: colors.green, borderColor: colors.green },
  chipLabel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  chipLabelOn: { color: colors.onAccent },
  notes: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  note: { minWidth: HIT + 8, paddingHorizontal: 10 },
  showSong: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: HIT,
  },
  showSongText: { flex: 1 },
  tiny: { minWidth: HIT },
  card: { gap: 10, padding: 12, backgroundColor: colors.surface },
  cardTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  armRow: { gap: 6 },
  armSongs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cab: {
    width: HIT,
    height: HIT,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.green,
  },
  cabOn: { backgroundColor: colors.green },
  cabLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.green },
  cabLabelOn: { color: colors.onAccent },
});

export default LibraryScreen;
