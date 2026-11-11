const API = "https://api.dexscreener.com";

// Share one rate limiter and cache across price ticks and discovery scans.
const MIN_REQUEST_GAP_MS = 1_500;
const CACHE_TTL_MS = 15_000;
const MAX_BACKOFF_MS = 120_000;
const cache = new Map();
let nextRequestAt = 0;
let requestQueue = Promise.resolve();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryDelay(header, attempt) {
  const seconds = Number(header);
  const retryAfterMs = Number.isFinite(seconds) && seconds > 0
    ? seconds * 1_000
    : header && Number.isFinite(Date.parse(header))
      ? Date.parse(header) - Date.now()
      : 0;
  return Math.min(MAX_BACKOFF_MS, Math.max(retryAfterMs, 5_000 * 2 ** attempt));
}

async function request(path) {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  // Serialize all DexScreener calls, including retries, so a second caller
  // cannot bypass a rate-limit cooldown.
  const task = requestQueue.catch(() => {}).then(async () => {
    const recent = cache.get(path);
    if (recent && Date.now() - recent.at < CACHE_TTL_MS) return recent.data;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await sleep(Math.max(0, nextRequestAt - Date.now()));
      nextRequestAt = Date.now() + MIN_REQUEST_GAP_MS;
      const response = await fetch(`${API}${path}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000)
      });
      if (response.ok) {
        const data = await response.json();
        cache.set(path, { at: Date.now(), data });
        // Bound memory usage as token batches change over time.
        if (cache.size > 100) {
          for (const [key, entry] of cache) {
            if (Date.now() - entry.at > CACHE_TTL_MS) cache.delete(key);
          }
          while (cache.size > 100) cache.delete(cache.keys().next().value);
        }
        return data;
      }
      if (response.status !== 429 || attempt === 2) {
        throw new Error(`DexScreener responded with ${response.status}`);
      }
      nextRequestAt = Math.max(nextRequestAt, Date.now() + retryDelay(response.headers.get("retry-after"), attempt));
    }
  });
  requestQueue = task.catch(() => {});
  return task;
}

export async function discoverCandidates() {
  const boosts = await request("/token-boosts/latest/v1");
  const solana = boosts.filter((item) => item.chainId === "solana").slice(0, 20);
  const addresses = solana.map((item) => item.tokenAddress);
  const pairs = addresses.length ? await request(`/tokens/v1/solana/${addresses.join(",")}`) : [];
  const candidates = [];
  const seen = new Set();
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    if (pair.chainId !== "solana" || seen.has(pair.baseToken?.address) || !(Number(pair.priceUsd) > 0) || (pair.liquidity?.usd || 0) < 25_000 || (pair.volume?.h24 || 0) < 10_000) continue;
    seen.add(pair.baseToken.address);
    candidates.push({
      token: pair.baseToken.address, symbol: pair.baseToken.symbol,
      priceUsd: Number(pair.priceUsd), liquidityUsd: pair.liquidity?.usd || 0,
      pairUrl: pair.url, score: (pair.volume?.h24 || 0) / Math.max(pair.liquidity?.usd || 1, 1),
      volumeM5Usd: Number(pair.volume?.m5 || 0),
      priceChangeM5Percent: Number(pair.priceChange?.m5 || 0),
      buysM5: Number(pair.txns?.m5?.buys || 0),
      sellsM5: Number(pair.txns?.m5?.sells || 0)
    });
  }
  return candidates.sort((a, b) => b.score - a.score);
}

export function qualifiesMomentum(candidate, momentum) {
  return candidate.liquidityUsd >= momentum.minLiquidityUsd &&
    candidate.volumeM5Usd >= momentum.minVolumeM5Usd &&
    candidate.priceChangeM5Percent >= momentum.minPriceChangeM5Percent &&
    candidate.priceChangeM5Percent <= momentum.maxPriceChangeM5Percent &&
    candidate.buysM5 > candidate.sellsM5;
}

// Returns token -> { priceUsd, liquidityUsd } using the most liquid Solana pair.
export async function currentQuotes(tokens) {
  const prices = new Map();
  const unique = [...new Set(tokens)];
  // Batch endpoint: up to 30 token addresses per request.
  for (let i = 0; i < unique.length; i += 30) {
    const pairs = await request(`/tokens/v1/solana/${unique.slice(i, i + 30).join(",")}`);
    const best = new Map();
    for (const p of Array.isArray(pairs) ? pairs : []) {
      const token = p.baseToken?.address;
      if (p.chainId !== "solana" || !(Number(p.priceUsd) > 0) || !unique.includes(token)) continue;
      if ((p.liquidity?.usd || 0) >= (best.get(token)?.liquidity?.usd || -1)) best.set(token, p);
    }
    for (const [token, pair] of best) prices.set(token, { priceUsd: Number(pair.priceUsd), liquidityUsd: pair.liquidity?.usd || 0 });
  }
  return prices;
}
