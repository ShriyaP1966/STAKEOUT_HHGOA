// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Stakeout} from "../Stakeout.sol";

contract StakeoutActor {
    enum Mode {
        Accept,
        Reject,
        Reenter
    }

    Stakeout public immutable stakeout;
    Mode public mode;
    address public reentryTarget;
    bytes public reentryCall;
    uint256 public reentryAttempts;
    bytes public reentryError;

    error Rejected();

    constructor(address stakeoutAddress) {
        stakeout = Stakeout(stakeoutAddress);
    }

    /// @notice Sets how this contract reacts to incoming ether.
    function setMode(Mode newMode) external {
        mode = newMode;
    }

    /// @notice Sets the contract and calldata used when re-entering on receive.
    function setReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryCall = data;
    }

    /// @notice Promotes a report through Stakeout as this contract.
    function promote(uint256 reportId) external payable {
        stakeout.promote{value: msg.value}(reportId);
    }

    /// @notice Withdraws this contract's credit from Stakeout.
    function withdraw() external {
        stakeout.withdraw();
    }

    /// @notice Accepts, rejects, or re-enters the configured target depending on the mode.
    receive() external payable {
        if (mode == Mode.Reject) revert Rejected();
        if (mode == Mode.Reenter) {
            ++reentryAttempts;
            (bool succeeded, bytes memory reason) = reentryTarget.call(reentryCall);
            if (!succeeded) reentryError = reason;
        }
    }
}
