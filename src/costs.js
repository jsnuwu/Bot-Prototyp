import { config } from "./config.js";

export const SOL_MINT = "So11111111111111111111111111111111111111112";

export function networkFeeUsd(solPriceUsd, fees = config.fees) {
  return (fees.baseFeeSol + fees.priorityFeeSol) * solPriceUsd;
}

// Constant-product price impact of trading `tradeUsd` against one side of the pool.
export function priceImpact(tradeUsd, liquidityUsd) {
  if (!(liquidityUsd > 0)) return 0;
  const side = liquidityUsd / 2;
  return tradeUsd / (side + tradeUsd);
}

export function simulateBuy({ amountUsd, priceUsd, liquidityUsd, solPriceUsd }, fees = config.fees) {
  const dexFee = amountUsd * fees.dexFeePercent / 100;
  const afterFee = amountUsd - dexFee;
  const impact = priceImpact(afterFee, liquidityUsd);
  const impactUsd = afterFee * impact;
  const slippageUsd = (afterFee - impactUsd) * fees.slippagePercent / 100;
  const receivedUsd = afterFee - impactUsd - slippageUsd;
  const networkUsd = networkFeeUsd(solPriceUsd, fees);
  const rentUsd = fees.tokenAccountRentSol * solPriceUsd;
  return {
    tokens: receivedUsd / priceUsd,
    fillPriceUsd: amountUsd / (receivedUsd / priceUsd),
    cashOutUsd: amountUsd + networkUsd + rentUsd,
    rentSol: fees.tokenAccountRentSol,
    feesUsd: { dex: dexFee, impact: impactUsd, slippage: slippageUsd, network: networkUsd }
  };
}

export function simulateSell({ tokens, priceUsd, liquidityUsd, solPriceUsd, rentSol = 0 }, fees = config.fees) {
  const grossUsd = tokens * priceUsd;
  const impactUsd = grossUsd * priceImpact(grossUsd, liquidityUsd);
  const slippageUsd = (grossUsd - impactUsd) * fees.slippagePercent / 100;
  const afterSlip = grossUsd - impactUsd - slippageUsd;
  const dexFee = afterSlip * fees.dexFeePercent / 100;
  const networkUsd = networkFeeUsd(solPriceUsd, fees);
  const rentRefundUsd = rentSol * solPriceUsd;
  return {
    grossUsd,
    cashInUsd: Math.max(0, afterSlip - dexFee - networkUsd) + rentRefundUsd,
    feesUsd: { dex: dexFee, impact: impactUsd, slippage: slippageUsd, network: networkUsd }
  };
}

export const sumFees = (f) => Object.values(f).reduce((total, v) => total + v, 0);
