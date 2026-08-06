import Link from "next/link";
import { ArrowRight, Eye, Headphones, LayoutDashboard } from "lucide-react";

export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-3xl text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-logo-fill shadow-lg">
          <Eye className="h-6 w-6 text-[#1a2450]" strokeWidth={1.75} />
        </div>
        <span className="mt-4 inline-block rounded-full border border-navy-border bg-navy-soft px-3 py-1 text-xs font-medium tracking-wide text-slate-300">
          THESIS PROTOTYPE
        </span>
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Computer Vision Fatigue Monitor
          <span className="block text-slate-400">for Night Shift BPO Agents</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-slate-400">
          Live webcam-based drowsiness detection that alerts agents in real time and gives
          supervisors a shift-wide view of fatigue incidents as they happen.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Link
            href="/login?role=agent"
            className="group rounded-2xl bg-panel p-6 text-left shadow-lg transition hover:-translate-y-0.5"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white">
              <Headphones className="h-5 w-5 text-accent" strokeWidth={2} />
            </div>
            <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Agent</div>
            <div className="mt-1 text-lg font-semibold text-ink">Agent Interface</div>
            <p className="mt-2 text-sm text-ink-secondary">
              Log in, enable your camera, and get monitored during active calls.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent group-hover:underline">
              Go to login <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" strokeWidth={2} />
            </span>
          </Link>

          <Link
            href="/login?role=supervisor"
            className="group rounded-2xl bg-panel p-6 text-left shadow-lg transition hover:-translate-y-0.5"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white">
              <LayoutDashboard className="h-5 w-5 text-accent" strokeWidth={2} />
            </div>
            <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Supervisor</div>
            <div className="mt-1 text-lg font-semibold text-ink">Supervisor Dashboard</div>
            <p className="mt-2 text-sm text-ink-secondary">
              Monitor agent presence, live fatigue alerts, and shift-wide incident logs.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent group-hover:underline">
              Open dashboard <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" strokeWidth={2} />
            </span>
          </Link>
        </div>
      </div>
    </main>
  );
}
