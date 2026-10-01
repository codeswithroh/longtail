import { lookup as systemLookup, type LookupAddress } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";

// Some ISPs block venue domains at the resolver. When LONGTAIL_DOH is set (default on),
// hostnames are resolved over DNS-over-HTTPS and the TLS connection still verifies
// the real hostname via SNI, so this changes name resolution only.
const DOH_URL = process.env.LONGTAIL_DOH_URL ?? "https://cloudflare-dns.com/dns-query";
const useDoh = process.env.LONGTAIL_DOH !== "0";

const cache = new Map<string, { address: string; expires: number }>();

async function resolveDoh(hostname: string): Promise<string> {
  const hit = cache.get(hostname);
  if (hit && hit.expires > Date.now()) return hit.address;
  const res = await undiciFetch(`${DOH_URL}?name=${encodeURIComponent(hostname)}&type=A`, {
    headers: { accept: "application/dns-json" },
  });
  if (!res.ok) throw new Error(`DoH ${res.status} for ${hostname}`);
  const body = (await res.json()) as { Answer?: { type: number; data: string; TTL: number }[] };
  const a = body.Answer?.find((r) => r.type === 1);
  if (!a) throw new Error(`DoH: no A record for ${hostname}`);
  cache.set(hostname, { address: a.data, expires: Date.now() + Math.max(a.TTL, 30) * 1000 });
  return a.data;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

function dohLookup(hostname: string, options: { all?: boolean }, cb: LookupCallback) {
  if (hostname === new URL(DOH_URL).hostname) return systemLookup(hostname, options, cb as never);
  resolveDoh(hostname).then(
    (address) => (options.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4)),
    (err: Error) => systemLookup(hostname, options, (e, addr, fam) => (e ? cb(err, "") : cb(null, addr as string, fam))),
  );
}

const agent = new Agent({
  connect: useDoh ? { lookup: dohLookup as never } : {},
  keepAliveTimeout: 30_000,
  connections: 32,
});

export class HttpError extends Error {
  status: number;
  url: string;
  constructor(status: number, url: string, body: string) {
    super(`HTTP ${status} ${url}: ${body.slice(0, 200)}`);
    this.status = status;
    this.url = url;
  }
}

export async function getJson<T>(url: string, init: { retries?: number; timeoutMs?: number } = {}): Promise<T> {
  const retries = init.retries ?? 2;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await undiciFetch(url, {
        dispatcher: agent,
        headers: { "user-agent": "longtail/0.1", accept: "application/json" },
        signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
      });
      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, url, text);
      return JSON.parse(text) as T;
    } catch (err) {
      const retryable = !(err instanceof HttpError) || err.status === 429 || err.status >= 500;
      if (!retryable || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

export async function postJson<T>(url: string, body: unknown, timeoutMs = 20_000): Promise<T> {
  const res = await undiciFetch(url, {
    method: "POST",
    dispatcher: agent,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, url, text);
  return JSON.parse(text) as T;
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}
