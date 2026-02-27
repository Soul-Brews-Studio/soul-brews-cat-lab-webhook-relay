interface Props {
  loggedIn: boolean;
  onLoginClick?: () => void;
  onLogout?: () => void;
  demoMode?: boolean;
  onToggleDemo?: () => void;
}

const PersonIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
    <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z" />
  </svg>
);

function NavLink({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  const active = window.location.pathname === href;
  return (
    <a
      href={href}
      className={`no-underline text-sm cursor-pointer transition-colors hover:text-accent ${active ? "text-accent font-medium" : "text-text-muted"} ${className}`}
    >
      {children}
    </a>
  );
}

export default function Nav({ loggedIn, onLoginClick, onLogout, demoMode, onToggleDemo }: Props) {
  return (
    <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-6 py-3 sm:py-4">
      <strong className="font-mono text-base font-bold text-text transition-colors hover:text-accent cursor-pointer">
        <a href="/" className="no-underline text-inherit">Webhook Relay</a>
      </strong>
      <NavLink href="/">Home</NavLink>
      <NavLink href="/today">Today</NavLink>
      <NavLink href="/aliases">Aliases</NavLink>
      <a href="/openapi" target="_blank" rel="noreferrer" className="no-underline text-sm cursor-pointer text-text-muted transition-colors hover:text-accent hidden sm:inline">API Docs</a>
      <NavLink href="/about" className="hidden sm:inline">About</NavLink>
      <div className="flex-1 min-w-0" />
      {loggedIn && onToggleDemo && (
        <button
          className={`btn-sm mr-1 ${demoMode ? "btn-active" : ""}`}
          onClick={onToggleDemo}
        >
          {demoMode ? "Demo ON" : "Demo"}
        </button>
      )}
      {loggedIn ? (
        <button
          className="flex items-center gap-1.5 bg-transparent border border-accent/20 text-accent px-3 py-1.5 rounded-md text-[13px] cursor-pointer font-sans no-underline transition-colors hover:border-border-accent shrink-0"
          onClick={onLogout}
        >
          <PersonIcon /> Logout
        </button>
      ) : (
        <button
          className="flex items-center gap-1.5 bg-transparent border border-border text-text-muted px-3 py-1.5 rounded-md text-[13px] cursor-pointer font-sans no-underline transition-colors hover:border-border-accent hover:text-accent shrink-0"
          onClick={onLoginClick}
        >
          <PersonIcon /> Login
        </button>
      )}
    </nav>
  );
}
