import { describe, expect, it } from "vitest";
import { Status } from "@shared/enums";
import { statusName, warningFor } from "./warning";

describe("warningFor", () => {
  it("maps each status to its warning level", () => {
    expect(warningFor(Status.None).level).toBe("none");
    expect(warningFor(Status.Reported).level).toBe("note");
    expect(warningFor(Status.Flagged).level).toBe("soft");
    expect(warningFor(Status.Confirmed).level).toBe("strong");
    expect(warningFor(Status.Linked).level).toBe("strong");
  });

  it("shows the countdown only for Flagged and the cluster only for Confirmed and Linked", () => {
    const withCountdown = Object.values(Status).filter((value): value is Status => typeof value === "number" && warningFor(value).showCountdown);
    const withCluster = Object.values(Status).filter((value): value is Status => typeof value === "number" && warningFor(value).showCluster);
    expect(withCountdown).toEqual([Status.Flagged]);
    expect(withCluster).toEqual([Status.Confirmed, Status.Linked]);
  });

  it("fails loudly on an unknown status", () => {
    expect(() => warningFor(99)).toThrow(/Unknown status value 99/);
    expect(() => statusName(99)).toThrow(/Unknown status value 99/);
    expect(statusName(Status.Linked)).toBe("Linked");
  });
});
