import { config } from "./config.js";

const INFO_URL = "https://api.hyperliquid.xyz/info";
const SHADOW_MARGIN_USD = config.maxTradeUsd;
const ENTRY_FEE_RATE = 0.00045;
const EXIT_FEE_RATE = 0.00045;
const MAX_POSITIONS = 5;
const MAX_TRACKED_MARKETS = 3;
const MAX_QUALIFIED_WALLETS = 2;

async function info(body, fetchImpl = fetch) {
  const response = await fetchImpl(INFO_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Hyperliquid responded with ${response.status}`);
  return response.json();
}

export function ensurePerpShadow(state, now = new Date().toISOString()) {
  state.perpShadow ||= {
    startedAt: now,
    cashUsd: config.startingCapitalUsd,
    positions: [],
    closedTrades: [],
    observedWallets: {},
    qualifiedWallets: {},
    seenFills: {},
    equityHistory: [],
    lastError: null
  };
  return state.perpShadow;
}

export function scoreWallet(fills = []) {
  const closes = fills.filter((fill) => Number.isFinite(Number(fill.closedPnl)) && Math.abs(Number(fill.closedPnl)) > 0.000001);
  const pnlUsd = closes.reduce((sum, fill) => sum + Number(fill.closedPnl), 0);
  const wins = closes.filter((fill) => Number(fill.closedPnl) > 0).length;
  const grossWins = closes.filter((fill) => Number(fill.closedPnl) > 0).reduce((sum, fill) => sum + Number(fill.closedPnl), 0);
  const grossLosses = Math.abs(closes.filter((fill) => Number(fill.closedPnl) < 0).reduce((sum, fill) => sum + Number(fill.closedPnl), 0));
  const winRatePercent = closes.length ? wins / closes.length * 100 : 0;
  const profitFactor = grossLosses ? grossWins / grossLosses : grossWins ? Infinity : 0;
  return { closes: closes.length, pnlUsd, winRatePercent, profitFactor, qualified: closes.length >= 20 && pnlUsd > 0 && winRatePercent >= 52 && profitFactor >= 1.15 };
}

function fillId(fill) {
  return `${fill.hash || ""}:${fill.oid || ""}:${fill.time || ""}:${fill.coin || ""}:${fill.dir || ""}`;
}

function currentPrices(meta) {
  const [details, contexts] = meta;
  const prices = new Map();
  for (let index = 0; index < details.universe.length; index += 1) {
    const market = details.universe[index];
    const context = contexts[index];
    const priceUsd = Number(context?.markPx || context?.midPx);
    if (!market.isDelisted && Number.isFinite(priceUsd) && priceUsd > 0) prices.set(market.name, { priceUsd, volumeUsd: Number(context?.dayNtlVlm || 0) });
  }
  return prices;
}

function closePosition(shadow, position, priceUsd, reason, now) {
  const move = position.side === "long" ? priceUsd / position.entryPriceUsd - 1 : position.entryPriceUsd / priceUsd - 1;
  const gross = position.marginUsd * (1 + move);
  const exitFeeUsd = position.marginUsd * EXIT_FEE_RATE;
  const cashInUsd = Math.max(0, gross - exitFeeUsd);
  const pnlUsd = cashInUsd - position.marginUsd - position.entryFeeUsd;
  shadow.cashUsd = Number((shadow.cashUsd + cashInUsd).toFixed(6));
  shadow.closedTrades.push({ ...position, closedAt: now, exitPriceUsd: priceUsd, reason, pnlUsd: Number(pnlUsd.toFixed(4)), feesUsd: Number((position.entryFeeUsd + exitFeeUsd).toFixed(4)) });
  shadow.positions = shadow.positions.filter((item) => item !== position);
}

function updatePositions(shadow, prices, now) {
  for (const position of [...shadow.positions]) {
    const price = prices.get(position.coin)?.priceUsd;
    if (!price) continue;
    const move = position.side === "long" ? price / position.entryPriceUsd - 1 : position.entryPriceUsd / price - 1;
    if (move <= -0.06) closePosition(shadow, position, price, "shadow-stop", now);
    else if (move >= 0.10) closePosition(shadow, position, price, "shadow-take-profit", now);
  }
}

function openSignal(shadow, fill, prices, now) {
  const side = fill.dir === "Open Long" ? "long" : fill.dir === "Open Short" ? "short" : null;
  const quote = prices.get(fill.coin);
  if (!side || !quote || shadow.positions.length >= MAX_POSITIONS || shadow.positions.some((position) => position.coin === fill.coin) || shadow.cashUsd < SHADOW_MARGIN_USD * (1 + ENTRY_FEE_RATE)) return false;
  const entryFeeUsd = SHADOW_MARGIN_USD * ENTRY_FEE_RATE;
  shadow.cashUsd = Number((shadow.cashUsd - SHADOW_MARGIN_USD - entryFeeUsd).toFixed(6));
  shadow.positions.push({ coin: fill.coin, side, entryPriceUsd: quote.priceUsd, marginUsd: SHADOW_MARGIN_USD, entryFeeUsd, sourceWallet: fill.user, openedAt: now });
  return true;
}

function recordEquity(shadow, prices, now) {
  const openValue = shadow.positions.reduce((sum, position) => {
    const price = prices.get(position.coin)?.priceUsd;
    if (!price) return sum + position.marginUsd;
    const move = position.side === "long" ? price / position.entryPriceUsd - 1 : position.entryPriceUsd / price - 1;
    return sum + Math.max(0, position.marginUsd * (1 + move) - position.marginUsd * EXIT_FEE_RATE);
  }, 0);
  shadow.equityHistory = [...shadow.equityHistory, { at: now, valueUsd: Number((shadow.cashUsd + openValue).toFixed(4)) }].slice(-240);
}

// Public-data-only discovery. It never connects a wallet and never submits an order.
export async function advancePerpShadow(state, now = new Date().toISOString(), fetchImpl = fetch) {
  const shadow = ensurePerpShadow(state, now);
  try {
    const meta = await info({ type: "metaAndAssetCtxs" }, fetchImpl);
    const prices = currentPrices(meta);
    updatePositions(shadow, prices, now);
    const markets = [...prices.entries()].sort((a, b) => b[1].volumeUsd - a[1].volumeUsd).slice(0, MAX_TRACKED_MARKETS).map(([coin]) => coin);
    for (const coin of markets) {
      const trades = await info({ type: "recentTrades", coin }, fetchImpl);
      for (const trade of trades) for (const wallet of trade.users || []) {
        shadow.observedWallets[wallet] ||= { lastSeenAt: now, scoredAt: null };
        shadow.observedWallets[wallet].lastSeenAt = now;
      }
    }
    const candidate = Object.entries(shadow.observedWallets).find(([, profile]) => !profile.scoredAt)?.[0];
    if (candidate) {
      const fills = await info({ type: "userFills", user: candidate, aggregateByTime: true }, fetchImpl);
      const score = scoreWallet(fills);
      shadow.observedWallets[candidate].scoredAt = now;
      if (score.qualified) shadow.qualifiedWallets[candidate] = { ...score, qualifiedAt: now };
    }
    const qualified = Object.keys(shadow.qualifiedWallets).slice(0, MAX_QUALIFIED_WALLETS);
    for (const wallet of qualified) {
      const fills = await info({ type: "userFills", user: wallet, aggregateByTime: true }, fetchImpl);
      for (const fill of fills) {
        const id = fillId(fill);
        if (shadow.seenFills[id]) continue;
        shadow.seenFills[id] = now;
        if (Date.now() - Number(fill.time) < 2 * 60_000) openSignal(shadow, { ...fill, user: wallet }, prices, now);
      }
    }
    const staleBefore = Date.now() - 24 * 60 * 60_000;
    for (const [id, seenAt] of Object.entries(shadow.seenFills)) if (Date.parse(seenAt) < staleBefore) delete shadow.seenFills[id];
    shadow.closedTrades = shadow.closedTrades.slice(-500);
    recordEquity(shadow, prices, now);
    shadow.lastError = null;
  } catch (error) {
    shadow.lastError = error.message;
  }
  return shadow;
}

export function perpShadowSummary(shadow) {
  if (!shadow) return { id: "perp-follower", label: "Public perps", trades: 0, openPositions: 0, pnlUsd: 0, totalPnlUsd: 0, winRatePercent: null, equityHistory: [], observers: 0, qualified: 0, lastError: null };
  const closed = shadow.closedTrades || [];
  const wins = closed.filter((trade) => trade.pnlUsd > 0).length;
  const latestEquity = shadow.equityHistory?.at(-1)?.valueUsd ?? shadow.cashUsd;
  return { id: "perp-follower", label: "Public perps", trades: closed.length, openPositions: shadow.positions.length, pnlUsd: Number(closed.reduce((sum, trade) => sum + trade.pnlUsd, 0).toFixed(4)), totalPnlUsd: Number((latestEquity - config.startingCapitalUsd).toFixed(4)), winRatePercent: closed.length ? Number((wins / closed.length * 100).toFixed(1)) : null, equityHistory: (shadow.equityHistory || []).map((point) => ({ at: point.at, pnlUsd: point.valueUsd - config.startingCapitalUsd })), observers: Object.keys(shadow.observedWallets || {}).length, qualified: Object.keys(shadow.qualifiedWallets || {}).length, lastError: shadow.lastError };
}
