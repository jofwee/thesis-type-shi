export type AgentStatus = "standby" | "on_call" | "drowsy" | "fatigue_alert" | "offline";

export interface AgentSession {
  id: string;
  name: string;
  stationId: string;
  loginTime: string; // ISO timestamp
  status: AgentStatus;
  callSessionId: string | null;
  ear: number;
  blinkFreq: number;
  headPos: number;
  fatigueScore: number;
  totalCalls: number;
  totalIncidents: number;
}

export interface IncidentEntry {
  id: string;
  agentId: string;
  agentName: string;
  stationId: string;
  timestamp: string; // ISO timestamp
  alertDetails: string;
  callSessionId: string;
  metrics: {
    ear: number;
    blinkFreq: number;
    headPos: number;
  };
}

export interface ScoreSample {
  t: number; // epoch ms
  score: number;
}

export interface StoreSnapshot {
  agents: Record<string, AgentSession>;
  incidents: IncidentEntry[];
  callsStarted: number;
  scoreHistory: Record<string, ScoreSample[]>;
}
