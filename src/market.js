const API = "https://api.dexscreener.com";

async function request(path) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${API}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (response.ok) return response.json();
    if (response.status !== 429 || attempt === 2) throw new Error(`DexScreener responded with ${response.status}`);
    const retryAfterSeconds = Number(response.headers.get("retry-after") || 2);
    await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(retryAfterSeconds, 1), 10) * 1_000));
  }
}

export async function discoverCandidates() {
  const boosts = await request("/token-boosts/latest/v1");
  const solana = boosts.filter((item) => item.chainId === "solana").slice(0, 5);
  const candidates = [];
  for (const item of solana) {
    const result = await request(`/latest/dex/tokens/${item.tokenAddress}`);
    const pair = (result.pairs || []).find((p) => p.chainId === "solana" && Number(p.priceUsd) > 0 && (p.liquidity?.usd || 0) >= 25_000 && (p.volume?.h24 || 0) >= 10_000);
    if (!pair) continue;
    candidates.push({ token: pair.baseToken.address, symbol: pair.baseToken.symbol, priceUsd: Number(pair.priceUsd), liquidityUsd: pair.liquidity?.usd || 0, pairUrl: pair.url, score: (pair.volume?.h24 || 0) / Math.max(pair.liquidity?.usd || 1, 1) });
  }
  return candidates.sort((a, b) => b.score - a.score);
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
