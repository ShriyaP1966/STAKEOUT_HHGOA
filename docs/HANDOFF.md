# Person 3 handoff: contracts, scripts, deployments, web app

For Person 1 and Person 2. Commands are in `AGENTS.md` section 8; configuration is in `README.md`.

## Complaint hash (web app, `/report`)
The web app sends `{ text, targetAddress?, timezone }` to `POST /extract`. `timezone` is the viewer's IANA zone from `Intl.DateTimeFormat().resolvedOptions().timeZone`. It requires the response field `text` and recomputes `hashBundle({ text, complaint, dataSource })` with the text the backend returned. The report button stays disabled unless that equals `complaintHash`.

## Web app environment (`apps/web/.env.local`)
These are all the variables `apps/web` reads. Each one except `NEXT_PUBLIC_SITE_URL` is validated at startup, and a problem shows a configuration-error screen naming the variable.

| Variable | Rule |
|---|---|
| `NEXT_PUBLIC_RPC_URL` | http or https URL |
| `NEXT_PUBLIC_LOG_CHUNK_SIZE` | whole number, at least 1, and within the RPC provider's `eth_getLogs` block-range limit. Base Sepolia: `https://sepolia.base.org` allows only 200; `https://base-sepolia-rpc.publicnode.com` allows 50,000 (use `50000`); measured 2026-10-30 |
| `NEXT_PUBLIC_EXPLORER_URL` | http or https URL; required when `NEXT_PUBLIC_DEPLOYMENT` is `target` |
| `NEXT_PUBLIC_DEPLOYMENT` | `target` or `localhost` |
| `NEXT_PUBLIC_DATA_SOURCE` | `synthetic` or `testnet` |
| `NEXT_PUBLIC_BACKEND_URL` | http or https URL |
| `NEXT_PUBLIC_GRAPH_URL` | http or https URL of the graph service; the browser reaches it through `/graph/*` |
| `NEXT_PUBLIC_VOICE_LANG` | BCP-47 language tag |
| `NEXT_PUBLIC_SITE_URL` | optional http or https URL of the deployed site, used only for link-preview metadata, `/robots.txt` and `/sitemap.xml`; empty or invalid means those are left out |

`STAKEOUT_LOCAL_RPC_URL` is read only by the web tests, to include the local-node checks.

## Local chain
- `EXPLORER_API_KEY` in `.env.localhost` may be empty or left out; both behave the same, and the deploy prints that explorer verification is skipped on the local chain. It is required only for `deploy:target`, and an empty or missing value there stops with `EXPLORER_API_KEY: is missing. It is required to verify contracts on the explorer when deploying to a non-local chain`.
- `npm run seed:local` refuses to run unless the node reports the Hardhat config's local chain id and identifies as a Hardhat node. `VERIFIER_ADDRESS` may be any address, including your real verifier: the script impersonates it with `hardhat_impersonateAccount`, raises its local balance with `hardhat_setBalance` if it is below the Hardhat account balance, calls `confirm` and `link` as that verifier, and stops impersonating. Contract roles are not changed. The reviewer must still be one of the node's accounts.

## Live testnet run, Base Sepolia, 2026-10-29 and 2026-10-30
Recorded from the chain, not from memory: every row below was read back from the Stakeout contract's events on Base Sepolia (chain 84532, contract in `deployments/network.json`). Times are block times in UTC. All complaints were real `/extract` results labelled `synthetic`; each complaint hash was recomputed and matched before it went on chain. The reporter is a throwaway test wallet, `0x11520Efd69B5d97b530852b1745cAA3E314E6677`, whitelisted by the reviewer Safe (2 of 3 owners) in tx `0x4fd562967758cade68441a1a53924bb20b815eccaa16cecd96f99452cb0dafc0`.

### The confirm (the end-to-end result)
| Time (UTC) | Block | Event | Detail | Tx |
|---|---|---|---|---|
| 2026-10-30 01:23:38 | 52007746 | ReportSubmitted | report #4, target `0x597164c4A6058a00581a22B22dE50472433D2E44` | `0xc8df7333c4b7ea3915df4325687f7619b9594f457ebd5d25e50578afabeb0cd9` |
| 2026-10-30 01:23:39 | 52007755 | Promoted | flag #4, stake 0.001 ETH | `0xd83b28380865fe2919e7360754d1ee9ca930f26740817ff5fe01461935696e0d` |
| 2026-10-30 01:24:02 | 52007868 | Confirmed | cluster `0xe8e38426852fd254f5e5dc7dea2a535866d5f1775137c598a25d4b1ce10552be`, 4 members, 1 exit point, evidence `0xb4f0cb1c50242951639341a4168108ae629c90bc9b30d3d471d2ddcbcb78a6de` | `0x5bf332a6d832b789cea1040a2e8ba4011b61213785c840d35c41f40f2dc7c123` |
| 2026-10-30 01:24:16 | 52007937 | Linked | `0x37b363F437AADce2a7Dc3Ef0b7a191bD18323383` | `0xfd0de8848ad8be520b3949db7b5df74d5b5af32c30e57fea4ce77e621473b5ea` |
| 2026-10-30 01:24:24 | 52007976 | Linked | `0xa8DB670002bFD989BE9E448a29019D9f436B54C9` | `0x8655ce0028b09ee98f65c90a1a90a29d91ad2be19bd025ddf965eaeb14b82725` |

The verifier (Person 2) confirmed 23 seconds after the promote, using the live Graph Service (Person 1's first version, completed by Person 2) and `config/rules.json`. Afterwards `getStatus` returned 3 (Confirmed) for the target and 4 (Linked) for both linked wallets, all in the same cluster.

### Earlier flags on the way there
| Flag | Target | Promoted (UTC) | Outcome |
|---|---|---|---|
| #0 | `0x944Df10923b47ba3a8cc4311f5Fa22B078fCF0f7` (random address) | 2026-10-29 12:33:32 | Not confirmed; lapsed |
| #1 | `0x8ff48310F884196C87EbEfEfE1bF4056D0A6A072` (random address, no graph data) | 2026-10-29 23:50:59 | Not confirmed; lapsed |
| #2 | `0xb2b3f4d58D82cA6386D2C96E760e819b85c924C3` (cluster member) | 2026-10-30 00:54:12 | Skipped by the verifier before sending, because the Graph Service listed the exit point in both members and exitPoints (reported by Person 2, fixed in 1a9f8f9); lapsed |
| #3 | same member | 2026-10-30 01:07:33 | Verifier in dry run (reported by Person 2); lapsed |

### Stakes
Every stake was returned in full, with no slashing. Flag #4's stake was credited by the confirm; the lapsed flags were expired first.

| Time (UTC) | Event | Tx |
|---|---|---|
| 2026-10-29 19:02:27 | Expired flag #0 | `0xe65108e1176434f9c5502e08cf8574ceb4fc0afa3d69af3526f9d894d5986ed1` |
| 2026-10-29 19:02:33 | Withdrawn 0.001 ETH | `0x8e447f1043193b9d634bf498fc448b375c6c080fdd884af5be8712446e011b68` |
| 2026-10-30 01:07:09 | Expired flag #2 | `0x548b63440550cf4f3212dcb8e3338ba4b12b5f421126417879c50052970c94e5` |
| 2026-10-30 01:07:12 | Withdrawn 0.001 ETH | `0x5b0aa28386196041c90fe9e0deaed6eff274828e68c3108e6e9a2e1a0275caa5` |
| 2026-10-30 02:00:02 | Expired flag #1 | `0xe579f6aa243b56167a8473c7c9fee9f7cb63695b52f6b4c73e36fbea766c85ea` |
| 2026-10-30 02:00:04 | Expired flag #3 | `0xa3421dd2c19e11636dea0aeff4052abc9e253675ce33fa273d042d05363b0e27` |
| 2026-10-30 02:00:07 | Withdrawn 0.003 ETH (flags #1, #3, #4) | `0x9ce0772be9bd25459ee4f89b650e462855328a568ac98bda5dcecc8a82e2fa8c` |

To check any row, open `https://sepolia.basescan.org/tx/<tx>`.
