import { config } from "./config.js";
import { simulateBuy, simulateSell } from "./costs.js";

export const researchStrategies = Object.freeze([
  { id: "broad", label: "Broad", minLiquidityUsd: 25_000, minScore: 0.05, takeProfitPercent: 15, stopLossPercent: 8 },
  { id: "liquid", label: "Liquid", minLiquidityUsd: 100_000, minScore: 0.1, takeProfitPercent: 15, stopLossPercent: 8 },
  { id: "momentum", label: "Momentum", minLiquidityUsd: 50_000, minScore: 0.25, takeProfitPercent: 20, stopLossPercent: 8 }
]);

const maxPositions = 8;
const tradeUsd = config.maxTradeUsd;

export function ensureResearch(state, now = new Date().toISOString()) {
  state.research ||= { startedAt: now, strategies: researchStrategies.map((strategy) => ({ ...strategy, positions: [], closedTrades: [], equityHistory: [] })) };
  for (const definition of researchStrategies) {
    if (!state.research.strategies.some((strategy) => strategy.id === definition.id)) {
      state.research.strategies.push({ ...definition, positions: [], closedTrades: [], equityHistory: [] });
    }
  }
  for (const strategy of state.research.strategies) strategy.equityHistory ||= [];
  return state.research;
}

function eligible(strategy, candidate) {
  return candidate.liquidityUsd >= strategy.minLiquidityUsd && candidate.score >= strategy.minScore;
}

function close(strategy, position, quote, reason, solPriceUsd, now) {
  const sell = simulateSell({ tokens: position.tokens, priceUsd: quote.priceUsd, liquidityUsd: quote.liquidityUsd, solPriceUsd, rentSol: position.rentSol }, config.fees);
  const pnlUsd = sell.cashInUsd - position.cashOutUsd;
  strategy.closedTrades.push({ token: position.token, symbol: position.symbol, openedAt: position.openedAt, closedAt: now, reason, pnlUsd: Number(pnlUsd.toFixed(4)) });
  strategy.positions = strategy.positions.filter((item) => item !== position);
}

function markToMarket(strategy, quotes, solPriceUsd) {
  const realizedPnlUsd = (strategy.closedTrades || []).reduce((sum, trade) => sum + trade.pnlUsd, 0);
  const unrealizedPnlUsd = (strategy.positions || []).reduce((sum, position) => {
    const quote = quotes.get(position.token);
    if (!quote) return sum;
    const sell = simulateSell({ tokens: position.tokens, priceUsd: quote.priceUsd, liquidityUsd: quote.liquidityUsd, solPriceUsd, rentSol: position.rentSol }, config.fees);
    return sum + sell.cashInUsd - position.cashOutUsd;
  }, 0);
  return { realizedPnlUsd, unrealizedPnlUsd, totalPnlUsd: realizedPnlUsd + unrealizedPnlUsd };
}

// Runs independent forward tests. It never opens or closes a main paper position.
export function advanceResearch(state, quotes, candidates = [], now = new Date().toISOString()) {
  const research = ensureResearch(state, now);
  const solPriceUsd = state.solPriceUsd || config.fees.defaultSolPriceUsd;
  for (const strategy of research.strategies) {
    for (const position of [...strategy.positions]) {
      const quote = quotes.get(position.token);
      if (!quote) continue;
      if (quote.priceUsd <= position.entryPriceUsd * (1 - strategy.stopLossPercent / 100)) close(strategy, position, quote, "stop-loss", solPriceUsd, now);
      else if (quote.priceUsd >= position.entryPriceUsd * (1 + strategy.takeProfitPercent / 100)) close(strategy, position, quote, "take-profit", solPriceUsd, now);
    }
    for (const candidate of candidates) {
      if (strategy.positions.length >= maxPositions || strategy.positions.some((position) => position.token === candidate.token) || !eligible(strategy, candidate)) continue;
      const buy = simulateBuy({ amountUsd: tradeUsd, priceUsd: candidate.priceUsd, liquidityUsd: candidate.liquidityUsd, solPriceUsd }, config.fees);
      strategy.positions.push({ token: candidate.token, symbol: candidate.symbol, entryPriceUsd: candidate.priceUsd, liquidityUsd: candidate.liquidityUsd, tokens: buy.tokens, cashOutUsd: buy.cashOutUsd, rentSol: buy.rentSol, openedAt: now });
    }
    strategy.closedTrades = strategy.closedTrades.slice(-500);
    const equity = markToMarket(strategy, quotes, solPriceUsd);
    strategy.equityHistory = [...(strategy.equityHistory || []), { at: now, pnlUsd: Number(equity.totalPnlUsd.toFixed(4)) }].slice(-240);
  }
  return research;
}

export function researchSummary(research) {
  return (research?.strategies || []).map((strategy) => {
    const closed = strategy.closedTrades || [];
    const pnlUsd = closed.reduce((sum, trade) => sum + trade.pnlUsd, 0);
    const wins = closed.filter((trade) => trade.pnlUsd > 0).length;
    const latest = strategy.equityHistory?.at(-1);
    return { id: strategy.id, label: strategy.label, trades: closed.length, openPositions: strategy.positions.length, pnlUsd: Number(pnlUsd.toFixed(4)), totalPnlUsd: latest?.pnlUsd ?? Number(pnlUsd.toFixed(4)), winRatePercent: closed.length ? Number((wins / closed.length * 100).toFixed(1)) : null, equityHistory: strategy.equityHistory || [] };
  });
}

