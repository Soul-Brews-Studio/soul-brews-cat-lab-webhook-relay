import { useRef, useState } from "react";

export default function GenerateUrl() {
  const [url, setUrl] = useState<string | null>(null);
  const [hint, setHint] = useState("Click to copy");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = inputRef.current?.value.trim();
    if (!id) return;
    const res = await fetch(`/api/generate-url?id=${encodeURIComponent(id)}`);
    const data = await res.json();
    setUrl(data.url);
    setHint("Click to copy");
  };

  const copy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setHint("Copied!");
    setTimeout(() => setHint("Click to copy"), 1500);
  };

  return (
    <>
      <h2 className="text-lg font-semibold mb-3 text-text">Generate Webhook URL</h2>
      <form className="flex gap-2 mb-4" onSubmit={handleGenerate}>
        <input
          ref={inputRef}
          type="text"
          placeholder="endpoint-name"
          required
          className="flex-1 bg-bg border border-border text-text px-3 py-2 rounded-md text-sm font-mono transition-colors focus:outline-none focus:border-border-accent"
        />
        <button
          type="submit"
          className="bg-accent text-[#070a0f] border-none px-4 py-2 rounded-md text-sm font-semibold cursor-pointer whitespace-nowrap font-sans transition-opacity hover:opacity-85"
        >
          Generate
        </button>
      </form>
      {url && (
        <div
          className="bg-bg border border-border rounded-md px-4 py-3 font-mono text-[13px] break-all mb-2 cursor-pointer relative transition-colors hover:border-border-accent"
          onClick={copy}
        >
          {url}
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-[11px]">{hint}</span>
        </div>
      )}
    </>
  );
}
