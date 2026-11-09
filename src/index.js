import http from "node:http";
import { assertPaperOnly, config } from "./config.js";
import { addSample, CANDLE_MS } from "./candles.js";
import { dashboardHtml } from "./dashboard.js";
import { canOpen, closePosition, exitsDue, openPaperPosition, portfolioValue } from "./engine.js";
import { quoteBuy, quoteSell } from "./jupiter.js";
import { fetchPriorityFeeSol } from "./rpc.js";
import { SOL_MINT } from "./costs.js";
import { currentQuotes, discoverCandidates } from "./market.js";
import { createStore, resetDailyLossIfNeeded } from "./state.js";
import { computeStats, tradesCsv } from "./stats.js";

assertPaperOnly();
const store = await createStore({ databaseUrl: config.databaseUrl, stateFile: config.stateFile });
let state = await store.load();
console.log(`State storage: ${store.kind}`);

async function persist() {
  try {
    await store.save(state);
    state.lastSavedAt = new Date().toISOString();
  } catch (error) {
    console.error("Saving state failed:", error.message);
  }
}
let latestPrices = new Map();
let lastError = null;
let lastTickAt = null;
let busy = false;
let jupiterError = null;
let rpcError = null;

async function refreshPriorityFee() {
  try {
    state.priorityFeeSol = await fetchPriorityFeeSol();
    rpcError = null;
  } catch (error) {
    rpcError = error.message;
  }
}

async function exclusive(task) {
  if (busy) return;
  busy = true;
  try { await task(); } finally { busy = false; }
}

function recordCandle() {
  addSample(state.candles, Number(portfolioValue(state, latestPrices).toFixed(4)));
}

async function refreshPrices() {
  const quotes = await currentQuotes([SOL_MINT, ...state.positions.map((p) => p.token)]);
  const sol = quotes.get(SOL_MINT);
  if (sol) state.solPriceUsd = sol.priceUsd;
  for (const position of state.positions) {
    const quote = quotes.get(position.token);
    if (!quote) continue;
    latestPrices.set(position.token, quote.priceUsd);
    position.liquidityUsd = quote.liquidityUsd;
  }
  resetDailyLossIfNeeded(state);
  for (const { position, price, reason } of exitsDue(state, latestPrices)) {
    closePosition(state, position, price, reason, undefined, undefined, await sellQuote(position, price));
  }
}

// Real Jupiter quote when possible, otherwise null (the cost model is used instead).
async function buyQuote(pick) {
  if (!config.jupiter.enabled) return null;
  try { const q = await quoteBuy({ mint: pick.token, amountUsd: config.maxTradeUsd, priceUsd: pick.priceUsd }); jupiterError = null; return q; }
  catch (error) { jupiterError = error.message; return null; }
}

async function sellQuote(position, price) {
  if (!config.jupiter.enabled || !position.rawTokens) return null;
  try { const q = await quoteSell({ mint: position.token, rawTokens: position.rawTokens, tokens: position.tokens, priceUsd: price }); jupiterError = null; return q; }
  catch (error) { jupiterError = error.message; return null; }
}

// Fast loop: updates prices of open positions and feeds the 15s candles.
async function tick() {
  try {
    await refreshPrices();
    lastError = null;
  } catch (error) {
    lastError = error.message;
  }
  recordCandle();
  lastTickAt = new Date().toISOString();
}

// Slow loop: looks for new candidates and persists state.
async function cycle() {
  try {
    resetDailyLossIfNeeded(state);
    await refreshPrices();
    if (canOpen(state)) {
      const candidates = await discoverCandidates();
      const held = new Set(state.positions.map((p) => p.token));
      for (const pick of candidates) {
        if (!canOpen(state)) break;
        if (!held.has(pick.token) && openPaperPosition(state, pick, undefined, undefined, await buyQuote(pick))) {
          held.add(pick.token);
          latestPrices.set(pick.token, pick.priceUsd);
        }
      }
    }
    state.lastScanAt = new Date().toISOString();
    state.history = [...(state.history || []), { at: state.lastScanAt, valueUsd: Number(portfolioValue(state, latestPrices).toFixed(4)) }].slice(-120);
    recordCandle();
    lastError = null;
    await persist();
  } catch (error) {
    lastError = error.message;
    console.error("Paper-trading cycle failed:", error.message);
  }
}

function status() {
  const portfolioUsd = portfolioValue(state, latestPrices);
  return { mode: "paper", storage: store.kind, lastSavedAt: state.lastSavedAt || null, stats: computeStats(state, portfolioUsd, config.startingCapitalUsd), healthy: true, serverTime: new Date().toISOString(), cashUsd: Number(state.cashUsd.toFixed(2)), portfolioUsd: Number(portfolioUsd.toFixed(2)), openPositions: state.positions.length, maxOpenPositions: config.maxOpenPositions, dailyLossUsd: Number(state.dailyLossUsd.toFixed(2)), feesPaidUsd: Number((state.feesPaidUsd || 0).toFixed(2)), realizedPnlUsd: Number(state.closedTrades.reduce((t, c) => t + c.pnlUsd, 0).toFixed(2)), solPriceUsd: state.solPriceUsd || null, jupiter: { enabled: config.jupiter.enabled, authenticated: Boolean(config.jupiter.apiKey), lastError: jupiterError }, priorityFeeSol: Number.isFinite(state.priorityFeeSol) ? state.priorityFeeSol : null, priorityFeeSource: config.rpcUrl && !rpcError && Number.isFinite(state.priorityFeeSol) ? "rpc" : "default", lastScanAt: state.lastScanAt, lastTickAt, lastError, positions: state.positions, closedTrades: state.closedTrades.slice(-20).reverse(), events: (state.events || []).slice(0, 8), history: state.history || [], candleMs: CANDLE_MS, candles: state.candles };
}

http.createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(dashboardHtml); }
  if (req.url === "/api/trades.csv") { res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=paper-trades.csv" }); return res.end(tradesCsv(state.closedTrades)); }
  if (req.url === "/api/trades") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(state.closedTrades)); }
  if (req.url === "/health" || req.url === "/api/status") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); return res.end(JSON.stringify(status())); }
  res.writeHead(404); res.end();
}).listen(config.port, "0.0.0.0", () => console.log(`Paper bot health endpoint listening on ${config.port}`));

if (config.rpcUrl) {
  await refreshPriorityFee();
  setInterval(refreshPriorityFee, config.priorityFeeRefreshMs);
}

await exclusive(cycle);
setInterval(() => exclusive(cycle), config.scanIntervalMs);
setInterval(() => exclusive(tick), config.priceTickMs);
setInterval(persist, CANDLE_MS);

// Render sends SIGTERM before restarts and redeploys: save the latest state first.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, async () => {
    console.log(`${signal} received, saving state`);
    await persist();
    await store.close().catch(() => {});
    process.exit(0);
  });
}

if (config.keepAliveUrl) {
  const target = new URL("/health", config.keepAliveUrl).href;
  setInterval(() => fetch(target, { signal: AbortSignal.timeout(10_000) }).catch((e) => console.error("Keep-alive ping failed:", e.message)), config.keepAliveMs);
  console.log(`Keep-alive ping every ${config.keepAliveMs / 1000}s -> ${target}`);
}
