import http from "node:http";
import { assertPaperOnly, config } from "./config.js";
import { addSample, CANDLE_MS } from "./candles.js";
import { dashboardHtml } from "./dashboard.js";
import { canOpen, closeEligiblePositions, openPaperPosition, portfolioValue } from "./engine.js";
import { currentPrices, discoverCandidates } from "./market.js";
import { loadState, resetDailyLossIfNeeded, saveState } from "./state.js";

assertPaperOnly();
let state = await loadState(config.stateFile);
let latestPrices = new Map();
let lastError = null;
let lastTickAt = null;
let busy = false;

async function exclusive(task) {
  if (busy) return;
  busy = true;
  try { await task(); } finally { busy = false; }
}

function recordCandle() {
  addSample(state.candles, Number(portfolioValue(state, latestPrices).toFixed(4)));
}

async function refreshPrices() {
  if (state.positions.length) {
    const fresh = await currentPrices(state.positions.map((p) => p.token));
    latestPrices = new Map([...latestPrices, ...fresh]);
  }
  closeEligiblePositions(state, latestPrices);
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
        if (!held.has(pick.token) && openPaperPosition(state, pick)) {
          held.add(pick.token);
          latestPrices.set(pick.token, pick.priceUsd);
        }
      }
    }
    state.lastScanAt = new Date().toISOString();
    state.history = [...(state.history || []), { at: state.lastScanAt, valueUsd: Number(portfolioValue(state, latestPrices).toFixed(4)) }].slice(-120);
    recordCandle();
    lastError = null;
    await saveState(config.stateFile, state);
  } catch (error) {
    lastError = error.message;
    console.error("Paper-trading cycle failed:", error.message);
  }
}

function status() {
  return { mode: "paper", healthy: true, serverTime: new Date().toISOString(), cashUsd: Number(state.cashUsd.toFixed(2)), portfolioUsd: Number(portfolioValue(state, latestPrices).toFixed(2)), openPositions: state.positions.length, maxOpenPositions: config.maxOpenPositions, dailyLossUsd: Number(state.dailyLossUsd.toFixed(2)), lastScanAt: state.lastScanAt, lastTickAt, lastError, positions: state.positions, closedTrades: state.closedTrades.slice(-8).reverse(), events: (state.events || []).slice(0, 8), history: state.history || [], candleMs: CANDLE_MS, candles: state.candles };
}

http.createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(dashboardHtml); }
  if (req.url === "/health" || req.url === "/api/status") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); return res.end(JSON.stringify(status())); }
  res.writeHead(404); res.end();
}).listen(config.port, "0.0.0.0", () => console.log(`Paper bot health endpoint listening on ${config.port}`));

await exclusive(cycle);
setInterval(() => exclusive(cycle), config.scanIntervalMs);
setInterval(() => exclusive(tick), config.priceTickMs);
setInterval(() => saveState(config.stateFile, state).catch((e) => console.error("Saving state failed:", e.message)), CANDLE_MS);
