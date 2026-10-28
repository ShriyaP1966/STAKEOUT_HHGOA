import { JsonRpcProvider, formatEther, getAddress, isAddress, parseEther } from "ethers";
import { config } from "hardhat";
import { loadRpcEnv } from "./lib/deploy-config";

const USAGE = "Usage: npm run fund:local -- <recipient> <amountEth>";

function parseRecipient(value: string | undefined): string {
  if (value === undefined || !isAddress(value)) throw new Error(`recipient must be a valid address.\n${USAGE}`);
  return getAddress(value);
}

function parseAmount(value: string | undefined): bigint {
  if (value === undefined || !/^[0-9]+(\.[0-9]+)?$/.test(value)) {
    throw new Error(`amountEth must be a positive decimal number of ETH.\n${USAGE}`);
  }
  const amount = parseEther(value);
  if (amount === 0n) throw new Error(`amountEth must be greater than zero.\n${USAGE}`);
  return amount;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2) throw new Error(USAGE);
  const recipient = parseRecipient(args[0]);
  const amount = parseAmount(args[1]);

  const localChainId = config.networks.hardhat.chainId;
  const env = loadRpcEnv("localhost");
  if (env.CHAIN_ID !== localChainId) {
    throw new Error(`CHAIN_ID in .env.localhost is ${env.CHAIN_ID}, not the local Hardhat chain ${localChainId}.`);
  }
  const provider = new JsonRpcProvider(env.RPC_URL, localChainId, { staticNetwork: true });
  const connected = Number(await provider.send("eth_chainId", []));
  if (connected !== localChainId) {
    throw new Error(`The node at RPC_URL reports chain ${connected}, not the local Hardhat chain ${localChainId}. Refusing to send.`);
  }

  const [sender] = (await provider.send("eth_accounts", [])) as string[];
  if (sender === undefined) throw new Error("The local node has no unlocked test accounts.");
  const signer = await provider.getSigner(sender);
  const tx = await signer.sendTransaction({ to: recipient, value: amount });
  const receipt = await tx.wait();
  if (receipt === null || receipt.status !== 1) throw new Error(`Funding transaction ${tx.hash} failed.`);

  console.log(`Sent ${formatEther(amount)} ETH on chain ${localChainId}`);
  console.log(`Transaction: ${tx.hash}`);
  console.log(`Recipient balance: ${formatEther(await provider.getBalance(recipient))} ETH`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
