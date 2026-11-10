export const CANDLE_MS = 15_000;
// 24 hours of 15-second candles. This is intentionally bounded so the
// persistent state stays predictable while still providing useful context.
export const MAX_CANDLES = 5_760;

// Aggregates a value sample into OHLC candles of fixed length.
// A new candle opens at the previous close, like a regular trading chart.
export function addSample(candles, value, now = Date.now(), intervalMs = CANDLE_MS, max = MAX_CANDLES) {
  const time = Math.floor(now / intervalMs) * intervalMs;
  const last = candles.at(-1);
  if (last && last.time === time) {
    last.high = Math.max(last.high, value);
    last.low = Math.min(last.low, value);
    last.close = value;
    return candles;
  }
  if (last && time < last.time) return candles;
  // Fill skipped intervals with flat candles so the time axis stays continuous.
  if (last) {
    for (let t = last.time + intervalMs; t < time && time - t < max * intervalMs; t += intervalMs) {
      candles.push({ time: t, open: last.close, high: last.close, low: last.close, close: last.close });
    }
  }
  const open = last ? last.close : value;
  candles.push({ time, open, high: Math.max(open, value), low: Math.min(open, value), close: value });
  if (candles.length > max) candles.splice(0, candles.length - max);
  return candles;
}
