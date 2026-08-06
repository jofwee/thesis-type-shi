"use client";

import { useEffect, useState } from "react";

function isGraveyardShift(d: Date) {
  const hour = d.getHours();
  return hour >= 22 || hour < 6; // 10:00 PM - 6:00 AM
}

export default function ShiftHeader({ mode }: { mode: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  if (!now) return null;

  const date = now.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  const shift = isGraveyardShift(now) ? "Graveyard Shift" : "Day Shift";

  return (
    <div className="flex items-center gap-3 text-[11px] font-medium text-slate-300">
      <span>{date}</span>
      <span className="text-slate-600">|</span>
      <span>{shift}</span>
      <span className="text-slate-600">|</span>
      <span>{mode}</span>
    </div>
  );
}
