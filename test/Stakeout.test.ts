import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { Stakeout } from "../typechain-types";
import { Role, Status } from "../shared/enums";

const FIXTURE_PARAMS = {
  minStake: ethers.parseEther("0.01"),
  flagDuration: 7n * 24n * 60n * 60n,
  maxMembersPerCall: 4n,
};

const FlagState = { Active: 0n, Expired: 1n, Confirmed: 2n, Overturned: 3n };
const ActorMode = { Accept: 0, Reject: 1, Reenter: 2 };

const randomHash = (): string => ethers.hexlify(ethers.randomBytes(32));
const randomAddress = (): string => ethers.Wallet.createRandom().address;

async function deployFixture() {
  const [deployer, reviewer, verifier, reporterA, reporterB, outsider, victim, newVerifier] = await ethers.getSigners();
  const stakeout = await ethers.deployContract("Stakeout", [
    FIXTURE_PARAMS.minStake,
    FIXTURE_PARAMS.flagDuration,
    FIXTURE_PARAMS.maxMembersPerCall,
    reviewer.address,
    verifier.address,
  ]);
  await stakeout.connect(reviewer).addVerifiedReporter(reporterA.address);
  await stakeout.connect(reviewer).addVerifiedReporter(reporterB.address);
  const roles = {
    admin: await stakeout.DEFAULT_ADMIN_ROLE(),
    reviewer: await stakeout.REVIEWER_ROLE(),
    verifier: await stakeout.VERIFIER_ROLE(),
    reporter: await stakeout.REPORTER_ROLE(),
  };
  const minStake = await stakeout.minStake();
  const flagDuration = await stakeout.flagDuration();
  return { stakeout, roles, minStake, flagDuration, deployer, reviewer, verifier, reporterA, reporterB, outsider, victim, newVerifier };
}

async function fileReport(stakeout: Stakeout, from: HardhatEthersSigner, target: string): Promise<bigint> {
  const evidenceHash = randomHash();
  const reportId = await stakeout.connect(from).report.staticCall(target, evidenceHash);
  await stakeout.connect(from).report(target, evidenceHash);
  return reportId;
}

async function flagTarget(
  stakeout: Stakeout,
  reporter: HardhatEthersSigner,
  target: string,
  stake: bigint,
  from: HardhatEthersSigner = reporter,
): Promise<{ reportId: bigint; flagId: bigint }> {
  const reportId = await fileReport(stakeout, from, target);
  await stakeout.connect(reporter).promote(reportId, { value: stake });
  const flagId = (await stakeout.activeFlagOf(target)) - 1n;
  return { reportId, flagId };
}

async function nextTimestamp(): Promise<bigint> {
  const ts = BigInt(await time.latest()) + 1n;
  await time.setNextBlockTimestamp(ts);
  return ts;
}

async function flaggedClusterFixture() {
  const base = await deployFixture();
  const { stakeout, reporterA, victim, verifier, minStake } = base;
  const member = randomAddress();
  const exitPoint = randomAddress();
  const { flagId } = await flagTarget(stakeout, reporterA, member, minStake, victim);
  const clusterId = randomHash();
  const evidenceHash = randomHash();
  await stakeout.connect(verifier).confirm(clusterId, [member], [exitPoint], evidenceHash);
  return { ...base, member, exitPoint, flagId, clusterId, evidenceHash };
}

describe("Stakeout", function () {
  describe("constructor", function () {
    it("stores parameters and grants roles only to reviewer and verifier", async function () {
      const { stakeout, roles, deployer, reviewer, verifier } = await loadFixture(deployFixture);
      expect(await stakeout.minStake()).to.equal(FIXTURE_PARAMS.minStake);
      expect(await stakeout.flagDuration()).to.equal(FIXTURE_PARAMS.flagDuration);
      expect(await stakeout.maxMembersPerCall()).to.equal(FIXTURE_PARAMS.maxMembersPerCall);
      expect(await stakeout.hasRole(roles.admin, reviewer.address)).to.equal(true);
      expect(await stakeout.hasRole(roles.reviewer, reviewer.address)).to.equal(true);
      expect(await stakeout.hasRole(roles.verifier, verifier.address)).to.equal(true);
      expect(await stakeout.hasRole(roles.verifier, reviewer.address)).to.equal(false);
      for (const role of Object.values(roles)) {
        expect(await stakeout.hasRole(role, deployer.address)).to.equal(false);
      }
    });

    it("rejects zero values and zero addresses", async function () {
      const { reviewer, verifier, stakeout } = await loadFixture(deployFixture);
      const factory = await ethers.getContractFactory("Stakeout");
      const { minStake, flagDuration, maxMembersPerCall } = FIXTURE_PARAMS;
      await expect(factory.deploy(0n, flagDuration, maxMembersPerCall, reviewer.address, verifier.address))
        .to.be.revertedWithCustomError(stakeout, "ZeroValue");
      await expect(factory.deploy(minStake, 0n, maxMembersPerCall, reviewer.address, verifier.address))
        .to.be.revertedWithCustomError(stakeout, "ZeroValue");
      await expect(factory.deploy(minStake, flagDuration, 0n, reviewer.address, verifier.address))
        .to.be.revertedWithCustomError(stakeout, "ZeroValue");
      await expect(factory.deploy(minStake, flagDuration, maxMembersPerCall, ethers.ZeroAddress, verifier.address))
        .to.be.revertedWithCustomError(stakeout, "ZeroAddress");
      await expect(factory.deploy(minStake, flagDuration, maxMembersPerCall, reviewer.address, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(stakeout, "ZeroAddress");
    });
  });

  describe("report", function () {
    it("stores the report, counts it, and emits ReportSubmitted", async function () {
      const { stakeout, victim, outsider } = await loadFixture(deployFixture);
      const target = outsider.address;
      const evidenceHash = randomHash();
      const ts = await nextTimestamp();
      await expect(stakeout.connect(victim).report(target, evidenceHash))
        .to.emit(stakeout, "ReportSubmitted")
        .withArgs(0n, target, victim.address, evidenceHash);
      const stored = await stakeout.getReport(0n);
      expect(stored.reporter).to.equal(victim.address);
      expect(stored.target).to.equal(target);
      expect(stored.evidenceHash).to.equal(evidenceHash);
      expect(stored.createdAt).to.equal(ts);
      expect(await stakeout.reportCount(target)).to.equal(1n);
      expect(await fileReport(stakeout, victim, target)).to.equal(1n);
      expect(await stakeout.reportCount(target)).to.equal(2n);
    });

    it("rejects a zero target", async function () {
      const { stakeout, victim } = await loadFixture(deployFixture);
      await expect(stakeout.connect(victim).report(ethers.ZeroAddress, randomHash()))
        .to.be.revertedWithCustomError(stakeout, "ZeroAddress");
    });

    it("rejects a zero evidence hash", async function () {
      const { stakeout, victim } = await loadFixture(deployFixture);
      await expect(stakeout.connect(victim).report(randomAddress(), ethers.ZeroHash))
        .to.be.revertedWithCustomError(stakeout, "ZeroHash");
    });

    it("getReport reverts for an unknown id", async function () {
      const { stakeout } = await loadFixture(deployFixture);
      await expect(stakeout.getReport(0n)).to.be.revertedWithCustomError(stakeout, "ReportNotFound").withArgs(0n);
    });
  });

  describe("promote", function () {
    it("creates a flag and emits Promoted", async function () {
      const { stakeout, reporterA, victim, minStake, flagDuration } = await loadFixture(deployFixture);
      const target = randomAddress();
      const reportId = await fileReport(stakeout, victim, target);
      const stake = minStake * 2n;
      const ts = await nextTimestamp();
      const expiresAt = ts + flagDuration;
      await expect(stakeout.connect(reporterA).promote(reportId, { value: stake }))
        .to.emit(stakeout, "Promoted")
        .withArgs(0n, reportId, target, reporterA.address, stake, expiresAt);
      const flag = await stakeout.getFlag(0n);
      expect(flag.reportId).to.equal(reportId);
      expect(flag.target).to.equal(target);
      expect(flag.flagger).to.equal(reporterA.address);
      expect(flag.stake).to.equal(stake);
      expect(flag.expiresAt).to.equal(expiresAt);
      expect(flag.challenger).to.equal(ethers.ZeroAddress);
      expect(flag.challengeStake).to.equal(0n);
      expect(flag.state).to.equal(FlagState.Active);
      expect(await stakeout.activeFlagOf(target)).to.equal(1n);
      expect(await ethers.provider.getBalance(await stakeout.getAddress())).to.equal(stake);
    });

    it("rejects a caller without REPORTER_ROLE", async function () {
      const { stakeout, roles, outsider, victim, minStake } = await loadFixture(deployFixture);
      const reportId = await fileReport(stakeout, victim, randomAddress());
      await expect(stakeout.connect(outsider).promote(reportId, { value: minStake }))
        .to.be.revertedWithCustomError(stakeout, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, roles.reporter);
    });

    it("rejects a stake below the minimum", async function () {
      const { stakeout, reporterA, victim, minStake } = await loadFixture(deployFixture);
      const reportId = await fileReport(stakeout, victim, randomAddress());
      await expect(stakeout.connect(reporterA).promote(reportId, { value: minStake - 1n }))
        .to.be.revertedWithCustomError(stakeout, "StakeTooLow")
        .withArgs(minStake - 1n, minStake);
    });

    it("rejects a missing report", async function () {
      const { stakeout, reporterA, minStake } = await loadFixture(deployFixture);
      await expect(stakeout.connect(reporterA).promote(0n, { value: minStake }))
        .to.be.revertedWithCustomError(stakeout, "ReportNotFound")
        .withArgs(0n);
    });

    it("rejects a second flag while one is live", async function () {
      const { stakeout, reporterA, reporterB, victim, minStake } = await loadFixture(deployFixture);
      const target = randomAddress();
      await flagTarget(stakeout, reporterA, target, minStake, victim);
      const second = await fileReport(stakeout, victim, target);
      await expect(stakeout.connect(reporterB).promote(second, { value: minStake }))
        .to.be.revertedWithCustomError(stakeout, "TargetHasLiveFlag")
        .withArgs(target);
    });

    it("rejects a target already in a cluster", async function () {
      const { stakeout, reporterB, victim, member, exitPoint, minStake } = await loadFixture(flaggedClusterFixture);
      for (const target of [member, exitPoint]) {
        const reportId = await fileReport(stakeout, victim, target);
        await expect(stakeout.connect(reporterB).promote(reportId, { value: minStake }))
          .to.be.revertedWithCustomError(stakeout, "AlreadyInCluster")
          .withArgs(target);
      }
    });

    it("re-promotes after expire was called", async function () {
      const { stakeout, reporterA, reporterB, victim, minStake, flagDuration } = await loadFixture(deployFixture);
      const target = randomAddress();
      const { flagId, reportId } = await flagTarget(stakeout, reporterA, target, minStake, victim);
      await time.increase(flagDuration);
      await stakeout.expire(flagId);
      const tx = stakeout.connect(reporterB).promote(reportId, { value: minStake });
      await expect(tx).to.emit(stakeout, "Promoted");
      await expect(tx).not.to.emit(stakeout, "Expired");
      expect(await stakeout.activeFlagOf(target)).to.equal(flagId + 2n);
    });

    it("expires a stale flag automatically when re-promoting", async function () {
      const { stakeout, reporterA, reporterB, victim, minStake, flagDuration } = await loadFixture(deployFixture);
      const target = randomAddress();
      const stake = minStake * 3n;
      const { flagId, reportId } = await flagTarget(stakeout, reporterA, target, stake, victim);
      await time.increase(flagDuration);
      const tx = stakeout.connect(reporterB).promote(reportId, { value: minStake });
      await expect(tx).to.emit(stakeout, "Expired").withArgs(flagId, target);
      await expect(tx).to.emit(stakeout, "Promoted");
      expect((await stakeout.getFlag(flagId)).state).to.equal(FlagState.Expired);
      expect(await stakeout.credits(reporterA.address)).to.equal(stake);
      expect(await stakeout.activeFlagOf(target)).to.equal(flagId + 2n);
      await expect(stakeout.expire(flagId)).to.be.revertedWithCustomError(stakeout, "FlagNotActive").withArgs(flagId);
    });
  });

  describe("expire", function () {
    it("rejects an unknown flag", async function () {
      const { stakeout } = await loadFixture(deployFixture);
      await expect(stakeout.expire(0n)).to.be.revertedWithCustomError(stakeout, "FlagNotFound").withArgs(0n);
      await expect(stakeout.getFlag(0n)).to.be.revertedWithCustomError(stakeout, "FlagNotFound").withArgs(0n);
    });

    it("rejects expiring before the deadline", async function () {
      const { stakeout, reporterA, victim, minStake } = await loadFixture(deployFixture);
      const { flagId } = await flagTarget(stakeout, reporterA, randomAddress(), minStake, victim);
      const { expiresAt } = await stakeout.getFlag(flagId);
      await expect(stakeout.expire(flagId))
        .to.be.revertedWithCustomError(stakeout, "FlagNotDue")
        .withArgs(flagId, expiresAt);
    });

    it("cannot expire a challenged flag even after the deadline", async function () {
      const { stakeout, reporterA, reporterB, victim, minStake, flagDuration } = await loadFixture(deployFixture);
      const target = randomAddress();
      const { flagId } = await flagTarget(stakeout, reporterA, target, minStake, victim);
      await stakeout.connect(reporterB).challenge(flagId, { value: minStake });
      await time.increase(flagDuration * 2n);
      await expect(stakeout.expire(flagId)).to.be.revertedWithCustomError(stakeout, "FlagChallenged").withArgs(flagId);
      expect((await stakeout.getStatus(target)).status).to.equal(Status.Flagged);
    });

    it("rejects a flag that is no longer active", async function () {
      const { stakeout, flagId } = await loadFixture(flaggedClusterFixture);
      await expect(stakeout.expire(flagId)).to.be.revertedWithCustomError(stakeout, "FlagNotActive").withArgs(flagId);
    });

    it("shows Reported after the deadline before expire is called", async function () {
      const { stakeout, reporterA, victim, minStake, flagDuration } = await loadFixture(deployFixture);
      const target = randomAddress();
      const { flagId } = await flagTarget(stakeout, reporterA, target, minStake, victim);
      const { expiresAt } = await stakeout.getFlag(flagId);
      await time.increaseTo(expiresAt - 1n);
      expect((await stakeout.getStatus(target)).status).to.equal(Status.Flagged);
      await time.increase(flagDuration);
      const status = await stakeout.getStatus(target);
      expect(status.status).to.equal(Status.Reported);
      expect(status.expiresAt).to.equal(0n);
      expect((await stakeout.getFlag(flagId)).state).to.equal(FlagState.Active);
    });

    it("expires, credits the full stake, and refunds it through withdraw", async function () {
      const { stakeout, reporterA, victim, outsider, minStake } = await loadFixture(deployFixture);
      const target = randomAddress();
      const stake = minStake * 5n;
      const { flagId } = await flagTarget(stakeout, reporterA, target, stake, victim);
      const { expiresAt } = await stakeout.getFlag(flagId);
      await time.increaseTo(expiresAt);
      await expect(stakeout.connect(outsider).expire(flagId))
        .to.emit(stakeout, "Expired")
        .withArgs(flagId, target);
      expect((await stakeout.getFlag(flagId)).state).to.equal(FlagState.Expired);
      expect(await stakeout.activeFlagOf(target)).to.equal(0n);
      expect(await stakeout.credits(reporterA.address)).to.equal(stake);
      expect((await stakeout.getStatus(target)).status).to.equal(Status.Reported);
      await expect(stakeout.connect(reporterA).withdraw()).to.changeEtherBalances(
        [reporterA, stakeout],
        [stake, -stake],
      );
      expect(await stakeout.credits(reporterA.address)).to.equal(0n);
    });
  });

  describe("confirm", function () {
    it("rejects a caller without VERIFIER_ROLE", async function () {
      const { stakeout, roles, reviewer } = await loadFixture(deployFixture);
      await expect(stakeout.connect(reviewer).confirm(randomHash(), [randomAddress()], [], randomHash()))
        .to.be.revertedWithCustomError(stakeout, "AccessControlUnauthorizedAccount")
        .withArgs(reviewer.address, roles.verifier);
    });

    it("rejects a zero cluster id and a zero evidence hash", async function () {
      const { stakeout, verifier } = await loadFixture(deployFixture);
      await expect(stakeout.connect(verifier).confirm(ethers.ZeroHash, [randomAddress()], [], randomHash()))
        .to.be.revertedWithCustomError(stakeout, "ZeroClusterId");
      await expect(stakeout.connect(verifier).confirm(randomHash(), [randomAddress()], [], ethers.ZeroHash))
        .to.be.revertedWithCustomError(stakeout, "ZeroHash");
    });

    it("rejects an empty call and too many addresses", async function () {
      const { stakeout, verifier } = await loadFixture(deployFixture);
      const max = await stakeout.maxMembersPerCall();
      await expect(stakeout.connect(verifier).confirm(randomHash(), [], [], randomHash()))
        .to.be.revertedWithCustomError(stakeout, "InvalidAddressCount")
        .withArgs(0n, max);
      const members = Array.from({ length: Number(max) }, randomAddress);
      await expect(stakeout.connect(verifier).confirm(randomHash(), members, [randomAddress()], randomHash()))
        .to.be.revertedWithCustomError(stakeout, "InvalidAddressCount")
        .withArgs(max + 1n, max);
    });

    it("rejects when no member has a live flag", async function () {
      const { stakeout, verifier, reporterA, victim, minStake, flagDuration } = await loadFixture(deployFixture);
      const reportedOnly = randomAddress();
      await fileReport(stakeout, victim, reportedOnly);
      const timedOut = randomAddress();
      await flagTarget(stakeout, reporterA, timedOut, minStake, victim);
      await time.increase(flagDuration);
      await expect(stakeout.connect(verifier).confirm(randomHash(), [reportedOnly, timedOut], [], randomHash()))
        .to.be.revertedWithCustomError(stakeout, "NoLiveFlaggedMember");
    });

    it("does not count a flagged exit point as a live member", async function () {
      const { stakeout, verifier, reporterA, victim, minStake } = await loadFixture(deployFixture);
      const flaggedExit = randomAddress();
      await flagTarget(stakeout, reporterA, flaggedExit, minStake, victim);
      await expect(stakeout.connect(verifier).confirm(randomHash(), [randomAddress()], [flaggedExit], randomHash()))
        .to.be.revertedWithCustomError(stakeout, "NoLiveFlaggedMember");
    });

    it("rejects a member whose live flag is challenged", async function () {
      const { stakeout, verifier, reporterA, reporterB, victim, minStake } = await loadFixture(deployFixture);
      const live = randomAddress();
      const challenged = randomAddress();
      await flagTarget(stakeout, reporterA, live, minStake, victim);
      const { flagId } = await flagTarget(stakeout, reporterA, challenged, minStake, victim);
      await stakeout.connect(reporterB).challenge(flagId, { value: minStake });
      await expect(stakeout.connect(verifier).confirm(randomHash(), [live, challenged], [], randomHash()))
        .to.be.revertedWithCustomError(stakeout, "MemberFlagChallenged")
        .withArgs(challenged, flagId);
    });

    it("rejects duplicates within and across lists", async function () {
      const { stakeout, verifier, reporterA, victim, minStake } = await loadFixture(deployFixture);
      const member = randomAddress();
      await flagTarget(stakeout, reporterA, member, minStake, victim);
      const other = randomAddress();
      await expect(stakeout.connect(verifier).confirm(randomHash(), [member], [other, member], randomHash()))
        .to.be.revertedWithCustomError(stakeout, "DuplicateAddress")
        .withArgs(member);
      await expect(stakeout.connect(verifier).confirm(randomHash(), [member, other], [other], randomHash()))
        .to.be.revertedWithCustomError(stakeout, "DuplicateAddress")
        .withArgs(other);
      await expect(stakeout.connect(verifier).confirm(randomHash(), [member, member], [], randomHash()))
        .to.be.revertedWithCustomError(stakeout, "DuplicateAddress")
        .withArgs(member);
    });

    it("rejects zero addresses in either list", async function () {
      const { stakeout, verifier, reporterA, victim, minStake } = await loadFixture(deployFixture);
      const member = randomAddress();
      await flagTarget(stakeout, reporterA, member, minStake, victim);
      await expect(stakeout.connect(verifier).confirm(randomHash(), [member, ethers.ZeroAddress], [], randomHash()))
        .to.be.revertedWithCustomError(stakeout, "ZeroAddress");
      await expect(stakeout.connect(verifier).confirm(randomHash(), [member], [ethers.ZeroAddress], randomHash()))
        .to.be.revertedWithCustomError(stakeout, "ZeroAddress");
    });

    it("rejects addresses already in a cluster", async function () {
      const { stakeout, verifier, reporterA, victim, member, exitPoint, minStake } =
        await loadFixture(flaggedClusterFixture);
      const fresh = randomAddress();
      await flagTarget(stakeout, reporterA, fresh, minStake, victim);
      await expect(stakeout.connect(verifier).confirm(randomHash(), [fresh, member], [], randomHash()))
        .to.be.revertedWithCustomError(stakeout, "AlreadyInCluster")
        .withArgs(member);
      await expect(stakeout.connect(verifier).confirm(randomHash(), [fresh], [exitPoint], randomHash()))
        .to.be.revertedWithCustomError(stakeout, "AlreadyInCluster")
        .withArgs(exitPoint);
    });

    it("stores roles, confirms live flags, releases stakes, and emits Confirmed", async function () {
      const { stakeout, verifier, reporterA, reporterB, victim, minStake, flagDuration } =
        await loadFixture(deployFixture);
      const memberA = randomAddress();
      const memberB = randomAddress();
      const staleMember = randomAddress();
      const exitPoint = randomAddress();
      const stakeA = minStake * 2n;
      const stakeB = minStake * 3n;
      const stale = await flagTarget(stakeout, reporterA, staleMember, minStake, victim);
      await time.increase(flagDuration);
      const flagA = await flagTarget(stakeout, reporterA, memberA, stakeA, victim);
      const flagB = await flagTarget(stakeout, reporterB, memberB, stakeB, victim);
      const clusterId = randomHash();
      const evidenceHash = randomHash();
      const members = [memberA, memberB, staleMember];
      await expect(stakeout.connect(verifier).confirm(clusterId, members, [exitPoint], evidenceHash))
        .to.emit(stakeout, "Confirmed")
        .withArgs(clusterId, members, [exitPoint], evidenceHash);

      expect(await stakeout.clusterExists(clusterId)).to.equal(true);
      for (const member of members) {
        const entry = await stakeout.getClusterEntry(member);
        expect(entry.clusterId).to.equal(clusterId);
        expect(entry.role).to.equal(Role.Member);
        expect(entry.evidenceHash).to.equal(evidenceHash);
      }
      const exitEntry = await stakeout.getClusterEntry(exitPoint);
      expect(exitEntry.clusterId).to.equal(clusterId);
      expect(exitEntry.role).to.equal(Role.ExitPoint);
      expect(exitEntry.evidenceHash).to.equal(evidenceHash);

      expect((await stakeout.getFlag(flagA.flagId)).state).to.equal(FlagState.Confirmed);
      expect((await stakeout.getFlag(flagB.flagId)).state).to.equal(FlagState.Confirmed);
      expect((await stakeout.getFlag(stale.flagId)).state).to.equal(FlagState.Active);
      expect(await stakeout.activeFlagOf(memberA)).to.equal(0n);
      expect(await stakeout.activeFlagOf(memberB)).to.equal(0n);
      expect(await stakeout.credits(reporterA.address)).to.equal(stakeA);
      expect(await stakeout.credits(reporterB.address)).to.equal(stakeB);

      await expect(stakeout.connect(reporterB).withdraw()).to.changeEtherBalances(
        [reporterB, stakeout],
        [stakeB, -stakeB],
      );
      await stakeout.expire(stale.flagId);
      expect(await stakeout.credits(reporterA.address)).to.equal(stakeA + minStake);
    });
  });

  describe("link", function () {
    it("rejects a caller without VERIFIER_ROLE", async function () {
      const { stakeout, roles, outsider, clusterId } = await loadFixture(flaggedClusterFixture);
      await expect(stakeout.connect(outsider).link(randomAddress(), clusterId, randomHash()))
        .to.be.revertedWithCustomError(stakeout, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, roles.verifier);
    });

    it("rejects an unknown cluster", async function () {
      const { stakeout, verifier } = await loadFixture(flaggedClusterFixture);
      const unknown = randomHash();
      await expect(stakeout.connect(verifier).link(randomAddress(), unknown, randomHash()))
        .to.be.revertedWithCustomError(stakeout, "ClusterNotFound")
        .withArgs(unknown);
    });

    it("rejects a zero target, a zero hash, and a target already in a cluster", async function () {
      const { stakeout, verifier, clusterId, member } = await loadFixture(flaggedClusterFixture);
      await expect(stakeout.connect(verifier).link(ethers.ZeroAddress, clusterId, randomHash()))
        .to.be.revertedWithCustomError(stakeout, "ZeroAddress");
      await expect(stakeout.connect(verifier).link(randomAddress(), clusterId, ethers.ZeroHash))
        .to.be.revertedWithCustomError(stakeout, "ZeroHash");
      await expect(stakeout.connect(verifier).link(member, clusterId, randomHash()))
        .to.be.revertedWithCustomError(stakeout, "AlreadyInCluster")
        .withArgs(member);
    });

    it("links a target and emits Linked", async function () {
      const { stakeout, verifier, clusterId } = await loadFixture(flaggedClusterFixture);
      const target = randomAddress();
      const evidenceHash = randomHash();
      await expect(stakeout.connect(verifier).link(target, clusterId, evidenceHash))
        .to.emit(stakeout, "Linked")
        .withArgs(target, clusterId, evidenceHash);
      const entry = await stakeout.getClusterEntry(target);
      expect(entry.clusterId).to.equal(clusterId);
      expect(entry.role).to.equal(Role.Linked);
      expect(entry.evidenceHash).to.equal(evidenceHash);
    });
  });

  describe("challenge", function () {
    it("records the challenge and emits Challenged", async function () {
      const { stakeout, reporterA, reporterB, victim, minStake } = await loadFixture(deployFixture);
      const { flagId } = await flagTarget(stakeout, reporterA, randomAddress(), minStake, victim);
      const stake = minStake * 2n;
      await expect(stakeout.connect(reporterB).challenge(flagId, { value: stake }))
        .to.emit(stakeout, "Challenged")
        .withArgs(flagId, reporterB.address, stake);
      const flag = await stakeout.getFlag(flagId);
      expect(flag.challenger).to.equal(reporterB.address);
      expect(flag.challengeStake).to.equal(stake);
    });

    it("rejects a caller without REPORTER_ROLE", async function () {
      const { stakeout, roles, reporterA, outsider, victim, minStake } = await loadFixture(deployFixture);
      const { flagId } = await flagTarget(stakeout, reporterA, randomAddress(), minStake, victim);
      await expect(stakeout.connect(outsider).challenge(flagId, { value: minStake }))
        .to.be.revertedWithCustomError(stakeout, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, roles.reporter);
    });

    it("rejects the flagger", async function () {
      const { stakeout, reporterA, victim, minStake } = await loadFixture(deployFixture);
      const { flagId } = await flagTarget(stakeout, reporterA, randomAddress(), minStake, victim);
      await expect(stakeout.connect(reporterA).challenge(flagId, { value: minStake }))
        .to.be.revertedWithCustomError(stakeout, "FlaggerCannotChallenge")
        .withArgs(flagId);
    });

    it("rejects a stake below the minimum", async function () {
      const { stakeout, reporterA, reporterB, victim, minStake } = await loadFixture(deployFixture);
      const { flagId } = await flagTarget(stakeout, reporterA, randomAddress(), minStake, victim);
      await expect(stakeout.connect(reporterB).challenge(flagId, { value: minStake - 1n }))
        .to.be.revertedWithCustomError(stakeout, "StakeTooLow")
        .withArgs(minStake - 1n, minStake);
    });

    it("rejects a second challenge", async function () {
      const { stakeout, reviewer, reporterA, reporterB, victim, outsider, minStake } = await loadFixture(deployFixture);
      const { flagId } = await flagTarget(stakeout, reporterA, randomAddress(), minStake, victim);
      await stakeout.connect(reporterB).challenge(flagId, { value: minStake });
      await stakeout.connect(reviewer).addVerifiedReporter(outsider.address);
      await expect(stakeout.connect(outsider).challenge(flagId, { value: minStake }))
        .to.be.revertedWithCustomError(stakeout, "AlreadyChallenged")
        .withArgs(flagId);
    });

    it("rejects flags that are not live", async function () {
      const { stakeout, reporterA, reporterB, victim, minStake, flagDuration } = await loadFixture(deployFixture);
      const { flagId } = await flagTarget(stakeout, reporterA, randomAddress(), minStake, victim);
      await time.increase(flagDuration);
      await expect(stakeout.connect(reporterB).challenge(flagId, { value: minStake }))
        .to.be.revertedWithCustomError(stakeout, "FlagNotLive")
        .withArgs(flagId);
      await stakeout.expire(flagId);
      await expect(stakeout.connect(reporterB).challenge(flagId, { value: minStake }))
        .to.be.revertedWithCustomError(stakeout, "FlagNotLive")
        .withArgs(flagId);
      await expect(stakeout.connect(reporterB).challenge(flagId + 1n, { value: minStake }))
        .to.be.revertedWithCustomError(stakeout, "FlagNotFound")
        .withArgs(flagId + 1n);
    });
  });

  describe("resolve", function () {
    async function challengedFixture() {
      const base = await deployFixture();
      const { stakeout, reporterA, reporterB, victim, minStake } = base;
      const target = randomAddress();
      const flagStake = minStake * 2n;
      const challengeStake = minStake * 3n;
      const { flagId } = await flagTarget(stakeout, reporterA, target, flagStake, victim);
      await stakeout.connect(reporterB).challenge(flagId, { value: challengeStake });
      return { ...base, target, flagId, flagStake, challengeStake };
    }

    it("rejects a caller without REVIEWER_ROLE", async function () {
      const { stakeout, roles, verifier, flagId } = await loadFixture(challengedFixture);
      await expect(stakeout.connect(verifier).resolve(flagId, true))
        .to.be.revertedWithCustomError(stakeout, "AccessControlUnauthorizedAccount")
        .withArgs(verifier.address, roles.reviewer);
    });

    it("rejects an unchallenged flag and an inactive flag", async function () {
      const { stakeout, reviewer, reporterA, victim, minStake, flagId } = await loadFixture(challengedFixture);
      const unchallenged = await flagTarget(stakeout, reporterA, randomAddress(), minStake, victim);
      await expect(stakeout.connect(reviewer).resolve(unchallenged.flagId, true))
        .to.be.revertedWithCustomError(stakeout, "FlagNotChallenged")
        .withArgs(unchallenged.flagId);
      await stakeout.connect(reviewer).resolve(flagId, false);
      await expect(stakeout.connect(reviewer).resolve(flagId, false))
        .to.be.revertedWithCustomError(stakeout, "FlagNotActive")
        .withArgs(flagId);
    });

    it("upholds the flag: challenger stake to the pool and a fresh deadline", async function () {
      const { stakeout, reviewer, reporterA, reporterB, target, flagId, flagStake, challengeStake, flagDuration } =
        await loadFixture(challengedFixture);
      const poolBefore = await stakeout.rewardPool();
      await time.increase(flagDuration * 2n);
      const ts = await nextTimestamp();
      await expect(stakeout.connect(reviewer).resolve(flagId, true))
        .to.emit(stakeout, "Resolved")
        .withArgs(flagId, true);
      expect(await stakeout.rewardPool()).to.equal(poolBefore + challengeStake);
      expect(await stakeout.credits(reporterA.address)).to.equal(0n);
      expect(await stakeout.credits(reporterB.address)).to.equal(0n);
      const flag = await stakeout.getFlag(flagId);
      expect(flag.state).to.equal(FlagState.Active);
      expect(flag.challenger).to.equal(ethers.ZeroAddress);
      expect(flag.challengeStake).to.equal(0n);
      expect(flag.expiresAt).to.equal(ts + flagDuration);
      const status = await stakeout.getStatus(target);
      expect(status.status).to.equal(Status.Flagged);
      expect(status.expiresAt).to.equal(ts + flagDuration);
      await time.increaseTo(flag.expiresAt);
      await stakeout.expire(flagId);
      expect(await stakeout.credits(reporterA.address)).to.equal(flagStake);
      expect(await ethers.provider.getBalance(await stakeout.getAddress())).to.equal(flagStake + challengeStake);
    });

    it("overturns the flag: flagger stake to the pool and challenger refunded", async function () {
      const { stakeout, reviewer, reporterA, reporterB, target, flagId, flagStake, challengeStake } =
        await loadFixture(challengedFixture);
      const poolBefore = await stakeout.rewardPool();
      await expect(stakeout.connect(reviewer).resolve(flagId, false))
        .to.emit(stakeout, "Resolved")
        .withArgs(flagId, false);
      expect(await stakeout.rewardPool()).to.equal(poolBefore + flagStake);
      expect(await stakeout.credits(reporterB.address)).to.equal(challengeStake);
      expect(await stakeout.credits(reporterA.address)).to.equal(0n);
      expect((await stakeout.getFlag(flagId)).state).to.equal(FlagState.Overturned);
      expect(await stakeout.activeFlagOf(target)).to.equal(0n);
      expect((await stakeout.getStatus(target)).status).to.equal(Status.Reported);
      await expect(stakeout.connect(reporterB).withdraw()).to.changeEtherBalances(
        [reporterB, stakeout],
        [challengeStake, -challengeStake],
      );
      expect(await ethers.provider.getBalance(await stakeout.getAddress())).to.equal(flagStake);
    });
  });

  describe("removeMember", function () {
    it("rejects a caller without REVIEWER_ROLE", async function () {
      const { stakeout, roles, verifier, member } = await loadFixture(flaggedClusterFixture);
      await expect(stakeout.connect(verifier).removeMember(member))
        .to.be.revertedWithCustomError(stakeout, "AccessControlUnauthorizedAccount")
        .withArgs(verifier.address, roles.reviewer);
    });

    it("rejects an address that is not in a cluster", async function () {
      const { stakeout, reviewer } = await loadFixture(flaggedClusterFixture);
      const target = randomAddress();
      await expect(stakeout.connect(reviewer).removeMember(target))
        .to.be.revertedWithCustomError(stakeout, "NotInCluster")
        .withArgs(target);
    });

    it("removes the entry and emits MemberRemoved", async function () {
      const { stakeout, reviewer, member, clusterId } = await loadFixture(flaggedClusterFixture);
      await expect(stakeout.connect(reviewer).removeMember(member))
        .to.emit(stakeout, "MemberRemoved")
        .withArgs(member, clusterId);
      const entry = await stakeout.getClusterEntry(member);
      expect(entry.role).to.equal(Role.None);
      expect(entry.clusterId).to.equal(ethers.ZeroHash);
    });
  });

  describe("roles", function () {
    it("addVerifiedReporter grants REPORTER_ROLE and emits RoleGranted", async function () {
      const { stakeout, roles, reviewer, outsider } = await loadFixture(deployFixture);
      await expect(stakeout.connect(reviewer).addVerifiedReporter(outsider.address))
        .to.emit(stakeout, "RoleGranted")
        .withArgs(roles.reporter, outsider.address, reviewer.address);
      expect(await stakeout.hasRole(roles.reporter, outsider.address)).to.equal(true);
    });

    it("addVerifiedReporter rejects non-reviewers and the zero address", async function () {
      const { stakeout, roles, reviewer, outsider } = await loadFixture(deployFixture);
      await expect(stakeout.connect(outsider).addVerifiedReporter(outsider.address))
        .to.be.revertedWithCustomError(stakeout, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, roles.reviewer);
      await expect(stakeout.connect(reviewer).addVerifiedReporter(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(stakeout, "ZeroAddress");
    });

    it("the reviewer removes a reporter with revokeRole", async function () {
      const { stakeout, roles, reviewer, reporterA, victim, minStake } = await loadFixture(deployFixture);
      await expect(stakeout.connect(reviewer).revokeRole(roles.reporter, reporterA.address))
        .to.emit(stakeout, "RoleRevoked")
        .withArgs(roles.reporter, reporterA.address, reviewer.address);
      const reportId = await fileReport(stakeout, victim, randomAddress());
      await expect(stakeout.connect(reporterA).promote(reportId, { value: minStake }))
        .to.be.revertedWithCustomError(stakeout, "AccessControlUnauthorizedAccount")
        .withArgs(reporterA.address, roles.reporter);
    });

    it("the reviewer rotates the verifier with grantRole and revokeRole", async function () {
      const { stakeout, roles, reviewer, verifier, newVerifier, reporterA, victim, minStake } =
        await loadFixture(deployFixture);
      await expect(stakeout.connect(verifier).grantRole(roles.verifier, newVerifier.address))
        .to.be.revertedWithCustomError(stakeout, "AccessControlUnauthorizedAccount")
        .withArgs(verifier.address, roles.admin);
      await stakeout.connect(reviewer).grantRole(roles.verifier, newVerifier.address);
      await stakeout.connect(reviewer).revokeRole(roles.verifier, verifier.address);
      const member = randomAddress();
      await flagTarget(stakeout, reporterA, member, minStake, victim);
      await expect(stakeout.connect(verifier).confirm(randomHash(), [member], [], randomHash()))
        .to.be.revertedWithCustomError(stakeout, "AccessControlUnauthorizedAccount")
        .withArgs(verifier.address, roles.verifier);
      await expect(stakeout.connect(newVerifier).confirm(randomHash(), [member], [], randomHash()))
        .to.emit(stakeout, "Confirmed");
    });
  });

  describe("withdraw", function () {
    async function actorFixture() {
      const base = await deployFixture();
      const { stakeout, reviewer, victim, minStake, flagDuration } = base;
      const actor = await ethers.deployContract("StakeoutActor", [await stakeout.getAddress()]);
      await stakeout.connect(reviewer).addVerifiedReporter(await actor.getAddress());
      const target = randomAddress();
      const reportId = await fileReport(stakeout, victim, target);
      const stake = minStake * 2n;
      await actor.promote(reportId, { value: stake });
      const flagId = (await stakeout.activeFlagOf(target)) - 1n;
      await time.increase(flagDuration);
      await stakeout.expire(flagId);
      return { ...base, actor, stake };
    }

    it("rejects a caller with no credit", async function () {
      const { stakeout, outsider } = await loadFixture(deployFixture);
      await expect(stakeout.connect(outsider).withdraw()).to.be.revertedWithCustomError(stakeout, "NoCredit");
    });

    it("pays out and emits Withdrawn", async function () {
      const { stakeout, actor, stake } = await loadFixture(actorFixture);
      const actorAddress = await actor.getAddress();
      const tx = actor.withdraw();
      await expect(tx).to.emit(stakeout, "Withdrawn").withArgs(actorAddress, stake);
      await expect(tx).to.changeEtherBalances([actor, stakeout], [stake, -stake]);
      expect(await stakeout.credits(actorAddress)).to.equal(0n);
    });

    it("reverts with TransferFailed when the receiver rejects ether and keeps the credit", async function () {
      const { stakeout, actor, stake } = await loadFixture(actorFixture);
      await actor.setMode(ActorMode.Reject);
      await expect(actor.withdraw()).to.be.revertedWithCustomError(stakeout, "TransferFailed");
      expect(await stakeout.credits(await actor.getAddress())).to.equal(stake);
    });

    it("blocks a reentrant withdraw from a malicious receiver", async function () {
      const { stakeout, actor, stake } = await loadFixture(actorFixture);
      await actor.setMode(ActorMode.Reenter);
      await actor.setReentry(await stakeout.getAddress(), stakeout.interface.encodeFunctionData("withdraw"));
      await expect(actor.withdraw()).to.changeEtherBalances([actor, stakeout], [stake, -stake]);
      expect(await actor.reentryAttempts()).to.equal(1n);
      const selector = stakeout.interface.getError("ReentrancyGuardReentrantCall")!.selector;
      expect(await actor.reentryError()).to.equal(selector);
      expect(await stakeout.credits(await actor.getAddress())).to.equal(0n);
    });
  });

  describe("payReward", function () {
    async function slashedPoolFixture() {
      const base = await deployFixture();
      const { stakeout, reviewer, reporterA, reporterB, victim, minStake } = base;
      const flagStake = minStake * 4n;
      const challengeStake = minStake * 2n;
      const { flagId } = await flagTarget(stakeout, reporterA, randomAddress(), flagStake, victim);
      await stakeout.connect(reporterB).challenge(flagId, { value: challengeStake });
      await stakeout.connect(reviewer).resolve(flagId, false);
      return { ...base, flagStake, challengeStake };
    }

    it("rejects a caller without REVIEWER_ROLE", async function () {
      const { stakeout, roles, verifier, outsider } = await loadFixture(slashedPoolFixture);
      await expect(stakeout.connect(verifier).payReward(outsider.address, 1n))
        .to.be.revertedWithCustomError(stakeout, "AccessControlUnauthorizedAccount")
        .withArgs(verifier.address, roles.reviewer);
    });

    it("rejects a zero recipient and a zero amount", async function () {
      const { stakeout, reviewer, outsider } = await loadFixture(slashedPoolFixture);
      await expect(stakeout.connect(reviewer).payReward(ethers.ZeroAddress, 1n))
        .to.be.revertedWithCustomError(stakeout, "ZeroAddress");
      await expect(stakeout.connect(reviewer).payReward(outsider.address, 0n))
        .to.be.revertedWithCustomError(stakeout, "ZeroValue");
    });

    it("rejects an amount above the reward pool with the requested amount and the pool", async function () {
      const { stakeout, reviewer, outsider } = await loadFixture(slashedPoolFixture);
      const pool = await stakeout.rewardPool();
      await expect(stakeout.connect(reviewer).payReward(outsider.address, pool + 1n))
        .to.be.revertedWithCustomError(stakeout, "RewardExceedsPool")
        .withArgs(pool + 1n, pool);
    });

    it("moves the exact amount from the pool to the recipient's credit and emits RewardPaid", async function () {
      const { stakeout, reviewer, outsider, flagStake } = await loadFixture(slashedPoolFixture);
      expect(await stakeout.rewardPool()).to.equal(flagStake);
      const amount = flagStake / 4n;
      await expect(stakeout.connect(reviewer).payReward(outsider.address, amount))
        .to.emit(stakeout, "RewardPaid")
        .withArgs(outsider.address, amount);
      expect(await stakeout.rewardPool()).to.equal(flagStake - amount);
      expect(await stakeout.credits(outsider.address)).to.equal(amount);
      await stakeout.connect(reviewer).payReward(outsider.address, flagStake - amount);
      expect(await stakeout.rewardPool()).to.equal(0n);
      expect(await stakeout.credits(outsider.address)).to.equal(flagStake);
    });

    it("runs the full flow: challenge, resolve with a slash, payReward, withdraw", async function () {
      const { stakeout, reviewer, reporterA, reporterB, outsider, flagStake, challengeStake } =
        await loadFixture(slashedPoolFixture);
      expect(await stakeout.credits(reporterA.address)).to.equal(0n);
      expect(await stakeout.credits(reporterB.address)).to.equal(challengeStake);
      await stakeout.connect(reviewer).payReward(outsider.address, flagStake);
      const withdrawal = stakeout.connect(outsider).withdraw();
      await expect(withdrawal).to.emit(stakeout, "Withdrawn").withArgs(outsider.address, flagStake);
      await expect(withdrawal).to.changeEtherBalances([outsider, stakeout], [flagStake, -flagStake]);
      expect(await stakeout.credits(outsider.address)).to.equal(0n);
      expect(await stakeout.rewardPool()).to.equal(0n);
      await stakeout.connect(reporterB).withdraw();
      expect(await ethers.provider.getBalance(await stakeout.getAddress())).to.equal(0n);
    });
  });

  describe("getStatus", function () {
    it("returns None for an unknown address and the zero address", async function () {
      const { stakeout } = await loadFixture(deployFixture);
      for (const account of [randomAddress(), ethers.ZeroAddress]) {
        const status = await stakeout.getStatus(account);
        expect(status.status).to.equal(Status.None);
        expect(status.clusterId).to.equal(ethers.ZeroHash);
        expect(status.role).to.equal(Role.None);
        expect(status.expiresAt).to.equal(0n);
      }
    });

    it("returns Reported for a reported address", async function () {
      const { stakeout, victim } = await loadFixture(deployFixture);
      const target = randomAddress();
      await fileReport(stakeout, victim, target);
      const status = await stakeout.getStatus(target);
      expect(status.status).to.equal(Status.Reported);
      expect(status.role).to.equal(Role.None);
    });

    it("returns Flagged with the deadline for a live flag", async function () {
      const { stakeout, reporterA, victim, minStake } = await loadFixture(deployFixture);
      const target = randomAddress();
      const { flagId } = await flagTarget(stakeout, reporterA, target, minStake, victim);
      const status = await stakeout.getStatus(target);
      expect(status.status).to.equal(Status.Flagged);
      expect(status.clusterId).to.equal(ethers.ZeroHash);
      expect(status.expiresAt).to.equal((await stakeout.getFlag(flagId)).expiresAt);
    });

    it("returns Reported for an expired flag", async function () {
      const { stakeout, reporterA, victim, minStake, flagDuration } = await loadFixture(deployFixture);
      const target = randomAddress();
      const { flagId } = await flagTarget(stakeout, reporterA, target, minStake, victim);
      await time.increase(flagDuration);
      await stakeout.expire(flagId);
      expect((await stakeout.getStatus(target)).status).to.equal(Status.Reported);
    });

    it("returns Confirmed for members and exit points with their cluster and role", async function () {
      const { stakeout, member, exitPoint, clusterId } = await loadFixture(flaggedClusterFixture);
      const memberStatus = await stakeout.getStatus(member);
      expect(memberStatus.status).to.equal(Status.Confirmed);
      expect(memberStatus.clusterId).to.equal(clusterId);
      expect(memberStatus.role).to.equal(Role.Member);
      expect(memberStatus.expiresAt).to.equal(0n);
      const exitStatus = await stakeout.getStatus(exitPoint);
      expect(exitStatus.status).to.equal(Status.Confirmed);
      expect(exitStatus.clusterId).to.equal(clusterId);
      expect(exitStatus.role).to.equal(Role.ExitPoint);
    });

    it("returns Linked for a linked address", async function () {
      const { stakeout, verifier, clusterId } = await loadFixture(flaggedClusterFixture);
      const target = randomAddress();
      await stakeout.connect(verifier).link(target, clusterId, randomHash());
      const status = await stakeout.getStatus(target);
      expect(status.status).to.equal(Status.Linked);
      expect(status.clusterId).to.equal(clusterId);
      expect(status.role).to.equal(Role.Linked);
    });

    it("falls back after removal: Reported if reported, otherwise None", async function () {
      const { stakeout, reviewer, member, exitPoint } = await loadFixture(flaggedClusterFixture);
      await stakeout.connect(reviewer).removeMember(member);
      await stakeout.connect(reviewer).removeMember(exitPoint);
      expect((await stakeout.getStatus(member)).status).to.equal(Status.Reported);
      expect((await stakeout.getStatus(exitPoint)).status).to.equal(Status.None);
    });
  });
});
