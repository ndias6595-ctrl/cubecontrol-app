import type { SyncKind, SyncRecord } from "./types";

/**
 * A change travelling to/from the sync backend. `updatedAt` is the *content*
 * version (client ISO timestamp) used for last-write-wins resolution.
 */
export type SyncChange =
  | {
      readonly kind: SyncKind;
      readonly id: string;
      readonly updatedAt: string;
      readonly deleted: false;
      readonly record: SyncRecord;
    }
  | {
      readonly kind: SyncKind;
      readonly id: string;
      readonly updatedAt: string;
      readonly deleted: true;
    };

export interface SyncPullResult {
  /** Changes whose server cursor is strictly after `since`. */
  readonly changes: readonly SyncChange[];
  /**
   * Opaque server cursor for the next pull. The engine stores it verbatim;
   * only the backend interprets it.
   */
  readonly cursor: string;
}

/**
 * Backend transport abstraction. The sync engine never touches the network or
 * the database directly — it talks to this interface. The Supabase
 * implementation lives in the desktop app; tests use an in-memory fake.
 */
export interface SyncRemote {
  /** Pull server-authoritative changes since `since` (or everything when null). */
  pull(since: string | null): Promise<SyncPullResult>;

  /** Push a batch of local changes. LWW is resolved server-side by `updatedAt`. */
  push(changes: readonly SyncChange[]): Promise<void>;
}
