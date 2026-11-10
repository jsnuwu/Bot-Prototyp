import test from "node:test";
import assert from "node:assert/strict";
import { canOpen, closeEligiblePositions, openPaperPosition, portfolioValue } from "../src/engine.js";
import { simulateBuy, simulateSell } from "../src/costs.js";

const today = () => new Date().toISOString().slice(0, 10);
const noFees = { dexFeePercent: 0, slippagePercent: 0, baseFeeSol: 0, priorityFeeSol: 0, tokenAccountRentSol: 0, defaultSolPriceUsd: 150 };
const fees = { dexFeePercent: 0.25, slippagePercent: 0.5, baseFeeSol: 0.000005, priorityFeeSol: 0.0005, tokenAccountRentSol: 0.002, defaultSolPriceUsd: 150 };
const fresh = () => ({ cashUsd: 100, positions: [], closedTrades: [], dailyLossUsd: 0, lossDate: today(), solPriceUsd: 100 });

test("without fees: opens $5 and closes at take profit for exactly +15%", () => {
  const state = fresh();
  assert.equal(openPaperPosition(state, { token: "t", priceUsd: 1, liquidityUsd: 0 }, undefined, noFees), true);
  assert.equal(state.cashUsd, 95);
  closeEligiblePositions(state, new Map([["t", 1.15]]), undefined, noFees);
  assert.equal(state.closedTrades[0].reason, "take-profit");
  assert.ok(Math.abs(state.cashUsd - 100.75) < 1e-9);
});

test("with fees: buy and sell costs reduce the net result", () => {
  const state = fresh();
  openPaperPosition(state, { token: "t", priceUsd: 1, liquidityUsd: 50_000 }, undefined, fees);
  // $5 + network 0.000505 SOL + rent 0.002 SOL at $100/SOL
  assert.ok(Math.abs(state.cashUsd - (100 - 5 - 0.0505 - 0.2)) < 1e-9);
  assert.ok(state.positions[0].tokens < 5);
  // Immediately after buying, the net liquidation value is below 100.
  assert.ok(portfolioValue(state, new Map([["t", 1]]), fees) < 100);
  closeEligiblePositions(state, new Map([["t", 1.15]]), undefined, fees);
  const trade = state.closedTrades[0];
  assert.ok(trade.pnlUsd > 0 && trade.pnlUsd < 0.75, `net pnl ${trade.pnlUsd}`);
  assert.ok(trade.feesUsd > 0.1);
  // Rent is refunded, so cash = 100 + net pnl.
  assert.ok(Math.abs(state.cashUsd - (100 + trade.pnlUsd)) < 1e-4);
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
