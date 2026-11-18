// Persistent task ledger for long-running work.
//
// Tasks survive app restarts. The scheduler dispatches a due task once by
// sending a human message into its room; it does not own the agent turn.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "../spike/src/atomic-write.mjs";

export const TASK_STATUSES = ["pending", "active", "blocked", "failed", "done", "cancelled"];
const STATUS_SET = new Set(TASK_STATUSES);

function nowIso() {
  return new Date().toISOString();
}

function normalizeDueAt(value) {
  if (value === null || value === undefined || value === "") return null;
  const time = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(time)) throw new Error("bad dueAt");
  return new Date(time).toISOString();
}

function normalizeInterval(value) {
  if (value === null || value === undefined || value === "") return 0;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 10_080) throw new Error("bad intervalMinutes");
  return minutes;
}

function normalizeCount(value, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error("bad count");
  return n;
}

export class TaskStore {
  constructor(path) {
    this.path = path;
    this.tasks = [];
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) {
      this.save();
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      this.tasks = Array.isArray(raw?.tasks) ? raw.tasks : [];
    } catch {
      this.tasks = [];
    }
    let migrated = false;
    for (const task of this.tasks) {
      if (task.maxRetries === undefined) {
        task.maxRetries = 2;
        migrated = true;
      }
      if (task.retryCount === undefined) {
        task.retryCount = 0;
        migrated = true;
      }
      if (task.retryBackoffMinutes === undefined) {
        task.retryBackoffMinutes = 5;
        migrated = true;
      }
      if (task.needsAttention === undefined) {
        task.needsAttention = false;
        migrated = true;
      }
    }
    if (migrated) this.save();
  }

  save() {
    writeFileAtomic(this.path, JSON.stringify({ version: 1, tasks: this.tasks }, null, 2) + "\n");
  }

  list() {
    return [...this.tasks].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }

  get(id) {
    return this.tasks.find((task) => task.id === id) ?? null;
  }

  create({
    title,
    description = "",
    owner = null,
    roomId = null,
    dueAt = null,
    intervalMinutes = 0,
    maxRetries = 2,
    retryBackoffMinutes = 5,
    priority = 0,
    createdBy = null,
  }) {
    const cleanTitle = String(title ?? "").trim();
    if (!cleanTitle) throw new Error("title required");
    const task = {
      id: `task-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
      title: cleanTitle.slice(0, 200),
      description: String(description ?? "").slice(0, 8000),
      owner: owner || null,
      roomId: roomId || null,
      dueAt: normalizeDueAt(dueAt),
      intervalMinutes: normalizeInterval(intervalMinutes),
      maxRetries: normalizeCount(maxRetries, 0, 20),
      retryCount: 0,
      retryBackoffMinutes: normalizeCount(retryBackoffMinutes, 1, 10_080),
      needsAttention: false,
      priority: Number(priority) || 0,
      status: "pending",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastDispatchedAt: null,
      lastError: null,
      checkpoints: [],
      createdBy,
    };
    this.tasks.push(task);
    this.save();
    return task;
  }

  update(id, patch = {}) {
    const task = this.get(id);
    if (!task) return null;
    if (patch.title !== undefined) {
      const title = String(patch.title).trim();
      if (!title) throw new Error("title required");
      task.title = title.slice(0, 200);
    }
    if (patch.description !== undefined) task.description = String(patch.description).slice(0, 8000);
    if (patch.owner !== undefined) task.owner = patch.owner || null;
    if (patch.roomId !== undefined) task.roomId = patch.roomId || null;
    if (patch.dueAt !== undefined) task.dueAt = normalizeDueAt(patch.dueAt);
    if (patch.intervalMinutes !== undefined) task.intervalMinutes = normalizeInterval(patch.intervalMinutes);
    if (patch.maxRetries !== undefined) task.maxRetries = normalizeCount(patch.maxRetries, 0, 20);
    if (patch.retryBackoffMinutes !== undefined)
      task.retryBackoffMinutes = normalizeCount(patch.retryBackoffMinutes, 1, 10_080);
    if (patch.needsAttention !== undefined) task.needsAttention = Boolean(patch.needsAttention);
    if (patch.priority !== undefined) task.priority = Number(patch.priority) || 0;
    if (patch.status !== undefined) {
      if (!STATUS_SET.has(patch.status)) throw new Error("bad status");
      task.status = patch.status;
    }
    if (patch.lastError !== undefined) task.lastError = patch.lastError;
    task.updatedAt = nowIso();
    this.save();
    return task;
  }

  addCheckpoint(id, text, by = null) {
    const task = this.get(id);
    if (!task) return null;
    const clean = String(text ?? "").trim();
    if (!clean) throw new Error("checkpoint text required");
    task.checkpoints.push({ ts: nowIso(), by, text: clean.slice(0, 4000) });
    task.updatedAt = nowIso();
    this.save();
    return task;
  }

  dispatch(id, by = "scheduler") {
    const task = this.get(id);
    if (!task) return null;
    const now = nowIso();
    task.lastDispatchedAt = now;
    task.lastError = null;
    task.needsAttention = false;
    if (task.intervalMinutes > 0) {
      task.dueAt = new Date(Date.now() + task.intervalMinutes * 60_000).toISOString();
      task.status = "pending";
      task.checkpoints.push({
        ts: now,
        by,
        text: `recurring dispatch; next ${task.dueAt}`,
      });
    } else {
      task.status = "active";
      task.checkpoints.push({ ts: now, by, text: `dispatched at ${now}` });
    }
    task.updatedAt = now;
    this.save();
    return task;
  }

  /** Schedule a bounded retry after a failed run; escalate when exhausted. */
  scheduleRetry(id, reason, now = Date.now()) {
    const task = this.get(id);
    if (!task) return null;
    task.lastError = String(reason ?? "").slice(0, 2000);
    const max = Number(task.maxRetries) || 0;
    const count = Number(task.retryCount) || 0;
    if (count >= max) {
      task.status = task.intervalMinutes > 0 ? "blocked" : "failed";
      task.needsAttention = true;
      task.checkpoints.push({
        ts: nowIso(),
        by: "scheduler",
        text: `retry exhausted (${count}/${max}); needs attention`,
      });
      task.updatedAt = nowIso();
      this.save();
      return task;
    }
    const nextCount = count + 1;
    const backoff = Math.max(1, Number(task.retryBackoffMinutes) || 5);
    const delayMs = backoff * 60_000 * 2 ** (nextCount - 1);
    task.retryCount = nextCount;
    task.status = "pending";
    task.dueAt = new Date(now + delayMs).toISOString();
    task.needsAttention = false;
    task.checkpoints.push({
      ts: nowIso(),
      by: "scheduler",
      text: `retry ${nextCount}/${max} scheduled at ${task.dueAt}`,
    });
    task.updatedAt = nowIso();
    this.save();
    return task;
  }

  /** Mark active tasks that outlived a restart/threshold as needing attention. */
  markStale(now = Date.now(), thresholdMs = 30 * 60_000) {
    let count = 0;
    for (const task of this.tasks) {
      if (task.status !== "active" || task.needsAttention) continue;
      const dispatched = task.lastDispatchedAt ? Date.parse(task.lastDispatchedAt) : 0;
      if (dispatched && now - dispatched <= thresholdMs) continue;
      task.needsAttention = true;
      task.checkpoints.push({
        ts: nowIso(),
        by: "startup",
        text: "active task may have been interrupted; needs attention",
      });
      task.updatedAt = nowIso();
      count += 1;
    }
    if (count) this.save();
    return count;
  }

  due(now = Date.now()) {
    return this.tasks.filter(
      (task) => task.status === "pending" && task.dueAt && Date.parse(task.dueAt) <= now,
    );
  }
}
