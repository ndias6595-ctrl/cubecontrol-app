import { Redirect, Tabs, router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../../src/i18n";
import { useApp } from "../../src/store/AppStore";
import { colors, fonts, HIT } from "../../src/theme/tokens";

const TAB_NAMES = ["live", "tuner", "set", "device", "stage"] as const;
type TabName = (typeof TAB_NAMES)[number];

export default function TabsLayout() {
  const { shellOpen } = useApp();
  const { t } = useI18n();

  if (!shellOpen) {
    return <Redirect href="/" />;
  }

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state }) => {
        const current = state.routes[state.index]?.name;
        return (
          <CompanionTabs
            current={current ?? "live"}
            labels={{
              live: t("nav.live"),
              tuner: t("nav.tuner"),
              set: t("nav.set"),
              device: t("nav.device"),
              stage: t("nav.stage"),
            }}
            ariaLabel={t("nav.aria")}
            onPress={(name) => {
              router.navigate(`/(tabs)/${name}`);
            }}
          />
        );
      }}
    >
      <Tabs.Screen name="live" options={{ title: t("nav.live") }} />
      <Tabs.Screen name="tuner" options={{ title: t("nav.tuner") }} />
      <Tabs.Screen name="set" options={{ title: t("nav.set") }} />
      <Tabs.Screen name="device" options={{ title: t("nav.device") }} />
      <Tabs.Screen name="stage" options={{ title: t("nav.stage") }} />
    </Tabs>
  );
}

function CompanionTabs({
  current,
  labels,
  ariaLabel,
  onPress,
}: {
  readonly current: string;
  readonly labels: Record<TabName, string>;
  readonly ariaLabel: string;
  readonly onPress: (name: TabName) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={ariaLabel}
      style={[
        styles.bar,
        {
          backgroundColor: colors.bg1,
          borderTopColor: colors.line,
          paddingBottom: Math.max(insets.bottom, 8),
        },
      ]}
    >
      {TAB_NAMES.map((name) => {
        const selected = current === name;
        return (
          <Pressable
            key={name}
            accessibilityRole="tab"
            accessibilityLabel={labels[name]}
            accessibilityState={{ selected }}
            onPress={() => onPress(name)}
            style={styles.tab}
          >
            <Text
              style={[
                styles.label,
                { color: colors.muted },
                selected && { color: colors.green },
              ]}
              numberOfLines={1}
            >
              {labels[name]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    borderTopWidth: 1,
    paddingTop: 6,
  },
  tab: {
    flex: 1,
    minHeight: HIT,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
  },
});
