import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SupabaseClient } from "@supabase/supabase-js";
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
import type { MobileLibrary } from "../library/types";
import { createMobileClient } from "./client";
import { MobileLibraryRepository } from "./repository";

export type MobileSyncStatus = {
  readonly configured: boolean;
  readonly signedIn: boolean;
  readonly email: string | null;
  readonly lastSyncAt: string | null;
};

export type SyncPrepareResult = {
  readonly kind: "proceed" | "seed-cloud" | "pull-cloud" | "conflict";
  readonly localCount: number;
  readonly remoteCount: number;
  readonly twins: readonly PresetTwin[];
};

export type SyncNowInput = {
  readonly policy?: FirstSyncPolicy;
  readonly mergeTwins?: boolean;
  readonly twinKeep?: TwinKeep;
  readonly twins?: readonly PresetTwin[];
};

const STATE_KEY = "cubecontrol.sync.state.v1";

/** Hermes-safe hash parser (no `URL`/`URLSearchParams` dependency). */
function parseHash(url: string): Record<string, string> {
  const hash = url.split("#")[1] ?? "";
  const params: Record<string, string> = {};
  for (const part of hash.split("&")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    const value = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " "));
    params[key] = value;
  }
  return params;
}

/**
 * Offline-first sync service for the mobile app. Owns the Supabase client,
 * auth session and the sync engine; talks to the shared `library-sync` core.
 */
export class MobileSyncService {
  readonly #getLibrary: () => MobileLibrary;
  readonly #setLibrary: (library: MobileLibrary) => Promise<void>;
  #client: SupabaseClient | undefined;
  #lastSyncAt: string | null = null;

  constructor(deps: {
    readonly getLibrary: () => MobileLibrary;
    readonly setLibrary: (library: MobileLibrary) => Promise<void>;
  }) {
    this.#getLibrary = deps.getLibrary;
    this.#setLibrary = deps.setLibrary;
  }

  #ensureClient(): SupabaseClient {
    if (this.#client === undefined) this.#client = createMobileClient();
    return this.#client;
  }

  async status(): Promise<MobileSyncStatus> {
    const { data } = await this.#ensureClient().auth.getSession();
    return {
      configured: true,
      signedIn: data.session !== null,
      email: data.session?.user?.email ?? null,
      lastSyncAt: this.#lastSyncAt,
    };
  }

  async signInWithOtp(email: string): Promise<void> {
    const { error } = await this.#ensureClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: "cubecontrol://auth/callback" },
    });
    if (error) throw error;
  }

  async completeSignIn(url: string): Promise<void> {
    const client = this.#ensureClient();
    const params = parseHash(url);
    const accessToken = params.access_token;
    const refreshToken = params.refresh_token;
    if (accessToken === undefined || refreshToken === undefined) {
      throw new Error("Enlace de acceso inválido");
    }
    const { error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    await this.#ensureClient().auth.signOut();
    this.#lastSyncAt = null;
  }

  async prepareSync(): Promise<SyncPrepareResult> {
    const client = this.#ensureClient();
    const { data } = await client.auth.getSession();
    if (data.session === null) throw new Error("No hay sesión iniciada");
    const state = await this.#loadState();
    const repository = new MobileLibraryRepository(this.#getLibrary());
    const snapshot = await repository.snapshot();
    const pulled = await new SupabaseRemote(client).pull(state.cursor);
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
    return {
      kind,
      localCount: snapshot.length,
      remoteCount: remoteAlive.length,
      twins: kind === "conflict" ? findPresetTwins(localPresets, remotePresets) : [],
    };
  }

  async syncNow(input: SyncNowInput = {}): Promise<SyncResult> {
    const client = this.#ensureClient();
    const { data } = await client.auth.getSession();
    if (data.session === null) throw new Error("No hay sesión iniciada");

    const repository = new MobileLibraryRepository(this.#getLibrary());
    const remote = new SupabaseRemote(client);
    const policy: FirstSyncPolicy = input.policy ?? "normal";

    if (input.mergeTwins === true && (input.twins?.length ?? 0) > 0) {
      const keep: TwinKeep = input.twinKeep ?? (policy === "use-cloud" ? "remote" : "local");
      repository.mergeTwins(input.twins ?? [], keep);
    }

    if (policy === "use-cloud") {
      const guided = await pullCloudReplaceLocal(repository, remote);
      await this.#setLibrary(repository.current);
      this.#lastSyncAt = new Date().toISOString();
      await this.#saveState(guided.state);
      return guided.result;
    }
    if (policy === "upload-local") {
      const guided = await uploadLocalReplaceCloud(
        repository,
        remote,
        new Date().toISOString(),
      );
      await this.#setLibrary(repository.current);
      this.#lastSyncAt = new Date().toISOString();
      await this.#saveState(guided.state);
      return guided.result;
    }

    const engine = new SyncEngine(repository, remote, await this.#loadState());
    const result = await engine.sync();
    await this.#setLibrary(repository.current);
    this.#lastSyncAt = new Date().toISOString();
    await this.#saveState(engine.state);
    return result;
  }

  async autoSync(): Promise<SyncResult | null> {
    try {
      const { data } = await this.#ensureClient().auth.getSession();
      if (data.session === null) return null;
      const prepared = await this.prepareSync();
      if (prepared.kind === "conflict") return null;
      return await this.syncNow({ policy: "normal" });
    } catch {
      return null;
    }
  }

  async #loadState(): Promise<SyncState> {
    try {
      const raw = await AsyncStorage.getItem(STATE_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown;
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "cursor" in parsed &&
          "entries" in parsed
        ) {
          return parsed as SyncState;
        }
      }
    } catch {
      // corrupt → fresh
    }
    return emptySyncState();
  }

  async #saveState(state: SyncState): Promise<void> {
    await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
  }
}
