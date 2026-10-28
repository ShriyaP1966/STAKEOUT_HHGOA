import { describe, expect, it } from "vitest";
import { formatCountdown, secondsUntil } from "./countdown";

describe("formatCountdown", () => {
  it("formats hours, minutes, and seconds with padding", () => {
    expect(formatCountdown(59)).toBe("00h 00m 59s");
    expect(formatCountdown(3661)).toBe("01h 01m 01s");
    expect(formatCountdown(3661.9)).toBe("01h 01m 01s");
  });

  it("adds days when the deadline is a day or more away", () => {
    expect(formatCountdown(86400)).toBe("1d 00h 00m 00s");
    expect(formatCountdown(2 * 86400 + 3 * 3600 + 4 * 60 + 5)).toBe("2d 03h 04m 05s");
  });

  it("reports expired at or after the deadline", () => {
    expect(formatCountdown(0)).toBe("expired");
    expect(formatCountdown(-30)).toBe("expired");
  });

  it("rejects non-finite input", () => {
    expect(() => formatCountdown(Number.NaN)).toThrow(/finite/);
  });
});

describe("secondsUntil", () => {
  it("subtracts the current time from the deadline", () => {
    expect(secondsUntil(1_000n, 400)).toBe(600);
    expect(secondsUntil(1_000n, 1_200)).toBe(-200);
  });
});
