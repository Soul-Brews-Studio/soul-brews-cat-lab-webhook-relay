import { useCallback, useEffect, useRef, useState } from "react";
import Nav from "../components/Nav";
import StatsGrid from "../components/StatsGrid";
import GenerateUrl from "../components/GenerateUrl";
import ForwardConfig from "../components/ForwardConfig";
import WebhookFeed from "../components/WebhookFeed";

export interface ForwardRule {
  endpoint: string;
  forward_url: string;
  enabled: boolean;
  persist: boolean;
  created_at: string;
  updated_at: string;
}

export interface Alias {
  id: number;
  value: string;
  label: string;
  created_at: string;
}

interface StatsData {
  started_at: string;
  uptime_ms: number;
  total_requests: number;
  avg_response_ms: number;
  oldest_hit_at: string | null;
  recent: WebhookHit[];
  forward_rules?: ForwardRule[];
  aliases?: Alias[];
  d1?: {
    db_size_bytes: number;
    writes_today: number;
    limit_storage_bytes: number;
    limit_writes_day: number;
  };
}

export interface WebhookHit {
  id: number;
  endpoint: string;
  suffix?: string | null;
  received_at: string;
  response_ms: number;
  body_length: number;
  body?: string | null;
  forward_status?: number | null;
  forward_ms?: number | null;
  forward_error?: string | null;
}

interface Props {
  onLogout: () => void;
  demoMode: boolean;
  onToggleDemo: () => void;
}

const POLL_INTERVAL = 5;

export default function Dashboard({ onLogout, demoMode, onToggleDemo }: Props) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [remaining, setRemaining] = useState(POLL_INTERVAL);
  const [loading, setLoading] = useState(false);
  const [endpoint, setEndpoint] = useState("line");
  const lastCount = useRef(0);

  const poll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stats");
      if (res.status === 401) { onLogout(); return; }
      const data: StatsData = await res.json();
      setStats(data);

      if (data.total_requests > lastCount.current) {
        const n = data.total_requests - lastCount.current;
        document.title = `(${n} new) Status - Webhook Relay`;
        setTimeout(() => { document.title = "Status - Webhook Relay"; }, 3000);
      }
      lastCount.current = data.total_requests;
    } catch {}
    setLoading(false);
    setRemaining(POLL_INTERVAL);
  }, [onLogout]);

  useEffect(() => { poll(); }, [poll]);

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { poll(); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [poll]);

  const handleLogout = async () => {
    await fetch("/auth/logout", { redirect: "manual" });
    onLogout();
  };

  return (
    <>
      <Nav loggedIn={true} onLogout={handleLogout} demoMode={demoMode} onToggleDemo={onToggleDemo} />
      <div className="max-w-[960px] mx-auto px-6">
        <h1 className="text-2xl font-semibold mb-4">Status</h1>

        {stats && <StatsGrid stats={stats} />}

        <div className="card mb-6">
          <GenerateUrl />
        </div>

        <div className="card mb-6">
          <ForwardConfig
            rules={stats?.forward_rules ?? []}
            knownEndpoints={[...new Set(stats?.recent?.map((h) => h.endpoint) ?? [])]}
            onRefresh={poll}
          />
        </div>

        <h2 className="text-lg font-semibold mb-3 text-text">Recent Webhooks</h2>
        <WebhookFeed
          hits={stats?.recent ?? []}
          aliases={stats?.aliases ?? []}
          loading={loading}
          remaining={remaining}
          onPoll={() => { setRemaining(0); poll(); }}
          onRefresh={poll}
          endpoint={endpoint}
          onEndpointChange={setEndpoint}
          demoMode={demoMode}
        />
      </div>

      <div className="text-center py-6 text-white/[0.12] text-xs font-mono">
        v{__APP_VERSION__} · deployed {__DEPLOY_TIME__}
      </div>
    </>
  );
}

declare const __APP_VERSION__: string;
declare const __DEPLOY_TIME__: string;
