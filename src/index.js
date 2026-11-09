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

function status() {
  return { mode: "paper", healthy: true, cashUsd: Number(state.cashUsd.toFixed(2)), portfolioUsd: Number(portfolioValue(state, latestPrices).toFixed(2)), openPositions: state.positions.length, dailyLossUsd: Number(state.dailyLossUsd.toFixed(2)), lastScanAt: state.lastScanAt, lastError, positions: state.positions, closedTrades: state.closedTrades.slice(-8).reverse() };
}

const dashboard = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Krypton Paper</title><style>
*{box-sizing:border-box}body{margin:0;background:#0b0d10;color:#e9edf2;font:14px Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}header{height:64px;padding:0 30px;border-bottom:1px solid #272b31;display:flex;align-items:center;justify-content:space-between;background:#101318}.brand{font-weight:800;letter-spacing:.16em}.brand b{color:#36d99b}.tag{background:#223b34;color:#8cf0bd;border:1px solid #356b57;padding:6px 10px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:.08em}.wrap{max-width:1280px;margin:auto;padding:30px}.eyebrow{font-size:11px;letter-spacing:.12em;color:#8993a0;text-transform:uppercase;margin-bottom:8px}h1{font-size:28px;margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card,.panel{border:1px solid #282d35;background:#12161c;border-radius:5px}.card{padding:18px}.label{color:#8993a0;font-size:12px}.value{font-size:25px;font-weight:700;margin-top:8px}.green{color:#36d99b}.amber{color:#f2b74d}.layout{display:grid;grid-template-columns:1.55fr 1fr;gap:14px;margin-top:14px}.panel h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;margin:0;padding:16px 18px;border-bottom:1px solid #282d35}.empty{padding:32px 18px;color:#8993a0;text-align:center}.trade{display:grid;grid-template-columns:1fr auto auto;gap:12px;padding:13px 18px;border-bottom:1px solid #232831;align-items:center}.trade:last-child{border:0}.muted{font-size:12px;color:#8993a0;margin-top:3px}.pill{font-size:11px;padding:4px 7px;border-radius:3px;background:#1e2d29;color:#70dca2}.loss{background:#38252b;color:#f08b96}.notice{margin-top:14px;border-left:3px solid #f2b74d;background:#211d15;color:#d9c18a;padding:12px 14px;font-size:12px}.status{font-size:12px;color:#8993a0}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#36d99b;margin-right:6px}@media(max-width:800px){.wrap{padding:18px}.grid{grid-template-columns:repeat(2,1fr)}.layout{grid-template-columns:1fr}header{padding:0 18px}}
</style></head><body><header><div class="brand">KRYPTON <b>PAPER</b></div><div class="tag">SIMULATION ONLY</div></header><main class="wrap"><div class="eyebrow">Solana memecoin desk</div><h1>Paper Trading Overview</h1><section class="grid"><div class="card"><div class="label">Portfolio value</div><div class="value" id="portfolio">$100.00</div></div><div class="card"><div class="label">Available cash</div><div class="value" id="cash">$100.00</div></div><div class="card"><div class="label">Open positions</div><div class="value" id="positions">0 / 3</div></div><div class="card"><div class="label">Daily loss used</div><div class="value amber" id="loss">$0.00 / $5.00</div></div></section><section class="layout"><div class="panel"><h2>Open positions</h2><div id="position-list" class="empty">No active paper positions</div></div><div class="panel"><h2>Recent exits</h2><div id="trade-list" class="empty">No closed paper trades yet</div></div></section><div class="notice" id="notice">Paper mode is active. No wallet is connected and no on-chain transaction can be sent.</div><p class="status"><span class="dot"></span><span id="updated">Loading live status…</span></p></main><script>const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);function row(p){return '<div class="trade"><div><strong>'+p.token.slice(0,7)+'…'+p.token.slice(-4)+'</strong><div class="muted">Opened '+new Date(p.openedAt).toLocaleString()+'</div></div><div class="muted">Entry '+money(p.entryPriceUsd)+'</div><div class="pill">'+money(p.amountUsd)+'</div></div>'}function exit(t){const sign=t.pnlUsd>=0?'+':'';return '<div class="trade"><div><strong>'+t.token.slice(0,7)+'…'+t.token.slice(-4)+'</strong><div class="muted">'+t.reason+'</div></div><div class="muted">'+new Date(t.closedAt).toLocaleTimeString()+'</div><div class="pill '+(t.pnlUsd<0?'loss':'')+'">'+sign+money(t.pnlUsd)+'</div></div>'}async function refresh(){try{const s=await fetch('/api/status').then(r=>r.json());portfolio.textContent=money(s.portfolioUsd);cash.textContent=money(s.cashUsd);positions.textContent=s.openPositions+' / 3';loss.textContent=money(s.dailyLossUsd)+' / $5.00';document.getElementById('position-list').className=s.positions.length?'':'empty';document.getElementById('position-list').innerHTML=s.positions.length?s.positions.map(row).join(''):'No active paper positions';document.getElementById('trade-list').className=s.closedTrades.length?'':'empty';document.getElementById('trade-list').innerHTML=s.closedTrades.length?s.closedTrades.map(exit).join(''):'No closed paper trades yet';updated.textContent='Updated '+(s.lastScanAt?new Date(s.lastScanAt).toLocaleString():'waiting for first scan');notice.textContent=s.lastError?'Market data is temporarily unavailable: '+s.lastError:'Paper mode is active. No wallet is connected and no on-chain transaction can be sent.'}catch{updated.textContent='Status temporarily unavailable'}}refresh();setInterval(refresh,15000)</script></body></html>`;

http.createServer((req, res) => {
  if (req.url === "/" ) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(dashboard); }
  if (req.url === "/health" || req.url === "/api/status") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(status())); }
  res.writeHead(404); res.end();
}).listen(config.port, "0.0.0.0", () => console.log(`Paper bot health endpoint listening on ${config.port}`));

await cycle();
setInterval(cycle, config.scanIntervalMs);
