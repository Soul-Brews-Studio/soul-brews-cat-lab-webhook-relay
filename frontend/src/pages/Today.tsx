import { useCallback, useEffect, useState } from "react";
import Nav from "../components/Nav";
import WebhookFeed from "../components/WebhookFeed";
import type { WebhookHit, Alias } from "./Dashboard";

interface HitsResponse {
  date: string;
  from: string;
  to: string;
  count: number;
  hits: WebhookHit[];
}

interface Props {
  onLogout: () => void;
  demoMode: boolean;
  onToggleDemo: () => void;
}

const POLL_INTERVAL = 10;

function fmtDateGmt7(): string {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

export default function Today({ onLogout, demoMode, onToggleDemo }: Props) {
  const [hits, setHits] = useState<WebhookHit[]>([]);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [remaining, setRemaining] = useState(POLL_INTERVAL);
  const [loading, setLoading] = useState(false);
  const [endpoint, setEndpoint] = useState("");

  const poll = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date: "today" });
      if (endpoint) params.set("endpoint", endpoint);
      const [hitsRes, aliasRes] = await Promise.all([
        fetch(`/api/hits?${params}`),
        fetch("/api/aliases"),
      ]);
      if (hitsRes.status === 401) { onLogout(); return; }
      const json: HitsResponse = await hitsRes.json();
      setHits(json.hits);
      if (aliasRes.ok) setAliases(await aliasRes.json());
    } catch {}
    setLoading(false);
    setRemaining(POLL_INTERVAL);
  }, [onLogout, endpoint]);

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

  const today = fmtDateGmt7();

  return (
    <>
      <Nav loggedIn={true} onLogout={handleLogout} demoMode={demoMode} onToggleDemo={onToggleDemo} />
      <div className="max-w-[960px] mx-auto px-6">
        <h1 className="text-2xl font-semibold mb-4">
          Today
          <span className="text-text-muted text-sm ml-2 font-normal">
            {today} GMT+7
          </span>
        </h1>

        <WebhookFeed
          hits={hits}
          aliases={aliases}
          loading={loading}
          remaining={remaining}
          onPoll={() => { setRemaining(0); poll(); }}
          onRefresh={poll}
          endpoint={endpoint}
          onEndpointChange={setEndpoint}
          exportUrl={`/api/hits?date=today${endpoint ? `&endpoint=${encodeURIComponent(endpoint)}` : ""}`}
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
