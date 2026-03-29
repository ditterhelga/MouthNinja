const STORAGE_KEY = "mouthNinja:v1";

export function defaultState() {
  return {
    version: 1,
    calendarDay: null,
    activeSession: "morning",
    sessionsToday: {
      morning: { completedIds: [] },
      evening: { completedIds: [] },
    },
    streak: {
      count: 0,
      lastFullDay: null,
    },
    milestones: {
      shownFiveDay: false,
    },
  };
}

export function load() {
  const base = defaultState();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return base;

  try {
    const s = JSON.parse(raw);
    if (typeof s !== "object" || s === null) return defaultState();

    return {
      version: typeof s.version === "number" ? s.version : base.version,
      calendarDay: s.calendarDay ?? base.calendarDay,
      activeSession:
        s.activeSession === "morning" || s.activeSession === "evening"
          ? s.activeSession
          : base.activeSession,
      sessionsToday: {
        morning: {
          completedIds: Array.isArray(s.sessionsToday?.morning?.completedIds)
            ? [...s.sessionsToday.morning.completedIds]
            : [...base.sessionsToday.morning.completedIds],
        },
        evening: {
          completedIds: Array.isArray(s.sessionsToday?.evening?.completedIds)
            ? [...s.sessionsToday.evening.completedIds]
            : [...base.sessionsToday.evening.completedIds],
        },
      },
      streak: {
        count: typeof s.streak?.count === "number" ? s.streak.count : base.streak.count,
        lastFullDay: s.streak?.lastFullDay ?? base.streak.lastFullDay,
      },
      milestones: {
        shownFiveDay:
          typeof s.milestones?.shownFiveDay === "boolean"
            ? s.milestones.shownFiveDay
            : base.milestones.shownFiveDay,
      },
    };
  } catch {
    return defaultState();
  }
}

export function save(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
