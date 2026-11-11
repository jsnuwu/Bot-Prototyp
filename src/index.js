import http from "node:http";
import { assertPaperOnly, config } from "./config.js";
import { addSample, CANDLE_MS } from "./candles.js";
import { dashboardHtml } from "./dashboard.js";
import { canOpen, closePosition, executionConfirmsExit, exitsDue, openPaperPosition, portfolioValue } from "./engine.js";
import { quoteBuy, quoteSell } from "./jupiter.js";
import { fetchPriorityFeeSol } from "./rpc.js";
import { SOL_MINT } from "./costs.js";
import { currentQuotes, discoverCandidates, qualifiesMomentum } from "./market.js";
import { advanceResearch, ensureResearch, researchSummary } from "./research.js";
import { createStore, resetDailyLossIfNeeded } from "./state.js";
import { startHeartbeat } from "./heartbeat.js";
import { computeStats, tradesCsv } from "./stats.js";

assertPaperOnly();
if (process.env.RENDER === "true" && !config.databaseUrl) throw new Error("DATABASE_URL is required on Render");
const store = await createStore({ databaseUrl: config.databaseUrl, stateFile: config.stateFile });
let state = await store.load();
ensureResearch(state);
console.log(`State storage: ${store.kind}`);

let pendingSave = Promise.resolve();
let saveError = null;
let outstanding = 0;
function persist() {
  outstanding++;
  const snapshot = structuredClone(state);
  snapshot.lastSavedAt = new Date().toISOString();
  const write = pendingSave.then(async () => {
    await store.save(snapshot);
    state.lastSavedAt = snapshot.lastSavedAt;
    saveError = null;
  });
  pendingSave = write.catch(() => {
    saveError = "Checkpoint failed; trading paused until the next successful save";
    console.error(saveError);
  });
  return write.finally(() => { outstanding--; });
}
let latestPrices = new Map();
let lastError = null;
let lastTickAt = null;
let running = null;
let stopping = false;
let jupiterError = null;
let rpcError = null;

function confirmedMomentumCandidates(candidates, now = Date.now()) {
  state.momentumWatch ||= {};
  const ready = [];
  for (const candidate of candidates) {
    const previous = state.momentumWatch[candidate.token];
    const qualifies = qualifiesMomentum(candidate, config.momentum);
    const confirmed = qualifies && previous && now - previous.at <= config.momentum.confirmationWindowMs &&
      candidate.priceUsd >= previous.priceUsd * (1 + config.momentum.confirmationGainPercent / 100);
    state.momentumWatch[candidate.token] = { at: now, priceUsd: candidate.priceUsd };
    if (confirmed) {
      ready.push({ ...candidate, strategy: "fresh-momentum", exitRules: {
        takeProfitPercent: config.momentum.takeProfitPercent,
        takeProfitTwoPercent: config.momentum.takeProfitTwoPercent,
        takeProfitFraction: config.takeProfitFraction,
        trailingStopPercent: config.momentum.trailingStopPercent,
        stopLossPercent: config.momentum.stopLossPercent
      } });
    }
  }
  for (const [token, seen] of Object.entries(state.momentumWatch)) {
    if (now - seen.at > config.momentum.confirmationWindowMs) delete state.momentumWatch[token];
  }
  return ready;
}

async function refreshPriorityFee() {
  try {
    state.priorityFeeSol = await fetchPriorityFeeSol();
    rpcError = null;
  } catch (error) {
    rpcError = error.message;
  }
}

async function exclusive(task) {
  if (stopping || running || saveError) return;
  running = task();
  try { await running; } finally { running = null; }
}

function recordCandle() {
  addSample(state.candles, Number(portfolioValue(state, latestPrices).toFixed(4)));
  // The portfolio does not move while no paper position is open. Keep a
  // separate SOL/USD feed so the chart always represents real market motion.
  if (Number.isFinite(state.solPriceUsd)) {
    state.marketCandles ||= [];
    addSample(state.marketCandles, state.solPriceUsd);
  }
}

async function refreshPrices() {
  const researchTokens = (state.research?.strategies || []).flatMap((strategy) => strategy.positions.map((position) => position.token));
  const quotes = await currentQuotes([SOL_MINT, ...state.positions.map((p) => p.token), ...researchTokens]);
  const sol = quotes.get(SOL_MINT);
  if (sol) state.solPriceUsd = sol.priceUsd;
  for (const position of state.positions) {
    const quote = quotes.get(position.token);
    if (!quote) continue;
    latestPrices.set(position.token, quote.priceUsd);
    position.liquidityUsd = quote.liquidityUsd;
  }
  advanceResearch(state, quotes);
  resetDailyLossIfNeeded(state);
  for (const { position, price, reason, fraction = 1 } of exitsDue(state, latestPrices)) {
    const execution = await sellQuote(position, price, fraction);
    if (!execution && position.rawTokens) continue;
    if (execution && !executionConfirmsExit(position, execution, reason)) {
      state.events = [{ at: new Date().toISOString(), type: "quote-mismatch", token: position.symbol || position.token, detail: `Skipped ${reason}: chart price did not match executable quote` }, ...(state.events || [])].slice(0, 30);
      continue;
    }
    closePosition(state, position, execution?.quotePriceUsd || price, reason, undefined, undefined, execution, fraction);
    await persist();
  }
}

// New paper executions require a current Jupiter quote; unavailable routes are skipped.
async function buyQuote(pick) {
  if (!config.jupiter.enabled) return null;
  try { const q = await quoteBuy({ mint: pick.token, amountUsd: config.maxTradeUsd, priceUsd: pick.priceUsd }); jupiterError = null; return q; }
  catch (error) { jupiterError = error.message; return null; }
}

async function sellQuote(position, price, fraction = 1) {
  if (!config.jupiter.enabled || !position.rawTokens) return null;
  const scaledRaw = (BigInt(position.rawTokens) * BigInt(Math.round(fraction * 10_000)) / 10_000n).toString();
  try { const q = await quoteSell({ mint: position.token, rawTokens: scaledRaw, tokens: position.tokens * fraction, priceUsd: price }); jupiterError = null; return q; }
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
    const candidates = await discoverCandidates();
    advanceResearch(state, new Map(candidates.map((candidate) => [candidate.token, candidate])), candidates);
    const momentumCandidates = confirmedMomentumCandidates(candidates);
    if (canOpen(state)) {
      const held = new Set(state.positions.map((p) => p.token));
      for (const pick of momentumCandidates) {
        if (!canOpen(state)) break;
        const execution = held.has(pick.token) ? null : await buyQuote(pick);
        if (execution && openPaperPosition(state, pick, undefined, undefined, execution)) {
          held.add(pick.token);
          latestPrices.set(pick.token, pick.priceUsd);
          await persist();
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
  return { mode: "paper", storage: store.kind, saveError, keepAlive: heartbeat.status, lastSavedAt: state.lastSavedAt || null, stats: computeStats(state, portfolioUsd, config.startingCapitalUsd), research: { startedAt: state.research?.startedAt || null, strategies: researchSummary(state.research) }, healthy: !saveError, serverTime: new Date().toISOString(), startingCapitalUsd: config.startingCapitalUsd, cashUsd: Number(state.cashUsd.toFixed(2)), portfolioUsd: Number(portfolioUsd.toFixed(2)), openPositions: state.positions.length, maxOpenPositions: config.maxOpenPositions, dailyLossUsd: Number((state.slippagePaidUsd || 0).toFixed(4)), dailyLossLimitUsd: null, feesPaidUsd: Number((state.feesPaidUsd || 0).toFixed(2)), realizedPnlUsd: Number(state.closedTrades.reduce((t, c) => t + c.pnlUsd, 0).toFixed(2)), solPriceUsd: state.solPriceUsd || null, jupiter: { enabled: config.jupiter.enabled, authenticated: Boolean(config.jupiter.apiKey), lastError: jupiterError }, priorityFeeSol: Number.isFinite(state.priorityFeeSol) ? state.priorityFeeSol : null, priorityFeeSource: config.rpcUrl && !rpcError && Number.isFinite(state.priorityFeeSol) ? "rpc" : "default", lastScanAt: state.lastScanAt, lastTickAt, lastError, positions: state.positions, closedTrades: state.closedTrades.slice(-20).reverse(), events: (state.events || []).slice(0, 8), history: state.history || [], candleMs: CANDLE_MS, candles: state.candles, marketCandles: state.marketCandles || [] };
}

const heartbeat = startHeartbeat(config.keepAliveUrl, config.keepAliveMs);
const server = http.createServer((req, res) => {
  if (req.url === "/healthz") { res.writeHead(200, { "content-type":"text/plain", "cache-control":"no-store" }); return res.end("ok"); }
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(dashboardHtml); }
  if (req.url === "/api/trades.csv") { res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=paper-trades.csv" }); return res.end(tradesCsv(state.closedTrades)); }
  if (req.url === "/api/trades") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(state.closedTrades)); }
  if (req.url === "/health" || req.url === "/api/status") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); return res.end(JSON.stringify(status())); }
  res.writeHead(404); res.end();
}).listen(config.port, "0.0.0.0", () => { console.log(`Paper bot health endpoint listening on ${config.port}`); heartbeat.start(); });

const timers = [];
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, async () => {
    if (stopping) return;
    stopping = true;
    timers.forEach(clearInterval);
    heartbeat.stop();
    server.close();
    await running;
    let exitCode = 0;
    try { await persist(); } catch { exitCode = 1; }
    await store.close().catch(() => { exitCode = 1; });
    process.exit(exitCode);
  });
}
if (config.rpcUrl) {
  await refreshPriorityFee();
  timers.push(setInterval(refreshPriorityFee, config.priorityFeeRefreshMs));
}
await exclusive(cycle);
timers.push(setInterval(() => exclusive(cycle), config.scanIntervalMs));
timers.push(setInterval(() => exclusive(tick), config.priceTickMs));
timers.push(setInterval(() => { if (!outstanding) void persist().catch(() => {}); }, CANDLE_MS));

