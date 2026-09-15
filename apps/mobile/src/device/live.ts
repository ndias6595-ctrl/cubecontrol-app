import {
  clampLiveParamValue,
  LIVE_PARAM_NAMES,
  type CubeBabyPresetBank,
  type CubeBabyPresetSlot,
  type LiveParamName,
  type PresetSlotId,
} from "@tonehub/cube-baby-protocol";
import type { CubeBabySession } from "@tonehub/cube-baby-api";
import type { LiveParamsSnapshot } from "../library/types";

const LIVE_WRITE_GAP_MS = 45;
const LIVE_ACK_TIMEOUT_MS = 1_500;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function slotIndexOf(slot: PresetSlotId): number {
  return slot === "A" ? 0 : slot === "B" ? 1 : 2;
}

export function slotToLive(slot: CubeBabyPresetSlot): LiveParamsSnapshot {
  return {
    type: slot.type,
    gain: slot.gain,
    tone: slot.tone,
    reverb: slot.reverb,
    feedback: slot.feedback,
    volume: slot.volume,
    time: slot.time,
    mix: slot.mix,
    modulation: slot.modulation,
    cabinet: slot.cabinet,
    irSection: slot.irSection,
    delaySection: slot.delaySection,
    toneSection: slot.toneSection,
  };
}

export function bankSummary(bank: CubeBabyPresetBank): string {
  const slotA = bank.slots[0];
  return `A gain ${slotA.gain} · cab ${slotA.cabinet}`;
}

export async function writeLiveParam(
  session: CubeBabySession,
  param: LiveParamName,
  value: number,
  slotIndex: number,
  handshake = true,
): Promise<number> {
  const clamped = clampLiveParamValue(param, value);
  if (param === "cabinet") {
    await session.selectCabinet({
      cabinet: clamped,
      slotIndex,
      timeoutMs: LIVE_ACK_TIMEOUT_MS,
      nudge: false,
    });
  } else {
    await session.writeLiveParam({
      param,
      value: clamped,
      slotIndex,
      handshake,
      timeoutMs: LIVE_ACK_TIMEOUT_MS,
    });
  }
  return clamped;
}

export async function applyLiveParams(
  session: CubeBabySession,
  live: LiveParamsSnapshot,
  slotIndex: number,
): Promise<void> {
  let first = true;
  for (const name of LIVE_PARAM_NAMES) {
    if (name === "cabinet") continue;
    await writeLiveParam(session, name, live[name], slotIndex, first);
    first = false;
    await sleep(LIVE_WRITE_GAP_MS);
  }
  await session.selectCabinet({
    cabinet: live.cabinet,
    slotIndex,
    timeoutMs: LIVE_ACK_TIMEOUT_MS,
    nudge: false,
  });
}

export async function applySlotToLive(
  session: CubeBabySession,
  bank: CubeBabyPresetBank,
  slot: PresetSlotId,
): Promise<LiveParamsSnapshot> {
  const index = slotIndexOf(slot);
  const snap = slotToLive(bank.slots[index]);

  const restored = await session.restoreBank({
    data: bank.raw,
    liveSlotIndex: index,
    timeoutMs: 5_000,
  });

  if (!restored.verified) {
    throw new Error(`Falha ao verificar o preset ${slot} no pedal`);
  }

  return snap;
}
