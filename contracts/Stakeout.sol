// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Stakeout is AccessControl, ReentrancyGuard {
    enum Status {
        None,
        Reported,
        Flagged,
        Confirmed,
        Linked
    }

    enum Role {
        None,
        Member,
        ExitPoint,
        Linked
    }

    enum FlagState {
        Active,
        Expired,
        Confirmed,
        Overturned
    }

    struct Report {
        address reporter;
        address target;
        bytes32 evidenceHash;
        uint64 createdAt;
    }

    struct Flag {
        uint256 reportId;
        address target;
        address flagger;
        uint256 stake;
        uint64 expiresAt;
        address challenger;
        uint256 challengeStake;
        FlagState state;
    }

    struct ClusterEntry {
        bytes32 clusterId;
        Role role;
        bytes32 evidenceHash;
    }

    bytes32 public constant REVIEWER_ROLE = keccak256("REVIEWER_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant REPORTER_ROLE = keccak256("REPORTER_ROLE");

    uint256 public immutable minStake;
    uint64 public immutable flagDuration;
    uint256 public immutable maxMembersPerCall;

    Report[] private _reports;
    Flag[] private _flags;
    mapping(address => ClusterEntry) private _clusterOf;

    mapping(address => uint256) public reportCount;
    mapping(address => uint256) public activeFlagOf;
    mapping(bytes32 => bool) public clusterExists;
    mapping(address => uint256) public credits;
    uint256 public rewardPool;

    event ReportSubmitted(
        uint256 indexed reportId,
        address indexed target,
        address indexed reporter,
        bytes32 evidenceHash
    );
    event Promoted(
        uint256 indexed flagId,
        uint256 indexed reportId,
        address indexed target,
        address flagger,
        uint256 stake,
        uint64 expiresAt
    );
    event Expired(uint256 indexed flagId, address indexed target);
    event Confirmed(bytes32 indexed clusterId, address[] members, address[] exitPoints, bytes32 evidenceHash);
    event Linked(address indexed target, bytes32 indexed clusterId, bytes32 evidenceHash);
    event Challenged(uint256 indexed flagId, address indexed challenger, uint256 stake);
    event Resolved(uint256 indexed flagId, bool flagUpheld);
    event MemberRemoved(address indexed target, bytes32 indexed clusterId);
    event Withdrawn(address indexed account, uint256 amount);

    error ZeroValue();
    error ZeroAddress();
    error ZeroHash();
    error ZeroClusterId();
    error StakeTooLow(uint256 sent, uint256 required);
    error ReportNotFound(uint256 reportId);
    error FlagNotFound(uint256 flagId);
    error TargetHasLiveFlag(address target);
    error AlreadyInCluster(address account);
    error NotInCluster(address account);
    error ClusterNotFound(bytes32 clusterId);
    error FlagNotActive(uint256 flagId);
    error FlagChallenged(uint256 flagId);
    error FlagNotDue(uint256 flagId, uint64 expiresAt);
    error FlagNotLive(uint256 flagId);
    error AlreadyChallenged(uint256 flagId);
    error FlaggerCannotChallenge(uint256 flagId);
    error FlagNotChallenged(uint256 flagId);
    error InvalidAddressCount(uint256 count, uint256 max);
    error DuplicateAddress(address account);
    error MemberFlagChallenged(address member, uint256 flagId);
    error NoLiveFlaggedMember();
    error NoCredit();
    error TransferFailed();

    constructor(
        uint256 minStake_,
        uint64 flagDuration_,
        uint256 maxMembersPerCall_,
        address reviewer,
        address verifier
    ) {
        if (minStake_ == 0 || flagDuration_ == 0 || maxMembersPerCall_ == 0) revert ZeroValue();
        if (reviewer == address(0) || verifier == address(0)) revert ZeroAddress();
        minStake = minStake_;
        flagDuration = flagDuration_;
        maxMembersPerCall = maxMembersPerCall_;
        _grantRole(DEFAULT_ADMIN_ROLE, reviewer);
        _grantRole(REVIEWER_ROLE, reviewer);
        _grantRole(VERIFIER_ROLE, verifier);
    }

    /// @notice Files a free report against a target address and returns its id.
    function report(address target, bytes32 evidenceHash) external returns (uint256 reportId) {
        if (target == address(0)) revert ZeroAddress();
        if (evidenceHash == bytes32(0)) revert ZeroHash();
        reportId = _reports.length;
        _reports.push(Report(msg.sender, target, evidenceHash, uint64(block.timestamp)));
        ++reportCount[target];
        emit ReportSubmitted(reportId, target, msg.sender, evidenceHash);
    }

    /// @notice Stakes on an existing report to raise a time-limited flag on its target.
    function promote(uint256 reportId) external payable onlyRole(REPORTER_ROLE) {
        if (msg.value < minStake) revert StakeTooLow(msg.value, minStake);
        if (reportId >= _reports.length) revert ReportNotFound(reportId);
        address target = _reports[reportId].target;
        if (_clusterOf[target].role != Role.None) revert AlreadyInCluster(target);
        uint256 slot = activeFlagOf[target];
        if (slot != 0) {
            Flag storage previous = _flags[slot - 1];
            if (_isLive(previous)) revert TargetHasLiveFlag(target);
            _expire(slot - 1, previous);
        }
        uint256 flagId = _flags.length;
        uint64 expiresAt = uint64(block.timestamp) + flagDuration;
        _flags.push(
            Flag({
                reportId: reportId,
                target: target,
                flagger: msg.sender,
                stake: msg.value,
                expiresAt: expiresAt,
                challenger: address(0),
                challengeStake: 0,
                state: FlagState.Active
            })
        );
        activeFlagOf[target] = flagId + 1;
        emit Promoted(flagId, reportId, target, msg.sender, msg.value, expiresAt);
    }

    /// @notice Lapses an unchallenged flag past its deadline and credits the full stake back to the flagger.
    function expire(uint256 flagId) external {
        Flag storage flag = _flagAt(flagId);
        if (flag.state != FlagState.Active) revert FlagNotActive(flagId);
        if (flag.challenger != address(0)) revert FlagChallenged(flagId);
        if (block.timestamp < flag.expiresAt) revert FlagNotDue(flagId, flag.expiresAt);
        _expire(flagId, flag);
    }

    /// @notice Records a scam cluster whose members include at least one live, unchallenged flag.
    function confirm(
        bytes32 clusterId,
        address[] calldata members,
        address[] calldata exitPoints,
        bytes32 evidenceHash
    ) external onlyRole(VERIFIER_ROLE) {
        if (clusterId == bytes32(0)) revert ZeroClusterId();
        if (evidenceHash == bytes32(0)) revert ZeroHash();
        uint256 total = members.length + exitPoints.length;
        if (total == 0 || total > maxMembersPerCall) revert InvalidAddressCount(total, maxMembersPerCall);
        _requireUnique(members, exitPoints);

        bool hasLiveFlag = false;
        for (uint256 i = 0; i < members.length; ++i) {
            address member = members[i];
            _addToCluster(member, clusterId, Role.Member, evidenceHash);
            if (_confirmFlagOf(member)) hasLiveFlag = true;
        }
        if (!hasLiveFlag) revert NoLiveFlaggedMember();
        for (uint256 i = 0; i < exitPoints.length; ++i) {
            _addToCluster(exitPoints[i], clusterId, Role.ExitPoint, evidenceHash);
        }
        clusterExists[clusterId] = true;
        emit Confirmed(clusterId, members, exitPoints, evidenceHash);
    }

    /// @notice Adds one address to an existing cluster with the Linked role.
    function link(address target, bytes32 clusterId, bytes32 evidenceHash) external onlyRole(VERIFIER_ROLE) {
        if (!clusterExists[clusterId]) revert ClusterNotFound(clusterId);
        if (evidenceHash == bytes32(0)) revert ZeroHash();
        _addToCluster(target, clusterId, Role.Linked, evidenceHash);
        emit Linked(target, clusterId, evidenceHash);
    }

    /// @notice Stakes against a live flag, pausing its expiry until a reviewer resolves it.
    function challenge(uint256 flagId) external payable onlyRole(REPORTER_ROLE) {
        Flag storage flag = _flagAt(flagId);
        if (!_isLive(flag)) revert FlagNotLive(flagId);
        if (flag.challenger != address(0)) revert AlreadyChallenged(flagId);
        if (msg.sender == flag.flagger) revert FlaggerCannotChallenge(flagId);
        if (msg.value < minStake) revert StakeTooLow(msg.value, minStake);
        flag.challenger = msg.sender;
        flag.challengeStake = msg.value;
        emit Challenged(flagId, msg.sender, msg.value);
    }

    /// @notice Settles a challenged flag, sending the losing stake to the reward pool.
    function resolve(uint256 flagId, bool flagUpheld) external onlyRole(REVIEWER_ROLE) {
        Flag storage flag = _flagAt(flagId);
        if (flag.state != FlagState.Active) revert FlagNotActive(flagId);
        if (flag.challenger == address(0)) revert FlagNotChallenged(flagId);
        if (flagUpheld) {
            rewardPool += flag.challengeStake;
            flag.challenger = address(0);
            flag.challengeStake = 0;
            flag.expiresAt = uint64(block.timestamp) + flagDuration;
        } else {
            rewardPool += flag.stake;
            credits[flag.challenger] += flag.challengeStake;
            flag.state = FlagState.Overturned;
            delete activeFlagOf[flag.target];
        }
        emit Resolved(flagId, flagUpheld);
    }

    /// @notice Removes an address from its cluster.
    function removeMember(address target) external onlyRole(REVIEWER_ROLE) {
        ClusterEntry storage entry = _clusterOf[target];
        if (entry.role == Role.None) revert NotInCluster(target);
        bytes32 clusterId = entry.clusterId;
        delete _clusterOf[target];
        emit MemberRemoved(target, clusterId);
    }

    /// @notice Whitelists an account as a verified reporter.
    function addVerifiedReporter(address account) external onlyRole(REVIEWER_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        _grantRole(REPORTER_ROLE, account);
    }

    /// @notice Pays out the caller's accumulated credit.
    function withdraw() external nonReentrant {
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NoCredit();
        credits[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        if (!sent) revert TransferFailed();
    }

    /// @notice Returns the status of an address without ever reverting.
    function getStatus(
        address account
    ) external view returns (Status status, bytes32 clusterId, Role role, uint64 expiresAt) {
        ClusterEntry storage entry = _clusterOf[account];
        if (entry.role != Role.None) {
            status = entry.role == Role.Linked ? Status.Linked : Status.Confirmed;
            return (status, entry.clusterId, entry.role, 0);
        }
        uint256 slot = activeFlagOf[account];
        if (slot != 0) {
            Flag storage flag = _flags[slot - 1];
            if (_isLive(flag)) return (Status.Flagged, bytes32(0), Role.None, flag.expiresAt);
        }
        if (reportCount[account] > 0) return (Status.Reported, bytes32(0), Role.None, 0);
        return (Status.None, bytes32(0), Role.None, 0);
    }

    /// @notice Returns a stored report.
    function getReport(uint256 reportId) external view returns (Report memory) {
        if (reportId >= _reports.length) revert ReportNotFound(reportId);
        return _reports[reportId];
    }

    /// @notice Returns a stored flag.
    function getFlag(uint256 flagId) external view returns (Flag memory) {
        return _flagAt(flagId);
    }

    /// @notice Returns the cluster entry of an address.
    function getClusterEntry(address account) external view returns (ClusterEntry memory) {
        return _clusterOf[account];
    }

    function _isLive(Flag storage flag) internal view returns (bool) {
        return
            flag.state == FlagState.Active &&
            (flag.challenger != address(0) || block.timestamp < flag.expiresAt);
    }

    function _flagAt(uint256 flagId) private view returns (Flag storage) {
        if (flagId >= _flags.length) revert FlagNotFound(flagId);
        return _flags[flagId];
    }

    function _expire(uint256 flagId, Flag storage flag) private {
        flag.state = FlagState.Expired;
        credits[flag.flagger] += flag.stake;
        delete activeFlagOf[flag.target];
        emit Expired(flagId, flag.target);
    }

    function _addToCluster(address account, bytes32 clusterId, Role role, bytes32 evidenceHash) private {
        if (account == address(0)) revert ZeroAddress();
        if (_clusterOf[account].role != Role.None) revert AlreadyInCluster(account);
        _clusterOf[account] = ClusterEntry(clusterId, role, evidenceHash);
    }

    function _confirmFlagOf(address member) private returns (bool confirmed) {
        uint256 slot = activeFlagOf[member];
        if (slot == 0) return false;
        uint256 flagId = slot - 1;
        Flag storage flag = _flags[flagId];
        if (!_isLive(flag)) return false;
        if (flag.challenger != address(0)) revert MemberFlagChallenged(member, flagId);
        flag.state = FlagState.Confirmed;
        credits[flag.flagger] += flag.stake;
        delete activeFlagOf[member];
        return true;
    }

    function _requireUnique(address[] calldata members, address[] calldata exitPoints) private pure {
        uint256 total = members.length + exitPoints.length;
        for (uint256 i = 0; i < total; ++i) {
            address current = _at(members, exitPoints, i);
            for (uint256 j = i + 1; j < total; ++j) {
                if (current == _at(members, exitPoints, j)) revert DuplicateAddress(current);
            }
        }
    }

    function _at(address[] calldata members, address[] calldata exitPoints, uint256 index) private pure returns (address) {
        return index < members.length ? members[index] : exitPoints[index - members.length];
    }
}
