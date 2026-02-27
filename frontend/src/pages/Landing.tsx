import { useState } from "react";
import Nav from "../components/Nav";

interface Props {
  onLogin: () => void;
}

export default function Landing({ onLogin }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const origin = window.location.origin;

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const res = await fetch("/auth/login", { method: "POST", body: data, redirect: "manual" });
    if (res.type === "opaqueredirect" || res.status === 302 || res.ok) {
      setShowModal(false);
      onLogin();
    } else {
      setError("Invalid credentials. Please try again.");
    }
  };

  return (
    <>
      <Nav loggedIn={false} onLoginClick={() => setShowModal(true)} />

      <div
        className={`fixed inset-0 bg-black/70 z-[100] items-center justify-center ${showModal ? "flex" : "hidden"}`}
        onClick={() => setShowModal(false)}
      >
        <div className="bg-bg-card border border-border rounded-xl p-6 w-[380px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
          <h2 className="text-lg font-semibold mb-2 text-text">Login</h2>
          <p className="text-[13px] text-text-muted mb-4">Enter your credentials to access the dashboard.</p>
          {error && <div className="text-red text-[13px] mb-3">{error}</div>}
          <form onSubmit={handleLogin}>
            <input
              type="text"
              name="username"
              placeholder="Username"
              autoComplete="username"
              autoFocus
              className="w-full bg-bg border border-border text-text px-3 py-2.5 rounded-md text-sm font-mono mb-3 block transition-colors focus:outline-none focus:border-border-accent"
            />
            <input
              type="password"
              name="password"
              placeholder="Password"
              autoComplete="current-password"
              className="w-full bg-bg border border-border text-text px-3 py-2.5 rounded-md text-sm font-mono mb-3 block transition-colors focus:outline-none focus:border-border-accent"
            />
            <button
              type="submit"
              className="w-full bg-accent text-[#070a0f] border-none px-5 py-2.5 rounded-md text-sm font-semibold cursor-pointer font-sans transition-opacity hover:opacity-85"
            >
              Login
            </button>
          </form>
        </div>
      </div>

      <div className="max-w-[720px] mx-auto px-6 py-12">
        <h1 className="text-2xl font-semibold mb-4">Webhook Relay</h1>
        <p className="text-text-muted text-[13px]">Discord-style webhook URLs. The URL is the auth.</p>

        <div className="bg-bg-card border border-border rounded-lg p-5 mt-5">
          <h2 className="text-lg font-semibold mb-3 text-text">Usage</h2>
          <pre className="bg-bg border border-border rounded-md p-4 overflow-x-auto text-[13px] font-mono mt-3"><code>{`POST ${origin}/w/{id}/{token}`}</code></pre>
          <p className="text-text-muted text-[13px] mt-3">
            Webhook URLs are generated on the dashboard. The URL is the auth.
          </p>
        </div>

        <div className="mt-8 flex gap-4 flex-wrap">
          <a href="/openapi" className="bg-bg-card border border-border rounded-lg px-5 py-3 text-sm text-accent no-underline transition-colors hover:border-border-accent">API Docs</a>
        </div>
      </div>
    </>
  );
}
