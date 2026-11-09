import test from "node:test";
import assert from "node:assert/strict";
import { computeStats, tradesCsv } from "../src/stats.js";

test("computes win rate, profit factor and return", () => {
  const state = { feesPaidUsd: 0.5, closedTrades: [{ pnlUsd: 0.6 }, { pnlUsd: -0.3 }, { pnlUsd: 0.3 }] };
  const s = computeStats(state, 100.6);
  assert.equal(s.trades, 3);
  assert.equal(s.winRatePercent, 66.7);
  assert.equal(s.profitFactor, 3);
  assert.equal(s.realizedPnlUsd, 0.6);
  assert.equal(s.returnPercent, 0.6);
});

test("exports trades as CSV with escaping", () => {
  const csv = tradesCsv([{ symbol: 'A,"B"', pnlUsd: 1 }]);
  assert.match(csv.split("\n")[1], /"A,""B"""/);
});
