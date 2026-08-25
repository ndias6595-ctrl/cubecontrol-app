import { LIVE_PARAM_MAX, type LiveParamName, type PresetSlotId } from "@tonehub/cube-baby-protocol";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button";
import { DelayTapBar } from "../components/DelayTapBar";
import { LiveToolbar } from "../components/LiveToolbar";
import { ParamStepper } from "../components/ParamStepper";
import { PedalNeeded } from "../components/PedalNeeded";
import { SafetyGate } from "../components/SafetyGate";
import { SessionBanner } from "../components/SessionBanner";
import { SlotPads } from "../components/SlotPads";
import { StompPedal } from "../components/StompPedal";
import { useKeepAwake } from "../hooks/useKeepAwake";
import { useI18n } from "../i18n";
import type { LiveParamsSnapshot } from "../library/types";
import { useApp } from "../store/AppStore";
import { LIVE_BLOCKS, type BlockId, type LiveBlockDef } from "../studio/blocks";
import { PEDAL_LOOKS } from "../studio/pedalLooks";
import { colors, fonts } from "../theme/tokens";
import { confirmAction } from "../ui/confirm";

type PendingBank = { readonly kind: "save" } | { readonly kind: "copy"; readonly to: PresetSlotId };

function blockEngaged(block: LiveBlockDef, live: LiveParamsSnapshot): boolean {
  if (block.toggle) return live[block.toggle] > 0;
  if (block.id === "reverb") return live.reverb > 0;
  if (block.id === "modulation") return live.modulation < 7 || live.modulation > 8;
  return true;
}

export function LiveScreen() {
  const { t } = useI18n();
  const {
    connection,
    live,
    slot,
    bpm,
    delayNote,
    tapTimes,
    tempoSynced,
    busy,
    error,
    errorCode,
    status,
    undoCount,
    redoCount,
    safetyAccepted,
    selectSlot,
    setLiveField,
    tapTempo,
    setDelayNote,
    setBpm,
    undoLive,
    redoLive,
    saveSlot,
    copySlot,
    acceptSafety,
    clearError,
    disconnect,
  } = useApp();

  const [pendingBank, setPendingBank] = useState<PendingBank | null>(null);
  const [openBlock, setOpenBlock] = useState<BlockId | null>("drive");

  useKeepAwake(connection?.mode === "usb");

  if (connection === null || live === null) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.kicker}>{t("live.title")}</Text>
          <PedalNeeded />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const showGate = pendingBank !== null || errorCode === "SAFETY_REQUIRED";

  async function onDisconnect() {
    const ok = await confirmAction({
      title: t("confirm.disconnectTitle"),
      message: t("confirm.disconnectBody"),
      confirmLabel: t("nav.disconnect"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    await disconnect();
  }

  async function runSave() {
    const ok = await confirmAction({
      title: t("studio.saveTitle", { slot }),
      message: t("studio.saveBody"),
      confirmLabel: t("toolbar.saveSlot", { slot }),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    await saveSlot(slot);
  }

  async function runCopy(to: PresetSlotId) {
    const ok = await confirmAction({
      title: t("studio.copyLiveTitle", { from: slot, to }),
      message: `${t("studio.copyLiveBody", { to })}\n${t("studio.copyLiveDetailClean", { from: slot })}`,
      confirmLabel: t("studio.copyTo", { to }),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    await copySlot("live", to);
  }

  async function onSave() {
    if (!safetyAccepted) {
      setPendingBank({ kind: "save" });
      return;
    }
    await runSave();
  }

  async function onCopyTo(to: PresetSlotId) {
    if (!safetyAccepted) {
      setPendingBank({ kind: "copy", to });
      return;
    }
    await runCopy(to);
  }

  async function onGateAccepted() {
    await acceptSafety();
    const pending = pendingBank;
    setPendingBank(null);
    if (pending?.kind === "save") await runSave();
    if (pending?.kind === "copy") await runCopy(pending.to);
  }

  if (showGate) {
    return (
      <SafetyGate
        onAccepted={() => void onGateAccepted()}
        onCancel={() => {
          setPendingBank(null);
          clearError();
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.top}>
          <View style={styles.topText}>
            <Text style={styles.kicker}>{t("live.title")}</Text>
            <Text style={styles.device} accessibilityRole="header">
              {connection.deviceName}
            </Text>
            <Text style={styles.meta}>
              {connection.mode === "demo" ? t("live.modeDemo") : t("live.modeUsb")} · {connection.bankSummary}
            </Text>
          </View>
          <Button variant="ghost" label={t("nav.disconnect")} onPress={() => void onDisconnect()} />
        </View>

        <SessionBanner error={error} status={status} busy={busy} />

        <LiveToolbar
          busy={busy}
          canUndo={undoCount > 0}
          canRedo={redoCount > 0}
          activeSlot={slot}
          onUndo={() => void undoLive()}
          onRedo={() => void redoLive()}
          onSave={() => void onSave()}
          onCopyTo={(to) => void onCopyTo(to)}
        />

        <SlotPads
          slot={slot}
          onSelect={(next) => void selectSlot(next)}
          disabled={busy}
          ledLabel={t("live.slotLed")}
          labels={{ A: t("live.padA"), B: t("live.padB"), C: t("live.padC") }}
        />

        <View style={styles.board}>
          <Text style={styles.boardTitle}>{t("live.board")}</Text>
          <Text style={styles.boardHint}>{t("live.boardHint")}</Text>
          <View style={styles.grid}>
            {([0, 2, 4] as const).map((start) => (
              <View key={start} style={styles.row}>
                {LIVE_BLOCKS.slice(start, start + 2).map((block) => {
                  const look = PEDAL_LOOKS[block.id];
                  const selected = openBlock === block.id;
                  return (
                    <View key={block.id} style={styles.cell}>
                      <StompPedal
                        look={look}
                        title={t(`live.block.${block.id}`)}
                        selected={selected}
                        engaged={blockEngaged(block, live)}
                        canBypass={block.toggle !== undefined}
                        knobs={block.knobs.map((param) => ({
                          id: param,
                          label: t(`live.param.${param}`),
                          value: live[param],
                          max: LIVE_PARAM_MAX[param],
                        }))}
                        disabled={busy}
                        onSelect={() => setOpenBlock(selected ? null : block.id)}
                        onBypass={
                          block.toggle
                            ? () => {
                                const toggle = block.toggle;
                                if (toggle === undefined) return;
                                void setLiveField(toggle, live[toggle] > 0 ? 0 : 1);
                              }
                            : undefined
                        }
                      />
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
          {openBlock ? (
            <View
              style={[
                styles.bay,
                { borderColor: PEDAL_LOOKS[openBlock].chassisHi, backgroundColor: PEDAL_LOOKS[openBlock].chassisLo },
              ]}
            >
              <Text style={styles.bayTitle}>
                {t(`live.block.${openBlock}`)} · {PEDAL_LOOKS[openBlock].model}
              </Text>
              {LIVE_BLOCKS.find((block) => block.id === openBlock)?.knobs.map((param) => (
                <ParamStepper
                  key={param}
                  label={t(`live.param.${param}`)}
                  value={live[param]}
                  max={LIVE_PARAM_MAX[param]}
                  accent={PEDAL_LOOKS[openBlock].chassisHi}
                  minusLabel={t("live.minus", { param: t(`live.param.${param}`) })}
                  plusLabel={t("live.plus", { param: t(`live.param.${param}`) })}
                  onChange={(next) => setLiveField(param, next)}
                />
              ))}
              {openBlock === "delay" ? (
                <DelayTapBar
                  bpm={bpm}
                  note={delayNote}
                  synced={tempoSynced}
                  liveTime={live.time}
                  tapCount={tapTimes.length}
                  disabled={busy}
                  onTap={() => void tapTempo()}
                  onBpmChange={(next) => void setBpm(next)}
                  onNoteChange={(next) => void setDelayNote(next)}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 16, paddingBottom: 28, gap: 18 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, paddingHorizontal: 6 },
  topText: { flex: 1 },
  kicker: {
    fontFamily: fonts.body,
    fontSize: 13,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.muted2,
  },
  device: { fontFamily: fonts.display, fontSize: 26, color: colors.ink, marginTop: 4 },
  meta: { fontFamily: fonts.body, fontSize: 16, color: colors.muted, marginTop: 4 },
  board: {
    gap: 10,
    padding: 10,
    backgroundColor: "#141A14",
    borderWidth: 1,
    borderColor: "rgba(80, 110, 70, 0.28)",
  },
  boardTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.muted,
    paddingHorizontal: 4,
  },
  boardHint: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
    marginTop: -4,
    paddingHorizontal: 4,
  },
  grid: { gap: 10 },
  row: { flexDirection: "row", gap: 10 },
  cell: { flex: 1 },
  bay: {
    gap: 12,
    padding: 12,
    borderWidth: 1,
  },
  bayTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.ink,
  },
});

export default LiveScreen;
