import { useEffect, useMemo, useState } from "react";
import Nav from "../components/Nav";

interface Alias {
  id: number;
  value: string;
  label: string;
  created_at: string;
}

interface UnknownId {
  id: string;
  type: "group" | "user" | "other";
  count: number;
  last_seen: string;
  seen_in_groups: string[];
}

const TYPE_ORDER: Record<string, number> = { Group: 0, User: 1, Room: 2, Message: 3, Custom: 4 };

function idType(value: string): string {
  if (/^U[0-9a-f]{32}$/.test(value)) return "User";
  if (/^C[0-9a-f]{32}$/.test(value)) return "Group";
  if (/^R[0-9a-f]{32}$/.test(value)) return "Room";
  if (/^\d{15,}$/.test(value)) return "Message";
  return "Custom";
}

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Aliases({ onLogout, demoMode, onToggleDemo }: { onLogout: () => void; demoMode: boolean; onToggleDemo: () => void }) {
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [unknown, setUnknown] = useState<UnknownId[]>([]);
  const [loading, setLoading] = useState(true);
  const [newValue, setNewValue] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState<Set<string>>(new Set());

  const fetchAll = async () => {
    try {
      const [aliasRes, unknownRes] = await Promise.all([
        fetch("/api/aliases"),
        fetch("/api/aliases/unknown"),
      ]);
      if (aliasRes.ok) setAliases(await aliasRes.json());
      if (unknownRes.ok) setUnknown(await unknownRes.json());
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const addAlias = async () => {
    if (!newValue.trim() || !newLabel.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/aliases", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: newValue.trim(), label: newLabel.trim() }),
      });
      setNewValue("");
      setNewLabel("");
      await fetchAll();
    } finally {
      setSaving(false);
    }
  };

  const deleteAlias = async (id: number) => {
    await fetch(`/api/aliases/${id}`, { method: "DELETE" });
    await fetchAll();
  };

  const resolveId = async (item: UnknownId) => {
    setResolving(prev => new Set(prev).add(item.id));
    try {
      const res = await fetch("/api/aliases/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      if (res.ok) {
        await fetchAll();
      } else {
        setNewValue(item.id);
        setNewLabel("");
      }
    } finally {
      setResolving(prev => { const s = new Set(prev); s.delete(item.id); return s; });
    }
  };

  const resolveAll = async () => {
    for (const item of unknown) {
      await resolveId(item);
    }
  };

  const sorted = useMemo(() =>
    [...aliases].sort((a, b) => {
      const ta = TYPE_ORDER[idType(a.value)] ?? 9;
      const tb = TYPE_ORDER[idType(b.value)] ?? 9;
      if (ta !== tb) return ta - tb;
      return a.label.localeCompare(b.label);
    }),
    [aliases],
  );

  const inputClass = "px-3 py-2 border border-border bg-bg text-text rounded-md flex-1 text-sm font-mono transition-colors focus:outline-none focus:border-border-accent";

  return (
    <div>
      <Nav loggedIn onLogout={onLogout} demoMode={demoMode} onToggleDemo={onToggleDemo} />
      <div className="max-w-[960px] mx-auto px-6">
        <h2 className="text-lg font-semibold mb-3 text-text">Aliases</h2>
        <p className="text-text-muted -mt-2 mb-4">Map raw IDs to human-readable names</p>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Value (user ID, group ID, etc.)"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            className={inputClass}
          />
          <input
            type="text"
            placeholder="Label (human name)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addAlias()}
            className={inputClass}
          />
          <button
            onClick={addAlias}
            disabled={saving}
            className="px-4 py-2 bg-accent text-[#070a0f] border-none rounded-md cursor-pointer text-sm font-semibold font-sans transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {saving ? "..." : "Add"}
          </button>
        </div>

        {unknown.length > 0 && (
          <div className="card mb-6 border-yellow/25">
            <div className="flex justify-between items-center mb-2">
              <h3 className="flex items-center gap-2">
                Unknown IDs
                <span className="bg-yellow/15 text-[#fbbf24] text-xs px-2 py-0.5 rounded-full font-semibold">{unknown.length}</span>
              </h3>
              <button
                className="bg-accent text-[#070a0f] border-none rounded px-3.5 py-1.5 text-xs font-semibold cursor-pointer transition-opacity hover:opacity-85"
                onClick={resolveAll}
              >
                Resolve All
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>ID</th>
                  <th>Msgs</th>
                  <th>Last Seen</th>
                  <th>Groups</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {unknown.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className={`badge badge-${u.type}`}>
                        {u.type === "group" ? "Group" : u.type === "user" ? "User" : "Other"}
                      </span>
                    </td>
                    <td className="font-mono text-[13px] cursor-pointer" title={u.id}
                      onClick={() => { setNewValue(u.id); setNewLabel(""); }}>
                      {u.id.slice(0, 8)}...{u.id.slice(-4)}
                    </td>
                    <td className="font-mono text-[13px]">{u.count}</td>
                    <td className="text-text-muted text-[13px]">{fmtAgo(u.last_seen)}</td>
                    <td className="text-text-muted text-xs">
                      {u.seen_in_groups.length > 0 ? u.seen_in_groups.join(", ") : "--"}
                    </td>
                    <td>
                      <button
                        className="bg-transparent border border-accent text-accent rounded px-3 py-1 text-xs font-semibold cursor-pointer transition-colors hover:bg-accent hover:text-[#070a0f] disabled:opacity-50 disabled:cursor-wait"
                        onClick={() => resolveId(u)}
                        disabled={resolving.has(u.id)}
                      >
                        {resolving.has(u.id) ? "..." : "Resolve"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="card">
          <h3 className="text-base font-semibold">Known Aliases <span className="text-text-muted font-normal text-sm">({aliases.length})</span></h3>
          {loading ? (
            <p>Loading...</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Label</th>
                  <th>Value</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((a: Alias) => (
                  <tr key={a.id}>
                    <td>
                      <span className={`badge badge-${idType(a.value).toLowerCase()}`}>
                        {idType(a.value)}
                      </span>
                    </td>
                    <td><strong>{a.label}</strong></td>
                    <td className="font-mono text-[13px]" title={a.value}>
                      {a.value.length > 16 ? a.value.slice(0, 8) + "..." + a.value.slice(-4) : a.value}
                    </td>
                    <td className="text-text-muted text-[13px]">
                      {new Date(a.created_at).toLocaleDateString()}
                    </td>
                    <td>
                      <button
                        className="bg-transparent border border-border text-text-muted rounded px-2 py-0.5 text-xs cursor-pointer transition-colors hover:border-red hover:text-red"
                        onClick={() => deleteAlias(a.id)}
                      >
                        x
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
