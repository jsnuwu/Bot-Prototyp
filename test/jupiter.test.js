import test from "node:test";
import assert from "node:assert/strict";
import { quoteBuy, quoteSell, USDC_MINT } from "../src/jupiter.js";
import { closePosition, openPaperPosition } from "../src/engine.js";

const jup = { enabled: true, apiKey: "test-key", baseUrl: "https://jup.test/swap/v1" };
const fees = { dexFeePercent: 0.25, slippagePercent: 0.5, baseFeeSol: 0.000005, priorityFeeSol: 0.0005, tokenAccountRentSol: 0.002, defaultSolPriceUsd: 150 };

function mockFetch(outAmount, calls = []) {
  return async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    return { ok: true, status: 200, json: async () => ({ outAmount: String(outAmount), priceImpactPct: "0.012", routePlan: [{ swapInfo: { label: "Raydium" } }] }) };
  };
}

test("buy quote: sends api key, infers decimals and uses the quoted output", async () => {
  const calls = [];
  // $5 at $0.001/token with 6 decimals = 5000 tokens = 5_000_000_000 raw; quote returns 2 % less.
  const q = await quoteBuy({ mint: "MINT", amountUsd: 5, priceUsd: 0.001 }, jup, mockFetch(4_900_000_000, calls));
  assert.match(calls[0].url, /inputMint=EPjF.*outputMint=MINT.*amount=5000000/);
  assert.equal(calls[0].headers["x-api-key"], "test-key");
  assert.equal(q.decimals, 6);
  assert.equal(q.route, "Raydium");
  assert.ok(Math.abs(q.feesUsd.swap - 0.1) < 1e-9);
  assert.equal(q.tokens, 4900);
  assert.equal(q.feesUsd.slippage, 0);
});

test("sell quote: converts the quoted USDC output", async () => {
  const q = await quoteSell({ mint: "MINT", rawTokens: "4875500000", tokens: 4875.5, priceUsd: 0.00115 }, jup, mockFetch(5_500_000));
  assert.equal(q.usdOut, 5.5);
  assert.equal(q.feesUsd.slippage, 0);
  assert.ok(q.feesUsd.swap > 0);
});

test("rejects quotes that do not match the market price", async () => {
  await assert.rejects(quoteBuy({ mint: "MINT", amountUsd: 5, priceUsd: 1e30 }, jup, mockFetch(5)));
});

test("engine books Jupiter-priced trades with net P&L", async () => {
  const state = { cashUsd: 100, positions: [], closedTrades: [], dailyLossUsd: 0, lossDate: new Date().toISOString().slice(0, 10), solPriceUsd: 100 };
  const buy = await quoteBuy({ mint: "MINT", amountUsd: 5, priceUsd: 0.001 }, jup, mockFetch(4_900_000_000));
  assert.equal(openPaperPosition(state, { token: "MINT", symbol: "MEME", priceUsd: 0.001, liquidityUsd: 80_000 }, undefined, fees, buy), true);
  const position = state.positions[0];
  assert.equal(position.pricing, "jupiter");
  const sell = await quoteSell({ mint: "MINT", rawTokens: position.rawTokens, tokens: position.tokens, priceUsd: 0.00115 }, jup, mockFetch(5_550_000));
  closePosition(state, position, 0.00115, "take-profit", undefined, fees, sell);
  const trade = state.closedTrades[0];
  assert.equal(trade.exitPricing, "jupiter");
  assert.equal(state.positions.length, 0);
  // Gross +15 % would be +$0.75; fees, impact and network costs make it smaller.
  assert.ok(trade.pnlUsd > 0 && trade.pnlUsd < 0.75, `pnl ${trade.pnlUsd}`);
  assert.ok(Math.abs(state.cashUsd - (100 + trade.pnlUsd)) < 1e-4);
  assert.equal(USDC_MINT.length, 44);
});

