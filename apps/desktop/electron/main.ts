import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LiveParamName, PresetSlotId } from "@tonehub/cube-baby-protocol";
import { DeviceBridge, type LiveParamsSnapshot, type MatchVolumesSource } from "./deviceBridge.js";
import {
  exportDiagnosticsBundle,
  openExternalUrl,
  revealInFolder,
  type DiagnosticsExportInput,
} from "./diagnostics.js";
import { LibraryStore } from "./library/libraryStore.js";
import { parseSharePayload, shareFileName } from "./library/shareFormat.js";
import type { LibraryProfile } from "./library/types.js";
import { SyncBridge } from "./sync/syncBridge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bridge = new DeviceBridge();
let library: LibraryStore;
let syncBridge: SyncBridge | undefined;

const PROTOCOL = "cubecontrol";
let deepLinkOnLaunch: string | null = null;

function deepLinkUrlFrom(argv: readonly string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${PROTOCOL}://`)) ?? null;
}

/** Magic-link callback: completes the Supabase sign-in and notifies the UI. */
function onDeepLink(url: string): void {
  if (!url.startsWith(`${PROTOCOL}://`)) return;
  if (syncBridge === undefined) {
    deepLinkOnLaunch = url;
    return;
  }
  void (async () => {
    try {
      await syncBridge.completeSignIn(url);
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("sync:signedIn");
      }
    } catch (error) {
      console.error("sync deep link failed", error);
    }
  })();
}

// Register the custom protocol so magic-link emails open CubeControl directly.
if (process.defaultApp && process.argv.length >= 2) {
  const entry = process.argv[1];
  app.setAsDefaultProtocolClient(
    PROTOCOL,
    process.execPath,
    entry === undefined ? [] : [path.resolve(entry)],
  );
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const url = deepLinkUrlFrom(argv);
    if (url !== null) onDeepLink(url);
    const win = BrowserWindow.getAllWindows()[0];
    if (win !== undefined) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  onDeepLink(url);
});

function resolveAppIcon(): string | undefined {
  const candidates = [
    path.join(__dirname, "../build/icon.ico"),
    path.join(process.resourcesPath, "build/icon.ico"),
    path.join(process.resourcesPath, "icon.ico"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function createWindow(): BrowserWindow {
  const icon = resolveAppIcon();
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#121416",
    title: "CubeControl",
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  return win;
}

function stamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

app.whenReady().then(async () => {
  library = new LibraryStore(app.getPath("userData"));
  await library.ensure();
  syncBridge = new SyncBridge(app.getPath("userData"), library);
  const sync = syncBridge;

  // Complete a sign-in that arrived while the app was closed (protocol launch).
  const startupUrl = deepLinkUrlFrom(process.argv) ?? deepLinkOnLaunch;
  if (startupUrl !== null) {
    deepLinkOnLaunch = null;
    onDeepLink(startupUrl);
  }

  // Debounced background sync after local library mutations.
  let autoSyncTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleAutoSync(): void {
    if (autoSyncTimer !== undefined) clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(() => {
      autoSyncTimer = undefined;
      void (async () => {
        const result = await sync.autoSync();
        if (result !== null) {
          for (const win of BrowserWindow.getAllWindows()) win.webContents.send("sync:synced");
        }
      })();
    }, 2500);
  }

  // Mic / audio input for the software tuner (renderer getUserMedia).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "mediaKeySystem");
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === "media" || permission === "mediaKeySystem";
  });

  ipcMain.handle("tonehub:listPorts", async () => bridge.listPorts());
  ipcMain.handle("tonehub:connect", async () => bridge.connect());
  ipcMain.handle("tonehub:disconnect", async () => {
    await bridge.disconnect();
  });
  ipcMain.handle("tonehub:getBank", async () => bridge.getBank());
  ipcMain.handle("tonehub:writeLiveParam", async (_event, param: LiveParamName, value: number) => {
    await bridge.writeLiveParam(param, value);
  });
  ipcMain.handle("tonehub:selectCabinet", async (_event, cabinet: number) => {
    await bridge.selectCabinet(cabinet);
  });
  ipcMain.handle("tonehub:applySlotToLive", async (_event, slot: PresetSlotId) => {
    return bridge.applySlotToLive(slot);
  });
  ipcMain.handle("tonehub:applyLiveParams", async (_event, live: LiveParamsSnapshot) => {
    await bridge.applyLiveParams(live);
  });
  ipcMain.handle(
    "tonehub:saveSlot",
    async (_event, slot: PresetSlotId, live: LiveParamsSnapshot) => {
      return bridge.saveSlot(slot, live);
    },
  );
  ipcMain.handle(
    "tonehub:loadIrFromWav",
    async (
      _event,
      wav: Uint8Array,
      cabinet: number,
      options?: { confirmFactoryIrOverwrite?: boolean; distance?: number },
    ) => {
      const bytes = wav instanceof Uint8Array ? wav : Uint8Array.from(wav);
      const romSlot = cabinet - 1;
      try {
        const sector = await bridge.dumpIrRomSlot(romSlot);
        await library.saveIrBackup({
          cabinet,
          romSlot,
          sector,
          sourceName: "pre-load-ir",
        });
      } catch (error) {
        console.warn("safe IR backup failed", error);
      }
      return bridge.loadIrFromWav(bytes, cabinet, {
        confirmFactoryIrOverwrite: options?.confirmFactoryIrOverwrite === true,
        ...(options?.distance === undefined ? {} : { distance: options.distance }),
      });
    },
  );

  ipcMain.handle("tonehub:exportBank", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const document = await bridge.readBankFileDocument();
    const options = {
      title: "Exportar bank CubeControl",
      defaultPath: `cubecontrol-bank-${stamp()}.json`,
      filters: [{ name: "CubeControl Bank", extensions: ["json"] }],
    };
    const choice =
      win === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(win, options);
    if (choice.canceled || choice.filePath === undefined) return null;
    await writeFile(choice.filePath, document.json, "utf8");
    return { path: choice.filePath, dataHex: document.dataHex };
  });

  ipcMain.handle(
    "tonehub:matchVolumes",
    async (_event, source: MatchVolumesSource, liveSlot: PresetSlotId, liveVolume?: number) => {
      return bridge.matchVolumes(source, liveSlot, liveVolume);
    },
  );

  ipcMain.handle(
    "tonehub:copySlot",
    async (
      _event,
      from: PresetSlotId | "live",
      to: PresetSlotId,
      options?: { live?: LiveParamsSnapshot; liveSlot?: PresetSlotId },
    ) => {
      return bridge.copySlot(from, to, options);
    },
  );

  ipcMain.handle("tonehub:importBank", async (event, liveSlot: PresetSlotId) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Restaurar bank CubeControl",
      properties: ["openFile" as const],
      filters: [{ name: "CubeControl Bank", extensions: ["json"] }],
    };
    const choice =
      win === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(win, options);
    if (choice.canceled || choice.filePaths[0] === undefined) return null;
    const filePath = choice.filePaths[0];
    const jsonText = await readFile(filePath, "utf8");
    const restored = await bridge.restoreBankFromJson(jsonText, liveSlot);
    return { path: filePath, ...restored };
  });

  // —— Library ——
  ipcMain.handle("library:list", async () => library.list());
  ipcMain.handle("library:root", async () => library.root);
  ipcMain.handle(
    "library:savePreset",
    async (
      _event,
      input: {
        name: string;
        notes?: string;
        tags?: string[];
        profile?: LibraryProfile;
        params: LiveParamsSnapshot;
        id?: string;
      },
    ) => {
      const saved = await library.savePreset(input);
      scheduleAutoSync();
      return saved;
    },
  );
  ipcMain.handle("library:deletePreset", async (_event, id: string) => {
    await library.deletePreset(id);
    scheduleAutoSync();
  });
  ipcMain.handle(
    "library:importIrWav",
    async (
      _event,
      input: {
        name: string;
        notes?: string;
        tags?: string[];
        profile?: LibraryProfile;
        wav: Uint8Array;
      },
    ) => {
      const wav = input.wav instanceof Uint8Array ? input.wav : Uint8Array.from(input.wav);
      const saved = await library.importIrWav({ ...input, wav });
      scheduleAutoSync();
      return saved;
    },
  );
  ipcMain.handle("library:deleteIr", async (_event, id: string) => {
    await library.deleteIr(id);
    scheduleAutoSync();
  });
  ipcMain.handle("library:readIrWav", async (_event, id: string) => library.readIrWav(id));
  ipcMain.handle(
    "library:loadIrToPedal",
    async (
      _event,
      irId: string,
      cabinet: number,
      options?: { confirmFactoryIrOverwrite?: boolean; distance?: number },
    ) => {
      const wav = await library.readIrWav(irId);
      const romSlot = cabinet - 1;
      try {
        const sector = await bridge.dumpIrRomSlot(romSlot);
        await library.saveIrBackup({
          cabinet,
          romSlot,
          sector,
          sourceName: `lib:${irId}`,
        });
      } catch (error) {
        console.warn("safe IR backup failed", error);
      }
      return bridge.loadIrFromWav(wav, cabinet, {
        confirmFactoryIrOverwrite: options?.confirmFactoryIrOverwrite === true,
        ...(options?.distance === undefined ? {} : { distance: options.distance }),
      });
    },
  );
  ipcMain.handle("library:restoreIrBackup", async (_event, backupId: string) => {
    const index = await library.list();
    const item = index.irBackups.find((b) => b.id === backupId);
    if (item === undefined) throw new Error("backup no encontrado");
    const sector = await library.readIrBackup(backupId);
    const verified = await bridge.persistIrRomSector(item.romSlot, sector);
    await bridge.selectCabinet(item.cabinet);
    return { verified, cabinet: item.cabinet, romSlot: item.romSlot };
  });
  ipcMain.handle("library:saveSong", async (_event, input) => {
    const saved = await library.saveSong(input);
    scheduleAutoSync();
    return saved;
  });
  ipcMain.handle("library:deleteSong", async (_event, id: string) => {
    await library.deleteSong(id);
    scheduleAutoSync();
  });
  ipcMain.handle("library:saveShow", async (_event, input) => {
    const saved = await library.saveShow(input);
    scheduleAutoSync();
    return saved;
  });
  ipcMain.handle("library:deleteShow", async (_event, id: string) => {
    await library.deleteShow(id);
    scheduleAutoSync();
  });
  ipcMain.handle("library:exportShowAsPack", async (_event, showId: string) => {
    const pack = await library.exportShowAsPack(showId);
    scheduleAutoSync();
    return pack;
  });
  ipcMain.handle(
    "library:createPack",
    async (
      _event,
      input: {
        name: string;
        notes?: string;
        presetIds: string[];
        irIds: string[];
        includeBank: boolean;
      },
    ) => {
      let bankJson: string | undefined;
      if (input.includeBank && bridge.connected) {
        bankJson = (await bridge.readBankFileDocument()).json;
      }
      const pack = await library.createPack({
        name: input.name,
        presetIds: input.presetIds,
        irIds: input.irIds,
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(bankJson === undefined ? {} : { bankJson }),
      });
      scheduleAutoSync();
      return pack;
    },
  );
  ipcMain.handle("library:exportPack", async (event, packId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const index = await library.list();
    const pack = index.packs.find((p) => p.id === packId);
    if (pack === undefined) throw new Error("pack no encontrado");
    const options = {
      title: "Exportar pack CubeControl",
      defaultPath: `${pack.name.replace(/[^\w\-]+/g, "_")}-${stamp()}.zip`,
      filters: [{ name: "CubeControl Pack", extensions: ["zip"] }],
    };
    const choice =
      win === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(win, options);
    if (choice.canceled || choice.filePath === undefined) return null;
    await library.exportPackZip(packId, choice.filePath);
    return { path: choice.filePath };
  });
  ipcMain.handle("library:importPack", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Importar pack CubeControl",
      properties: ["openFile" as const],
      filters: [{ name: "CubeControl Pack", extensions: ["zip"] }],
    };
    const choice =
      win === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(win, options);
    if (choice.canceled || choice.filePaths[0] === undefined) return null;
    const bytes = new Uint8Array(await readFile(choice.filePaths[0]));
    const pack = await library.importPackZip(bytes);
    return { path: choice.filePaths[0], pack };
  });
  ipcMain.handle("library:exportShare", async (event, kind: "preset" | "song" | "show", id: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const payload = await library.buildShare(kind, id);
    const options = {
      title: "Compartir CubeControl",
      defaultPath: shareFileName(payload.name),
      filters: [{ name: "CubeControl", extensions: ["cubecontrol.json", "json"] }],
    };
    const choice =
      win === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(win, options);
    if (choice.canceled || choice.filePath === undefined) return null;
    await writeFile(choice.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return { path: choice.filePath, name: payload.name };
  });
  ipcMain.handle("library:inspectShare", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Abrir archivo CubeControl",
      properties: ["openFile" as const],
      filters: [{ name: "CubeControl", extensions: ["cubecontrol.json", "json", "zip"] }],
    };
    const choice =
      win === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(win, options);
    if (choice.canceled || choice.filePaths[0] === undefined) return null;
    const filePath = choice.filePaths[0];
    const bytes = await readFile(filePath);
    if (filePath.toLowerCase().endsWith(".zip") || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      return { kind: "pack" as const, path: filePath, name: path.basename(filePath, ".zip") };
    }
    const payload = parseSharePayload(bytes.toString("utf8"));
    if (payload === null) throw new Error("Este archivo no es un tono, canción o show de CubeControl.");
    return {
      kind: "share" as const,
      path: filePath,
      name: payload.name,
      presets: payload.presets.length,
      songs: payload.songs.length,
      shows: payload.shows.length,
      payload,
    };
  });
  ipcMain.handle("library:importShare", async (_event, payload: unknown) => {
    const parsed = parseSharePayload(payload);
    if (parsed === null) throw new Error("archivo CubeControl no reconocido");
    const result = await library.importShare(parsed);
    scheduleAutoSync();
    return result;
  });
  ipcMain.handle("library:importPackPath", async (_event, filePath: string) => {
    const bytes = new Uint8Array(await readFile(filePath));
    const pack = await library.importPackZip(bytes);
    scheduleAutoSync();
    return pack;
  });

  ipcMain.handle(
    "library:pushUndo",
    async (
      _event,
      snapshot: { label: string; params: LiveParamsSnapshot; activeSlot: PresetSlotId },
    ) => {
      library.pushUndo(snapshot);
      return library.undoState();
    },
  );
  ipcMain.handle(
    "library:undo",
    async (
      _event,
      current: { params: LiveParamsSnapshot; activeSlot: PresetSlotId; label?: string },
    ) => {
      const prev = library.popUndo(current);
      if (prev === null) return { snapshot: null, ...library.undoState() };
      await bridge.applyLiveParams(prev.params);
      return { snapshot: prev, ...library.undoState() };
    },
  );
  ipcMain.handle(
    "library:redo",
    async (
      _event,
      current: { params: LiveParamsSnapshot; activeSlot: PresetSlotId; label?: string },
    ) => {
      const next = library.popRedo(current);
      if (next === null) return { snapshot: null, ...library.undoState() };
      await bridge.applyLiveParams(next.params);
      return { snapshot: next, ...library.undoState() };
    },
  );
  ipcMain.handle("library:undoState", async () => library.undoState());
  ipcMain.handle("library:compareSlots", async () => {
    const bank = await bridge.getBank();
    return library.compareSlots(bank);
  });

  ipcMain.handle("diagnostics:exportBundle", async (event, input: DiagnosticsExportInput) =>
    exportDiagnosticsBundle(event, input),
  );
  ipcMain.handle("diagnostics:openExternal", async (_event, url: string) => {
    await openExternalUrl(url);
  });
  ipcMain.handle("diagnostics:revealInFolder", async (_event, filePath: string) => {
    revealInFolder(filePath);
  });

  ipcMain.handle("sync:status", async () => sync.status());
  ipcMain.handle("sync:signInWithOtp", async (_event, email: string) => {
    await sync.signInWithOtp(email);
  });
  ipcMain.handle("sync:verifyOtp", async (_event, email: string, token: string) => {
    await sync.verifyOtp(email, token);
  });
  ipcMain.handle("sync:signOut", async () => {
    await sync.signOut();
  });
  ipcMain.handle("sync:prepare", async () => sync.prepareSync());
  ipcMain.handle("sync:syncNow", async (_event, input) => {
    const result = await sync.syncNow(input ?? {});
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send("sync:synced");
    return result;
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  void bridge.dispose().finally(() => {
    if (process.platform !== "darwin") app.quit();
  });
});
