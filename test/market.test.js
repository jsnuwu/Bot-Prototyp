import test from "node:test";
import assert from "node:assert/strict";
import { qualifiesMomentum } from "../src/market.js";

const rules = { minLiquidityUsd: 35_000, minVolumeM5Usd: 1_500, minPriceChangeM5Percent: 2, maxPriceChangeM5Percent: 45 };
const candidate = { liquidityUsd: 50_000, volumeM5Usd: 2_000, priceChangeM5Percent: 8, buysM5: 22, sellsM5: 12 };

test("accepts a fresh boost with buyer-led confirmed momentum", () => {
  assert.equal(qualifiesMomentum(candidate, rules), true);
});

test("rejects a fresh boost without volume, buyers, or a controlled price move", () => {
  assert.equal(qualifiesMomentum({ ...candidate, volumeM5Usd: 400 }, rules), false);
  assert.equal(qualifiesMomentum({ ...candidate, buysM5: 8, sellsM5: 12 }, rules), false);
  assert.equal(qualifiesMomentum({ ...candidate, priceChangeM5Percent: 70 }, rules), false);
});
