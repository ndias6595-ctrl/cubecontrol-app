import type { PresetSlotId } from "@tonehub/cube-baby-protocol";
import type { ToneHubDesktopApi, ToneHubLibraryApi } from "../../electron/preload";
import type {
  LibraryIndex,
  PresetLibraryItem,
  ShowLibraryItem,
  SongLibraryItem,
} from "../../electron/library/types";
import type {
  BankSlotSnapshot,
  BankSnapshot,
  DesktopConnectionInfo,
  LiveParamsSnapshot,
} from "../types/device";

/** DEV + `?demo=1` only — marketing screenshots / UI without USB. */
export function isMarketingDemo(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return new URLSearchParams(window.location.search).get("demo") === "1";
  } catch {
    return false;
  }
}

const DEMO_LIVE: LiveParamsSnapshot = {
  type: 3,
  gain: 5,
  tone: 10,
  reverb: 8,
  feedback: 64,
  volume: 100,
  time: 16,
  mix: 72,
  modulation: 8,
  cabinet: 3,
  irSection: 1,
  delaySection: 1,
  toneSection: 1,
};

function slotOf(id: PresetSlotId, override?: Partial<LiveParamsSnapshot>): BankSlotSnapshot {
  return { slot: id, ...DEMO_LIVE, ...override };
}

export function makeDemoConnection(): DesktopConnectionInfo {
  const bank: BankSnapshot = {
    slots: [
      slotOf("A"),
      slotOf("B", { gain: 7, mix: 55, type: 2 }),
      slotOf("C", { reverb: 12, feedback: 40, volume: 90 }),
    ],
  };
  return {
    deviceName: "CUBE Baby · demo",
    inputPortId: "demo:input",
    outputPortId: "demo:output",
    bankSummary: "demo · no USB",
    activeSlot: "A",
    liveParams: { ...DEMO_LIVE },
    bank,
  };
}

function demoLibraryIndex(live: LiveParamsSnapshot): LibraryIndex {
  const now = "2026-08-01T12:00:00.000Z";
  const presets: PresetLibraryItem[] = [
    {
      id: "demo-preset-edge",
      kind: "preset",
      name: "Edge Drive",
      notes: "Marketing demo tone",
      tags: ["demo", "favorite"],
      profile: "directo",
      createdAt: now,
      updatedAt: now,
      params: { ...live, gain: 6, type: 3 },
    },
    {
      id: "demo-preset-ambient",
      kind: "preset",
      name: "Ambient Plate",
      notes: "",
      tags: ["demo"],
      profile: "grabacion",
      createdAt: now,
      updatedAt: now,
      params: { ...live, reverb: 14, mix: 80, type: 1 },
    },
    {
      id: "demo-preset-bass",
      kind: "preset",
      name: "Warm Bass",
      notes: "",
      tags: ["demo"],
      profile: "ensayo",
      createdAt: now,
      updatedAt: now,
      params: { ...live, gain: 4, tone: 6, type: 0 },
    },
  ];
  const songs: SongLibraryItem[] = [
    {
      id: "demo-song-1",
      kind: "song",
      name: "Openers",
      notes: "",
      tags: ["demo"],
      presetId: presets[0]!.id,
      bpm: 118,
      delayNote: "1/8",
      key: "E",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "demo-song-2",
      kind: "song",
      name: "Ballad",
      notes: "",
      tags: ["demo"],
      presetId: presets[1]!.id,
      bpm: 72,
      delayNote: "1/8d",
      key: "Am",
      createdAt: now,
      updatedAt: now,
    },
  ];
  const shows: ShowLibraryItem[] = [
    {
      id: "demo-show-1",
      kind: "show",
      name: "Friday Set",
      notes: "Demo setlist",
      songIds: songs.map((s) => s.id),
      createdAt: now,
      updatedAt: now,
    },
  ];
  return {
    format: "tonehub-library-index-v1",
    presets,
    irs: [
      {
        id: "demo-ir-1",
        kind: "ir",
        name: "Cab 8 · Room",
        notes: "Placeholder IR metadata",
        tags: ["demo"],
        profile: "otro",
        createdAt: now,
        updatedAt: now,
        wavFile: "demo.wav",
        byteLength: 48000,
      },
    ],
    irBackups: [],
    packs: [],
    songs,
    shows,
  };
}

/**
 * Installs a no-op `window.tonehubDesktop` so Studio paints without Electron IPC.
 * Only call when `isMarketingDemo()` is true.
 */
export function installDemoDesktopApi(connection: DesktopConnectionInfo): void {
  let bank = connection.bank;
  let live = connection.liveParams;
  const index = demoLibraryIndex(live);
  const undo: { undoCount: number; redoCount: number } = { undoCount: 0, redoCount: 0 };

  const library: ToneHubLibraryApi = {
    list: async () => index,
    root: async () => "(demo)",
    savePreset: async () => {
      throw new Error("demo: savePreset disabled");
    },
    deletePreset: async () => undefined,
    importIrWav: async () => {
      throw new Error("demo: importIrWav disabled");
    },
    deleteIr: async () => undefined,
    readIrWav: async () => new Uint8Array(),
    loadIrToPedal: async () => ({
      slotIndex: 7,
      cabinet: 8,
      persistVerified: true,
      liveMatch: "demo",
    }),
    restoreIrBackup: async () => ({ verified: true, cabinet: 8, romSlot: 7 }),
    saveSong: async () => {
      throw new Error("demo: saveSong disabled");
    },
    deleteSong: async () => undefined,
    saveShow: async () => {
      throw new Error("demo: saveShow disabled");
    },
    deleteShow: async () => undefined,
    exportShowAsPack: async () => {
      throw new Error("demo: exportShowAsPack disabled");
    },
    createPack: async () => {
      throw new Error("demo: createPack disabled");
    },
    exportPack: async () => null,
    importPack: async () => null,
    exportShare: async () => null,
    inspectShare: async () => null,
    importShare: async () => ({ name: "demo", presets: 0, songs: 0, shows: 0 }),
    importPackPath: async () => {
      throw new Error("demo: importPackPath disabled");
    },
    pushUndo: async () => {
      undo.undoCount += 1;
      return { ...undo };
    },
    undo: async () => ({ ...undo, snapshot: null }),
    redo: async () => ({ ...undo, snapshot: null }),
    undoState: async () => ({ ...undo }),
    compareSlots: async () => [],
  };

  const api: ToneHubDesktopApi = {
    listPorts: async () => [],
    connect: async () => connection,
    disconnect: async () => undefined,
    getBank: async () => bank,
    writeLiveParam: async (param, value) => {
      live = { ...live, [param]: value };
    },
    selectCabinet: async () => undefined,
    applySlotToLive: async (slot) => {
      const stored = bank.slots.find((s) => s.slot === slot);
      if (stored === undefined) throw new Error(`demo: missing slot ${slot}`);
      const { slot: _id, ...params } = stored;
      live = params;
      return params;
    },
    applyLiveParams: async (next) => {
      live = next;
    },
    saveSlot: async (slot, nextLive) => {
      const nextSlots = bank.slots.map((s) =>
        s.slot === slot ? ({ slot, ...nextLive } as BankSlotSnapshot) : s,
      );
      bank = {
        slots: [nextSlots[0]!, nextSlots[1]!, nextSlots[2]!],
      };
      live = nextLive;
      return { slot, verified: true, bank };
    },
    loadIrFromWav: async () => ({
      slotIndex: 7,
      cabinet: 8,
      persistVerified: true,
      liveMatch: "demo",
    }),
    exportBank: async () => null,
    importBank: async () => null,
    matchVolumes: async () => ({
      verified: true,
      source: "live" as const,
      volume: live.volume,
      volumes: { a: bank.slots[0]!.volume, b: bank.slots[1]!.volume, c: bank.slots[2]!.volume },
      activeSlot: "A" as const,
      liveParams: live,
      bank,
    }),
    copySlot: async (_from, to) => ({
      verified: true,
      from: "live" as const,
      to,
      activeSlot: to,
      liveParams: live,
      bank,
    }),
    library,
    sync: {
      status: async () => ({ configured: false, signedIn: false, email: null, lastSyncAt: null }),
      signInWithOtp: async () => undefined,
      verifyOtp: async () => undefined,
      signOut: async () => undefined,
      prepareSync: async () => ({ kind: "proceed" as const, localCount: 0, remoteCount: 0, twins: [] }),
      syncNow: async () => ({ pushed: 0, pulled: 0, appliedUpserts: 0, appliedDeletes: 0 }),
      onSignedIn: () => () => undefined,
      onSynced: () => () => undefined,
    },
    diagnostics: {
      exportBundle: async () => null,
      openExternal: async () => undefined,
      revealInFolder: async () => undefined,
    },
  };

  Object.defineProperty(window, "tonehubDesktop", {
    value: api,
    configurable: true,
    writable: true,
  });
}
