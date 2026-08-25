import { LIVE_PARAM_NAMES } from "@tonehub/cube-baby-protocol";
import type { PresetRecord, SongRecord, SyncRecord } from "./types";

export type FirstSyncKind = "proceed" | "seed-cloud" | "pull-cloud" | "conflict";

export type FirstSyncPolicy = "normal" | "use-cloud" | "upload-local";

export interface PresetTwin {
  readonly localId: string;
  readonly remoteId: string;
  readonly name: string;
}

export function classifyFirstSync(input: {
  readonly cursor: string | null;
  readonly localCount: number;
  readonly remoteAliveCount: number;
}): FirstSyncKind {
  if (input.cursor !== null) return "proceed";
  if (input.localCount === 0) return "pull-cloud";
  if (input.remoteAliveCount === 0) return "seed-cloud";
  return "conflict";
}

export function normalizePresetName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function presetParamsKey(params: PresetRecord["params"]): string {
  return LIVE_PARAM_NAMES.map((name) => `${name}:${params[name] ?? 0}`).join(",");
}

export function presetsAreTwins(a: PresetRecord, b: PresetRecord): boolean {
  if (a.id === b.id) return false;
  return (
    normalizePresetName(a.name) === normalizePresetName(b.name) &&
    presetParamsKey(a.params) === presetParamsKey(b.params)
  );
}

/**
 * Local vs remote presets that look like the same tone born twice (same
 * name + knobs, different ids). Used only on first-sync conflict.
 */
export function findPresetTwins(
  local: readonly PresetRecord[],
  remote: readonly PresetRecord[],
): PresetTwin[] {
  const twins: PresetTwin[] = [];
  const usedRemote = new Set<string>();
  for (const left of local) {
    const match = remote.find((right) => !usedRemote.has(right.id) && presetsAreTwins(left, right));
    if (match === undefined) continue;
    usedRemote.add(match.id);
    twins.push({ localId: left.id, remoteId: match.id, name: left.name });
  }
  return twins;
}

export type TwinKeep = "local" | "remote";

function retargetSongs(
  records: readonly SyncRecord[],
  fromId: string,
  toId: string,
): SyncRecord[] {
  const now = new Date().toISOString();
  return records.map((record) => {
    if (record.kind !== "song" || record.presetId !== fromId) return record;
    const next: SongRecord = { ...record, presetId: toId, updatedAt: now };
    return next;
  });
}

/**
 * Collapse twin presets in a record list. Songs that pointed at the discarded
 * id are rewritten to the kept id; the discarded preset is dropped.
 */
export function applyTwinMerges(
  records: readonly SyncRecord[],
  twins: readonly PresetTwin[],
  keep: TwinKeep,
): SyncRecord[] {
  let next = [...records];
  for (const twin of twins) {
    const keepId = keep === "local" ? twin.localId : twin.remoteId;
    const dropId = keep === "local" ? twin.remoteId : twin.localId;
    next = retargetSongs(next, dropId, keepId).filter(
      (record) => !(record.kind === "preset" && record.id === dropId),
    );
  }
  return next;
}
