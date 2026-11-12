import test from "node:test";
import assert from "node:assert/strict";
import { canOpen, closeEligiblePositions, executionConfirmsExit, openPaperPosition, portfolioValue } from "../src/engine.js";
import { simulateBuy, simulateSell } from "../src/costs.js";
import { config } from "../src/config.js";

const today = () => new Date().toISOString().slice(0, 10);
const noFees = { dexFeePercent: 0, slippagePercent: 0, baseFeeSol: 0, priorityFeeSol: 0, tokenAccountRentSol: 0, defaultSolPriceUsd: 150 };
const fees = { dexFeePercent: 0.25, slippagePercent: 0.5, baseFeeSol: 0.000005, priorityFeeSol: 0.0005, tokenAccountRentSol: 0.002, defaultSolPriceUsd: 150 };
const trade = config.maxTradeUsd;
const fresh = () => ({ cashUsd: 100, positions: [], closedTrades: [], dailyLossUsd: 0, lossDate: today(), solPriceUsd: 100 });

test("without fees: takes partial profit then exits the remaining position", () => {
  const state = fresh();
  assert.equal(openPaperPosition(state, { token: "t", priceUsd: 1, liquidityUsd: 0 }, undefined, noFees), true);
  assert.equal(state.cashUsd, 100 - trade);
  closeEligiblePositions(state, new Map([["t", 1.15]]), undefined, noFees);
  assert.equal(state.closedTrades[0].reason, "take-profit-1");
  assert.equal(state.positions.length, 1);
  closeEligiblePositions(state, new Map([["t", 1.35]]), undefined, noFees);
  assert.equal(state.closedTrades[1].reason, "take-profit-2");
  assert.equal(state.positions.length, 0);
  assert.ok(Math.abs(state.cashUsd - (100 + trade * 0.25)) < 1e-9);
});

test("with fees: buy and sell costs reduce the net result", () => {
  const state = fresh();
  openPaperPosition(state, { token: "t", priceUsd: 1, liquidityUsd: 50_000 }, undefined, fees);
  // Trade amount + network 0.000505 SOL + rent 0.002 SOL at $100/SOL
  assert.ok(Math.abs(state.cashUsd - (100 - trade - 0.0505 - 0.2)) < 1e-9);
  assert.ok(state.positions[0].tokens < trade);
  // Immediately after buying, the net liquidation value is below 100.
  assert.ok(portfolioValue(state, new Map([["t", 1]]), fees) < 100);
  closeEligiblePositions(state, new Map([["t", 1.15]]), undefined, fees);
  closeEligiblePositions(state, new Map([["t", 1.35]]), undefined, fees);
  const pnl = state.closedTrades.reduce((total, trade) => total + trade.pnlUsd, 0);
  assert.ok(pnl > 0 && pnl < trade * 0.25, `net pnl ${pnl}`);
  assert.ok(state.closedTrades.reduce((total, trade) => total + trade.feesUsd, 0) > 0.1);
  // Rent is refunded when the final half is sold, so cash = 100 + total net P&L.
  assert.ok(Math.abs(state.cashUsd - (100 + pnl)) < 1e-4);
  assert.ok(state.feesPaidUsd > 0);
});

test("stop loss with fees counts the full net loss against the daily cap", () => {
  const state = fresh();
  openPaperPosition(state, { token: "t", priceUsd: 1, liquidityUsd: 50_000 }, undefined, fees);
  closeEligiblePositions(state, new Map([["t", 0.92]]), undefined, fees);
  assert.equal(state.closedTrades[0].reason, "stop-loss");
  assert.ok(state.dailyLossUsd > 0.4);
});

test("price impact grows with lower liquidity", () => {
  const deep = simulateBuy({ amountUsd: 5, priceUsd: 1, liquidityUsd: 1_000_000, solPriceUsd: 100 }, fees);
  const thin = simulateBuy({ amountUsd: 5, priceUsd: 1, liquidityUsd: 20_000, solPriceUsd: 100 }, fees);
  assert.ok(thin.feesUsd.impact > deep.feesUsd.impact);
  const sell = simulateSell({ tokens: 5, priceUsd: 1, liquidityUsd: 20_000, solPriceUsd: 100, rentSol: 0.002 }, fees);
  assert.ok(sell.cashInUsd < 5 + 0.2);
});

test("legacy positions without token amount still close", () => {
  const state = { ...fresh(), cashUsd: 95, positions: [{ token: "t", entryPriceUsd: 1, amountUsd: 5 }] };
  closeEligiblePositions(state, new Map([["t", 0.92]]), undefined, noFees);
  assert.equal(state.dailyLossUsd, 0.4);
});

test("rejects expensive Jupiter entries before they create a position", () => {
  const state = fresh();
  const execution = { tokens: 4, feesUsd: { swap: 0.3, slippage: 0.02 }, priceImpactPct: 1 };
  assert.equal(openPaperPosition(state, { token: "t", priceUsd: 1, liquidityUsd: 80_000 }, undefined, fees, execution), false);
  assert.equal(state.positions.length, 0);
});

test("does not immediately re-enter a token after it closes", () => {
  const state = fresh();
  const openedAt = "2026-11-10T10:00:00.000Z";
  assert.equal(openPaperPosition(state, { token: "t", priceUsd: 1, liquidityUsd: 80_000 }, openedAt, noFees), true);
  closeEligiblePositions(state, new Map([["t", 1.15]]), "2026-11-10T10:01:00.000Z", noFees);
  assert.equal(openPaperPosition(state, { token: "t", priceUsd: 1, liquidityUsd: 80_000 }, "2026-11-10T10:02:00.000Z", noFees), false);
});

test("keeps opening paper trades after the displayed daily loss", () => {
  const state = { ...fresh(), dailyLossUsd: 100 };
  assert.equal(canOpen(state, noFees), true);
});

test("trailing stop closes the remaining half after TP1", () => {
  const state = fresh();
  openPaperPosition(state, { token: "t", priceUsd: 1, liquidityUsd: 100_000 }, undefined, noFees);
  closeEligiblePositions(state, new Map([["t", 1.15]]), undefined, noFees);
  closeEligiblePositions(state, new Map([["t", 1.25]]), undefined, noFees);
  closeEligiblePositions(state, new Map([["t", 1.15]]), undefined, noFees);
  assert.equal(state.closedTrades.at(-1).reason, "trailing-stop");
  assert.equal(state.positions.length, 0);
});

test("does not take profit when an executable quote contradicts the chart price", () => {
  const position = { fillPriceUsd: 1, peakPriceUsd: 1.5 };
  assert.equal(executionConfirmsExit(position, { quotePriceUsd: 1.02 }, "take-profit-1"), false);
  assert.equal(executionConfirmsExit(position, { quotePriceUsd: 1.16 }, "take-profit-1"), true);
  assert.equal(executionConfirmsExit(position, { quotePriceUsd: 1.2 }, "take-profit-2"), false);
  assert.equal(executionConfirmsExit(position, { quotePriceUsd: 1.36 }, "take-profit-2"), true);
  const momentumPosition = { ...position, exitRules: { takeProfitPercent: 10, takeProfitTwoPercent: 22, stopLossPercent: 6, trailingStopPercent: 5 } };
  assert.equal(executionConfirmsExit(momentumPosition, { quotePriceUsd: 1.11 }, "take-profit-1"), true);
  assert.equal(executionConfirmsExit(momentumPosition, { quotePriceUsd: 1.2 }, "take-profit-2"), false);
  assert.equal(executionConfirmsExit(momentumPosition, { quotePriceUsd: 1.23 }, "take-profit-2"), true);
});
