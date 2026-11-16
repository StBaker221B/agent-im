// In-process fake Matrix bus used by the gateway tests and the free demo.
// It mimics the bits of the client-server API the gateway needs:
// per-user clients, monotonic event log, `since` tokens, room membership,
// and txn-id idempotency. No external deps.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Normalized room event:
 * { id, roomId, threadId, sender, senderKind, text, intent, mentions,
 *   replyTo?, proposalId?, taskId?, taskOwner?, artifact?, createdAt, txnId? }
 */

export class FakeBus {
  constructor({ users = [], rooms = [], logPath = null, now = () => Date.now(), idFactory } = {}) {
    this.users = new Map(users.map((u) => [u.id, { kind: "human", ...u }]));
    this.rooms = new Map(
      rooms.map((r) => [r.id, { id: r.id, kind: r.members.length === 2 ? "dm" : "group", ...r, members: [...r.members] }]),
    );
    this.events = [];
    this.txnIds = new Map();
    this.waiters = [];
    this.now = now;
    this.idFactory = idFactory;
    this.logPath = logPath;
    this.seq = 0;
    if (logPath) this.#loadLog(logPath);
  }

  #loadLog(path) {
    let raw = "";
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
      mkdirSync(dirname(path), { recursive: true });
      return;
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      this.events.push(ev);
      if (ev.txnId) this.txnIds.set(ev.txnId, ev.id);
    }
    this.seq = this.events.length;
  }

  #appendLog(ev) {
    if (!this.logPath) return;
    mkdirSync(dirname(this.logPath), { recursive: true });
    appendFileSync(this.logPath, JSON.stringify(ev) + "\n", "utf8");
  }

  #notify() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }

  #tokenIndex(since) {
    const n = Number(since);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(Math.floor(n), this.events.length);
  }

  clientFor(userId) {
    if (!this.users.has(userId)) this.users.set(userId, { id: userId, kind: "human" });
    return new FakeClient(this, userId);
  }

  members(roomId) {
    return [...(this.rooms.get(roomId)?.members ?? [])];
  }

  room(roomId) {
    return this.rooms.get(roomId);
  }

  getMessages(roomId, { limit = 50 } = {}) {
    return this.events.filter((ev) => ev.roomId === roomId).slice(-limit);
  }

  getEvent(roomId, eventId) {
    return this.events.find((ev) => ev.roomId === roomId && ev.id === eventId) ?? null;
  }

  async sync(userId, since, { timeoutMs = 0 } = {}) {
    const index = this.#tokenIndex(since);
    const collect = () =>
      this.events.slice(index).filter((ev) => this.rooms.get(ev.roomId)?.members.includes(userId));
    let events = collect();
    if (!events.length && timeoutMs > 0) {
      await new Promise((resolve) => {
        let timer;
        const wake = () => {
          clearTimeout(timer);
          resolve();
        };
        timer = setTimeout(() => {
          const i = this.waiters.indexOf(wake);
          if (i >= 0) this.waiters.splice(i, 1);
          resolve();
        }, timeoutMs);
        this.waiters.push(wake);
      });
      events = collect();
    }
    return { events, nextToken: String(this.events.length) };
  }

  async send(userId, roomId, payload = {}) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`fake-bus: unknown room ${roomId}`);
    if (!room.members.includes(userId)) throw new Error(`fake-bus: ${userId} is not in ${roomId}`);
    if (payload.txnId && this.txnIds.has(payload.txnId)) {
      return { eventId: this.txnIds.get(payload.txnId) };
    }
    const id = this.idFactory ? this.idFactory() : `$fake-${this.now().toString(36)}-${++this.seq}`;
    const ev = {
      id,
      roomId,
      threadId: payload.threadId ?? "main",
      sender: userId,
      senderKind: this.users.get(userId)?.kind ?? "human",
      text: payload.text ?? "",
      intent: payload.intent ?? "chat",
      mentions: payload.mentions ?? [],
      replyTo: payload.replyTo,
      proposalId: payload.proposalId,
      taskId: payload.taskId,
      taskOwner: payload.taskOwner,
      artifact: payload.artifact,
      createdAt: this.now(),
      txnId: payload.txnId,
    };
    this.events.push(ev);
    if (ev.txnId) this.txnIds.set(ev.txnId, id);
    this.#appendLog(ev);
    this.#notify();
    return { eventId: id };
  }

  async close() {
    this.waiters.splice(0).forEach((wake) => wake());
  }
}

export class FakeClient {
  constructor(bus, userId) {
    this.bus = bus;
    this.userId = userId;
  }

  async connect() {}
  async close() {}

  async joinRoom(roomId) {
    const room = this.bus.rooms.get(roomId);
    if (!room) throw new Error(`fake-bus: unknown room ${roomId}`);
    if (!room.members.includes(this.userId)) room.members.push(this.userId);
    return roomId;
  }

  async members(roomId) {
    return this.bus.members(roomId);
  }

  async sync(since, opts = {}) {
    return this.bus.sync(this.userId, since, opts);
  }

  async send(roomId, payload) {
    return this.bus.send(this.userId, roomId, payload);
  }

  async getMessages(roomId, opts = {}) {
    return this.bus.getMessages(roomId, opts);
  }

  async getEvent(roomId, eventId) {
    return this.bus.getEvent(roomId, eventId);
  }

  async setTyping() {}
  async whoami() {
    return { user_id: this.userId };
  }
}
