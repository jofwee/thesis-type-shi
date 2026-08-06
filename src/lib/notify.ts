"use client";

export function requestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

// A non-intrusive desktop pop-up, distinct from the in-page banner and
// sound — visible even if the agent's window isn't focused.
export function showFatigueNotification(agentName: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification("Gising! 👋", {
      body: `${agentName}, signs of fatigue were detected. Take a breather — you've got this.`,
      tag: "fatigue-alert",
      silent: true, // the app already plays its own audio cue
    });
    n.onclick = () => window.focus();
  } catch {
    // Notification constructor can throw in some contexts (e.g. no OS permission); non-critical.
  }
}
