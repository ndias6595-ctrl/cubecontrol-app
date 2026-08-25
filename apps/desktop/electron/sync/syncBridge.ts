import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  SyncEngine,
  classifyFirstSync,
  emptySyncState,
  findPresetTwins,
  pullCloudReplaceLocal,
  uploadLocalReplaceCloud,
  type FirstSyncPolicy,
  type PresetRecord,
  type PresetTwin,
  type SyncResult,
  type SyncState,
  type TwinKeep,
} from "@tonehub/library-sync";
import { SupabaseRemote } from "@tonehub/library-sync/supabase";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DesktopLibraryRepository } from "../library/syncRepository";
import type { LibraryStore } from "../library/libraryStore";
import { supabaseConfig } from "./config";
import type { SyncNowInput, SyncPrepareResult, SyncStatus } from "./types";

export type { SyncNowInput, SyncPrepareResult, SyncStatus } from "./types";

/**
 * Minimal `SupportedStorage` adapter so the Supabase auth session survives
 * app restarts (the Electron main process has no localStorage).
 */
class FileAuthStorage {
  readonly #file: string;

  constructor(file: string) {
    this.#file = file;
  }

  async getItem(key: string): Promise<string | null> {
    try {
      const raw = JSON.parse(await readFile(this.#file, "utf8")) as Record<string, string>;
      return raw[key] ?? null;
    } catch {
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    await mkdir(path.dirname(this.#file), { recursive: true });
    let raw: Record<string, string> = {};
    try {
      raw = JSON.parse(await readFile(this.#file, "utf8")) as Record<string, string>;
    } catch {
      // first write
    }
    raw[key] = value;
    await writeFile(this.#file, JSON.stringify(raw), "utf8");
  }

  async removeItem(key: string): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.#file, "utf8")) as Record<string, string>;
      delete raw[key];
      await writeFile(this.#file, JSON.stringify(raw), "utf8");
    } catch {
      // nothing to remove
    }
  }
}

/**
 * Main-process sync service: wires the offline-first engine to Supabase and
 * owns auth + durable sync state. Exposed to the renderer over IPC.
 */
export class SyncBridge {
  readonly #syncDir: string;
  readonly #sessionFile: string;
  readonly #stateFile: string;
  readonly #store: LibraryStore;
  #client: SupabaseClient | undefined;
  #engine: SyncEngine | undefined;
  #lastSyncAt: string | null = null;

  constructor(userDataPath: string, store: LibraryStore) {
    this.#syncDir = path.join(userDataPath, "CubeControl", "sync");
    this.#sessionFile = path.join(this.#syncDir, "session.json");
    this.#stateFile = path.join(this.#syncDir, "syncState.json");
    this.#store = store;
  }

  async status(): Promise<SyncStatus> {
    const client = await this.#ensureClient();
    if (client === null) {
      return { configured: false, signedIn: false, email: null, lastSyncAt: null };
    }
    const { data } = await client.auth.getSession();
    return {
      configured: true,
      signedIn: data.session !== null,
      email: data.session?.user?.email ?? null,
      lastSyncAt: this.#lastSyncAt,
    };
  }

  async signInWithOtp(email: string): Promise<void> {
    const client = await this.#requireClient();
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: "cubecontrol://auth/callback" },
    });
    if (error) throw error;
  }

  /**
   * Complete a magic-link sign-in from the `cubecontrol://` deep link. The
   * URL hash carries the session tokens; we hand them to Supabase and wire
   * the sync engine once the session is valid.
   */
  async completeSignIn(url: string): Promise<void> {
    const client = await this.#requireClient();
    const hash = new URL(url).hash.replace(/^#/, "");
    const query = new URLSearchParams(hash);
    const accessToken = query.get("access_token");
    const refreshToken = query.get("refresh_token");
    if (accessToken === null || refreshToken === null) {
      throw new Error("Enlace de acceso inválido");
    }
    const { error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    await this.#ensureEngine(client);
  }

  async verifyOtp(email: string, token: string): Promise<void> {
    const client = await this.#requireClient();
    const { error } = await client.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: "email",
    });
    if (error) throw error;
    await this.#ensureEngine(client);
  }

  async signOut(): Promise<void> {
    const client = await this.#ensureClient();
    if (client !== null) await client.auth.signOut();
    this.#engine = undefined;
    this.#lastSyncAt = null;
  }

  async syncNow(input: SyncNowInput = {}): Promise<SyncResult> {
    return this.#sync(input);
  }

  /**
   * Peek local vs cloud without writing. Used to show the first-sync
   * conflict UI instead of mixing two libraries blindly.
   */
  async prepareSync(): Promise<SyncPrepareResult> {
    const client = await this.#requireClient();
    const { data } = await client.auth.getSession();
    if (data.session === null) throw new Error("No hay sesión iniciada");
    const state = await this.#loadState();
    const repository = new DesktopLibraryRepository(this.#store);
    const snapshot = await repository.snapshot();
    const remote = new SupabaseRemote(client);
    const pulled = await remote.pull(state.cursor);
    const remoteAlive = pulled.changes.filter((change) => !change.deleted);
    const kind = classifyFirstSync({
      cursor: state.cursor,
      localCount: snapshot.length,
      remoteAliveCount: remoteAlive.length,
    });
    const localPresets = snapshot.filter((record): record is PresetRecord => record.kind === "preset");
    const remotePresets = remoteAlive
      .map((change) => (change.deleted ? null : change.record))
      .filter((record): record is PresetRecord => record !== null && record.kind === "preset");
    const twins = kind === "conflict" ? findPresetTwins(localPresets, remotePresets) : [];
    return {
      kind,
      localCount: snapshot.length,
      remoteCount: remoteAlive.length,
      twins,
    };
  }

  /**
   * Background sync used after local library mutations. Silently skips when
   * not configured / not signed in / first-sync needs a decision, and never throws.
   */
  async autoSync(): Promise<SyncResult | null> {
    try {
      const client = await this.#ensureClient();
      if (client === null) return null;
      const { data } = await client.auth.getSession();
      if (data.session === null) return null;
      const prepared = await this.prepareSync();
      if (prepared.kind === "conflict") return null;
      return await this.#sync({ policy: "normal" });
    } catch (error) {
      console.warn("auto-sync failed", error);
      return null;
    }
  }

  async #sync(input: SyncNowInput): Promise<SyncResult> {
    const client = await this.#requireClient();
    const { data } = await client.auth.getSession();
    if (data.session === null) throw new Error("No hay sesión iniciada");
    const repository = new DesktopLibraryRepository(this.#store);
    const remote = new SupabaseRemote(client);
    const policy: FirstSyncPolicy = input.policy ?? "normal";

    if (input.mergeTwins === true && (input.twins?.length ?? 0) > 0) {
      const keep: TwinKeep =
        input.twinKeep ?? (policy === "use-cloud" ? "remote" : "local");
      await repository.mergeTwins(input.twins ?? [], keep);
    }

    if (policy === "use-cloud") {
      const guided = await pullCloudReplaceLocal(repository, remote);
      this.#engine = undefined;
      this.#lastSyncAt = new Date().toISOString();
      await this.#saveState(guided.state);
      return guided.result;
    }
    if (policy === "upload-local") {
      const guided = await uploadLocalReplaceCloud(repository, remote, new Date().toISOString());
      this.#engine = undefined;
      this.#lastSyncAt = new Date().toISOString();
      await this.#saveState(guided.state);
      return guided.result;
    }

    const engine = await this.#ensureEngine(client);
    const result = await engine.sync();
    this.#lastSyncAt = new Date().toISOString();
    await this.#saveState(engine.state);
    return result;
  }

  async #ensureClient(): Promise<SupabaseClient | null> {
    if (this.#client !== undefined) return this.#client;
    const cfg = supabaseConfig();
    if (cfg === null) return null;
    this.#client = createClient(cfg.url, cfg.anonKey, {
      auth: {
        storage: new FileAuthStorage(this.#sessionFile),
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    return this.#client;
  }

  async #requireClient(): Promise<SupabaseClient> {
    const client = await this.#ensureClient();
    if (client === null) {
      throw new Error(
        "Sync no configurado: crea apps/desktop/.env con SUPABASE_URL y SUPABASE_ANON_KEY.",
      );
    }
    return client;
  }

  async #ensureEngine(client: SupabaseClient): Promise<SyncEngine> {
    if (this.#engine !== undefined) return this.#engine;
    const state = await this.#loadState();
    const repository = new DesktopLibraryRepository(this.#store);
    const remote = new SupabaseRemote(client);
    this.#engine = new SyncEngine(repository, remote, state);
    return this.#engine;
  }

  async #loadState(): Promise<SyncState> {
    try {
      const raw = JSON.parse(await readFile(this.#stateFile, "utf8")) as unknown;
      if (
        typeof raw === "object" &&
        raw !== null &&
        "cursor" in raw &&
        "entries" in raw &&
        typeof (raw as { entries: unknown }).entries === "object"
      ) {
        return raw as SyncState;
      }
    } catch {
      // missing or corrupt → fresh state
    }
    return emptySyncState();
  }

  async #saveState(state: SyncState): Promise<void> {
    await mkdir(this.#syncDir, { recursive: true });
    await writeFile(this.#stateFile, JSON.stringify(state), "utf8");
  }
}
