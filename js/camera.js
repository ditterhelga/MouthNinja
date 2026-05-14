/* camera.js — load marker 2026-05-14 — pair with ?v=7 in index.html + app.js import */
const TASKS_VISION_VERSION = "0.10.14";

/** WASM on jsDelivr — same package version as vision_bundle.mjs in index.html */
const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;

const MODEL_URL = new URL(
  "/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  "https://storage.googleapis.com"
).href;

/** For getUserMedia — prefer full HD @ 30fps; decoded frame size drives landmark math and crop source rect. */
export const CAMERA_MEDIA_CONSTRAINTS = {
  audio: false,
  video: {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 },
    facingMode: "user",
  },
};

/**
 * Canvas backing store: match video aspect ratio, width at least `MIN_CROP_CANVAS_W`
 * so the cropped region is drawn at higher resolution when the camera stream is narrow.
 * @param {HTMLVideoElement} video
 * @param {HTMLCanvasElement} canvas
 */
export function syncCanvasResolutionToVideo(video, canvas) {
  const vw = video.naturalWidth || video.videoWidth;
  const vh = video.naturalHeight || video.videoHeight;
  if (!vw || !vh) return;
  const MIN_CROP_CANVAS_W = 1280;
  const w = Math.max(vw, MIN_CROP_CANVAS_W);
  const h = Math.round((w * vh) / vw);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

/**
 * Format any thrown value for on-screen debugging (plain JS only — no extra imports).
 * @param {unknown} err
 * @returns {string}
 */
function formatErrorForScreen(err) {
  if (err instanceof Error) {
    return err.name + ": " + err.message + "\n\n" + (err.stack || "(no stack)");
  }
  if (err && typeof err === "object") {
    try {
      return JSON.stringify(err, null, 2);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * Full-screen raw error overlay for iPad Safari when remote console is empty.
 * Uses only basic DOM (createElement, appendChild, textContent, style.*).
 * @param {string} stepLabel
 * @param {unknown} err
 */
function showFatalCameraError(stepLabel, err) {
  document.body.dataset.mouthNinjaCameraFatal = "1";

  var previous = document.getElementById("mouth-ninja-camera-fatal");
  if (previous) {
    previous.remove();
  }

  var panel = document.createElement("div");
  panel.id = "mouth-ninja-camera-fatal";
  panel.setAttribute("role", "alert");

  panel.style.position = "fixed";
  panel.style.left = "0";
  panel.style.top = "0";
  panel.style.right = "0";
  panel.style.bottom = "0";
  panel.style.zIndex = "2147483647";
  panel.style.overflow = "auto";
  panel.style.boxSizing = "border-box";
  panel.style.padding = "24px";
  panel.style.paddingTop = "max(24px, env(safe-area-inset-top))";
  panel.style.paddingBottom = "max(24px, env(safe-area-inset-bottom))";
  panel.style.background = "rgba(11, 12, 11, 0.96)";

  var title = document.createElement("div");
  title.textContent = "Face tracking failed — " + stepLabel;
  title.style.color = "#ff6262";
  title.style.fontFamily = "system-ui, -apple-system, sans-serif";
  title.style.fontWeight = "800";
  title.style.fontSize = "clamp(18px, 3.5vw, 36px)";
  title.style.marginBottom = "16px";
  title.style.lineHeight = "1.2";

  var pre = document.createElement("pre");
  pre.style.margin = "0";
  pre.style.whiteSpace = "pre-wrap";
  pre.style.wordBreak = "break-word";
  pre.style.color = "#ff6262";
  pre.style.fontFamily =
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
  pre.style.fontSize = "clamp(14px, 2.5vw, 26px)";
  pre.style.lineHeight = "1.35";
  pre.style.fontWeight = "700";

  pre.textContent = formatErrorForScreen(err);

  panel.appendChild(title);
  panel.appendChild(pre);
  document.body.appendChild(panel);
}

/** Euclidean lip delta normalized to nose-bridge anchor + forehead–chin scale. */
const LIP_DELTA_INDICES = [
  61, 78, 80, 82, 87, 88, 91, 95, 146, 181, 185, 267, 270, 291, 308, 310, 312, 317, 321, 324, 375, 405, 409,
];

const IDX_NOSE_BRIDGE = 4;
const IDX_LEFT_EYE_OUTER = 33;
const IDX_RIGHT_EYE_OUTER = 263;
const IDX_FOREHEAD = 10;
const IDX_NOSE_TIP = 1;
const IDX_MOUTH_CENTER = 13;
const IDX_CHIN = 152;

/** Lip latch (~40% below prior 0.0042 / 0.0028) — all exercises use this lip_movement mechanic. */
const MOVE_THRESHOLD_ON = 0.00252;
const MOVE_THRESHOLD_OFF = 0.00168;

/** Seconds of continuous below-threshold before UI/timer treat movement as inactive. */
const LIP_MOVE_DEBOUNCE_OFF_SEC = 2.0;

/** Horizontal crop = face width (|263−33|) × (1 + 2×this padding per side). */
const CROP_SIDE_PAD_FACE_WIDTH = 0.8;
const BRACKET_REL_LIP_W = 2;
const BRACKET_REL_LIP_H = 1.5;
/** Corner arm length = this × min(bracket width, bracket height) in CSS px (after overlay layout). */
const BRACKET_LEG_FRAC_SHORTER = 0.12;

/**
 * @typedef {Object} FrameTelemetry
 * @property {boolean} hasFace
 * @property {boolean} moving — timer advances when true (lip movement threshold + debounce met).
 * @property {number} dtSec
 */

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function lipRoiBoundsNorm(landmarks) {
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  let found = false;
  for (const idx of LIP_DELTA_INDICES) {
    const p = landmarks[idx];
    if (!p) continue;
    found = true;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (!found) return null;
  return { minX, maxX, minY, maxY };
}

/**
 * Lip positions relative to nose bridge (4), scaled by distance forehead (10) → chin (152).
 * Midline anchor/scale avoids eye-blink distortion near 33/263.
 * @param {Array<{ x: number; y: number }|undefined>} landmarks
 * @returns {Record<number, { x: number; y: number }>|null}
 */
function lipAnchoredNormalizedMap(landmarks) {
  if (landmarks == null || typeof landmarks !== "object") return null;

  const bridge = landmarks[IDX_NOSE_BRIDGE];
  const forehead = landmarks[IDX_FOREHEAD];
  const chin = landmarks[IDX_CHIN];
  if (
    bridge == null ||
    forehead == null ||
    chin == null ||
    typeof bridge !== "object" ||
    typeof forehead !== "object" ||
    typeof chin !== "object"
  ) {
    return null;
  }

  const anchorX = bridge.x;
  const anchorY = bridge.y;
  const faceSpan = Math.hypot(chin.x - forehead.x, chin.y - forehead.y);
  if (faceSpan < 1e-8) return null;

  /** @type {Record<number, { x: number; y: number }>} */
  const map = {};
  for (const i of LIP_DELTA_INDICES) {
    const p = landmarks[i];
    if (p == null || typeof p !== "object") return null;
    map[i] = { x: (p.x - anchorX) / faceSpan, y: (p.y - anchorY) / faceSpan };
  }
  return map;
}

/** Mean Euclidean delta of anchored lip coords. */
function lipMovementScoreAnchored(prevLm, currLm) {
  const pa = lipAnchoredNormalizedMap(prevLm);
  const ca = lipAnchoredNormalizedMap(currLm);
  if (!pa || !ca) return 0;
  let sum = 0;
  let n = 0;
  for (const i of LIP_DELTA_INDICES) {
    const a = pa[i];
    const b = ca[i];
    if (!a || !b) continue;
    sum += Math.hypot(b.x - a.x, b.y - a.y);
    n += 1;
  }
  return n ? sum / n : 0;
}

/**
 * Corner brackets: horizontal leg = armVX viewBox units, vertical = armVY, chosen so both span the
 * same CSS pixel length (overlay uses preserveAspectRatio="none", so square viewBox units ≠ square on screen).
 */
function cornerPaths(cx0, cy0, cw, ch, armVX, armVY) {
  const x0 = cx0 * 100;
  const y0 = cy0 * 100;
  const w = cw * 100;
  const h = ch * 100;
  const ah = armVX;
  const av = armVY;
  return {
    tl: `M ${x0} ${y0 + av} L ${x0} ${y0} L ${x0 + ah} ${y0}`,
    tr: `M ${x0 + w - ah} ${y0} L ${x0 + w} ${y0} L ${x0 + w} ${y0 + av}`,
    bl: `M ${x0} ${y0 + h - av} L ${x0} ${y0 + h} L ${x0 + ah} ${y0 + h}`,
    br: `M ${x0 + w - ah} ${y0 + h} L ${x0 + w} ${y0 + h} L ${x0 + w} ${y0 + h - av}`,
  };
}

/**
 * @param {Object} options
 * @param {HTMLVideoElement} options.video
 * @param {HTMLCanvasElement} options.canvas
 * @param {SVGPathElement} options.paths.tl
 * @param {SVGPathElement} options.paths.tr
 * @param {SVGPathElement} options.paths.bl
 * @param {SVGGElement} options.bracketGroup
 * @param {(info: FrameTelemetry & { mouthFrac?: { x:number,y:number,w:number,h:number } }) => void} options.onFrame
 */
export async function createExerciseFacePipeline(options) {
  try {
    const { video, canvas, paths, bracketGroup, onFrame } = options;

    console.log("[MouthNinja FaceLandmarker] init start");
    console.log("[MouthNinja FaceLandmarker] WASM_BASE_URL (absolute):", WASM_BASE_URL);
    console.log("[MouthNinja FaceLandmarker] MODEL_URL (absolute):", MODEL_URL);

    let FaceLandmarker;
    let FilesetResolver;
    try {
      console.log("[MouthNinja FaceLandmarker] step: window.MediaPipeTasksVision …");
      const Vision = typeof window !== "undefined" ? window.MediaPipeTasksVision : undefined;
      if (!Vision) {
        throw new Error(
          "window.MediaPipeTasksVision missing — ensure index.html loads vision_bundle.mjs before app.js."
        );
      }
      ({ FaceLandmarker, FilesetResolver } = Vision);
      console.log(
        "[MouthNinja FaceLandmarker] step OK: FaceLandmarker=%s FilesetResolver=%s",
        typeof FaceLandmarker,
        typeof FilesetResolver
      );
    } catch (e) {
      console.error("[MouthNinja FaceLandmarker] FAIL at step: window.MediaPipeTasksVision", e);
      showFatalCameraError("window.MediaPipeTasksVision (HTML script bootstrap)", e);
      throw e;
    }

    if (!FaceLandmarker || !FilesetResolver) {
      const missingExportsErr = new Error("MediaPipeTasksVision missing FaceLandmarker or FilesetResolver");
      console.error("[MouthNinja FaceLandmarker] FAIL:", missingExportsErr);
      showFatalCameraError("FaceLandmarker / FilesetResolver exports", missingExportsErr);
      throw missingExportsErr;
    }

    let vision;
    try {
      console.log("[MouthNinja FaceLandmarker] step: FilesetResolver.forVisionTasks …");
      vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
      console.log("[MouthNinja FaceLandmarker] step OK: WASM fileset ready");
    } catch (e) {
      console.error("[MouthNinja FaceLandmarker] FAIL at step: FilesetResolver.forVisionTasks (WASM load/init)", e);
      showFatalCameraError("FilesetResolver.forVisionTasks (WASM)", e);
      throw e;
    }

    let faceLandmarker;
    try {
      console.log("[MouthNinja FaceLandmarker] step: FaceLandmarker.createFromOptions (fetch .task model) …");
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
        },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      console.log("[MouthNinja FaceLandmarker] step OK: FaceLandmarker instance created");
    } catch (e) {
      console.error("[MouthNinja FaceLandmarker] FAIL at step: FaceLandmarker.createFromOptions (model/WASM graph)", e);
      showFatalCameraError("FaceLandmarker.createFromOptions (model)", e);
      throw e;
    }

    console.log("[MouthNinja FaceLandmarker] init complete — pipeline ready");

    let ctx;
    try {
      ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("canvas.getContext('2d') returned null");
      }
    } catch (e) {
      showFatalCameraError("canvas 2D context", e);
      throw e;
    }

    function intrinsicVideoSize() {
      const w = video.naturalWidth || video.videoWidth;
      const h = video.naturalHeight || video.videoHeight;
      return { w, h };
    }

    let lastVideoTime = -1;
    let lastTs = performance.now();
    let prevLandmarks = null;
    let smoothedMove = 0;
    let movingLatch = false;
    /** Delayed fall to inactive for UI/timer. */
    let debouncedLipMoving = false;
    let lipNoMoveAccumSec = 0;
    let bracketStrokeApplied = false;
    let lastHasFace = false;
    let raf = 0;
    let running = false;
    let tickErrorShown = false;

    function drawPlaceholder() {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--placeholder").trim() || "#757575";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    /** Full camera frame scaled to canvas (object-fit cover) when face is not tracked. */
    function drawFullVideoFrame() {
      const { w: vw, h: vh } = intrinsicVideoSize();
      const cw = canvas.width;
      const ch = canvas.height;
      if (!vw || !vh || !cw || !ch) {
        drawPlaceholder();
        return;
      }
      const videoAspect = vw / vh;
      const canvasAspect = cw / ch;
      let sx;
      let sy;
      let sw;
      let sh;
      if (videoAspect > canvasAspect) {
        sh = vh;
        sw = sh * canvasAspect;
        sx = (vw - sw) / 2;
        sy = 0;
      } else {
        sw = vw;
        sh = sw / canvasAspect;
        sx = 0;
        sy = (vh - sh) / 2;
      }
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
    }

    function hideBrackets() {
      bracketGroup.dataset.hidden = "true";
    }

    function showBrackets() {
      bracketGroup.dataset.hidden = "false";
    }

    /**
     * Nose tip (1) → chin (152); width = face width (|263−33|) + 0.8× per side; centered on mouth (13).
     */
    function paintNoseChinCrop(landmarks) {
      const { w: vw, h: vh } = intrinsicVideoSize();
      const cw = canvas.width;
      const ch = canvas.height;
      const noseTip = landmarks[IDX_NOSE_TIP];
      const chin = landmarks[IDX_CHIN];
      const mouthMid = landmarks[IDX_MOUTH_CENTER];
      const le = landmarks[IDX_LEFT_EYE_OUTER];
      const re = landmarks[IDX_RIGHT_EYE_OUTER];

      if (!vw || !vh || !cw || !ch || !noseTip || !chin || !mouthMid) {
        return;
      }

      const noseY = noseTip.y * vh;
      const chinY = chin.y * vh;
      let cropVSpan = Math.abs(chinY - noseY);
      const minV = vh * 0.12;
      if (cropVSpan < minV) {
        cropVSpan = minV;
      }

      const cx = clamp(mouthMid.x * vw, 0, vw);
      const canvasAspect = cw / ch;

      let faceWidthPx = Math.abs((re?.x ?? 0) - (le?.x ?? 0)) * vw;
      if (!le || !re || faceWidthPx < 1e-6) {
        faceWidthPx = cropVSpan * canvasAspect * 0.55;
      }

      const minCropW = faceWidthPx * (1 + 2 * CROP_SIDE_PAD_FACE_WIDTH);

      let cropW = Math.max(minCropW, cropVSpan * canvasAspect);
      let cropH = cropW / canvasAspect;
      if (cropH < cropVSpan) {
        cropH = cropVSpan;
        cropW = cropH * canvasAspect;
        if (cropW < minCropW) {
          cropW = minCropW;
          cropH = cropW / canvasAspect;
        }
      }

      if (cropW > vw) {
        cropW = vw;
        cropH = cropW / canvasAspect;
      }
      if (cropH > vh) {
        cropH = vh;
        cropW = cropH * canvasAspect;
      }

      const midY = (noseY + chinY) / 2;
      let sx = cx - cropW / 2;
      let sy = midY - cropH / 2;
      sx = clamp(sx, 0, Math.max(0, vw - cropW));
      sy = clamp(sy, 0, Math.max(0, vh - cropH));

      ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, cw, ch);

      const lipBox = lipRoiBoundsNorm(landmarks);
      if (!lipBox) {
        hideBrackets();
        return;
      }

      const toFrac = (lx, ly) => ({
        x: (lx * vw - sx) / cropW,
        y: (ly * vh - sy) / cropH,
      });

      if (!bracketStrokeApplied) {
        bracketStrokeApplied = true;
        for (const k of ["tl", "tr", "bl", "br"]) {
          const el = paths[k];
          if (el) {
            el.style.strokeWidth = "2px";
            el.style.strokeLinecap = "butt";
            el.style.strokeLinejoin = "miter";
            el.setAttribute("vector-effect", "non-scaling-stroke");
          }
        }
      }

      const lipTL = toFrac(lipBox.minX, lipBox.minY);
      const lipBR = toFrac(lipBox.maxX, lipBox.maxY);
      const lipW = Math.max(1e-6, lipBR.x - lipTL.x);
      const lipH = Math.max(1e-6, lipBR.y - lipTL.y);

      let bw = lipW * BRACKET_REL_LIP_W;
      let bh = lipH * BRACKET_REL_LIP_H;
      bw = Math.min(bw, 1);
      bh = Math.min(bh, 1);

      const mouthFrac = toFrac(mouthMid.x, mouthMid.y);
      let bx = mouthFrac.x - bw / 2;
      let by = mouthFrac.y - bh / 2;
      bx = clamp(bx, 0, Math.max(0, 1 - bw));
      by = clamp(by, 0, Math.max(0, 1 - bh));

      const Wpx = Math.max(1, canvas.clientWidth || canvas.width);
      const Hpx = Math.max(1, canvas.clientHeight || canvas.height);
      const bracketWPx = bw * Wpx;
      const bracketHPx = bh * Hpx;
      const legPx = BRACKET_LEG_FRAC_SHORTER * Math.min(bracketWPx, bracketHPx);
      let armVX = (legPx / Wpx) * 100;
      let armVY = (legPx / Hpx) * 100;
      const boxWvb = bw * 100;
      const boxHvb = bh * 100;
      armVX = Math.min(armVX, boxWvb * 0.48);
      armVY = Math.min(armVY, boxHvb * 0.48);

      const p = cornerPaths(bx, by, bw, bh, armVX, armVY);
      paths.tl.setAttribute("d", p.tl);
      paths.tr.setAttribute("d", p.tr);
      paths.bl.setAttribute("d", p.bl);
      paths.br.setAttribute("d", p.br);
      showBrackets();
    }

    function tick(nowMs) {
      if (!running) return;

      const dtSec = Math.min(0.05, Math.max(0, (nowMs - lastTs) / 1000));
      lastTs = nowMs;

      if (video.readyState < 2) {
        lastHasFace = false;
        debouncedLipMoving = false;
        lipNoMoveAccumSec = 0;
        drawPlaceholder();
        hideBrackets();
        onFrame({ hasFace: false, moving: false, dtSec });
        raf = requestAnimationFrame(tick);
        return;
      }

      if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;

        try {
          const result = faceLandmarker.detectForVideo(video, Math.round(nowMs));
          const landmarks = result.faceLandmarks && result.faceLandmarks[0];

          if (!landmarks) {
            prevLandmarks = null;
            smoothedMove *= 0.85;
            movingLatch = smoothedMove > MOVE_THRESHOLD_OFF ? movingLatch : false;
            lastHasFace = false;
            drawFullVideoFrame();
            hideBrackets();
          } else {
            const nose = landmarks[IDX_NOSE_TIP];
            const chin = landmarks[IDX_CHIN];
            const mouthMid = landmarks[IDX_MOUTH_CENTER];
            const trackingOk = !!(nose && chin && mouthMid);

            if (!trackingOk) {
              prevLandmarks = null;
              smoothedMove *= 0.85;
              movingLatch = smoothedMove > MOVE_THRESHOLD_OFF ? movingLatch : false;
              lastHasFace = false;
              drawFullVideoFrame();
              hideBrackets();
            } else {
              paintNoseChinCrop(landmarks);
              lastHasFace = true;

              const score = lipMovementScoreAnchored(prevLandmarks, landmarks);
              prevLandmarks = landmarks;
              smoothedMove = smoothedMove * 0.72 + score * 0.28;

              if (!movingLatch && smoothedMove > MOVE_THRESHOLD_ON) movingLatch = true;
              else if (movingLatch && smoothedMove < MOVE_THRESHOLD_OFF) movingLatch = false;
            }
          }
        } catch (e) {
          running = false;
          cancelAnimationFrame(raf);
          if (!tickErrorShown) {
            tickErrorShown = true;
            showFatalCameraError("detectForVideo (per frame)", e);
          }
          return;
        }
      }

      let movingForTimer;
      if (!lastHasFace) {
        debouncedLipMoving = false;
        lipNoMoveAccumSec = 0;
        movingForTimer = false;
      } else {
        const instant = movingLatch;
        if (instant) {
          debouncedLipMoving = true;
          lipNoMoveAccumSec = 0;
        } else if (debouncedLipMoving) {
          lipNoMoveAccumSec += dtSec;
          if (lipNoMoveAccumSec >= LIP_MOVE_DEBOUNCE_OFF_SEC) {
            debouncedLipMoving = false;
            lipNoMoveAccumSec = 0;
          }
        }
        movingForTimer = debouncedLipMoving;
      }

      onFrame({ hasFace: lastHasFace, moving: movingForTimer, dtSec });
      raf = requestAnimationFrame(tick);
    }

    return {
    async start() {
      if (running) return;
      running = true;
      lastTs = performance.now();
      lastVideoTime = -1;
      try {
        console.log("[MouthNinja FaceLandmarker] step: start() setOptions VIDEO …");
        await faceLandmarker.setOptions({ runningMode: "VIDEO" });
        console.log("[MouthNinja FaceLandmarker] step OK: VIDEO mode set, RAF loop starting");
      } catch (e) {
        console.error("[MouthNinja FaceLandmarker] FAIL at step: setOptions(VIDEO)", e);
        showFatalCameraError("FaceLandmarker.setOptions(VIDEO)", e);
        running = false;
        throw e;
      }
      raf = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      prevLandmarks = null;
      smoothedMove = 0;
      movingLatch = false;
      debouncedLipMoving = false;
      lipNoMoveAccumSec = 0;
    },
    resetMovementBaseline() {
      prevLandmarks = null;
      smoothedMove = 0;
      movingLatch = false;
      debouncedLipMoving = false;
      lipNoMoveAccumSec = 0;
    },
    dispose() {
      this.stop();
      try {
        faceLandmarker.close();
      } catch (e) {
        showFatalCameraError("faceLandmarker.close()", e);
      }
    },
  };
  } catch (e) {
    if (!document.body.dataset.mouthNinjaCameraFatal) {
      showFatalCameraError("createExerciseFacePipeline (unexpected)", e);
    }
    throw e;
  }
}

/** Files in assets/audio/ (site-relative URLs). */
export const EXERCISE_BGM_TRACKS = ["assets/audio/music.mp3"];

/**
 * Background loop for the exercise camera view only. Volume 0.5; pause preserves `currentTime`.
 * @returns {{
 *   audio: HTMLAudioElement,
 *   primeUnlockFromUserGesture: () => void,
 *   syncWithMovement: (opts: { hasFace: boolean, moving: boolean, completed: boolean }) => void,
 *   pauseAndReset: () => void,
 * }}
 */
export function createExerciseBackgroundMusic() {
  const audio = new Audio();
  audio.loop = true;
  audio.volume = 0.5;

  function pickRandomSrc() {
    const tracks = EXERCISE_BGM_TRACKS;
    if (tracks.length === 0) return;
    audio.src = tracks[Math.floor(Math.random() * tracks.length)];
  }

  function pauseAndReset() {
    audio.pause();
    audio.currentTime = 0;
  }

  /** Run synchronously in the same task as the tap that starts the exercise (before any await). */
  function primeUnlockFromUserGesture() {
    pickRandomSrc();
    const p = audio.play();
    if (p !== undefined) {
      p
        .then(() => {
          audio.pause();
        })
        .catch((err) => {
          console.error("[MouthNinja] exercise BGM:", err);
        });
    }
  }

  /**
   * Play while the timer is advancing: face visible and mouth movement detected.
   * Pause (no reset) when movement stops or face is lost.
   */
  function syncWithMovement({ hasFace, moving, completed }) {
    if (completed) {
      pauseAndReset();
      return;
    }
    const shouldPlay = hasFace && moving;
    if (shouldPlay) {
      const p = audio.play();
      if (p !== undefined) {
        p.catch((err) => {
          console.error("[MouthNinja] exercise BGM:", err);
        });
      }
    } else {
      audio.pause();
    }
  }

  return {
    audio,
    primeUnlockFromUserGesture,
    syncWithMovement,
    pauseAndReset,
  };
}
