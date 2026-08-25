import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "./Button";
import { useApp } from "../store/AppStore";
import { colors, fonts, space } from "../theme/tokens";

export function SyncPanel() {
  const app = useApp();
  const [email, setEmail] = useState("");
  const [mergeTwins, setMergeTwins] = useState(true);

  const signedIn = app.sync.signedIn;
  const busy = app.syncBusy;
  const prepare = app.syncPrepare;

  if (prepare?.kind === "conflict") {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Este aparato y la nube no coinciden</Text>
        <Text style={styles.muted}>
          Local: {prepare.localCount} · Nube: {prepare.remoteCount}. Elige un lado para no duplicar.
        </Text>
        {prepare.twins.length > 0 ? (
          <Text style={styles.muted}>
            {prepare.twins.length} tono(s) con mismo nombre y knobs
            {mergeTwins ? " — se unirán." : "."}{" "}
            <Text style={styles.link} onPress={() => setMergeTwins((value) => !value)}>
              {mergeTwins ? "Dejar los dos" : "Unir gemelos"}
            </Text>
          </Text>
        ) : null}
        <View style={styles.col}>
          <Button
            label="Usar la nube"
            variant="primary"
            loading={busy}
            disabled={busy}
            onPress={() => void app.confirmSyncPolicy("use-cloud", mergeTwins)}
          />
          <Button
            label="Subir este teléfono"
            variant="secondary"
            disabled={busy}
            onPress={() => void app.confirmSyncPolicy("upload-local", mergeTwins)}
          />
          <Button label="Cancelar" variant="ghost" disabled={busy} onPress={() => app.cancelSyncPrepare()} />
        </View>
        {app.syncError ? <Text style={styles.error}>{app.syncError}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Sync</Text>

      {signedIn ? (
        <>
          <Text style={styles.muted}>
            {app.sync.email}
            {app.sync.lastSyncAt
              ? ` · ${new Date(app.sync.lastSyncAt).toLocaleTimeString()}`
              : ""}
          </Text>
          <View style={styles.row}>
            <Button
              label="Sync ahora"
              variant="primary"
              loading={busy}
              disabled={busy}
              onPress={() => void app.syncNow()}
            />
            <Button
              label="Cerrar sesión"
              variant="ghost"
              disabled={busy}
              onPress={() => void app.syncSignOut()}
            />
          </View>
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            value={email}
            placeholder="tu@email.com"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={setEmail}
          />
          <Button
            label={busy ? "Enviando…" : "Enviar enlace"}
            variant="secondary"
            loading={busy}
            disabled={busy || email.trim().length === 0}
            onPress={() => void app.syncSignIn(email)}
          />
        </>
      )}

      {app.syncNotice ? <Text style={styles.notice}>{app.syncNotice}</Text> : null}
      {app.syncError ? <Text style={styles.error}>{app.syncError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.sm,
    padding: space.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg1,
  },
  title: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.ink,
  },
  muted: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  link: {
    color: colors.green,
    fontFamily: fonts.bodyBold,
  },
  row: {
    flexDirection: "row",
    gap: space.sm,
    flexWrap: "wrap",
  },
  col: {
    gap: space.sm,
  },
  input: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  notice: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ok,
  },
  error: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.error,
  },
});
