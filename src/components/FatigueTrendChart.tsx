"use client";

import { useMemo, useRef, useState, type MouseEvent } from "react";
import type { ScoreSample } from "@/lib/types";

interface Series {
  agentId: string;
  name: string;
  samples: ScoreSample[];
}

const VB_W = 640;
const VB_H = 200;
const PAD_L = 28;
const PAD_R = 12;
const PAD_T = 10;
const PAD_B = 10;
const WINDOW_MS = 15 * 60 * 1000;
const PLOT_W = VB_W - PAD_L - PAD_R;
const PLOT_H = VB_H - PAD_T - PAD_B;

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function nearestSample(samples: ScoreSample[], t: number): ScoreSample | null {
  if (!samples.length) return null;
  let best = samples[0];
  let bestDiff = Math.abs(samples[0].t - t);
  for (const s of samples) {
    const diff = Math.abs(s.t - t);
    if (diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return best;
}

export default function FatigueTrendChart({ series }: { series: Series[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; t: number } | null>(null);

  const domainStart = Date.now() - WINDOW_MS;
  const xFor = (t: number) => PAD_L + clamp01((t - domainStart) / WINDOW_MS) * PLOT_W;
  const yFor = (score: number) => PAD_T + (1 - clamp01(score / 100)) * PLOT_H;

  const visibleSeries = useMemo(
    () =>
      series
        .map((s) => ({ ...s, samples: s.samples.filter((p) => p.t >= domainStart) }))
        .filter((s) => s.samples.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series]
  );

  function handleMove(e: MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    const wrap = wrapRef.current;
    if (!svg || !wrap) return;
    const svgRect = svg.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const scaleX = VB_W / svgRect.width;
    const xVB = (e.clientX - svgRect.left) * scaleX;
    const frac = clamp01((xVB - PAD_L) / PLOT_W);
    const t = domainStart + frac * WINDOW_MS;
    setHover({ x: e.clientX - wrapRect.left, y: e.clientY - wrapRect.top, t });
  }

  if (visibleSeries.length === 0) {
    return <p className="text-xs text-ink-muted">No score history yet — history builds up as agents stay logged in.</p>;
  }

  const hoverX = hover ? PAD_L + clamp01((hover.t - domainStart) / WINDOW_MS) * PLOT_W : null;

  return (
    <div ref={wrapRef} className="fatigue-trend-chart relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="w-full touch-none"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={VB_W - PAD_R} y1={yFor(v)} y2={yFor(v)} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={PAD_L - 6} y={yFor(v)} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="var(--chart-text-muted)">
              {v}
            </text>
          </g>
        ))}

        {visibleSeries.map((s, i) => {
          const d = s.samples.map((p, idx) => `${idx === 0 ? "M" : "L"}${xFor(p.t).toFixed(1)},${yFor(p.score).toFixed(1)}`).join(" ");
          const color = `var(--series-${(i % 8) + 1})`;
          const last = s.samples[s.samples.length - 1];
          return (
            <g key={s.agentId}>
              <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={xFor(last.t)} cy={yFor(last.score)} r={6} fill="var(--chart-surface)" />
              <circle cx={xFor(last.t)} cy={yFor(last.score)} r={4} fill={color} />
            </g>
          );
        })}

        {hoverX !== null && (
          <line x1={hoverX} x2={hoverX} y1={PAD_T} y2={VB_H - PAD_B} stroke="var(--chart-text-muted)" strokeWidth={1} strokeDasharray="2,2" />
        )}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 min-w-[140px] rounded-lg border border-panel-border bg-white px-2.5 py-2 text-[11px] shadow-md"
          style={{
            left: Math.min(Math.max(hover.x + 10, 0), (wrapRef.current?.clientWidth ?? 300) - 150),
            top: Math.max(hover.y - 10, 0),
          }}
        >
          <div className="mb-1 font-medium text-ink-muted">
            {new Date(hover.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
          {visibleSeries.map((s, i) => {
            const sample = nearestSample(s.samples, hover.t);
            if (!sample) return null;
            const color = `var(--series-${(i % 8) + 1})`;
            return (
              <div key={s.agentId} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-ink-secondary">
                  <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: color }} />
                  {s.name}
                </span>
                <span className="font-semibold text-ink">{Math.round(sample.score)}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {visibleSeries.map((s, i) => (
          <span key={s.agentId} className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
            <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: `var(--series-${(i % 8) + 1})` }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
