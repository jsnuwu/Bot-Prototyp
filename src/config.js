export const config = Object.freeze({
  mode: "paper",
  startingCapitalUsd: 100,
  maxTradeUsd: 5,
  takeProfitPercent: 15,
  stopLossPercent: 8,
  maxOpenPositions: 10,
  maxDailyLossUsd: 5,
  scanIntervalMs: Number(process.env.SCAN_INTERVAL_MS || 60_000),
  priceTickMs: Number(process.env.PRICE_TICK_MS || 3_000),
  // Render free services sleep after ~15 min without inbound traffic.
  keepAliveUrl: process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || "",
  keepAliveMs: Number(process.env.KEEP_ALIVE_MS || 600_000),
  // Realistic execution costs applied to every simulated swap.
  fees: Object.freeze({
    dexFeePercent: Number(process.env.DEX_FEE_PERCENT || 0.25),
    slippagePercent: Number(process.env.SLIPPAGE_PERCENT || 0.5),
    baseFeeSol: 0.000005,
    priorityFeeSol: Number(process.env.PRIORITY_FEE_SOL || 0.0005),
    tokenAccountRentSol: 0.00203928,
    defaultSolPriceUsd: 150
  }),
  // Jupiter quotes provide real route, DEX fee and price-impact data for every simulated swap.
  jupiter: Object.freeze({
    enabled: process.env.JUPITER_ENABLED !== "false",
    apiKey: process.env.JUPITER_API_KEY || "",
    baseUrl: process.env.JUPITER_API_URL || (process.env.JUPITER_API_KEY ? "https://api.jup.ag/swap/v1" : "https://lite-api.jup.ag/swap/v1")
  }),
  rpcUrl: process.env.SOLANA_RPC_URL || "",
  priorityFeeRefreshMs: 60_000,
  // Reject routes whose entry friction would consume too much of a $5 trade.
  maxEntryFeeUsd: Number(process.env.MAX_ENTRY_FEE_USD || 0.20),
  maxQuotePriceImpactPct: Number(process.env.MAX_QUOTE_PRICE_IMPACT_PCT || 2),
  // Avoid repeatedly buying the same boosted token after an exit.
  reentryCooldownMs: Number(process.env.REENTRY_COOLDOWN_MS || 30 * 60_000),
  port: Number(process.env.PORT || 10_000),
  databaseUrl: process.env.DATABASE_URL || "",
  stateFile: process.env.STATE_FILE || "data/state.json"
});

export function assertPaperOnly() {
  if (process.env.TRADING_MODE && process.env.TRADING_MODE !== "paper") {
    throw new Error("Only TRADING_MODE=paper is supported. Live trading is intentionally disabled.");
  }
}
