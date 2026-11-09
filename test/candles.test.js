import test from "node:test";
import assert from "node:assert/strict";
import { addSample } from "../src/candles.js";

test("aggregates samples into one OHLC candle per 15s", () => {
  const c = [];
  addSample(c, 100, 0); addSample(c, 102, 5_000); addSample(c, 99, 10_000); addSample(c, 101, 14_999);
  assert.deepEqual(c, [{ time: 0, open: 100, high: 102, low: 99, close: 101 }]);
});

test("new candle opens at previous close and gaps are filled", () => {
  const c = [];
  addSample(c, 100, 0); addSample(c, 98, 46_000);
  assert.equal(c.length, 4);
  assert.deepEqual(c[1], { time: 15_000, open: 100, high: 100, low: 100, close: 100 });
  assert.deepEqual(c[3], { time: 45_000, open: 100, high: 100, low: 98, close: 98 });
});

test("keeps at most max candles", () => {
  const c = [];
  for (let i = 0; i < 10; i += 1) addSample(c, i, i * 15_000, 15_000, 5);
  assert.equal(c.length, 5);
  assert.equal(c[0].time, 75_000);
});
