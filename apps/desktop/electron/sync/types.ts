import type { FirstSyncKind, FirstSyncPolicy, PresetTwin, TwinKeep } from "@tonehub/library-sync";

export type SyncStatus = {
  readonly configured: boolean;
  readonly signedIn: boolean;
  readonly email: string | null;
  readonly lastSyncAt: string | null;
};

export type SyncPrepareResult = {
  readonly kind: FirstSyncKind;
  readonly localCount: number;
  readonly remoteCount: number;
  readonly twins: readonly PresetTwin[];
};

export type SyncNowInput = {
  readonly policy?: FirstSyncPolicy;
  readonly mergeTwins?: boolean;
  readonly twinKeep?: TwinKeep;
  readonly twins?: readonly PresetTwin[];
};
