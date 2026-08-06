"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { Activity, AlertTriangle, Camera, Eye, History, Radio, Settings2 } from "lucide-react";
import StatusPill from "@/components/StatusPill";
import AppHeader from "@/components/AppHeader";
import { addIncident, addScoreSample, getAgentById, incrementCallsStarted, newId, upsertAgent } from "@/lib/store";
import { playFatigueAlert } from "@/lib/sound";
import { requestNotificationPermission, showFatigueNotification } from "@/lib/notify";
import { computeEAR, computeHeadTiltDegrees, computeMAR, loadFaceLandmarker, type Landmark } from "@/lib/faceMesh";
import { FatigueEngine, type FatigueSeverity } from "@/lib/fatigueEngine";
import { initialSimState, tickSimulation, type SimState } from "@/lib/simulation";
import type { AgentSession, AgentStatus, IncidentEntry } from "@/lib/types";

const ALERT_DISPLAY_MS = 4000;
const DETECTION_TICK_MS = 100;
const PERSIST_THROTTLE_MS = 1000;
const SCORE_SAMPLE_INTERVAL_MS = 15000;

type LiveMetrics = {
  ear: number;
  blinkFreq: number;
  headPos: number;
  score: number;
  perclos: number;
  avgBlinkDurationMs: number;
  yawnCount: number;
};
type DetectionMode = "loading" | "real" | "simulated";
type CallState = "standby" | "on_call";

const EMPTY_METRICS: LiveMetrics = { ear: 0, blinkFreq: 0, headPos: 0, score: 0, perclos: 0, avgBlinkDurationMs: 0, yawnCount: 0 };

function newCallSessionId() {
  return `CALL-${Date.now().toString(36).slice(-5).toUpperCase()}`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function severityToStatus(callState: CallState, severity: FatigueSeverity): AgentStatus {
  if (severity === "normal") return callState;
  return "drowsy";
}

export default function AgentInterfacePage() {
  const router = useRouter();
  const [agent, setAgent] = useState<AgentSession | null>(null);
  const [incidentLog, setIncidentLog] = useState<IncidentEntry[]>([]);
  const [latestAlert, setLatestAlert] = useState<IncidentEntry | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [detectionMode, setDetectionMode] = useState<DetectionMode>("loading");
  const [faceDetected, setFaceDetected] = useState(false);
  const [calibrating, setCalibrating] = useState(true);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [liveMetrics, setLiveMetrics] = useState<LiveMetrics>(EMPTY_METRICS);

  // Need both: a live ref for imperative access (always current, even mid-async-await)
  // and a boolean state so effects can re-run once the <video> element actually
  // mounts — it's rendered behind an early "loading session" return, so effects
  // that only fire on mount would otherwise run before the node exists.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoMounted, setVideoMounted] = useState(false);
  const setVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideoMounted(!!node);
  }, []);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const fatigueEngineRef = useRef(new FatigueEngine());
  const simStateRef = useRef<SimState>(initialSimState());
  const agentRef = useRef<AgentSession | null>(null);
  const lastPersistRef = useRef(0);
  const lastScoreSampleRef = useRef(0);
  const callStateRef = useRef<CallState>("standby");
  const lastSeverityRef = useRef<FatigueSeverity>("normal");

  agentRef.current = agent;
  const callActive = agent?.status === "on_call" || agent?.status === "drowsy" || agent?.status === "fatigue_alert";

  // Load session + require login.
  useEffect(() => {
    const id = sessionStorage.getItem("fm_current_agent");
    if (!id) {
      router.replace("/login?role=agent");
      return;
    }
    let cancelled = false;
    (async () => {
      const existing = await getAgentById(id);
      if (cancelled) return;
      if (!existing) {
        router.replace("/login?role=agent");
        return;
      }
      callStateRef.current = existing.status === "on_call" ? "on_call" : "standby";
      setAgent(existing);
      requestNotificationPermission();
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const persist = useCallback((next: AgentSession) => {
    setAgent(next);
    upsertAgent(next);
  }, []);

  const handleFatigueTrigger = useCallback(
    (metrics: LiveMetrics, reason: string) => {
      const base = agentRef.current;
      if (!base || base.status === "logged_out") return;

      const incident: IncidentEntry = {
        id: newId(),
        agentId: base.id,
        agentName: base.name,
        stationId: base.stationId,
        timestamp: new Date().toISOString(),
        alertDetails: reason,
        callSessionId: base.callSessionId ?? "-",
        metrics: { ear: metrics.ear, blinkFreq: metrics.blinkFreq, headPos: metrics.headPos },
      };

      playFatigueAlert();
      showFatigueNotification(base.name);
      setIncidentLog((prev) => [incident, ...prev]);
      setLatestAlert(incident);

      persist({
        ...base,
        status: "fatigue_alert",
        totalIncidents: base.totalIncidents + 1,
        ear: metrics.ear,
        blinkFreq: metrics.blinkFreq,
        headPos: metrics.headPos,
        fatigueScore: metrics.score,
      });
      addIncident(incident);

      if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current);
      alertTimeoutRef.current = setTimeout(() => {
        const current = agentRef.current;
        if (current && current.status === "fatigue_alert") {
          persist({ ...current, status: severityToStatus(callStateRef.current, lastSeverityRef.current) });
        }
      }, ALERT_DISPLAY_MS);
    },
    [persist]
  );

  const syncMetrics = useCallback(
    (metrics: LiveMetrics, severity: FatigueSeverity) => {
      setLiveMetrics(metrics);
      lastSeverityRef.current = severity;
      const now = Date.now();
      const current = agentRef.current;
      if (!current || current.status === "logged_out" || current.status === "fatigue_alert") return;

      const nextStatus = severityToStatus(callStateRef.current, severity);
      const statusChanged = nextStatus !== current.status;

      if (statusChanged || now - lastPersistRef.current >= PERSIST_THROTTLE_MS) {
        lastPersistRef.current = now;
        persist({
          ...current,
          status: nextStatus,
          ear: metrics.ear,
          blinkFreq: metrics.blinkFreq,
          headPos: metrics.headPos,
          fatigueScore: metrics.score,
        });
      }

      if (now - lastScoreSampleRef.current >= SCORE_SAMPLE_INTERVAL_MS) {
        lastScoreSampleRef.current = now;
        addScoreSample(current.id, metrics.score, now);
      }
    },
    [persist]
  );

  // Camera. The preview stays on continuously ("Camera Always Active"); only
  // the AI analysis further down is gated to active calls.
  useEffect(() => {
    let cancelled = false;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch {
        if (!cancelled) {
          setCameraError("Camera access denied. Enable camera permissions to continue monitoring.");
          setDetectionMode("simulated");
        }
      }
    }
    startCamera();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-attach the stream if the camera resolved before the <video> mounted.
  useEffect(() => {
    if (videoMounted && videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [videoMounted]);

  // Preload the on-device model once the video is playing, but don't analyze
  // any frames yet — analysis only starts once a call is active (below), so
  // no facial data is processed during the agent's non-productive time.
  useEffect(() => {
    if (cameraError) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;

    async function onVideoReady() {
      try {
        const landmarker = await loadFaceLandmarker();
        if (cancelled) return;
        landmarkerRef.current = landmarker;
        setDetectionMode("real");
      } catch {
        if (!cancelled) setDetectionMode("simulated");
      }
    }

    // Poll for readiness rather than relying solely on the `loadeddata`
    // event — it doesn't fire reliably for every camera/browser combination
    // (notably fake/synthetic devices), while readyState is always accurate.
    let pollId: ReturnType<typeof setInterval> | null = null;
    if (video.readyState >= 2) {
      onVideoReady();
    } else {
      pollId = setInterval(() => {
        if (video.readyState >= 2) {
          if (pollId) clearInterval(pollId);
          pollId = null;
          onVideoReady();
        }
      }, 150);
    }

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoMounted, cameraError]);

  // Real analysis loop: only runs while a call is active.
  useEffect(() => {
    if (detectionMode !== "real" || !callActive) return;
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker) return;

    detectionIntervalRef.current = setInterval(() => {
      if (!video || video.readyState < 2) return;
      const result = landmarker.detectForVideo(video, performance.now());
      const landmarks = result.faceLandmarks?.[0];

      if (!landmarks) {
        setFaceDetected(false);
        return;
      }
      setFaceDetected(true);

      const ear = computeEAR(landmarks as Landmark[]);
      const mar = computeMAR(landmarks as Landmark[]);
      const matrixData = result.facialTransformationMatrixes?.[0]?.data;
      const headTiltRaw = computeHeadTiltDegrees(matrixData ? Array.from(matrixData) : undefined);
      const now = performance.now();

      const tick = fatigueEngineRef.current.tick(ear, headTiltRaw, mar, now);
      setCalibrating(tick.phase === "calibrating");
      setCalibrationProgress(tick.calibrationProgress);
      if (tick.phase === "calibrating") return;

      const metrics: LiveMetrics = {
        ear,
        blinkFreq: tick.blinkFreq,
        headPos: tick.headDeviationDeg,
        score: tick.score,
        perclos: tick.perclos,
        avgBlinkDurationMs: tick.avgBlinkDurationMs,
        yawnCount: tick.yawnCount,
      };

      syncMetrics(metrics, tick.severity);
      if (tick.shouldFireAlert) handleFatigueTrigger(metrics, tick.reason);
    }, DETECTION_TICK_MS);

    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
    };
  }, [detectionMode, callActive, syncMetrics, handleFatigueTrigger]);

  // Simulated fallback loop — only when the camera/model is unavailable,
  // clearly labeled as such, and still gated to active calls.
  useEffect(() => {
    if (detectionMode !== "simulated" || !callActive) return;
    simStateRef.current = initialSimState();
    const interval = setInterval(() => {
      const { state, fatigueTriggered } = tickSimulation(simStateRef.current);
      simStateRef.current = state;
      setFaceDetected(true);
      const score = state.inEpisode ? 55 + state.drowsyStreak * 12 : Math.random() * 12;
      const metrics: LiveMetrics = {
        ear: state.metrics.ear,
        blinkFreq: state.metrics.blinkFreq,
        headPos: state.metrics.headPos,
        score: Math.min(100, score),
        perclos: 0,
        avgBlinkDurationMs: 150,
        yawnCount: 0,
      };
      syncMetrics(metrics, fatigueTriggered ? "alert" : score > 40 ? "drowsy" : "normal");
      if (fatigueTriggered) {
        const reasons: string[] = [];
        if (state.metrics.ear < 0.2) reasons.push(`low EAR (${state.metrics.ear.toFixed(2)})`);
        if (state.metrics.headPos > 20) reasons.push(`head droop (${state.metrics.headPos.toFixed(0)}°)`);
        handleFatigueTrigger(metrics, `Drowsiness detected (simulated) — ${reasons.join(", ") || "sustained pattern"}`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [detectionMode, callActive, syncMetrics, handleFatigueTrigger]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);
      if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current);
      landmarkerRef.current?.close();
    };
  }, []);

  const startCall = useCallback(() => {
    if (!agent || agent.status !== "standby") return;
    callStateRef.current = "on_call";
    fatigueEngineRef.current.resetForNewCall();
    const callSessionId = newCallSessionId();
    incrementCallsStarted();
    persist({ ...agent, status: "on_call", callSessionId, totalCalls: agent.totalCalls + 1 });
  }, [agent, persist]);

  const endCall = useCallback(() => {
    if (!agent) return;
    callStateRef.current = "standby";
    setFaceDetected(false);
    setLiveMetrics(EMPTY_METRICS);
    if (agent.status === "on_call") persist({ ...agent, status: "standby", callSessionId: null });
    else persist({ ...agent, callSessionId: null });
  }, [agent, persist]);

  const logout = useCallback(() => {
    if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);
    if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current);
    landmarkerRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (agent) upsertAgent({ ...agent, status: "logged_out", callSessionId: null });
    sessionStorage.removeItem("fm_current_agent");
    router.push("/login?role=agent");
  }, [agent, router]);

  if (!agent) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-16 text-sm text-slate-400">
        Loading agent session…
      </main>
    );
  }

  const isFatigue = agent.status === "fatigue_alert";
  const isDrowsy = agent.status === "drowsy";
  const monitoringLive = callActive && (detectionMode === "real" || detectionMode === "simulated") && faceDetected && !calibrating;
  const scoreColor = liveMetrics.score >= 70 ? "bg-rose-500" : liveMetrics.score >= 40 ? "bg-orange-500" : "bg-emerald-500";
  const scoreTextColor = liveMetrics.score >= 70 ? "text-rose-600" : liveMetrics.score >= 40 ? "text-orange-600" : "text-emerald-600";

  return (
    <>
      <AppHeader
        mode={callActive ? "Active" : "Waiting for Call"}
        extra={
          <>
            {detectionMode === "simulated" && (
              <span className="rounded-full border border-amber-700 bg-amber-950/40 px-3 py-1 text-xs font-medium text-amber-300">
                Simulated data — camera unavailable
              </span>
            )}
            <span className="rounded-full border border-navy-border bg-navy-soft px-3 py-1 text-xs font-medium text-slate-300">
              Camera Always Active
            </span>
          </>
        }
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
          {/* Webcam Feed */}
          <div
            className={`rounded-2xl bg-panel p-4 shadow-lg ${isFatigue ? "fatigue-flash" : ""} ${
              isDrowsy ? "ring-2 ring-orange-400" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-ink">
                <Camera className="h-4 w-4 text-ink-muted" strokeWidth={2} />
                Webcam Feed
              </h2>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-white">
                <Radio className="h-3 w-3 animate-pulse" strokeWidth={2.5} />
                Live
              </span>
            </div>

            <div className="relative mt-3 flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-panel-border bg-white">
              <video ref={setVideoRef} autoPlay playsInline muted className="h-full w-full scale-x-[-1] object-cover" />
              {cameraError && (
                <div className="absolute inset-0 flex items-center justify-center bg-white px-6 text-center text-sm text-ink-secondary">
                  {cameraError}
                </div>
              )}
              {!cameraError && !callActive && (
                <span className="absolute left-2 top-2 rounded-full bg-ink/85 px-2.5 py-1 text-[11px] font-semibold text-white">
                  Waiting for active call detection
                </span>
              )}
              {!cameraError && callActive && detectionMode !== "simulated" && (
                <span
                  className={`absolute left-2 top-2 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white ${
                    faceDetected && !calibrating ? "bg-emerald-600/90" : "bg-ink/85"
                  }`}
                >
                  {detectionMode === "loading"
                    ? "Loading detection model…"
                    : calibrating
                      ? `Calibrating… ${Math.round(calibrationProgress * 100)}%`
                      : faceDetected
                        ? "Face detected"
                        : "No face detected"}
                </span>
              )}
              {isDrowsy && (
                <div className="absolute inset-x-0 top-0 bg-orange-500/90 py-2 text-center text-sm font-bold tracking-wide text-white">
                  Signs of drowsiness detected
                </div>
              )}
              {isFatigue && (
                <div className="absolute inset-x-0 top-0 bg-rose-600/90 py-2 text-center text-sm font-bold tracking-wide text-white">
                  GISING! Fatigue detected
                </div>
              )}
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              {detectionMode === "loading" && "Starting camera and loading the on-device detection model…"}
              {detectionMode !== "loading" &&
                !callActive &&
                "Camera active, detection paused — monitoring starts automatically once a call is active."}
              {detectionMode === "real" &&
                callActive &&
                (calibrating
                  ? "Calibrating to your neutral eye and head position — hold still and look at the camera."
                  : faceDetected
                    ? "Monitoring active — tracking eyes, head pose, and yawns live."
                    : "Camera active — position your face in frame to begin monitoring.")}
              {detectionMode === "simulated" && callActive && "Camera unavailable — showing simulated readings for demo purposes."}
            </p>
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-5">
            {/* System Status */}
            <div className="rounded-2xl bg-panel p-4 shadow-lg">
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-ink">
                <Activity className="h-4 w-4 text-ink-muted" strokeWidth={2} />
                System Status
              </h2>
              <div className="mt-2">
                <StatusPill status={agent.status} />
              </div>
              <p className="mt-2 text-xs text-ink-secondary">
                {agent.status === "standby" && "Waiting for active call detection."}
                {agent.status === "on_call" && "Active call in progress — fatigue monitoring is running."}
                {agent.status === "drowsy" && "Early signs of fatigue detected — keep watching for a full alert."}
                {agent.status === "fatigue_alert" && "Fatigue threshold met. Alert issued to agent."}
                {agent.status === "logged_out" && "Session ended."}
              </p>
              <div className="mt-3 flex items-center justify-between border-t border-panel-border pt-3 text-xs">
                <div>
                  <div className="text-ink-muted">Call Session ID</div>
                  <div className="mt-0.5 font-mono font-medium text-ink">{agent.callSessionId ?? "-"}</div>
                </div>
                <div className="text-right">
                  <div className="text-ink-muted">Station ID</div>
                  <div className="mt-0.5 font-mono font-medium text-ink">{agent.stationId}</div>
                </div>
              </div>
            </div>

            {/* Real-Time Monitoring */}
            <div className="rounded-2xl bg-panel p-4 shadow-lg">
              <div className="flex items-baseline justify-between">
                <h2 className="flex items-center gap-1.5 text-sm font-bold text-ink">
                  <Eye className="h-4 w-4 text-ink-muted" strokeWidth={2} />
                  Real-Time Monitoring
                </h2>
                <span className="text-[11px] text-ink-muted">
                  {!callActive ? "Updates during active call" : monitoringLive ? "Live" : calibrating ? "Calibrating" : "Waiting for face"}
                </span>
              </div>

              <div className="mt-3 rounded-lg border border-panel-border bg-white p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Fatigue Score</span>
                  <span className={`text-lg font-bold ${monitoringLive ? scoreTextColor : "text-ink"}`}>
                    {Math.round(liveMetrics.score)}/100
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-panel-border">
                  <div
                    className={`h-full rounded-full transition-all ${scoreColor}`}
                    style={{ width: `${monitoringLive ? liveMetrics.score : 0}%` }}
                  />
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-panel-border bg-white p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                    Eye Aspect Ratio (EAR)
                  </div>
                  <div className="mt-1 text-lg font-bold text-ink">{liveMetrics.ear.toFixed(2)}</div>
                </div>
                <div className="rounded-lg border border-panel-border bg-white p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                    Blink Frequency
                  </div>
                  <div className="mt-1 text-lg font-bold text-ink">{Math.round(liveMetrics.blinkFreq)} / min</div>
                </div>
                <div className="rounded-lg border border-panel-border bg-white p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Head Deviation</div>
                  <div className="mt-1 text-lg font-bold text-ink">{Math.round(liveMetrics.headPos)} deg</div>
                </div>
                <div className="rounded-lg border border-panel-border bg-white p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Yawns (90s)</div>
                  <div className="mt-1 text-lg font-bold text-ink">{liveMetrics.yawnCount}</div>
                </div>
              </div>
            </div>

            {/* Fatigue Detection */}
            <div className="rounded-2xl bg-panel p-4 shadow-lg">
              <div className="flex items-baseline justify-between">
                <h2 className="flex items-center gap-1.5 text-sm font-bold text-ink">
                  <AlertTriangle className="h-4 w-4 text-ink-muted" strokeWidth={2} />
                  Fatigue Detection
                </h2>
                <span className="text-[11px] text-ink-muted">Alert triggers automatically</span>
              </div>
              <div
                className={`mt-2 rounded-lg border px-3 py-2.5 text-xs ${
                  latestAlert
                    ? "border-rose-300 bg-rose-50 text-rose-700"
                    : "border-panel-border bg-white text-ink-muted"
                }`}
              >
                {latestAlert
                  ? `${formatTime(latestAlert.timestamp)} — ${latestAlert.alertDetails}`
                  : "No incidents detected yet."}
              </div>
            </div>

            {/* Simulation Controls */}
            <div className="rounded-2xl bg-panel p-4 shadow-lg">
              <div className="flex items-baseline justify-between">
                <h2 className="flex items-center gap-1.5 text-sm font-bold text-ink">
                  <Settings2 className="h-4 w-4 text-ink-muted" strokeWidth={2} />
                  Simulation Controls
                </h2>
                <span className="text-[11px] text-ink-muted">For testing call activity only</span>
              </div>
              <p className="mt-1 text-[11px] text-ink-muted">
                Stands in for the real call-detection signal — fatigue monitoring only runs while a call is active.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={startCall}
                  disabled={agent.status !== "standby"}
                  className="rounded-lg border border-panel-border bg-white py-2 text-xs font-semibold text-ink transition enabled:hover:border-accent enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Simulate Active Call
                </button>
                <button
                  onClick={endCall}
                  disabled={agent.status === "standby" || agent.status === "logged_out"}
                  className="rounded-lg border border-panel-border bg-white py-2 text-xs font-semibold text-ink transition enabled:hover:border-accent enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Simulate Call End
                </button>
              </div>
              <button
                onClick={logout}
                className="mt-3 w-full rounded-lg bg-accent py-2.5 text-xs font-semibold text-white transition hover:bg-accent-hover"
              >
                Logout
              </button>
            </div>

            {/* Incident Log */}
            <div className="rounded-2xl bg-panel p-4 shadow-lg">
              <div className="flex items-baseline justify-between">
                <h2 className="flex items-center gap-1.5 text-sm font-bold text-ink">
                  <History className="h-4 w-4 text-ink-muted" strokeWidth={2} />
                  Incident Log
                </h2>
                <span className="text-[11px] text-ink-muted">Auto-saved on detection</span>
              </div>
              {incidentLog.length === 0 ? (
                <p className="mt-2 text-xs text-ink-muted">No incidents logged this session.</p>
              ) : (
                <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                  {incidentLog.map((entry) => (
                    <li key={entry.id} className="rounded-lg border border-panel-border bg-white px-3 py-2 text-xs">
                      <div className="flex items-center justify-between font-medium text-ink">
                        <span>{formatTime(entry.timestamp)}</span>
                        <span className="font-mono text-ink-muted">{entry.callSessionId}</span>
                      </div>
                      <div className="mt-0.5 text-ink-secondary">{entry.alertDetails}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
