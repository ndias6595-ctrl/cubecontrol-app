import {
  LIVE_PARAM_MAX,
  LIVE_PARAM_MODULATION_OFF,
  type CubeBabyPresetBank,
  type LiveParamName,
  type PresetSlotId,
} from "@tonehub/cube-baby-protocol";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AccessibilityInfo, AppState as RnAppState } from "react-native";
import {
  connectDemo,
  connectUsb,
  isUsbHostAvailable,
  OTG_UNPLUGGED,
  UsbDeviceNotFoundError,
  UsbHostUnavailableError,
  UsbPermissionDeniedError,
  type DeviceConnection,
} from "../device/connect";
import {
  copySlot as restoreCopySlot,
  exportBankJson,
  matchVolumes as restoreMatchVolumes,
  restoreBankFromJson,
  saveSlot as restoreSaveSlot,
  type CopySlotSource,
  type MatchVolumesSource,
} from "../device/bank";
import { readUriBytes, writeLibraryWav } from "../device/files";
import { loadIrFromWav as restoreLoadIr } from "../device/ir";
import { applyLiveParams, applySlotToLive, bankSummary, slotIndexOf, writeLiveParam } from "../device/live";
import { loadLibrary, newId, nowIso, saveLibrary } from "../library/storage";
import type {
  IrLibraryItem,
  LibraryProfile,
  LiveParamsSnapshot,
  MobileLibrary,
  PresetLibraryItem,
  ShowLibraryItem,
  SongLibraryItem,
} from "../library/types";
import { emptyLibrary, toggleFavoriteTag } from "../library/types";
import { mergeShare, shareImportResult, type ShareImportResult } from "../library/shareBuild";
import type { SharePayload } from "../library/shareFormat";
import type { ParsedPack, PackImportResult } from "../library/packFormat";
import {
  applyGrooveTime,
  bpmFromTapTimes,
  clampBpm,
  DEFAULT_DELAY_NOTE,
  isDelayNoteId,
  type DelayNoteId,
} from "../music/delaySync";
import { readSafetyAcceptance, SafetyRequiredError, writeSafetyAcceptance, clearSafetyAcceptance } from "../safety/disclaimer";
import { createLiveHistory, type LiveCheckpoint } from "./liveHistory";
import * as Linking from "expo-linking";
import { MobileSyncService, type MobileSyncStatus, type SyncPrepareResult } from "../sync/service";

type ConnectKind = "usb" | "demo";

type AppState = {
  readonly connection: DeviceConnection | null;
  /** Tabs are reachable without USB so library/share/sync work offline. */
  readonly shellOpen: boolean;
  readonly connecting: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly errorCode: string | null;
  readonly usbAvailable: boolean;
  readonly slot: PresetSlotId;
  readonly live: LiveParamsSnapshot | null;
  readonly bpm: number;
  readonly delayNote: DelayNoteId;
  readonly tapTimes: readonly number[];
  readonly tempoSynced: boolean;
  readonly library: MobileLibrary;
  readonly activeShowId: string | null;
  readonly songIndex: number;
  readonly reduceMotion: boolean;
  readonly status: string | null;
  readonly safetyAccepted: boolean;
  readonly safetyReady: boolean;
  readonly libraryReady: boolean;
  readonly undoCount: number;
  readonly redoCount: number;
  readonly irCabinet: number;
  readonly irDistance: number;
  readonly sync: MobileSyncStatus;
  readonly syncBusy: boolean;
  readonly syncError: string | null;
  readonly syncNotice: string | null;
  readonly syncPrepare: SyncPrepareResult | null;
};

type AppActions = {
  connect: (kind: ConnectKind) => Promise<boolean>;
  openLibrary: () => void;
  disconnect: () => Promise<void>;
  clearError: () => void;
  acceptSafety: () => Promise<void>;
  requireSafety: () => void;
  selectSlot: (slot: PresetSlotId) => Promise<void>;
  setLiveField: (param: LiveParamName, value: number) => void;
  tapTempo: () => Promise<void>;
  setDelayNote: (note: DelayNoteId) => Promise<void>;
  setBpm: (bpm: number) => Promise<void>;
  undoLive: () => Promise<void>;
  redoLive: () => Promise<void>;
  saveSlot: (slot?: PresetSlotId) => Promise<boolean>;
  copySlot: (from: CopySlotSource, to: PresetSlotId) => Promise<boolean>;
  exportBank: () => Promise<string | null>;
  importBank: (jsonText: string) => Promise<boolean>;
  refreshBank: () => Promise<void>;
  matchVolumes: (source: MatchVolumesSource) => Promise<boolean>;
  loadIrWav: (
    wav: Uint8Array,
    cabinet: number,
    options: { confirmFactoryIrOverwrite: boolean; distance: number; fileName?: string },
  ) => Promise<boolean>;
  setIrCabinet: (cabinet: number) => void;
  setIrDistance: (distance: number) => void;
  resetSafety: () => Promise<void>;
  savePreset: (input: {
    readonly name: string;
    readonly notes?: string;
    readonly profile?: LibraryProfile;
    readonly tags?: readonly string[];
    readonly id?: string;
  }) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  importIr: (uri: string, name: string) => Promise<void>;
  deleteIr: (id: string) => Promise<void>;
  loadLibraryIr: (id: string) => Promise<boolean>;
  armBank: (slots: { readonly A: string | null; readonly B: string | null; readonly C: string | null }) => Promise<boolean>;
  applyTone: (toneId: string) => Promise<void>;
  applySong: (songId: string) => Promise<void>;
  assignSongToSlot: (songId: string, slot: PresetSlotId) => Promise<void>;
  saveSong: (input: {
    readonly name: string;
    readonly presetId: string;
    readonly notes?: string;
    readonly bpm?: number;
    readonly delayNote?: DelayNoteId;
    readonly irId?: string;
    readonly irCabinet?: number;
    readonly irDistance?: number;
    readonly id?: string;
  }) => Promise<void>;
  importShare: (payload: SharePayload) => Promise<ShareImportResult>;
  importPack: (pack: ParsedPack) => Promise<PackImportResult>;
  saveShow: (name: string) => Promise<string>;
  renameShow: (showId: string, name: string) => Promise<void>;
  addSongToShow: (showId: string, songId: string) => Promise<void>;
  removeSongFromShow: (showId: string, songId: string) => Promise<void>;
  moveSongInShow: (showId: string, songId: string, direction: -1 | 1) => Promise<void>;
  deletePreset: (id: string) => Promise<void>;
  deleteSong: (id: string) => Promise<void>;
  deleteShow: (id: string) => Promise<void>;
  setActiveShow: (showId: string | null, songIndex?: number) => void;
  setSongIndex: (index: number) => void;
  syncSignIn: (email: string) => Promise<void>;
  syncComplete: (url: string) => Promise<void>;
  syncSignOut: () => Promise<void>;
  syncNow: () => Promise<void>;
  confirmSyncPolicy: (
    policy: "use-cloud" | "upload-local",
    mergeTwins: boolean,
  ) => Promise<void>;
  cancelSyncPrepare: () => void;
  clearSyncError: () => void;
};

type AppContextValue = AppState & AppActions;

const EMPTY_LIBRARY: MobileLibrary = emptyLibrary();

const AppContext = createContext<AppContextValue | null>(null);

function errorCodeOf(error: unknown): string | null {
  if (error instanceof UsbHostUnavailableError) return error.code;
  if (error instanceof UsbDeviceNotFoundError) return error.code;
  if (error instanceof UsbPermissionDeniedError) return error.code;
  if (error instanceof SafetyRequiredError) return error.code;
  return null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function AppProvider({ children }: { readonly children: ReactNode }) {
  const [connection, setConnection] = useState<DeviceConnection | null>(null);
  const [shellOpen, setShellOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [usbAvailable] = useState(() => isUsbHostAvailable());
  const [slot, setSlot] = useState<PresetSlotId>("A");
  const [live, setLive] = useState<LiveParamsSnapshot | null>(null);
  const [bpm, setBpmState] = useState(120);
  const [delayNote, setDelayNoteState] = useState<DelayNoteId>(DEFAULT_DELAY_NOTE);
  const [tapTimes, setTapTimes] = useState<readonly number[]>([]);
  const [tempoSynced, setTempoSynced] = useState(true);
  const [library, setLibrary] = useState<MobileLibrary>(EMPTY_LIBRARY);
  const [libraryReady, setLibraryReady] = useState(false);
  const [activeShowId, setActiveShowId] = useState<string | null>(null);
  const [songIndex, setSongIndexState] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [safetyAccepted, setSafetyAccepted] = useState(false);
  const [safetyReady, setSafetyReady] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [irCabinet, setIrCabinetState] = useState(8);
  const [irDistance, setIrDistanceState] = useState(0.5);
  const [sync, setSync] = useState<MobileSyncStatus>({
    configured: true,
    signedIn: false,
    email: null,
    lastSyncAt: null,
  });
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [syncPrepare, setSyncPrepare] = useState<SyncPrepareResult | null>(null);

  const connectionRef = useRef<DeviceConnection | null>(null);
  const slotRef = useRef<PresetSlotId>("A");
  const liveRef = useRef<LiveParamsSnapshot | null>(null);
  const delayNoteRef = useRef<DelayNoteId>(DEFAULT_DELAY_NOTE);
  const bpmRef = useRef(120);
  const safetyAcceptedRef = useRef(false);
  const safetyLoadRef = useRef<Promise<boolean>>(Promise.resolve(false));
  const historyRef = useRef(createLiveHistory());
  const checkpointArmedRef = useRef(true);
  const rearmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef(Promise.resolve());
  const pendingLiveRef = useRef(new Map<LiveParamName, number>());
  const liveDrainRef = useRef(false);
  const libraryRef = useRef<MobileLibrary>(EMPTY_LIBRARY);
  const syncRef = useRef<MobileSyncService | null>(null);
  const skipAutoSyncRef = useRef(false);
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  connectionRef.current = connection;
  slotRef.current = slot;
  liveRef.current = live;
  delayNoteRef.current = delayNote;
  bpmRef.current = bpm;
  safetyAcceptedRef.current = safetyAccepted;
  libraryRef.current = library;

  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = queueRef.current.then(fn, fn);
    queueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const persist = useCallback(async (next: MobileLibrary) => {
    setLibrary(next);
    await saveLibrary(next);
    if (skipAutoSyncRef.current) return;
    if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
    autoSyncTimerRef.current = setTimeout(() => {
      autoSyncTimerRef.current = null;
      const service = syncRef.current;
      if (service === null) return;
      void service.autoSync().then((result) => {
        if (result !== null) void service.status().then(setSync);
      });
    }, 2500);
  }, []);

  const publishHistory = useCallback(() => {
    const counts = historyRef.current.counts();
    setUndoCount(counts.undo);
    setRedoCount(counts.redo);
  }, []);

  const currentCheckpoint = useCallback((label: string): LiveCheckpoint | null => {
    const snapshot = liveRef.current;
    if (snapshot === null) return null;
    return { label, params: { ...snapshot }, slot: slotRef.current };
  }, []);

  const pushCheckpoint = useCallback(
    (label: string) => {
      const current = currentCheckpoint(label);
      if (current === null) return;
      historyRef.current.push(current);
      checkpointArmedRef.current = false;
      publishHistory();
    },
    [currentCheckpoint, publishHistory],
  );

  const maybeCheckpoint = useCallback(
    (label: string) => {
      if (!checkpointArmedRef.current) return;
      pushCheckpoint(label);
    },
    [pushCheckpoint],
  );

  const scheduleRearm = useCallback(() => {
    if (rearmTimerRef.current) clearTimeout(rearmTimerRef.current);
    rearmTimerRef.current = setTimeout(() => {
      checkpointArmedRef.current = true;
    }, 700);
  }, []);

  const patchConnection = useCallback((bank: CubeBabyPresetBank, extras?: Partial<DeviceConnection>) => {
    const current = connectionRef.current;
    if (current === null) return;
    const next: DeviceConnection = {
      ...current,
      bank,
      bankSummary: bankSummary(bank),
      ...extras,
    };
    connectionRef.current = next;
    setConnection(next);
  }, []);

  useEffect(() => {
    const load = readSafetyAcceptance().then((accepted) => {
      const ok = accepted !== null;
      safetyAcceptedRef.current = ok;
      setSafetyAccepted(ok);
      setSafetyReady(true);
      return ok;
    });
    safetyLoadRef.current = load;
    void loadLibrary()
      .then((loaded) => {
        setLibrary(loaded);
        if (loaded.shows[0]) setActiveShowId(loaded.shows[0].id);
      })
      .finally(() => setLibraryReady(true));
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      sub.remove();
      if (rearmTimerRef.current) clearTimeout(rearmTimerRef.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      void connectionRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 4500);
    return () => clearTimeout(timer);
  }, [status]);

  const disconnect = useCallback(async () => {
    const current = connectionRef.current;
    connectionRef.current = null;
    setConnection(null);
    setLive(null);
    liveRef.current = null;
    setSlot("A");
    setTapTimes([]);
    setTempoSynced(true);
    historyRef.current.clear();
    publishHistory();
    checkpointArmedRef.current = true;
    if (current) await current.close();
  }, [publishHistory]);

  const requireSafety = useCallback(() => {
    if (!safetyAcceptedRef.current) throw new SafetyRequiredError();
  }, []);

  const acceptSafety = useCallback(async () => {
    await writeSafetyAcceptance();
    safetyAcceptedRef.current = true;
    setSafetyAccepted(true);
  }, []);

  const syncService = useCallback((): MobileSyncService => {
    if (syncRef.current === null) {
      syncRef.current = new MobileSyncService({
        getLibrary: () => libraryRef.current,
        setLibrary: (next) => persist(next),
      });
    }
    return syncRef.current;
  }, [persist]);

  const refreshSyncStatus = useCallback(async () => {
    if (syncRef.current === null) return;
    setSync(await syncRef.current.status());
  }, []);

  const syncSignIn = useCallback(
    async (email: string) => {
      setSyncBusy(true);
      setSyncError(null);
      setSyncNotice(null);
      try {
        await syncService().signInWithOtp(email);
        setSyncNotice("Revisa tu email y haz clic en el enlace.");
      } catch (err) {
        setSyncError(messageOf(err));
      } finally {
        setSyncBusy(false);
      }
    },
    [syncService],
  );

  const syncComplete = useCallback(
    async (url: string) => {
      try {
        await syncService().completeSignIn(url);
        await refreshSyncStatus();
      } catch (err) {
        setSyncError(messageOf(err));
      }
    },
    [refreshSyncStatus, syncService],
  );

  const syncSignOut = useCallback(async () => {
    await syncService().signOut();
    await refreshSyncStatus();
  }, [refreshSyncStatus, syncService]);

  const syncNow = useCallback(async () => {
    setSyncBusy(true);
    setSyncError(null);
    setSyncNotice(null);
    skipAutoSyncRef.current = true;
    try {
      const prepared = await syncService().prepareSync();
      if (prepared.kind === "conflict") {
        setSyncPrepare(prepared);
        return;
      }
      const result = await syncService().syncNow({ policy: "normal" });
      setSyncNotice(`Sync OK · +${result.pulled} · ${result.appliedUpserts}/${result.appliedDeletes}`);
      await refreshSyncStatus();
    } catch (err) {
      setSyncError(messageOf(err));
    } finally {
      skipAutoSyncRef.current = false;
      setSyncBusy(false);
    }
  }, [refreshSyncStatus, syncService]);

  const confirmSyncPolicy = useCallback(
    async (policy: "use-cloud" | "upload-local", mergeTwins: boolean) => {
      const prepared = syncPrepare;
      if (prepared === null) return;
      setSyncBusy(true);
      setSyncError(null);
      skipAutoSyncRef.current = true;
      try {
        const result = await syncService().syncNow({
          policy,
          mergeTwins: mergeTwins && prepared.twins.length > 0,
          twinKeep: policy === "use-cloud" ? "remote" : "local",
          twins: [...prepared.twins],
        });
        setSyncPrepare(null);
        setSyncNotice(`Sync OK · +${result.pulled} · ${result.appliedUpserts}/${result.appliedDeletes}`);
        await refreshSyncStatus();
      } catch (err) {
        setSyncError(messageOf(err));
      } finally {
        skipAutoSyncRef.current = false;
        setSyncBusy(false);
      }
    },
    [refreshSyncStatus, syncPrepare, syncService],
  );

  const cancelSyncPrepare = useCallback(() => setSyncPrepare(null), []);

  const clearSyncError = useCallback(() => setSyncError(null), []);

  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      if (url !== null && url.includes("auth/callback")) void syncComplete(url);
    });
    const sub = Linking.addEventListener("url", (event) => {
      if (event.url.includes("auth/callback")) void syncComplete(event.url);
    });
    return () => sub.remove();
  }, [syncComplete]);

  useEffect(() => {
    const sub = RnAppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      if (skipAutoSyncRef.current) return;
      const service = syncRef.current;
      if (service === null) return;
      void service.autoSync().then((result) => {
        if (result !== null) void service.status().then(setSync);
      });
    });
    return () => sub.remove();
  }, []);

  const connect = useCallback(
    async (kind: ConnectKind): Promise<boolean> => {
      if (connecting) return false;
      setConnecting(true);
      setError(null);
      setErrorCode(null);
      try {
        if (kind === "usb") {
          await safetyLoadRef.current;
          requireSafety();
        }
        await connectionRef.current?.close();
        const next = kind === "usb" ? await connectUsb() : await connectDemo();
        connectionRef.current = next;
        setShellOpen(true);
        setConnection(next);
        setLive(next.live);
        liveRef.current = next.live;
        setSlot(next.slot);
        slotRef.current = next.slot;
        historyRef.current.clear();
        publishHistory();
        checkpointArmedRef.current = true;
        setTempoSynced(true);
        next.onDetached(() => {
          void disconnect();
          setErrorCode("USB_UNPLUGGED");
          setError(OTG_UNPLUGGED);
        });
        return true;
      } catch (err) {
        connectionRef.current = null;
        setConnection(null);
        setLive(null);
        liveRef.current = null;
        setErrorCode(errorCodeOf(err));
        setError(messageOf(err));
        return false;
      } finally {
        setConnecting(false);
      }
    },
    [connecting, disconnect, publishHistory, requireSafety],
  );

  const openLibrary = useCallback(() => {
    setError(null);
    setErrorCode(null);
    setShellOpen(true);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setErrorCode(null);
  }, []);

  const requireSession = useCallback((): DeviceConnection => {
    const current = connectionRef.current;
    if (current === null) throw new Error("CUBE Baby no conectado");
    return current;
  }, []);

  const selectSlot = useCallback(
    async (nextSlot: PresetSlotId) => {
      setBusy(true);
      try {
        await enqueue(async () => {
          pushCheckpoint(`slot:${nextSlot}`);
          const current = requireSession();
          const nextLive = await applySlotToLive(current.session, current.bank, nextSlot);
          setSlot(nextSlot);
          slotRef.current = nextSlot;
          setLive(nextLive);
          liveRef.current = nextLive;
          checkpointArmedRef.current = true;
        });
      } catch (err) {
        setError(messageOf(err));
      } finally {
        setBusy(false);
      }
    },
    [enqueue, pushCheckpoint, requireSession],
  );

  const writeSectionPolicy = useCallback(
    async (param: LiveParamName, written: number, slotIndex: number) => {
      const current = requireSession();
      const snap = liveRef.current;
      if (snap === null) return;
      if (param === "delaySection") {
        if (written === 0) {
          await writeLiveParam(current.session, "mix", 0, slotIndex, false);
          await writeLiveParam(current.session, "modulation", LIVE_PARAM_MODULATION_OFF, slotIndex, false);
        } else {
          await writeLiveParam(current.session, "mix", snap.mix, slotIndex, false);
          await writeLiveParam(current.session, "modulation", snap.modulation, slotIndex, false);
        }
      }
      if (param === "irSection") {
        if (written === 0) {
          await writeLiveParam(current.session, "reverb", 0, slotIndex, false);
        } else {
          await writeLiveParam(current.session, "reverb", snap.reverb, slotIndex, false);
        }
      }
      if (param === "toneSection") {
        if (written === 0) {
          await writeLiveParam(current.session, "gain", 0, slotIndex, false);
          await writeLiveParam(current.session, "tone", 0, slotIndex, false);
        } else {
          await writeLiveParam(current.session, "gain", snap.gain, slotIndex, false);
          await writeLiveParam(current.session, "tone", snap.tone, slotIndex, false);
        }
      }
    },
    [requireSession],
  );

  const drainPendingLive = useCallback(() => {
    if (liveDrainRef.current) return;
    liveDrainRef.current = true;
    void enqueue(async () => {
      try {
        while (pendingLiveRef.current.size > 0) {
          const current = requireSession();
          const slotIndex = slotIndexOf(slotRef.current);
          const batch = new Map(pendingLiveRef.current);
          pendingLiveRef.current.clear();
          for (const [name, queued] of batch) {
            const latest = pendingLiveRef.current.get(name);
            const toWrite = latest ?? queued;
            if (latest !== undefined) pendingLiveRef.current.delete(name);
            const needsAck =
              name === "delaySection" || name === "irSection" || name === "toneSection" || name === "cabinet";
            await writeLiveParam(current.session, name, toWrite, slotIndex, needsAck);
            await writeSectionPolicy(name, toWrite, slotIndex);
          }
        }
        scheduleRearm();
      } catch (err) {
        setError(messageOf(err));
      } finally {
        liveDrainRef.current = false;
        if (pendingLiveRef.current.size > 0) drainPendingLive();
      }
    });
  }, [enqueue, requireSession, scheduleRearm, writeSectionPolicy]);

  const setLiveField = useCallback(
    (param: LiveParamName, value: number) => {
      const max = LIVE_PARAM_MAX[param];
      const clamped = Math.max(0, Math.min(max, Math.round(value)));
      if (liveRef.current?.[param] === clamped) return;
      maybeCheckpoint(`live:${param}`);
      if (param === "time") setTempoSynced(false);
      setLive((prev) => {
        if (!prev) return prev;
        const next = { ...prev, [param]: clamped };
        liveRef.current = next;
        return next;
      });
      pendingLiveRef.current.set(param, clamped);
      drainPendingLive();
    },
    [drainPendingLive, maybeCheckpoint],
  );

  const writeGrooveTime = useCallback(
    async (nextBpm: number, note: DelayNoteId) => {
      const current = requireSession();
      const snapshot = liveRef.current ?? current.live;
      const grooved = applyGrooveTime(snapshot, nextBpm, note);
      const written = await writeLiveParam(
        current.session,
        "time",
        grooved.time,
        slotIndexOf(slotRef.current),
      );
      const next = { ...grooved, time: written };
      liveRef.current = next;
      setLive(next);
      setTempoSynced(true);
    },
    [requireSession],
  );

  const tapTempo = useCallback(async () => {
    const stamp = Date.now();
    const windowed = [...tapTimes.filter((t) => stamp - t < 4000), stamp].slice(-6);
    setTapTimes(windowed);
    const nextBpm = bpmFromTapTimes(windowed);
    if (nextBpm === null) return;
    setBpmState(nextBpm);
    bpmRef.current = nextBpm;
    maybeCheckpoint("live:time");
    setBusy(true);
    try {
      await enqueue(() => writeGrooveTime(nextBpm, delayNoteRef.current));
      scheduleRearm();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }, [enqueue, maybeCheckpoint, scheduleRearm, tapTimes, writeGrooveTime]);

  const setDelayNote = useCallback(
    async (note: DelayNoteId) => {
      setDelayNoteState(note);
      delayNoteRef.current = note;
      maybeCheckpoint("live:time");
      setBusy(true);
      try {
        await enqueue(() => writeGrooveTime(bpmRef.current, note));
        scheduleRearm();
      } catch (err) {
        setError(messageOf(err));
      } finally {
        setBusy(false);
      }
    },
    [enqueue, maybeCheckpoint, scheduleRearm, writeGrooveTime],
  );

  const setBpm = useCallback(
    async (nextBpm: number) => {
      const clamped = clampBpm(nextBpm);
      setBpmState(clamped);
      bpmRef.current = clamped;
      maybeCheckpoint("live:time");
      setBusy(true);
      try {
        await enqueue(() => writeGrooveTime(clamped, delayNoteRef.current));
        scheduleRearm();
      } catch (err) {
        setError(messageOf(err));
      } finally {
        setBusy(false);
      }
    },
    [enqueue, maybeCheckpoint, scheduleRearm, writeGrooveTime],
  );

  const applySnapshot = useCallback(
    async (snapshot: LiveParamsSnapshot, nextSlot?: PresetSlotId) => {
      const current = requireSession();
      const target = nextSlot ?? slotRef.current;
      await applyLiveParams(current.session, snapshot, slotIndexOf(target));
      if (nextSlot) {
        setSlot(nextSlot);
        slotRef.current = nextSlot;
      }
      liveRef.current = snapshot;
      setLive(snapshot);
    },
    [requireSession],
  );

  const undoLive = useCallback(async () => {
    const current = currentCheckpoint("antes de undo");
    if (current === null) return;
    const prev = historyRef.current.popUndo(current);
    publishHistory();
    if (prev === null) return;
    setBusy(true);
    try {
      await enqueue(async () => {
        await applySnapshot(prev.params, prev.slot);
        checkpointArmedRef.current = true;
        setStatus(prev.label);
      });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }, [applySnapshot, currentCheckpoint, enqueue, publishHistory]);

  const redoLive = useCallback(async () => {
    const current = currentCheckpoint("antes de redo");
    if (current === null) return;
    const next = historyRef.current.popRedo(current);
    publishHistory();
    if (next === null) return;
    setBusy(true);
    try {
      await enqueue(async () => {
        await applySnapshot(next.params, next.slot);
        checkpointArmedRef.current = true;
        setStatus(next.label);
      });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }, [applySnapshot, currentCheckpoint, enqueue, publishHistory]);

  const saveSlot = useCallback(
    async (target?: PresetSlotId): Promise<boolean> => {
      await safetyLoadRef.current;
      requireSafety();
      const snapshot = liveRef.current;
      if (snapshot === null) return false;
      const slotId = target ?? slotRef.current;
      setBusy(true);
      try {
        const verified = await enqueue(async () => {
          const current = requireSession();
          const result = await restoreSaveSlot(current.session, slotId, snapshot);
          patchConnection(result.bank, { live: snapshot, slot: slotId });
          setSlot(slotId);
          slotRef.current = slotId;
          checkpointArmedRef.current = true;
          return result.verified;
        });
        setStatus(slotId);
        return verified;
      } catch (err) {
        setError(messageOf(err));
        setErrorCode(errorCodeOf(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [enqueue, patchConnection, requireSafety, requireSession],
  );

  const copySlot = useCallback(
    async (from: CopySlotSource, to: PresetSlotId): Promise<boolean> => {
      await safetyLoadRef.current;
      requireSafety();
      setBusy(true);
      try {
        const verified = await enqueue(async () => {
          pushCheckpoint(`copy:${from}→${to}`);
          const current = requireSession();
          const result = await restoreCopySlot(current.session, from, to, {
            live: from === "live" ? (liveRef.current ?? undefined) : undefined,
            liveSlot: slotRef.current,
          });
          patchConnection(result.bank, { live: result.liveParams, slot: result.activeSlot });
          setSlot(result.activeSlot);
          slotRef.current = result.activeSlot;
          liveRef.current = result.liveParams;
          setLive(result.liveParams);
          checkpointArmedRef.current = true;
          return result.verified;
        });
        setStatus(to);
        return verified;
      } catch (err) {
        setError(messageOf(err));
        setErrorCode(errorCodeOf(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [enqueue, patchConnection, pushCheckpoint, requireSafety, requireSession],
  );

  const exportBank = useCallback(async (): Promise<string | null> => {
    await safetyLoadRef.current;
    requireSafety();
    setBusy(true);
    try {
      const json = await enqueue(async () => {
        const current = requireSession();
        return exportBankJson(current.session);
      });
      setStatus("bank");
      return json;
    } catch (err) {
      setError(messageOf(err));
      setErrorCode(errorCodeOf(err));
      return null;
    } finally {
      setBusy(false);
    }
  }, [enqueue, requireSafety, requireSession]);

  const importBank = useCallback(
    async (jsonText: string): Promise<boolean> => {
      await safetyLoadRef.current;
      requireSafety();
      setBusy(true);
      try {
        const verified = await enqueue(async () => {
          pushCheckpoint("import-bank");
          const current = requireSession();
          const result = await restoreBankFromJson(current.session, jsonText, slotRef.current);
          patchConnection(result.bank, { live: result.liveParams, slot: result.activeSlot });
          setSlot(result.activeSlot);
          slotRef.current = result.activeSlot;
          liveRef.current = result.liveParams;
          setLive(result.liveParams);
          checkpointArmedRef.current = true;
          return result.verified;
        });
        setStatus(slotRef.current);
        return verified;
      } catch (err) {
        setError(messageOf(err));
        setErrorCode(errorCodeOf(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [enqueue, patchConnection, pushCheckpoint, requireSafety, requireSession],
  );

  const refreshBank = useCallback(async () => {
    setBusy(true);
    try {
      await enqueue(async () => {
        const current = requireSession();
        const bank = await current.session.readPresetBank({ timeoutMs: 2_000 });
        patchConnection(bank);
      });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }, [enqueue, patchConnection, requireSession]);

  const matchVolumes = useCallback(
    async (source: MatchVolumesSource): Promise<boolean> => {
      await safetyLoadRef.current;
      requireSafety();
      setBusy(true);
      try {
        const verified = await enqueue(async () => {
          pushCheckpoint("match-vol");
          const current = requireSession();
          const result = await restoreMatchVolumes(
            current.session,
            source,
            slotRef.current,
            source === "live" ? (liveRef.current?.volume ?? undefined) : undefined,
          );
          patchConnection(result.bank, { live: result.liveParams, slot: result.activeSlot });
          liveRef.current = result.liveParams;
          setLive(result.liveParams);
          checkpointArmedRef.current = true;
          return result.verified;
        });
        setStatus("vol");
        return verified;
      } catch (err) {
        setError(messageOf(err));
        setErrorCode(errorCodeOf(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [enqueue, patchConnection, pushCheckpoint, requireSafety, requireSession],
  );

  const loadIrWav = useCallback(
    async (
      wav: Uint8Array,
      cabinet: number,
      options: { confirmFactoryIrOverwrite: boolean; distance: number; fileName?: string },
    ): Promise<boolean> => {
      await safetyLoadRef.current;
      requireSafety();
      setBusy(true);
      try {
        const result = await enqueue(async () => {
          pushCheckpoint("ir");
          const current = requireSession();
          return restoreLoadIr(current.session, wav, cabinet, {
            confirmFactoryIrOverwrite: options.confirmFactoryIrOverwrite,
            distance: options.distance,
          });
        });
        setLive((prev) => {
          if (!prev) return prev;
          const next = { ...prev, cabinet: result.cabinet };
          liveRef.current = next;
          return next;
        });
        checkpointArmedRef.current = true;
        setStatus(options.fileName ?? `Cab ${result.cabinet}`);
        return result.persistVerified;
      } catch (err) {
        setError(messageOf(err));
        setErrorCode(errorCodeOf(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [enqueue, pushCheckpoint, requireSafety, requireSession],
  );

  const setIrCabinet = useCallback((cabinet: number) => {
    if (!Number.isInteger(cabinet) || cabinet < 1 || cabinet > 8) return;
    setIrCabinetState(cabinet);
  }, []);

  const setIrDistance = useCallback((distance: number) => {
    if (!Number.isFinite(distance)) return;
    setIrDistanceState(Math.min(1, Math.max(0, distance)));
  }, []);

  const resetSafety = useCallback(async () => {
    await clearSafetyAcceptance();
    safetyAcceptedRef.current = false;
    setSafetyAccepted(false);
  }, []);

  const savePreset = useCallback(
    async (input: {
      readonly name: string;
      readonly notes?: string;
      readonly profile?: LibraryProfile;
      readonly tags?: readonly string[];
      readonly id?: string;
    }) => {
      const snapshot = live;
      if (snapshot === null) return;
      const stamp = nowIso();
      if (input.id) {
        await persist({
          ...library,
          presets: library.presets.map((item) =>
            item.id === input.id
              ? {
                  ...item,
                  name: input.name.trim() || item.name,
                  notes: input.notes ?? item.notes,
                  profile: input.profile ?? item.profile,
                  tags: input.tags ?? item.tags,
                  params: snapshot,
                  updatedAt: stamp,
                }
              : item,
          ),
        });
        return;
      }
      const item: PresetLibraryItem = {
        id: newId(),
        kind: "preset",
        name: input.name.trim() || "Live",
        notes: (input.notes ?? "").trim(),
        tags: input.tags ?? [],
        profile: input.profile ?? "ensayo",
        params: snapshot,
        createdAt: stamp,
        updatedAt: stamp,
      };
      await persist({ ...library, presets: [item, ...library.presets] });
    },
    [library, live, persist],
  );

  const toggleFavorite = useCallback(
    async (id: string) => {
      await persist({
        ...library,
        presets: library.presets.map((item) =>
          item.id === id ? { ...item, tags: toggleFavoriteTag(item.tags), updatedAt: nowIso() } : item,
        ),
      });
    },
    [library, persist],
  );

  const importIr = useCallback(
    async (uri: string, name: string) => {
      const stamp = nowIso();
      const item: IrLibraryItem = {
        id: newId(),
        kind: "ir",
        name: name.replace(/\.wav$/i, "").trim() || "IR",
        notes: "",
        tags: [],
        profile: "otro",
        createdAt: stamp,
        updatedAt: stamp,
        uri,
      };
      await persist({ ...library, irs: [item, ...library.irs] });
    },
    [library, persist],
  );

  const deleteIr = useCallback(
    async (id: string) => {
      await persist({
        ...library,
        irs: library.irs.filter((item) => item.id !== id),
        songs: library.songs.map((song) => {
          if (song.irId !== id) return song;
          const { irId: _ir, irCabinet: _c, irDistance: _d, ...rest } = song;
          return { ...rest, updatedAt: nowIso() };
        }),
      });
    },
    [library, persist],
  );

  const loadLibraryIr = useCallback(
    async (id: string) => {
      const ir = library.irs.find((item) => item.id === id);
      if (!ir) return false;
      const wav = await readUriBytes(ir.uri);
      return loadIrWav(wav, irCabinet, {
        confirmFactoryIrOverwrite: irCabinet !== 8,
        distance: irDistance,
        fileName: ir.name,
      });
    },
    [irCabinet, irDistance, library.irs, loadIrWav],
  );

  const resolveSong = useCallback(
    (songId: string): { song: SongLibraryItem; params: LiveParamsSnapshot } => {
      const song = library.songs.find((item) => item.id === songId);
      if (song === undefined) throw new Error("Canción no encontrada");
      const tone = library.presets.find((item) => item.id === song.presetId);
      if (tone === undefined) throw new Error(`TONE_MISSING:${song.name}`);
      const note = isDelayNoteId(song.delayNote) ? song.delayNote : undefined;
      return { song, params: applyGrooveTime(tone.params, song.bpm, note) };
    },
    [library],
  );

  const armBank = useCallback(
    async (slots: { readonly A: string | null; readonly B: string | null; readonly C: string | null }) => {
      await safetyLoadRef.current;
      requireSafety();
      setBusy(true);
      try {
        await enqueue(async () => {
          pushCheckpoint("arm-bank");
          const current = requireSession();
          for (const slot of ["A", "B", "C"] as const) {
            const songId = slots[slot];
            if (!songId) continue;
            const { params } = resolveSong(songId);
            const result = await restoreSaveSlot(current.session, slot, params);
            patchConnection(result.bank, { slot });
          }
          const liveSongId = slots[slotRef.current] ?? slots.A ?? slots.B ?? slots.C;
          if (liveSongId) {
            const { params } = resolveSong(liveSongId);
            await applySnapshot(params);
          }
          checkpointArmedRef.current = true;
        });
        setStatus("A/B/C");
        return true;
      } catch (err) {
        setError(messageOf(err));
        setErrorCode(errorCodeOf(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot, enqueue, patchConnection, pushCheckpoint, requireSafety, requireSession, resolveSong],
  );

  const applyTone = useCallback(
    async (toneId: string) => {
      const tone = library.presets.find((item) => item.id === toneId);
      if (tone === undefined) return;
      setBusy(true);
      try {
        await enqueue(async () => {
          pushCheckpoint(`tone:${tone.name}`);
          await applySnapshot(tone.params);
          checkpointArmedRef.current = true;
        });
        setStatus(tone.name);
      } catch (err) {
        setError(messageOf(err));
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot, enqueue, library.presets, pushCheckpoint],
  );

  const applySong = useCallback(
    async (songId: string) => {
      setBusy(true);
      try {
        await enqueue(async () => {
          const { song, params } = resolveSong(songId);
          pushCheckpoint(`song:${song.name}`);
          await applySnapshot(params);
          if (song.bpm !== undefined) {
            setBpmState(clampBpm(song.bpm));
            bpmRef.current = clampBpm(song.bpm);
            if (isDelayNoteId(song.delayNote)) {
              setDelayNoteState(song.delayNote);
              delayNoteRef.current = song.delayNote;
            }
          }
          checkpointArmedRef.current = true;
          setStatus(song.name);
        });
      } catch (err) {
        setError(messageOf(err));
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot, enqueue, pushCheckpoint, resolveSong],
  );

  const assignSongToSlot = useCallback(
    async (songId: string, nextSlot: PresetSlotId) => {
      setBusy(true);
      try {
        await enqueue(async () => {
          const { song, params } = resolveSong(songId);
          pushCheckpoint(`song:${song.name}→${nextSlot}`);
          await applySnapshot(params, nextSlot);
          if (song.bpm !== undefined) {
            setBpmState(clampBpm(song.bpm));
            bpmRef.current = clampBpm(song.bpm);
            if (isDelayNoteId(song.delayNote)) {
              setDelayNoteState(song.delayNote);
              delayNoteRef.current = song.delayNote;
            }
          }
          checkpointArmedRef.current = true;
          setStatus(`${song.name} → ${nextSlot}`);
        });
      } catch (err) {
        setError(messageOf(err));
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot, enqueue, pushCheckpoint, resolveSong],
  );

  const saveSong = useCallback(
    async (input: {
      readonly name: string;
      readonly presetId: string;
      readonly notes?: string;
      readonly bpm?: number;
      readonly delayNote?: DelayNoteId;
      readonly irId?: string;
      readonly irCabinet?: number;
      readonly irDistance?: number;
      readonly id?: string;
    }) => {
      const stamp = nowIso();
      if (input.id) {
        await persist({
          ...library,
          songs: library.songs.map((item) => {
            if (item.id !== input.id) return item;
            const next: SongLibraryItem = {
              id: item.id,
              kind: "song",
              name: input.name.trim() || item.name,
              notes: input.notes ?? item.notes,
              tags: item.tags,
              presetId: input.presetId,
              ...(input.bpm !== undefined ? { bpm: clampBpm(input.bpm) } : item.bpm !== undefined ? { bpm: item.bpm } : {}),
              delayNote: input.delayNote ?? item.delayNote,
              ...(input.irId
                ? {
                    irId: input.irId,
                    irCabinet: input.irCabinet ?? irCabinet,
                    irDistance: input.irDistance ?? irDistance,
                  }
                : {}),
              ...(item.key ? { key: item.key } : {}),
              createdAt: item.createdAt,
              updatedAt: stamp,
            };
            return next;
          }),
        });
        return;
      }
      const item: SongLibraryItem = {
        id: newId(),
        kind: "song",
        name: input.name.trim() || "Canción",
        notes: (input.notes ?? "").trim(),
        tags: [],
        presetId: input.presetId,
        ...(input.bpm !== undefined ? { bpm: clampBpm(input.bpm) } : {}),
        ...(input.delayNote ? { delayNote: input.delayNote } : {}),
        ...(input.irId
          ? {
              irId: input.irId,
              irCabinet: input.irCabinet ?? irCabinet,
              irDistance: input.irDistance ?? irDistance,
            }
          : {}),
        createdAt: stamp,
        updatedAt: stamp,
      };
      await persist({ ...library, songs: [item, ...library.songs] });
    },
    [irCabinet, irDistance, library, persist],
  );

  const importShare = useCallback(
    async (payload: SharePayload): Promise<ShareImportResult> => {
      const result = shareImportResult(payload);
      await persist(mergeShare(library, payload));
      setStatus(payload.name);
      return result;
    },
    [library, persist],
  );

  const importPack = useCallback(
    async (pack: ParsedPack): Promise<PackImportResult> => {
      const stamp = nowIso();
      const presets: PresetLibraryItem[] = pack.presets.map((preset) => ({
        id: newId(),
        kind: "preset",
        name: preset.name,
        notes: preset.notes,
        tags: [...preset.tags],
        profile: preset.profile,
        params: preset.params,
        createdAt: stamp,
        updatedAt: stamp,
      }));
      const irs: IrLibraryItem[] = [];
      for (const ir of pack.irs) {
        const uri = await writeLibraryWav(`${ir.name}.wav`, ir.wav);
        irs.push({
          id: newId(),
          kind: "ir",
          name: ir.name,
          notes: ir.notes,
          tags: [...ir.tags],
          profile: ir.profile,
          createdAt: stamp,
          updatedAt: stamp,
          uri,
        });
      }
      await persist({
        ...library,
        presets: [...presets, ...library.presets],
        irs: [...irs, ...library.irs],
      });
      setStatus(pack.name);
      return {
        name: pack.name,
        presets: presets.length,
        irs: irs.length,
        bankIncluded: pack.bankIncluded,
      };
    },
    [library, persist],
  );

  const saveShow = useCallback(
    async (name: string) => {
      const stamp = nowIso();
      const item: ShowLibraryItem = {
        id: newId(),
        kind: "show",
        name: name.trim() || `Show ${library.shows.length + 1}`,
        notes: "",
        songIds: [],
        createdAt: stamp,
        updatedAt: stamp,
      };
      await persist({ ...library, shows: [item, ...library.shows] });
      setActiveShowId(item.id);
      setSongIndexState(0);
      return item.id;
    },
    [library, persist],
  );

  const renameShow = useCallback(
    async (showId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      await persist({
        ...library,
        shows: library.shows.map((show) =>
          show.id === showId ? { ...show, name: trimmed, updatedAt: nowIso() } : show,
        ),
      });
    },
    [library, persist],
  );

  const addSongToShow = useCallback(
    async (showId: string, songId: string) => {
      const shows = library.shows.map((show) =>
        show.id === showId && !show.songIds.includes(songId)
          ? { ...show, songIds: [...show.songIds, songId], updatedAt: nowIso() }
          : show,
      );
      await persist({ ...library, shows });
    },
    [library, persist],
  );

  const removeSongFromShow = useCallback(
    async (showId: string, songId: string) => {
      const shows = library.shows.map((show) =>
        show.id === showId
          ? { ...show, songIds: show.songIds.filter((id) => id !== songId), updatedAt: nowIso() }
          : show,
      );
      await persist({ ...library, shows });
    },
    [library, persist],
  );

  const moveSongInShow = useCallback(
    async (showId: string, songId: string, direction: -1 | 1) => {
      const shows = library.shows.map((show) => {
        if (show.id !== showId) return show;
        const ids = [...show.songIds];
        const from = ids.indexOf(songId);
        const to = from + direction;
        if (from < 0 || to < 0 || to >= ids.length) return show;
        ids.splice(from, 1);
        ids.splice(to, 0, songId);
        return { ...show, songIds: ids, updatedAt: nowIso() };
      });
      await persist({ ...library, shows });
    },
    [library, persist],
  );

  const deletePreset = useCallback(
    async (id: string) => {
      await persist({
        ...library,
        presets: library.presets.filter((item) => item.id !== id),
      });
    },
    [library, persist],
  );

  const deleteSong = useCallback(
    async (id: string) => {
      await persist({
        ...library,
        songs: library.songs.filter((item) => item.id !== id),
        shows: library.shows.map((show) => ({
          ...show,
          songIds: show.songIds.filter((songId) => songId !== id),
        })),
      });
    },
    [library, persist],
  );

  const deleteShow = useCallback(
    async (id: string) => {
      await persist({ ...library, shows: library.shows.filter((item) => item.id !== id) });
      if (activeShowId === id) {
        setActiveShowId(library.shows.find((item) => item.id !== id)?.id ?? null);
        setSongIndexState(0);
      }
    },
    [activeShowId, library, persist],
  );

  const setActiveShow = useCallback((showId: string | null, index = 0) => {
    setActiveShowId(showId);
    setSongIndexState(Math.max(0, index));
  }, []);

  const setSongIndex = useCallback((index: number) => {
    setSongIndexState(Math.max(0, index));
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      connection,
      shellOpen,
      connecting,
      busy,
      error,
      errorCode,
      usbAvailable,
      slot,
      live,
      bpm,
      delayNote,
      tapTimes,
      tempoSynced,
      library,
      activeShowId,
      songIndex,
      reduceMotion,
      status,
      safetyAccepted,
      safetyReady,
      libraryReady,
      undoCount,
      redoCount,
      irCabinet,
      irDistance,
      sync,
      syncBusy,
      syncError,
      syncNotice,
      syncPrepare,
      connect,
      openLibrary,
      disconnect,
      clearError,
      acceptSafety,
      requireSafety,
      selectSlot,
      setLiveField,
      tapTempo,
      setDelayNote,
      setBpm,
      undoLive,
      redoLive,
      saveSlot,
      copySlot,
      exportBank,
      importBank,
      refreshBank,
      matchVolumes,
      loadIrWav,
      setIrCabinet,
      setIrDistance,
      resetSafety,
      savePreset,
      toggleFavorite,
      importIr,
      deleteIr,
      loadLibraryIr,
      armBank,
      applyTone,
      applySong,
      assignSongToSlot,
      saveSong,
      importShare,
      importPack,
      saveShow,
      renameShow,
      addSongToShow,
      removeSongFromShow,
      moveSongInShow,
      deletePreset,
      deleteSong,
      deleteShow,
      setActiveShow,
      setSongIndex,
      syncSignIn,
      syncComplete,
      syncSignOut,
      syncNow,
      confirmSyncPolicy,
      cancelSyncPrepare,
      clearSyncError,
    }),
    [
      acceptSafety,
      activeShowId,
      addSongToShow,
      applySong,
      applyTone,
      armBank,
      assignSongToSlot,
      bpm,
      busy,
      clearError,
      connect,
      connecting,
      connection,
      copySlot,
      delayNote,
      deleteShow,
      deleteSong,
      deletePreset,
      deleteIr,
      disconnect,
      error,
      errorCode,
      exportBank,
      importBank,
      importIr,
      importPack,
      importShare,
      irCabinet,
      irDistance,
      library,
      live,
      loadIrWav,
      loadLibraryIr,
      matchVolumes,
      moveSongInShow,
      openLibrary,
      redoCount,
      redoLive,
      reduceMotion,
      refreshBank,
      removeSongFromShow,
      requireSafety,
      resetSafety,
      safetyAccepted,
      safetyReady,
      libraryReady,
      savePreset,
      saveShow,
      renameShow,
      saveSlot,
      saveSong,
      selectSlot,
      setActiveShow,
      setBpm,
      setDelayNote,
      setIrCabinet,
      setIrDistance,
      setLiveField,
      setSongIndex,
      shellOpen,
      slot,
      songIndex,
      status,
      tapTempo,
      tapTimes,
      tempoSynced,
      toggleFavorite,
      undoCount,
      undoLive,
      usbAvailable,
      sync,
      syncBusy,
      syncError,
      syncNotice,
      syncPrepare,
      syncSignIn,
      syncComplete,
      syncSignOut,
      syncNow,
      confirmSyncPolicy,
      cancelSyncPrepare,
      clearSyncError,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (ctx === null) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export type { CopySlotSource };
