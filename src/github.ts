/**
 * Parse GitHub webhook events into human-readable summaries.
 */
export function parseGitHubEvent(event: string, payload: any): string {
  const repo = payload.repository?.full_name ?? payload.organization?.login ?? "unknown";

  switch (event) {
    case "push": {
      const branch = (payload.ref ?? "").replace("refs/heads/", "");
      const commits = payload.commits ?? [];
      const who = payload.pusher?.name ?? "someone";
      const lines = [`[${repo}] ${who} pushed ${commits.length} commit(s) to ${branch}`];
      for (const c of commits.slice(0, 5)) {
        lines.push(`  - ${c.message?.split("\n")[0] ?? "(no message)"}`);
      }
      if (commits.length > 5) lines.push(`  ... and ${commits.length - 5} more`);
      return lines.join("\n");
    }

    case "pull_request": {
      const pr = payload.pull_request ?? {};
      const action = payload.action ?? "updated";
      const who = pr.user?.login ?? payload.sender?.login ?? "someone";
      return `[${repo}] ${who} ${action} PR #${pr.number}: ${pr.title}`;
    }

    case "issues": {
      const issue = payload.issue ?? {};
      const action = payload.action ?? "updated";
      const who = issue.user?.login ?? payload.sender?.login ?? "someone";
      return `[${repo}] ${who} ${action} issue #${issue.number}: ${issue.title}`;
    }

    case "issue_comment": {
      const issue = payload.issue ?? {};
      const comment = payload.comment ?? {};
      const who = comment.user?.login ?? payload.sender?.login ?? "someone";
      const excerpt = (comment.body ?? "").slice(0, 120);
      return `[${repo}] ${who} commented on #${issue.number}: ${excerpt}`;
    }

    case "star": {
      const action = payload.action ?? "created";
      const who = payload.sender?.login ?? "someone";
      if (action === "created") return `[${repo}] ${who} starred the repo`;
      return `[${repo}] ${who} unstarred the repo`;
    }

    case "release": {
      const release = payload.release ?? {};
      const action = payload.action ?? "published";
      const who = release.author?.login ?? payload.sender?.login ?? "someone";
      const tag = release.tag_name ?? "unknown";
      return `[${repo}] ${who} ${action} release ${tag}`;
    }

    case "ping": {
      const hook = payload.hook ?? {};
      const events = hook.events ?? [];
      return `Webhook configured for ${repo} (events: [${events.join(", ")}])`;
    }

    case "create": {
      const refType = payload.ref_type ?? "branch";
      const ref = payload.ref ?? "unknown";
      const who = payload.sender?.login ?? "someone";
      return `[${repo}] ${who} created ${refType}: ${ref}`;
    }

    case "delete": {
      const refType = payload.ref_type ?? "branch";
      const ref = payload.ref ?? "unknown";
      const who = payload.sender?.login ?? "someone";
      return `[${repo}] ${who} deleted ${refType}: ${ref}`;
    }

    case "workflow_run": {
      const run = payload.workflow_run ?? {};
      const action = payload.action ?? "completed";
      const name = run.name ?? "workflow";
      const conclusion = run.conclusion ? ` (${run.conclusion})` : "";
      return `[${repo}] ${name} ${action}${conclusion}`;
    }

    default: {
      // Fallback: pretty-print truncated JSON
      const json = JSON.stringify(payload, null, 2);
      const truncated = json.length > 2048 ? json.slice(0, 2048) + "\n... (truncated)" : json;
      return `[${event}] ${truncated}`;
    }
  }
}
