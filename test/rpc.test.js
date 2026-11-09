import test from "node:test";
import assert from "node:assert/strict";
import { fetchPriorityFeeSol } from "../src/rpc.js";

const rpc = (result) => async (url, init) => {
  assert.equal(JSON.parse(init.body).method, "getRecentPrioritizationFees");
  return { ok: true, json: async () => ({ result }) };
};

test("uses the 75th percentile of non-zero fees for a 300k CU swap", async () => {
  const result = [0, 0, 1_000, 2_000, 3_000, 4_000].map((prioritizationFee, slot) => ({ slot, prioritizationFee }));
  // non-zero sorted [1000,2000,3000,4000] -> index 3 -> 4000 µLamports/CU * 300k CU = 1200 lamports = 0.0000012 SOL
  assert.ok(Math.abs(await fetchPriorityFeeSol("https://rpc.test", rpc(result)) - 0.0000012) < 1e-15);
});

test("returns 0 when there are no recent priority fees and caps outliers", async () => {
  assert.equal(await fetchPriorityFeeSol("https://rpc.test", rpc([{ slot: 1, prioritizationFee: 0 }])), 0);
  assert.equal(await fetchPriorityFeeSol("https://rpc.test", rpc([{ slot: 1, prioritizationFee: 1e12 }])), 0.01);
});
