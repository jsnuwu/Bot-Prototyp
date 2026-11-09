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
| `src/market.js` | DexScreener: Kandidatensuche, Batch-Preise (`/tokens/v1/solana/a,b,c`) |
| `src/state.js` | JSON-State laden/speichern (`data/state.json`) |
| `src/config.js` | Feste Risiko-Parameter + Env-Variablen |

## Laufzeit-Ablauf

- **Scan** alle 90 s (`SCAN_INTERVAL_MS`): Preise holen, TP/SL prüfen, neue Kandidaten öffnen, State speichern.
- **Preis-Tick** alle 3 s (`PRICE_TICK_MS`): Preise offener Positionen holen, TP/SL prüfen, Portfoliowert als Kerzen-Sample erfassen.
- Scan und Tick laufen über `exclusive()` nie gleichzeitig.
- **State speichern** alle 15 s (inkl. `state.candles`).
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

## Bekannte Einschränkungen / offene Punkte

- Render-Free-Dateisystem ist flüchtig: Bei Neustart/Redeploy wird der State (Kapital 100 $, Kerzen, Trades) zurückgesetzt. Lösung wäre externer Speicher (z. B. kostenlose Datenbank).
- Ist der Dienst trotzdem eingeschlafen/abgestürzt, weckt der Selbst-Ping ihn nicht – dafür externer Pinger (UptimeRobot, cron-job.org) auf `/health`.
- Ohne offene Positionen ist der Portfoliowert konstant → flache Kerzen (gewollt).
