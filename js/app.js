import { TASKS, getTaskById } from "./config.js";
import { load, save } from "./storage.js";

const CELEBRATION_EMOJIS = ["🤪", "😆", "🥳", "🤩", "🐸", "🦄", "🍕", "💥", "🎉"];

let lastCelebrationEmoji = null;

function pickRandomCelebrationEmoji() {
  if (CELEBRATION_EMOJIS.length < 2) {
    return CELEBRATION_EMOJIS[0];
  }
  let pick = CELEBRATION_EMOJIS[Math.floor(Math.random() * CELEBRATION_EMOJIS.length)];
  let guard = 0;
  while (pick === lastCelebrationEmoji && guard < 24) {
    pick = CELEBRATION_EMOJIS[Math.floor(Math.random() * CELEBRATION_EMOJIS.length)];
    guard += 1;
  }
  lastCelebrationEmoji = pick;
  return pick;
}

function localCalendarDay() {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function yesterdayCalendarDay() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function calendarDayFromOffset(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

let completionAudioCtx = null;

function ensureCompletionAudioContext() {
  if (!completionAudioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    completionAudioCtx = new Ctx();
  }
  return completionAudioCtx;
}

function resumeCompletionAudioIfNeeded() {
  const ctx = ensureCompletionAudioContext();
  if (ctx && ctx.state === "suspended") {
    void ctx.resume();
  }
  return ctx;
}

function playSoftCompletionChime() {
  const ctx = completionAudioCtx;
  if (!ctx || ctx.state !== "running") return;
  try {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(784, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.06, t0 + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.24);
  } catch {
    /* ignore */
  }
}

function updateStreakIfDayJustCompleted(state) {
  const m = state.sessionsToday.morning.completedIds;
  const e = state.sessionsToday.evening.completedIds;
  if (!isSessionComplete(m) || !isSessionComplete(e)) return;

  const today = localCalendarDay();
  const last = state.streak.lastFullDay;

  if (last === today) return;

  if (last === yesterdayCalendarDay()) {
    state.streak.count = (typeof state.streak.count === "number" ? state.streak.count : 0) + 1;
  } else {
    state.streak.count = 1;
  }
  state.streak.lastFullDay = today;
}

function updateHistoryForToday(state) {
  const today = localCalendarDay();
  if (!state.history || typeof state.history !== "object") state.history = {};
  const m = state.sessionsToday.morning.completedIds.length;
  const ev = state.sessionsToday.evening.completedIds.length;
  const tl = TASKS.length;
  state.history[today] = {
    morningCount: m,
    eveningCount: ev,
    completed: m === tl && ev === tl,
  };
}

function ensureCalendarDay(state) {
  const today = localCalendarDay();
  if (state.calendarDay !== today) {
    state.sessionsToday.morning.completedIds = [];
    state.sessionsToday.evening.completedIds = [];
    state.calendarDay = today;
    save(state);
  }
  return state;
}

function normalizeActiveSession(state) {
  if (state.activeSession !== "morning" && state.activeSession !== "evening") {
    state.activeSession = "morning";
    save(state);
  }
  return state;
}

function isSessionComplete(completedIds) {
  const set = new Set(completedIds);
  return TASKS.length > 0 && TASKS.every((t) => set.has(t.id));
}

function getCompletedIdsForList(state, session) {
  return new Set(state.sessionsToday[session].completedIds);
}

function formatStreakLabel(count) {
  const c = typeof count === "number" ? count : 0;
  return `🔥 ${c}`;
}

function renderTaskList() {
  const list = document.querySelector(".task-list");
  if (!list) return;

  let state = load();
  state = ensureCalendarDay(state);
  state = normalizeActiveSession(state);
  const session = state.activeSession;

  const morningIds = state.sessionsToday.morning.completedIds;
  const eveningIds = state.sessionsToday.evening.completedIds;
  const allDone = isSessionComplete(morningIds) && isSessionComplete(eveningIds);

  const completedSet = getCompletedIdsForList(state, session);
  const sessionIds = state.sessionsToday[session].completedIds;
  const progressCount = sessionIds.length;

  const progressPara = document.querySelector(".session-progress");
  if (progressPara) {
    progressPara.replaceChildren();
    const countSpan = document.createElement("span");
    countSpan.className = "session-progress-count";
    countSpan.textContent = String(progressCount);
    progressPara.append(countSpan, document.createTextNode(` / ${TASKS.length}`));
  }

  const tablistEl = document.querySelector(".session-tabs");
  if (tablistEl) {
    tablistEl.classList.toggle("session-tabs--disabled", allDone);
  }

  const allDoneEl = document.getElementById("all-done-message");
  if (allDoneEl) {
    if (allDone) {
      allDoneEl.textContent = "All done today! 🎉";
      allDoneEl.hidden = false;
    } else {
      allDoneEl.textContent = "";
      allDoneEl.hidden = true;
    }
  }

  const streakTextEl = document.querySelector(".streak-text");
  if (streakTextEl) {
    const c = typeof state.streak.count === "number" ? state.streak.count : 0;
    streakTextEl.textContent = formatStreakLabel(c);
  }

  document.querySelectorAll(".session-tab").forEach((btn) => {
    const isActive = btn.dataset.session === session;
    btn.classList.toggle("session-tab--active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
    btn.disabled = allDone;
    btn.setAttribute("aria-disabled", allDone ? "true" : "false");
  });

  list.setAttribute("aria-labelledby", session === "morning" ? "tab-morning" : "tab-evening");

  const incomplete = TASKS.filter((t) => !completedSet.has(t.id));
  const complete = TASKS.filter((t) => completedSet.has(t.id));
  const ordered = [...incomplete, ...complete];

  list.replaceChildren();
  const fragment = document.createDocumentFragment();

  for (const task of ordered) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    const isDone = completedSet.has(task.id);
    a.className = isDone ? "task-row task-row--done" : "task-row task-row--todo";
    if (allDone) {
      a.classList.add("task-row--nointeract");
      a.setAttribute("aria-disabled", "true");
      a.setAttribute("tabindex", "-1");
    }
    a.href = `task.html?id=${encodeURIComponent(task.id)}`;

    const emoji = document.createElement("span");
    emoji.className = "task-emoji";
    emoji.setAttribute("aria-hidden", "true");
    emoji.textContent = task.emoji;

    const name = document.createElement("span");
    name.className = "task-name";
    name.textContent = task.name;

    a.append(emoji, name);
    if (isDone) {
      const check = document.createElement("span");
      check.className = "task-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = "\u2713";
      a.append(check);
    }
    if (allDone) {
      a.addEventListener("click", (e) => e.preventDefault());
    }
    li.append(a);
    fragment.append(li);
  }

  list.append(fragment);
}

let homeTabsWired = false;
let rewardOverlayWired = false;

function maybeShowRewardOverlay() {
  const overlay = document.getElementById("reward-overlay");
  if (!overlay) return;
  let state = load();
  state = ensureCalendarDay(state);
  const count = typeof state.streak.count === "number" ? state.streak.count : 0;
  const shown = state.milestones.shownFiveDay === true;
  if (count >= 5 && !shown) {
    const emojiEl = document.getElementById("reward-emoji");
    const rewardEmojis = ["🎉", "🔥", "🥷"];
    if (emojiEl) {
      emojiEl.textContent = rewardEmojis[Math.floor(Math.random() * rewardEmojis.length)];
    }
    overlay.removeAttribute("hidden");
    overlay.setAttribute("aria-hidden", "false");
  }
  if (!rewardOverlayWired) {
    rewardOverlayWired = true;
    const btn = document.getElementById("reward-dismiss");
    if (btn) {
      btn.style.cursor = "pointer";
      btn.addEventListener("click", () => {
        const ov = document.getElementById("reward-overlay");
        let s = load();
        s.milestones.shownFiveDay = true;
        save(s);
        if (ov) {
          ov.setAttribute("hidden", "");
          ov.setAttribute("aria-hidden", "true");
        }
      });
    }
  }
}

function initHomePage() {
  const tablist = document.querySelector(".session-tabs");
  if (tablist && !homeTabsWired) {
    homeTabsWired = true;
    tablist.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-session]");
      if (!btn) return;
      const next = btn.dataset.session;
      if (next !== "morning" && next !== "evening") return;
      let s = load();
      s = ensureCalendarDay(s);
      const m = s.sessionsToday.morning.completedIds;
      const ev = s.sessionsToday.evening.completedIds;
      if (isSessionComplete(m) && isSessionComplete(ev)) {
        e.preventDefault();
        return;
      }
      s.activeSession = next;
      save(s);
      renderTaskList();
    });
  }
  renderTaskList();
  maybeShowRewardOverlay();
}

window.addEventListener("pageshow", () => {
  if (document.querySelector(".task-list")) {
    renderTaskList();
    maybeShowRewardOverlay();
  }
});

function formatMMSS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function initTaskPage() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const task = id ? getTaskById(id) : null;

  if (!task) {
    window.location.replace("index.html");
    return;
  }

  const titleEl = document.querySelector(".task-title");
  const cameraVideo = document.querySelector(".camera-video");
  const cameraLoading = document.querySelector(".camera-loading");
  const cameraFallback = document.querySelector(".camera-fallback");
  const timerDisplay = document.querySelector(".timer-display");
  const toggleBtn = document.querySelector(".timer-bar .btn--primary");
  const overlay = document.querySelector(".completion-overlay");
  const overlayEmoji = document.querySelector(".completion-emoji");
  const completionDialog = document.querySelector(".completion-dialog");
  const completionTitle = document.querySelector(".completion-title");
  const btnDid = document.querySelector(".completion-btn-did");
  const btnRetry = document.querySelector(".completion-btn-retry");
  const backLink = document.querySelector(".back-link");

  if (titleEl) titleEl.textContent = task.name;
  document.title = `Mouth Ninja — ${task.name}`;

  let cameraStream = null;
  let cameraInitRequested = false;

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
    if (cameraVideo) cameraVideo.srcObject = null;
  }

  function stopCameraStreamTracksKeepVisual() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
  }

  function hideCameraLoading() {
    if (cameraLoading) cameraLoading.hidden = true;
  }

  function showCameraLoading() {
    if (cameraLoading) cameraLoading.hidden = false;
  }

  function showCameraFallbackMessage() {
    hideCameraLoading();
    if (cameraVideo) cameraVideo.classList.add("camera-video--hidden");
    if (cameraFallback) cameraFallback.hidden = false;
  }

  function initCameraOnce() {
    if (cameraInitRequested) return;
    cameraInitRequested = true;
    showCameraLoading();
    if (!cameraVideo || !navigator.mediaDevices?.getUserMedia) {
      showCameraFallbackMessage();
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" } })
      .then((stream) => {
        cameraStream = stream;
        const hideLoadingWhenReady = () => {
          hideCameraLoading();
        };
        cameraVideo.addEventListener("playing", hideLoadingWhenReady, { once: true });
        cameraVideo.addEventListener("canplay", hideLoadingWhenReady, { once: true });
        cameraVideo.srcObject = stream;
        const p = cameraVideo.play();
        if (p && typeof p.catch === "function") void p.catch(() => {});
      })
      .catch(() => {
        showCameraFallbackMessage();
      });
  }

  initCameraOnce();

  function onLeaveTaskPage() {
    stopCamera();
  }
  window.addEventListener("pagehide", onLeaveTaskPage);
  window.addEventListener("beforeunload", onLeaveTaskPage);

  const initialDuration = task.durationSeconds;
  let remaining = initialDuration;
  if (timerDisplay) timerDisplay.textContent = formatMMSS(remaining);

  let tickId = null;
  let userStartedTimerThisVisit = false;

  function setToggleRunning(running) {
    if (!toggleBtn) return;
    toggleBtn.textContent = running ? "⏸" : "▶️";
    toggleBtn.setAttribute("aria-label", running ? "Pause" : "Play");
  }

  function hideOverlay() {
    if (overlay) {
      overlay.style.display = "none";
      overlay.setAttribute("aria-hidden", "true");
    }
  }

  function showOverlay() {
    if (overlay) {
      overlay.style.display = "flex";
      overlay.setAttribute("aria-hidden", "false");
    }
  }

  function runCompletionDialogAnimation() {
    if (!completionDialog) return;
    completionDialog.classList.remove("completion-dialog--animate");
    void completionDialog.offsetWidth;
    completionDialog.classList.add("completion-dialog--animate");
  }

  function finishTimer() {
    if (tickId !== null) {
      clearInterval(tickId);
      tickId = null;
    }
    setToggleRunning(false);
    if (toggleBtn) toggleBtn.disabled = true;
    if (timerDisplay) timerDisplay.textContent = "00:00";
    if (cameraVideo) {
      try {
        cameraVideo.pause();
      } catch {
        /* ignore */
      }
    }
    stopCameraStreamTracksKeepVisual();
    if (overlayEmoji) overlayEmoji.textContent = pickRandomCelebrationEmoji();
    if (completionTitle) completionTitle.textContent = "Boom! That was super! 💥";
    if (userStartedTimerThisVisit) {
      playSoftCompletionChime();
    }
    showOverlay();
    runCompletionDialogAnimation();
  }

  function startInterval() {
    if (tickId !== null) return;
    tickId = window.setInterval(() => {
      remaining -= 1;
      if (timerDisplay) timerDisplay.textContent = formatMMSS(remaining);
      if (remaining <= 0) {
        finishTimer();
      }
    }, 1000);
  }

  if (backLink) {
    backLink.addEventListener("click", (e) => {
      e.preventDefault();
      if (confirm("Stop this task? You can finish it later 😊")) {
        if (tickId !== null) {
          clearInterval(tickId);
          tickId = null;
        }
        setToggleRunning(false);
        stopCamera();
        window.location.href = "index.html";
      }
    });
  }

  if (toggleBtn) {
    toggleBtn.style.cursor = "pointer";
    setToggleRunning(false);

    toggleBtn.addEventListener("click", () => {
      if (tickId !== null) {
        clearInterval(tickId);
        tickId = null;
        setToggleRunning(false);
        return;
      }

      if (remaining <= 0) {
        finishTimer();
        return;
      }

      userStartedTimerThisVisit = true;
      resumeCompletionAudioIfNeeded();
      setToggleRunning(true);
      startInterval();
    });
  }

  if (btnRetry) {
    btnRetry.style.cursor = "pointer";
    btnRetry.addEventListener("click", () => {
      if (tickId !== null) {
        clearInterval(tickId);
        tickId = null;
      }
      userStartedTimerThisVisit = false;
      remaining = initialDuration;
      if (timerDisplay) timerDisplay.textContent = formatMMSS(remaining);
      hideOverlay();
      setToggleRunning(false);
      if (toggleBtn) {
        toggleBtn.disabled = false;
        toggleBtn.textContent = "▶️";
        toggleBtn.setAttribute("aria-label", "Play");
      }
    });
  }

  if (btnDid) {
    btnDid.style.cursor = "pointer";
    btnDid.addEventListener("click", () => {
      let state = load();
      state = ensureCalendarDay(state);
      state = normalizeActiveSession(state);
      const session = state.activeSession;
      if (session === "morning" || session === "evening") {
        const ids = state.sessionsToday[session].completedIds;
        if (!ids.includes(task.id)) ids.push(task.id);
        updateStreakIfDayJustCompleted(state);
        updateHistoryForToday(state);
        save(state);
      }
      stopCamera();
      window.location.href = "index.html";
    });
  }
}

function buildHistoryDotRow(filledCount, total) {
  const row = document.createElement("div");
  row.className = "history-dots-row";
  row.setAttribute("role", "presentation");
  const n = Math.min(Math.max(0, filledCount), total);
  for (let d = 0; d < total; d++) {
    const dot = document.createElement("span");
    dot.className =
      d < n ? "history-dot history-dot--filled" : "history-dot history-dot--faded";
    row.append(dot);
  }
  return row;
}

function initHistoryPage() {
  const list = document.getElementById("history-list");
  if (!list) return;

  const state = load();
  const history = state.history && typeof state.history === "object" ? state.history : {};
  const todayIso = localCalendarDay();
  const yesterdayIso = yesterdayCalendarDay();
  const tl = TASKS.length;

  list.replaceChildren();
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < 7; i++) {
    const iso = calendarDayFromOffset(i);
    const entry = history[iso] || {
      morningCount: 0,
      eveningCount: 0,
      completed: false,
    };

    let dateLabel;
    if (iso === todayIso) dateLabel = "Today";
    else if (iso === yesterdayIso) dateLabel = "Yesterday";
    else {
      const [yy, mm, dd] = iso.split("-").map(Number);
      const dt = new Date(yy, mm - 1, dd);
      dateLabel = dt.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }

    let statusIcon;
    if (entry.completed) statusIcon = "\u2714";
    else if (entry.morningCount === 0 && entry.eveningCount === 0) statusIcon = "\u2716";
    else statusIcon = "\u25D0";

    const li = document.createElement("li");
    li.className = "history-row";

    const dateEl = document.createElement("div");
    dateEl.className = "history-row-date";
    dateEl.textContent = dateLabel;

    const dotsWrap = document.createElement("div");
    dotsWrap.className = "history-row-dots";
    dotsWrap.setAttribute(
      "aria-label",
      `Morning ${entry.morningCount} of ${tl}, evening ${entry.eveningCount} of ${tl}`
    );
    dotsWrap.append(
      buildHistoryDotRow(entry.morningCount, tl),
      buildHistoryDotRow(entry.eveningCount, tl)
    );

    const iconSpan = document.createElement("span");
    iconSpan.className = "history-row-icon";
    iconSpan.setAttribute("aria-hidden", "true");
    iconSpan.textContent = statusIcon;

    li.append(dateEl, dotsWrap, iconSpan);
    fragment.append(li);
  }

  list.append(fragment);
}

if (document.querySelector(".task-list")) {
  initHomePage();
}

if (document.body.classList.contains("page--task")) {
  initTaskPage();
}

if (document.body.classList.contains("page--history")) {
  initHistoryPage();
}
