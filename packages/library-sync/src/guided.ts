import type { SyncResult } from "./engine";
import type { SyncChange, SyncRemote } from "./remote";
import type { LibraryRepository } from "./repository";
import { fingerprintKey, type SyncState } from "./syncState";
import type { SyncRecord } from "./types";

function entriesFromSnapshot(snapshot: readonly SyncRecord[]): SyncState["entries"] {
  const entries: SyncState["entries"] = {};
  for (const record of snapshot) {
    entries[fingerprintKey(record.kind, record.id)] = {
      updatedAt: record.updatedAt,
      deleted: false,
    };
  }
  return entries;
}

function keyOf(kind: SyncRecord["kind"], id: string): string {
  return fingerprintKey(kind, id);
}

/** Replace the local store with the cloud library (first-sync "use cloud"). */
export async function pullCloudReplaceLocal(
  repo: LibraryRepository,
  remote: SyncRemote,
): Promise<{ readonly result: SyncResult; readonly state: SyncState }> {
  const pulled = await remote.pull(null);
  const local = await repo.snapshot();
  const alive = new Set(
    pulled.changes.filter((change) => !change.deleted).map((change) => keyOf(change.kind, change.id)),
  );

  let appliedUpserts = 0;
  for (const change of pulled.changes) {
    if (change.deleted) continue;
    await repo.upsert(change.record);
    appliedUpserts += 1;
  }

  let appliedDeletes = 0;
  for (const record of local) {
    if (alive.has(keyOf(record.kind, record.id))) continue;
    await repo.remove(record.kind, record.id);
    appliedDeletes += 1;
  }

  const snapshot = await repo.snapshot();
  return {
    result: {
      pushed: 0,
      pulled: pulled.changes.length,
      appliedUpserts,
      appliedDeletes,
    },
    state: { cursor: pulled.cursor, entries: entriesFromSnapshot(snapshot) },
  };
}

/** Push this device as the cloud library (first-sync "upload this device"). */
export async function uploadLocalReplaceCloud(
  repo: LibraryRepository,
  remote: SyncRemote,
  now: string,
): Promise<{ readonly result: SyncResult; readonly state: SyncState }> {
  const local = await repo.snapshot();
  const peeked = await remote.pull(null);
  const localKeys = new Set(local.map((record) => keyOf(record.kind, record.id)));

  const upserts: SyncChange[] = local.map((record) => ({
    kind: record.kind,
    id: record.id,
    updatedAt: record.updatedAt,
    deleted: false as const,
    record,
  }));
  const deletes: SyncChange[] = peeked.changes
    .filter((change) => !change.deleted && !localKeys.has(keyOf(change.kind, change.id)))
    .map((change) => ({
      kind: change.kind,
      id: change.id,
      updatedAt: now,
      deleted: true as const,
    }));

  if (upserts.length + deletes.length > 0) {
    await remote.push([...upserts, ...deletes]);
  }
  const pulled = await remote.pull(null);
  return {
    result: {
      pushed: upserts.length + deletes.length,
      pulled: pulled.changes.length,
      appliedUpserts: 0,
      appliedDeletes: 0,
    },
    state: { cursor: pulled.cursor, entries: entriesFromSnapshot(local) },
  };
}
