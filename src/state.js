import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function freshState() {
  return { cashUsd: 100, positions: [], closedTrades: [], dailyLossUsd: 0, lossDate: new Date().toISOString().slice(0, 10), lastScanAt: null };
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
