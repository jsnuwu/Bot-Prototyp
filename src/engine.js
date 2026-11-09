import { config } from "./config.js";
import { resetDailyLossIfNeeded } from "./state.js";

export function canOpen(state) {
  const worstCaseLoss = config.maxTradeUsd * (config.stopLossPercent / 100);
  return state.positions.length < config.maxOpenPositions &&
    state.cashUsd >= config.maxTradeUsd &&
    state.dailyLossUsd + worstCaseLoss <= config.maxDailyLossUsd;
}

export function openPaperPosition(state, candidate, now = new Date().toISOString()) {
  if (!canOpen(state) || candidate.priceUsd <= 0) return false;
  const amount = Math.min(config.maxTradeUsd, state.cashUsd);
  state.cashUsd -= amount;
  state.positions.push({ token: candidate.token, pairUrl: candidate.pairUrl, entryPriceUsd: candidate.priceUsd, amountUsd: amount, openedAt: now });
  state.events = [{ at: now, type: "opened", token: candidate.symbol || candidate.token, detail: `Opened $${amount.toFixed(2)} paper position` }, ...(state.events || [])].slice(0, 30);
  return true;
}

export function closeEligiblePositions(state, prices, now = new Date().toISOString()) {
  resetDailyLossIfNeeded(state);
  const remaining = [];
  for (const position of state.positions) {
    const price = prices.get(position.token);
    if (!price || price <= 0) { remaining.push(position); continue; }
    const percent = ((price - position.entryPriceUsd) / position.entryPriceUsd) * 100;
    const takeProfit = price >= position.entryPriceUsd * (1 + config.takeProfitPercent / 100);
    const stopLoss = price <= position.entryPriceUsd * (1 - config.stopLossPercent / 100);
    if (!takeProfit && !stopLoss) { remaining.push(position); continue; }
    const proceeds = position.amountUsd * (1 + percent / 100);
    const pnl = proceeds - position.amountUsd;
    state.cashUsd = Number((state.cashUsd + proceeds).toFixed(4));
    if (pnl < 0) state.dailyLossUsd = Number((state.dailyLossUsd - pnl).toFixed(4));
    state.closedTrades.push({ ...position, exitPriceUsd: price, closedAt: now, pnlUsd: Number(pnl.toFixed(4)), reason: takeProfit ? "take-profit" : "stop-loss" });
    state.events = [{ at: now, type: takeProfit ? "take-profit" : "stop-loss", token: position.token, detail: `${takeProfit ? "Take profit" : "Stop loss"} · ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}` }, ...(state.events || [])].slice(0, 30);
  }
  state.positions = remaining;
}

export function portfolioValue(state, prices = new Map()) {
  return state.cashUsd + state.positions.reduce((total, p) => total + p.amountUsd * ((prices.get(p.token) || p.entryPriceUsd) / p.entryPriceUsd), 0);
}
