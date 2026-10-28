import type { Abi, Address, Hash, PublicClient } from "viem";

export type ContractCall = {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
};

export class TransactionRevertedError extends Error {
  constructor(readonly hash: Hash) {
    super(`Transaction ${hash} was mined but reverted.`);
    this.name = "TransactionRevertedError";
  }
}

export async function sendContractCall(
  client: PublicClient,
  write: (request: unknown) => Promise<Hash>,
  account: Address,
  call: ContractCall,
): Promise<Hash> {
  const { request } = await client.simulateContract({ account, ...call });
  const hash = await write(request);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new TransactionRevertedError(hash);
  return hash;
}
