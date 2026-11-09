# Solana Memecoin Paper Bot

Simulation only. This service does **not** create wallets, store private keys, sign transactions, or send trades. It gets public price data from DexScreener and models positions locally.

## Fixed risk controls

- Starting virtual cash: $100
- Maximum position: $5
- Take profit: +15%
- Stop loss: -8%
- Maximum open positions: 3
- Maximum realised daily loss: $5

The health/status endpoint is available at `/health`.

## Live chart

The dashboard at `/` shows the portfolio value as 15-second OHLC candles. Prices of open positions are polled every 3 seconds (`PRICE_TICK_MS`) via DexScreener's batch endpoint, aggregated server-side and persisted with the state, so the chart survives page reloads.

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
