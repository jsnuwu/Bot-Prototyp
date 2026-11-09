import test from "node:test";
import assert from "node:assert/strict";
import { startHeartbeat } from "../src/heartbeat.js";
import { createStore } from "../src/state.js";

test("heartbeat checks the public health route and retains last success on failure", async () => {
  let ok = true;
  const heartbeat = startHeartbeat("https://example.com/", 600000, async target => {
    assert.equal(target.href, "https://example.com/healthz");
    return { ok, text: async () => "ok" };
  });
  await heartbeat.ping();
  const success = heartbeat.status.lastSuccess;
  assert.ok(success);
  ok = false;
  await heartbeat.ping();
  assert.ok(heartbeat.status.lastError);
  assert.equal(heartbeat.status.lastSuccess, success);
});

test("replacement process resumes committed positions and fences the previous writer", {
  skip: !process.env.PAPER_TEST_DATABASE_URL
}, async () => {
  const opts = { databaseUrl: process.env.PAPER_TEST_DATABASE_URL };
  const first = await createStore(opts);
  const second = await createStore(opts);
  try {
    const state = await first.load();
    state.cashUsd = 94.75;
    state.positions = [{token:"test-token", amountUsd:5}];
    await first.save(state);
    const recovered = await second.load();
    assert.deepEqual(recovered, state);
    await assert.rejects(first.save({...state, cashUsd:100}), /newer instance/);
    await second.save({...recovered, cashUsd:95});
    assert.equal((await second.load()).cashUsd, 95);
  } finally { await Promise.all([first.close(), second.close()]); }
});
