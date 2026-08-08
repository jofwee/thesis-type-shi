"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, Lock, User } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { authenticateAgent, authenticateSupervisor } from "@/lib/store";

type Role = "agent" | "supervisor";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRole: Role = searchParams.get("role") === "supervisor" ? "supervisor" : "agent";

  const [role, setRole] = useState<Role>(initialRole);
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim() || !password.trim()) {
      setError(`Enter both a${role === "agent" ? "n Agent ID/Name" : " Supervisor ID"} and password.`);
      return;
    }

    setSubmitting(true);
    setError("");

    if (role === "supervisor") {
      const supRes = await authenticateSupervisor(userId.trim(), password.trim());
      if (!supRes.success) {
        setError(supRes.error);
        setSubmitting(false);
        return;
      }
      sessionStorage.setItem("fm_supervisor_name", supRes.name);
      router.push("/supervisor");
      return;
    }

    setSubmitting(true);
    setError("");

    const res = await authenticateAgent(userId.trim(), password.trim());
    if (!res.success) {
      setError(res.error);
      setSubmitting(false);
      return;
    }

    sessionStorage.setItem("fm_current_agent", res.agent.id);
    router.push("/agent");
  }

  return (
    <>
      <AppHeader />
      <main className="flex flex-1 flex-col items-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-2xl">
          <h1 className="text-center text-xs font-bold uppercase tracking-widest text-slate-400">Log In</h1>

          <form
            onSubmit={handleSubmit}
            className="mt-4 rounded-2xl bg-panel p-6 shadow-lg"
          >
            <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-ink">
              <KeyRound className="h-4 w-4 text-ink-muted" strokeWidth={2} />
              Authentication
            </h2>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRole("agent")}
                className={`rounded-lg border py-2 text-xs font-semibold transition ${
                  role === "agent"
                    ? "border-accent bg-accent text-white"
                    : "border-panel-border text-ink-secondary hover:border-accent hover:text-accent"
                }`}
              >
                Agent
              </button>
              <button
                type="button"
                onClick={() => setRole("supervisor")}
                className={`rounded-lg border py-2 text-xs font-semibold transition ${
                  role === "supervisor"
                    ? "border-accent bg-accent text-white"
                    : "border-panel-border text-ink-secondary hover:border-accent hover:text-accent"
                }`}
              >
                Supervisor
              </button>
            </div>

            <label className="mt-5 block text-xs font-semibold text-ink-secondary">Username</label>
            <div className="relative mt-1.5">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" strokeWidth={2} />
              <input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder={role === "agent" ? "Agent ID" : "Supervisor ID"}
                className="w-full rounded-lg border border-panel-border bg-white py-2.5 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent"
              />
            </div>

            <label className="mt-4 block text-xs font-semibold text-ink-secondary">Password</label>
            <div className="relative mt-1.5">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" strokeWidth={2} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full rounded-lg border border-panel-border bg-white py-2.5 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent"
              />
            </div>

            {error && <p className="mt-3 text-xs font-medium text-rose-600">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-6 w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Signing in…" : "Enter"}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-slate-400">
            Prototype login — any {role === "agent" ? "Agent ID" : "Supervisor ID"} / password combination is accepted.
          </p>
        </div>
      </main>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
