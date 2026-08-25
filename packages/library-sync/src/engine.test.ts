import { describe, expect, it } from "vitest";
import { SyncEngine } from "./engine";
import { computeLocalChanges, computeRemoteApplication } from "./merge";
import type { LibraryRepository } from "./repository";
import type { SyncChange, SyncPullResult, SyncRemote } from "./remote";
import { emptySyncState, fingerprintKey } from "./syncState";
import type { LiveParamsSnapshot, PresetRecord, SyncKind, SyncRecord } from "./types";

const params = {
  type: 0,
  gain: 1,
  tone: 2,
  reverb: 3,
  feedback: 4,
  volume: 5,
  time: 6,
  mix: 7,
  modulation: 8,
  cabinet: 0,
  irSection: 1,
  delaySection: 1,
  toneSection: 1,
} as LiveParamsSnapshot;

function preset(id: string, updatedAt: string, name = "Preset"): PresetRecord {
  return {
    kind: "preset",
    id,
    name,
    notes: "",
    tags: [],
    profile: "otro",
    params,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt,
  };
}

const iso = (n: number): string => new Date(n).toISOString();

class FakeRepository implements LibraryRepository {
  records = new Map<string, SyncRecord>();

  async snapshot(): Promise<readonly SyncRecord[]> {
    return [...this.records.values()];
  }

  async upsert(record: SyncRecord): Promise<void> {
    this.records.set(fingerprintKey(record.kind, record.id), record);
  }

  async remove(kind: SyncKind, id: string): Promise<void> {
    this.records.delete(fingerprintKey(kind, id));
  }
}

class FakeRemote implements SyncRemote {
  server = new Map<string, SyncChange>();
  #cursor = 0;

  async pull(): Promise<SyncPullResult> {
    this.#cursor += 1;
    return { changes: [...this.server.values()], cursor: String(this.#cursor) };
  }

  async push(changes: readonly SyncChange[]): Promise<void> {
    for (const change of changes) {
      const key = fingerprintKey(change.kind, change.id);
      const existing = this.server.get(key);
      if (existing === undefined || change.updatedAt >= existing.updatedAt) {
        this.server.set(key, change);
      }
    }
  }
}

describe("computeLocalChanges", () => {
  it("pushes new records", () => {
    const record = preset("a", iso(1000));
    const { changes } = computeLocalChanges([record], {}, iso(2000));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "preset", id: "a", deleted: false });
  });

  it("pushes edited records only when updatedAt changed", () => {
    const record = preset("a", iso(2000));
    const entries = { "preset:a": { updatedAt: iso(1000), deleted: false } };
    const { changes } = computeLocalChanges([record], entries, iso(3000));
    expect(changes).toHaveLength(1);

    const { changes: none } = computeLocalChanges([record], { "preset:a": { updatedAt: iso(2000), deleted: false } }, iso(3000));
    expect(none).toHaveLength(0);
  });

  it("emits a tombstone for locally deleted records", () => {
    const entries = { "preset:a": { updatedAt: iso(1000), deleted: false } };
    const { changes, nextEntries } = computeLocalChanges([], entries, iso(5000));
    expect(changes).toEqual([
      { kind: "preset", id: "a", updatedAt: iso(5000), deleted: true },
    ]);
    expect(nextEntries["preset:a"]).toEqual({ updatedAt: iso(5000), deleted: true });
  });
});

describe("computeRemoteApplication", () => {
  it("applies a newer remote upsert", () => {
    const remote = { kind: "preset" as const, id: "a", updatedAt: iso(2000), deleted: false as const, record: preset("a", iso(2000)) };
    const { applyUpserts, applyDeletes } = computeRemoteApplication([remote], [preset("a", iso(1000))], {});
    expect(applyUpserts).toHaveLength(1);
    expect(applyDeletes).toHaveLength(0);
  });

  it("ignores an older remote upsert", () => {
    const remote = { kind: "preset" as const, id: "a", updatedAt: iso(1000), deleted: false as const, record: preset("a", iso(1000)) };
    const { applyUpserts } = computeRemoteApplication([remote], [preset("a", iso(2000))], {});
    expect(applyUpserts).toHaveLength(0);
  });

  it("applies a newer remote tombstone over a local record", () => {
    const remote = { kind: "preset" as const, id: "a", updatedAt: iso(3000), deleted: true as const };
    const { applyDeletes } = computeRemoteApplication([remote], [preset("a", iso(2000))], {});
    expect(applyDeletes).toEqual([{ kind: "preset", id: "a" }]);
  });

  it("resurrects a record when the remote upsert beats a local tombstone", () => {
    const remote = { kind: "preset" as const, id: "a", updatedAt: iso(4000), deleted: false as const, record: preset("a", iso(4000)) };
    const baseEntries = { "preset:a": { updatedAt: iso(3000), deleted: true } };
    const { applyUpserts, applyDeletes } = computeRemoteApplication([remote], [], baseEntries);
    expect(applyUpserts).toHaveLength(1);
    expect(applyDeletes).toHaveLength(0);
  });
});

describe("SyncEngine end-to-end", () => {
  it("replicates creates, edits and deletes across two devices", async () => {
    const remote = new FakeRemote();
    const repoA = new FakeRepository();
    const repoB = new FakeRepository();

    const engineA = new SyncEngine(repoA, remote, emptySyncState());
    const engineB = new SyncEngine(repoB, remote, emptySyncState());

    // A creates a preset.
    await repoA.upsert(preset("p1", iso(1000)));
    await engineA.sync();
    expect([...remote.server.keys()]).toContain("preset:p1");

    // B pulls it.
    await engineB.sync();
    expect(repoB.records.get("preset:p1")?.updatedAt).toBe(iso(1000));

    // A edits; B should receive the newer version.
    await repoA.upsert(preset("p1", iso(2000), "Edited"));
    await engineA.sync();
    await engineB.sync();
    expect((repoB.records.get("preset:p1") as PresetRecord).name).toBe("Edited");

    // A deletes; B should delete too.
    await repoA.remove("preset", "p1");
    await engineA.sync();
    await engineB.sync();
    expect(repoB.records.has("preset:p1")).toBe(false);
  });

  it("resolves a same-record conflict with last-write-wins", async () => {
    const remote = new FakeRemote();
    const repoA = new FakeRepository();
    const repoB = new FakeRepository();

    await repoA.upsert(preset("p1", iso(1000)));
    const engineA = new SyncEngine(repoA, remote, emptySyncState());
    await engineA.sync();

    const engineB = new SyncEngine(repoB, remote, emptySyncState());
    await engineB.sync();

    // Divergent edits while "offline".
    await repoA.upsert(preset("p1", iso(3000), "A-win"));
    await repoB.upsert(preset("p1", iso(2000), "B-loses"));

    // B pushes first (older), then A pushes (newer). Newer must win everywhere.
    await engineB.sync();
    await engineA.sync();
    await engineB.sync();

    expect((repoA.records.get("preset:p1") as PresetRecord).name).toBe("A-win");
    expect((repoB.records.get("preset:p1") as PresetRecord).name).toBe("A-win");
  });
});
