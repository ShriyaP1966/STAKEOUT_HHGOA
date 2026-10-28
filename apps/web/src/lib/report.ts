import { getAddress, isAddress, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { stakeoutAbi } from "./abi";

type ReportCall = { account: Address; stakeout: Address; target: string; evidenceHash: Hex };

export async function submitReport(
  client: PublicClient,
  write: (request: unknown) => Promise<Hash>,
  call: ReportCall,
): Promise<Hash> {
  if (!isAddress(call.target)) throw new Error("The complaint's target address is not a valid address.");
  const { request } = await client.simulateContract({
    account: call.account,
    address: call.stakeout,
    abi: stakeoutAbi,
    functionName: "report",
    args: [getAddress(call.target), call.evidenceHash],
  });
  const hash = await write(request);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted.`);
  return hash;
}
