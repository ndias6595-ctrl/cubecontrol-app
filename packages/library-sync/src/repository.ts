import type { SyncKind, SyncRecord } from "./types";

/**
 * Local store abstraction. The desktop filesystem store and the mobile
 * AsyncStorage store both implement this contract so the sync engine stays
 * platform-agnostic.
 */
export interface LibraryRepository {
  /** All non-deleted records, across every kind. */
  snapshot(): Promise<readonly SyncRecord[]>;

  /** Insert or replace a record (matched by kind + id). */
  upsert(record: SyncRecord): Promise<void>;

  /** Delete a record by kind + id. */
  remove(kind: SyncKind, id: string): Promise<void>;
}
