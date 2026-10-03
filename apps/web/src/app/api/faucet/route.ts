// Testnet faucet: sends a little HYPE for gas and mints 1,000 tUSDC so anyone can try the vault.
// Test tokens only; the faucet key lives in the server environment.
import { createPublicClient, createWalletClient, formatEther, http, isAddress, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hyperEvmTestnet, USDC_ADDRESS, usdcAbi } from "@/lib/chain";

const GAS_DRIP = parseEther("0.001"); // ~25 deposit/withdraw round trips at 0.1 gwei
const USDC_DRIP = 1_000_000_000n; // 1,000 tUSDC
const MIN_GAS = parseEther("0.0003"); // below this the address gets topped up
const recent = new Map<string, number>(); // ip -> last drip (best effort, per instance)

export async function POST(req: Request) {
  const pk = process.env.FAUCET_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk) return Response.json({ error: "Faucet not configured" }, { status: 503 });
  const { address } = (await req.json().catch(() => ({}))) as { address?: string };
  if (!address || !isAddress(address)) return Response.json({ error: "Invalid address" }, { status: 400 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const last = recent.get(ip) ?? 0;
  if (Date.now() - last < 60_000) return Response.json({ error: "One request a minute, please" }, { status: 429 });
  recent.set(ip, Date.now());

  const transport = http(hyperEvmTestnet.rpcUrls.default.http[0]);
  const pub = createPublicClient({ chain: hyperEvmTestnet, transport });
  const wallet = createWalletClient({ chain: hyperEvmTestnet, transport, account: privateKeyToAccount(pk) });

  const [gas, usdc, faucetGas] = await Promise.all([
    pub.getBalance({ address }),
    pub.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "balanceOf", args: [address] }),
    pub.getBalance({ address: wallet.account.address }),
  ]);
  const out: { gasTx?: string; usdcTx?: string; sentHype: string; mintedUsdc: number } = { sentHype: "0", mintedUsdc: 0 };
  try {
    if (gas < MIN_GAS) {
      if (faucetGas < GAS_DRIP * 2n) return Response.json({ error: "The faucet is out of testnet HYPE; try again later" }, { status: 503 });
      out.gasTx = await wallet.sendTransaction({ to: address, value: GAS_DRIP });
      // Wait each time: the RPC doesn't count pending transactions, so back-to-back sends would reuse a nonce.
      await pub.waitForTransactionReceipt({ hash: out.gasTx as `0x${string}` });
      out.sentHype = formatEther(GAS_DRIP);
    }
    if (usdc < USDC_DRIP) {
      out.usdcTx = await wallet.writeContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "mint", args: [address, USDC_DRIP] });
      await pub.waitForTransactionReceipt({ hash: out.usdcTx as `0x${string}` });
      out.mintedUsdc = 1_000;
    }
  } catch (e) {
    return Response.json({ error: `Faucet transaction failed: ${String(e).slice(0, 160)}` }, { status: 502 });
  }
  return Response.json(out);
}
