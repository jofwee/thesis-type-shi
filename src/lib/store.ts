"use client";

import { createClient } from "@supabase/supabase-js";
import type { AgentSession, AgentStatus, IncidentEntry, ScoreSample, StoreSnapshot } from "./types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — check .env.local.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

function logError(context: string, error: unknown) {
  // Write functions are fire-and-forget from the UI's perspective (the app
  // already updates local state optimistically), so failures are logged
  // rather than surfaced — a dropped write shouldn't block the agent's flow.
  const detail = error && typeof error === "object" ? JSON.stringify(error) : error;
  console.error(`[store] ${context}:`, detail);
}

// --- Row <-> app-model mapping (DB is snake_case, app types are camelCase) ---

interface AgentRow {
  id: string;
  name: string;
  station_id: string;
  login_time: string;
  status: AgentStatus;
  call_session_id: string | null;
  ear: number;
  blink_freq: number;
  head_pos: number;
  fatigue_score: number;
  total_calls: number;
  total_incidents: number;
}

function rowToAgent(r: AgentRow): AgentSession {
  return {
    id: r.id,
    name: r.name,
    stationId: r.station_id,
    loginTime: r.login_time,
    status: r.status,
    callSessionId: r.call_session_id,
    ear: r.ear,
    blinkFreq: r.blink_freq,
    headPos: r.head_pos,
    fatigueScore: r.fatigue_score,
    totalCalls: r.total_calls,
    totalIncidents: r.total_incidents,
  };
}

function agentToRow(a: AgentSession) {
  return {
    id: a.id,
    name: a.name,
    station_id: a.stationId,
    login_time: a.loginTime,
    status: a.status,
    call_session_id: a.callSessionId,
    ear: a.ear,
    blink_freq: a.blinkFreq,
    head_pos: a.headPos,
    fatigue_score: a.fatigueScore,
    total_calls: a.totalCalls,
    total_incidents: a.totalIncidents,
  };
}

interface IncidentRow {
  id: string;
  agent_id: string;
  agent_name: string;
  station_id: string;
  occurred_at: string;
  alert_details: string;
  call_session_id: string;
  ear: number;
  blink_freq: number;
  head_pos: number;
}

function rowToIncident(r: IncidentRow): IncidentEntry {
  return {
    id: r.id,
    agentId: r.agent_id,
    agentName: r.agent_name,
    stationId: r.station_id,
    timestamp: r.occurred_at,
    alertDetails: r.alert_details,
    callSessionId: r.call_session_id,
    metrics: { ear: r.ear, blinkFreq: r.blink_freq, headPos: r.head_pos },
  };
}

// --- Reads (async — callers must await these) ---

export async function getAgents(): Promise<Record<string, AgentSession>> {
  const { data, error } = await supabase.from("agents").select("*");
  if (error || !data) {
    if (error) logError("getAgents", error);
    return {};
  }
  const map: Record<string, AgentSession> = {};
  for (const row of data as AgentRow[]) map[row.id] = rowToAgent(row);
  return map;
}

export async function getAgentById(id: string): Promise<AgentSession | null> {
  const { data, error } = await supabase.from("agents").select("*").eq("id", id).maybeSingle();
  if (error || !data) {
    if (error) logError("getAgentById", error);
    return null;
  }
  return rowToAgent(data as AgentRow);
}

export async function getIncidents(): Promise<IncidentEntry[]> {
  const { data, error } = await supabase
    .from("incidents")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (error || !data) {
    if (error) logError("getIncidents", error);
    return [];
  }
  return (data as IncidentRow[]).map(rowToIncident);
}

export async function getCallsStarted(): Promise<number> {
  const { data, error } = await supabase.from("shift_stats").select("calls_started").eq("id", 1).maybeSingle();
  if (error || !data) {
    if (error) logError("getCallsStarted", error);
    return 0;
  }
  return data.calls_started as number;
}

export async function getScoreHistory(): Promise<Record<string, ScoreSample[]>> {
  const { data, error } = await supabase
    .from("score_samples")
    .select("agent_id, sampled_at, score")
    .order("sampled_at", { ascending: true });
  if (error || !data) {
    if (error) logError("getScoreHistory", error);
    return {};
  }
  const map: Record<string, ScoreSample[]> = {};
  for (const row of data as { agent_id: string; sampled_at: string; score: number }[]) {
    const t = new Date(row.sampled_at).getTime();
    (map[row.agent_id] ??= []).push({ t, score: row.score });
  }
  return map;
}

export async function getSnapshot(): Promise<StoreSnapshot> {
  const [agents, incidents, callsStarted, scoreHistory] = await Promise.all([
    getAgents(),
    getIncidents(),
    getCallsStarted(),
    getScoreHistory(),
  ]);
  return { agents, incidents, callsStarted, scoreHistory };
}

// --- Writes. Each returns a Promise<void> so call sites that need to know
// the write landed (e.g. login, before navigating somewhere that immediately
// reads the row back) can await it — but nothing requires awaiting; ignoring
// the returned promise is a valid fire-and-forget call. ---

export async function authenticateAgent(
  identifier: string,
  pass: string
): Promise<{ success: true; agent: AgentSession } | { success: false; error: string }> {
  // Look up by name (case-insensitive). Use a fresh, fully-chained query
  // to avoid PostgREST builder immutability issues.
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .ilike("name", identifier)
    .order("login_time", { ascending: false })
    .limit(1);

  if (error) {
    logError("authenticateAgent", error);
    return { success: false, error: `Database error: ${error.message || JSON.stringify(error)}` };
  }

  const agentRow = data?.[0] as (AgentRow & { password?: string }) | undefined;

  if (!agentRow) {
    return { success: false, error: "Unauthorized Agent. Account not found in Supabase." };
  }

  const expectedPassword = agentRow.password ?? "password123";
  if (expectedPassword !== pass) {
    return { success: false, error: "Invalid password for authorized agent." };
  }

  const updatedAgent: AgentSession = {
    ...rowToAgent(agentRow),
    loginTime: new Date().toISOString(),
    status: "standby",
  };

  await upsertAgent(updatedAgent);
  return { success: true, agent: updatedAgent };
}

export async function authenticateSupervisor(
  username: string,
  pass: string
): Promise<{ success: true; name: string } | { success: false; error: string }> {
  const { data, error } = await supabase
    .from("supervisors")
    .select("*")
    .ilike("username", username)
    .limit(1);

  if (error) {
    logError("authenticateSupervisor", error);
    return { success: false, error: "Database error during supervisor authentication." };
  }

  const supervisorRow = data?.[0] as { id: string; username: string; password?: string; name?: string } | undefined;

  if (!supervisorRow) {
    return { success: false, error: "Unauthorized Supervisor. Account not found in Supabase." };
  }

  if (supervisorRow.password && supervisorRow.password !== pass) {
    return { success: false, error: "Invalid password for supervisor account." };
  }

  return { success: true, name: supervisorRow.name || supervisorRow.username };
}

export async function upsertAgent(agent: AgentSession): Promise<void> {
  const { error } = await supabase.from("agents").upsert(agentToRow(agent));
  if (error) logError("upsertAgent", error);
}

export async function removeAgent(agentId: string): Promise<void> {
  const { error } = await supabase.from("agents").delete().eq("id", agentId);
  if (error) logError("removeAgent", error);
}

export async function addIncident(incident: IncidentEntry): Promise<void> {
  const { error } = await supabase.from("incidents").insert({
    id: incident.id,
    agent_id: incident.agentId,
    agent_name: incident.agentName,
    station_id: incident.stationId,
    occurred_at: incident.timestamp,
    alert_details: incident.alertDetails,
    call_session_id: incident.callSessionId,
    ear: incident.metrics.ear,
    blink_freq: incident.metrics.blinkFreq,
    head_pos: incident.metrics.headPos,
  });
  if (error) logError("addIncident", error);
}

export async function incrementCallsStarted(): Promise<void> {
  const { error } = await supabase.rpc("increment_calls_started");
  if (error) logError("incrementCallsStarted", error);
}

export async function addScoreSample(agentId: string, score: number, t: number): Promise<void> {
  const { error } = await supabase
    .from("score_samples")
    .insert({ agent_id: agentId, sampled_at: new Date(t).toISOString(), score });
  if (error) logError("addScoreSample", error);
}

// --- Realtime (replaces the old BroadcastChannel, which only worked within
// one browser — this syncs the agent and supervisor views across devices) ---

export function subscribe(callback: () => void): () => void {
  const channel = supabase
    .channel("fm-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "incidents" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "score_samples" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "shift_stats" }, callback)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
