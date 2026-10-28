import { describe, expect, it } from "vitest";
import { zeroAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { FlagState, Status } from "@shared/enums";
import {
  anyoneGate,
  challengeBlocker,
  expireBlocker,
  isLive,
  promoteBlocker,
  reporterGate,
  withdrawBlocker,
  type FlagFacts,
} from "./action-rules";

const randomAddress = () => privateKeyToAccount(generatePrivateKey()).address;
const ready = { connected: true, onExpectedChain: true };
const now = 1_000_000;
const flag = (overrides: Partial<FlagFacts> = {}): FlagFacts => ({
  state: FlagState.Active,
  challenger: zeroAddress,
  flagger: randomAddress(),
  expiresAt: BigInt(now + 60),
  ...overrides,
});

describe("reporterGate (promote and challenge visibility)", () => {
  it("hides the button with a reason when the wallet is disconnected or on the wrong chain", () => {
    expect(reporterGate({ connected: false, onExpectedChain: false }, true, null)).toMatchObject({ visible: false, enabled: false });
    expect(reporterGate({ connected: true, onExpectedChain: false }, true, null).reason).toMatch(/network/);
  });

  it("hides the button for accounts without REPORTER_ROLE and while the role is loading", () => {
    expect(reporterGate(ready, false, null)).toEqual({
      visible: false,
      enabled: false,
      reason: "Only verified reporters can do this. Ask the reviewer Safe to whitelist you.",
    });
    expect(reporterGate(ready, undefined, null).visible).toBe(false);
  });

  it("shows an enabled button to a reporter, or a disabled one with the blocker as the reason", () => {
    expect(reporterGate(ready, true, null)).toEqual({ visible: true, enabled: true, reason: null });
    expect(reporterGate(ready, true, "blocked")).toEqual({ visible: true, enabled: false, reason: "blocked" });
  });
});

describe("anyoneGate (expire and withdraw visibility)", () => {
  it("needs only a connected wallet on the right chain", () => {
    expect(anyoneGate(ready, null)).toEqual({ visible: true, enabled: true, reason: null });
    expect(anyoneGate({ connected: false, onExpectedChain: true }, null).visible).toBe(false);
  });
});

describe("promoteBlocker", () => {
  it("allows promotion only for Reported targets", () => {
    expect(promoteBlocker(Status.Reported)).toBeNull();
    expect(promoteBlocker(Status.Flagged)).toMatch(/live flag/);
    expect(promoteBlocker(Status.Confirmed)).toMatch(/cluster/);
    expect(promoteBlocker(Status.Linked)).toMatch(/cluster/);
    expect(promoteBlocker(Status.None)).toMatch(/no report/);
  });
});

describe("challengeBlocker", () => {
  it("allows a live, unchallenged flag raised by someone else", () => {
    expect(challengeBlocker(flag(), randomAddress(), now)).toBeNull();
  });

  it("blocks the flagger, a second challenge, and flags that are not live", () => {
    const own = flag();
    expect(challengeBlocker(own, own.flagger, now)).toMatch(/You raised this flag/);
    expect(challengeBlocker(flag({ challenger: randomAddress() }), randomAddress(), now)).toMatch(/already challenged/);
    expect(challengeBlocker(flag({ expiresAt: BigInt(now) }), randomAddress(), now)).toMatch(/no longer live/);
    expect(challengeBlocker(flag({ state: FlagState.Expired }), randomAddress(), now)).toMatch(/no longer live/);
  });
});

describe("expireBlocker (expire enable rule)", () => {
  it("enables expire only for an active, unchallenged flag whose expiry has passed", () => {
    expect(expireBlocker(flag({ expiresAt: BigInt(now) }), now)).toBeNull();
    expect(expireBlocker(flag({ expiresAt: BigInt(now - 1) }), now)).toBeNull();
  });

  it("keeps expire disabled before the deadline, while challenged, and for inactive flags", () => {
    expect(expireBlocker(flag({ expiresAt: BigInt(now + 1) }), now)).toMatch(/countdown/);
    expect(expireBlocker(flag({ expiresAt: BigInt(now - 1), challenger: randomAddress() }), now)).toMatch(/challenge pauses/);
    for (const state of [FlagState.Expired, FlagState.Confirmed, FlagState.Overturned]) {
      expect(expireBlocker(flag({ state, expiresAt: BigInt(now - 1) }), now)).toMatch(/Only active/);
    }
  });

  it("treats a challenged flag as live after its deadline", () => {
    expect(isLive(flag({ expiresAt: BigInt(now - 1), challenger: randomAddress() }), now)).toBe(true);
    expect(isLive(flag({ expiresAt: BigInt(now - 1) }), now)).toBe(false);
  });
});

describe("withdrawBlocker (withdraw enable rule)", () => {
  it("enables withdraw only when credits are above zero", () => {
    expect(withdrawBlocker(1n)).toBeNull();
    expect(withdrawBlocker(0n)).toBe("You have nothing to withdraw.");
    expect(withdrawBlocker(undefined)).toMatch(/Reading/);
  });
});
