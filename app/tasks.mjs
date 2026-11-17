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

  due(now = Date.now()) {
    return this.tasks.filter(
      (task) => task.status === "pending" && task.dueAt && Date.parse(task.dueAt) <= now,
    );
  }
}
