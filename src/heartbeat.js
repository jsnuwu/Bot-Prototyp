export function startHeartbeat(baseUrl, intervalMs, request = fetch) {
  const url = baseUrl ? new URL("/healthz", baseUrl) : null;
  const status = { enabled: Boolean(url), intervalMs, lastAttempt: null, lastSuccess: null, lastError: null };
  let timer = null, busy = false;
  async function ping() {
    if (!url || busy) return;
    busy = true;
    status.lastAttempt = new Date().toISOString();
    try {
      const res = await request(url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
      if (!res.ok || (await res.text()).trim() !== "ok") throw new Error("Health check failed");
      status.lastSuccess = new Date().toISOString();
      status.lastError = null;
    } catch { status.lastError = "Self-ping failed"; }
    finally { busy = false; }
  }
  return { status, ping, start() {
    if (!url || timer) return;
    void ping(); timer = setInterval(ping, intervalMs);
  }, stop() { clearInterval(timer); timer = null; } };
}
