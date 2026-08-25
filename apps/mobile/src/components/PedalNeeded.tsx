import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useApp } from "../store/AppStore";
import { useI18n } from "../i18n";
import { colors, fonts, space } from "../theme/tokens";
import { Button } from "./Button";
import { SafetyGate } from "./SafetyGate";

/** Live / bank / IR need USB (or demo). Library, share, and sync do not. */
export function PedalNeeded() {
  const { t } = useI18n();
  const app = useApp();
  const [showGate, setShowGate] = useState(false);

  if (showGate) {
    return (
      <SafetyGate
        onAccepted={() => {
          void app.acceptSafety().then(async () => {
            setShowGate(false);
            await app.connect("usb");
          });
        }}
        onCancel={() => setShowGate(false)}
      />
    );
  }

  async function onUsb() {
    app.clearError();
    if (!app.safetyAccepted) {
      setShowGate(true);
      return;
    }
    await app.connect("usb");
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t("pedalNeeded.title")}</Text>
      <Text style={styles.body}>{t("pedalNeeded.body")}</Text>
      <Button
        label={t("connect.ctaUsb")}
        loading={app.connecting}
        disabled={!app.safetyReady || app.connecting}
        onPress={() => void onUsb()}
      />
      <Button
        variant="secondary"
        label={t("connect.ctaDemo")}
        disabled={app.connecting}
        onPress={() => void app.connect("demo")}
      />
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
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.muted,
  },
});
