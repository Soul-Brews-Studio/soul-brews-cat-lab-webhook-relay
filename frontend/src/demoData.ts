// Demo mode: seeded random generators for masking real data

function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

const MESSAGES = [
  "Hey, are we still meeting at 3pm today?",
  "Just pushed the latest changes to staging",
  "Can someone review my PR? Link in the channel",
  "The server response time improved by 40% after the fix",
  "Running late, will join in 10 minutes",
  "Great work on the presentation yesterday!",
  "Does anyone have the login credentials for the test env?",
  "Lunch at the usual place?",
  "I'll handle the deployment tonight",
  "Quick question about the API rate limits",
  "Shared the document in the drive folder",
  "The client approved the new design mockups",
  "Reminder: standup at 9am tomorrow",
  "Found a bug in the checkout flow, filing an issue now",
  "Happy Friday everyone!",
  "New version is live, please verify on your end",
  "Thanks for the quick turnaround on this",
  "Meeting notes are in the shared doc",
  "Blocked on the database migration, need DBA access",
  "Weekend plans anyone?",
];

const GROUPS = [
  "Team Alpha", "Project Beta", "Engineering", "Design Review",
  "Backend Squad", "Frontend Crew", "DevOps", "Product Sync",
  "Release Train", "QA Testing",
];

const NAMES = [
  "Alex", "Jordan", "Sam", "Taylor", "Morgan",
  "Casey", "Riley", "Jamie", "Drew", "Quinn",
];

type MsgType = "text" | "image" | "sticker" | "video" | "file";

function getMsgType(index: number): MsgType {
  const r = seededRandom(index * 7);
  if (r < 0.65) return "text";
  if (r < 0.80) return "image";
  if (r < 0.90) return "sticker";
  if (r < 0.95) return "video";
  return "file";
}

export function getDemoMessage(index: number): string {
  const t = getMsgType(index);
  const r = seededRandom(index * 13);
  switch (t) {
    case "text":
      return MESSAGES[Math.floor(r * MESSAGES.length)];
    case "image":
      return r > 0.7 ? "[IMAGE 1/3]" : "[IMAGE]";
    case "sticker": {
      const kw = ["happy", "excited", "thumbs up", "celebrate", "good job"];
      return `[STICKER: ${kw[Math.floor(r * kw.length)]}]`;
    }
    case "video":
      return "[VIDEO]";
    case "file":
      return `[FILE] report_v${Math.floor(r * 10) + 1}.pdf`;
  }
}

export function getDemoGroup(index: number): string {
  return GROUPS[Math.floor(seededRandom(index * 31) * GROUPS.length)];
}

export function getDemoName(index: number): string {
  return NAMES[Math.floor(seededRandom(index * 43) * NAMES.length)];
}

export function getDemoBody(index: number, originalBody: string): string {
  try {
    const parsed = JSON.parse(originalBody);
    if (!parsed?.events?.[0]) return '{"demo": true}';
    const ev = parsed.events[0];
    const t = getMsgType(index);
    const r = seededRandom(index * 13);

    if (ev.source) {
      if (ev.source.groupId) ev.source.groupId = `Cdemo${String(index).padStart(29, "0")}`;
      if (ev.source.userId) ev.source.userId = `Udemo${String(index).padStart(29, "0")}`;
      if (ev.source.roomId) ev.source.roomId = `Rdemo${String(index).padStart(29, "0")}`;
    }
    if (ev.message) {
      ev.message.id = `demo${String(index).padStart(12, "0")}`;
      ev.message.type = t;
      if (t === "text") {
        ev.message.text = MESSAGES[Math.floor(r * MESSAGES.length)];
        delete ev.message.keywords;
        delete ev.message.fileName;
      } else if (t === "sticker") {
        ev.message.packageId = "11537";
        ev.message.stickerId = "52002734";
        ev.message.keywords = ["happy", "excited"];
        delete ev.message.text;
        delete ev.message.fileName;
      } else {
        delete ev.message.text;
        delete ev.message.keywords;
      }
    }
    if (ev.webhookEventId) ev.webhookEventId = `demo_event_${index}`;
    if (ev.replyToken) ev.replyToken = `demo_reply_${String(index).padStart(28, "0")}`;
    return JSON.stringify(parsed);
  } catch {
    return '{"demo": true}';
  }
}
