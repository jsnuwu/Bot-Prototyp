# Solana Memecoin Paper Bot

Simulation only. This service does **not** create wallets, store private keys, sign transactions, or send trades. It gets public price data from DexScreener and models positions locally.

## Fixed risk controls

- Starting virtual cash: $100
- Maximum position: $5
- Take profit: +15%
- Stop loss: -8%
- Maximum open positions: 10
- Maximum realised daily loss: $5

The health/status endpoint is available at `/health`.

## Live chart

The dashboard at `/` shows the portfolio value as 15-second OHLC candles. Prices of open positions are polled every 3 seconds (`PRICE_TICK_MS`) via DexScreener's batch endpoint, aggregated server-side and persisted with the state, so the chart survives page reloads.

## Realistic trading costs

Every simulated swap is charged like a real one, so P&L is net:

- **Swap price (DEX fee + price impact):** taken from a real Jupiter quote (`USDC ⇄ token`). Without a working quote the bot falls back to a model: 0.25 % DEX fee (`DEX_FEE_PERCENT`) plus constant-product price impact from DexScreener liquidity.
- **Execution slippage:** extra 0.5 % per swap for price movement between quote and landing (`SLIPPAGE_PERCENT`).
- **Network fees:** base fee + priority fee (`PRIORITY_FEE_SOL`, default 0.0005 SOL) per swap, converted at the live SOL price.
- **Token account rent:** 0.00203928 SOL deposited on buy, refunded on sell.
- **Portfolio value** is the net liquidation value (what selling everything now would return).

Jupiter environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `JUPITER_API_KEY` | – | API key from portal.jup.ag (sent as `x-api-key`) |
| `JUPITER_API_URL` | `https://api.jup.ag/swap/v1` with key, else `https://lite-api.jup.ag/swap/v1` | Quote API base URL |
| `JUPITER_ENABLED` | `true` | `false` = cost model only |

Only quotes are requested. Nothing is signed or sent; no wallet or private key is used.

## Running locally

Requires Node.js 20 or later:

```bash
npm ci
npm test
npm start
```

## Keep-alive

On Render the bot pings its own public `/health` URL every 10 minutes (`RENDER_EXTERNAL_URL`, override with `KEEP_ALIVE_URL` / `KEEP_ALIVE_MS`) so the free service does not spin down. If it is down anyway, an external pinger (e.g. UptimeRobot) is needed to wake it.

## Render free-tier limitation

`render.yaml` deliberately uses the `free` plan. Free web services may spin down when idle, and their filesystem is ephemeral. The JSON state file can therefore reset after a restart/redeploy, so this is a demonstration paper bot, **not** reliable 24/7 hosting or durable accounting. No paid disk, database, or other paid resource is configured.
