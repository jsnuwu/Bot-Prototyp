import test from "node:test";
import assert from "node:assert/strict";
import { advanceResearch, ensureResearch, researchSummary } from "../src/research.js";

const candidate = { token: "token", symbol: "TEST", priceUsd: 1, liquidityUsd: 200_000, score: 0.5 };
const state = () => ({ solPriceUsd: 100 });

test("research tracks independent variants without touching the paper portfolio", () => {
  const paper = state();
  const research = ensureResearch(paper, "2026-01-01T00:00:00.000Z");
  assert.equal(research.strategies.length, 3);
  advanceResearch(paper, new Map(), [candidate], "2026-01-01T00:00:00.000Z");
  assert.equal(paper.research.strategies.every((strategy) => strategy.positions.length === 1), true);
  assert.equal(paper.positions, undefined);
});

test("research closes a shadow position and publishes comparable statistics", () => {
  const paper = state();
  advanceResearch(paper, new Map(), [candidate], "2026-01-01T00:00:00.000Z");
  advanceResearch(paper, new Map([["token", { priceUsd: 1.3, liquidityUsd: 200_000 }]]), [], "2026-01-01T00:01:00.000Z");
  const results = researchSummary(paper.research);
  assert.equal(results.every((strategy) => strategy.trades === 1), true);
  assert.equal(results.every((strategy) => strategy.pnlUsd > 0), true);
  assert.equal(results.every((strategy) => strategy.equityHistory.length === 2), true);
  assert.equal(results.every((strategy) => strategy.totalPnlUsd > 0), true);
});

