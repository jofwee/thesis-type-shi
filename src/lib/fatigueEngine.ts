// Fuses several weak signals into one continuous fatigue score instead of
// letting any single metric (e.g. head tilt) fire an alert on its own.
// Mirrors the standard drowsy-driver-detection literature: PERCLOS as the
// primary signal, plus blink duration, head pose, and yawning as supporting
// evidence — see e.g. Dinges & Grace's PERCLOS work and the many EAR/MAR
// blink-and-yawn papers that build on the dlib/MediaPipe landmark sets.
//
// One case is deliberately NOT left to the weighted blend: eyes closed
// continuously past MICROSLEEP_HARD_MS is treated as an immediate, direct
// alert. It's the least ambiguous fatigue signal there is, and diluting it
// into "just 40% of a composite score" meant it could take far too long
// (or never) cross the alert threshold on its own.

export type FatigueSeverity = "normal" | "drowsy" | "alert";
export type FatiguePhase = "calibrating" | "active";

export interface FatigueTickResult {
  phase: FatiguePhase;
  calibrationProgress: number; // 0-1, only meaningful while calibrating
  score: number; // 0-100, smoothed
  severity: FatigueSeverity;
  shouldFireAlert: boolean; // true on the single tick an alert should sound
  reason: string;
  perclos: number; // 0-1, fraction of the last window with eyes closed
  headDeviationDeg: number; // degrees off this agent's calibrated baseline
  avgBlinkDurationMs: number;
  blinkFreq: number; // per minute
  yawnCount: number; // in the trailing yawn window
}

const CALIBRATION_MS = 4000;
const MIN_CALIBRATION_SAMPLES = 10;

// Fixed, not personalized: a genuinely closed eye reads close to 0 EAR
// regardless of the person, so a flat floor is more predictable than a
// baseline-relative ratio (and easier to reason about when tuning).
const EAR_CLOSED_THRESHOLD = 0.1;
const EAR_OPEN_THRESHOLD = 0.15;

// Eyes closed continuously this long always alerts, independent of the
// composite score below — see the module comment.
const MICROSLEEP_HARD_MS = 30000;

const PERCLOS_WINDOW_MS = 30000;
const PERCLOS_ALERT_LEVEL = 0.25; // 25%+ eyes-closed time over the window -> fully weighted

const BLINK_WINDOW_MS = 20000;
const MIN_BLINK_MS = 80;
const MAX_BLINK_MS = 500;
const NORMAL_BLINK_MS = 180;
const LONG_BLINK_MS = 550; // widened to absorb tick-rate quantization noise
const BLINK_DEADZONE_MS = 40; // ignore small measurement jitter above normal

// Head tilt is deliberately a minor, hard-to-trigger signal — eyes are the
// primary focus. A large deadzone plus a high alert angle means head pose
// alone essentially never drives the score on its own.
const HEAD_SMOOTHING_MS = 1500; // sustained, not a single glance
const HEAD_DEADZONE_DEG = 25; // natural head movement (typing, notes) is free
const HEAD_ALERT_DEG = 70; // beyond the deadzone, degrees for full weight

const MAR_OPEN = 0.55;
const MAR_CLOSE = 0.4;
const YAWN_MIN_MS = 1200; // yawns are slow/sustained, unlike talking
const YAWN_WINDOW_MS = 90000;
const YAWN_ALERT_COUNT = 2;

// Eyes (PERCLOS) dominate the score; head tilt is nearly negligible on its
// own and blink duration is minor supporting evidence.
const WEIGHTS = { perclos: 0.65, head: 0.05, blink: 0.1, yawn: 0.2 };
const SCORE_SMOOTHING = 0.25; // EMA alpha

const DROWSY_THRESHOLD = 40;
const ALERT_THRESHOLD = 70;
const ALERT_COOLDOWN_MS = 20000;

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export class FatigueEngine {
  private phase: FatiguePhase = "calibrating";
  private calibrationStart: number | null = null;
  private calibrationHead: number[] = [];

  private baselineHeadDeg = 0;

  private eyesClosed = false;
  private closedSince: number | null = null;
  private perclosSamples: { closed: boolean; t: number }[] = [];
  private blinkTimestamps: number[] = [];
  private blinkDurations: number[] = [];

  private headSamples: { value: number; t: number }[] = [];

  private mouthOpen = false;
  private mouthOpenSince: number | null = null;
  private yawnTimestamps: number[] = [];

  private smoothedScore = 0;
  private lastAlertAt = -Infinity;

  // Detection only runs while a call is active (see agent page), so calls can
  // be separated by arbitrary real-world gaps. Calibration and the rolling
  // windows are all age-filtered and stay valid across that gap, but the
  // in-progress eye/mouth-open flags aren't — without this, resuming on a
  // tick that happens to read "closed" would compute its duration against a
  // closedSince from before the gap and could immediately read as a
  // microsleep. Call this once when a new call starts.
  resetForNewCall() {
    this.eyesClosed = false;
    this.closedSince = null;
    this.mouthOpen = false;
    this.mouthOpenSince = null;
  }

  tick(ear: number, headTiltDegRaw: number, mar: number, now: number): FatigueTickResult {
    if (this.phase === "calibrating") {
      if (this.calibrationStart === null) this.calibrationStart = now;
      this.calibrationHead.push(headTiltDegRaw);
      const elapsed = now - this.calibrationStart;
      const progress = Math.min(1, elapsed / CALIBRATION_MS);

      if (elapsed >= CALIBRATION_MS && this.calibrationHead.length >= MIN_CALIBRATION_SAMPLES) {
        this.baselineHeadDeg = median(this.calibrationHead);
        this.phase = "active";
      } else {
        return {
          phase: "calibrating",
          calibrationProgress: progress,
          score: 0,
          severity: "normal",
          shouldFireAlert: false,
          reason: "",
          perclos: 0,
          headDeviationDeg: 0,
          avgBlinkDurationMs: 0,
          blinkFreq: 0,
          yawnCount: 0,
        };
      }
    }

    // --- Eyes: blink edge detection + PERCLOS ---
    if (!this.eyesClosed && ear < EAR_CLOSED_THRESHOLD) {
      this.eyesClosed = true;
      this.closedSince = now;
    } else if (this.eyesClosed && ear > EAR_OPEN_THRESHOLD) {
      const duration = now - (this.closedSince ?? now);
      if (duration >= MIN_BLINK_MS && duration <= MAX_BLINK_MS) {
        this.blinkTimestamps.push(now);
        this.blinkDurations.push(duration);
      }
      this.eyesClosed = false;
      this.closedSince = null;
    }

    const continuousClosedMs = this.eyesClosed && this.closedSince !== null ? now - this.closedSince : 0;
    const microsleep = continuousClosedMs >= MICROSLEEP_HARD_MS;

    this.perclosSamples.push({ closed: this.eyesClosed, t: now });
    this.perclosSamples = this.perclosSamples.filter((s) => now - s.t <= PERCLOS_WINDOW_MS);
    const perclos = this.perclosSamples.filter((s) => s.closed).length / this.perclosSamples.length;

    this.blinkTimestamps = this.blinkTimestamps.filter((t) => now - t <= BLINK_WINDOW_MS);
    this.blinkDurations = this.blinkDurations.slice(-10);
    const blinkFreq = (this.blinkTimestamps.length / BLINK_WINDOW_MS) * 60000;
    const avgBlinkDurationMs = this.blinkDurations.length
      ? this.blinkDurations.reduce((a, b) => a + b, 0) / this.blinkDurations.length
      : NORMAL_BLINK_MS;

    // --- Head: deviation from this agent's own calibrated baseline ---
    const headDeviationRaw = Math.max(0, headTiltDegRaw - this.baselineHeadDeg);
    this.headSamples.push({ value: headDeviationRaw, t: now });
    this.headSamples = this.headSamples.filter((s) => now - s.t <= HEAD_SMOOTHING_MS);
    const headDeviationDeg = this.headSamples.reduce((a, b) => a + b.value, 0) / this.headSamples.length;

    // --- Mouth: yawn edge detection ---
    if (!this.mouthOpen && mar > MAR_OPEN) {
      this.mouthOpen = true;
      this.mouthOpenSince = now;
    } else if (this.mouthOpen && mar < MAR_CLOSE) {
      const duration = now - (this.mouthOpenSince ?? now);
      if (duration >= YAWN_MIN_MS) this.yawnTimestamps.push(now);
      this.mouthOpen = false;
      this.mouthOpenSince = null;
    }
    this.yawnTimestamps = this.yawnTimestamps.filter((t) => now - t <= YAWN_WINDOW_MS);
    const yawnCount = this.yawnTimestamps.length;

    // --- Composite score (dead zones absorb normal movement/jitter before
    // it can accumulate into a false baseline) ---
    const perclosNorm = clamp01(perclos / PERCLOS_ALERT_LEVEL);
    const headNorm = clamp01(Math.max(0, headDeviationDeg - HEAD_DEADZONE_DEG) / HEAD_ALERT_DEG);
    const blinkNorm = clamp01(
      Math.max(0, avgBlinkDurationMs - NORMAL_BLINK_MS - BLINK_DEADZONE_MS) / (LONG_BLINK_MS - NORMAL_BLINK_MS)
    );
    const yawnNorm = clamp01(yawnCount / YAWN_ALERT_COUNT);

    const rawScore =
      100 * (WEIGHTS.perclos * perclosNorm + WEIGHTS.head * headNorm + WEIGHTS.blink * blinkNorm + WEIGHTS.yawn * yawnNorm);
    this.smoothedScore = this.smoothedScore + SCORE_SMOOTHING * (rawScore - this.smoothedScore);
    // A microsleep in progress should read as visibly critical even if the
    // smoothed composite hasn't caught up yet.
    const score = microsleep ? Math.max(this.smoothedScore, ALERT_THRESHOLD) : this.smoothedScore;

    let severity: FatigueSeverity = "normal";
    if (microsleep || score >= ALERT_THRESHOLD) severity = "alert";
    else if (score >= DROWSY_THRESHOLD) severity = "drowsy";

    let shouldFireAlert = false;
    if (severity === "alert" && now - this.lastAlertAt >= ALERT_COOLDOWN_MS) {
      shouldFireAlert = true;
      this.lastAlertAt = now;
    }

    const reason = shouldFireAlert
      ? microsleep
        ? `Eyes closed continuously for ${(continuousClosedMs / 1000).toFixed(1)}s — possible microsleep`
        : describeReason(score, { perclos, perclosNorm, headDeviationDeg, headNorm, avgBlinkDurationMs, blinkNorm, yawnCount, yawnNorm })
      : "";

    return {
      phase: "active",
      calibrationProgress: 1,
      score,
      severity,
      shouldFireAlert,
      reason,
      perclos,
      headDeviationDeg,
      avgBlinkDurationMs,
      blinkFreq,
      yawnCount,
    };
  }
}

function describeReason(
  score: number,
  c: {
    perclos: number;
    perclosNorm: number;
    headDeviationDeg: number;
    headNorm: number;
    avgBlinkDurationMs: number;
    blinkNorm: number;
    yawnCount: number;
    yawnNorm: number;
  }
): string {
  const candidates: { text: string; weight: number }[] = [
    { text: `sustained eye closure (${(c.perclos * 100).toFixed(0)}% PERCLOS)`, weight: c.perclosNorm },
    { text: `head droop (${c.headDeviationDeg.toFixed(0)}° from baseline)`, weight: c.headNorm },
    { text: `slow blinking (${c.avgBlinkDurationMs.toFixed(0)}ms avg)`, weight: c.blinkNorm },
    { text: `yawning (${c.yawnCount}x recently)`, weight: c.yawnNorm },
  ];
  const parts = candidates
    .filter((p) => p.weight > 0.35)
    .sort((a, b) => b.weight - a.weight)
    .map((p) => p.text);

  const detail = parts.length ? parts.join(", ") : "combined fatigue indicators";
  return `Fatigue detected (score ${score.toFixed(0)}/100) — ${detail}`;
}
