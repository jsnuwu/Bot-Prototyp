import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export function freshState() {
  return { cashUsd: 100, positions: [], closedTrades: [], events: [], history: [], candles: [], marketCandles: [], dailyLossUsd: 0, feesPaidUsd: 0, solPriceUsd: null, lossDate: new Date().toISOString().slice(0, 10), lastScanAt: null, startedAt: new Date().toISOString() };
}

// Storage backend: Postgres when DATABASE_URL is set (survives restarts and redeploys), otherwise a local JSON file.
export async function createStore({ databaseUrl, stateFile }) {
  if (!databaseUrl) return fileStore(stateFile);
  const { default: pg } = await import("pg");
  const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(databaseUrl) || process.env.DATABASE_SSL === "false";
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 8000, statement_timeout: 8000, ssl: local ? false : { rejectUnauthorized: false } });
  await pool.query("CREATE TABLE IF NOT EXISTS paper_bot_state (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  await pool.query("ALTER TABLE paper_bot_state ADD COLUMN IF NOT EXISTS writer_id UUID");
  const writer = randomUUID();
  return {
    kind: "postgres",
    async load() {
      // A replacement instance takes over the latest committed checkpoint atomically.
      const { rows } = await pool.query(`INSERT INTO paper_bot_state (id,data,writer_id)
        VALUES ('main', $1, $2) ON CONFLICT (id) DO UPDATE SET writer_id=EXCLUDED.writer_id
        RETURNING data`, [JSON.stringify(freshState()), writer]);
      return { ...freshState(), ...rows[0].data };
    },
    async save(state) {
      const result = await pool.query("UPDATE paper_bot_state SET data=$1, updated_at=now() WHERE id='main' AND writer_id=$2", [JSON.stringify(state), writer]);
      if (result.rowCount !== 1) throw new Error("A newer instance owns the checkpoint");
    },
    close: () => pool.end()
  };
}

function fileStore(file) {
  return { kind: "file", load: () => loadState(file), save: (state) => saveState(file, state), close: async () => {} };
}

export async function loadState(file) {
  try {
    return { ...freshState(), ...JSON.parse(await readFile(file, "utf8")) };
  } catch (error) {
    if (error.code === "ENOENT") return freshState();
    throw error;
  }
}

export async function saveState(file, state) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2));
  await rename(temporary, file);
}

export function resetDailyLossIfNeeded(state, today = new Date().toISOString().slice(0, 10)) {
  if (state.lossDate !== today) {
    state.lossDate = today;
    state.dailyLossUsd = 0;
  }
}
