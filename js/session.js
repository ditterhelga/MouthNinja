/** @typedef {"morning" | "evening"} Period */

const STORAGE_DAY = "mn_day_sessions_v1";
const STORAGE_SPIN = "mn_spin_wheel_date_v1";

/** ISO local date yyyy-mm-dd */
export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Full store shape: Record<yyyy-mm-dd, { morningIds, eveningIds, congratMorning?, congratEvening?, morningPrize?, eveningPrize?, prizeLabel? }>
 */
function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_DAY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return typeof o === "object" && o ? o : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  localStorage.setItem(STORAGE_DAY, JSON.stringify(store));
}

function ensureDay(dayKey) {
  const store = readStore();
  if (!store[dayKey]) {
    store[dayKey] = {
      morningIds: [],
      eveningIds: [],
      congratMorning: false,
      congratEvening: false,
      prizeLabel: null,
    };
  }
  return { store, day: /** @type {any} */ (store[dayKey]) };
}

/** yyyy-mm-dd keys, newest calendar day first */
export function listDayKeysDescending() {
  const store = readStore();
  return Object.keys(store).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/** @returns {{ morningIds: string[], eveningIds: string[], morningPrize: string | null, eveningPrize: string | null, prizeLabel: string | null } | null} */
export function getDayRecord(dayKey) {
  const store = readStore();
  const day = store[dayKey];
  if (!day || typeof day !== "object") return null;
  const m = Array.isArray(day.morningIds) ? [...day.morningIds] : [];
  const e = Array.isArray(day.eveningIds) ? [...day.eveningIds] : [];
  const mp = typeof day.morningPrize === "string" && day.morningPrize.trim() !== "" ? day.morningPrize.trim() : null;
  const ep = typeof day.eveningPrize === "string" && day.eveningPrize.trim() !== "" ? day.eveningPrize.trim() : null;
  const legacy = typeof day.prizeLabel === "string" && day.prizeLabel.trim() !== "" ? day.prizeLabel.trim() : null;
  return { morningIds: m, eveningIds: e, morningPrize: mp, eveningPrize: ep, prizeLabel: legacy };
}

/**
 * Persist wheel prize for a specific period.
 * @param {string} dayKey
 * @param {string} prizeFullLabel
 * @param {Period} [period]
 */
export function saveDayPrize(dayKey, prizeFullLabel, period) {
  const { store, day } = ensureDay(dayKey);
  const val = String(prizeFullLabel ?? "").trim() || null;
  if (period === "morning") day.morningPrize = val;
  else if (period === "evening") day.eveningPrize = val;
  else day.prizeLabel = val;
  writeStore(store);
}

/**
 * @returns {readonly string[]}
 */
export function getCompletedIdsForPeriod(period, dayKey = todayKey()) {
  const store = readStore();
  const day = store[dayKey];
  if (!day) return [];
  const key = period === "morning" ? "morningIds" : "eveningIds";
  return Array.isArray(day[key]) ? [...day[key]] : [];
}

/** @returns {boolean} true if newly added */
export function addCompletedExercise(period, exerciseId, dayKey = todayKey()) {
  const { store, day } = ensureDay(dayKey);
  const arr = period === "morning" ? day.morningIds : day.eveningIds;
  const list = Array.isArray(arr) ? arr : [];
  if (list.includes(exerciseId)) return false;
  list.push(exerciseId);
  if (period === "morning") day.morningIds = list;
  else day.eveningIds = list;
  writeStore(store);
  return true;
}

/** Remove one exercise id from today's session list (debug / QA). */
export function removeCompletedExercise(period, exerciseId, dayKey = todayKey()) {
  const store = readStore();
  const day = store[dayKey];
  if (!day) return false;
  const key = period === "morning" ? "morningIds" : "eveningIds";
  const list = Array.isArray(day[key]) ? [...day[key]] : [];
  const next = list.filter((id) => id !== exerciseId);
  if (next.length === list.length) return false;
  day[key] = next;
  writeStore(store);
  return true;
}

export function isExerciseDoneInPeriod(period, exerciseId, dayKey = todayKey()) {
  return getCompletedIdsForPeriod(period, dayKey).includes(exerciseId);
}

/** @returns {boolean} */
export function isPeriodFullyComplete(period, allExerciseIds, dayKey = todayKey()) {
  const done = new Set(getCompletedIdsForPeriod(period, dayKey));
  return allExerciseIds.every((id) => done.has(id));
}

export function congratsShownForMorning(dayKey = todayKey()) {
  const store = readStore();
  const day = store[dayKey];
  return !!(day && day.congratMorning);
}

export function setCongratsShownForMorning(dayKey = todayKey()) {
  const { store, day } = ensureDay(dayKey);
  day.congratMorning = true;
  writeStore(store);
}

export function congratsShownForEvening(dayKey = todayKey()) {
  const store = readStore();
  const day = store[dayKey];
  return !!(day && day.congratEvening);
}

export function setCongratsShownForEvening(dayKey = todayKey()) {
  const { store, day } = ensureDay(dayKey);
  day.congratEvening = true;
  writeStore(store);
}

/** True only when BOTH morning and evening are 7/7 on the same calendar day. */
export function bothPeriodsFullyComplete(allExerciseIds, dayKey = todayKey()) {
  return (
    isPeriodFullyComplete("morning", allExerciseIds, dayKey) &&
    isPeriodFullyComplete("evening", allExerciseIds, dayKey)
  );
}

/** Has the spin wheel already been shown for this period today? */
export function spinShownForPeriod(period, dayKey = todayKey()) {
  const store = readStore();
  const day = store[dayKey];
  if (!day) return false;
  return period === "morning" ? !!day.spinShownMorning : !!day.spinShownEvening;
}

/** Mark spin wheel as shown for a period today. */
export function setSpinShownForPeriod(period, dayKey = todayKey()) {
  const { store, day } = ensureDay(dayKey);
  if (period === "morning") day.spinShownMorning = true;
  else day.spinShownEvening = true;
  writeStore(store);
}

/** Reset spin-shown flag (debug/QA only). */
export function clearSpinShownForPeriod(period, dayKey = todayKey()) {
  const { store, day } = ensureDay(dayKey);
  if (period === "morning") day.spinShownMorning = false;
  else day.spinShownEvening = false;
  writeStore(store);
}

/** @deprecated kept for backwards compat — use spinShownForPeriod instead */
export function spinWheelConsumedForDate() {
  try {
    return localStorage.getItem(STORAGE_SPIN) || null;
  } catch {
    return null;
  }
}

/** @deprecated */
export function setSpinWheelConsumedForDate(dayKey = todayKey()) {
  try {
    localStorage.setItem(STORAGE_SPIN, dayKey);
  } catch {
    /* ignore */
  }
}
