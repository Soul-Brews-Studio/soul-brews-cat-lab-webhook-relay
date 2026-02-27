import { useEffect, useState } from "react";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Today from "./pages/Today";
import Aliases from "./pages/Aliases";
import About from "./pages/About";

type AuthState = "loading" | "guest" | "authed";

export default function App() {
  const [auth, setAuth] = useState<AuthState>("loading");
  const [demoMode, setDemoMode] = useState(false);
  const toggleDemo = () => setDemoMode(d => !d);

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/me");
      const data = await res.json();
      setAuth(data.loggedIn ? "authed" : "guest");
    } catch {
      setAuth("guest");
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  if (auth === "loading") {
    return <div className="flex items-center justify-center h-screen text-text-muted text-sm">Loading...</div>;
  }

  const path = window.location.pathname;

  if (path === "/about") {
    const loggedIn = auth === "authed";
    return (
      <About
        loggedIn={loggedIn}
        onLoginClick={() => { window.location.href = "/"; }}
        onLogout={async () => {
          await fetch("/auth/logout", { redirect: "manual" });
          setAuth("guest");
        }}
      />
    );
  }

  if (auth === "guest") {
    return <Landing onLogin={checkAuth} />;
  }

  if (path === "/today") {
    return <Today onLogout={() => setAuth("guest")} demoMode={demoMode} onToggleDemo={toggleDemo} />;
  }

  if (path === "/aliases") {
    return <Aliases onLogout={() => setAuth("guest")} demoMode={demoMode} onToggleDemo={toggleDemo} />;
  }

  return <Dashboard onLogout={() => setAuth("guest")} demoMode={demoMode} onToggleDemo={toggleDemo} />;
}
