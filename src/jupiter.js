import { config } from "./config.js";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;

export async function getQuote({ inputMint, outputMint, amount }, jup = config.jupiter, fetchImpl = fetch) {
  const params = new URLSearchParams({ inputMint, outputMint, amount: String(amount), slippageBps: String(Math.round(config.fees.slippagePercent * 100)) });
  const headers = { accept: "application/json", ...(jup.apiKey ? { "x-api-key": jup.apiKey } : {}) };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchImpl(`${jup.baseUrl}/quote?${params}`, { headers, signal: AbortSignal.timeout(10_000) });
    if (response.ok) {
      const quote = await response.json();
      if (!quote.outAmount) throw new Error("Jupiter returned no route");
      return quote;
    }
    if (response.status !== 429 || attempt === 2) throw new Error(`Jupiter responded with ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
}

const route = (quote) => (quote.routePlan || []).map((r) => r.swapInfo?.label).filter(Boolean).join(" → ");

// Simulated buy of `amountUsd` USDC worth of `mint`, priced by a real Jupiter quote.
// Token decimals are inferred from the market price: raw * price / 10^d ≈ amountUsd.
export async function quoteBuy({ mint, amountUsd, priceUsd }, jup, fetchImpl) {
  const quote = await getQuote({ inputMint: USDC_MINT, outputMint: mint, amount: Math.round(amountUsd * 10 ** USDC_DECIMALS) }, jup, fetchImpl);
  const quotedRaw = Number(quote.outAmount);
  const decimals = Math.round(Math.log10((quotedRaw * priceUsd) / amountUsd));
  if (!Number.isFinite(decimals) || decimals < 0 || decimals > 18) throw new Error("Jupiter quote does not match market price");
  const rawTokens = quotedRaw;
  const quotedValueUsd = (quotedRaw / 10 ** decimals) * priceUsd;
  return {
    source: "jupiter",
    route: route(quote),
    priceImpactPct: Number(quote.priceImpactPct || 0) * 100,
    rawTokens: String(rawTokens),
    decimals,
    tokens: rawTokens / 10 ** decimals,
    // Quote-vs-chart differences are execution deltas, not on-chain fees.
    quoteReferenceDeviationPct: amountUsd ? Number((((quotedValueUsd - amountUsd) / amountUsd) * 100).toFixed(4)) : 0,
    feesUsd: { swap: 0, slippage: 0 }
  };
}

export async function quoteSell({ mint, rawTokens, tokens, priceUsd }, jup, fetchImpl) {
  const quote = await getQuote({ inputMint: mint, outputMint: USDC_MINT, amount: rawTokens }, jup, fetchImpl);
  const quotedUsd = Number(quote.outAmount) / 10 ** USDC_DECIMALS;
  const referenceUsd = tokens * priceUsd;
  return {
    source: "jupiter",
    route: route(quote),
    priceImpactPct: Number(quote.priceImpactPct || 0) * 100,
    usdOut: quotedUsd,
    quotePriceUsd: tokens > 0 ? quotedUsd / tokens : 0,
    quoteReferenceDeviationPct: referenceUsd > 0 ? Number((((quotedUsd - referenceUsd) / referenceUsd) * 100).toFixed(4)) : 0,
    feesUsd: { swap: 0, slippage: 0 }
  };
}
