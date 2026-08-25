import { useCallback, useEffect, useRef, useState } from "react";
import { LIVE_PARAM_MODULATION_OFF, LIVE_PARAM_NAMES, type LiveParamName, type PresetSlotId } from "@tonehub/cube-baby-protocol";
import { ComparePanel } from "../components/ComparePanel";
import { CubeBabyPedal } from "../components/cube-baby/CubeBabyPedal";
import { DelayTapBar } from "../components/DelayTapBar";
import { DeviceWorkspace } from "../components/DeviceWorkspace";
import { LibraryWorkspace } from "../components/LibraryWorkspace";
import { StageMode } from "../components/StageMode";
import { StudioSidebar, type StudioNavId } from "../components/StudioSidebar";
import { StudioToolbar } from "../components/StudioToolbar";
import { TunerPanel } from "../components/TunerPanel";
import { midiLog, midiWarn } from "../debug/midiLog";
import {
  DEFAULT_DELAY_NOTE,
  applyGrooveTime,
  isDelayNoteId,
  type DelayNoteId,
} from "../music/delaySync";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { useDebouncedLiveWrite } from "../hooks/useDebouncedLiveWrite";
import { useI18n } from "../i18n";
import { isLibraryOnlyConnection } from "../libraryOnly";
import type { BankSnapshot, DesktopConnectionInfo, LiveParamsSnapshot } from "../types/device";
import type { MatchVolumesSource } from "../../electron/deviceBridge";
import type { ShowLibraryItem, SlotDiffRow, SongLibraryItem } from "../../electron/library/types";

function liveDiffersFromBankSlot(
  live: LiveParamsSnapshot,
  bank: BankSnapshot,
  slot: PresetSlotId,
): boolean {
  const stored = bank.slots.find((item) => item.slot === slot);
  if (stored === undefined) return true;
  return LIVE_PARAM_NAMES.some((name) => live[name] !== stored[name]);
}

type StudioScreenProps = {
  readonly connection: DesktopConnectionInfo;
  readonly onDisconnect: () => void;
};

function slotParams(bank: BankSnapshot, slot: PresetSlotId): LiveParamsSnapshot {
  const stored = bank.slots.find((item) => item.slot === slot);
  if (stored === undefined) {
    throw new Error(`slot ${slot} missing from bank cache`);
  }
  const { slot: _id, ...params } = stored;
  return params;
}

export function StudioScreen({ connection, onDisconnect }: StudioScreenProps) {
  const { t } = useI18n();
  const hasPedal = !isLibraryOnlyConnection(connection);
  const [activeSlot, setActiveSlot] = useState<PresetSlotId>(connection.activeSlot);
  const [params, setParams] = useState<LiveParamsSnapshot>(connection.liveParams);
  const [bank, setBank] = useState<BankSnapshot>(connection.bank);
  const [irCabinet, setIrCabinet] = useState(8);
  const [irDistance, setIrDistance] = useState(() => {
    try {
      const raw = localStorage.getItem("cubecontrol.irDistance");
      if (raw === null) return 0.5;
      const n = Number(raw);
      return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
    } catch {
      return 0.5;
    }
  });
  const [nav, setNav] = useState<StudioNavId>(hasPedal ? "editor" : "library");
  const [activeShow, setActiveShow] = useState<ShowLibraryItem | null>(null);
  const [activeSongIndex, setActiveSongIndex] = useState(0);
  const [librarySongs, setLibrarySongs] = useState<SongLibraryItem[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [loadingSlot, setLoadingSlot] = useState<PresetSlotId | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareRows, setCompareRows] = useState<SlotDiffRow[]>([]);
  const [liveDirty, setLiveDirty] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [sessionBpm, setSessionBpm] = useState<number | "">("");
  const [sessionNote, setSessionNote] = useState<DelayNoteId>(DEFAULT_DELAY_NOTE);
  const [tempoSynced, setTempoSynced] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const paramsRef = useRef(params);
  const slotRef = useRef(activeSlot);
  const bankRef = useRef(bank);
  const slotApplyGen = useRef(0);
  const checkpointArmed = useRef(true);
  const writingTempoRef = useRef(false);
  const { scheduleWrite, flush, cancelPending } = useDebouncedLiveWrite();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  paramsRef.current = params;
  slotRef.current = activeSlot;
  bankRef.current = bank;
  // Slot sync runs in background — only block UI for save/IR/bank mutations.
  const busy = actionBusy;

  const refreshUndoState = useCallback(async () => {
    const state = await window.tonehubDesktop.library.undoState();
    setUndoCount(state.undoCount);
    setRedoCount(state.redoCount);
  }, []);

  useEffect(() => {
    void refreshUndoState();
  }, [refreshUndoState]);

  const pushCheckpoint = useCallback(async (label: string) => {
    const state = await window.tonehubDesktop.library.pushUndo({
      label,
      params: { ...paramsRef.current },
      activeSlot: slotRef.current,
    });
    setUndoCount(state.undoCount);
    setRedoCount(state.redoCount);
    checkpointArmed.current = false;
  }, []);

  const onParamChange = useCallback(
    (param: LiveParamName, value: number) => {
      midiLog("ui-knob", { slot: slotRef.current, param, value });
      if (param === "time" && !writingTempoRef.current) {
        setTempoSynced(false);
      }
      if (checkpointArmed.current) {
        checkpointArmed.current = false;
        void pushCheckpoint(`live:${param}`);
      }

      // Section bit alone sometimes ACKs without muting DSP after a slot push.
      // Off → also park wet controls on the device; On → re-assert UI wet values.
      // UI knobs keep their values while the section LED is off (restore on enable).
      if (param === "delaySection") {
        setParams((prev) => ({ ...prev, delaySection: value }));
        scheduleWrite("delaySection", value);
        if (value === 0) {
          midiLog("ui-section-bypass", {
            section: "delay",
            mix: 0,
            modulation: LIVE_PARAM_MODULATION_OFF,
          });
          scheduleWrite("mix", 0);
          // MOD off = center 8 (not 0 — 0 is full chorus).
          scheduleWrite("modulation", LIVE_PARAM_MODULATION_OFF);
        } else {
          const live = paramsRef.current;
          midiLog("ui-section-restore", {
            section: "delay",
            mix: live.mix,
            modulation: live.modulation,
          });
          scheduleWrite("mix", live.mix);
          scheduleWrite("modulation", live.modulation);
        }
        return;
      }
      if (param === "irSection") {
        setParams((prev) => ({ ...prev, irSection: value }));
        scheduleWrite("irSection", value);
        // Gate alone can ACK without muting — park wet IR path like delay does.
        if (value === 0) {
          midiLog("ui-section-bypass", { section: "ir", reverb: 0 });
          scheduleWrite("reverb", 0);
        } else {
          midiLog("ui-section-restore", {
            section: "ir",
            reverb: paramsRef.current.reverb,
          });
          scheduleWrite("reverb", paramsRef.current.reverb);
        }
        return;
      }
      if (param === "toneSection") {
        // CubeSuite 0x1c is amp-path gate (bypass), not hard silence — park drive knobs.
        setParams((prev) => ({ ...prev, toneSection: value }));
        scheduleWrite("toneSection", value);
        if (value === 0) {
          midiLog("ui-section-bypass", { section: "tone", gain: 0, tone: 0 });
          scheduleWrite("gain", 0);
          scheduleWrite("tone", 0);
        } else {
          const live = paramsRef.current;
          midiLog("ui-section-restore", {
            section: "tone",
            gain: live.gain,
            tone: live.tone,
          });
          scheduleWrite("gain", live.gain);
          scheduleWrite("tone", live.tone);
        }
        return;
      }

      setParams((prev) => ({ ...prev, [param]: value }));
      scheduleWrite(param, value);
      // Mix at 0 only kills delay wet (Mix/FB/Time). MOD is independent (center 7–8 = off).
    },
    [scheduleWrite, pushCheckpoint],
  );

  const onApplyTempoTime = useCallback(
    (time: number) => {
      writingTempoRef.current = true;
      setTempoSynced(true);
      onParamChange("time", time);
      writingTempoRef.current = false;
    },
    [onParamChange],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      checkpointArmed.current = true;
    }, 700);
    return () => window.clearTimeout(timer);
  }, [params]);

  async function onSelectSlot(slot: PresetSlotId) {
    if (actionBusy || slot === activeSlot) return;
    const gen = ++slotApplyGen.current;
    setError(null);
    setNav("editor");

    // UI switches instantly from bank cache; live push is coalesced in the bridge
    // (rapid A→B→C only sends the last slot) so knobs on B/C edit the audible tone.
    let nextParams: LiveParamsSnapshot;
    try {
      nextParams = slotParams(bankRef.current, slot);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    midiLog("ui-slot-select", { from: activeSlot, to: slot, gen });
    await cancelPending();
    await pushCheckpoint(t("studio.checkpoint.slot", { slot }));
    setParams(nextParams);
    setActiveSlot(slot);
    setLiveDirty(false);
    setLoadingSlot(null);
    checkpointArmed.current = true;
    setStatus(t("studio.slotApplying", { slot }));

    void window.tonehubDesktop
      .applySlotToLive(slot)
      .then(() => {
        if (gen !== slotApplyGen.current) {
          midiLog("ui-slot-apply-stale", { slot, gen, current: slotApplyGen.current });
          return;
        }
        setStatus(t("studio.slotDone", { slot }));
        midiLog("ui-slot-apply-ok", { slot, gen });
      })
      .catch((err: unknown) => {
        if (gen !== slotApplyGen.current) return;
        const message = err instanceof Error ? err.message : String(err);
        midiWarn("ui-slot-apply-fail", { slot, gen, error: message });
        setError(message);
        setStatus(null);
      });
  }

  async function onSave() {
    if (busy) return;
    const ok = await confirm({
      title: t("studio.saveTitle", { slot: activeSlot }),
      body: t("studio.saveBody"),
      tone: "warn",
      confirmLabel: t("toolbar.saveSlot", { slot: activeSlot }),
    });
    if (!ok) return;
    setActionBusy(true);
    setError(null);
    setStatus(t("studio.saving", { slot: activeSlot }));
    try {
      await flush();
      const result = await window.tonehubDesktop.saveSlot(activeSlot, params);
      setBank(result.bank);
      setLiveDirty(false);
      setStatus(
        result.verified
          ? t("studio.savedOk", { slot: activeSlot })
          : t("studio.savedVerifyFail", { slot: activeSlot }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setActionBusy(false);
    }
  }

  async function onExportBank() {
    if (busy) return;
    setActionBusy(true);
    setError(null);
    setStatus(t("studio.exporting"));
    try {
      await flush();
      const result = await window.tonehubDesktop.exportBank();
      if (result === null) {
        setStatus(null);
        return;
      }
      setStatus(t("studio.exported", { path: result.path }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setActionBusy(false);
    }
  }

  async function onImportBank() {
    if (busy) return;
    const ok = await confirm({
      title: t("studio.importTitle"),
      body: t("studio.importBody", { slot: activeSlot }),
      detail: t("studio.importDetail"),
      tone: "warn",
      confirmLabel: t("studio.chooseFile"),
    });
    if (!ok) return;
    setActionBusy(true);
    setError(null);
    setStatus(t("studio.importing"));
    try {
      await flush();
      await pushCheckpoint(t("studio.checkpoint.importBank"));
      const result = await window.tonehubDesktop.importBank(activeSlot);
      if (result === null) {
        setStatus(null);
        return;
      }
      setParams(result.liveParams);
      setActiveSlot(result.activeSlot);
      setBank(result.bank);
      checkpointArmed.current = true;
      setStatus(
        result.verified
          ? t("studio.restoredOk", { slot: result.activeSlot, path: result.path })
          : t("studio.restoredVerifyFail", { path: result.path }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setActionBusy(false);
    }
  }

  function onIrDistanceChange(distance: number) {
    const next = Math.min(1, Math.max(0, distance));
    setIrDistance(next);
    try {
      localStorage.setItem("cubecontrol.irDistance", String(next));
    } catch {
      /* ignore quota */
    }
  }

  function onLoadIrClick() {
    if (busy) return;
    if (irCabinet < 1 || irCabinet > 8) {
      setError(t("studio.pickCab"));
      return;
    }
    // Must open the file picker synchronously from the click gesture.
    // confirm/prompt first (Cab 1–7) consumes the gesture and Chromium blocks .click().
    fileRef.current?.click();
  }

  async function onIrFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (file === undefined) return;

    if (irCabinet !== 8) {
      const ok = await confirm({
        title: t("studio.overwriteCabTitle", { cab: irCabinet }),
        body: t("studio.overwriteCabBody"),
        detail: t("studio.overwriteCabDetail", { file: file.name, rom: irCabinet - 1 }),
        tone: "danger",
        confirmLabel: t("common.follow"),
      });
      if (!ok) {
        if (fileRef.current) fileRef.current.value = "";
        setStatus(t("studio.irCancelled"));
        return;
      }
      const ok2 = await confirm({
        title: t("studio.irLastTitle"),
        body: t("studio.irLastBody", { cab: irCabinet }),
        tone: "danger",
        requireTyped: `CAB${irCabinet}`,
        confirmLabel: t("studio.irWrite"),
      });
      if (!ok2) {
        if (fileRef.current) fileRef.current.value = "";
        setStatus(t("studio.irCancelled2"));
        return;
      }
    }

    const romSlot = irCabinet - 1;
    setActionBusy(true);
    setError(null);
    setStatus(
      t("studio.irLoading", {
        file: file.name,
        cab: irCabinet,
        pct: Math.round(irDistance * 100),
      }),
    );
    midiLog("ir-load-start", {
      file: file.name,
      cabinet: irCabinet,
      romSlot,
      distance: irDistance,
    });
    try {
      await flush();
      await pushCheckpoint(t("studio.checkpoint.ir"));
      const buffer = new Uint8Array(await file.arrayBuffer());
      const result = await window.tonehubDesktop.loadIrFromWav(buffer, irCabinet, {
        confirmFactoryIrOverwrite: irCabinet !== 8,
        distance: irDistance,
      });
      setParams((prev) => ({ ...prev, cabinet: result.cabinet }));
      setNav("editor");
      checkpointArmed.current = true;
      midiLog("ir-load-done", {
        cabinet: result.cabinet,
        slotIndex: result.slotIndex,
        persistVerified: result.persistVerified,
        liveMatch: result.liveMatch,
        distance: irDistance,
      });
      setStatus(
        result.persistVerified
          ? t("studio.irReady", {
              cab: result.cabinet,
              pct: Math.round(irDistance * 100),
              match: result.liveMatch,
            })
          : t("studio.irVerifyFail", { cab: result.cabinet, match: result.liveMatch }),
      );
    } catch (err) {
      midiWarn("ir-load-fail", {
        cabinet: irCabinet,
        error: err instanceof Error ? err.message : String(err),
      });
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setActionBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onUndo() {
    if (busy || undoCount === 0) return;
    setActionBusy(true);
    setError(null);
    try {
      await flush();
      const result = await window.tonehubDesktop.library.undo({
        params: { ...params },
        activeSlot,
        label: t("studio.checkpoint.undo"),
      });
      setUndoCount(result.undoCount);
      setRedoCount(result.redoCount);
      if (result.snapshot === null) return;
      setParams(result.snapshot.params);
      setActiveSlot(result.snapshot.activeSlot);
      checkpointArmed.current = true;
      setStatus(t("studio.undo", { label: result.snapshot.label }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function onRedo() {
    if (busy || redoCount === 0) return;
    setActionBusy(true);
    setError(null);
    try {
      await flush();
      const result = await window.tonehubDesktop.library.redo({
        params: { ...params },
        activeSlot,
        label: t("studio.checkpoint.redo"),
      });
      setUndoCount(result.undoCount);
      setRedoCount(result.redoCount);
      if (result.snapshot === null) return;
      setParams(result.snapshot.params);
      setActiveSlot(result.snapshot.activeSlot);
      checkpointArmed.current = true;
      setStatus(t("studio.redo", { label: result.snapshot.label }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function refreshLiveDirty(live: LiveParamsSnapshot, slot: PresetSlotId): Promise<boolean> {
    const bank = await window.tonehubDesktop.getBank();
    const dirty = liveDiffersFromBankSlot(live, bank, slot);
    setLiveDirty(dirty);
    return dirty;
  }

  async function onCompare() {
    if (busy) return;
    setActionBusy(true);
    setError(null);
    try {
      await flush();
      // Single bank read — never parallel MIDI on the same link.
      const bank = await window.tonehubDesktop.getBank();
      const dirty = liveDiffersFromBankSlot(params, bank, activeSlot);
      setLiveDirty(dirty);
      const a = bank.slots[0];
      const b = bank.slots[1];
      const c = bank.slots[2];
      const rows = LIVE_PARAM_NAMES.map((param) => {
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
      setCompareRows(rows);
      setCompareOpen(true);
      const volume = rows.find((row) => row.param === "volume");
      if (dirty) {
        setStatus(t("studio.compareDirty", { slot: activeSlot }));
      } else if (volume?.differs) {
        setStatus(
          t("studio.volDiff", { a: volume.a, b: volume.b, c: volume.c }),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function onMatchVolumes(source: MatchVolumesSource) {
    if (busy) return;
    const label =
      source === "live"
        ? t("studio.matchLiveLabel", { v: params.volume })
        : t("studio.matchSlotLabel", { slot: source });
    const ok = await confirm({
      title: t("studio.matchTitle"),
      body: t("studio.matchBody", { label }),
      tone: "warn",
      confirmLabel: t("studio.matchCta"),
    });
    if (!ok) return;
    setActionBusy(true);
    setError(null);
    setStatus(t("studio.matching"));
    try {
      await flush();
      await pushCheckpoint(t("studio.checkpoint.matchVol"));
      const result = await window.tonehubDesktop.matchVolumes(
        source,
        activeSlot,
        source === "live" ? params.volume : undefined,
      );
      setParams(result.liveParams);
      setActiveSlot(result.activeSlot);
      setBank(result.bank);
      checkpointArmed.current = true;
      const rows = await window.tonehubDesktop.library.compareSlots();
      setCompareRows(rows);
      setStatus(
        result.verified
          ? t("studio.matchedOk", {
              v: result.volume,
              a: result.volumes.a,
              b: result.volumes.b,
              c: result.volumes.c,
            })
          : t("studio.matchedFail", { v: result.volume }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setActionBusy(false);
    }
  }

  async function onCopyLiveTo(to: PresetSlotId) {
    if (busy || to === activeSlot) return;
    const fromSlot = activeSlot;
    const dirty = await refreshLiveDirty(params, fromSlot).catch(() => liveDirty);
    const ok = await confirm({
      title: t("studio.copyLiveTitle", { from: fromSlot, to }),
      body: t("studio.copyLiveBody", { to }),
      detail: dirty
        ? t("studio.copyLiveDetailDirty", { from: fromSlot })
        : t("studio.copyLiveDetailClean", { from: fromSlot }),
      tone: "warn",
      confirmLabel: t("studio.copyTo", { to }),
    });
    if (!ok) return;
    setActionBusy(true);
    setError(null);
    setStatus(t("studio.copyingLive", { to }));
    try {
      await flush();
      await pushCheckpoint(t("studio.checkpoint.copyLive", { to }));
      const result = await window.tonehubDesktop.copySlot("live", to, {
        live: params,
        liveSlot: fromSlot,
      });
      setParams(result.liveParams);
      setActiveSlot(result.activeSlot);
      setBank(result.bank);
      checkpointArmed.current = true;
      setLiveDirty(false);
      if (compareOpen) {
        const rows = await window.tonehubDesktop.library.compareSlots();
        setCompareRows(rows);
      }
      setStatus(
        result.verified
          ? t("studio.copyLiveOk", { to, from: fromSlot })
          : t("studio.copyLiveFail", { to }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setActionBusy(false);
    }
  }

  async function onCopySlotFrom(from: PresetSlotId, to: PresetSlotId) {
    if (busy || from === to) return;
    await flush();
    const dirty =
      from === activeSlot ? await refreshLiveDirty(params, activeSlot).catch(() => liveDirty) : false;

    let source: "live" | PresetSlotId = from;
    if (dirty) {
      const useLive = await confirm({
        title: t("studio.copyDirtyTitle", { from }),
        body: t("studio.copyDirtyBody", { to }),
        detail: t("studio.copyDirtyDetail", { from }),
        tone: "warn",
        confirmLabel: t("studio.copyLiveCta", { to }),
      });
      if (!useLive) return;
      source = "live";
    } else {
      const ok = await confirm({
        title: t("studio.copyBankTitle", { from, to }),
        body: t("studio.copyBankBody", { to }),
        tone: "warn",
        confirmLabel: t("common.copy"),
      });
      if (!ok) return;
    }

    setActionBusy(true);
    setError(null);
    setStatus(t("studio.copying", { from: source === "live" ? "live" : from, to }));
    try {
      await pushCheckpoint(
        t("studio.checkpoint.copy", { from: source === "live" ? "live" : from, to }),
      );
      const result =
        source === "live"
          ? await window.tonehubDesktop.copySlot("live", to, {
              live: params,
              liveSlot: activeSlot,
            })
          : await window.tonehubDesktop.copySlot(from, to);
      setParams(result.liveParams);
      setActiveSlot(result.activeSlot);
      setBank(result.bank);
      checkpointArmed.current = true;
      setLiveDirty(false);
      const rows = await window.tonehubDesktop.library.compareSlots();
      setCompareRows(rows);
      setStatus(
        result.verified
          ? source === "live"
            ? t("studio.copyOkLive", { to })
            : t("studio.copyOkBank", { from, to })
          : t("studio.copyFail", { to }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setActionBusy(false);
    }
  }

  async function onApplyLibraryPreset(next: LiveParamsSnapshot, label: string) {
    if (!hasPedal) {
      setError(t("studio.needPedal"));
      return;
    }
    setActionBusy(true);
    setError(null);
    try {
      await flush();
      await pushCheckpoint(label);
      await window.tonehubDesktop.applyLiveParams(next);
      setParams(next);
      checkpointArmed.current = true;
      setNav("editor");
      setStatus(t("studio.toneApplied"));
    } finally {
      setActionBusy(false);
    }
  }

  async function resolveSongPreset(song: SongLibraryItem): Promise<LiveParamsSnapshot> {
    const index = await window.tonehubDesktop.library.list();
    const preset = index.presets.find((p) => p.id === song.presetId);
    if (preset === undefined) throw new Error(t("studio.toneMissing", { name: song.name }));
    return applyGrooveTime(
      preset.params,
      song.bpm,
      isDelayNoteId(song.delayNote) ? song.delayNote : undefined,
    );
  }

  async function onApplySong(song: SongLibraryItem) {
    if (!hasPedal) {
      setError(t("studio.needPedal"));
      return;
    }
    setActionBusy(true);
    setError(null);
    try {
      await flush();
      await pushCheckpoint(t("studio.checkpoint.song", { name: song.name }));
      const next = await resolveSongPreset(song);
      await window.tonehubDesktop.applyLiveParams(next);
      setParams(next);
      if (song.bpm !== undefined && Number.isFinite(song.bpm)) {
        setSessionBpm(song.bpm);
        setSessionNote(isDelayNoteId(song.delayNote) ? song.delayNote : DEFAULT_DELAY_NOTE);
        setTempoSynced(true);
      }
      if (song.irId) {
        const cabinet = song.irCabinet ?? irCabinet;
        if (cabinet !== 8) {
          const ok = await confirm({
            title: t("studio.songIrTitle", { cab: cabinet }),
            body: t("studio.songIrBody"),
            tone: "danger",
            confirmLabel: t("common.follow"),
          });
          if (!ok) {
            setStatus(t("studio.songIrSkipped", { name: song.name }));
            checkpointArmed.current = true;
            return;
          }
          const ok2 = await confirm({
            title: t("studio.irLastTitle"),
            body: t("studio.songIrLastBody", { cab: cabinet }),
            tone: "danger",
            requireTyped: `CAB${cabinet}`,
            confirmLabel: t("studio.irWrite"),
          });
          if (!ok2) {
            setStatus(t("studio.songIrSkipped", { name: song.name }));
            checkpointArmed.current = true;
            return;
          }
        }
        await window.tonehubDesktop.library.loadIrToPedal(song.irId, cabinet, {
          confirmFactoryIrOverwrite: cabinet !== 8,
          distance: song.irDistance ?? irDistance,
        });
        setParams((prev) => ({ ...prev, cabinet }));
      }
      checkpointArmed.current = true;
      setStatus(t("studio.songApplied", { name: song.name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setActionBusy(false);
    }
  }

  async function onAssignSongToSlot(song: SongLibraryItem, slot: PresetSlotId) {
    if (!hasPedal) {
      setError(t("studio.needPedal"));
      return;
    }
    setActionBusy(true);
    setError(null);
    try {
      await flush();
      await pushCheckpoint(t("studio.checkpoint.songFoot", { name: song.name, slot }));
      const next = await resolveSongPreset(song);
      const result = await window.tonehubDesktop.copySlot("live", slot, {
        live: next,
        liveSlot: activeSlot,
      });
      setBank(result.bank);
      setActiveSlot(slot);
      setParams(next);
      checkpointArmed.current = true;
      setStatus(t("studio.songToFoot", { name: song.name, slot }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setActionBusy(false);
    }
  }

  async function onArmBank(slots: {
    readonly A: SongLibraryItem | null;
    readonly B: SongLibraryItem | null;
    readonly C: SongLibraryItem | null;
  }) {
    if (!hasPedal) {
      setError(t("studio.needPedal"));
      return;
    }
    setActionBusy(true);
    setError(null);
    try {
      await flush();
      await pushCheckpoint(t("studio.checkpoint.arm"));
      for (const slot of ["A", "B", "C"] as const) {
        const song = slots[slot];
        if (song === null) continue;
        const next = await resolveSongPreset(song);
        await window.tonehubDesktop.saveSlot(slot, next);
      }
      const bankSnap = await window.tonehubDesktop.getBank();
      setBank(bankSnap);
      const liveSong = slots[activeSlot] ?? slots.A ?? slots.B ?? slots.C;
      if (liveSong) {
        const next = await resolveSongPreset(liveSong);
        await window.tonehubDesktop.applyLiveParams(next);
        setParams(next);
      }
      checkpointArmed.current = true;
      setStatus(t("studio.bankArmed"));
      setNav("editor");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setActionBusy(false);
    }
  }

  async function refreshShowContext(showId: string | null) {
    if (showId === null) {
      setActiveShow(null);
      return;
    }
    const index = await window.tonehubDesktop.library.list();
    setLibrarySongs(index.songs);
    const show = index.shows.find((s) => s.id === showId) ?? null;
    setActiveShow(show);
  }

  const toolbarStatus =
    error ??
    (loadingSlot ? t("studio.slotLoading", { slot: loadingSlot }) : null) ??
    status;

  const showChip =
    activeShow === null
      ? null
      : t("studio.showChip", {
          name: activeShow.name,
          current: Math.min(activeSongIndex + 1, Math.max(activeShow.songIds.length, 1)),
          total: activeShow.songIds.length || 0,
        });

  return (
    <div className={`studio${nav === "stage" ? " studio--stage" : ""}`}>
      <StudioSidebar
        deviceName={connection.deviceName}
        activeSlot={activeSlot}
        nav={nav}
        busy={busy}
        onNav={setNav}
        onSelectSlot={(slot) => void onSelectSlot(slot)}
        onDisconnect={onDisconnect}
        hasPedal={hasPedal}
      />

      <div className="studio__workspace">
        {nav !== "stage" ? (
          <StudioToolbar
            busy={busy}
            canUndo={undoCount > 0}
            canRedo={redoCount > 0}
            activeSlot={activeSlot}
            status={toolbarStatus}
            activeShowLabel={showChip}
            onUndo={() => void onUndo()}
            onRedo={() => void onRedo()}
            onSave={() => void onSave()}
            onCompare={() => void onCompare()}
            onCopyTo={(to) => void onCopyLiveTo(to)}
            onOpenShow={() => setNav("library")}
            hasPedal={hasPedal}
          />
        ) : null}

        <div className="studio__canvas">
          <main
            className={
              nav === "tuner" || nav === "library" || nav === "stage" || nav === "device"
                ? "studio__main studio__main--wide"
                : "studio__main studio__main--pedal"
            }
          >
            {nav === "tuner" ? (
              <TunerPanel active={nav === "tuner"} />
            ) : nav === "library" ? (
              <LibraryWorkspace
                busy={busy}
                liveParams={params}
                irCabinet={irCabinet}
                irDistance={irDistance}
                activeShowId={activeShow?.id ?? null}
                activeSongIndex={activeSongIndex}
                onIrDistanceChange={onIrDistanceChange}
                onStatus={setStatus}
                onError={setError}
                onBusy={setActionBusy}
                onApplyPreset={onApplyLibraryPreset}
                onApplySong={onApplySong}
                onArmBank={onArmBank}
                onAssignSongToSlot={onAssignSongToSlot}
                onActiveShowChange={(showId, songIndex = 0) => {
                  setActiveSongIndex(songIndex);
                  void refreshShowContext(showId);
                }}
                onEnterStage={(showId) => {
                  void (async () => {
                    await refreshShowContext(showId);
                    setActiveSongIndex(0);
                    setNav("stage");
                  })();
                }}
                onCabinetApplied={(cabinet) => {
                  setParams((prev) => ({ ...prev, cabinet }));
                }}
              />
            ) : nav === "device" ? (
              hasPedal ? (
              <DeviceWorkspace
                busy={busy}
                irCabinet={irCabinet}
                irDistance={irDistance}
                onIrCabinetChange={setIrCabinet}
                onIrDistanceChange={onIrDistanceChange}
                onLoadIr={onLoadIrClick}
                onExportBank={() => void onExportBank()}
                onImportBank={() => void onImportBank()}
                onCompare={() => void onCompare()}
              />
              ) : (
                <p className="studio__need-pedal">{t("studio.needPedal")}</p>
              )
            ) : nav === "stage" && activeShow ? (
              <StageMode
                show={activeShow}
                songs={librarySongs}
                songIndex={activeSongIndex}
                busy={busy}
                onSongIndexChange={setActiveSongIndex}
                onApplySong={onApplySong}
                onAssignSongToSlot={onAssignSongToSlot}
                onExit={() => setNav("library")}
              />
            ) : hasPedal ? (
              <>
                <CubeBabyPedal
                  params={params}
                  activeSlot={activeSlot}
                  busy={busy}
                  onParamChange={onParamChange}
                  onSelectSlot={(slot) => void onSelectSlot(slot)}
                />
                <DelayTapBar
                  bpm={sessionBpm}
                  note={sessionNote}
                  synced={tempoSynced}
                  liveTime={params.time}
                  disabled={busy}
                  onBpmChange={setSessionBpm}
                  onNoteChange={setSessionNote}
                  onApplyTime={onApplyTempoTime}
                />
              </>
            ) : (
              <p className="studio__need-pedal">{t("studio.needPedal")}</p>
            )}
          </main>
        </div>
      </div>

      <ComparePanel
        open={compareOpen}
        rows={compareRows}
        busy={busy}
        liveParams={params}
        liveDirty={liveDirty}
        activeSlot={activeSlot}
        onClose={() => setCompareOpen(false)}
        onMatchVolumes={(source) => void onMatchVolumes(source)}
        onCopySlot={(from, to) => void onCopySlotFrom(from, to)}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".wav,audio/wav"
        hidden
        onChange={(event) => void onIrFile(event.target.files)}
      />
      {confirmDialog}
    </div>
  );
}
