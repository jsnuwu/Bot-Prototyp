const API = "https://api.dexscreener.com";

async function request(path) {
  const response = await fetch(`${API}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`DexScreener responded with ${response.status}`);
  return response.json();
}

export async function discoverCandidates() {
  const boosts = await request("/token-boosts/latest/v1");
  const solana = boosts.filter((item) => item.chainId === "solana").slice(0, 20);
  const candidates = [];
  for (const item of solana) {
    const result = await request(`/latest/dex/tokens/${item.tokenAddress}`);
    const pair = (result.pairs || []).find((p) => p.chainId === "solana" && Number(p.priceUsd) > 0 && (p.liquidity?.usd || 0) >= 25_000 && (p.volume?.h24 || 0) >= 10_000);
    if (!pair) continue;
    candidates.push({ token: pair.baseToken.address, symbol: pair.baseToken.symbol, priceUsd: Number(pair.priceUsd), pairUrl: pair.url, score: (pair.volume?.h24 || 0) / Math.max(pair.liquidity?.usd || 1, 1) });
  }
  return candidates.sort((a, b) => b.score - a.score);
}

export async function currentPrices(tokens) {
  const prices = new Map();
  for (const token of tokens) {
    const result = await request(`/latest/dex/tokens/${token}`);
    const pair = (result.pairs || []).find((p) => p.chainId === "solana" && Number(p.priceUsd) > 0);
    if (pair) prices.set(token, Number(pair.priceUsd));
  }
  return prices;
}
