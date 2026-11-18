// Long-running soak harness for the task scheduler.
//
// It creates a recurring task in a script-peer room, optionally exercises
// hard-kill/resume, and checks that tasks are not lost or dispatched
// excessively. It does not restart the app process (use the external
// supervisor for a full 72h run).
//
//   node bench/soak.mjs --minutes 5 --interval 1 --kill-every 2
//
// For a 72h run: --minutes 4320. Results go to app/data/soak/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..", "app");
const auditPath = join(appRoot, "data", "audit.jsonl");
const outRoot = join(appRoot, "data", "soak");
const args = process.argv.slice(2);
const val = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const server = String(val("server", "http://127.0.0.1:8790")).replace(/\/+$/, "");
const minutes = Math.max(1, Number(val("minutes", "5")) || 5);
const intervalMinutes = Math.max(1, Number(val("interval", "1")) || 1);
const killEvery = Math.max(0, Number(val("kill-every", "0")) || 0);
const keep = flag("keep");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(path, options = {}) {
  const res = await fetch(server + path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text.slice(0, 200)}`);
  return data;
}

function auditLines() {
  if (!existsSync(auditPath)) return [];
  return readFileSync(auditPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function ensureRoom() {
  const boot = await request("/api/bootstrap");
  const existing = boot.rooms.find(
    (room) => room.name === "Soak" && room.memberIds.includes("@script-peer:localhost"),
  );
  if (existing) return { room: existing, created: false };
  const res = await request("/api/rooms", {
    method: "POST",
    body: { kind: "group", name: "Soak", agentIds: ["@script-peer:localhost"] },
  });
  return { room: res.room, created: true };
}

async function main() {
  await request("/api/health");
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${minutes}m`;
  mkdirSync(outRoot, { recursive: true });
  const { room, created } = await ensureRoom();
  const startedAt = Date.now();
  const beforeAudit = auditLines().length;
  const task = await request("/api/tasks", {
    method: "POST",
    body: {
      title: `soak-${runId}`,
      description: "soak harness recurring task; do not edit",
      owner: "@script-peer:localhost",
      roomId: room.id,
      dueAt: new Date().toISOString(),
      intervalMinutes,
      maxRetries: 0,
    },
  });
  console.log(
    `Soak ${minutes}m task=${task.id} room=${room.id} interval=${intervalMinutes}m killEvery=${killEvery}m`,
  );

  let kills = 0;
  let nextKillAt = killEvery > 0 ? killEvery * 60_000 : Infinity;
  let lastStatus = task.status;
  const errors = [];

  while (Date.now() - startedAt < minutes * 60_000) {
    await sleep(10_000);
    const elapsed = Date.now() - startedAt;
    try {
      const tasks = await request("/api/tasks");
      const current = tasks.tasks.find((item) => item.id === task.id);
      if (!current) {
        errors.push("task disappeared");
        break;
      }
      lastStatus = current.status;
      if (elapsed >= nextKillAt) {
        console.log("  hard kill/resume");
        await request("/api/admin/kill", { method: "POST", body: { kill: true } });
        await sleep(3000);
        await request("/api/admin/kill", { method: "POST", body: { kill: false } });
        kills += 1;
        nextKillAt += killEvery * 60_000;
      }
    } catch (err) {
      errors.push(err.message);
      break;
    }
  }

  const elapsedMinutes = (Date.now() - startedAt) / 60_000;
  const audit = auditLines().slice(beforeAudit);
  const dispatches = audit.filter((entry) => entry.kind === "task_dispatch" && entry.taskId === task.id);
  const dispatchErrors = audit.filter(
    (entry) => entry.kind === "task_dispatch_error" && entry.taskId === task.id,
  );
  const messages = (await request(`/api/rooms/${encodeURIComponent(room.id)}/messages`)).messages;
  const agentMessages = messages.filter((m) => m.kind === "agent" && m.createdAt >= startedAt);
  const expected = Math.floor(elapsedMinutes / intervalMinutes) + 1;
  const extra = Math.max(0, dispatches.length - expected - 1);
  const report = {
    runId,
    taskId: task.id,
    roomId: room.id,
    minutes,
    intervalMinutes,
    killEvery,
    kills,
    status: lastStatus,
    dispatches: dispatches.length,
    expectedDispatches: expected,
    duplicateOrExtraDispatches: extra,
    dispatchErrors: dispatchErrors.length,
    agentMessages: agentMessages.length,
    errors,
    passed: errors.length === 0 && extra === 0,
  };
  writeFileSync(join(outRoot, `${runId}.json`), JSON.stringify(report, null, 2) + "\n");

  await request(`/api/tasks/${encodeURIComponent(task.id)}`, {
    method: "PATCH",
    body: { status: "cancelled" },
  });
  if (!keep && created) {
    await request(`/api/rooms/${encodeURIComponent(room.id)}`, { method: "DELETE" }).catch(() => {});
  }

  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch((err) => {
  console.error("soak failed:", err.message);
  process.exitCode = 1;
});
