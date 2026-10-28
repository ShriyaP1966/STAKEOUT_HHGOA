// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Stakeout} from "./Stakeout.sol";

contract StakeoutGuard is ReentrancyGuard {
    Stakeout public immutable stakeout;

    error ZeroAddress();
    error Blocked(address to, uint8 status);
    error ForwardFailed();

    constructor(address stakeoutAddress) {
        if (stakeoutAddress == address(0)) revert ZeroAddress();
        stakeout = Stakeout(stakeoutAddress);
    }

    /// @notice Forwards the attached value unless the recipient is Confirmed or Linked.
    function sendTo(address payable to) external payable nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        Stakeout.Status status = _statusOf(to);
        if (_isBlocked(status)) revert Blocked(to, uint8(status));
        (bool sent, ) = to.call{value: msg.value}("");
        if (!sent) revert ForwardFailed();
    }

    /// @notice Returns whether sendTo would forward value to the account.
    function isAllowed(address account) external view returns (bool) {
        return !_isBlocked(_statusOf(account));
    }

    function _statusOf(address account) private view returns (Stakeout.Status status) {
        (status, , , ) = stakeout.getStatus(account);
    }

    function _isBlocked(Stakeout.Status status) private pure returns (bool) {
        return status == Stakeout.Status.Confirmed || status == Stakeout.Status.Linked;
    }
}
