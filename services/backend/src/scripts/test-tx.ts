// Phase 0 hello-world: one signed zero-value transaction to self on the configured testnet.
import { JsonRpcProvider, Wallet, formatEther } from "ethers";
import { chainEnv, loadEnv } from "../config.js";

const env = loadEnv(chainEnv.pick({ RPC_URL: true, CHAIN_ID: true, VERIFIER_PRIVATE_KEY: true }), "chain");
const provider = new JsonRpcProvider(env.RPC_URL, env.CHAIN_ID);
const wallet = new Wallet(env.VERIFIER_PRIVATE_KEY, provider);

const net = await provider.getNetwork();
if (Number(net.chainId) !== env.CHAIN_ID) throw new Error(`RPC reports chain ${net.chainId}, .env says ${env.CHAIN_ID}`);
const balance = await provider.getBalance(wallet.address);
console.log(`Verifier ${wallet.address} balance: ${formatEther(balance)}`);
if (balance === 0n) throw new Error("Balance is 0. Fund the verifier address from a testnet faucet first.");

const tx = await wallet.sendTransaction({ to: wallet.address, value: 0n });
console.log(`Sent ${tx.hash}, waiting for confirmation...`);
const receipt = await tx.wait();
console.log(`Confirmed in block ${receipt?.blockNumber}`);
