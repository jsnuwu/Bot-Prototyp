// Performance summary over all closed paper trades.
export function computeStats(state, portfolioUsd, startingCapitalUsd = 100) {
  const trades = state.closedTrades || [];
  const pnls = trades.map((t) => t.pnlUsd);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p <= 0);
  const sum = (a) => a.reduce((t, v) => t + v, 0);
  const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
  const holdMinutes = trades.filter((t) => t.openedAt && t.closedAt).map((t) => (Date.parse(t.closedAt) - Date.parse(t.openedAt)) / 60_000);
  return {
    since: state.startedAt || null,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePercent: trades.length ? round((wins.length / trades.length) * 100, 1) : null,
    realizedPnlUsd: round(sum(pnls)),
    avgPnlUsd: trades.length ? round(sum(pnls) / trades.length, 3) : null,
    avgWinUsd: wins.length ? round(sum(wins) / wins.length, 3) : null,
    avgLossUsd: losses.length ? round(sum(losses) / losses.length, 3) : null,
    profitFactor: losses.length && sum(losses) < 0 ? round(sum(wins) / -sum(losses)) : null,
    bestTradeUsd: trades.length ? round(Math.max(...pnls), 3) : null,
    worstTradeUsd: trades.length ? round(Math.min(...pnls), 3) : null,
    feesPaidUsd: round(state.feesPaidUsd || 0),
    avgHoldMinutes: holdMinutes.length ? round(sum(holdMinutes) / holdMinutes.length, 1) : null,
    returnPercent: round(((portfolioUsd - startingCapitalUsd) / startingCapitalUsd) * 100)
  };
}

const CSV_COLUMNS = ["openedAt", "closedAt", "symbol", "token", "reason", "entryPriceUsd", "fillPriceUsd", "exitPriceUsd", "amountUsd", "pnlUsd", "feesUsd", "pricing", "exitPricing", "route"];

export function tradesCsv(trades) {
  const cell = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [CSV_COLUMNS.join(","), ...trades.map((t) => CSV_COLUMNS.map((c) => cell(t[c])).join(","))].join("\n") + "\n";
}
