/** Strict order repeating: green → yellow-green → near-white */
const PALETTE = ["#7ab428", "#C0CF4E", "#f0f4e8"];
const NOTHING_FILL = "#1a1a1a";
const RIM_DARK = "#2a3a00";
const RIM_ACCENT = "#7ab428";

export const FULL_SEGMENTS = [
  { fullLabel: "5 min screen time", wheelLabel: "5 min", weight: 30 },
  { fullLabel: "10 min screen time", wheelLabel: "10 min", weight: 20 },
  { fullLabel: "15 min screen time", wheelLabel: "15 min", weight: 10 },
  { fullLabel: "0.50 euro", wheelLabel: "€0.50", weight: 15 },
  { fullLabel: "1 euro", wheelLabel: "€1", weight: 8 },
  { fullLabel: "Ice cream!", wheelLabel: "Ice cream", weight: 5 },
  { fullLabel: "30 min playing together", wheelLabel: "Play together", weight: 5 },
  { fullLabel: "Ninja sticker", wheelLabel: "Sticker", weight: 4 },
  { fullLabel: "Double spin tomorrow!", wheelLabel: "Double spin", weight: 2 },
  {
    fullLabel: "You got nothing... but you're still a ninja!",
    wheelLabel: "Nothing… 🥷",
    weight: 1,
  },
];

export const SIMPLE_SEGMENTS = [
  { fullLabel: "5 min screen time", wheelLabel: "5 min", weight: 1 },
  { fullLabel: "10 min screen time", wheelLabel: "10 min", weight: 1 },
  { fullLabel: "5 min screen time", wheelLabel: "5 min", weight: 1 },
  { fullLabel: "5 min screen time", wheelLabel: "5 min", weight: 1 },
  { fullLabel: "You got nothing... but you're still a ninja!", wheelLabel: "Nothing… 🥷", weight: 1 },
  { fullLabel: "10 min screen time", wheelLabel: "10 min", weight: 1 },
  { fullLabel: "5 min screen time", wheelLabel: "5 min", weight: 1 },
  { fullLabel: "10 min screen time", wheelLabel: "10 min", weight: 1 },
  { fullLabel: "5 min screen time", wheelLabel: "5 min", weight: 1 },
  { fullLabel: "You got nothing... but you're still a ninja!", wheelLabel: "Nothing… 🥷", weight: 1 },
];

const NS = "http://www.w3.org/2000/svg";

const SPIN_DURATION_MS = 4000;
const SPIN_EASING = "cubic-bezier(0.17, 0.67, 0.12, 0.99)";

/** SVG logical size & center — extra top/bottom padding in viewBox for rim + pointer */
const VB = { w: 460, h: 480, cx: 230, cy: 250 };
/** Filled wedges end here; double ring sits just outside. */
const R_FILL = 166;
/** Outer game-show rim stroke (half line extends out/in from this radius). */
const R_OUTER = 171;
/** Decorative inner accent ring. */
const R_ACCENT = 167;
const HUB_R = 20;
/** Top outer edge of rim stroke (half of stroke extends past R_OUTER). */
const R_OUTER_STROKE_HALF = 6;
const POINTER_BASE_Y = VB.cy - R_OUTER - R_OUTER_STROKE_HALF;

function weightedIndex(segments) {
  const total = segments.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (let i = 0; i < segments.length; i += 1) {
    if (r < segments[i].weight) return i;
    r -= segments[i].weight;
  }
  return segments.length - 1;
}

function polar(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function parseHex(hex) {
  const n = hex.replace("#", "");
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
  ];
}

function fmtRgb(rgb) {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

function shadeTowardBlack(hex, t) {
  const [r, g, b] = parseHex(hex);
  return fmtRgb([r * (1 - t), g * (1 - t), b * (1 - t)]);
}

function shadeTowardWhite(hex, t) {
  const [r, g, b] = parseHex(hex);
  return fmtRgb([r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t]);
}

function segmentGradientStops(baseHex) {
  return {
    inner: shadeTowardBlack(baseHex, 0.12),
    outer: shadeTowardWhite(baseHex, 0.12),
  };
}

function segmentBaseFill(i, segments) {
  if (segments[i].wheelLabel.startsWith("Nothing")) return NOTHING_FILL;
  return PALETTE[i % 3];
}

/**
 * Radial labels read center → rim. Flip every slice whose bisector is past 90° (from top, CW),
 * i.e. keep upright only on the top arc [0°, 90°); matches “+180° for left/bottom/right” wheels.
 * @param {number} midDeg — bisector angle (0° top, clockwise)
 */
function radialLabelRotation(midDeg) {
  let rot = midDeg - 90;
  const m = ((midDeg % 360) + 360) % 360;
  if (m >= 90) rot += 180;
  return rot;
}

function segmentLabelFill(i, segments) {
  if (segments[i].wheelLabel.startsWith("Nothing")) return "#ffffff";
  if (i % 3 === 0) return "#ffffff";
  return "#2a3a00";
}

/**
 * @param {Array<{fullLabel:string, wheelLabel:string, weight:number}>} [segments]
 * @returns {{ el: SVGSVGElement, setRotationDeg: (deg: number, transition?: string) => void, sliceDeg: number, segments: any[] }}
 */
export function createWheelDisk(segments = FULL_SEGMENTS) {
  const { w, h, cx, cy } = VB;
  const SLICE = 360 / segments.length;

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Prize wheel");
  svg.setAttribute("class", "spin-wheel__svg");

  const gradPrefix = `swg-${Math.random().toString(36).slice(2, 10)}`;
  const defs = document.createElementNS(NS, "defs");
  for (let i = 0; i < segments.length; i += 1) {
    const base = segmentBaseFill(i, segments);
    const { inner, outer } = segmentGradientStops(base);
    const rg = document.createElementNS(NS, "radialGradient");
    rg.setAttribute("id", `${gradPrefix}-${i}`);
    rg.setAttribute("gradientUnits", "userSpaceOnUse");
    rg.setAttribute("cx", String(cx));
    rg.setAttribute("cy", String(cy));
    rg.setAttribute("r", String(R_FILL));
    const s0 = document.createElementNS(NS, "stop");
    s0.setAttribute("offset", "0%");
    s0.setAttribute("stop-color", inner);
    const s1 = document.createElementNS(NS, "stop");
    s1.setAttribute("offset", "100%");
    s1.setAttribute("stop-color", outer);
    rg.append(s0, s1);
    defs.appendChild(rg);
  }
  svg.appendChild(defs);

  const spinGroup = document.createElementNS(NS, "g");
  spinGroup.setAttribute("class", "spin-wheel__rotator");

  for (let i = 0; i < segments.length; i += 1) {
    const start = i * SLICE;
    const end = start + SLICE;
    const large = SLICE > 180 ? 1 : 0;
    const p0 = polar(cx, cy, R_FILL, start);
    const p1 = polar(cx, cy, R_FILL, end);
    const d = `M ${cx} ${cy} L ${p0.x} ${p0.y} A ${R_FILL} ${R_FILL} 0 ${large} 1 ${p1.x} ${p1.y} Z`;
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", `url(#${gradPrefix}-${i})`);
    path.setAttribute("stroke", RIM_DARK);
    path.setAttribute("stroke-width", "1.25");
    path.setAttribute("stroke-opacity", "0.28");
    spinGroup.appendChild(path);

    const mid = start + SLICE / 2;
    const tR = R_FILL * 0.65;
    const tp = polar(cx, cy, tR, mid);
    const rot = radialLabelRotation(mid);
    const text = document.createElementNS(NS, "text");
    text.textContent = segments[i].wheelLabel;
    text.setAttribute("class", "wheel-segment-label");
    text.setAttribute("x", String(tp.x));
    text.setAttribute("y", String(tp.y));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("fill", segmentLabelFill(i, segments));
    text.setAttribute(
      "transform",
      `rotate(${rot.toFixed(2)} ${tp.x.toFixed(2)} ${tp.y.toFixed(2)})`
    );
    spinGroup.appendChild(text);
  }

  const hub = document.createElementNS(NS, "circle");
  hub.setAttribute("cx", String(cx));
  hub.setAttribute("cy", String(cy));
  hub.setAttribute("r", String(HUB_R));
  hub.setAttribute("fill", "#ffffff");
  hub.setAttribute("stroke", RIM_DARK);
  hub.setAttribute("stroke-width", "3");
  spinGroup.appendChild(hub);

  svg.appendChild(spinGroup);

  /* Static rim (game-show frame) — does not rotate */
  const rimGroup = document.createElementNS(NS, "g");
  rimGroup.setAttribute("class", "spin-wheel__rim");

  const outerRing = document.createElementNS(NS, "circle");
  outerRing.setAttribute("cx", String(cx));
  outerRing.setAttribute("cy", String(cy));
  outerRing.setAttribute("r", String(R_OUTER));
  outerRing.setAttribute("fill", "none");
  outerRing.setAttribute("stroke", RIM_DARK);
  outerRing.setAttribute("stroke-width", "12");
  rimGroup.appendChild(outerRing);

  const accentRing = document.createElementNS(NS, "circle");
  accentRing.setAttribute("cx", String(cx));
  accentRing.setAttribute("cy", String(cy));
  accentRing.setAttribute("r", String(R_ACCENT));
  accentRing.setAttribute("fill", "none");
  accentRing.setAttribute("stroke", RIM_ACCENT);
  accentRing.setAttribute("stroke-width", "3");
  rimGroup.appendChild(accentRing);

  svg.appendChild(rimGroup);

  /** Pointer: ~24px-tall downward triangle, high-contrast on rim */
  /** Pointer height −40% vs prior (~24 → ~14.4 user units) */
  const POINTER_DEPTH = 14;
  const POINTER_HALF_BASE = 9;
  const POINTER_FILL = "#C0CF4E";
  const tipY = POINTER_BASE_Y + POINTER_DEPTH;
  const pointer = document.createElementNS(NS, "polygon");
  pointer.setAttribute("class", "spin-wheel__pointer-svg");
  pointer.setAttribute(
    "points",
    `${cx},${tipY} ${cx - POINTER_HALF_BASE},${POINTER_BASE_Y} ${cx + POINTER_HALF_BASE},${POINTER_BASE_Y}`
  );
  pointer.setAttribute("fill", POINTER_FILL);
  pointer.setAttribute("stroke", RIM_DARK);
  pointer.setAttribute("stroke-width", "2.5");
  pointer.setAttribute("stroke-linejoin", "round");
  svg.appendChild(pointer);

  function setRotationDeg(deg, transition = "") {
    spinGroup.style.transformBox = "view-box";
    spinGroup.style.transformOrigin = `${(100 * cx) / w}% ${(100 * cy) / h}%`;
    spinGroup.style.transition = transition || "none";
    spinGroup.style.transform = `rotate(${deg}deg)`;
  }

  return { el: svg, setRotationDeg, sliceDeg: SLICE, segments };
}

/** Rotate wheel so segment `index` center sits under fixed top pointer. */
export function spinToRandomWinner(_, setRotationDeg, sliceDeg, currentRotationRef, segments = FULL_SEGMENTS) {
  const idx = weightedIndex(segments);
  const spins = 5 + Math.floor(Math.random() * 3);
  const curNorm = ((currentRotationRef.value % 360) + 360) % 360;
  const desired = ((-((idx + 0.5) * sliceDeg) % 360) + 360) % 360;
  let delta = (desired - curNorm + 360) % 360;
  const next = currentRotationRef.value + spins * 360 + delta;

  setRotationDeg(currentRotationRef.value, "none");
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      setRotationDeg(next, `transform ${SPIN_DURATION_MS}ms ${SPIN_EASING}`);
    });
  });

  currentRotationRef.value = next;
  return {
    index: idx,
    fullLabel: segments[idx].fullLabel,
    durationMs: SPIN_DURATION_MS,
  };
}

const BACK_SVG =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 6L8 12l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * @param {HTMLElement} mountNode
 * @param {{ onClaimPrize: (fullLabel: string) => void, onDismiss: () => void, segments?: Array<{fullLabel:string, wheelLabel:string, weight:number}> }} opts
 */
export function mountSpinWheel(mountNode, opts) {
  const segs = opts.segments || FULL_SEGMENTS;
  mountNode.replaceChildren();
  mountNode.classList.add("spin-wheel-root");

  const viewport = document.createElement("div");
  viewport.className = "spin-wheel__viewport";

  const topBar = document.createElement("div");
  topBar.className = "spin-wheel__top-bar";
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "btn-back spin-wheel__back-btn";
  backBtn.setAttribute("aria-label", "Back");
  backBtn.innerHTML = BACK_SVG;
  backBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onDismiss();
  });
  topBar.appendChild(backBtn);

  const wrap = document.createElement("div");
  wrap.className = "spin-wheel";

  const diskStack = document.createElement("div");
  diskStack.className = "spin-wheel__disk-stack";

  const { el: svgEl, setRotationDeg, sliceDeg } = createWheelDisk(segs);
  diskStack.append(svgEl);

  const rotationRef = { value: 0 };

  const result = document.createElement("div");
  result.className = "spin-wheel__result spin-wheel__result--hidden";
  result.hidden = true;

  const prizeLabel = document.createElement("p");
  prizeLabel.className = "spin-wheel__prize prize-reveal";

  const claimBtn = document.createElement("button");
  claimBtn.type = "button";
  claimBtn.className = "spin-wheel__claim save-prize-button";
  claimBtn.textContent = "SAVE PRIZE";

  claimBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onClaimPrize(prizeLabel.textContent?.trim() ?? "");
  });

  result.append(prizeLabel, claimBtn);

  const spinBtn = document.createElement("button");
  spinBtn.type = "button";
  spinBtn.className = "spin-wheel__spin-btn";
  spinBtn.textContent = "SPIN";

  spinBtn.addEventListener("click", () => {
    spinBtn.disabled = true;
    result.classList.add("spin-wheel__result--hidden");
    result.hidden = true;
    const { fullLabel, durationMs } = spinToRandomWinner(
      wrap,
      setRotationDeg,
      sliceDeg,
      rotationRef,
      segs
    );
    window.setTimeout(() => {
      prizeLabel.textContent = fullLabel;
      spinBtn.classList.add("spin-wheel__spin-btn--gone");
      result.hidden = false;
      result.classList.remove("spin-wheel__result--hidden");
      prizeLabel.style.animation = "none";
      void prizeLabel.offsetHeight;
      window.requestAnimationFrame(() => {
        prizeLabel.style.removeProperty("animation");
      });
    }, durationMs);
  });

  const wheelZone = document.createElement("div");
  wheelZone.className = "spin-wheel__wheel-zone";
  wheelZone.appendChild(diskStack);

  const controls = document.createElement("div");
  controls.className = "spin-wheel__controls";
  controls.append(spinBtn, result);

  wrap.append(wheelZone, controls);
  viewport.append(topBar, wrap);
  mountNode.appendChild(viewport);
}
