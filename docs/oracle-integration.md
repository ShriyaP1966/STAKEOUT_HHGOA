# Using Stakeout as an oracle: `getStatus(address)` and `StakeoutGuard`

Sources: `contracts/Stakeout.sol`, `contracts/StakeoutGuard.sol`, `shared/abi/Stakeout.json`, `shared/abi/StakeoutGuard.json`, `shared/enums.ts`, `deployments/network.json`. Anything not in those files is marked UNKNOWN or UNVERIFIED.

## Where it is
From `deployments/network.json` (a committed hand-off file; read it for the current values, do not copy addresses into your own code):
- `chainId` 84532. The repo does not name this chain, so its name here is UNKNOWN.
- `stakeoutAddress`: the `Stakeout` contract. `guardAddress`: the `StakeoutGuard` contract. `deploymentBlock`: first block to scan for events.
- ABIs: `shared/abi/Stakeout.json` and `shared/abi/StakeoutGuard.json`.

## The call
`getStatus` is a free `view` call that never reverts. From the ABI:

```
getStatus(address account) view returns (uint8 status, bytes32 clusterId, uint8 role, uint64 expiresAt)
```

The enums are fixed in order (`shared/enums.ts`, matching `Stakeout.sol`):

| `status` | value | `role` | value |
|---|---|---|---|
| None | 0 | None | 0 |
| Reported | 1 | Member | 1 |
| Flagged | 2 | ExitPoint | 2 |
| Confirmed | 3 | Linked | 3 |
| Linked | 4 | | |

What the fields mean (from the contract code):
- The lookup order is: the account's cluster entry, then its live flag, then any report, then `None`.
- **In a cluster:** `status` is `Linked` if the role is `Linked`, otherwise `Confirmed`; `role` is the entry's role; `clusterId` is the cluster; `expiresAt` is 0.
- **Flagged:** the account has a live flag (active and either unexpired or challenged). `clusterId` is zero, `role` is `None`, and `expiresAt` is the flag's deadline. A flag past its deadline with no challenge is no longer live, so the account reads `Reported` (if it has any report) or `None`. A challenged flag stays live until a reviewer resolves it.
- **Reported:** at least one report exists and no cluster entry or live flag. Reports are free and open to anyone, so `Reported` alone is weak evidence.
- **None:** none of the above.
- A reviewer's `removeMember` deletes the cluster entry, after which the account reads as it would otherwise (`Flagged`, `Reported` or `None`).

How to treat the result is your decision. `StakeoutGuard` (below) blocks only `Confirmed` and `Linked`. `Flagged` and `Reported` are warnings, not proof. Who decides `Confirmed` and `Linked`, and how far to trust them: `docs/trust-model.md`.

## `StakeoutGuard`
`contracts/StakeoutGuard.sol`, deployed at `guardAddress`. It holds an immutable pointer to one `Stakeout` contract (`stakeout()`), so it can never be repointed; if the Stakeout contract is replaced, a new guard is needed.

| Function | Behavior (from the code) |
|---|---|
| `sendTo(address payable to) payable` | Reverts `ZeroAddress` if `to` is zero. Reads `getStatus(to)`. Reverts `Blocked(to, status)` if the status is `Confirmed` or `Linked`. Otherwise forwards the whole attached `msg.value` to `to` with a plain `call`, and reverts `ForwardFailed` if that call fails. Non-reentrant. |
| `isAllowed(address account) view returns (bool)` | `false` for `Confirmed` or `Linked`, `true` for everything else, including `Flagged` and `Reported`. |
| `stakeout() view returns (address)` | The Stakeout contract it reads. |

Errors in the ABI: `Blocked(address to, uint8 status)`, `ForwardFailed()`, `ZeroAddress()`, `ReentrancyGuardReentrantCall()`.
Not stated anywhere in the repo, so UNKNOWN: any gas limit on the forwarded call (the code uses a plain `call`, which forwards the remaining gas).

## TypeScript (ethers v6): VERIFIED against the deployed contract
This is the snippet as run read-only against the contract in `deployments/network.json`, on the RPC in the backend's `.env`. It returned `None` for a freshly generated address, for the verifier address and for the reviewer address (none of them is in a cluster), `guard.isAllowed` was `true` for all three, and `guard.stakeout()` equalled `stakeoutAddress`. It was not run against a `Confirmed` or `Linked` address, because none was known; that branch was not exercised live.

```ts
import { readFileSync } from "node:fs";
import { Contract, JsonRpcProvider } from "ethers";
import { Role, Status } from "./shared/enums"; // repo file; use your own copy of the enum order if you are outside the repo

const deployment = JSON.parse(readFileSync("deployments/network.json", "utf8"));
const abi = JSON.parse(readFileSync("shared/abi/Stakeout.json", "utf8"));
const provider = new JsonRpcProvider(process.env.RPC_URL!, deployment.chainId, { staticNetwork: true });
const stakeout = new Contract(deployment.stakeoutAddress, abi, provider);

export async function statusOf(address: string) {
  const r = await stakeout.getStatus(address); // names come from the ABI outputs
  return {
    status: Status[Number(r.status)],  // "None" | "Reported" | "Flagged" | "Confirmed" | "Linked"
    clusterId: r.clusterId as string,  // bytes32, zero unless the account is in a cluster
    role: Role[Number(r.role)],        // "None" | "Member" | "ExitPoint" | "Linked"
    expiresAt: r.expiresAt as bigint,  // Unix seconds; non-zero only for a live flag
  };
}
```

## Solidity: NOT COMPILED here (UNVERIFIED)
There is no Solidity compiler in this repo's current checkout (no installed dependencies at the root), so this snippet was not compiled or tested. It uses only names from the ABI. The pattern of importing `Stakeout` and reading `Stakeout.Status` is the one `StakeoutGuard.sol` itself uses and that contract is deployed (`guardAddress`), but that does not prove this snippet compiles.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Option 1 (inside this repo): import {Stakeout} from "./Stakeout.sol"; and use Stakeout.Status, as StakeoutGuard does.
// Option 2 (outside the repo): a minimal interface. The order of the enum must match Stakeout.sol exactly.
interface IStakeoutStatus {
    enum Status { None, Reported, Flagged, Confirmed, Linked }
    enum Role { None, Member, ExitPoint, Linked }

    function getStatus(address account)
        external
        view
        returns (Status status, bytes32 clusterId, Role role, uint64 expiresAt);
}

contract ExampleConsumer {
    IStakeoutStatus public immutable stakeout; // set from deployments/network.json at deploy time, not typed in the contract

    constructor(address stakeoutAddress) {
        stakeout = IStakeoutStatus(stakeoutAddress);
    }

    /// Refuses to pay accounts that Stakeout lists as Confirmed or Linked. Flagged and Reported are allowed here: your policy to choose.
    function pay(address payable to) external payable {
        (IStakeoutStatus.Status status, , , ) = stakeout.getStatus(to);
        require(
            status != IStakeoutStatus.Status.Confirmed && status != IStakeoutStatus.Status.Linked,
            "recipient is on the Stakeout blocklist"
        );
        (bool sent, ) = to.call{value: msg.value}("");
        require(sent, "transfer failed");
    }
}
```
Note on the ABI: the ABI lists `status` and `role` as `uint8`. A Solidity enum return value is encoded as `uint8`, which is why the snippet's interface is compatible in principle; again, not compiled here.

## Other ways to read the same data
- **Events** (names in the ABI): `Confirmed(clusterId, members[], exitPoints[], evidenceHash)`, `Linked(target, clusterId, evidenceHash)`, `MemberRemoved(target, clusterId)`. Scan from `deploymentBlock`.
- **The backend's `GET /blocklist`** (PROPOSED, not agreed with Person 3): hashed addresses of Confirmed and Linked wallets for a private lookup. Its hash rule is in `docs/person2-handoff.md`. It hides the list only from casual reading.
- **Evidence behind a status:** a `Confirmed` or `Linked` entry stores an `evidenceHash` (readable with `getClusterEntry(address)`). The bundle that produced it can be fetched from the backend with `GET /evidence/{hash}` and checked with `shared/hash`.

## Open points (UNKNOWN in the repo)
- The name of chain 84532, and whether there is a deployment on any other chain: only `deployments/network.json` exists.
- A stable, versioned guarantee that the enum order will not change: AGENTS.md states "Statuses (fixed order): `None=0, Reported=1, Flagged=2, Confirmed=3, Linked=4`", but there is no versioning or upgrade policy in the repo.
