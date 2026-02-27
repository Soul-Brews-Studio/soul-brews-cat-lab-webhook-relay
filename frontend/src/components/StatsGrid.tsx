import { useEffect, useState } from "react";

interface D1Quota {
  db_size_bytes: number;
  writes_today: number;
  limit_storage_bytes: number;
  limit_writes_day: number;
}

interface Stats {
  total_requests: number;
  avg_response_ms: number;
  uptime_ms: number;
  started_at: string;
  d1?: D1Quota;
}

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

function quotaColor(pct: number) {
  return pct > 80 ? "#ff4060" : pct > 50 ? "#f59e0b" : "#00e5bc";
}

interface Props { stats: Stats; }

export default function StatsGrid({ stats }: Props) {
  const d = new Date(stats.started_at);
  const startedDate = d.toLocaleDateString("en-GB", { timeZone: "Asia/Bangkok", day: "2-digit", month: "short" });
  const startedTime = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });

  const [liveMs, setLiveMs] = useState(() => Date.now() - new Date(stats.started_at).getTime());
  useEffect(() => {
    const id = setInterval(() => setLiveMs(Date.now() - new Date(stats.started_at).getTime()), 1000);
    return () => clearInterval(id);
  }, [stats.started_at]);

  return (
    <>
      <div className="stats-grid grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 mb-3">
        <div className="stat-card bg-bg-card border border-border rounded-lg py-5 px-4 transition-colors hover:border-border-accent">
          <div className="stat-val font-mono text-[32px] font-bold text-accent leading-none">{stats.total_requests}</div>
          <div className="text-xs text-text-muted mt-1.5 uppercase tracking-wide font-medium">Total Requests</div>
        </div>
        <div className="stat-card bg-bg-card border border-border rounded-lg py-5 px-4 transition-colors hover:border-border-accent">
          <div className="stat-val font-mono text-[32px] font-bold text-accent leading-none">{stats.avg_response_ms}ms</div>
          <div className="text-xs text-text-muted mt-1.5 uppercase tracking-wide font-medium">Avg Response Time</div>
        </div>
        <div className="stat-card bg-bg-card border border-border rounded-lg py-5 px-4 transition-colors hover:border-border-accent">
          <div className="stat-val font-mono text-[32px] font-bold text-accent leading-none">{fmtUptime(liveMs)}</div>
          <div className="text-xs text-text-muted mt-1.5 uppercase tracking-wide font-medium">Uptime</div>
        </div>
        <div className="stat-card bg-bg-card border border-border rounded-lg py-5 px-4 transition-colors hover:border-border-accent">
          <div className="stat-val font-mono text-[32px] font-bold text-accent leading-none">{startedTime}</div>
          <div className="text-xs text-text-muted mt-1.5 uppercase tracking-wide font-medium">Deployed {startedDate}</div>
        </div>
      </div>

      {stats.d1 && (() => {
        const storagePct = (stats.d1.db_size_bytes / stats.d1.limit_storage_bytes) * 100;
        const writesPct = (stats.d1.writes_today / stats.d1.limit_writes_day) * 100;
        return (
          <div className="mb-6 bg-bg-card border border-border rounded-lg px-4 py-3">
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2.5">D1 Quota</div>
            <div className="flex items-center gap-2.5 mb-1.5">
              <span className="w-13 text-xs text-text-muted shrink-0">Storage</span>
              <div className="quota-track flex-[0_0_140px] h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-accent shadow-[0_0_6px_var(--color-accent)] transition-[width] duration-400" style={{ width: `${Math.min(storagePct, 100)}%` }} />
              </div>
              <span className="font-mono text-[11px] text-text-muted whitespace-nowrap">
                {fmtBytes(stats.d1.db_size_bytes)} / 5 GB
                <span className="text-[10px] ml-1" style={{ color: quotaColor(storagePct) }}>
                  ({storagePct.toFixed(3)}%)
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="w-13 text-xs text-text-muted shrink-0">Writes</span>
              <div className="quota-track flex-[0_0_140px] h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-accent shadow-[0_0_6px_var(--color-accent)] transition-[width] duration-400" style={{ width: `${Math.min(writesPct, 100)}%` }} />
              </div>
              <span className="font-mono text-[11px] text-text-muted whitespace-nowrap">
                {stats.d1.writes_today.toLocaleString()} / 100k today
                <span className="text-[10px] ml-1" style={{ color: quotaColor(writesPct) }}>
                  ({writesPct.toFixed(2)}%)
                </span>
              </span>
            </div>
          </div>
        );
      })()}
    </>
  );
}
