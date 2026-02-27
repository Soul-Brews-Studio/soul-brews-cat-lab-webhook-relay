import { useState } from "react";
import type { ForwardRule } from "../pages/Dashboard";

interface Props {
  rules: ForwardRule[];
  knownEndpoints: string[];
  onRefresh: () => void;
}

export default function ForwardConfig({ rules, knownEndpoints, onRefresh }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [forwardUrl, setForwardUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const configuredSet = new Set(rules.map((r) => r.endpoint));
  const suggestions = knownEndpoints.filter((ep) => !configuredSet.has(ep));

  const handleSave = async () => {
    if (!endpoint || !forwardUrl) return;
    setSaving(true);
    await fetch(`/api/forward-rules/${encodeURIComponent(endpoint)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ forward_url: forwardUrl }),
    });
    setEndpoint("");
    setForwardUrl("");
    setShowAdd(false);
    setSaving(false);
    onRefresh();
  };

  const handleDelete = async (ep: string) => {
    await fetch(`/api/forward-rules/${encodeURIComponent(ep)}`, { method: "DELETE" });
    onRefresh();
  };

  const handleToggle = async (rule: ForwardRule) => {
    await fetch(`/api/forward-rules/${encodeURIComponent(rule.endpoint)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ forward_url: rule.forward_url, enabled: !rule.enabled, persist: rule.persist }),
    });
    onRefresh();
  };

  const handleTogglePersist = async (rule: ForwardRule) => {
    await fetch(`/api/forward-rules/${encodeURIComponent(rule.endpoint)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ forward_url: rule.forward_url, enabled: rule.enabled, persist: !rule.persist }),
    });
    onRefresh();
  };

  const handlePickEndpoint = (ep: string) => {
    setEndpoint(ep);
    if (!showAdd) setShowAdd(true);
  };

  return (
    <>
      <h2 className="text-lg font-semibold mb-3 text-text">Forwarding Rules</h2>
      {rules.length === 0 && !showAdd && (
        <p className="text-text-muted text-[13px] mb-2">No forwarding rules configured.</p>
      )}
      {rules.map((rule) => (
        <div key={rule.endpoint} className="py-2.5 border-b border-border last:border-b-0">
          <div className="mb-1.5">
            <span className="font-mono text-[13px]">/w/{rule.endpoint}</span>
            <span className="text-text-muted text-[13px]"> &rarr; </span>
            <span className="font-mono text-xs break-all">{rule.forward_url}</span>
          </div>
          <div className="flex gap-1.5">
            <button
              className={`btn-sm ${rule.enabled ? "btn-active" : ""}`}
              onClick={() => handleToggle(rule)}
              title="Forward webhooks to URL"
            >
              FWD {rule.enabled ? "ON" : "OFF"}
            </button>
            <button
              className={`btn-sm ${rule.persist ? "btn-active" : ""}`}
              onClick={() => handleTogglePersist(rule)}
              title="Save webhooks to database"
            >
              SAVE {rule.persist ? "ON" : "OFF"}
            </button>
            <button className="btn-sm btn-danger-sm" onClick={() => handleDelete(rule.endpoint)}>
              Delete
            </button>
          </div>
        </div>
      ))}

      {showAdd ? (
        <div className="mt-3 flex flex-col gap-2">
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="endpoint name"
            list="endpoint-suggestions"
            autoFocus
            className="bg-bg border border-border text-text px-3 py-2 rounded-md text-sm font-mono transition-colors focus:outline-none focus:border-border-accent"
          />
          <datalist id="endpoint-suggestions">
            {suggestions.map((ep) => (
              <option key={ep} value={ep} />
            ))}
          </datalist>
          <input
            value={forwardUrl}
            onChange={(e) => setForwardUrl(e.target.value)}
            placeholder="https://example.com/webhook"
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="bg-bg border border-border text-text px-3 py-2 rounded-md text-sm font-mono transition-colors focus:outline-none focus:border-border-accent"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-accent text-[#070a0f] border-none px-4 py-2 rounded-md text-sm font-semibold cursor-pointer font-sans"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button className="btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 mt-2 flex-wrap items-center">
          <button className="btn-sm" onClick={() => setShowAdd(true)}>
            + Add rule
          </button>
          {suggestions.map((ep) => (
            <button
              key={ep}
              className="btn-sm btn-suggest"
              onClick={() => handlePickEndpoint(ep)}
            >
              /w/{ep}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
