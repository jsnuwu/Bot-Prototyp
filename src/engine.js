import { config } from "./config.js";
import { networkFeeUsd, simulateBuy, simulateSell, sumFees } from "./costs.js";
import { resetDailyLossIfNeeded } from "./state.js";

const solPrice = (state) => state.solPriceUsd || config.fees.defaultSolPriceUsd;

// Positions opened before fees were modelled have no token amount stored.
function normalise(position) {
  return {
    tokens: position.amountUsd / position.entryPriceUsd,
    costUsd: position.amountUsd,
    rentSol: 0,
    ...position
  };
}

export function canOpen(state, fees = config.fees) {
  const sol = solPrice(state);
  const network = networkFeeUsd(sol, fees);
  const roundTripCosts = 2 * network + config.maxTradeUsd * 2 * (fees.dexFeePercent + fees.slippagePercent) / 100;
  const worstCaseLoss = config.maxTradeUsd * (config.stopLossPercent / 100) + roundTripCosts;
  return state.positions.length < config.maxOpenPositions &&
    state.cashUsd >= config.maxTradeUsd + network + fees.tokenAccountRentSol * sol &&
    state.dailyLossUsd + worstCaseLoss <= config.maxDailyLossUsd;
}

// `execution` (optional) is a real Jupiter quote from jupiter.js; without it the cost model in costs.js is used.
export function openPaperPosition(state, candidate, now = new Date().toISOString(), fees = config.fees, execution = null) {
  if (!canOpen(state, fees) || !(candidate.priceUsd > 0)) return false;
  const amount = config.maxTradeUsd;
  const sol = solPrice(state);
  const network = networkFeeUsd(sol, fees);
  const model = execution ? null : simulateBuy({ amountUsd: amount, priceUsd: candidate.priceUsd, liquidityUsd: candidate.liquidityUsd, solPriceUsd: sol }, fees);
  const tokens = execution ? execution.tokens : model.tokens;
  const feeParts = execution ? { ...execution.feesUsd, network } : model.feesUsd;
  const feesUsd = sumFees(feeParts);
  state.cashUsd -= amount + network + fees.tokenAccountRentSol * sol;
  state.feesPaidUsd = (state.feesPaidUsd || 0) + feesUsd;
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
    if (price >= position.entryPriceUsd * (1 + config.takeProfitPercent / 100)) return [{ position, price, reason: "take-profit" }];
    if (price <= position.entryPriceUsd * (1 - config.stopLossPercent / 100)) return [{ position, price, reason: "stop-loss" }];
    return [];
  });
}

export function closePosition(state, raw, price, reason, now = new Date().toISOString(), fees = config.fees, execution = null) {
  const position = normalise(raw);
  const sol = solPrice(state);
  const network = networkFeeUsd(sol, fees);
  const rentUsd = position.rentSol * sol;
  let cashIn, feeParts;
  if (execution) {
    cashIn = Math.max(0, execution.usdOut - network) + rentUsd;
    feeParts = { ...execution.feesUsd, network };
  } else {
    const sell = simulateSell({ tokens: position.tokens, priceUsd: price, liquidityUsd: position.liquidityUsd, solPriceUsd: sol, rentSol: position.rentSol }, fees);
    cashIn = sell.cashInUsd;
    feeParts = sell.feesUsd;
  }
  const sellFees = sumFees(feeParts);
  const pnl = cashIn - rentUsd - position.costUsd;
  state.cashUsd = Number((state.cashUsd + cashIn).toFixed(6));
  state.feesPaidUsd = (state.feesPaidUsd || 0) + sellFees;
  if (pnl < 0) state.dailyLossUsd = Number((state.dailyLossUsd - pnl).toFixed(4));
  const totalFees = (position.buyFeesUsd || 0) + sellFees;
  state.closedTrades.push({ ...raw, exitPriceUsd: price, closedAt: now, pnlUsd: Number(pnl.toFixed(4)), feesUsd: Number(totalFees.toFixed(4)), exitPricing: execution ? "jupiter" : "model", reason });
  const label = reason === "take-profit" ? "Take profit" : "Stop loss";
  const via = execution ? " · via " + (execution.route || "Jupiter") : "";
  state.events = [{ at: now, type: reason, token: position.symbol || position.token, detail: `${label} · net ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)} · fees $${totalFees.toFixed(3)}${via}` }, ...(state.events || [])].slice(0, 30);
  state.positions = state.positions.filter((p) => p !== raw);
}

// Synchronous variant using the cost model only.
export function closeEligiblePositions(state, prices, now = new Date().toISOString(), fees = config.fees) {
  resetDailyLossIfNeeded(state);
  for (const exit of exitsDue(state, prices)) closePosition(state, exit.position, exit.price, exit.reason, now, fees);
}

// Net liquidation value: cash plus what every position would return if sold now.
export function portfolioValue(state, prices = new Map(), fees = config.fees) {
  return state.cashUsd + state.positions.reduce((total, raw) => {
    const p = normalise(raw);
    const price = prices.get(p.token) || p.entryPriceUsd;
    return total + simulateSell({ tokens: p.tokens, priceUsd: price, liquidityUsd: p.liquidityUsd, solPriceUsd: solPrice(state), rentSol: p.rentSol }, fees).cashInUsd;
  }, 0);
}
