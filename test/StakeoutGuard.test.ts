import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Status } from "../shared/enums";

const FIXTURE_PARAMS = {
  minStake: ethers.parseEther("0.01"),
  flagDuration: 7n * 24n * 60n * 60n,
  maxMembersPerCall: 4n,
};

const ActorMode = { Accept: 0, Reject: 1, Reenter: 2 };

const randomHash = (): string => ethers.hexlify(ethers.randomBytes(32));
const randomAddress = (): string => ethers.Wallet.createRandom().address;

async function guardFixture() {
  const [, reviewer, verifier, reporter, sender, victim, reportedTarget, flaggedTarget, member, exitPoint, linked, clean] =
    await ethers.getSigners();
  const stakeout = await ethers.deployContract("Stakeout", [
    FIXTURE_PARAMS.minStake,
    FIXTURE_PARAMS.flagDuration,
    FIXTURE_PARAMS.maxMembersPerCall,
    reviewer.address,
    verifier.address,
  ]);
  const stakeoutAddress = await stakeout.getAddress();
  const guard = await ethers.deployContract("StakeoutGuard", [stakeoutAddress]);
  await stakeout.connect(reviewer).addVerifiedReporter(reporter.address);
  const minStake = await stakeout.minStake();

  const flagReport = async (target: string): Promise<void> => {
    const reportId = await stakeout.connect(victim).report.staticCall(target, randomHash());
    await stakeout.connect(victim).report(target, randomHash());
    await stakeout.connect(reporter).promote(reportId, { value: minStake });
  };

  await stakeout.connect(victim).report(reportedTarget.address, randomHash());
  await flagReport(flaggedTarget.address);
  await flagReport(member.address);
  const clusterId = randomHash();
  await stakeout.connect(verifier).confirm(clusterId, [member.address], [exitPoint.address], randomHash());
  await stakeout.connect(verifier).link(linked.address, clusterId, randomHash());

  return { stakeout, stakeoutAddress, guard, sender, reportedTarget, flaggedTarget, member, exitPoint, linked, clean };
}

describe("StakeoutGuard", function () {
  it("stores the Stakeout address and rejects the zero address", async function () {
    const { guard, stakeoutAddress } = await loadFixture(guardFixture);
    expect(await guard.stakeout()).to.equal(stakeoutAddress);
    await expect(ethers.deployContract("StakeoutGuard", [ethers.ZeroAddress]))
      .to.be.revertedWithCustomError(guard, "ZeroAddress");
  });

  it("blocks Confirmed members and exit points", async function () {
    const { guard, sender, member, exitPoint } = await loadFixture(guardFixture);
    for (const target of [member, exitPoint]) {
      expect(await guard.isAllowed(target.address)).to.equal(false);
      await expect(guard.connect(sender).sendTo(target.address, { value: 1n }))
        .to.be.revertedWithCustomError(guard, "Blocked")
        .withArgs(target.address, Status.Confirmed);
    }
  });

  it("blocks Linked addresses", async function () {
    const { guard, sender, linked } = await loadFixture(guardFixture);
    expect(await guard.isAllowed(linked.address)).to.equal(false);
    await expect(guard.connect(sender).sendTo(linked.address, { value: 1n }))
      .to.be.revertedWithCustomError(guard, "Blocked")
      .withArgs(linked.address, Status.Linked);
  });

  it("allows None, Reported, and Flagged and forwards the exact value", async function () {
    const { stakeout, guard, sender, clean, reportedTarget, flaggedTarget } = await loadFixture(guardFixture);
    const expected = [
      { target: clean, status: Status.None },
      { target: reportedTarget, status: Status.Reported },
      { target: flaggedTarget, status: Status.Flagged },
    ];
    const value = ethers.parseEther("0.25");
    for (const { target, status } of expected) {
      expect((await stakeout.getStatus(target.address)).status).to.equal(status);
      expect(await guard.isAllowed(target.address)).to.equal(true);
      await expect(guard.connect(sender).sendTo(target.address, { value })).to.changeEtherBalances(
        [sender, target, guard],
        [-value, value, 0n],
      );
    }
  });

  it("allows an address that has never been seen", async function () {
    const { guard } = await loadFixture(guardFixture);
    expect(await guard.isAllowed(randomAddress())).to.equal(true);
  });

  it("rejects the zero recipient", async function () {
    const { guard, sender } = await loadFixture(guardFixture);
    await expect(guard.connect(sender).sendTo(ethers.ZeroAddress, { value: 1n }))
      .to.be.revertedWithCustomError(guard, "ZeroAddress");
  });

  it("reverts with ForwardFailed when the receiver rejects ether", async function () {
    const { guard, sender, stakeoutAddress } = await loadFixture(guardFixture);
    const receiver = await ethers.deployContract("StakeoutActor", [stakeoutAddress]);
    await receiver.setMode(ActorMode.Reject);
    await expect(guard.connect(sender).sendTo(await receiver.getAddress(), { value: 1n }))
      .to.be.revertedWithCustomError(guard, "ForwardFailed");
  });

  it("blocks a reentrant sendTo from a malicious receiver", async function () {
    const { guard, sender, stakeoutAddress } = await loadFixture(guardFixture);
    const receiver = await ethers.deployContract("StakeoutActor", [stakeoutAddress]);
    const receiverAddress = await receiver.getAddress();
    await receiver.setMode(ActorMode.Reenter);
    await receiver.setReentry(await guard.getAddress(), guard.interface.encodeFunctionData("sendTo", [receiverAddress]));
    const value = ethers.parseEther("0.1");
    await expect(guard.connect(sender).sendTo(receiverAddress, { value })).to.changeEtherBalances(
      [sender, receiver, guard],
      [-value, value, 0n],
    );
    expect(await receiver.reentryAttempts()).to.equal(1n);
    const selector = guard.interface.getError("ReentrancyGuardReentrantCall")!.selector;
    expect(await receiver.reentryError()).to.equal(selector);
  });
});
