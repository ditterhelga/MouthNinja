import { EXERCISES } from "./exercises.js?v=35";
import {
  createExerciseFacePipeline,
  CAMERA_MEDIA_CONSTRAINTS,
  syncCanvasResolutionToVideo,
  createExerciseBackgroundMusic,
} from "./camera.js?v=5";
import * as sess from "./session.js";
import { mountSpinWheel, SIMPLE_SEGMENTS, FULL_SEGMENTS } from "./spin-wheel.js?v=40";

function formatHistoryDay(dayKey) {
  const parts = dayKey.split("-");
  if (parts.length !== 3) return dayKey;
  const y = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  const dt = new Date(y, mo - 1, d);
  const wd = dt.toLocaleDateString("en-GB", { weekday: "short" });
  const month = dt.toLocaleDateString("en-GB", { month: "short" });
  return `${wd} ${d} ${month}`;
}

/** @typedef {"morning" | "evening"} Period */

const qs = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

const EXERCISE_IDS = EXERCISES.map((e) => e.id);

const PROGRESS_COPY = [
  "The ninja is waiting...",
  "Great start! Keep going!",
  "Warming up! Don't stop!",
  "Halfway there, ninja!",
  "More than half done!",
  "Almost there, just 2 more!",
  "One left! Finish strong!",
  "BOOM! All done!",
];

const MISSED_MORNING_MOTIVATION = "The ninja cat is not happy";
const SIDEBAR_CAT_BAD = "assets/images/cat-bad.png";

/** @typedef {null | "missedMorning" | "morningComplete" | "eveningWait"} SessionListGateMode */

const OVERLAY_IMG = /** @type {Record<Exclude<SessionListGateMode, null>, string>} */ ({
  missedMorning: "assets/images/cat-sad.png",
  morningComplete: "assets/images/cat-finish.png",
  eveningWait: "assets/images/cat-waiting.png",
});

const OVERLAY_TEXT = /** @type {Record<Exclude<SessionListGateMode, null>, string>} */ ({
  missedMorning:
    "You missed morning training today. No spin wheel for you today. Try again tomorrow, ninja!",
  morningComplete: "Morning training complete! You're a true ninja today!",
  eveningWait: "Evening training starts at 4 PM. Come back later, ninja!",
});

const MN_DEBUG_SESSION_TOGGLE = true;

const EXERCISE_DONE_GIFS = [
  "assets/gifs/Cat%20Driving%20GIF%20by%20hamlet.gif",
  "assets/gifs/Cat%20Racing%20GIF.gif",
  "assets/gifs/Dance%20Party%20Cat%20GIF.gif",
  "assets/gifs/Girl%20Car%20GIF.gif",
  "assets/gifs/I%20Love%20You%20GIF.gif",
  "assets/gifs/Kermit%20The%20Frog%20Reaction%20GIF%20by%20Muppet%20Wiki.gif",
  "assets/gifs/Kissing%20Shaquille%20O%20Neal%20GIF%20by%20Papa%20Johns.gif",
  "assets/gifs/Locked%20In%20Popcorn%20GIF.gif",
  "assets/gifs/Mr%20Bean%20Dancing%20GIF.gif",
  "assets/gifs/You%20Can%20Do%20It%20GIF%20by%20The%20Woobles.gif",
];

const EXERCISE_DONE_MESSAGES = [
  "Nice work, ninja!",
  "Crushed it!",
  "One down!",
  "The ninja cat approves!",
  "Killing it!",
];

function formatTime(totalSec) {
  const s = Math.max(0, Math.ceil(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** Display minutes aligned with UX copy (rounded up). */
function formatTaskMinutes(totalSec) {
  const mins = Math.max(1, Math.ceil(totalSec / 60));
  return `${mins} min`;
}

function defaultPeriodForNow() {
  const h = new Date().getHours();
  return h >= 7 && h < 16 ? "morning" : "evening";
}

function msUntilMorningDeadline(now = new Date()) {
  const t = new Date(now);
  t.setHours(16, 0, 0, 0);
  if (now.getTime() < t.getTime()) return t.getTime() - now.getTime();
  t.setDate(t.getDate() + 1);
  return t.getTime() - now.getTime();
}

function msUntilEveningDeadline(now = new Date()) {
  const t = new Date(now);
  t.setHours(7, 0, 0, 0);
  if (now.getTime() < t.getTime()) return t.getTime() - now.getTime();
  t.setDate(t.getDate() + 1);
  return t.getTime() - now.getTime();
}

/**
 * True when local clock is at or after 4 PM today — uses milliseconds (not truncated to minute).
 */
function isMorningWindowClosed(now = new Date()) {
  const boundary = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 16, 0, 0, 0);
  return now.getTime() >= boundary.getTime();
}

function isMissedMorningState(now = new Date()) {
  const dk = sess.todayKey(now);
  return isMorningWindowClosed(now) && !sess.isPeriodFullyComplete("morning", EXERCISE_IDS, dk);
}

/** Dynamic urgency subtitle for active period. */
function computeUrgencyCopy(period) {
  const now = new Date();
  const dk = sess.todayKey(now);
  const word = period === "morning" ? "morning" : "evening";
  const cap = word.charAt(0).toUpperCase() + word.slice(1);

  if (
    period === "morning" &&
    isMorningWindowClosed(now) &&
    !sess.isPeriodFullyComplete("morning", EXERCISE_IDS, dk)
  ) {
    return "Morning session time has ended for today.";
  }

  if (period === "evening" && !isMorningWindowClosed(now)) {
    return "Evening training starts at 4 PM — hang tight until then, ninja!";
  }

  const msLeft = period === "morning" ? msUntilMorningDeadline(now) : msUntilEveningDeadline(now);
  const minLeft = msLeft / 60000;

  if (period === "morning") {
    if (minLeft > 240) {
      return `${cap} session — plenty of time, but don't forget!`;
    }
    if (minLeft > 120) {
      const h = Math.ceil(minLeft / 60);
      return `Only ${h} hour${h === 1 ? "" : "s"} left to finish ${word}!`;
    }
    if (minLeft > 60) {
      const h = Math.ceil(minLeft / 60);
      return `Hurry up! ${h} hour${h === 1 ? "" : "s"} left for ${word} training!`;
    }
    if (minLeft > 15) {
      const m = Math.max(16, Math.ceil(minLeft));
      return `Just ${m} minutes! Go go go!`;
    }
    return `LAST CHANCE! Do it NOW!`;
  }

  if (minLeft > 240) {
    return `${cap} session — plenty of time, but don't forget!`;
  }
  if (minLeft > 120) {
    const h = Math.ceil(minLeft / 60);
    return `Only ${h} hour${h === 1 ? "" : "s"} left to finish ${word}!`;
  }
  if (minLeft > 60) {
    const h = Math.ceil(minLeft / 60);
    return `Hurry up! ${h} hour${h === 1 ? "" : "s"} left for ${word} training!`;
  }
  if (minLeft > 15) {
    const m = Math.max(16, Math.ceil(minLeft));
    return `Just ${m} minutes! Go go go!`;
  }
  return `LAST CHANCE! Do it NOW!`;
}

async function requestFrontCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia(CAMERA_MEDIA_CONSTRAINTS);
  video.srcObject = stream;
  await video.play();
  return stream;
}

function releaseCamera(video) {
  const stream = video.srcObject;
  if (stream && "getTracks" in stream) {
    stream.getTracks().forEach((t) => t.stop());
  }
  video.srcObject = null;
}

/** @type {(() => void) | null} */
let detachCanvasResolution = null;

function attachCanvasResolutionToVideoBounded(video, canvas) {
  detachCanvasResolution?.();
  const sync = () => {
    syncCanvasResolutionToVideo(video, canvas);
  };
  sync();
  video.addEventListener("loadeddata", sync);
  video.addEventListener("resize", sync);
  detachCanvasResolution = () => {
    video.removeEventListener("loadeddata", sync);
    video.removeEventListener("resize", sync);
    detachCanvasResolution = null;
  };
}

function setActiveView(listEl, exerciseEl, mode) {
  const list = mode === "list";
  listEl.classList.toggle("view--active", list);
  listEl.setAttribute("aria-hidden", list ? "false" : "true");
  exerciseEl.classList.toggle("view--active", !list);
  exerciseEl.setAttribute("aria-hidden", list ? "true" : "false");
}

function showOverlay(el) {
  el.hidden = false;
  el.removeAttribute("hidden");
  el.setAttribute("aria-hidden", "false");
}

function hideOverlay(el) {
  el.hidden = true;
  el.setAttribute("hidden", "");
  el.setAttribute("aria-hidden", "true");
}

/**
 * @param {HTMLElement} container
 * @param {(index: number) => void} onSelect
 * @param {Period} period
 * @param {(exerciseId: string, checked: boolean) => void} [onDebugSessionToggle]
 * @param {boolean} [lockList] — no interaction (missed morning on Morning tab)
 */
function buildExerciseList(container, onSelect, period, onDebugSessionToggle, lockList = false) {
  container.replaceChildren();
  EXERCISES.forEach((exercise, index) => {
    const dk = sess.todayKey();
    const completed = sess.isExerciseDoneInPeriod(period, exercise.id, dk);
    const row = document.createElement("div");
    row.className =
      "task-card" +
      (completed ? " task-card--completed" : "") +
      (lockList ? " task-card--locked" : "");
    row.setAttribute("role", "listitem");
    row.tabIndex = lockList ? -1 : 0;
    if (lockList) row.setAttribute("aria-disabled", "true");
    row.setAttribute(
      "aria-label",
      `${exercise.name}, ${formatTaskMinutes(exercise.duration)}`
    );

    const lead = document.createElement("div");
    lead.className = "task-card__lead";

    const thumb = document.createElement("img");
    thumb.className = "task-card__thumb";
    thumb.src = exercise.icon;
    thumb.alt = "";
    thumb.decoding = "async";

    const nameCol = document.createElement("div");
    nameCol.className = "task-card__name-col";

    const name = document.createElement("span");
    name.className = "task-card__name exercise-name";
    name.textContent = exercise.name;
    nameCol.append(name);

    if (onDebugSessionToggle && !lockList) {
      const dbg = document.createElement("label");
      dbg.className = "task-card__debug";
      dbg.title = "DEBUG: mark done for this session (remove before release)";
      const inp = document.createElement("input");
      inp.type = "checkbox";
      inp.className = "task-card__debug-input";
      inp.checked = completed;
      inp.setAttribute("aria-label", `DEBUG session done: ${exercise.name}`);
      dbg.append(inp);

      const blockBubbling = (e) => {
        e.stopPropagation();
      };
      dbg.addEventListener("click", blockBubbling);
      dbg.addEventListener("pointerdown", blockBubbling);

      inp.addEventListener("change", (e) => {
        e.stopPropagation();
        onDebugSessionToggle(exercise.id, inp.checked);
      });

      nameCol.append(dbg);
    }

    lead.append(thumb, nameCol);

    const trail = document.createElement("div");
    trail.className = "task-card__trail";

    const duration = document.createElement("span");
    duration.className = "task-card__duration exercise-duration";
    duration.textContent = formatTaskMinutes(exercise.duration);

    if (completed) {
      const check = document.createElement("span");
      check.className = "task-card__check";
      check.setAttribute("aria-hidden", "true");
      const img = document.createElement("img");
      img.src = "assets/icons/check.svg";
      img.alt = "";
      img.className = "task-card__check-img";
      check.append(img);
      trail.append(duration, check);
    } else {
      const arrow = document.createElement("span");
      arrow.className = "task-card__arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.innerHTML =
        '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 6L15 12L9 18" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      trail.append(duration, arrow);
    }

    row.append(lead, trail);
    if (!lockList) {
      row.addEventListener("click", (e) => {
        if ((/** @type {HTMLElement} */ (e.target)).closest(".task-card__debug")) return;
        onSelect(index);
      });
      row.addEventListener("keydown", (e) => {
        if ((/** @type {HTMLElement} */ (e.target)).closest(".task-card__debug")) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(index);
        }
      });
    }
    container.appendChild(row);
  });
}

async function main() {
  const viewList = qs("view-list");
  const viewExercise = qs("view-exercise");
  const listContainer = qs("exercise-list");
  const sessionTitleEl = qs("session-title");
  const sessionTaglineEl = qs("session-tagline");
  const tabMorningBtn = qs("btn-tab-morning");
  const tabEveningBtn = qs("btn-tab-evening");
  const tabHistoryBtn = qs("btn-tab-history");
  const panelExercises = qs("panel-exercises");
  const panelHistory = qs("panel-history");
  const historyListEl = qs("history-list");
  const historyEmptyEl = qs("history-empty");
  const sessionStateOverlayEl = qs("session-state-overlay");
  const sessionStateOverlayCatEl = qs("session-state-overlay-cat");
  const sessionStateOverlayMsgEl = qs("session-state-overlay-msg");
  /** @type {HTMLImageElement} */
  const sessionOverlayCatImg = /** @type {any} */ (sessionStateOverlayCatEl);

  const nameEl = qs("exercise-name");
  const stepEl = qs("exercise-step");
  const timerEl = qs("timer-display");
  const statusEl = qs("status-msg");
  const progressFill = qs("progress-fill");
  const btnBack = qs("btn-back");
  const video = /** @type {HTMLVideoElement} */ (qs("camera-video"));
  const canvas = /** @type {HTMLCanvasElement} */ (qs("crop-canvas"));
  const errEl = qs("camera-error");

  const overlayCongrats = qs("overlay-session-congrats");
  const btnCongratsDismiss = qs("btn-congrats-dismiss");
  const overlaySpin = qs("overlay-spin-root");
  const spinMount = qs("spin-wheel-mount");

  const overlayBackConfirm = qs("overlay-back-confirm");
  const btnBackConfirmKeep = qs("btn-back-confirm-keep");
  const btnBackConfirmStop = qs("btn-back-confirm-stop");
  const sidebarProgressStackEl = qs("sidebar-progress-stack");

  const exerciseDoneOverlay = qs("overlay-exercise-done");
  const exerciseDoneGif = /** @type {HTMLImageElement} */ (qs("exercise-done-gif"));
  const exerciseDoneMsg = qs("exercise-done-msg");

  const sidebarCountEl = qs("sidebar-count-big");
  const sidebarDotsEl = qs("sidebar-progress-dots");
  const sidebarMotivationEl = qs("sidebar-progress-motivation");
  /** @type {HTMLImageElement} */
  const sidebarCatEl = /** @type {any} */ (qs("sidebar-progress-cat"));

  const paths = {
    tl: /** @type {SVGPathElement} */ (qs("bracket-tl")),
    tr: /** @type {SVGPathElement} */ (qs("bracket-tr")),
    bl: /** @type {SVGPathElement} */ (qs("bracket-bl")),
    br: /** @type {SVGPathElement} */ (qs("bracket-br")),
  };
  const bracketGroup = /** @type {SVGGElement} */ (qs("bracket-group"));

  /** @type {Period} */
  let activePeriod = defaultPeriodForNow();

  /** When true, main panel shows History instead of exercise list */
  let showHistory = false;

  /** @type {{ exerciseId: string | null, index: number, completedSuccessfully: boolean }} */
  const workoutTurn = {
    exerciseId: null,
    index: -1,
    completedSuccessfully: false,
  };

  /**
   * @param {Date} now
   * @returns {{ mode: SessionListGateMode, lockList: boolean }}
   */
  function deriveExerciseListGate(now) {
    if (showHistory) return { mode: null, lockList: false };

    const dk = sess.todayKey(now);
    const morningFull = sess.isPeriodFullyComplete("morning", EXERCISE_IDS, dk);
    const eveningOpenLocal = isMorningWindowClosed(now);

    if (activePeriod === "evening" && !eveningOpenLocal) {
      return { mode: "eveningWait", lockList: true };
    }

    if (activePeriod === "morning") {
      if (eveningOpenLocal && !morningFull) {
        return { mode: "missedMorning", lockList: true };
      }
      if (morningFull) {
        return { mode: "morningComplete", lockList: true };
      }
    }

    return { mode: null, lockList: false };
  }

  /**
   * @param {Date} now
   * @param {{ mode: SessionListGateMode, lockList: boolean }} gate
   */
  function applySessionListGate(now, gate) {
    panelExercises.classList.toggle(
      "main-stack-panel--session-gated",
      gate.lockList && !showHistory
    );

    tabMorningBtn.classList.toggle("nav-item--morning-missed", isMissedMorningState(now));

    const showOverlayDom = Boolean(gate.mode) && !showHistory;
    if (!showOverlayDom) {
      hideOverlay(sessionStateOverlayEl);
      return;
    }

    showOverlay(sessionStateOverlayEl);

    const m = /** @type {Exclude<SessionListGateMode, null>} */ (gate.mode);
    sessionOverlayCatImg.src = OVERLAY_IMG[m];
    sessionOverlayCatImg.alt = "";
    sessionStateOverlayMsgEl.textContent = OVERLAY_TEXT[m];
  }

  timerEl.addEventListener("animationend", (e) => {
    if (e.animationName !== "timer-shake") return;
    timerEl.classList.remove("timer--shake");
  });

  /** @type {{ stop: () => void, dispose: () => void, resetMovementBaseline: () => void, start: () => Promise<void> } | null} */
  let pipeline = null;

  /** @type {ReturnType<typeof createExerciseBackgroundMusic> | null} */
  let exerciseBgm = null;

  /** @type {null | (() => void)} */
  let pendingBackConfirmAction = null;

  function openBackConfirm(onConfirmStop) {
    if (!overlayBackConfirm.hidden) return;
    pendingBackConfirmAction = onConfirmStop;
    showOverlay(overlayBackConfirm);
  }

  btnBackConfirmKeep.addEventListener("click", (e) => {
    e.stopPropagation();
    pendingBackConfirmAction = null;
    hideOverlay(overlayBackConfirm);
  });

  btnBackConfirmStop.addEventListener("click", (e) => {
    e.stopPropagation();
    const fn = pendingBackConfirmAction;
    pendingBackConfirmAction = null;
    hideOverlay(overlayBackConfirm);
    if (typeof fn === "function") fn();
  });

  function disposeExerciseBgm() {
    if (!exerciseBgm) return;
    exerciseBgm.pauseAndReset();
    exerciseBgm = null;
  }

  function cleanupPipeline() {
    if (!pipeline) return;
    pipeline.stop();
    pipeline.dispose();
    pipeline = null;
  }

  function refreshSessionHeaderUi() {
    if (showHistory) {
      sessionTitleEl.textContent = "History";
      sessionTitleEl.classList.add("history-title");
      sessionTaglineEl.textContent = "";
      sessionTaglineEl.hidden = true;
    } else {
      sessionTitleEl.classList.remove("history-title");
      sessionTaglineEl.hidden = false;
      sessionTitleEl.textContent = activePeriod === "morning" ? "Morning Session" : "Evening Session";
      sessionTaglineEl.textContent = computeUrgencyCopy(activePeriod);
    }

    tabMorningBtn.classList.toggle("active", !showHistory && activePeriod === "morning");
    tabMorningBtn.setAttribute("aria-current", !showHistory && activePeriod === "morning" ? "true" : "false");
    tabEveningBtn.classList.toggle("active", !showHistory && activePeriod === "evening");
    tabEveningBtn.setAttribute("aria-current", !showHistory && activePeriod === "evening" ? "true" : "false");
    tabHistoryBtn.classList.toggle("active", showHistory);
    tabHistoryBtn.setAttribute("aria-current", showHistory ? "true" : "false");
  }

  function refreshSidebarUi() {
    const now = new Date();
    const dk = sess.todayKey(now);

    /** Evening tab before 4 PM — progress UI is still evening, motivation follows morning completion. */
    const eveningWaitingNav =
      !showHistory && activePeriod === "evening" && !isMorningWindowClosed(now);
    sidebarProgressStackEl.classList.toggle("sidebar-progress-stack--evening-wait", eveningWaitingNav);
    const periodForMotivation = eveningWaitingNav ? "morning" : activePeriod;

    let motivationDoneCount = 0;
    let dotDoneCount = 0;
    sidebarDotsEl.replaceChildren();
    for (let i = 0; i < EXERCISES.length; i += 1) {
      const ex = EXERCISES[i];
      const dot = document.createElement("span");
      dot.className = "sidebar-progress-dot";
      dot.setAttribute("aria-hidden", "true");
      if (sess.isExerciseDoneInPeriod(activePeriod, ex.id, dk)) {
        dot.classList.add("sidebar-progress-dot--filled");
        dotDoneCount += 1;
      }
      sidebarDotsEl.appendChild(dot);
    }
    for (let i = 0; i < EXERCISES.length; i += 1) {
      const ex = EXERCISES[i];
      if (sess.isExerciseDoneInPeriod(periodForMotivation, ex.id, dk)) motivationDoneCount += 1;
    }

    sidebarCountEl.textContent = `${dotDoneCount}`;

    const missedMorningOnMorningTab =
      !showHistory && activePeriod === "morning" && isMissedMorningState(now);

    /** Sidebar cat follows the active tab only (evening tab never uses cat-bad). */
    let sidebarCatSrc = "assets/images/cat.png";
    if (!showHistory && activePeriod === "morning") {
      if (missedMorningOnMorningTab) {
        sidebarCatSrc = SIDEBAR_CAT_BAD;
      } else if (sess.isPeriodFullyComplete("morning", EXERCISE_IDS, dk)) {
        sidebarCatSrc = "assets/images/cat-done.png";
      }
    } else if (!showHistory && activePeriod === "evening") {
      if (sess.isPeriodFullyComplete("evening", EXERCISE_IDS, dk)) {
        sidebarCatSrc = "assets/images/cat-done.png";
      } else if (eveningWaitingNav) {
        sidebarCatSrc = "assets/icons/cat-bored.png";
      }
    }
    sidebarCatEl.src = sidebarCatSrc;

    if (missedMorningOnMorningTab) {
      sidebarMotivationEl.textContent = MISSED_MORNING_MOTIVATION;
    } else {
      sidebarMotivationEl.textContent = PROGRESS_COPY[motivationDoneCount] ?? PROGRESS_COPY[0];
    }
    sidebarCatEl.closest(".sidebar-progress-panel")?.setAttribute(
      "aria-label",
      `${activePeriod.charAt(0).toUpperCase() + activePeriod.slice(1)} progress`
    );
  }

  /**
   * Two-tier wheel:
   *  - Morning complete → simple wheel (5 min / 10 min / nothing)
   *  - Evening complete + morning also done today → full wheel (all prizes)
   *  - Evening complete + morning NOT done → simple wheel
   * Each wheel fires once per period per day (tracked in localStorage).
   * @param {Period} finishedPeriod Which period reached 7/7 on this return.
   */
  function enqueueCompletionFlowAfterReturn(finishedPeriod) {
    const dk = sess.todayKey();

    if (sess.spinShownForPeriod(finishedPeriod, dk)) return;

    const morningFull = sess.isPeriodFullyComplete("morning", EXERCISE_IDS, dk);

    let segments = SIMPLE_SEGMENTS;
    if (finishedPeriod === "evening" && morningFull) {
      segments = FULL_SEGMENTS;
    }

    sess.setSpinShownForPeriod(finishedPeriod, dk);
    showOverlay(overlaySpin);
    spinMount.replaceChildren();
    mountSpinWheel(spinMount, {
      segments,
      onClaimPrize: (fullLabel) => {
        try {
          sess.saveDayPrize(sess.todayKey(), fullLabel, finishedPeriod);
        } catch (err) {
          console.error("[MouthNinja] saveDayPrize:", err);
        } finally {
          hideOverlay(overlaySpin);
        }
      },
      onDismiss: () => {
        hideOverlay(overlaySpin);
      },
      onRequestDismiss: () => {
        openBackConfirm(() => hideOverlay(overlaySpin));
      },
    });
  }

  function handleDebugSessionToggle(exerciseId, checked) {
    const dk = sess.todayKey();
    const beforeFull = sess.isPeriodFullyComplete(activePeriod, EXERCISE_IDS, dk);
    if (checked) sess.addCompletedExercise(activePeriod, exerciseId, dk);
    else sess.removeCompletedExercise(activePeriod, exerciseId, dk);
    const afterFull = sess.isPeriodFullyComplete(activePeriod, EXERCISE_IDS, dk);
    if (beforeFull && !afterFull) {
      sess.clearSpinShownForPeriod(activePeriod, dk);
    }
    refreshFullListScreen();
    if (!beforeFull && afterFull && checked) {
      enqueueCompletionFlowAfterReturn(activePeriod);
    }
  }

  function buildHistoryList() {
    historyListEl.replaceChildren();
    const keys = sess.listDayKeysDescending();
    if (keys.length === 0) {
      historyEmptyEl.hidden = false;
      historyListEl.hidden = true;
      return;
    }
    historyEmptyEl.hidden = true;
    historyListEl.hidden = false;

    for (const dayKey of keys) {
      const record = sess.getDayRecord(dayKey);
      if (!record) continue;

      const morningDone = sess.isPeriodFullyComplete("morning", EXERCISE_IDS, dayKey);
      const eveningDone = sess.isPeriodFullyComplete("evening", EXERCISE_IDS, dayKey);

      const card = document.createElement("div");
      card.className = "history-card";
      card.setAttribute("role", "listitem");

      const dateSpan = document.createElement("span");
      dateSpan.className = "history-card__date history-entry-date";
      dateSpan.textContent = formatHistoryDay(dayKey);

      const sessCol = document.createElement("div");
      sessCol.className = "history-card__sessions history-entry-meta";

      /**
       * @param {string} label
       * @param {boolean} ok
       */
      function periodBadge(label, ok) {
        const span = document.createElement("span");
        span.className = "history-card__period";
        const sym = document.createElement("span");
        sym.className = ok ? "history-card__tick" : "history-card__cross";
        sym.textContent = ok ? "\u2713" : "\u2717";
        span.append(`${label} `, sym);
        return span;
      }

      sessCol.append(periodBadge("Morning", morningDone), periodBadge("Evening", eveningDone));

      const prizes = [record.morningPrize, record.eveningPrize, record.prizeLabel]
        .filter(Boolean);
      const prizeEl = document.createElement("div");
      prizeEl.className = "history-card__prize history-entry-time";
      prizeEl.textContent = prizes.length ? prizes.join(", ") : "";

      card.append(dateSpan, sessCol, prizeEl);
      historyListEl.appendChild(card);
    }
  }

  function refreshListUiOnly() {
    const now = new Date();
    const gate = deriveExerciseListGate(now);
    applySessionListGate(now, gate);
    buildExerciseList(
      listContainer,
      (index) => {
        void startExerciseFromList(index).catch((e) => {
          console.error("[MouthNinja] startExerciseFromList:", e);
        });
      },
      activePeriod,
      MN_DEBUG_SESSION_TOGGLE && !gate.lockList ? handleDebugSessionToggle : undefined,
      gate.lockList
    );
  }

  function refreshFullListScreen() {
    refreshSessionHeaderUi();
    refreshSidebarUi();
    panelExercises.hidden = showHistory;
    panelHistory.hidden = !showHistory;
    if (showHistory) {
      applySessionListGate(new Date(), { mode: null, lockList: false });
      listContainer.replaceChildren();
      buildHistoryList();
    } else {
      refreshListUiOnly();
    }
  }

  function selectPeriod(period) {
    showHistory = false;
    activePeriod = period;
    refreshFullListScreen();
  }

  tabMorningBtn.addEventListener("click", () => {
    selectPeriod("morning");
  });

  tabEveningBtn.addEventListener("click", () => {
    selectPeriod("evening");
  });

  tabHistoryBtn.addEventListener("click", () => {
    showHistory = true;
    refreshFullListScreen();
  });

  const sidebarBrand = document.getElementById("sidebar-brand");
  if (sidebarBrand) {
    sidebarBrand.addEventListener("click", () => {
      selectPeriod(defaultPeriodForNow());
    });
  }

  const btnTestSpinWheel = document.getElementById("btn-test-spin-wheel");
  if (btnTestSpinWheel) {
    btnTestSpinWheel.hidden = false;
    btnTestSpinWheel.addEventListener("click", () => {
      spinMount.replaceChildren();
      mountSpinWheel(spinMount, {
        onClaimPrize: (fullLabel) => {
          try {
            sess.saveDayPrize(sess.todayKey(), fullLabel);
          } catch (err) {
            console.error("[MouthNinja] saveDayPrize:", err);
          } finally {
            hideOverlay(overlaySpin);
          }
        },
        onDismiss: () => {
          hideOverlay(overlaySpin);
        },
        onRequestDismiss: () => {
          openBackConfirm(() => hideOverlay(overlaySpin));
        },
      });
      showOverlay(overlaySpin);
    });
  }

  btnCongratsDismiss.addEventListener("click", () => hideOverlay(overlayCongrats));

  function processReturnFromExercise() {
    const dk = sess.todayKey();
    let transitionedFullForThisPeriod /** @type {Period | null} */ = null;

    if (workoutTurn.completedSuccessfully && workoutTurn.exerciseId) {
      const periodFullBefore = sess.isPeriodFullyComplete(activePeriod, EXERCISE_IDS, dk);
      sess.addCompletedExercise(activePeriod, workoutTurn.exerciseId, dk);
      const periodFullAfter = sess.isPeriodFullyComplete(activePeriod, EXERCISE_IDS, dk);
      if (!periodFullBefore && periodFullAfter) transitionedFullForThisPeriod = activePeriod;
    }

    workoutTurn.exerciseId = null;
    workoutTurn.index = -1;
    workoutTurn.completedSuccessfully = false;

    refreshFullListScreen();

    if (transitionedFullForThisPeriod) {
      enqueueCompletionFlowAfterReturn(transitionedFullForThisPeriod);
    }
  }

  function showExerciseDoneOverlay() {
    const gif = EXERCISE_DONE_GIFS[Math.floor(Math.random() * EXERCISE_DONE_GIFS.length)];
    const msg = EXERCISE_DONE_MESSAGES[Math.floor(Math.random() * EXERCISE_DONE_MESSAGES.length)];
    exerciseDoneGif.src = gif;
    exerciseDoneMsg.textContent = msg;
    exerciseDoneOverlay.hidden = false;
    exerciseDoneOverlay.setAttribute("aria-hidden", "false");
  }

  function dismissExerciseDoneOverlay() {
    exerciseDoneOverlay.hidden = true;
    exerciseDoneOverlay.setAttribute("aria-hidden", "true");
    exerciseDoneGif.src = "";
  }

  exerciseDoneOverlay.addEventListener("click", () => {
    dismissExerciseDoneOverlay();
    leaveExerciseView();
  });

  function leaveExerciseView() {
    dismissExerciseDoneOverlay();
    disposeExerciseBgm();
    cleanupPipeline();
    detachCanvasResolution?.();
    releaseCamera(video);
    errEl.hidden = true;
    timerEl.classList.remove("timer--shake");
    statusEl.removeAttribute("data-state");
    processReturnFromExercise();
    setActiveView(viewList, viewExercise, "list");
  }

  async function startExerciseFromList(exerciseIndex) {
    if (deriveExerciseListGate(new Date()).lockList) return;

    const exercise = EXERCISES[exerciseIndex];
    if (!exercise) return;

    cleanupPipeline();
    disposeExerciseBgm();
    detachCanvasResolution?.();
    releaseCamera(video);

    workoutTurn.index = exerciseIndex;
    workoutTurn.exerciseId = exercise.id;
    workoutTurn.completedSuccessfully = false;

    setActiveView(viewList, viewExercise, "exercise");

    nameEl.textContent = exercise.name;
    stepEl.textContent = `${exerciseIndex + 1}/${EXERCISES.length}`;

    const durationSec = exercise.duration;
    let elapsedSec = 0;
    let completed = false;

    function syncTimerUi() {
      timerEl.textContent = formatTime(durationSec - elapsedSec);
    }

    function syncProgressUi(hasFace, moving) {
      const ratio = durationSec > 0 ? Math.min(1, elapsedSec / durationSec) : 0;
      progressFill.style.width = `${ratio * 100}%`;

      progressFill.removeAttribute("data-state");
      if (!hasFace) {
        progressFill.dataset.state = "idle";
      } else if (!moving) {
        progressFill.dataset.state = "still";
      }
    }

    function syncStatus(hasFace, moving) {
      if (completed) {
        statusEl.textContent = "Nice work!";
        statusEl.dataset.state = "done";
        return;
      }
      if (!hasFace) {
        statusEl.textContent = "Move closer!";
        statusEl.dataset.state = "alert";
        return;
      }
      if (moving) {
        statusEl.textContent = "Keep moving!";
        statusEl.removeAttribute("data-state");
        return;
      }
      statusEl.textContent = "Move your mouth!";
      statusEl.dataset.state = "alert";
    }

    syncTimerUi();
    syncProgressUi(false, false);
    syncStatus(false, false);

    exerciseBgm = createExerciseBackgroundMusic();
    exerciseBgm.primeUnlockFromUserGesture();

    let prevHadActiveMovementUi = false;
    let exerciseDoneShown = false;

    try {
      await requestFrontCamera(video);
      attachCanvasResolutionToVideoBounded(video, canvas);
      errEl.hidden = true;
    } catch (e) {
      disposeExerciseBgm();
      errEl.hidden = false;
      errEl.textContent =
        "Camera access is needed for this exercise. Allow the camera in Settings, then reload.";
      console.error(e);
      return;
    }

    try {
      pipeline = await createExerciseFacePipeline({
        video,
        canvas,
        paths,
        bracketGroup,
        onFrame({ hasFace, moving, dtSec }) {
          if (!completed && hasFace && moving) {
            elapsedSec += dtSec;
            if (elapsedSec >= durationSec) {
              elapsedSec = durationSec;
              completed = true;
              workoutTurn.completedSuccessfully = true;
            }
          }

          syncTimerUi();
          exerciseBgm?.syncWithMovement({ hasFace, moving, completed });

          if (completed) {
            progressFill.style.width = "100%";
            progressFill.removeAttribute("data-state");
            statusEl.textContent = "Nice work!";
            statusEl.dataset.state = "done";
            prevHadActiveMovementUi = false;
            if (!exerciseDoneShown) {
              exerciseDoneShown = true;
              showExerciseDoneOverlay();
            }
            return;
          }

          const activeMovementUi = hasFace && moving;
          const lostMovementUi = !hasFace || !moving;
          if (lostMovementUi && prevHadActiveMovementUi) {
            timerEl.classList.remove("timer--shake");
            void timerEl.offsetWidth;
            timerEl.classList.add("timer--shake");
          }
          prevHadActiveMovementUi = activeMovementUi;

          syncProgressUi(hasFace, moving);
          syncStatus(hasFace, moving);
        },
      });
    } catch (e) {
      console.error(e);
      disposeExerciseBgm();
      releaseCamera(video);
      detachCanvasResolution?.();
      errEl.hidden = false;
      errEl.textContent = "Something went wrong loading face tracking. Try a refresh.";
      cleanupPipeline();
      return;
    }

    await pipeline.start();
  }

  btnBack.addEventListener("click", () => {
    openBackConfirm(() => leaveExerciseView());
  });

  refreshFullListScreen();
  window.setInterval(() => {
    if (!viewList.classList.contains("view--active")) return;
    if (showHistory) return;
    sessionTaglineEl.textContent = computeUrgencyCopy(activePeriod);
    refreshSidebarUi();
    refreshListUiOnly();
  }, 60_000);

  setActiveView(viewList, viewExercise, "list");
}

main().catch((e) => {
  console.error("[MouthNinja app] main() rejected:", e);
  const errEl = document.getElementById("camera-error");
  if (errEl && !document.body.dataset.mouthNinjaCameraFatal) {
    errEl.hidden = false;
    errEl.textContent = "Something went wrong loading face tracking. Try a refresh.";
  }
});
