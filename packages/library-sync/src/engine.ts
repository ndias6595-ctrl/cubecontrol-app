import { computeLocalChanges, computeRemoteApplication } from "./merge";
import type { LibraryRepository } from "./repository";
import type { SyncRemote } from "./remote";
import type { SyncState } from "./syncState";

export interface SyncResult {
  readonly pushed: number;
  readonly pulled: number;
  readonly appliedUpserts: number;
  readonly appliedDeletes: number;
}

export interface SyncEngineOptions {
  readonly now?: () => string;
}

/**
 * Offline-first LWW sync engine.
 *
 * 1. Diff the local store against the last-pushed fingerprint.
 * 2. Push local changes (server resolves last-write-wins).
 * 3. Pull server-authoritative changes since the stored cursor.
 * 4. Apply the pulled changes locally (strictly-newer wins).
 *
 * The engine is transport-agnostic: it only talks to `SyncRemote` and
 * `LibraryRepository`, both injected by the host app.
 */
export class SyncEngine {
  readonly #repository: LibraryRepository;
  readonly #remote: SyncRemote;
  readonly #now: () => string;
  #state: SyncState;

  constructor(
    repository: LibraryRepository,
    remote: SyncRemote,
    initialState: SyncState,
    options: SyncEngineOptions = {},
  ) {
    this.#repository = repository;
    this.#remote = remote;
    this.#state = initialState;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  get state(): SyncState {
    return this.#state;
  }

  async sync(): Promise<SyncResult> {
    const snapshot = await this.#repository.snapshot();
    const local = computeLocalChanges(snapshot, this.#state.entries, this.#now());

    let pushed = 0;
    if (local.changes.length > 0) {
      await this.#remote.push(local.changes);
      pushed = local.changes.length;
    }

    const pulled = await this.#remote.pull(this.#state.cursor);
    const applied = computeRemoteApplication(pulled.changes, snapshot, local.nextEntries);

    for (const record of applied.applyUpserts) {
      await this.#repository.upsert(record);
    }
    for (const item of applied.applyDeletes) {
      await this.#repository.remove(item.kind, item.id);
    }

    this.#state = {
      cursor: pulled.cursor,
      entries: applied.nextEntries,
    };

    return {
      pushed,
      pulled: pulled.changes.length,
      appliedUpserts: applied.applyUpserts.length,
      appliedDeletes: applied.applyDeletes.length,
    };
  }
}
