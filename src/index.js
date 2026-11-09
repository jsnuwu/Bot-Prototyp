import http from "node:http";
import { assertPaperOnly, config } from "./config.js";
import { canOpen, closeEligiblePositions, openPaperPosition, portfolioValue } from "./engine.js";
import { currentPrices, discoverCandidates } from "./market.js";
import { loadState, resetDailyLossIfNeeded, saveState } from "./state.js";

assertPaperOnly();
let state = await loadState(config.stateFile);
let latestPrices = new Map();
let lastError = null;

async function cycle() {
  try {
    resetDailyLossIfNeeded(state);
    latestPrices = await currentPrices(state.positions.map((p) => p.token));
    closeEligiblePositions(state, latestPrices);
    if (canOpen(state)) {
      const candidates = await discoverCandidates();
      const held = new Set(state.positions.map((p) => p.token));
      const pick = candidates.find((c) => !held.has(c.token));
      if (pick) openPaperPosition(state, pick);
    }
    state.lastScanAt = new Date().toISOString();
    lastError = null;
    await saveState(config.stateFile, state);
  } catch (error) {
    lastError = error.message;
    console.error("Paper-trading cycle failed:", error.message);
  }
}

http.createServer((req, res) => {
  if (req.url !== "/health" && req.url !== "/") { res.writeHead(404); return res.end(); }
  const body = JSON.stringify({ mode: "paper", healthy: true, cashUsd: Number(state.cashUsd.toFixed(2)), portfolioUsd: Number(portfolioValue(state, latestPrices).toFixed(2)), openPositions: state.positions.length, dailyLossUsd: Number(state.dailyLossUsd.toFixed(2)), lastScanAt: state.lastScanAt, lastError });
  res.writeHead(200, { "content-type": "application/json" }); res.end(body);
}).listen(config.port, "0.0.0.0", () => console.log(`Paper bot health endpoint listening on ${config.port}`));

await cycle();
setInterval(cycle, config.scanIntervalMs);
