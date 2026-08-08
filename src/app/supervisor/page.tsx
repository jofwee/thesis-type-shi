"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Award,
  BellRing,
  ClipboardList,
  Gauge,
  LineChart,
  LogOut,
  Radio,
  Users,
} from "lucide-react";
import StatusPill from "@/components/StatusPill";
import FatigueTrendChart from "@/components/FatigueTrendChart";
import AppHeader from "@/components/AppHeader";
import { getSnapshot, subscribe } from "@/lib/store";
import type { AgentSession, AgentStatus, IncidentEntry, ScoreSample } from "@/lib/types";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const STATUS_ORDER: AgentStatus[] = ["standby", "on_call", "drowsy", "fatigue_alert", "offline"];
const STATUS_LABEL: Record<AgentStatus, string> = {
  standby: "Standby",
  on_call: "On Call",
  drowsy: "Drowsy",
  fatigue_alert: "Fatigue Alert",
  offline: "Offline",
};
const STATUS_DOT: Record<AgentStatus, string> = {
  standby: "bg-amber-400",
  on_call: "bg-emerald-500",
  drowsy: "bg-orange-500",
  fatigue_alert: "bg-rose-500",
  offline: "bg-neutral-400",
};

function Panel({
  title,
  subtitle,
  icon: Icon,
  children,
  action,
  className = "",
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col rounded-2xl bg-panel p-4 shadow-lg ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-ink">
          <Icon className="h-4 w-4 text-ink-muted" strokeWidth={2} />
          {title}
        </h2>
        {action}
      </div>
      <p className="mt-0.5 text-[11px] text-ink-muted">{subtitle}</p>
      <div className="mt-3 flex-1">{children}</div>
    </div>
  );
}

export default function SupervisorDashboardPage() {
  const router = useRouter();
  const [supervisorName, setSupervisorName] = useState<string | null>(null);
  const [agents, setAgents] = useState<Record<string, AgentSession>>({});
  const [incidents, setIncidents] = useState<IncidentEntry[]>([]);
  const [callsStarted, setCallsStarted] = useState(0);
  const [scoreHistory, setScoreHistory] = useState<Record<string, ScoreSample[]>>({});

  useEffect(() => {
    const name = sessionStorage.getItem("fm_supervisor_name");
    if (!name) {
      router.replace("/login?role=supervisor");
      return;
    }
    setSupervisorName(name);
  }, [router]);

  const logout = () => {
    sessionStorage.removeItem("fm_supervisor_name");
    router.push("/login?role=supervisor");
  };

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const snap = await getSnapshot();
      if (cancelled) return;
      setAgents(snap.agents);
      setIncidents(snap.incidents);
      setCallsStarted(snap.callsStarted);
      setScoreHistory(snap.scoreHistory);
    };
    refresh();
    const unsubscribe = subscribe(() => {
      refresh();
    });
    const interval = setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const agentList = useMemo(
    () => Object.values(agents).sort((a, b) => a.loginTime.localeCompare(b.loginTime)),
    [agents]
  );
  const presentAgents = useMemo(() => agentList.filter((a) => a.status !== "offline"), [agentList]);
  const statusCounts = useMemo(() => {
    const counts: Record<AgentStatus, number> = { standby: 0, on_call: 0, drowsy: 0, fatigue_alert: 0, offline: 0 };
    for (const a of agentList) counts[a.status] += 1;
    return counts;
  }, [agentList]);
  const activeAlerts = useMemo(() => agentList.filter((a) => a.status === "fatigue_alert"), [agentList]);

  const agentsAffected = useMemo(() => new Set(incidents.map((i) => i.agentId)).size, [incidents]);
  const avgIncidentsPerShift = agentList.length > 0 ? incidents.length / agentList.length : 0;

  const trendSeries = useMemo(
    () => presentAgents.map((a) => ({ agentId: a.id, name: a.name, samples: scoreHistory[a.id] ?? [] })),
    [presentAgents, scoreHistory]
  );

  const performanceByAgent = useMemo(() => {
    const map = new Map<string, { agentId: string; name: string; stationId: string; count: number; last: string }>();
    for (const incident of incidents) {
      const entry = map.get(incident.agentId);
      if (entry) {
        entry.count += 1;
        if (incident.timestamp > entry.last) entry.last = incident.timestamp;
      } else {
        map.set(incident.agentId, {
          agentId: incident.agentId,
          name: incident.agentName,
          stationId: incident.stationId,
          count: 1,
          last: incident.timestamp,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [incidents]);

  if (!supervisorName) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-16 text-sm text-slate-400">
        Loading supervisor session…
      </main>
    );
  }

  return (
    <>
      <AppHeader
        mode="Live Monitoring"
        extra={
          <>
            <span className="text-xs font-medium text-slate-300">{supervisorName}</span>
            <button
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-full border border-navy-border bg-navy-soft px-3 py-1 text-xs font-semibold text-slate-300 transition hover:border-accent hover:text-white"
            >
              <LogOut className="h-3 w-3" strokeWidth={2.5} />
              Logout
            </button>
          </>
        }
      />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:py-10">
        <h1 className="text-xl font-bold tracking-tight text-white">Computer Vision Fatigue Monitor for Night Shift BPO Agents</h1>
        <p className="mt-1 text-sm text-slate-400">Live supervisor dashboard.</p>

        <div className="mt-6 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Supervisor Dashboard</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white">
            <Radio className="h-3 w-3 animate-pulse" strokeWidth={2.5} />
            Live View
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {/* Presence Tracking */}
          <Panel title="Presence Tracking" subtitle="Logged-in agents only" icon={Users}>
            {presentAgents.length === 0 ? (
              <p className="text-xs text-ink-muted">No agents currently logged in.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-ink-muted">
                      <th className="pb-2 font-semibold">Agent</th>
                      <th className="pb-2 font-semibold">Login</th>
                      <th className="pb-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {presentAgents.map((a) => (
                      <tr key={a.id} className="border-t border-panel-border">
                        <td className="py-2 pr-2 font-medium text-ink">{a.name}</td>
                        <td className="py-2 pr-2 text-ink-secondary">{formatTime(a.loginTime)}</td>
                        <td className="py-2">
                          <StatusPill status={a.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* Status Monitoring Board */}
          <Panel title="Status Monitoring Board" subtitle="Color-coded state overview" icon={Activity}>
            <ul className="space-y-2">
              {STATUS_ORDER.map((status) => (
                <li
                  key={status}
                  className="flex items-center justify-between rounded-full border border-panel-border bg-white px-3 py-1.5 text-xs"
                >
                  <span className="inline-flex items-center gap-2 font-medium text-ink">
                    <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
                    {STATUS_LABEL[status]}
                  </span>
                  <span className="font-bold text-ink">{statusCounts[status]}</span>
                </li>
              ))}
            </ul>
          </Panel>

          {/* Instant Alert Panel */}
          <Panel title="Instant Alert Panel" subtitle="Live fatigue alerts" icon={BellRing}>
            {activeAlerts.length === 0 ? (
              <p className="text-xs text-ink-muted">No active alerts.</p>
            ) : (
              <ul className="space-y-2">
                {activeAlerts.map((a) => (
                  <li
                    key={a.id}
                    className="animate-pulse rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700"
                  >
                    <div className="font-semibold">{a.name}</div>
                    <div className="text-[11px] opacity-80">
                      {a.stationId} · {a.callSessionId ?? "-"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* Incident Log Table */}
          <Panel title="Incident Log Table" subtitle="Automatic log of fatigue events" icon={ClipboardList}>
            {incidents.length === 0 ? (
              <p className="text-xs text-ink-muted">No incidents recorded.</p>
            ) : (
              <ul className="max-h-56 space-y-2 overflow-y-auto">
                {incidents.map((i) => (
                  <li key={i.id} className="rounded-lg border border-panel-border bg-white px-2.5 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">{i.agentName}</span>
                      <span className="whitespace-nowrap text-ink-muted">{formatTime(i.timestamp)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-ink-secondary" title={i.alertDetails}>
                      {i.alertDetails}
                    </p>
                    <span className="mt-0.5 block font-mono text-[10px] text-ink-muted">{i.callSessionId}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* Fatigue Trend */}
          <Panel
            title="Fatigue Trend"
            subtitle="Score history for logged-in agents, last 15 min"
            icon={LineChart}
            className="sm:col-span-2"
          >
            <FatigueTrendChart series={trendSeries} />
          </Panel>

          {/* Shift Summary Panel */}
          <Panel title="Shift Summary Panel" subtitle="Aggregated shift statistics" icon={Gauge}>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-panel-border bg-white p-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  Total Monitored Calls
                </div>
                <div className="mt-1 text-lg font-bold text-ink">{callsStarted}</div>
              </div>
              <div className="rounded-lg border border-panel-border bg-white p-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  Total Fatigue Incidents
                </div>
                <div className="mt-1 text-lg font-bold text-ink">{incidents.length}</div>
              </div>
              <div className="rounded-lg border border-panel-border bg-white p-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Agents Affected</div>
                <div className="mt-1 text-lg font-bold text-ink">{agentsAffected}</div>
              </div>
              <div className="rounded-lg border border-panel-border bg-white p-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  Avg Incidents / Agent
                </div>
                <div className="mt-1 text-lg font-bold text-ink">{avgIncidentsPerShift.toFixed(2)}</div>
              </div>
            </div>
          </Panel>

          {/* Performance Review */}
          <Panel title="Performance Review" subtitle="Saved incident history" icon={Award}>
            {performanceByAgent.length === 0 ? (
              <p className="text-xs text-ink-muted">No saved incidents yet.</p>
            ) : (
              <ul className="space-y-2">
                {performanceByAgent.map((entry) => (
                  <li
                    key={entry.agentId}
                    className="flex items-center justify-between rounded-lg border border-panel-border bg-white px-3 py-2 text-xs"
                  >
                    <div>
                      <div className="font-medium text-ink">{entry.name}</div>
                      <div className="text-[11px] text-ink-muted">
                        {entry.stationId} · last {formatTime(entry.last)}
                      </div>
                    </div>
                    <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">
                      {entry.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </main>
    </>
  );
}
