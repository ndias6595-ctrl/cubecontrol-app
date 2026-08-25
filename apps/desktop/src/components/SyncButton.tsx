import { useCallback, useEffect, useState } from "react";

type SyncStatus = {
  readonly configured: boolean;
  readonly signedIn: boolean;
  readonly email: string | null;
  readonly lastSyncAt: string | null;
};

/**
 * Compact sync control for the Studio top bar. Shows a subtle signed-in
 * indicator and triggers a manual sync when clicked.
 */
export function SyncButton() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.tonehubDesktop.sync.status());
    } catch {
      setStatus({ configured: false, signedIn: false, email: null, lastSyncAt: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsubSynced = window.tonehubDesktop.sync.onSynced(() => void refresh());
    const unsubSigned = window.tonehubDesktop.sync.onSignedIn(() => void refresh());
    return () => {
      unsubSynced();
      unsubSigned();
    };
  }, [refresh]);

  async function onClick() {
    if (!status?.signedIn || busy) return;
    setBusy(true);
    try {
      const prepared = await window.tonehubDesktop.sync.prepareSync();
      if (prepared.kind === "conflict") return;
      await window.tonehubDesktop.sync.syncNow({ policy: "normal" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (status === null || !status.configured) return null;

  const label = busy ? "Sync…" : status.signedIn ? "Sync ✓" : "Sync";
  const title = status.signedIn
    ? `${status.email ?? "Conectado"}${status.lastSyncAt ? ` · ${new Date(status.lastSyncAt).toLocaleTimeString()}` : ""}`
    : "Inicia sesión en la pantalla de conexión para sincronizar";

  return (
    <button
      type="button"
      className="studio-toolbar__btn"
      disabled={busy}
      onClick={() => void onClick()}
      title={title}
    >
      {label}
    </button>
  );
}
