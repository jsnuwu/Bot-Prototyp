import test from "node:test";
import assert from "node:assert/strict";
import { ensurePerpShadow, perpShadowSummary, scoreWallet } from "../src/perp-shadow.js";

test("qualifies only a public wallet with sufficient profitable closed fills", () => {
  const winning = Array.from({ length: 16 }, () => ({ closedPnl: "2" })).concat(Array.from({ length: 8 }, () => ({ closedPnl: "-1" })));
  const losing = Array.from({ length: 20 }, () => ({ closedPnl: "-1" }));
  assert.equal(scoreWallet(winning).qualified, true);
  assert.equal(scoreWallet(losing).qualified, false);
});

test("perp shadow remains isolated from the main paper wallet", () => {
  const state = {};
  const shadow = ensurePerpShadow(state, "2026-01-01T00:00:00.000Z");
  shadow.equityHistory.push({ at: "2026-01-01T00:01:00.000Z", valueUsd: 203 });
  const summary = perpShadowSummary(shadow);
  assert.equal(state.cashUsd, undefined);
  assert.equal(summary.totalPnlUsd, 3);
  assert.equal(summary.equityHistory.length, 1);
});
