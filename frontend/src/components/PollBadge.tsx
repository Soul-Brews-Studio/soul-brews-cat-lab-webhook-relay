interface Props {
  remaining: number;
  loading: boolean;
  onClick: () => void;
}

export default function PollBadge({ remaining, loading, onClick }: Props) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-text-muted ml-3 cursor-pointer select-none px-2 py-0.5 rounded transition-colors hover:bg-white/[0.04] hover:text-text"
      onClick={onClick}
    >
      <span className={`inline-block w-2 h-2 bg-accent rounded-full ${loading ? "animate-spin-dot" : "animate-pulse-glow"}`} />
      <span className="min-w-4 text-center tabular-nums">{loading ? "..." : remaining}</span>
    </span>
  );
}
