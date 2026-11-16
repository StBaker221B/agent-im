const FIXED = {
  kudo: "#2b5d8c",
  "claude-dev": "#6e4a9b",
  "script-peer": "#7a6200",
};

const PALETTE = ["#2f6b57", "#a34a3a", "#3d5a80", "#7a4e2d", "#4c6b3c", "#5d4b8c", "#2f6b57"];

const TIME_FMT = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const DAY_FMT = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" });

export function colorFor(name = "") {
  if (FIXED[name]) return FIXED[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initial(name = "?") {
  const s = String(name).trim();
  return s ? s[0].toUpperCase() : "?";
}

export function timeShort(ts) {
  if (!ts) return "";
  return TIME_FMT.format(new Date(ts));
}

export function dayLabel(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start - day) / 86_400_000);
  if (diff === 0) return `今天 ${timeShort(ts)}`;
  if (diff === 1) return `昨天 ${timeShort(ts)}`;
  return `${DAY_FMT.format(d)} ${timeShort(ts)}`;
}

export function listTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeShort(ts);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (start - day < 86_400_000) return "昨天";
  return DAY_FMT.format(d);
}

export function shouldShowDay(prev, cur) {
  if (!prev) return true;
  return new Date(prev).toDateString() !== new Date(cur).toDateString();
}

export function sameRun(prev, cur) {
  if (!prev) return false;
  return prev.sender === cur.sender && (cur.createdAt ?? 0) - (prev.createdAt ?? 0) < 3 * 60_000;
}

export function preview(text = "", max = 36) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}
