import type { AgentStatus } from "@/lib/types";

const STYLES: Record<AgentStatus, string> = {
  standby: "bg-amber-100 text-amber-800 border-amber-300",
  on_call: "bg-emerald-100 text-emerald-800 border-emerald-300",
  drowsy: "bg-orange-100 text-orange-800 border-orange-300",
  fatigue_alert: "bg-rose-100 text-rose-800 border-rose-300 animate-pulse",
  offline: "bg-neutral-100 text-neutral-500 border-neutral-300",
};

const LABELS: Record<AgentStatus, string> = {
  standby: "Standby",
  on_call: "On Call",
  drowsy: "Drowsy",
  fatigue_alert: "Fatigue Alert",
  offline: "Offline",
};

export default function StatusPill({ status, className = "" }: { status: AgentStatus; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${STYLES[status]} ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABELS[status]}
    </span>
  );
}
