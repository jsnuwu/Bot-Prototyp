
import { config } from "./config.js";
import { networkFeeUsd, simulateBuy, simulateSell, sumFees } from "./costs.js";
import { resetDailyLossIfNeeded } from "./state.js";

const solPrice = (state) => state.solPriceUsd || config.fees.defaultSolPriceUsd;

// Uses the live priority fee from the Solana RPC once it is known.
const liveFees = (state) => (Number.isFinite(state.priorityFeeSol) ? { ...config.fees, priorityFeeSol: state.priorityFeeSol } : config.fees);

function isCoolingDown(state, token, now) {
  const closedAt = (state.closedTrades || []).findLast((trade) => trade.token === token)?.closedAt;
  return Boolean(closedAt) && Date.parse(now) - Date.parse(closedAt) < config.reentryCooldownMs;
}

function hasAcceptableExecution(execution, network) {
  if (!execution) return true;
  const entryFees = sumFees({ ...execution.feesUsd, network });
  return execution.priceImpactPct <= config.maxQuotePriceImpactPct && entryFees <= config.maxEntryFeeUsd;
}

function isEntryPaused(state, now) {
  return Date.parse(state.entryPausedUntil || 0) > Date.parse(now);
}

function updateLossStreakPause(state, now) {
  const since = Date.parse(now) - config.lossStreakWindowMs;
  const recentStops = (state.closedTrades || []).filter((trade) =>
    trade.reason === "stop-loss" && trade.pnlUsd < 0 && Date.parse(trade.closedAt) >= since
  );
  if (recentStops.length >= config.lossStreakLimit) {
    state.entryPausedUntil = new Date(Date.parse(now) + config.lossStreakPauseMs).toISOString();
  }
}

export function executionConfirmsExit(position, execution, reason) {
  if (!execution?.quotePriceUsd || !position.fillPriceUsd) return true;
  const quoteMovePct = (execution.quotePriceUsd / position.fillPriceUsd - 1) * 100;
  if (reason === "take-profit-2") return quoteMovePct >= config.takeProfitTwoPercent;
  if (reason === "take-profit-1") return quoteMovePct >= config.takeProfitPercent;
  if (reason === "stop-loss") return quoteMovePct <= -config.stopLossPercent;
  if (reason === "trailing-stop") return quoteMovePct <= (position.peakPriceUsd / position.fillPriceUsd - 1 - config.trailingStopPercent);
  return true;
}

// Positions opened before fees were modelled have no token amount stored.
function normalise(position) {
  return {
    tokens: position.amountUsd / position.entryPriceUsd,
    costUsd: position.amountUsd,
    rentSol: 0,
    ...position
  };
}

export function canOpen(state, fees = liveFees(state)) {
  const sol = solPrice(state);
  const network = networkFeeUsd(sol, fees);
  const roundTripCosts = 2 * network + config.maxTradeUsd * 2 * (fees.dexFeePercent + fees.slippagePercent) / 100;
  const worstCaseLoss = config.maxTradeUsd * (config.stopLossPercent / 100) + roundTripCosts;
  return state.positions.length < config.maxOpenPositions &&
    !isEntryPaused(state, new Date().toISOString()) &&
    state.cashUsd >= config.maxTradeUsd + network + fees.tokenAccountRentSol * sol &&
    (!config.maxDailyLossUsd || state.dailyLossUsd + worstCaseLoss <= config.maxDailyLossUsd);
}

// `execution` (optional) is a real Jupiter quote from jupiter.js; without it the cost model in costs.js is used.
export function openPaperPosition(state, candidate, now = new Date().toISOString(), fees = liveFees(state), execution = null) {
  const network = networkFeeUsd(solPrice(state), fees);
  if (!canOpen(state, fees) || !(candidate.priceUsd > 0) || isCoolingDown(state, candidate.token, now) || !hasAcceptableExecution(execution, network)) return false;
  const amount = config.maxTradeUsd;
  const sol = solPrice(state);
  const model = execution ? null : simulateBuy({ amountUsd: amount, priceUsd: candidate.priceUsd, liquidityUsd: candidate.liquidityUsd, solPriceUsd: sol }, fees);
  const tokens = execution ? execution.tokens : model.tokens;
  const feeParts = execution ? { ...execution.feesUsd, network } : model.feesUsd;
  const feesUsd = sumFees(feeParts);
  state.cashUsd -= amount + network + fees.tokenAccountRentSol * sol;
  state.feesPaidUsd = (state.feesPaidUsd || 0) + feesUsd;
  state.slippagePaidUsd = (state.slippagePaidUsd || 0) + (feeParts.slippage || 0);
  state.positions.push({
    token: candidate.token, symbol: candidate.symbol, pairUrl: candidate.pairUrl,
    entryPriceUsd: candidate.priceUsd, fillPriceUsd: amount / tokens, amountUsd: amount,
    tokens, rawTokens: execution?.rawTokens, decimals: execution?.decimals,
    liquidityUsd: candidate.liquidityUsd, rentSol: fees.tokenAccountRentSol,
    costUsd: amount + network, buyFeesUsd: Number(feesUsd.toFixed(4)),
    pricing: execution ? "jupiter" : "model", route: execution?.route, openedAt: now
  });
  const via = execution ? `via ${execution.route || "Jupiter"}` : "model fees";
  state.events = [{ at: now, type: "opened", token: candidate.symbol || candidate.token, detail: `Bought $${amount.toFixed(2)} ${candidate.symbol || ""} · fees $${feesUsd.toFixed(3)} · ${via}` }, ...(state.events || [])].slice(0, 30);
  return true;
}

// Positions whose market price hit take profit or stop loss.
export function exitsDue(state, prices) {
  return state.positions.flatMap((position) => {
    const price = prices.get(position.token);
    if (!price || price <= 0) return [];
    position.peakPriceUsd = Math.max(position.peakPriceUsd || position.entryPriceUsd, price);
    if (price <= position.entryPriceUsd * (1 - config.stopLossPercent / 100)) return [{ position, price, reason: "stop-loss" }];
    if (position.takeProfitOneTaken && price <= position.peakPriceUsd * (1 - config.trailingStopPercent / 100)) return [{ position, price, reason: "trailing-stop" }];
    if (position.takeProfitOneTaken && price >= position.entryPriceUsd * (1 + config.takeProfitTwoPercent / 100)) return [{ position, price, reason: "take-profit-2" }];
    if (!position.takeProfitOneTaken && price >= position.entryPriceUsd * (1 + config.takeProfitPercent / 100)) return [{ position, price, reason: "take-profit-1", fraction: config.takeProfitFraction }];
    return [];
  });
}

export function closePosition(state, raw, price, reason, now = new Date().toISOString(), fees = liveFees(state), execution = null, fraction = 1) {
  const position = normalise(raw);
  const sellFraction = Math.max(0, Math.min(1, fraction));
  const sol = solPrice(state);
  const network = networkFeeUsd(sol, fees);
  const finalExit = sellFraction >= 1;
  const rentUsd = finalExit ? position.rentSol * sol : 0;
  const soldTokens = position.tokens * sellFraction;
  let cashIn, feeParts;
  if (execution) {
    cashIn = Math.max(0, execution.usdOut - network) + rentUsd;
    feeParts = { ...execution.feesUsd, network };
  } else {
    const sell = simulateSell({ tokens: soldTokens, priceUsd: price, liquidityUsd: position.liquidityUsd, solPriceUsd: sol, rentSol: finalExit ? position.rentSol : 0 }, fees);
    cashIn = sell.cashInUsd;
    feeParts = sell.feesUsd;
  }
  const sellFees = sumFees(feeParts);
  const costUsd = position.costUsd * sellFraction;
  const pnl = cashIn - rentUsd - costUsd;
  state.cashUsd = Number((state.cashUsd + cashIn).toFixed(6));
  state.feesPaidUsd = (state.feesPaidUsd || 0) + sellFees;
  state.slippagePaidUsd = (state.slippagePaidUsd || 0) + (feeParts.slippage || 0);
  if (pnl < 0) state.dailyLossUsd = Number((state.dailyLossUsd - pnl).toFixed(4));
  const totalFees = (position.buyFeesUsd || 0) * sellFraction + sellFees;
  state.closedTrades.push({ ...raw, amountUsd: Number((position.amountUsd * sellFraction).toFixed(6)), tokens: soldTokens, exitPriceUsd: price, closedAt: now, pnlUsd: Number(pnl.toFixed(4)), feesUsd: Number(totalFees.toFixed(4)), exitPricing: execution ? "jupiter" : "model", reason, partial: !finalExit });
  const label = reason === "take-profit-1" ? "Take profit 1" : reason === "take-profit-2" ? "Take profit 2" : reason === "trailing-stop" ? "Trailing stop" : "Stop loss";
  const via = execution ? " · via " + (execution.route || "Jupiter") : "";
  state.events = [{ at: now, type: reason, token: position.symbol || position.token, detail: `${label} · net ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)} · fees $${totalFees.toFixed(3)}${via}` }, ...(state.events || [])].slice(0, 30);
  if (finalExit) state.positions = state.positions.filter((p) => p !== raw);
  else {
    raw.amountUsd = position.amountUsd * (1 - sellFraction);
    raw.costUsd = position.costUsd * (1 - sellFraction);
    raw.buyFeesUsd = (position.buyFeesUsd || 0) * (1 - sellFraction);
    raw.tokens = position.tokens * (1 - sellFraction);
    if (raw.rawTokens) raw.rawTokens = (BigInt(raw.rawTokens) * BigInt(Math.round((1 - sellFraction) * 10_000)) / 10_000n).toString();
    raw.takeProfitOneTaken = true;
  }
  if (finalExit) updateLossStreakPause(state, now);
}

// Synchronous variant using the cost model only.
export function closeEligiblePositions(state, prices, now = new Date().toISOString(), fees = liveFees(state)) {
  resetDailyLossIfNeeded(state);
  for (const exit of exitsDue(state, prices)) closePosition(state, exit.position, exit.price, exit.reason, now, fees, null, exit.fraction);
}

// Net liquidation value: cash plus what every position would return if sold now.
export function portfolioValue(state, prices = new Map(), fees = liveFees(state)) {
  return state.cashUsd + state.positions.reduce((total, raw) => {
    const p = normalise(raw);
    const price = prices.get(p.token) || p.entryPriceUsd;
    return total + simulateSell({ tokens: p.tokens, priceUsd: price, liquidityUsd: p.liquidityUsd, solPriceUsd: solPrice(state), rentSol: p.rentSol }, fees).cashInUsd;
  }, 0);
}

