import { LIVE_PARAM_NAMES, type PresetSlotId } from "@tonehub/cube-baby-protocol";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button";
import { ComparePanel } from "../components/ComparePanel";
import { PedalNeeded } from "../components/PedalNeeded";
import { SafetyGate } from "../components/SafetyGate";
import { SessionBanner } from "../components/SessionBanner";
import { compareSlots, type MatchVolumesSource } from "../device/bank";
import { pickJsonFile, pickWavFile, readUriBytes, readUriText, shareJsonFile, alertFilesError } from "../device/files";
import { useI18n } from "../i18n";
import { useApp } from "../store/AppStore";
import { colors, fonts, HIT } from "../theme/tokens";
import { confirmAction } from "../ui/confirm";
import { confirmIrCabinetWrite } from "../ui/irConfirm";

const CABS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export function DeviceScreen() {
  const { t } = useI18n();
  const app = useApp();
  const [compareOpen, setCompareOpen] = useState(false);
  const [showGate, setShowGate] = useState(false);
  const live = app.live;
  const bank = app.connection?.bank;
  const [irNames, setIrNames] = useState<Record<number, string>>({});

  async function ensureSafety(): Promise<boolean> {
    if (app.safetyAccepted) return true;
    setShowGate(true);
    return false;
  }

  async function onExport() {
    if (!(await ensureSafety())) return;
    try {
      const json = await app.exportBank();
      if (!json) return;
      await shareJsonFile(`cube-baby-bank-${Date.now()}.json`, json);
    } catch (err) {
      alertFilesError(err);
    }
  }

  async function onImport() {
    if (!(await ensureSafety())) return;
    const ok = await confirmAction({
      title: t("studio.importTitle"),
      message: `${t("studio.importBody", { slot: app.slot })}\n${t("studio.importDetail")}`,
      confirmLabel: t("studio.chooseFile"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      const file = await pickJsonFile();
      if (!file) return;
      const json = await readUriText(file.uri);
      await app.importBank(json);
    } catch (err) {
      alertFilesError(err);
    }
  }

  async function onLoadIr() {
    if (!(await ensureSafety())) return;
    try {
      const file = await pickWavFile();
      if (!file) return;
      const confirmed = await confirmIrCabinetWrite(t, app.irCabinet, file.name);
      if (!confirmed) return;
      const wav = await readUriBytes(file.uri);
      await app.loadIrWav(wav, app.irCabinet, {
        confirmFactoryIrOverwrite: app.irCabinet !== 8,
        distance: app.irDistance,
        fileName: file.name,
      });
    } catch (err) {
      alertFilesError(err);
    }
  }

  async function onCompare() {
    await app.refreshBank();
    setCompareOpen(true);
  }

  async function onMatch(source: MatchVolumesSource) {
    if (!(await ensureSafety())) return;
    const label =
      source === "live"
        ? t("studio.matchLiveLabel", { v: live?.volume ?? 0 })
        : t("studio.matchSlotLabel", { slot: source });
    const ok = await confirmAction({
      title: t("studio.matchTitle"),
      message: t("studio.matchBody", { label }),
      confirmLabel: t("studio.matchCta"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    await app.matchVolumes(source);
  }

  async function onCopy(from: PresetSlotId, to: PresetSlotId) {
    if (!(await ensureSafety())) return;
    const ok = await confirmAction({
      title: t("studio.copyBankTitle", { from, to }),
      message: t("studio.copyBankBody", { to }),
      confirmLabel: t("common.copy"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    await app.copySlot(from, to);
    await app.refreshBank();
  }

  async function onResetSafety() {
    const ok = await confirmAction({
      title: t("device.safety.resetTitle"),
      message: t("device.safety.resetBody"),
      confirmLabel: t("device.safety.resetCta"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    await app.resetSafety();
  }

  if (showGate) {
    return (
      <SafetyGate
        onAccepted={() => {
          void app.acceptSafety().then(() => setShowGate(false));
        }}
        onCancel={() => setShowGate(false)}
      />
    );
  }

  const rows = bank ? compareSlots(bank) : [];
  const liveDirty =
    live != null && bank != null
      ? LIVE_PARAM_NAMES.some((name) => {
          const stored = bank.slots[app.slot === "A" ? 0 : app.slot === "B" ? 1 : 2];
          return stored[name] !== live[name];
        })
      : false;

  if (app.connection === null) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.title} accessibilityRole="header">
            {t("nav.device")}
          </Text>
          <PedalNeeded />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title} accessibilityRole="header">
          {t("nav.device")}
        </Text>
        <Text style={styles.sub}>{t("device.subtitle")}</Text>
        <SessionBanner error={app.error} status={app.status} busy={app.busy} />

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Bank</Text>
          <Text style={styles.copy}>{t("device.bank.copy")}</Text>
          <Button label={t("device.bank.export")} disabled={app.busy} onPress={() => void onExport()} />
          <Button
            variant="secondary"
            label={t("device.bank.import")}
            disabled={app.busy}
            onPress={() => void onImport()}
          />
        </View>

        <View style={styles.card}>
  <Text style={styles.cardTitle}>Gerenciador de IR</Text>
  <Text style={styles.copy}>
    Escolha o banco onde o IR será instalado.
  </Text>

  <Text style={styles.label}>IRs disponíveis</Text>

  <View style={styles.cabs}>
    {CABS.map((cab) => (
      <Pressable
        key={cab}
        accessibilityRole="button"
        accessibilityLabel={`IR ${cab}`}
        accessibilityState={{ selected: app.irCabinet === cab }}
        onPress={() => app.setIrCabinet(cab)}
        style={[
          styles.cab,
          app.irCabinet === cab && styles.cabOn,
        ]}
      >
        <Text
          style={[
            styles.cabLabel,
            app.irCabinet === cab && styles.cabLabelOn,
          ]}
        >
          IR {cab}
        </Text>
      </Pressable>
    ))}
  </View>

  <Text style={styles.hint}>
    IR {app.irCabinet} selecionado
  </Text>

  <Text style={styles.label}>Distância do microfone</Text>

  <View style={styles.distRow}>
    <Button
      variant="secondary"
      label="−"
      disabled={app.busy}
      onPress={() =>
        app.setIrDistance(
          Math.max(
            0,
            Math.round((app.irDistance - 0.05) * 100) / 100,
          ),
        )
      }
      style={styles.step}
    />

    <Text style={styles.distValue}>
      {t("mic.valueText", {
        pct: Math.round(app.irDistance * 100),
        float: app.irDistance.toFixed(2),
      })}
    </Text>

    <Button
      variant="secondary"
      label="+"
      disabled={app.busy}
      onPress={() =>
        app.setIrDistance(
          Math.min(
            1,
            Math.round((app.irDistance + 0.05) * 100) / 100,
          ),
        )
      }
      style={styles.step}
    />
  </View>

  <Button
    label={t("device.ir.load")}
    disabled={app.busy}
    onPress={() => void onLoadIr()}
  />
</View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("device.levels.title")}</Text>
          <Text style={styles.copy}>{t("device.levels.copy")}</Text>
          <Button
            label={t("device.levels.compare")}
            disabled={app.busy}
            onPress={() => void onCompare()}
          />
        </View>

        {compareOpen && live && bank ? (
          <ComparePanel
            rows={rows}
            busy={app.busy}
            liveParams={live}
            liveDirty={liveDirty}
            activeSlot={app.slot}
            onClose={() => setCompareOpen(false)}
            onMatchVolumes={(source) => void onMatch(source)}
            onCopySlot={(from, to) => void onCopy(from, to)}
          />
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("device.safety.title")}</Text>
          <Text style={styles.copy}>{t("device.safety.live")}</Text>
          <Text style={styles.copy}>{t("device.safety.bank")}</Text>
          <Text style={styles.copy}>{t("device.safety.ir")}</Text>
          <Text style={styles.copy}>{t("device.safety.copy")}</Text>
          <Button
            variant="ghost"
            label={t("device.safety.resetCta")}
            disabled={app.busy}
            onPress={() => void onResetSafety()}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 22, paddingBottom: 28, gap: 16 },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: colors.muted, marginTop: -8 },
  card: { gap: 10, padding: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  cardTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  copy: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.muted },
  label: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  hint: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, marginTop: -4 },
  cabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cab: {
    width: HIT,
    height: HIT,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.green,
  },
  cabOn: { backgroundColor: colors.green },
  cabLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.green },
  cabLabelOn: { color: colors.onAccent },
  distRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  distValue: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  step: { minWidth: HIT, paddingHorizontal: 12 },
});

export default DeviceScreen;
