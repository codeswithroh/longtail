"use client";
// Wallet layer for HyperEVM testnet. Two ways in: a browser wallet (MetaMask, Rabby…), or a
// demo wallet generated in the browser so anyone can try the vault without installing anything.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPublicClient, createWalletClient, custom, http, type Account, type Address, type EIP1193Provider, type Hash, type WalletClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hyperEvmTestnet, USDC_ADDRESS, usdcAbi, VAULT_ADDRESS, vaultAbi } from "@/lib/chain";

type Kind = "injected" | "demo";

export interface Balances {
  hype: bigint;
  usdc: bigint;
  shares: bigint;
  assets: bigint; // value of our shares in tUSDC
  maxRedeem: bigint;
  maxDeposit: bigint;
  allowance: bigint;
  vaultAssets: bigint; // total assets in the vault
}

export interface TxEntry {
  label: string;
  hash: Hash;
  status: "pending" | "success" | "reverted";
  at: number;
}

interface WalletCtx {
  address: Address | null;
  kind: Kind | null;
  hasInjected: boolean;
  balances: Balances | null;
  txs: TxEntry[];
  busy: string | null;
  error: string | null;
  connectInjected: () => Promise<void>;
  connectDemo: () => void;
  disconnect: () => void;
  refresh: () => Promise<void>;
  requestFunds: () => Promise<void>;
  deposit: (amount: bigint) => Promise<void>;
  redeem: (shares: bigint) => Promise<void>;
  clearError: () => void;
}

const Ctx = createContext<WalletCtx | null>(null);
export const publicClient = createPublicClient({ chain: hyperEvmTestnet, transport: http(hyperEvmTestnet.rpcUrls.default.http[0]) });

const KIND_KEY = "longtail.wallet";
const DEMO_KEY = "longtail.demoKey";
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode: the session still works, it just won't be remembered */
    }
  },
};

function eth(): EIP1193Provider | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
}

function friendly(e: unknown) {
  const m = String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e);
  if (/rejected|denied/i.test(m)) return "Request rejected in your wallet.";
  if (/insufficient funds/i.test(m)) return "Not enough testnet HYPE for gas. Use “Get test funds”.";
  return m.slice(0, 180);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [client, setClient] = useState<WalletClient | null>(null);
  const [account, setAccount] = useState<Account | Address | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [txs, setTxs] = useState<TxEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasInjected, setHasInjected] = useState(false);

  const applyDemo = useCallback((key: `0x${string}`) => {
    const acct = privateKeyToAccount(key);
    setClient(createWalletClient({ chain: hyperEvmTestnet, transport: http(hyperEvmTestnet.rpcUrls.default.http[0]), account: acct }));
    setAccount(acct);
    setAddress(acct.address);
    setKind("demo");
  }, []);

  const applyInjected = useCallback((provider: EIP1193Provider, addr: Address) => {
    setClient(createWalletClient({ chain: hyperEvmTestnet, transport: custom(provider), account: addr }));
    setAccount(addr);
    setAddress(addr);
    setKind("injected");
  }, []);

  // Restore the last session without prompting.
  useEffect(() => {
    const provider = eth();
    setHasInjected(!!provider);
    const saved = store.get(KIND_KEY);
    if (saved === "demo") {
      const key = store.get(DEMO_KEY) as `0x${string}` | null;
      if (key) applyDemo(key);
    } else if (saved === "injected" && provider) {
      provider
        .request({ method: "eth_accounts" })
        .then((accts) => {
          const a = (accts as Address[])[0];
          if (a) applyInjected(provider, a);
        })
        .catch(() => {});
    }
  }, [applyDemo, applyInjected]);

  // Follow account switches in the browser wallet.
  useEffect(() => {
    const provider = eth();
    if (!provider || kind !== "injected") return;
    const onAccounts = (accts: unknown) => {
      const a = (accts as Address[])[0];
      if (a) applyInjected(provider, a);
      else {
        setAddress(null);
        setKind(null);
      }
    };
    provider.on?.("accountsChanged", onAccounts);
    return () => provider.removeListener?.("accountsChanged", onAccounts);
  }, [kind, applyInjected]);

  const refresh = useCallback(async () => {
    if (!address) return setBalances(null);
    try {
      const read = <T,>(p: Promise<unknown>) => p as Promise<T>;
      const [hype, usdc, shares, maxRedeem, maxDeposit, allowance, vaultAssets] = await Promise.all([
        publicClient.getBalance({ address }),
        read<bigint>(publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "balanceOf", args: [address] })),
        read<bigint>(publicClient.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "balanceOf", args: [address] })),
        read<bigint>(publicClient.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "maxRedeem", args: [address] })),
        read<bigint>(publicClient.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "maxDeposit", args: [address] })),
        read<bigint>(publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "allowance", args: [address, VAULT_ADDRESS] })),
        read<bigint>(publicClient.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "totalAssets" })),
      ]);
      const assets = shares > 0n ? await read<bigint>(publicClient.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "convertToAssets", args: [shares] })) : 0n;
      setBalances({ hype, usdc, shares, assets, maxRedeem, maxDeposit, allowance, vaultAssets });
    } catch {
      /* keep the last balances; the RPC hiccups occasionally */
    }
  }, [address]);

  useEffect(() => {
    refresh();
    if (!address) return;
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [address, refresh]);

  const ensureChain = useCallback(async () => {
    const provider = eth();
    if (kind !== "injected" || !provider) return;
    const hex = `0x${hyperEvmTestnet.id.toString(16)}`;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      if ((e as { code?: number }).code !== 4902) throw e;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: hex, chainName: hyperEvmTestnet.name, nativeCurrency: hyperEvmTestnet.nativeCurrency, rpcUrls: [...hyperEvmTestnet.rpcUrls.default.http] }],
      });
    }
  }, [kind]);

  const connectInjected = useCallback(async () => {
    const provider = eth();
    if (!provider) return setError("No browser wallet found. Use the demo wallet instead.");
    setError(null);
    try {
      const accts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
      if (!accts[0]) return;
      applyInjected(provider, accts[0]);
      store.set(KIND_KEY, "injected");
    } catch (e) {
      setError(friendly(e));
    }
  }, [applyInjected]);

  const connectDemo = useCallback(() => {
    let key = store.get(DEMO_KEY) as `0x${string}` | null;
    if (!key) {
      key = generatePrivateKey();
      store.set(DEMO_KEY, key);
    }
    store.set(KIND_KEY, "demo");
    setError(null);
    applyDemo(key);
  }, [applyDemo]);

  const disconnect = useCallback(() => {
    store.set(KIND_KEY, null);
    setAddress(null);
    setKind(null);
    setClient(null);
    setAccount(null);
    setBalances(null);
  }, []);

  const send = useCallback(
    async (label: string, write: () => Promise<Hash>) => {
      const hash = await write();
      setTxs((t) => [{ label, hash, status: "pending" as const, at: Date.now() }, ...t].slice(0, 12));
      const r = await publicClient.waitForTransactionReceipt({ hash });
      setTxs((t) => t.map((x) => (x.hash === hash ? { ...x, status: r.status } : x)));
      if (r.status !== "success") throw new Error(`${label} reverted`);
    },
    [],
  );

  const run = useCallback(
    async (what: string, fn: () => Promise<void>) => {
      setBusy(what);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(friendly(e));
      } finally {
        setBusy(null);
        // Read replicas lag the chain head by a few seconds; check again shortly after.
        refresh();
        setTimeout(refresh, 2500);
        setTimeout(refresh, 6000);
      }
    },
    [refresh],
  );

  const requestFunds = useCallback(
    () =>
      run("faucet", async () => {
        if (!address) return;
        const r = await fetch("/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
        const j = (await r.json()) as { error?: string; gasTx?: Hash; usdcTx?: Hash; mintedUsdc?: number };
        if (!r.ok) throw new Error(j.error ?? "Faucet failed");
        const add: TxEntry[] = [];
        if (j.usdcTx) add.push({ label: "Received 1,000 tUSDC", hash: j.usdcTx, status: "success", at: Date.now() });
        if (j.gasTx) add.push({ label: "Received gas (0.001 HYPE)", hash: j.gasTx, status: "success", at: Date.now() });
        if (!add.length) throw new Error("You already have test funds.");
        setTxs((t) => [...add, ...t].slice(0, 12));
      }),
    [address, run],
  );

  const deposit = useCallback(
    (amount: bigint) =>
      run("deposit", async () => {
        if (!client || !address || !account) return;
        await ensureChain();
        const allowance = (await publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "allowance", args: [address, VAULT_ADDRESS] })) as bigint;
        if (allowance < amount) {
          await send("Approve tUSDC", () => client.writeContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "approve", args: [VAULT_ADDRESS, amount], account, chain: hyperEvmTestnet }));
        }
        await send(`Deposit ${(Number(amount) / 1e6).toLocaleString("en-US")} tUSDC`, () =>
          client.writeContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "deposit", args: [amount, address], account, chain: hyperEvmTestnet }),
        );
      }),
    [account, address, client, ensureChain, run, send],
  );

  const redeem = useCallback(
    (shares: bigint) =>
      run("redeem", async () => {
        if (!client || !address || !account) return;
        await ensureChain();
        const assets = (await publicClient.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "convertToAssets", args: [shares] })) as bigint;
        await send(`Withdraw ${(Number(assets) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} tUSDC`, () => client.writeContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "redeem", args: [shares, address, address], account, chain: hyperEvmTestnet }));
      }),
    [account, address, client, ensureChain, run, send],
  );

  const value = useMemo<WalletCtx>(
    () => ({ address, kind, hasInjected, balances, txs, busy, error, connectInjected, connectDemo, disconnect, refresh, requestFunds, deposit, redeem, clearError: () => setError(null) }),
    [address, kind, hasInjected, balances, txs, busy, error, connectInjected, connectDemo, disconnect, refresh, requestFunds, deposit, redeem],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet outside WalletProvider");
  return c;
}

export const fmtUsdc = (x: bigint) => (Number(x) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
