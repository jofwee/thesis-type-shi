# Alerto — Computer Vision Fatigue Monitor

> **Thesis Prototype** — A real-time, webcam-based drowsiness detection system built for night-shift BPO (Business Process Outsourcing) call-center agents.

---

## Table of Contents

1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Application Routes](#application-routes)
5. [Core Modules (src/lib)](#core-modules-srclib)
6. [Reusable Components (src/components)](#reusable-components-srccomponents)
7. [Database Schema (Supabase)](#database-schema-supabase)
8. [Data Flow & Architecture](#data-flow--architecture)
9. [Fatigue Detection Algorithm](#fatigue-detection-algorithm)
10. [Getting Started](#getting-started)

---

## Overview

**Alerto** monitors BPO agents for signs of fatigue during active calls using the device's webcam and on-device AI (MediaPipe Face Landmarker). When fatigue is detected, the system:

- Plays an audible alert with a spoken Filipino wake-up call ("Gising!")
- Displays a visual banner on the agent's screen
- Sends a browser notification (even if the window is minimized)
- Logs the incident to a Supabase database
- Updates the supervisor dashboard in real time via Supabase Realtime

The system is designed with **two user roles**:

| Role | Purpose |
|---|---|
| **Agent** | Receives live fatigue monitoring during active calls; sees their own metrics and incident log |
| **Supervisor** | Views a shift-wide dashboard with presence tracking, live alerts, fatigue trend charts, incident logs, and performance summaries |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 16.3 (App Router) |
| **Language** | TypeScript |
| **UI** | React 19, Tailwind CSS 4, Lucide Icons |
| **Computer Vision** | MediaPipe Face Landmarker (`@mediapipe/tasks-vision`) — runs entirely on-device |
| **Backend / Database** | Supabase (PostgreSQL + Realtime subscriptions) |
| **Fonts** | Geist Sans / Geist Mono (via `next/font`) |
| **Audio** | Web Audio API (alert beeps) + Web Speech Synthesis (spoken alert) |

---

## Project Structure

```
thesis-type-shi/
├── public/
│   └── mediapipe/               # WASM runtime + face_landmarker.task model
├── src/
│   ├── app/
│   │   ├── layout.tsx           # Root layout (fonts, metadata, global shell)
│   │   ├── page.tsx             # Landing page — role selection
│   │   ├── globals.css          # Design tokens, theme variables, animations
│   │   ├── login/
│   │   │   └── page.tsx         # Login form (agent / supervisor)
│   │   ├── agent/
│   │   │   └── page.tsx         # Agent interface — webcam, metrics, alerts
│   │   └── supervisor/
│   │       └── page.tsx         # Supervisor dashboard — shift-wide monitoring
│   ├── components/
│   │   ├── AppHeader.tsx        # Shared top navigation bar
│   │   ├── ShiftHeader.tsx      # Date / shift type / mode badge
│   │   ├── StatusPill.tsx       # Color-coded agent status badge
│   │   └── FatigueTrendChart.tsx # SVG line chart of fatigue scores over time
│   └── lib/
│       ├── types.ts             # Shared TypeScript interfaces
│       ├── faceMesh.ts          # MediaPipe wrapper — EAR, MAR, head tilt
│       ├── fatigueEngine.ts     # Core detection algorithm (PERCLOS, etc.)
│       ├── store.ts             # Supabase client + CRUD + Realtime
│       ├── simulation.ts        # Fake metric generator for demo/testing
│       ├── sound.ts             # Audible alert (beep + speech)
│       └── notify.ts            # Browser Notification API wrapper
├── supabase/
│   └── schema.sql               # Database schema (idempotent, safe to re-run)
├── next.config.ts               # Cross-Origin headers for MediaPipe WASM
├── package.json
└── tsconfig.json
```

---

## Application Routes

### `/` — Landing Page
A role-selection splash screen with two cards: **Agent Interface** and **Supervisor Dashboard**. Each links to `/login` with the appropriate `role` query parameter.

### `/login` — Authentication
A simple login form that accepts a username and password for either role. This is a **prototype-grade** login — any ID/password is accepted. On agent login:
- A new `AgentSession` is created with a unique UUID
- The session is persisted to Supabase (`agents` table)
- The agent ID is saved to `sessionStorage`

On supervisor login, only the name is stored in `sessionStorage`.

### `/agent` — Agent Interface
The main monitoring screen, comprising:

| Panel | Description |
|---|---|
| **Webcam Feed** | Live camera preview (always on). Overlays show face-detection status, calibration progress, drowsiness warnings, and fatigue alert banners. |
| **System Status** | Current agent status pill, call session ID, station ID. |
| **Real-Time Monitoring** | Live fatigue score bar (0–100), EAR, blink frequency, head deviation, yawn count. |
| **Fatigue Detection** | Displays the most recent alert with timestamp and reason. |
| **Simulation Controls** | Manual "Start Call" / "End Call" buttons for testing. Logout button. |
| **Incident Log** | Scrollable list of all fatigue incidents during the current session. |

**Key behaviors:**
- Camera stays on continuously; AI analysis only runs during active calls.
- MediaPipe loads on the GPU first (with an 8-second timeout), falling back to CPU, then to simulated data if both fail.
- The `FatigueEngine` calibrates for 4 seconds at the start of each call to learn the agent's neutral head position.
- Metrics are persisted to Supabase at most once per second (throttled).
- Fatigue score samples are recorded every 15 seconds for the supervisor's trend chart.

### `/supervisor` — Supervisor Dashboard
A shift-wide monitoring view with eight panels:

| Panel | Description |
|---|---|
| **Presence Tracking** | Table of logged-in agents with login times and statuses. |
| **Status Monitoring Board** | Aggregate count of agents by status (Standby, On Call, Drowsy, Fatigue Alert, Logged Out). |
| **Instant Alert Panel** | Live-pulsing cards for agents currently in a fatigue alert state. |
| **Incident Log Table** | Scrollable history of all fatigue incidents across all agents. |
| **Fatigue Trend** | Multi-series SVG line chart showing score history for the last 15 minutes. |
| **Shift Summary Panel** | Aggregate stats — total monitored calls, total incidents, agents affected, avg incidents per agent. |
| **Performance Review** | Ranked list of agents by incident count. |

Data refreshes via Supabase Realtime subscriptions and a 5-second polling fallback.

---

## Core Modules (`src/lib`)

### `types.ts`
Defines the shared data model:

| Type | Purpose |
|---|---|
| `AgentStatus` | Union: `"standby" \| "on_call" \| "drowsy" \| "fatigue_alert" \| "logged_out"` |
| `AgentSession` | Full agent state — identity, metrics, call info, counters |
| `IncidentEntry` | A single fatigue incident — agent info, timestamp, alert details, metrics snapshot |
| `ScoreSample` | A timestamped fatigue score data point (for the trend chart) |
| `StoreSnapshot` | Combined snapshot of all agents, incidents, call counter, and score history |

### `faceMesh.ts`
Wraps MediaPipe's `FaceLandmarker` and provides three computed metrics from the 478-point face mesh:

| Function | Output | Description |
|---|---|---|
| `computeEAR(landmarks)` | `number` (0–0.5 typical) | **Eye Aspect Ratio** — average of left and right eye, using the standard 6-point formula. Low EAR = eyes closing. |
| `computeMAR(landmarks)` | `number` (0–1+ typical) | **Mouth Aspect Ratio** — vertical opening / horizontal width. High MAR = mouth open (potential yawn). |
| `computeHeadTiltDegrees(matrix)` | `number` (degrees) | Total rotation from neutral, derived from MediaPipe's facial transformation matrix via the rotation-matrix trace. |

The `loadFaceLandmarker()` function is a singleton factory: it tries GPU first (with a timeout), then falls back to CPU.

### `fatigueEngine.ts`
The core detection algorithm. A `FatigueEngine` class instance is created per agent session and ticked ~10 times/second with raw sensor data.

**Two phases:**
1. **Calibrating** (first 4 seconds) — collects head-tilt samples to compute a personalized baseline via median.
2. **Active** — computes a composite fatigue score each tick.

**Signals tracked:**

| Signal | Weight | Description |
|---|---|---|
| **PERCLOS** | 65% | Fraction of the last 30 seconds with eyes closed (EAR < 0.10). The primary drowsiness indicator. |
| **Yawning** | 20% | Number of yawns (mouth open > 1.2s) in the last 90 seconds. |
| **Blink Duration** | 10% | Average blink duration compared to a 180ms norm. Slow blinks indicate drowsiness. |
| **Head Deviation** | 5% | Degrees off the calibrated baseline, with a 25° deadzone for natural movement. |

**Hard override:** Eyes closed continuously for 30+ seconds immediately triggers a fatigue alert regardless of the composite score (microsleep detection).

**Severity levels:**

| Score Range | Severity |
|---|---|
| 0–39 | `normal` |
| 40–69 | `drowsy` |
| 70–100 | `alert` |

Alerts fire with a 20-second cooldown to prevent spam.

### `store.ts`
The Supabase data access layer. Provides:

- **Reads:** `getAgents()`, `getAgentById()`, `getIncidents()`, `getCallsStarted()`, `getScoreHistory()`, `getSnapshot()`
- **Writes:** `upsertAgent()`, `removeAgent()`, `addIncident()`, `incrementCallsStarted()`, `addScoreSample()`
- **Realtime:** `subscribe(callback)` — listens for Postgres changes on all four tables and fires a callback on any change
- **Helpers:** `newId()` — generates a UUID via `crypto.randomUUID()`

All database rows use `snake_case`; app-side types use `camelCase`. Mapping functions (`rowToAgent`, `agentToRow`, `rowToIncident`) handle the conversion.

Write operations are fire-and-forget from the UI's perspective — errors are logged, not surfaced.

### `simulation.ts`
A lightweight fake-data generator for testing without a camera. Produces plausible EAR, blink-rate, and head-pose readings, with occasional "drowsy episodes" that cross the fatigue threshold so the full alert pipeline can be tested end-to-end.

### `sound.ts`
Plays a three-beep alert tone using the Web Audio API (square wave: 880 Hz → 880 Hz → 660 Hz), followed by a spoken "Gising! Gising!" via the Web Speech Synthesis API. If a Filipino TTS voice is available, it uses proper spelling; otherwise, it uses a phonetic respelling ("Ghee-sing!") for an English voice to approximate the Filipino pronunciation.

### `notify.ts`
Requests browser notification permission on agent login and fires a desktop notification on fatigue detection. The notification:
- Title: "Gising! 👋"
- Body: personalized message with the agent's name
- Is tagged (so repeated alerts replace the previous one)
- Is silent (the app plays its own sound)
- Clicking it focuses the app window

---

## Reusable Components (`src/components`)

### `AppHeader`
The shared top navigation bar. Displays the Alerto logo (eye icon), app title, shift info (via `ShiftHeader`), and optional right-side content (mode badges, logout button, etc.).

### `ShiftHeader`
Displays the current date, shift type (Graveyard Shift if 10 PM – 6 AM, Day Shift otherwise), and the current mode label. Updates every minute.

### `StatusPill`
A color-coded badge showing an agent's current status. Each status has a distinct color scheme:
- **Standby** — amber
- **On Call** — emerald/green
- **Drowsy** — orange
- **Fatigue Alert** — rose/red (with pulse animation)
- **Logged Out** — neutral/gray

### `FatigueTrendChart`
A custom SVG line chart (no charting library) that visualizes fatigue score history for all currently logged-in agents over the last 15 minutes. Features:
- Multiple color-coded series
- Grid lines at 0, 25, 50, 75, 100
- Interactive hover tooltip showing score at the hovered timestamp
- Dot indicators at each series' latest data point

---

## Database Schema (Supabase)

Four tables, defined in `supabase/schema.sql`:

### `agents`
Each row represents one agent's current session/presence state.

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` (PK) | Agent session identifier |
| `name` | `text` | Agent display name |
| `station_id` | `text` | Assigned workstation |
| `login_time` | `timestamptz` | When the agent logged in |
| `status` | `text` (check constraint) | One of: `standby`, `on_call`, `drowsy`, `fatigue_alert`, `logged_out` |
| `call_session_id` | `text` (nullable) | Current call identifier |
| `ear` | `real` | Latest Eye Aspect Ratio |
| `blink_freq` | `real` | Latest blink frequency |
| `head_pos` | `real` | Latest head deviation |
| `fatigue_score` | `real` | Latest composite fatigue score |
| `total_calls` | `int` | Cumulative call count |
| `total_incidents` | `int` | Cumulative incident count |
| `updated_at` | `timestamptz` | Last update timestamp |

### `incidents`
One row per fatigue alert event.

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` (PK) | Incident identifier |
| `agent_id` | `uuid` (FK → agents) | Which agent triggered it |
| `agent_name` | `text` | Agent name (denormalized for dashboard reads) |
| `station_id` | `text` | Station at the time of the incident |
| `occurred_at` | `timestamptz` | When the incident occurred |
| `alert_details` | `text` | Human-readable reason (e.g. "sustained eye closure, 42% PERCLOS") |
| `call_session_id` | `text` | Which call was active |
| `ear`, `blink_freq`, `head_pos` | `real` | Metric snapshot at the moment of the alert |

### `score_samples`
Rolling fatigue-score samples for the supervisor's Fatigue Trend chart.

| Column | Type | Description |
|---|---|---|
| `id` | `bigint` (identity) | Auto-incrementing ID |
| `agent_id` | `uuid` (FK → agents) | Which agent |
| `sampled_at` | `timestamptz` | When the sample was taken |
| `score` | `real` | Fatigue score at that moment |

### `shift_stats`
Single-row counter for "Total Monitored Calls".

| Column | Type | Description |
|---|---|---|
| `id` | `int` (PK, constrained to 1) | Always 1 |
| `calls_started` | `int` | Cumulative call count across all agents |

An SQL function `increment_calls_started()` provides atomic counter increments.

**Security:** Row Level Security is enabled on all tables with permissive policies for the anon key (thesis prototype scope).

**Realtime:** All four tables are added to the `supabase_realtime` publication for live change subscriptions.

---

## Data Flow & Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        AGENT BROWSER                         │
│                                                              │
│  Webcam ──► MediaPipe Face Landmarker (on-device, GPU/CPU)   │
│                │                                             │
│                ▼                                             │
│  faceMesh.ts: computeEAR, computeMAR, computeHeadTiltDeg     │
│                │                                             │
│                ▼                                             │
│  fatigueEngine.ts: FatigueEngine.tick()                      │
│     ├─ PERCLOS (65%)                                         │
│     ├─ Yawning (20%)                                         │
│     ├─ Blink duration (10%)                                  │
│     ├─ Head deviation (5%)                                   │
│     └─ Microsleep hard override (30s eyes closed)            │
│                │                                             │
│          ┌─────┴─────┐                                       │
│          ▼           ▼                                       │
│   Normal/Drowsy   Alert fires                                │
│   metric sync     ├─ sound.ts: playFatigueAlert()            │
│        │          ├─ notify.ts: showFatigueNotification()     │
│        │          └─ store.ts: addIncident()                  │
│        │                                                     │
│        ▼                                                     │
│   store.ts: upsertAgent(), addScoreSample()                  │
│                                                              │
└───────────────────────┬──────────────────────────────────────┘
                        │ Supabase (PostgreSQL + Realtime)
                        ▼
┌──────────────────────────────────────────────────────────────┐
│                     SUPERVISOR BROWSER                       │
│                                                              │
│  store.ts: subscribe() ◄─── Realtime change notifications    │
│  store.ts: getSnapshot() ◄── 5-second polling fallback       │
│                │                                             │
│                ▼                                             │
│  Supervisor Dashboard (presence, alerts, chart, logs, stats)  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Fatigue Detection Algorithm

The algorithm in `fatigueEngine.ts` mirrors standard drowsy-driver-detection literature:

1. **Calibration (4 sec):** Collect head-tilt samples, compute median as baseline.
2. **Per-tick processing (~100ms interval):**
   - **Eye closure edge detection** using EAR with hysteresis (close < 0.10, open > 0.15)
   - **PERCLOS computation** over a 30-second sliding window
   - **Blink counting** and average blink duration (80–500ms window)
   - **Head deviation** from calibrated baseline, smoothed over 1.5s, with 25° deadzone
   - **Yawn detection** via MAR with hysteresis (open > 0.55, close < 0.40), minimum 1.2s duration
3. **Composite score:** Weighted sum → EMA smoothing (α = 0.25) → 0–100 scale
4. **Severity classification:** normal (< 40), drowsy (40–69), alert (≥ 70)
5. **Hard override:** 30+ seconds continuous eye closure = immediate alert
6. **Alert cooldown:** 20 seconds between alerts

---

## Getting Started

### Prerequisites
- Node.js 18+
- A Supabase project (free tier works)

### Setup

1. **Clone and install:**
   ```bash
   git clone <repo-url>
   cd thesis-type-shi
   npm install
   ```

2. **Configure Supabase:** Create a `.env.local` file:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

3. **Run the database schema:** Copy the contents of `supabase/schema.sql` into your Supabase project's SQL Editor and run it. The script is idempotent (safe to re-run).

4. **MediaPipe model files:** Place the MediaPipe WASM runtime and `face_landmarker.task` model in `public/mediapipe/`.

5. **Run the dev server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

### Usage
1. Open the landing page and select **Agent** or **Supervisor**.
2. Log in with any username/password (prototype auth).
3. **Agent:** Click "Simulate Active Call" to start monitoring. Allow camera access when prompted.
4. **Supervisor:** The dashboard auto-populates as agents log in and generate data.
