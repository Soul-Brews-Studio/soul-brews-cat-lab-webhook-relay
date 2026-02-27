import { useMemo, useState } from "react";
import HitsTable from "./HitsTable";
import PollBadge from "./PollBadge";
import type { WebhookHit, Alias } from "../pages/Dashboard";
import { getDemoGroup } from "../demoData";

function extractEventTypes(hits: WebhookHit[]): string[] {
  const types = new Set<string>();
  for (const hit of hits) {
    if (!hit.body) continue;
    try {
      const parsed = JSON.parse(hit.body);
      const events = parsed?.events;
      if (Array.isArray(events)) {
        for (const ev of events) {
          if (ev?.type) types.add(ev.type);
        }
      }
    } catch {}
  }
  return [...types].sort();
}

function extractGroupId(hit: WebhookHit): string | null {
  if (!hit.body) return null;
  try {
    const parsed = JSON.parse(hit.body);
    return parsed?.events?.[0]?.source?.groupId ?? null;
  } catch { return null; }
}

function extractGroupIds(hits: WebhookHit[]): string[] {
  const ids = new Set<string>();
  for (const hit of hits) {
    const gid = extractGroupId(hit);
    if (gid) ids.add(gid);
  }
  return [...ids].sort();
}

function hitMatchesEventType(hit: WebhookHit, eventType: string): boolean {
  if (!hit.body) return false;
  try {
    const parsed = JSON.parse(hit.body);
    const events = parsed?.events;
    if (Array.isArray(events)) {
      return events.some((ev: any) => ev?.type === eventType);
    }
  } catch {}
  return false;
}

interface Props {
  hits: WebhookHit[];
  aliases: Alias[];
  loading: boolean;
  remaining: number;
  onPoll: () => void;
  onRefresh: () => void;
  onEndpointChange?: (ep: string) => void;
  endpoint?: string;
  exportUrl?: string;
  demoMode?: boolean;
}

export default function WebhookFeed({
  hits, aliases, loading, remaining, onPoll, onRefresh,
  onEndpointChange, endpoint = "", exportUrl, demoMode,
}: Props) {
  const [eventType, setEventType] = useState("");
  const [groupId, setGroupId] = useState("");

  const endpoints = useMemo(() => [...new Set(hits.map(h => h.endpoint))], [hits]);
  const eventTypes = useMemo(() => extractEventTypes(hits), [hits]);
  const groupIds = useMemo(() => extractGroupIds(hits), [hits]);

  const aliasMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of aliases) m.set(a.value, a.label);
    return m;
  }, [aliases]);

  const filteredHits = useMemo(() => {
    let h = hits;
    if (endpoint) h = h.filter(hit => hit.endpoint === endpoint);
    if (eventType) h = h.filter(hit => hitMatchesEventType(hit, eventType));
    if (groupId) h = h.filter(hit => extractGroupId(hit) === groupId);
    return h;
  }, [hits, endpoint, eventType, groupId]);

  const selectClass = "bg-bg-card border border-border text-text px-2.5 py-1.5 rounded-md text-[13px] font-mono cursor-pointer focus:outline-none focus:border-border-accent";

  return (
    <>
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-2xl font-bold text-accent leading-none">{filteredHits.length}</span>
          <span className="text-xs text-text-muted mt-1.5 uppercase tracking-wide font-medium">
            {eventType ? `${eventType} events` : "webhooks"}
            {filteredHits.length !== hits.length && (
              <span className="opacity-60"> / {hits.length} total</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onEndpointChange && (
            <select value={endpoint} onChange={(e) => onEndpointChange(e.target.value)} className={selectClass}>
              <option value="">All endpoints</option>
              {endpoints.map(ep => (
                <option key={ep} value={ep}>/w/{ep}</option>
              ))}
            </select>
          )}
          <select value={eventType} onChange={(e) => setEventType(e.target.value)} className={selectClass}>
            <option value="">All events</option>
            {eventTypes.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {groupIds.length > 0 && (
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={selectClass}>
              <option value="">All groups</option>
              {groupIds.map((gid, idx) => (
                <option key={gid} value={gid}>{demoMode ? getDemoGroup(idx) : (aliasMap.get(gid) || gid.slice(0, 8) + "...")}</option>
              ))}
            </select>
          )}
          {exportUrl && (
            <a href={exportUrl} target="_blank" rel="noreferrer" className="btn-sm border-border-accent text-accent font-mono text-[11px] no-underline hover:bg-accent-dim">
              Export JSON
            </a>
          )}
        </div>
        <PollBadge remaining={remaining} loading={loading} onClick={onPoll} />
      </div>

      <div className="card">
        <HitsTable hits={filteredHits} aliases={aliases} onRefresh={onRefresh} demoMode={demoMode} />
      </div>
    </>
  );
}
