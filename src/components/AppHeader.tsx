import { Eye } from "lucide-react";
import ShiftHeader from "./ShiftHeader";

export default function AppHeader({ mode, extra }: { mode?: string; extra?: React.ReactNode }) {
  return (
    <header className="w-full border-b border-navy-border bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-logo-fill">
            <Eye className="h-5 w-5 text-[#1a2450]" strokeWidth={2} />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-bold text-white sm:text-base">Computer Vision</div>
            <div className="text-sm font-bold text-white sm:text-base">Fatigue Monitor</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {mode && <ShiftHeader mode={mode} />}
          {extra}
        </div>
      </div>
    </header>
  );
}
