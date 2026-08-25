import { useCallback, useEffect, useState } from "react";
import "./sync-panel.css";

type SyncStatus = {
  readonly configured: boolean;
  readonly signedIn: boolean;
  readonly email: string | null;
  readonly lastSyncAt: string | null;
};

type Prepare = {
  readonly kind: "proceed" | "seed-cloud" | "pull-cloud" | "conflict";
  readonly localCount: number;
  readonly remoteCount: number;
  readonly twins: readonly { readonly localId: string; readonly remoteId: string; readonly name: string }[];
};

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("rate limit") || message.includes("rate_limit")) {
    return "Límite de emails alcanzado (tier gratuito). Espera ~1 hora o configura SMTP en Supabase → Auth → SMTP.";
  }
  if (message.includes("not configured") || message.includes("SUPABASE")) {
    return message;
  }
  return message;
}

export function SyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [prepare, setPrepare] = useState<Prepare | null>(null);
  const [mergeTwins, setMergeTwins] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.tonehubDesktop.sync.status());
    } catch {
      setStatus({ configured: false, signedIn: false, email: null, lastSyncAt: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubscribe = window.tonehubDesktop.sync.onSignedIn(() => {
      setWaiting(false);
      void refresh();
    });
    return unsubscribe;
  }, [refresh]);

  async function sendLink() {
    setError(null);
    setNotice(null);
    setSending(true);
    try {
      await window.tonehubDesktop.sync.signInWithOtp(email);
      setWaiting(true);
      setNotice("Revisa tu email y haz clic en el enlace. Se abrirá CubeControl.");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSending(false);
    }
  }

  async function runSync(input?: Parameters<typeof window.tonehubDesktop.sync.syncNow>[0]) {
    setError(null);
    setNotice(null);
    setSyncing(true);
    try {
      const result = await window.tonehubDesktop.sync.syncNow(input);
      setPrepare(null);
      setNotice(
        `Sync OK · +${result.pulled} descargados · ${result.appliedUpserts}/${result.appliedDeletes} aplicados`,
      );
      await refresh();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSyncing(false);
    }
  }

  async function syncNow() {
    setError(null);
    setNotice(null);
    setSyncing(true);
    try {
      const next = await window.tonehubDesktop.sync.prepareSync();
      if (next.kind === "conflict") {
        setPrepare(next);
        setMergeTwins(next.twins.length > 0);
        setSyncing(false);
        return;
      }
      await runSync({ policy: "normal" });
    } catch (err) {
      setError(friendlyError(err));
      setSyncing(false);
    }
  }

  async function signOut() {
    await window.tonehubDesktop.sync.signOut();
    setNotice(null);
    setPrepare(null);
    await refresh();
  }

  if (status === null) return null;

  if (!status.configured) {
    return (
      <section className="sync-panel">
        <p className="sync-panel__mute">
          Sync: sin configurar (crea apps/desktop/.env con SUPABASE_URL y SUPABASE_ANON_KEY).
        </p>
      </section>
    );
  }

  if (!status.signedIn) {
    return (
      <section className="sync-panel">
        <h2 className="sync-panel__title">Sincronizar biblioteca</h2>
        {waiting ? (
          <p className="sync-panel__ok">Enlace enviado. Revisa tu email y haz clic en él.</p>
        ) : (
          <div className="sync-panel__row">
            <input
              className="sync-panel__input"
              value={email}
              type="email"
              placeholder="tu@email.com"
              onChange={(event) => setEmail(event.target.value)}
            />
            <button
              type="button"
              className="sync-panel__button"
              disabled={sending || email.trim().length === 0}
              onClick={() => void sendLink()}
            >
              {sending ? "Enviando…" : "Enviar enlace"}
            </button>
          </div>
        )}
        {notice ? <p className="sync-panel__mute">{notice}</p> : null}
        {error ? <p className="sync-panel__error">{error}</p> : null}
      </section>
    );
  }

  if (prepare?.kind === "conflict") {
    return (
      <section className="sync-panel sync-panel--wide">
        <h2 className="sync-panel__title">Este aparato y la nube no coinciden</h2>
        <p className="sync-panel__mute">
          Local: {prepare.localCount} ítems · Nube: {prepare.remoteCount}. Si mezclamos a ciegas
          vas a ver duplicados. Elige un lado.
        </p>
        {prepare.twins.length > 0 ? (
          <label className="sync-panel__check">
            <input
              type="checkbox"
              checked={mergeTwins}
              onChange={(event) => setMergeTwins(event.target.checked)}
            />
            Unir {prepare.twins.length} tono{prepare.twins.length === 1 ? "" : "s"} con el mismo
            nombre y knobs ({prepare.twins.map((twin) => twin.name).join(", ")})
          </label>
        ) : null}
        <div className="sync-panel__col">
          <button
            type="button"
            className="sync-panel__button"
            disabled={syncing}
            onClick={() =>
              void runSync({
                policy: "use-cloud",
                mergeTwins: mergeTwins && prepare.twins.length > 0,
                twinKeep: "remote",
                twins: [...prepare.twins],
              })
            }
          >
            Usar la nube
          </button>
          <button
            type="button"
            className="sync-panel__button"
            disabled={syncing}
            onClick={() =>
              void runSync({
                policy: "upload-local",
                mergeTwins: mergeTwins && prepare.twins.length > 0,
                twinKeep: "local",
                twins: [...prepare.twins],
              })
            }
          >
            Subir este PC
          </button>
          <button
            type="button"
            className="sync-panel__ghost"
            disabled={syncing}
            onClick={() => setPrepare(null)}
          >
            Cancelar
          </button>
        </div>
        {error ? <p className="sync-panel__error">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="sync-panel">
      <h2 className="sync-panel__title">Sync</h2>
      <p className="sync-panel__mute">
        {status.email}
        {status.lastSyncAt ? ` · último ${new Date(status.lastSyncAt).toLocaleString()}` : ""}
      </p>
      <div className="sync-panel__row">
        <button
          type="button"
          className="sync-panel__button"
          disabled={syncing}
          onClick={() => void syncNow()}
        >
          {syncing ? "Sincronizando…" : "Sync ahora"}
        </button>
        <button type="button" className="sync-panel__ghost" onClick={() => void signOut()}>
          Cerrar sesión
        </button>
      </div>
      {notice ? <p className="sync-panel__ok">{notice}</p> : null}
      {error ? <p className="sync-panel__error">{error}</p> : null}
    </section>
  );
}
