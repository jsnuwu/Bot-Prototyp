import { config } from "./config.js";

const COMPUTE_UNITS = 300_000; // typical Jupiter swap
const MAX_PRIORITY_FEE_SOL = 0.01;

// Current priority fee in SOL for one swap, from recent prioritization fees (75th percentile of non-zero values).
export async function fetchPriorityFeeSol(rpcUrl = config.rpcUrl, fetchImpl = fetch) {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getRecentPrioritizationFees", params: [] }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Solana RPC responded with ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`Solana RPC error: ${body.error.message}`);
  const fees = (body.result || []).map((f) => f.prioritizationFee).filter((f) => f > 0).sort((a, b) => a - b);
  if (!fees.length) return 0;
  const microLamportsPerCu = fees[Math.min(fees.length - 1, Math.floor(fees.length * 0.75))];
  return Math.min(MAX_PRIORITY_FEE_SOL, (microLamportsPerCu * COMPUTE_UNITS) / 1e6 / 1e9);
}
