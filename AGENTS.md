# Projektnotizen für Agents

Simulation-only Solana-Memecoin-Paper-Trading-Bot (Node ≥ 20, keine Dependencies). Kein Wallet, keine echten Trades. Läuft auf Render Free (`render.yaml`), Deploy automatisch bei Push auf `main`.

## Regeln

- Keine KI-Assistenten/Tools in Commits, Kommentaren oder Code erwähnen (auch keine Co-Author-Zeilen). Commits als `Jason Bay <156311473+jsnuwu@users.noreply.github.com>`.
- Nur Paper-Modus (`TRADING_MODE=paper`), keine Live-Trading-Logik einbauen.
- Vor dem Push: `npm test`.

## Struktur

| Datei | Inhalt |
|---|---|
| `src/index.js` | HTTP-Server (`/`, `/health`, `/api/status`), Loops (Scan, Preis-Tick, Speichern, Keep-alive) |
| `src/dashboard.js` | Komplettes Dashboard-HTML/JS als String (Candlestick-Chart, Karten, Feeds) |
| `src/candles.js` | `addSample()`: aggregiert Werte zu OHLC-Kerzen (15 s, max. 240) |
| `src/engine.js` | Positionen öffnen/schließen (TP +15 %, SL −8 %), Portfoliowert |
| `src/market.js` | DexScreener: Kandidatensuche, Batch-Quotes (Preis + Liquidität, `/tokens/v1/solana/a,b,c`) |
| `src/jupiter.js` | Jupiter-Quotes (USDC ⇄ Token) für echte Swap-Kosten; nur Quotes, nichts wird signiert/gesendet |
| `src/rpc.js` | Live-Priority-Fee über `SOLANA_RPC_URL` (`getRecentPrioritizationFees`, p75 × 300k CU) |
| `src/costs.js` | Kostenmodell (Fallback): DEX-Fee, Price-Impact, Slippage, Netzwerk-Fee, Token-Account-Rent |
| `src/state.js` | Speicher: Postgres (`DATABASE_URL`, Tabelle `paper_bot_state`, eine Zeile `main` mit JSONB) oder JSON-Datei |
| `src/stats.js` | Auswertung (Win-Rate, Profit-Factor, Return …) und CSV-Export |
| `src/config.js` | Feste Risiko-Parameter + Env-Variablen |

## Laufzeit-Ablauf

- **Scan** alle 90 s (`SCAN_INTERVAL_MS`): Preise holen, TP/SL prüfen, neue Kandidaten öffnen, State speichern.
- **Preis-Tick** alle 3 s (`PRICE_TICK_MS`): Preise offener Positionen holen, TP/SL prüfen, Portfoliowert als Kerzen-Sample erfassen.
- Scan und Tick laufen über `exclusive()` nie gleichzeitig.
- **State speichern** alle 15 s (inkl. `state.candles`).
- **Priority-Fee** alle 60 s über `SOLANA_RPC_URL` (falls gesetzt), gespeichert in `state.priorityFeeSol`.
- **Keep-alive** alle 10 min: GET auf eigene `/health`-URL (`RENDER_EXTERNAL_URL` bzw. `KEEP_ALIVE_URL`, Intervall `KEEP_ALIVE_MS`).

## Änderungsverlauf

### Echte 15-s-Kerzen (`e7e803f`)
- Problem vorher: Browser sammelte alle 15 s nur einen Wert, Scan nur alle 90 s → Kerzen mit O=H=L=C (Striche), Verlust beim Neuladen.
- Kerzen werden jetzt serverseitig aus 3-s-Ticks gebaut (`src/candles.js`), neue Kerze öffnet beim vorherigen Close, Lücken werden mit flachen Kerzen gefüllt, Persistenz im State.
- Dashboard nach `src/dashboard.js` ausgelagert: Candlestick-Chart mit Preis-/Zeitachse, Last-Price-Linie, OHLC-Anzeige beim Hover, Countdown zur nächsten Kerze, Polling alle 2 s.
- TP/SL wird jetzt auch bei jedem Tick (3 s) geprüft, nicht nur beim Scan.
- Zwei ungenutzte alte Dashboard-Varianten aus `src/index.js` entfernt.
- Tests: `test/candles.test.js`.

### Selbst-Ping gegen Render-Sleep (`6ca8696`)
- Render Free schläft nach ~15 min ohne eingehenden Traffic; interne Timer zählen nicht.
- Bot pingt sich alle 10 min selbst über die öffentliche URL.

### Realistische Gebühren + Jupiter-Quotes
- Jeder simulierte Kauf/Verkauf holt ein echtes Jupiter-Quote (`USDC → Token` bzw. `Token → USDC`, roher Token-Betrag in `position.rawTokens`). Swap-Kosten = Marktwert (DexScreener-Preis) − Quote-Ergebnis.
- Token-Decimals werden aus Quote und Marktpreis abgeleitet (`raw * price / 10^d ≈ 5 $`).
- Zusätzlich pro Swap: 0,5 % Ausführungs-Slippage, Netzwerk-Fee (Basis + Priority, live SOL-Preis), Token-Account-Rent (Kauf hinterlegt, Verkauf zurück).
- Schlägt Jupiter fehl (kein Key, Rate-Limit, keine Route), greift das Kostenmodell in `src/costs.js`; Trades sind mit `pricing` / `exitPricing` = `jupiter` | `model` markiert.
- Portfoliowert = Netto-Liquidationswert. Dashboard zeigt Realized P&L (netto), bezahlte Fees, SOL-Preis und Jupiter-Status.
- Env: `JUPITER_API_KEY` (in Render setzen), optional `JUPITER_API_URL`, `JUPITER_ENABLED`, `DEX_FEE_PERCENT`, `SLIPPAGE_PERCENT`, `PRIORITY_FEE_SOL`.
- TP/SL-Trigger bleiben preisbasiert (DexScreener-Kurs vs. Einstiegskurs), Gewinne/Verluste werden netto verbucht.
- Tests: `test/engine.test.js`, `test/jupiter.test.js` (Jupiter per Mock-fetch).

### Live-Priority-Fees über Solana-RPC
- `src/rpc.js` holt jede Minute die aktuellen Priority-Fees; Engine nutzt sie automatisch statt `PRIORITY_FEE_SOL`.
- Render-Env des Services: `JUPITER_API_KEY`, `SOLANA_RPC_URL`, `TRADING_MODE`, `DATABASE_URL`.

### Dauerhafte Speicherung + Auswertung
- State in Postgres über `DATABASE_URL` (SSL außer bei localhost bzw. `DATABASE_SSL=false`), gespeichert alle 15 s und bei SIGTERM/SIGINT.
- Ist die DB beim Start nicht erreichbar, beendet sich der Prozess (Render startet neu), damit nie ein leerer State die DB überschreibt.
- Endpunkte: `/api/trades` (JSON), `/api/trades.csv`. Dashboard-Panel „Performance“. `startedAt` im State = Beginn der Auswertung.
- Getestet gegen lokale Postgres 16 inkl. Neustart per SIGTERM.

## Bekannte Einschränkungen / offene Punkte

- Globale Priority-Fees (p75) liegen oft unter dem, was Memecoin-Bots in hektischen Phasen zahlen (inkl. Jito-Tips). Bei Bedarf Perzentil erhöhen oder Mindestwert einführen.

- Jupiter-Anbindung ist nur mit Mocks getestet (keine Netzverbindung beim Entwickeln). Nach dem Deploy prüfen: Statuszeile im Dashboard muss „Swap pricing: Jupiter quotes“ zeigen.
- Ohne `JUPITER_API_KEY` wird `lite-api.jup.ag` genutzt; falls der abgeschaltet ist, läuft nur das Kostenmodell.

- Ohne `DATABASE_URL` ist der State auf Render flüchtig (Reset bei Neustart/Redeploy). Render-Free-Postgres läuft nach ~30 Tagen ab → besser Neon/Supabase.
- Ist der Dienst trotzdem eingeschlafen/abgestürzt, weckt der Selbst-Ping ihn nicht – dafür externer Pinger (UptimeRobot, cron-job.org) auf `/health`.
- Ohne offene Positionen ist der Portfoliowert konstant → flache Kerzen (gewollt).
