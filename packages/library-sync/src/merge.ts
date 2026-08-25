import type { SyncChange } from "./remote";
import type { SyncState } from "./syncState";
import { fingerprintKey } from "./syncState";
import type { SyncKind, SyncRecord } from "./types";

/**
 * Pure LWW merge helpers. Deterministic and side-effect free so they can be
 * unit-tested without a network or filesystem.
 */

function keyOf(record: Pick<SyncRecord, "kind" | "id">): string {
  return fingerprintKey(record.kind, record.id);
}

function snapshotMap(snapshot: readonly SyncRecord[]): Map<string, SyncRecord> {
  const map = new Map<string, SyncRecord>();
  for (const record of snapshot) map.set(keyOf(record), record);
  return map;
}

export interface LocalDiff {
  readonly changes: SyncChange[];
  readonly nextEntries: SyncState["entries"];
}

/**
 * Diff the current local snapshot against the last-pushed fingerprint.
 * `now` is the tombstone timestamp assigned to records deleted since last sync.
 */
export function computeLocalChanges(
  snapshot: readonly SyncRecord[],
  entries: SyncState["entries"],
  now: string,
): LocalDiff {
  const changes: SyncChange[] = [];
  const nextEntries: SyncState["entries"] = {};
  const seen = new Set<string>();

  for (const record of snapshot) {
    const key = keyOf(record);
    seen.add(key);
    const entry = entries[key];
    nextEntries[key] = { updatedAt: record.updatedAt, deleted: false };
    if (entry === undefined || entry.deleted || entry.updatedAt !== record.updatedAt) {
      changes.push({
        kind: record.kind,
        id: record.id,
        updatedAt: record.updatedAt,
        deleted: false,
        record,
      });
    }
  }

  for (const [key, entry] of Object.entries(entries)) {
    if (seen.has(key)) continue;
    if (entry.deleted) {
      nextEntries[key] = entry;
      continue;
    }
    // Present in the fingerprint but no longer local → tombstone.
    const [kind, id] = splitKey(key);
    nextEntries[key] = { updatedAt: now, deleted: true };
    changes.push({ kind, id, updatedAt: now, deleted: true });
  }

  return { changes, nextEntries };
}

function splitKey(key: string): [SyncKind, string] {
  const index = key.indexOf(":");
  return [key.slice(0, index) as SyncKind, key.slice(index + 1)];
}

export interface RemoteApplication {
  readonly applyUpserts: SyncRecord[];
  readonly applyDeletes: readonly { readonly kind: SyncKind; readonly id: string }[];
  readonly nextEntries: SyncState["entries"];
}

/**
 * Decide which pulled (server-authoritative) changes must be applied locally.
 * A remote change wins only when its `updatedAt` is strictly newer than the
 * local record (or the record is absent locally). `baseEntries` is the
 * optimistic post-push fingerprint; pulled changes override their own key.
 */
export function computeRemoteApplication(
  changes: readonly SyncChange[],
  snapshot: readonly SyncRecord[],
  baseEntries: SyncState["entries"],
): RemoteApplication {
  const local = snapshotMap(snapshot);
  const applyUpserts: SyncRecord[] = [];
  const applyDeletes: { kind: SyncKind; id: string }[] = [];
  const nextEntries: SyncState["entries"] = { ...baseEntries };

  for (const change of changes) {
    const key = fingerprintKey(change.kind, change.id);
    nextEntries[key] = { updatedAt: change.updatedAt, deleted: change.deleted };

    const record = local.get(key);
    const localVersion = record?.updatedAt ?? baseEntries[key]?.updatedAt ?? null;

    if (change.deleted) {
      if (record !== undefined && (localVersion === null || change.updatedAt > localVersion)) {
        applyDeletes.push({ kind: change.kind, id: change.id });
      }
      continue;
    }

    if (record === undefined || localVersion === null || change.updatedAt > localVersion) {
      applyUpserts.push(change.record);
    }
  }

  return { applyUpserts, applyDeletes, nextEntries };
}
