import { useState, useCallback, useMemo } from "react";
import type { WebhookHit, Alias } from "../pages/Dashboard";
import { getDemoMessage, getDemoGroup, getDemoBody } from "../demoData";

function fmtAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ── Interactive JSON Tree ── */

function jqPath(segments: (string | number)[]): string {
  return segments.reduce<string>((acc, seg) => {
    if (typeof seg === "number") return `${acc}[${seg}]`;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(seg)) return `${acc}.${seg}`;
    return `${acc}["${seg}"]`;
  }, "");
}

interface JsonNodeProps {
  value: unknown;
  path: (string | number)[];
  onSelect: (path: string, value: unknown) => void;
  aliasMap: Map<string, string>;
  depth?: number;
}

function shouldCollapse(value: unknown, depth: number): boolean {
  if (depth <= 2) return false;
  if (Array.isArray(value)) return value.length > 5;
  if (typeof value === "object" && value !== null) return Object.keys(value).length > 5;
  return false;
}

function JsonNode({ value, path, onSelect, aliasMap, depth = 0 }: JsonNodeProps) {
  const [collapsed, setCollapsed] = useState(() => shouldCollapse(value, depth));

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(jqPath(path), value);
  }, [path, value, onSelect]);

  if (value === null) return <span className="jl clickable" onClick={handleClick}>null</span>;
  if (typeof value === "boolean") return <span className="jb clickable" onClick={handleClick}>{String(value)}</span>;
  if (typeof value === "number") return <span className="jn clickable" onClick={handleClick}>{value}</span>;
  if (typeof value === "string") {
    const alias = aliasMap.get(value);
    return (
      <span>
        <span className="js clickable" onClick={handleClick}>"{value}"</span>
        {alias && <span className="alias-tag">{alias}</span>}
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-text-muted text-[13px] clickable" onClick={handleClick}>[]</span>;
    if (collapsed) {
      return (
        <span>
          <span className="json-toggle" onClick={(e) => { e.stopPropagation(); setCollapsed(false); }}>▸ </span>
          <span className="text-text-muted text-[13px] clickable" onClick={handleClick}>[{value.length}]</span>
        </span>
      );
    }
    return (
      <span>
        <span className="json-toggle" onClick={(e) => { e.stopPropagation(); setCollapsed(true); }}>▾ </span>
        {"[\n"}
        {value.map((item, i) => (
          <span key={i}>
            {"  ".repeat(depth + 1)}
            <JsonNode value={item} path={[...path, i]} onSelect={onSelect} aliasMap={aliasMap} depth={depth + 1} />
            {i < value.length - 1 ? ",\n" : "\n"}
          </span>
        ))}
        {"  ".repeat(depth)}{"]"}
      </span>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-text-muted text-[13px] clickable" onClick={handleClick}>{"{}"}</span>;
    if (collapsed) {
      return (
        <span>
          <span className="json-toggle" onClick={(e) => { e.stopPropagation(); setCollapsed(false); }}>▸ </span>
          <span className="text-text-muted text-[13px] clickable" onClick={handleClick}>{"{"}{entries.length}{"}"}</span>
        </span>
      );
    }
    return (
      <span>
        <span className="json-toggle" onClick={(e) => { e.stopPropagation(); setCollapsed(true); }}>▾ </span>
        {"{\n"}
        {entries.map(([k, v], i) => (
          <span key={k}>
            {"  ".repeat(depth + 1)}
            <span className="jk clickable" onClick={(e) => { e.stopPropagation(); onSelect(jqPath([...path, k]), v); }}>"{k}"</span>
            {": "}
            <JsonNode value={v} path={[...path, k]} onSelect={onSelect} aliasMap={aliasMap} depth={depth + 1} />
            {i < entries.length - 1 ? ",\n" : "\n"}
          </span>
        ))}
        {"  ".repeat(depth)}{"}"}
      </span>
    );
  }

  return <span>{String(value)}</span>;
}

/* ── Payload Viewer with jq bar + alias ── */

interface PayloadViewerProps {
  body: string;
  forwardError?: string | null;
  aliasMap: Map<string, string>;
  onRefresh: () => void;
}

function PayloadViewer({ body, forwardError, aliasMap, onRefresh }: PayloadViewerProps) {
  const [selected, setSelected] = useState<{ path: string; value: unknown } | null>(null);
  const [copied, setCopied] = useState(false);
  const [aliasMode, setAliasMode] = useState(false);
  const [aliasLabel, setAliasLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  let parsed: unknown;
  let isJson = false;
  try {
    parsed = JSON.parse(body);
    isJson = true;
  } catch {
    parsed = null;
  }

  const handleSelect = useCallback((path: string, value: unknown) => {
    setSelected({ path: path || ".", value });
    setCopied(false);
    setAliasMode(false);
    setAliasLabel("");
  }, []);

  const handleCopyPath = useCallback(() => {
    if (!selected) return;
    navigator.clipboard.writeText(selected.path);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [selected]);

  const handleSaveAlias = useCallback(async () => {
    if (!selected || !aliasLabel || typeof selected.value !== "string") return;
    setSaving(true);
    await fetch("/api/aliases", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: selected.value, label: aliasLabel }),
    });
    setSaving(false);
    setAliasMode(false);
    setAliasLabel("");
    onRefresh();
  }, [selected, aliasLabel, onRefresh]);

  const canAlias = selected && typeof selected.value === "string" && selected.value.length > 0;
  const existingAlias = canAlias ? aliasMap.get(selected.value as string) : undefined;

  const jqBarContent = selected && (
    <div className="flex items-center gap-2 px-2.5 py-1.5 mb-1.5 bg-accent/[0.06] border border-border-accent rounded-md font-mono text-xs">
      <code className="text-accent font-semibold cursor-pointer whitespace-nowrap hover:underline" onClick={handleCopyPath} title="Click to copy">
        {selected.path}
      </code>
      <span className="text-text-muted overflow-hidden text-ellipsis whitespace-nowrap max-w-[400px]">
        {typeof selected.value === "string"
          ? `"${selected.value}"`
          : typeof selected.value === "object"
            ? Array.isArray(selected.value) ? `Array(${selected.value.length})` : `Object(${Object.keys(selected.value as object).length})`
            : String(selected.value)}
      </span>
      {existingAlias && <span className="alias-tag">{existingAlias}</span>}
      {copied && <span className="text-accent text-[11px] font-semibold">copied!</span>}
      {canAlias && !aliasMode && (
        <button
          className="btn-sm"
          onClick={() => { setAliasMode(true); setAliasLabel(existingAlias ?? ""); }}
        >
          {existingAlias ? "Edit" : "Alias"}
        </button>
      )}
      {aliasMode && (
        <span className="inline-flex items-center gap-1">
          <input
            className="bg-bg border border-border-accent text-text px-1.5 py-0.5 rounded text-xs font-mono w-[120px] focus:outline-none focus:border-accent"
            value={aliasLabel}
            onChange={(e) => setAliasLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSaveAlias()}
            placeholder="label..."
            autoFocus
          />
          <button className="btn-sm btn-active" onClick={handleSaveAlias} disabled={saving || !aliasLabel}>
            {saving ? "..." : "Save"}
          </button>
        </span>
      )}
      <button className="btn-sm ml-auto px-1 text-sm leading-none" onClick={() => setSelected(null)}>&times;</button>
    </div>
  );

  const jsonContent = isJson ? (
    <pre className="m-0 font-[inherit] text-[length:inherit] whitespace-pre-wrap break-all">
      <JsonNode value={parsed} path={[]} onSelect={handleSelect} aliasMap={aliasMap} />
    </pre>
  ) : (
    <pre className="m-0 font-[inherit] text-[length:inherit] whitespace-pre-wrap break-all">{body}</pre>
  );

  return (
    <>
      {jqBarContent}
      <div className="payload">
        {jsonContent}
        <button className="btn-sm absolute right-2 bottom-2 text-[10px] opacity-40 transition-opacity" onClick={() => setFullscreen(true)}>Fullscreen</button>
      </div>
      {forwardError && (
        <div className="bg-red/[0.08] border border-red/25 rounded-md px-3 py-2 text-xs text-red mt-2">Forward error: {forwardError}</div>
      )}
      {fullscreen && (
        <div className="fixed inset-0 bg-black/85 z-[200] flex items-center justify-center p-6" onClick={() => setFullscreen(false)}>
          <div className="bg-bg-card border border-border rounded-xl w-full max-w-[900px] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <span className="font-mono text-text-muted text-xs">Payload</span>
              <div className="flex-1" />
              <button className="btn-sm" onClick={() => { navigator.clipboard.writeText(isJson ? JSON.stringify(parsed, null, 2) : body); }}>
                Copy All
              </button>
              <button className="btn-sm px-1 text-sm leading-none" onClick={() => setFullscreen(false)}>&times;</button>
            </div>
            {selected && (
              <div className="flex items-center gap-2 px-2.5 py-1.5 mx-4 mt-2 bg-accent/[0.06] border border-border-accent rounded-md font-mono text-xs">
                <code className="text-accent font-semibold cursor-pointer whitespace-nowrap hover:underline" onClick={handleCopyPath} title="Click to copy">
                  {selected.path}
                </code>
                <span className="text-text-muted overflow-hidden text-ellipsis whitespace-nowrap max-w-[400px]">
                  {typeof selected.value === "string"
                    ? `"${selected.value}"`
                    : typeof selected.value === "object"
                      ? Array.isArray(selected.value) ? `Array(${selected.value.length})` : `Object(${Object.keys(selected.value as object).length})`
                      : String(selected.value)}
                </span>
                {existingAlias && <span className="alias-tag">{existingAlias}</span>}
                {copied && <span className="text-accent text-[11px] font-semibold">copied!</span>}
                <button className="btn-sm ml-auto px-1 text-sm leading-none" onClick={() => setSelected(null)}>&times;</button>
              </div>
            )}
            <div className="p-4 overflow-y-auto font-mono text-[13px] whitespace-pre-wrap break-all text-text flex-1">
              {jsonContent}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Group extraction ── */

function extractGroup(hit: WebhookHit, aliasMap: Map<string, string>): string | null {
  if (!hit.body) return null;
  try {
    const parsed = JSON.parse(hit.body);
    const gid = parsed?.events?.[0]?.source?.groupId;
    if (!gid) return null;
    return aliasMap.get(gid) ?? gid.slice(-8);
  } catch { return null; }
}

/* ── Message extraction ── */

function extractMessage(hit: WebhookHit): string | null {
  if (!hit.body) return null;
  try {
    const parsed = JSON.parse(hit.body);
    const msg = parsed?.events?.[0]?.message;
    if (!msg?.type) {
      const evType = parsed?.events?.[0]?.type;
      return evType ? `[${evType}]` : null;
    }
    if (msg.type === "text") return msg.text?.slice(0, 80) ?? null;
    if (msg.type === "file") return `[FILE] ${msg.fileName ?? "unknown"}`;
    if (msg.type === "image") {
      const s = msg.imageSet ? ` ${msg.imageSet.index}/${msg.imageSet.total}` : "";
      return `[IMAGE${s}]`;
    }
    if (msg.type === "sticker") {
      const kw = msg.keywords?.slice(0, 2).join(", ") ?? "";
      return `[STICKER${kw ? `: ${kw}` : ""}]`;
    }
    if (msg.type === "video") return "[VIDEO]";
    if (msg.type === "audio") return "[AUDIO]";
    if (msg.type === "location") return `[LOCATION] ${msg.title ?? ""}`;
    return `[${msg.type}]`;
  } catch { return null; }
}

/* ── Table ── */

interface Props {
  hits: WebhookHit[];
  aliases: Alias[];
  onRefresh: () => void;
  demoMode?: boolean;
}

export default function HitsTable({ hits, aliases, onRefresh, demoMode }: Props) {
  const [openSet, setOpenSet] = useState<Set<number>>(new Set());

  const aliasMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of aliases) m.set(a.value, a.label);
    return m;
  }, [aliases]);

  const toggle = (i: number) => {
    setOpenSet((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  if (hits.length === 0) {
    return <div className="text-center py-8 text-text-muted"><p>No webhooks received yet.</p></div>;
  }

  const now = Date.now();
  const hasForward = hits.some(h => h.forward_status != null);

  return (
    <table className="table-fixed">
      <thead>
        <tr>
          <th className="w-[140px]">Time</th>
          <th className="w-[140px]">Group</th>
          <th>Message</th>
          <th className="w-[70px]">Size</th>
          {hasForward && <th className="w-[50px]">Fwd</th>}
        </tr>
      </thead>
      <tbody>
        {hits.map((hit, i) => {
          const age = now - new Date(hit.received_at).getTime();
          const isNew = age < 30000;
          const isOpen = openSet.has(i);
          const colCount = 4 + (hasForward ? 1 : 0);

          return (
            <>
              <tr
                key={hit.received_at + i}
                className={`cursor-pointer hover:[&>td]:bg-white/[0.02] ${isNew ? "new-hit" : ""}`}
                onClick={() => toggle(i)}
              >
                <td className="font-mono text-text-muted whitespace-nowrap text-xs overflow-hidden text-ellipsis">
                  <span className="inline-block w-3.5 opacity-40 text-[10px]">{isOpen ? "▼" : "▶"}</span>
                  {new Date(hit.received_at).toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" })}
                  <span className="opacity-40 ml-1">{fmtAgo(age)}</span>
                </td>
                <td className="text-xs whitespace-nowrap overflow-hidden text-ellipsis">
                  {(() => {
                    if (demoMode) return <span>{getDemoGroup(i)}</span>;
                    const g = extractGroup(hit, aliasMap);
                    return g ? <span>{g}</span> : <span className="opacity-20">--</span>;
                  })()}
                </td>
                <td className="text-[13px] max-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {(() => {
                    const m = demoMode ? getDemoMessage(i) : extractMessage(hit);
                    return m ? (
                      m.startsWith("[") ? <span className="text-text-muted text-[13px]">{m}</span> : m
                    ) : <span className="opacity-20">--</span>;
                  })()}
                </td>
                <td className="font-mono text-text-muted text-[11px] whitespace-nowrap overflow-hidden text-ellipsis">{hit.body_length.toLocaleString()}b</td>
                {hasForward && (
                  <td className="font-mono text-[11px] whitespace-nowrap">
                    {hit.forward_status == null ? (
                      <span className="opacity-20">--</span>
                    ) : hit.forward_status === 0 ? (
                      <span className="text-red" title={hit.forward_error ?? "Fetch error"}>ERR</span>
                    ) : hit.forward_status >= 200 && hit.forward_status < 300 ? (
                      <span className="text-green">{hit.forward_status}</span>
                    ) : (
                      <span className="text-red">{hit.forward_status}</span>
                    )}
                  </td>
                )}
              </tr>
              {isOpen && hit.body && (
                <tr key={`payload-${i}`}>
                  <td colSpan={colCount} className="px-3 pb-3 border-b border-border">
                    <PayloadViewer body={demoMode ? getDemoBody(i, hit.body) : hit.body} forwardError={hit.forward_error} aliasMap={demoMode ? new Map() : aliasMap} onRefresh={onRefresh} />
                  </td>
                </tr>
              )}
            </>
          );
        })}
      </tbody>
    </table>
  );
}
