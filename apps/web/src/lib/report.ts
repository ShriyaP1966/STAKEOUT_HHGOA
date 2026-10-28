import { getAddress, isAddress, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { stakeoutAbi } from "./abi";
import { sendContractCall } from "./tx";

type ReportCall = { account: Address; stakeout: Address; target: string; evidenceHash: Hex };

export async function submitReport(
  client: PublicClient,
  write: (request: unknown) => Promise<Hash>,
  call: ReportCall,
): Promise<Hash> {
  if (!isAddress(call.target)) throw new Error("The complaint's target address is not a valid address.");
  return sendContractCall(client, write, call.account, {
    address: call.stakeout,
    abi: stakeoutAbi,
    functionName: "report",
    args: [getAddress(call.target), call.evidenceHash],
  });
}
