import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button";
import { SafetyGate } from "../components/SafetyGate";
import { probeUsbPedal } from "../device/connect";
import { useI18n } from "../i18n";
import { useApp } from "../store/AppStore";
import { colors, fonts } from "../theme/tokens";

export function ConnectScreen() {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const {
    connecting,
    error,
    errorCode,
    usbAvailable,
    reduceMotion,
    safetyAccepted,
    safetyReady,
    connect,
    clearError,
    acceptSafety,
    openLibrary,
    shellOpen,
  } = useApp();
  const [pedalReady, setPedalReady] = useState(false);
  const [showGate, setShowGate] = useState(false);

  const brandOpacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const brandY = useRef(new Animated.Value(reduceMotion ? 0 : 18)).current;
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    if (reduceMotion) {
      brandOpacity.setValue(1);
      brandY.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.timing(brandOpacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(brandY, { toValue: 0, duration: 700, useNativeDriver: true }),
    ]).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.7, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 1400, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, brandOpacity, brandY, pulse]);

  useEffect(() => {
    if (!usbAvailable || connecting) return;
    let cancelled = false;
    const tick = async () => {
      const found = await probeUsbPedal();
      if (!cancelled) setPedalReady(found);
    };
    void tick();
    const id = setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [usbAvailable, connecting]);

  useEffect(() => {
    if (shellOpen) router.replace("/(tabs)/set");
  }, [router, shellOpen]);

  const usbError =
    errorCode === "USB_HOST_UNAVAILABLE" ||
    errorCode === "USB_DEVICE_NOT_FOUND" ||
    errorCode === "USB_PERMISSION_DENIED" ||
    errorCode === "USB_UNPLUGGED";

  async function onUsb() {
    clearError();
    if (!safetyAccepted) {
      setShowGate(true);
      return;
    }
    const ok = await connect("usb");
    if (ok) router.replace("/(tabs)/live");
  }

  async function onLibrary() {
    clearError();
    openLibrary();
    router.replace("/(tabs)/set");
  }

  async function onDemo() {
    clearError();
    setShowGate(false);
    const ok = await connect("demo");
    if (ok) router.replace("/(tabs)/live");
  }

  async function onGateAccepted() {
    await acceptSafety();
    setShowGate(false);
    const ok = await connect("usb");
    if (ok) router.replace("/(tabs)/live");
  }

  if (showGate || errorCode === "SAFETY_REQUIRED") {
    return (
      <SafetyGate
        onAccepted={() => void onGateAccepted()}
        onCancel={() => {
          setShowGate(false);
          clearError();
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <StatusBar style="light" />
      {!reduceMotion ? <Animated.View style={[styles.signal, { opacity: pulse }]} /> : null}

      <Animated.View style={{ opacity: brandOpacity, transform: [{ translateY: brandY }] }}>
        <View style={styles.langRow}>
          <Button
            variant="ghost"
            label={t("lang.es")}
            accessibilityState={{ selected: locale === "es" }}
            onPress={() => setLocale("es")}
            style={styles.langBtn}
          />
          <Button
            variant="ghost"
            label={t("lang.en")}
            accessibilityState={{ selected: locale === "en" }}
            onPress={() => setLocale("en")}
            style={styles.langBtn}
          />
        </View>
        <Text style={styles.brand}>{t("connect.brand")}</Text>
        <Text style={styles.headline}>{t("connect.headline")}</Text>
        <Text style={styles.support}>{t("connect.support")}</Text>
      </Animated.View>

      <View style={styles.actions}>
        {pedalReady ? (
          <Text style={styles.ready} accessibilityLiveRegion="polite">
            {t("connect.pedalReady")}
          </Text>
        ) : null}
        <Button
          label={t("connect.ctaUsb")}
          loading={connecting}
          disabled={!safetyReady}
          onPress={() => void onUsb()}
        />
        <Button
          variant="secondary"
          label={t("connect.ctaLibrary")}
          disabled={connecting}
          onPress={() => void onLibrary()}
        />
        <Text style={styles.hintBody}>{t("connect.libraryHint")}</Text>
        <Button variant="ghost" label={t("connect.ctaDemo")} disabled={connecting} onPress={() => void onDemo()} />
        {!safetyAccepted && safetyReady ? (
          <Text style={styles.hintBody}>{t("connect.safetyNeeded")}</Text>
        ) : null}

        <View style={styles.hint} accessibilityLiveRegion="polite">
          <Text style={styles.hintTitle}>{t("connect.otgTitle")}</Text>
          <Text style={styles.hintBody}>{t("connect.otgBody")}</Text>
          {Platform.OS === "android" ? <Text style={styles.hintBody}>{t("connect.onePort")}</Text> : null}
          {Platform.OS === "ios" ? <Text style={styles.hintBody}>{t("connect.otgIos")}</Text> : null}
          {!usbAvailable ? <Text style={styles.hintBody}>{t("connect.usbMissing")}</Text> : null}
          {errorCode === "USB_PERMISSION_DENIED" ? (
            <Text style={styles.hintBody}>{t("connect.permission")}</Text>
          ) : null}
          {errorCode === "USB_DEVICE_NOT_FOUND" || errorCode === "USB_UNPLUGGED" ? (
            <Text style={styles.hintBody}>{t("connect.noDevice")}</Text>
          ) : null}
        </View>

        {error && !usbError ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.safety}>{t("connect.safety")}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 24,
    justifyContent: "space-between",
  },
  signal: {
    position: "absolute",
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: colors.greenMuted,
    top: -120,
    right: -140,
  },
  langRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  langBtn: { minWidth: 88, paddingHorizontal: 8 },
  brand: {
    fontFamily: fonts.brand,
    fontSize: 52,
    lineHeight: 56,
    color: colors.ink,
    letterSpacing: -1.2,
  },
  headline: {
    marginTop: 18,
    fontFamily: fonts.display,
    fontSize: 28,
    lineHeight: 34,
    color: colors.inkSoft,
  },
  support: {
    marginTop: 12,
    maxWidth: 340,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 24,
    color: colors.muted,
  },
  actions: { gap: 14 },
  ready: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.green },
  hint: { gap: 6 },
  hintTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  hintBody: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: colors.muted },
  error: { fontFamily: fonts.body, fontSize: 16, color: colors.error },
  safety: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted2 },
});

export default ConnectScreen;
