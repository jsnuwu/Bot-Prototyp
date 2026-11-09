import test from "node:test";
import assert from "node:assert/strict";
import { closeEligiblePositions, openPaperPosition } from "../src/engine.js";

test("opens a $5 paper position and closes it at take profit", () => {
  const state = { cashUsd: 100, positions: [], closedTrades: [], dailyLossUsd: 0, lossDate: new Date().toISOString().slice(0, 10) };
  assert.equal(openPaperPosition(state, { token: "token", priceUsd: 1, pairUrl: "https://example.com" }), true);
  assert.equal(state.cashUsd, 95);
  closeEligiblePositions(state, new Map([["token", 1.15]]));
  assert.equal(state.positions.length, 0);
  assert.equal(state.closedTrades[0].reason, "take-profit");
  assert.equal(state.cashUsd, 100.75);
});

test("stop loss increments the daily loss", () => {
  const state = { cashUsd: 95, positions: [{ token: "token", entryPriceUsd: 1, amountUsd: 5 }], closedTrades: [], dailyLossUsd: 0, lossDate: new Date().toISOString().slice(0, 10) };
  closeEligiblePositions(state, new Map([["token", 0.92]]));
  assert.equal(state.closedTrades[0].reason, "stop-loss");
  assert.equal(state.dailyLossUsd, 0.4);
});
