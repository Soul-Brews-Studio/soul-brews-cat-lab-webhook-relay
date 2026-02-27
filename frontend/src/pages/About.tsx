import { useEffect, useState } from "react";
import Nav from "../components/Nav";

interface Props {
  loggedIn: boolean;
  onLoginClick?: () => void;
  onLogout?: () => void;
}

function fmtAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export default function About({ loggedIn, onLoginClick, onLogout }: Props) {
  const [oldestAt, setOldestAt] = useState<string | null>(null);
  const [totalRequests, setTotalRequests] = useState<number | null>(null);
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!loggedIn) return;
    fetch("/api/stats").then(r => r.json()).then(data => {
      setOldestAt(data.oldest_hit_at ?? null);
      setTotalRequests(data.total_requests ?? 0);
    }).catch(() => {});
  }, [loggedIn]);

  const handlePurge = async () => {
    if (!window.confirm("Delete all webhook hits older than 7 days?")) return;
    try {
      const res = await fetch("/api/purge", { method: "POST" });
      const data = await res.json();
      setPurgeMsg(`Deleted ${data.deleted} records`);
      const statsRes = await fetch("/api/stats");
      const stats = await statsRes.json();
      setOldestAt(stats.oldest_hit_at ?? null);
      setTotalRequests(stats.total_requests ?? 0);
    } catch {}
  };

  return (
    <>
      <Nav loggedIn={loggedIn} onLoginClick={onLoginClick} onLogout={onLogout} />

      <div className="max-w-[720px] mx-auto px-6 py-12">
        <h1 className="text-2xl font-semibold mb-4">About</h1>

        <div className="bg-bg-card border border-border rounded-lg p-5 mt-5">
          <h2 className="text-lg font-semibold mb-3 text-text">Webhook Relay</h2>
          <p className="text-text-muted text-[13px] mt-2">
            A lightweight webhook receiver built on Cloudflare Workers + D1.
            Generate unique URLs, receive POST requests, and inspect payloads in real-time.
          </p>

          <h2 className="text-lg font-semibold mb-3 text-text mt-5">How it works</h2>
          <ol className="text-text-muted text-[13px] pl-5 leading-8">
            <li>Generate a webhook URL from the dashboard</li>
            <li>Send POST requests to the URL from any service</li>
            <li>View incoming requests, payloads, and response times live</li>
          </ol>

          <h2 className="text-lg font-semibold mb-3 text-text mt-5">Stack</h2>
          <p className="text-text-muted text-[13px] mt-2">
            Cloudflare Workers (edge compute) + D1 (SQLite) + Drizzle ORM + React + Vite.
            Zero cold start. Runs at the edge, close to your services.
          </p>
        </div>

        {loggedIn && (
          <div className="bg-bg-card border border-border rounded-lg p-5 mt-4">
            <h2 className="text-lg font-semibold mb-3 text-text">Data Management</h2>
            <p className="text-text-muted text-[13px] mt-2">
              {totalRequests != null && <>
                {totalRequests.toLocaleString()} total records
                {oldestAt && <> · oldest: {fmtAge(oldestAt)}</>}
              </>}
            </p>
            <div className="mt-3">
              <button
                className="bg-transparent border border-red text-red px-3.5 py-1.5 rounded-md text-[13px] cursor-pointer font-sans transition-colors hover:bg-red hover:text-[#070a0f]"
                onClick={handlePurge}
              >
                Purge data older than 7 days
              </button>
              {purgeMsg && <span className="text-text-muted text-[13px] ml-3">{purgeMsg}</span>}
            </div>
          </div>
        )}

        <div className="text-center py-6 text-white/[0.12] text-xs font-mono">
          v{__APP_VERSION__} · deployed {__DEPLOY_TIME__}
        </div>
      </div>
    </>
  );
}

declare const __APP_VERSION__: string;
declare const __DEPLOY_TIME__: string;
