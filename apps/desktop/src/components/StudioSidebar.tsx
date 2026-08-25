import type { ReactNode } from "react";
import type { PresetSlotId } from "@tonehub/cube-baby-protocol";
import { useI18n } from "../i18n";
import { useReportProblem } from "../report/ReportProblemContext";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { SlotSwitcher } from "./SlotSwitcher";

export type StudioNavId = "editor" | "library" | "device" | "tuner" | "stage";

type StudioSidebarProps = {
  readonly deviceName: string;
  readonly activeSlot: PresetSlotId;
  readonly nav: StudioNavId;
  readonly busy: boolean;
  readonly onNav: (nav: StudioNavId) => void;
  readonly onSelectSlot: (slot: PresetSlotId) => void;
  readonly onDisconnect: () => void;
  readonly hasPedal?: boolean;
  readonly children?: ReactNode;
};

export function StudioSidebar({
  deviceName,
  activeSlot,
  nav,
  busy,
  onNav,
  onSelectSlot,
  onDisconnect,
  hasPedal = true,
  children,
}: StudioSidebarProps) {
  const { t } = useI18n();
  const { openReportProblem } = useReportProblem();
  const hideChrome = nav === "stage";
  if (hideChrome) return null;

  const navItems: readonly { id: StudioNavId; label: string; hint: string }[] = [
    { id: "editor", label: t("nav.editor"), hint: t("nav.editorHint") },
    { id: "tuner", label: t("nav.tuner"), hint: t("nav.tunerHint") },
    { id: "library", label: t("nav.library"), hint: t("nav.libraryHint") },
    { id: "device", label: t("nav.device"), hint: t("nav.deviceHint") },
  ];

  return (
    <aside className="studio-sidebar">
      <div className="studio-sidebar__brand">
        <span className="studio-sidebar__logo">CubeControl</span>
        <span className="studio-sidebar__device" title={deviceName}>
          <span className="studio-sidebar__pulse" aria-hidden />
          {deviceName}
        </span>
      </div>

      {hasPedal ? (
        <section className="studio-sidebar__section">
          <p className="studio-sidebar__label">{t("nav.footswitch")}</p>
          <SlotSwitcher active={activeSlot} busy={busy} onSelect={onSelectSlot} />
          <p className="studio-sidebar__slot-meta">{t("nav.liveSlot", { slot: activeSlot })}</p>
        </section>
      ) : null}

      <nav className="studio-sidebar__nav" aria-label={t("nav.aria")}>
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              nav === item.id ? "studio-sidebar__nav-btn is-active" : "studio-sidebar__nav-btn"
            }
            onClick={() => onNav(item.id)}
          >
            <span className="studio-sidebar__nav-label">{item.label}</span>
            <span className="studio-sidebar__nav-hint">{item.hint}</span>
          </button>
        ))}
      </nav>

      {children ? <div className="studio-sidebar__panel">{children}</div> : null}

      <div className="studio-sidebar__footer">
        <LanguageSwitcher compact />
        <button
          type="button"
          className="studio-sidebar__report"
          disabled={busy}
          onClick={openReportProblem}
        >
          {t("report.open")}
        </button>
        <button
          type="button"
          className="studio-sidebar__disconnect"
          disabled={busy}
          onClick={onDisconnect}
        >
          {hasPedal ? t("nav.disconnect") : t("nav.leaveLibrary")}
        </button>
      </div>
    </aside>
  );
}
