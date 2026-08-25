import type { PresetSlotId } from "@tonehub/cube-baby-protocol";
import type {
  BankSlotSnapshot,
  BankSnapshot,
  DesktopConnectionInfo,
  LiveParamsSnapshot,
} from "./types/device";

export const LIBRARY_ONLY_PORT = "library";

const QUIET_LIVE: LiveParamsSnapshot = {
  type: 0,
  gain: 5,
  tone: 5,
  reverb: 0,
  feedback: 0,
  volume: 80,
  time: 0,
  mix: 0,
  modulation: 8,
  cabinet: 8,
  irSection: 0,
  delaySection: 0,
  toneSection: 1,
};

function slotOf(id: PresetSlotId): BankSlotSnapshot {
  return { slot: id, ...QUIET_LIVE };
}

export function isLibraryOnlyConnection(info: DesktopConnectionInfo): boolean {
  return info.inputPortId === LIBRARY_ONLY_PORT;
}

/** Enter the studio without MIDI — library, share, and sync only. */
export function makeLibraryOnlyConnection(): DesktopConnectionInfo {
  const bank: BankSnapshot = {
    slots: [slotOf("A"), slotOf("B"), slotOf("C")],
  };
  return {
    deviceName: "Sin pedal",
    inputPortId: LIBRARY_ONLY_PORT,
    outputPortId: LIBRARY_ONLY_PORT,
    bankSummary: "",
    activeSlot: "A",
    liveParams: { ...QUIET_LIVE },
    bank,
  };
}
