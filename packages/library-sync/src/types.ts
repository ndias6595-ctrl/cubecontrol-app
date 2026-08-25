import type { LiveParamName } from "@tonehub/cube-baby-protocol";

/**
 * Canonical, syncable library record shapes for CubeControl.
 *
 * These are the pure-metadata records that travel between devices. Anything
 * device-local (IR `wavFile` on desktop, IR `uri` on mobile) is intentionally
 * excluded: only the portable metadata is synced. The desktop and mobile apps
 * map their own stores onto these shapes.
 */

export type LiveParamsSnapshot = Record<LiveParamName, number>;

export type LibraryProfile = "ensayo" | "directo" | "grabacion" | "otro";

export const LIBRARY_PROFILES: readonly LibraryProfile[] = [
  "ensayo",
  "directo",
  "grabacion",
  "otro",
];

export type DelayNoteId = "1/4" | "1/8" | "1/8d" | "1/16";

export const SYNC_KINDS = ["preset", "song", "show", "ir"] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];

export interface PresetRecord {
  readonly kind: "preset";
  readonly id: string;
  readonly name: string;
  readonly notes: string;
  readonly tags: readonly string[];
  readonly profile: LibraryProfile;
  readonly params: LiveParamsSnapshot;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IrRecord {
  readonly kind: "ir";
  readonly id: string;
  readonly name: string;
  readonly notes: string;
  readonly tags: readonly string[];
  readonly profile: LibraryProfile;
  /** WAV length in bytes; may be unknown when only metadata has synced. */
  readonly byteLength?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SongRecord {
  readonly kind: "song";
  readonly id: string;
  readonly name: string;
  readonly notes: string;
  readonly tags: readonly string[];
  readonly presetId: string;
  readonly irId?: string;
  readonly irCabinet?: number;
  readonly irDistance?: number;
  readonly key?: string;
  readonly bpm?: number;
  readonly delayNote?: DelayNoteId;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ShowRecord {
  readonly kind: "show";
  readonly id: string;
  readonly name: string;
  readonly notes: string;
  /** Ordered setlist of song ids. */
  readonly songIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type SyncRecord = PresetRecord | IrRecord | SongRecord | ShowRecord;

/** Record kind keyed by the `kind` discriminator. */
export type SyncRecordOf<K extends SyncKind> = Extract<SyncRecord, { readonly kind: K }>;
