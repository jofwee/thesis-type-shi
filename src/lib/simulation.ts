// Lightweight stand-in for a real computer-vision pipeline. Ticks fake but
// plausible EAR / blink-rate / head-pose readings, with occasional "drowsy
// episodes" that cross the fatigue threshold so the UI/alerting can be
// demoed end-to-end before real CV is wired in.

export interface SimMetrics {
  ear: number;
  blinkFreq: number;
  headPos: number;
}

export interface SimState {
  metrics: SimMetrics;
  drowsyStreak: number;
  inEpisode: boolean;
  episodeTicksLeft: number;
}

const EAR_FATIGUE_THRESHOLD = 0.2;
const HEAD_FATIGUE_THRESHOLD = 20;
const STREAK_TO_TRIGGER = 3;

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export function initialSimState(): SimState {
  return {
    metrics: { ear: rand(0.28, 0.33), blinkFreq: rand(15, 20), headPos: rand(0, 4) },
    drowsyStreak: 0,
    inEpisode: false,
    episodeTicksLeft: 0,
  };
}

export function tickSimulation(state: SimState): { state: SimState; fatigueTriggered: boolean } {
  let { inEpisode, episodeTicksLeft } = state;

  if (!inEpisode && Math.random() < 0.06) {
    inEpisode = true;
    episodeTicksLeft = Math.round(rand(4, 7));
  }

  let ear: number;
  let blinkFreq: number;
  let headPos: number;

  if (inEpisode) {
    ear = rand(0.08, 0.19);
    blinkFreq = rand(3, 9);
    headPos = rand(16, 34);
    episodeTicksLeft -= 1;
    if (episodeTicksLeft <= 0) inEpisode = false;
  } else {
    ear = rand(0.26, 0.34);
    blinkFreq = rand(14, 22);
    headPos = rand(0, 6);
  }

  const isDrowsyReading = ear < EAR_FATIGUE_THRESHOLD || headPos > HEAD_FATIGUE_THRESHOLD;
  const drowsyStreak = isDrowsyReading ? state.drowsyStreak + 1 : 0;
  const fatigueTriggered = drowsyStreak === STREAK_TO_TRIGGER;

  return {
    state: {
      metrics: { ear, blinkFreq, headPos },
      drowsyStreak,
      inEpisode,
      episodeTicksLeft,
    },
    fatigueTriggered,
  };
}

export function describeAlert(metrics: SimMetrics): string {
  const reasons: string[] = [];
  if (metrics.ear < EAR_FATIGUE_THRESHOLD) reasons.push(`low EAR (${metrics.ear.toFixed(2)})`);
  if (metrics.headPos > HEAD_FATIGUE_THRESHOLD) reasons.push(`head droop (${metrics.headPos.toFixed(0)}°)`);
  if (reasons.length === 0) reasons.push("sustained drowsy pattern");
  return `Drowsiness detected — ${reasons.join(", ")}`;
}
