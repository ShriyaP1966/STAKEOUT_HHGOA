export type ButtonVariant = "primary" | "accent" | "secondary" | "danger" | "ghost";
export type Tone = "neutral" | "ok" | "info" | "warn" | "danger" | "accent";

const BUTTON_BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-fg hover:bg-brand-hover",
  accent: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface text-fg hover:bg-sunken",
  danger: "bg-danger text-white hover:bg-danger-hover",
  ghost: "text-fg hover:bg-sunken",
};

export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "sm" = "md"): string {
  const sizing = size === "md" ? "min-h-11 px-4 text-[15px]" : "min-h-10 px-3 text-sm";
  return `${BUTTON_BASE} ${sizing} ${BUTTON_VARIANTS[variant]}`;
}

export const inputClass =
  "w-full min-h-11 rounded-md border border-line-strong bg-surface-2 px-3 py-2 text-[15px] text-fg placeholder:text-fg-muted/80 transition-colors duration-150 hover:border-fg-muted focus:border-fg focus:outline-none focus-visible:outline-2 focus-visible:outline-focus";

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "border-line bg-sunken text-fg",
  ok: "border-ok-line bg-ok-bg text-ok-fg",
  info: "border-info-line bg-info-bg text-info-fg",
  warn: "border-warn-line bg-warn-bg text-warn-fg",
  danger: "border-danger-line bg-danger-bg text-danger-fg",
  accent: "border-accent bg-accent text-accent-fg",
};

export function toneClass(tone: Tone): string {
  return TONE_CLASSES[tone];
}
