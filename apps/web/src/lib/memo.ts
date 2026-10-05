// Tiny server-side TTL cache. Every app page reads the same few upstream files (GitHub raw,
// testnet RPC); caching them for a few seconds makes navigation instant instead of 1–3s.
const entries = new Map<string, { at: number; value: unknown; pending?: Promise<unknown> }>();

export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < ttlMs && !hit.pending) return hit.value as T;
  if (hit?.pending) return hit.pending as Promise<T>; // share one in-flight fetch between concurrent requests
  const pending = fn().then(
    (value) => {
      // Don't pin failures: null means "upstream unavailable", so retry on the next request.
      if (value == null) entries.delete(key);
      else entries.set(key, { at: Date.now(), value });
      return value;
    },
    (err) => {
      entries.delete(key);
      throw err;
    },
  );
  entries.set(key, { at: hit?.at ?? 0, value: hit?.value, pending });
  return pending;
}
