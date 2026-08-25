import { useCallback, useMemo, useRef } from "react";
import { StatusBar } from "expo-status-bar";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button";
import { PedalNeeded } from "../components/PedalNeeded";
import { SessionBanner } from "../components/SessionBanner";
import { useKeepAwake } from "../hooks/useKeepAwake";
import { useI18n } from "../i18n";
import { applySongMaybeIr } from "../library/applySongIr";
import { useApp } from "../store/AppStore";
import { colors, fonts, HIT } from "../theme/tokens";

export function StageScreen() {
  const { t } = useI18n();
  const {
    library,
    activeShowId,
    songIndex,
    bpm,
    busy,
    error,
    status,
    setSongIndex,
    applySong,
    assignSongToSlot,
    loadIrWav,
    connection,
  } = useApp();

  useKeepAwake(true);

  const show = library.shows.find((item) => item.id === activeShowId) ?? null;
  const ordered = (show?.songIds ?? [])
    .map((id) => library.songs.find((song) => song.id === id))
    .filter((song): song is NonNullable<typeof song> => song !== undefined);
  const current = ordered[songIndex] ?? null;
  const next = ordered[songIndex + 1] ?? null;
  const prev = ordered[songIndex - 1] ?? null;

  const goTo = useCallback(
    async (index: number) => {
      const song = ordered[index];
      if (!song || busy || connection === null) return;
      setSongIndex(index);
      await applySongMaybeIr(t, song, library, { applySong, loadIrWav });
    },
    [applySong, busy, connection, library, loadIrWav, ordered, setSongIndex, t],
  );

  const goToRef = useRef(goTo);
  goToRef.current = goTo;
  const songIndexRef = useRef(songIndex);
  songIndexRef.current = songIndex;
  const lenRef = useRef(ordered.length);
  lenRef.current = ordered.length;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 28 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
        onPanResponderRelease: (_, g) => {
          const index = songIndexRef.current;
          if (g.dx < -48 && index < lenRef.current - 1) void goToRef.current(index + 1);
          if (g.dx > 48 && index > 0) void goToRef.current(index - 1);
        },
      }),
    [],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar style="light" />
      <View style={styles.root}>
        <View style={styles.bar}>
          <Text style={styles.showName}>{show?.name ?? t("stage.empty")}</Text>
          <Text style={styles.count} accessibilityLiveRegion="polite">
            {ordered.length === 0
              ? t("stage.emptyShow")
              : t("stage.count", { current: Math.min(songIndex + 1, ordered.length), total: ordered.length })}
          </Text>
        </View>

        <SessionBanner error={error} status={status} busy={busy} dark />
        {connection === null ? <PedalNeeded /> : null}

        <View style={styles.center} {...pan.panHandlers}>
          {current === null ? (
            <Text style={styles.empty}>{t("stage.empty")}</Text>
          ) : (
            <>
              <Text style={styles.nowLabel}>{t("stage.now")}</Text>
              <Text
                style={styles.now}
                accessibilityRole="header"
                accessibilityLabel={`${t("stage.now")} ${current.name}`}
              >
                {current.name}
              </Text>
              <Text style={styles.bpm}>
                {current.bpm ?? bpm} BPM
                {current.delayNote ? ` · ${current.delayNote}` : ""}
              </Text>
              {next ? (
                <Text style={styles.next}>
                  {t("stage.next")} · {next.name}
                </Text>
              ) : (
                <Text style={styles.next}>{t("stage.end")}</Text>
              )}
              <Text style={styles.swipe}>{t("stage.swipe")}</Text>
            </>
          )}
        </View>

        <View style={styles.controls}>
          <Button
            variant="stage"
            label={t("stage.prev")}
            disabled={busy || !prev || connection === null}
            onPress={() => void goTo(songIndex - 1)}
            style={styles.ctrl}
          />
          <Button
            variant="stagePrimary"
            label={t("stage.applyLive")}
            disabled={busy || !current || connection === null}
            onPress={() => current && void applySongMaybeIr(t, current, library, { applySong, loadIrWav })}
            style={styles.ctrl}
          />
          <View style={styles.feet}>
            {(["A", "B", "C"] as const).map((foot) => (
              <Button
                key={foot}
                variant="stage"
                label={`→${foot}`}
                accessibilityLabel={t(`stage.assign${foot}`)}
                disabled={busy || !current || connection === null}
                onPress={() => current && void assignSongToSlot(current.id, foot)}
                style={styles.foot}
              />
            ))}
          </View>
          <Button
            variant="stage"
            label={t("stage.nextBtn")}
            disabled={busy || !next || connection === null}
            onPress={() => void goTo(songIndex + 1)}
            style={styles.ctrl}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.stageBg },
  root: { flex: 1, paddingHorizontal: 20, paddingBottom: 16, justifyContent: "space-between" },
  bar: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12 },
  showName: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.stageMuted, flex: 1 },
  count: { fontFamily: fonts.body, fontSize: 16, color: colors.stageMuted },
  center: { flex: 1, justifyContent: "center" },
  nowLabel: {
    fontFamily: fonts.body,
    fontSize: 16,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.stageMuted,
  },
  now: {
    fontFamily: fonts.brand,
    fontSize: 52,
    lineHeight: 58,
    color: colors.stageInk,
    marginTop: 8,
  },
  bpm: { marginTop: 12, fontFamily: fonts.display, fontSize: 28, color: colors.greenMuted },
  next: { marginTop: 18, fontFamily: fonts.body, fontSize: 22, lineHeight: 28, color: colors.stageMuted },
  swipe: { marginTop: 16, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.stageMuted },
  empty: { fontFamily: fonts.display, fontSize: 28, color: colors.stageMuted },
  controls: { gap: 10 },
  ctrl: { minHeight: HIT + 4 },
  feet: { flexDirection: "row", gap: 8 },
  foot: { flex: 1, minHeight: HIT + 8 },
});

export default StageScreen;
