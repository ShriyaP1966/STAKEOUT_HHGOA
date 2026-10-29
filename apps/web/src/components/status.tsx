import type { WarningLevel } from "@/lib/warning";

export const LEVEL_PANEL: Record<WarningLevel, string> = {
  none: "border-ok-line bg-ok-bg text-ok-fg",
  note: "border-info-line bg-info-bg text-info-fg",
  soft: "border-warn-line bg-warn-bg text-warn-fg",
  strong: "border-danger-line bg-danger-bg text-danger-fg",
};

export const LEVEL_DOT: Record<WarningLevel, string> = {
  none: "bg-ok-fg",
  note: "bg-info-fg",
  soft: "bg-warn-fg",
  strong: "bg-danger",
};
