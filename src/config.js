export const config = Object.freeze({
  mode: "paper",
  startingCapitalUsd: 100,
  maxTradeUsd: 5,
  takeProfitPercent: 15,
  stopLossPercent: 8,
  maxOpenPositions: 10,
  maxDailyLossUsd: 5,
  scanIntervalMs: Number(process.env.SCAN_INTERVAL_MS || 90_000),
  priceTickMs: Number(process.env.PRICE_TICK_MS || 3_000),
  port: Number(process.env.PORT || 10_000),
  stateFile: process.env.STATE_FILE || "data/state.json"
});

export function assertPaperOnly() {
  if (process.env.TRADING_MODE && process.env.TRADING_MODE !== "paper") {
    throw new Error("Only TRADING_MODE=paper is supported. Live trading is intentionally disabled.");
  }
}
