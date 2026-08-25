import { describe, expect, it } from "vitest";
import {
  applyTwinMerges,
  classifyFirstSync,
  findPresetTwins,
  presetsAreTwins,
} from "./firstSync";
import type { LiveParamsSnapshot, PresetRecord, SongRecord } from "./types";

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

function preset(id: string, name: string, mix = 7): PresetRecord {
  return {
    kind: "preset",
    id,
    name,
    notes: "",
    tags: [],
    profile: "otro",
    params: { ...params, mix },
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
  };
}

describe("classifyFirstSync", () => {
  it("proceeds after a cursor exists", () => {
    expect(classifyFirstSync({ cursor: "12", localCount: 3, remoteAliveCount: 9 })).toBe("proceed");
  });

  it("pulls when local is empty", () => {
    expect(classifyFirstSync({ cursor: null, localCount: 0, remoteAliveCount: 4 })).toBe("pull-cloud");
  });

  it("seeds when the cloud is empty", () => {
    expect(classifyFirstSync({ cursor: null, localCount: 2, remoteAliveCount: 0 })).toBe("seed-cloud");
  });

  it("conflicts when both sides have records", () => {
    expect(classifyFirstSync({ cursor: null, localCount: 2, remoteAliveCount: 3 })).toBe("conflict");
  });
});

describe("preset twins", () => {
  it("matches same name and knobs, different ids", () => {
    expect(presetsAreTwins(preset("a", "Crunch"), preset("b", "crunch"))).toBe(true);
  });

  it("does not match different knobs", () => {
    expect(presetsAreTwins(preset("a", "Crunch", 7), preset("b", "Crunch", 9))).toBe(false);
  });

  it("pairs local vs remote once", () => {
    const twins = findPresetTwins(
      [preset("l1", "Crunch"), preset("l2", "Lead")],
      [preset("r1", "Crunch"), preset("r2", "Other")],
    );
    expect(twins).toEqual([{ localId: "l1", remoteId: "r1", name: "Crunch" }]);
  });

  it("rewrites songs when merging toward local", () => {
    const song: SongRecord = {
      kind: "song",
      id: "s1",
      name: "Tune",
      notes: "",
      tags: [],
      presetId: "r1",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const merged = applyTwinMerges(
      [preset("l1", "Crunch"), preset("r1", "Crunch"), song],
      [{ localId: "l1", remoteId: "r1", name: "Crunch" }],
      "local",
    );
    expect(merged.filter((r) => r.kind === "preset").map((r) => r.id)).toEqual(["l1"]);
    expect(merged.find((r) => r.kind === "song" && r.id === "s1")).toMatchObject({ presetId: "l1" });
  });
});
