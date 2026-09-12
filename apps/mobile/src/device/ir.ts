 import type { CubeBabySession } from "@tonehub/cube-baby-api";

export type LoadIrResult = {
  readonly cabinet: number;
  readonly persistVerified: boolean;
  readonly liveMatch: string;
};

/**
 * Load WAV into one of 8 IR ROM slots.
 * `cabinet` is the pedal Cabinet value 1..8 (ROM index = cabinet - 1).
 * Mirrors desktop `deviceBridge.loadIrFromWav`.
 */
export async function loadIrFromWav(
  session: CubeBabySession,
  wav: Uint8Array,
  cabinet: number,
  options?: {
    readonly confirmFactoryIrOverwrite?: boolean;
    readonly distance?: number;
  },
): Promise<LoadIrResult> {
  if (wav.byteLength < 44) throw new Error("WAV demasiado curto");
  if (!Number.isInteger(cabinet) || cabinet < 1 || cabinet > 8) {
    throw new Error("cabinet IR target must be 1..8");
  }
  if (cabinet !== 8 && options?.confirmFactoryIrOverwrite !== true) {
    throw new Error(
      "Escritura a Cab 1–7 bloqueada: confirma explícitamente el riesgo de pisar IR de fábrica (usa Cab 8 si puedes).",
    );
  }
  const distance =
    options?.distance !== undefined && Number.isFinite(options.distance)
      ? Math.min(1, Math.max(0, options.distance))
      : 0.5;
  const slotIndex = cabinet - 1;
  const result = await session.loadIrFromWav({
    wav,
    slotIndex,
    cabinet,
    volume: distance,
    presence: cabinet === 8 ? "upload" : "factory",
    timeoutMs: 8_000,
  });
  return {
    cabinet: result.cabinet,
    persistVerified: result.persist.verified,
    liveMatch: `${result.liveMatchPrefix}/${result.liveMatchTotal}`,
  };
}

export type ReadIrSlotResult = {
  readonly cabinet: number;
  readonly slotIndex: number;
  readonly address: number;
  readonly data: Uint8Array;
};

/**
 * Read one existing IR ROM slot from the pedal.
 * App numbering is 1..8; protocol slotIndex is 0..7.
 */
export async function readIrSlot(
  session: CubeBabySession,
  cabinet: number,
): Promise<ReadIrSlotResult> {
  if (!Number.isInteger(cabinet) || cabinet < 1 || cabinet > 8) {
    throw new Error("cabinet IR target must be 1..8");
  }

  const slotIndex = cabinet - 1;
  const result = await session.dumpIrRom({
    slotIndex,
    timeoutMs: 8_000,
  });

  return {
    cabinet,
    slotIndex: result.slotIndex,
    address: result.address,
    data: result.data,
  };
}
