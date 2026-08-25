import type { SyncKind } from "./types";

/**
 * Durable sync bookkeeping, persisted by the host app (a file on desktop,
 * AsyncStorage on mobile). It records what we last pushed and the server
 * cursor so the engine can compute a minimal diff on every run.
 */

export interface FingerprintEntry {
  /** Content version (`updatedAt`) last pushed for this record. */
  readonly updatedAt: string;
  /** Whether the last pushed state was a tombstone (delete). */
  readonly deleted: boolean;
}

export interface SyncState {
  /** Opaque server cursor from the last pull. */
  readonly cursor: string | null;
  /** Key `${kind}:${id}` → last-pushed fingerprint. */
  readonly entries: Record<string, FingerprintEntry>;
}

export function fingerprintKey(kind: SyncKind, id: string): string {
  return `${kind}:${id}`;
}

export function emptySyncState(): SyncState {
  return { cursor: null, entries: {} };
}
