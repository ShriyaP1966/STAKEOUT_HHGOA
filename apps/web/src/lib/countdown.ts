export function secondsUntil(deadline: bigint, nowSeconds: number): number {
  return Number(deadline) - nowSeconds;
}

export function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds)) throw new Error("Countdown needs a finite number of seconds.");
  if (seconds <= 0) return "expired";
  const whole = Math.floor(seconds);
  const days = Math.floor(whole / 86400);
  const hours = Math.floor((whole % 86400) / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");
  const clock = `${pad(hours)}h ${pad(minutes)}m ${pad(secs)}s`;
  return days > 0 ? `${days}d ${clock}` : clock;
}
