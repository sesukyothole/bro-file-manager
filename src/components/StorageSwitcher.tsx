import type { StorageMode } from "../types";
import { HardDrive, Cloud, CheckCircle2 } from "lucide-react";

interface StorageSwitcherProps {
  mode: StorageMode;
  onModeChange: (mode: StorageMode) => void;
  s3Connected?: boolean;
  s3ConfigName?: string;
}

export function StorageSwitcher({ mode, onModeChange, s3Connected, s3ConfigName }: StorageSwitcherProps) {
  return (
    <div className="flex items-center p-1 rounded-full bg-[rgba(28,37,43,0.06)] border border-[rgba(28,37,43,0.06)]">
      <button
        onClick={() => onModeChange("local")}
        className={`relative flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all duration-300 ease-out ${mode === "local"
          ? "bg-white text-[var(--ink)] shadow-[0_4px_12px_rgba(28,37,43,0.08)] scale-100"
          : "bg-transparent text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[rgba(28,37,43,0.04)] scale-95 opacity-80"
          }`}
      >
        <HardDrive className={`w-4 h-4 transition-colors ${mode === "local" ? "text-[var(--accent)]" : "text-current"}`} />
        <span>Local Files</span>
      </button>

      <button
        onClick={() => onModeChange("s3")}
        className={`relative flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all duration-300 ease-out ${mode === "s3"
          ? "bg-white text-[var(--ink)] shadow-[0_4px_12px_rgba(28,37,43,0.08)] scale-100"
          : "bg-transparent text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[rgba(28,37,43,0.04)] scale-95 opacity-80"
          }`}
      >
        <Cloud className={`w-4 h-4 transition-colors ${mode === "s3" ? "text-[var(--accent)]" : "text-current"}`} />
        <span>S3 Storage</span>

        {s3Connected && (
          <div className={`flex items-center gap-1.5 ml-1.5 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-bold transition-colors ${mode === "s3"
            ? "bg-[rgba(61,143,140,0.15)] text-[var(--accent-2)]"
            : "bg-[rgba(28,37,43,0.08)] text-[var(--muted)]"
            }`}>
            {mode === "s3" && <CheckCircle2 className="w-3 h-3" />}
            <span className="max-w-[80px] truncate">{s3ConfigName || "Active"}</span>
          </div>
        )}
      </button>
    </div>
  );
}
