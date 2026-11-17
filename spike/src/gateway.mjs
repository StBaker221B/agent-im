// Gateway: bridges an IM transport to the deterministic Engine and native
// runtimes. One process can host several agent identities, each with its own
// transport client and runtime.
//
// v0 simplifications (documented in docs/09 §14):
// - One global async queue serializes ingestion AND turns. Different threads
//   do not parallelize yet; same-thread single-writer is guaranteed.
// - Inbound ids are persisted before the turn runs. A crash mid-turn loses
//   that reply instead of re-running and risking a duplicate.
// - Replies use deterministic Matrix txn ids derived from (agent, trigger),
//   so a retried send is deduplicated by the homeserver.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic-write.mjs";
import { dirname, join } from "node:path";
import { AuditLog } from "./audit.mjs";
import { parseReply } from "./reply.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MEDIA_EXT = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "application/json": ".json",
};

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export class Gateway {
  constructor({
    engine,
    clients,
    runtimes,
    rooms = null,
    statePath = null,
    auditPath = null,
    syncTimeoutMs = 30_000,
    tickMs = 1000,
    maxQueued = 5000,
    mediaDir = null,
    triage = {},
    budgetCheck = null,
    onUsage = null,
    onEvent = null,
    onTaskCreate = null,
    onTaskDone = null,
    onTaskBlocked = null,
    onTaskFailed = null,
    now = () => Date.now(),
    log = console.log,
  }) {
    this.engine = engine;
    this.clients = clients;
    this.runtimes = runtimes;
    this.rooms = rooms ? [...rooms] : [];
    this.statePath = statePath;
    this.audit = new AuditLog(auditPath);
    this.syncTimeoutMs = syncTimeoutMs;
    this.tickMs = tickMs;
    this.maxQueued = maxQueued;
    this.now = now;
    this.log = log;
    this.mediaDir = mediaDir;
    this.mediaCache = new Map();
    // Cheap, rule-based triage before a full model turn. Direct mentions and
    // replies always run; ambient wakes can be skipped by ack/cooldown/cap.
    this.triage = { cooldownMs: 15_000, maxTurnsPerHour: 30, skipAcks: true, ...triage };
    this.budgetCheck = budgetCheck;
    this.onUsage = onUsage;
    this.onEvent = onEvent;
    this.onTaskCreate = onTaskCreate;
    this.onTaskDone = onTaskDone;
    this.onTaskBlocked = onTaskBlocked;
    this.onTaskFailed = onTaskFailed;
    this.lastTurnAt = new Map();
    this.turnTimes = new Map();

    this.since = new Map();
    this.processed = new Set();
    this.lastTs = 0;
    this.sessions = new Map();
    this.roomClients = new Map();
    this.queue = Promise.resolve();
    this.loops = [];
    this.tickTimer = null;
    this.saveTimer = null;
    this.running = false;
    this.#loadState();
  }

  #loadState() {
    if (!this.statePath || !existsSync(this.statePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.statePath, "utf8"));
      for (const [id, token] of Object.entries(raw?.since ?? {})) this.since.set(id, token);
      for (const id of raw?.processed ?? []) this.processed.add(id);
      this.lastTs = raw?.lastTs ?? 0;
      this.log(`[gateway] state loaded: since=${this.since.size} processed=${this.processed.size} lastTs=${this.lastTs}`);
    } catch (err) {
      this.log(`[gateway] ignoring unreadable state: ${err.message}`);
    }
  }

  save() {
    if (!this.statePath) return;
    mkdirSync(dirname(this.statePath), { recursive: true });
    const state = {
      since: Object.fromEntries(this.since),
      lastTs: this.lastTs,
      processed: [...this.processed].slice(-this.maxQueued),
    };
    writeFileAtomic(this.statePath, JSON.stringify(state, null, 2));
  }

  #scheduleSave() {
    if (!this.statePath || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 100);
    this.saveTimer.unref?.();
  }

  async start() {
    if (this.running) return;
    this.running = true;
    for (const [agentId, client] of this.clients) {
      try {
        await client.connect?.();
      } catch (err) {
        this.log(`[gateway] connect ${agentId} failed: ${err.message}`);
      }
    }
    for (const roomId of this.rooms) {
      await this.#enqueue(() => this.#ensureRoom(roomId));
    }
    this.tickTimer = setInterval(() => this.#tick(), this.tickMs);
    this.tickTimer.unref?.();
    for (const [agentId, client] of this.clients) {
      this.loops.push(this.#syncLoop(agentId, client));
    }
    this.log(
      `[gateway] started rooms=${this.rooms.join(",") || "(discover)"} agents=${[...this.clients.keys()].join(",")}`,
    );
  }

  async stop({ timeoutMs = 2000 } = {}) {
    if (!this.running) return;
    this.running = false;
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await Promise.race([Promise.allSettled(this.loops), sleep(timeoutMs)]);
    await Promise.race([this.queue.catch(() => {}), sleep(timeoutMs)]);
    this.save();
    for (const runtime of this.runtimes.values()) {
      try {
        await runtime.close?.();
      } catch (err) {
        this.log(`[gateway] close runtime failed: ${err.message}`);
      }
    }
    for (const client of this.clients.values()) {
      try {
        await client.close?.();
      } catch (err) {
        this.log(`[gateway] close client failed: ${err.message}`);
      }
    }
    this.log("[gateway] stopped");
  }

  /**
   * Attach an agent identity created after startup. The control plane calls
   * this when a new agent is registered; existing rooms are discovered by the
   * normal sync loop.
   */
  async addAgent({ agentId, client, runtime, profile = {} }) {
    if (this.clients.has(agentId)) return { added: false, reason: "already attached" };
    this.engine.addAgent({ id: agentId, ...profile });
    this.clients.set(agentId, client);
    this.runtimes.set(agentId, runtime);
    try {
      await client.connect?.();
    } catch (err) {
      this.log(`[gateway] connect ${agentId} failed: ${err.message}`);
    }
    if (this.running) this.loops.push(this.#syncLoop(agentId, client));
    this.log(`[gateway] agent added ${agentId}`);
    return { added: true };
  }

  /** Stop syncing and remove an agent from the engine (soft delete helper). */
  async removeAgent(agentId) {
    const client = this.clients.get(agentId);
    const runtime = this.runtimes.get(agentId);
    this.clients.delete(agentId);
    this.runtimes.delete(agentId);
    try {
      await runtime?.close?.();
    } catch {
      // runtime is best-effort
    }
    this.engine.agents.delete(agentId);
    for (const room of this.engine.rooms.values()) {
      room.members = room.members.filter((member) => member !== agentId);
    }
    for (const [roomId, roomClient] of this.roomClients) {
      if (roomClient === client) this.roomClients.delete(roomId);
    }
    this.log(`[gateway] agent removed ${agentId}`);
    return Boolean(client);
  }

  /** Drop a member from an engine room after their Matrix leave succeeded. */
  removeRoomMember(roomId, agentId) {
    const room = this.engine.rooms.get(roomId);
    if (room) room.members = room.members.filter((member) => member !== agentId);
    this.roomClients.delete(roomId);
    this.log(`[gateway] room member removed ${agentId} from ${roomId}`);
  }

  /** Register a room created after startup and hydrate it into the engine. */
  async addRoom(roomId) {
    if (!this.rooms.includes(roomId)) this.rooms.push(roomId);
    if (!this.running) return null;
    return this.#enqueue(() => this.#ensureRoom(roomId));
  }

  /** Refresh a room's member list after an invite (control plane). */
  async syncRoom(roomId) {
    if (!this.running) return null;
    return this.#enqueue(async () => {
      if (!this.engine.rooms.has(roomId)) return this.#ensureRoom(roomId);
      const client = await this.#clientForRoom(roomId);
      if (!client) return null;
      const memberIds = await client.members(roomId);
      const room = this.engine.rooms.get(roomId);
      room.members = memberIds;
      const thread = this.engine.getThread(roomId, "main");
      if (thread) {
        for (const memberId of memberIds) {
          const member = this.engine.agents.get(memberId);
          if (member?.kind !== "agent") continue;
          if (!thread.states.has(memberId)) thread.states.set(memberId, "idle");
          if (!thread.seenVersion.has(memberId)) thread.seenVersion.set(memberId, thread.version);
        }
      }
      this.audit.write({ kind: "room_members", roomId, members: memberIds });
      return memberIds;
    });
  }

  /** Drop a room from the engine after the last local member leaves. */
  async removeRoom(roomId) {
    if (!this.running) return;
    return this.#enqueue(async () => {
      this.rooms = this.rooms.filter((id) => id !== roomId);
      this.engine.rooms.delete(roomId);
      for (const key of [...this.engine.threads.keys()]) {
        if (key.startsWith(`${roomId}/`)) this.engine.threads.delete(key);
      }
      this.roomClients.delete(roomId);
      this.audit.write({ kind: "room_removed", roomId });
    });
  }

  async #syncLoop(agentId, client) {
    while (this.running) {
      try {
        const since = this.since.get(agentId);
        const { events, nextToken } = await client.sync(since, { timeoutMs: this.syncTimeoutMs });
        if (!this.running || !this.clients.has(agentId)) break;
        for (const ev of events) {
          await this.#enqueue(() => this.#ingest(ev, client));
        }
        if (nextToken !== undefined && nextToken !== null) {
          this.since.set(agentId, nextToken);
          this.#scheduleSave();
        }
      } catch (err) {
        if (!this.running) break;
        this.log(`[sync:${agentId}] ${err.message}`);
        await sleep(1000);
      }
    }
  }

  #enqueue(task) {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  /** Pick a client that is actually joined to the room (DM peers differ). */
  async #clientForRoom(roomId, preferred = null) {
    if (preferred) {
      this.roomClients.set(roomId, preferred);
      return preferred;
    }
    if (this.roomClients.has(roomId)) return this.roomClients.get(roomId);
    for (const client of this.clients.values()) {
      try {
        await client.members(roomId);
        this.roomClients.set(roomId, client);
        return client;
      } catch {
        // not joined as this user; try the next one
      }
    }
    return null;
  }

  async #ensureRoom(roomId, { beforeTs, client: preferred } = {}) {
    if (this.engine.rooms.has(roomId)) return;
    const client = await this.#clientForRoom(roomId, preferred);
    if (!client) return;
    let memberIds;
    try {
      memberIds = await client.members(roomId);
    } catch (err) {
      this.log(`[gateway] members ${roomId} failed: ${err.message}`);
      return;
    }
    if (!memberIds.length) return;
    const admin = memberIds.find((m) => this.engine.agents.get(m)?.kind !== "agent") ?? null;
    const kind = memberIds.length === 2 ? "dm" : "group";
    this.engine.addRoom({ id: roomId, members: memberIds, facilitator: admin, admin, kind });
    this.engine.createThread({ roomId, threadId: "main" });
    this.engine.setNow(this.now());

    // Hydrate only history that predates the triggering event (if any) and the
    // persisted high-water mark. It is treated as already consumed.
    const cutoff = this.lastTs > 0 ? this.lastTs : (beforeTs ?? Number.POSITIVE_INFINITY);
    try {
      const history = await client.getMessages(roomId, { limit: 50 });
      const main = history.filter(
        (m) => m.threadId === "main" && (m.createdAt ?? 0) < (beforeTs ?? Number.POSITIVE_INFINITY) && (m.createdAt ?? 0) <= cutoff,
      );
      if (main.length) this.engine.hydrateThread({ roomId, threadId: "main", messages: main });
      if (!this.lastTs && main.length) {
        this.lastTs = Math.max(...main.map((m) => m.createdAt ?? 0));
      }
    } catch (err) {
      this.log(`[gateway] history ${roomId} failed: ${err.message}`);
    }
    this.audit.write({ kind: "room_ready", roomId, kind, members: memberIds });
  }

  async #ensureThread(ev, client = null) {
    const threadId = ev.threadId ?? "main";
    if (this.engine.getThread(ev.roomId, threadId)) return;
    this.engine.createThread({ roomId: ev.roomId, threadId });
    if (threadId !== "main") {
      const joined = client ?? (await this.#clientForRoom(ev.roomId));
      if (!joined) return;
      try {
        const root = await joined.getEvent(ev.roomId, threadId);
        if (root) this.engine.hydrateThread({ roomId: ev.roomId, threadId, messages: [root] });
      } catch (err) {
        this.log(`[gateway] thread root ${threadId} failed: ${err.message}`);
      }
    }
  }

  async #ingest(ev, client = null) {
    // Track the high-water mark for every event we see, including our own
    // echoes. Restart hydration uses it to include past agent replies.
    if (ev?.createdAt) this.lastTs = Math.max(this.lastTs, ev.createdAt);
    if (!ev?.id || this.processed.has(ev.id)) return;
    await this.#ensureRoom(ev.roomId, { beforeTs: ev.createdAt, client });
    const room = this.engine.rooms.get(ev.roomId);
    if (!room) return;

    // In a 2-person room everything is addressed to the other participant.
    let mentions = [...(ev.mentions ?? [])];
    if (room.kind === "dm") {
      for (const m of room.members) {
        if (m !== ev.sender && this.engine.agents.get(m)?.kind === "agent" && !mentions.includes(m)) mentions.push(m);
      }
    }

    // Our own agents' messages are recorded when sent (agentAct). Ignore echoes
    // and hydrated history.
    const sender = this.engine.agents.get(ev.sender);
    if (sender?.kind === "agent" && this.clients.has(ev.sender)) {
      this.processed.add(ev.id);
      return;
    }

    await this.#ensureThread(ev, client);
    // Runtimes only receive text; after caching the media locally, give agents
    // a path they can open with their Read tool.
    const mediaPath = await this.#cacheMedia(ev, client);
    const agentText =
      ev.msgtype === "m.image"
        ? `[图片] ${ev.text}${mediaPath ? `\n本地文件: ${mediaPath}` : ""}`
        : ev.msgtype === "m.file"
          ? `[文件] ${ev.text}${mediaPath ? `\n本地文件: ${mediaPath}` : ""}`
          : ev.text;
    const result = this.engine.post({
      id: ev.id,
      roomId: ev.roomId,
      threadId: ev.threadId ?? "main",
      sender: ev.sender,
      senderKind: ev.senderKind,
      text: agentText,
      intent: ev.intent,
      mentions,
      replyTo: ev.replyTo,
      proposalId: ev.proposalId,
      taskId: ev.taskId,
      taskOwner: ev.taskOwner,
      artifact: ev.artifact,
    });
    if (result.duplicate) {
      this.processed.add(ev.id);
      return;
    }
    this.processed.add(ev.id);
    this.lastTs = Math.max(this.lastTs, ev.createdAt ?? 0);
    this.#scheduleSave();
    this.audit.write({
      kind: "inbound",
      id: ev.id,
      roomId: ev.roomId,
      threadId: ev.threadId ?? "main",
      sender: ev.sender,
      intent: ev.intent,
      mentions,
      text: ev.text,
    });

    // Track agents already run by the granted chain (agent A may have @-ed B
    // and B already took its turn) so the wake list does not run them twice.
    const dispatched = new Set();
    await this.#dispatch(result.granted, dispatched);

    // wakePolicy=all agents that were not auto-granted ask for the floor.
    for (const agentId of result.wake ?? []) {
      if (dispatched.has(agentId)) continue;
      if (this.engine.getThread(ev.roomId, ev.threadId ?? "main")?.floor.holder) break;
      const agent = this.engine.agents.get(agentId);
      const attention = this.engine.attentionFor(agentId, result.message);
      const skip = agent ? this.#triageSkip(agent, result.message, attention) : null;
      if (skip) {
        this.audit.write({ kind: "triage_skip", agentId, roomId: ev.roomId, reason: skip, text: ev.text });
        this.onEvent?.({ type: "skip", agentId, roomId: ev.roomId, threadId: ev.threadId ?? "main", reason: skip });
        continue;
      }
      const req = this.engine.requestFloor(ev.roomId, ev.threadId ?? "main", agentId, {
        priority: 2,
        reason: "volunteer",
      });
      if (req?.granted) await this.#dispatch(req.granted, dispatched);
    }
  }

  /** External trigger for a volunteer turn (cron/script/demo). */
  async requestFloor(agentId, { roomId, threadId = "main" } = {}) {
    const rid = roomId ?? this.rooms[0] ?? [...this.engine.rooms.keys()][0];
    if (!rid) throw new Error("gateway: no room");
    return this.#enqueue(async () => {
      const req = this.engine.requestFloor(rid, threadId, agentId, { priority: 2, reason: "volunteer" });
      if (req?.granted) return this.#dispatch(req.granted);
      return req;
    });
  }

  async #dispatch(granted, dispatched = null) {
    let current = granted;
    while (current) {
      const { agentId, envelope } = current;
      if (dispatched) dispatched.add(agentId);
      const runtime = this.runtimes.get(agentId);
      const roomId = envelope?.message?.roomId;
      const threadId = envelope?.message?.threadId ?? "main";
      if (!runtime) {
        this.audit.write({ kind: "no_runtime", agentId, roomId, threadId });
        const res = this.engine.failTurn(roomId, threadId, agentId, "no runtime");
        current = res.granted;
        continue;
      }
      current = await this.#runTurn(agentId, runtime, envelope);
    }
  }

  async #runTurn(agentId, runtime, envelope) {
    const {
      roomId,
      threadId = envelope.message.threadId ?? "main",
      id: triggerId,
      taskId,
    } = envelope.message;
    const profile = this.engine.agents.get(agentId);
    if (profile?.paused) {
      this.audit.write({ kind: "paused_skip", agentId, roomId, threadId });
      this.onEvent?.({ type: "skip", agentId, roomId, threadId, reason: "paused" });
      const res = this.engine.agentAct(roomId, threadId, agentId, {
        id: `paused-${fnv1a(agentId + ":" + triggerId)}`,
        type: "pass",
      });
      return res.granted ?? null;
    }
    const budget = this.budgetCheck?.(agentId);
    if (budget?.exceeded) {
      this.audit.write({
        kind: "budget_skip",
        agentId,
        roomId,
        threadId,
        spent: budget.spent,
        cap: budget.cap,
      });
      this.log(`[gateway] budget skip: ${agentId} spent=${budget.spent.toFixed(3)} cap=${budget.cap}`);
      this.onEvent?.({ type: "skip", agentId, roomId, threadId, reason: "budget" });
      const res = this.engine.agentAct(roomId, threadId, agentId, {
        id: `budget-${fnv1a(agentId + ":" + triggerId)}`,
        type: "pass",
      });
      return res.granted ?? null;
    }
    this.#recordTurn(agentId);
    this.onEvent?.({ type: "turn_start", agentId, roomId, threadId });
    const client = this.clients.get(agentId);
    let session;
    try {
      session = await runtime.ensureSession({ roomId, threadId });
      this.sessions.set(agentId, session);
    } catch (err) {
      this.audit.write({ kind: "session_error", agentId, error: String(err) });
      return this.engine.failTurn(roomId, threadId, agentId, `session: ${err.message}`).granted;
    }

    const collected = [];
    let finalText = "";
    try {
      await client?.setTyping?.(roomId, true);
      for await (const ev of runtime.send(session, envelope)) {
        if (ev.type === "message") collected.push(ev.text);
        else if (ev.type === "text_delta") {
          this.onEvent?.({ type: "text_delta", agentId, roomId, threadId, text: ev.text });
        } else if (ev.type === "turn_end") finalText = ev.text ?? collected.join("");
        else if (ev.type === "usage") {
          this.audit.write({ kind: "usage", agentId, usage: ev.usage, costUsd: ev.costUsd, sessionId: ev.sessionId });
          this.onUsage?.(agentId, Number(ev.costUsd) || 0);
        } else if (ev.type === "tool_use") {
          this.audit.write({ kind: "tool_use", agentId, name: ev.name, input: ev.input });
          this.onEvent?.({ type: "tool_use", agentId, roomId, threadId, name: ev.name, input: ev.input });
        } else if (ev.type === "tool_result") {
          this.audit.write({ kind: "tool_result", agentId, toolUseId: ev.toolUseId, isError: ev.isError });
          this.onEvent?.({ type: "tool_result", agentId, roomId, threadId, toolUseId: ev.toolUseId, isError: ev.isError });
        }
      }
    } catch (err) {
      this.audit.write({ kind: "turn_error", agentId, error: String(err) });
      return this.engine.failTurn(roomId, threadId, agentId, err.message).granted;
    } finally {
      await client?.setTyping?.(roomId, false);
    }
    if (!finalText) finalText = collected.join("");

    const action = parseReply(finalText);
    let outbound;
    if (action.type === "pass" || (action.type === "message" && !action.text.trim())) {
      outbound = { type: "pass" };
    } else if (action.type === "ask_human") {
      outbound = { type: "ask_human", question: action.question, text: action.question, intent: "ask_human" };
    } else if (action.type === "tool_request") {
      outbound = {
        type: "tool_request",
        text: `申请工具：${action.tool}${action.reason ? `（${action.reason}）` : ""}`,
        intent: "tool_request",
        tool: action.tool,
      };
    } else if (action.type === "task") {
      let created = null;
      try {
        created = await this.onTaskCreate?.({
          agentId,
          roomId,
          threadId,
          title: action.title,
        });
      } catch (err) {
        this.audit.write({ kind: "task_create_error", agentId, error: String(err) });
      }
      outbound = {
        type: "task",
        text: `已记录任务：${action.title}${created?.id ? `（${created.id}）` : ""}`,
        intent: "task",
      };
      if (created?.id) this.audit.write({ kind: "task_create", agentId, taskId: created.id });
    } else if (action.type === "room_request") {
      const targets = this.#resolveMentions(action.body ?? "", agentId).filter((id) => id !== agentId);
      const kind = action.roomKind || (targets.length === 1 ? "dm" : "group");
      if (!targets.length || (kind === "dm" && targets.length !== 1)) {
        outbound = {
          type: "message",
          text:
            kind === "dm"
              ? "申请房间失败：私聊需要且只能 @ 一个 agent。"
              : "申请房间失败：需要 @ 至少一个 agent。",
          intent: "chat",
        };
      } else {
        const names = targets.map((id) => this.engine.agents.get(id)?.displayName ?? id);
        const name = kind === "group" ? action.roomName || `群聊-${names.join("-")}` : `私聊-${names[0]}`;
        outbound = {
          type: "room_request",
          text:
            kind === "dm"
              ? `申请创建私聊：${names.map((n) => `@${n}`).join("、")}（人类可见）`
              : `申请创建群「${name}」：${names.map((n) => `@${n}`).join("、")}`,
          intent: "room_request",
          room: { kind, name, agentIds: targets },
        };
      }
    } else if (action.type === "block" || action.type === "fail") {
      const failed = action.type === "fail";
      outbound = {
        type: failed ? "failed" : "blocked",
        text: `${failed ? "任务失败" : "任务阻塞"}：${action.reason}`,
        intent: failed ? "failed" : "blocked",
      };
      if (taskId) {
        try {
          const updated = await (failed ? this.onTaskFailed : this.onTaskBlocked)?.({
            taskId,
            agentId,
            roomId,
            summary: action.reason,
          });
          if (updated) {
            this.audit.write({ kind: failed ? "task_failed" : "task_blocked", agentId, taskId });
          }
        } catch (err) {
          this.audit.write({
            kind: "task_status_error",
            agentId,
            taskId,
            error: String(err),
          });
        }
      }
    } else if (action.type === "done") {
      outbound = { type: "done", reason: action.reason, text: action.reason, intent: "done" };
      if (taskId) {
        try {
          const done = await this.onTaskDone?.({
            taskId,
            agentId,
            roomId,
            summary: action.reason,
          });
          if (done) this.audit.write({ kind: "task_done", agentId, taskId });
        } catch (err) {
          this.audit.write({ kind: "task_done_error", agentId, taskId, error: String(err) });
        }
      }
    } else {
      outbound = { type: "message", text: action.text, intent: "chat" };
    }
    const mentions = this.#resolveMentions(outbound.text ?? "", agentId);
    const thread = this.engine.getThread(roomId, threadId);
    if (!thread || thread.floor.holder !== agentId) {
      this.audit.write({ kind: "stale_reply", agentId, reason: "floor lost", text: outbound.text });
      return null;
    }
    let messageId = `local-${fnv1a(agentId + ":" + triggerId)}`;

    if (outbound.type !== "pass" && (outbound.text ?? "").trim()) {
      const txnId = `ai-${fnv1a(agentId + ":" + triggerId)}`;
      try {
        const sent = await client.send(roomId, {
          threadId,
          text: outbound.text,
          intent: outbound.intent,
          tool: outbound.tool,
          room: outbound.room,
          mentions,
          txnId,
        });
        messageId = sent.eventId;
        this.processed.add(messageId);
      } catch (err) {
        this.audit.write({ kind: "send_error", agentId, error: String(err) });
        return this.engine.failTurn(roomId, threadId, agentId, `send: ${err.message}`).granted;
      }
    }

    const act = this.engine.agentAct(roomId, threadId, agentId, {
      id: messageId,
      ...outbound,
      mentions,
    });
    if (act.duplicate) return null;
    if (act.accepted === false) {
      this.audit.write({ kind: "stale_reply", agentId, reason: act.reason, text: outbound.text });
      return null;
    }
    this.audit.write({
      kind: "outbound",
      agentId,
      messageId,
      type: outbound.type,
      text: outbound.text,
      mentions,
      intent: outbound.intent,
    });
    this.onEvent?.({
      type: "turn_end",
      agentId,
      roomId,
      threadId,
      text: outbound.text ?? "",
      pass: outbound.type === "pass",
      messageId,
    });
    return act.granted ?? null;
  }

  /** Download room media once so agent runtimes can Read a local file. */
  async #cacheMedia(ev, client) {
    if (!this.mediaDir || !ev?.url || !client?.downloadMedia) return null;
    const cached = this.mediaCache.get(ev.url);
    if (cached) return cached;
    const match = String(ev.url).match(/^mxc:\/\/([^/]+)\/(.+)$/);
    if (!match) return null;
    const [, serverName, mediaId] = match;
    try {
      const media = await client.downloadMedia(serverName, mediaId);
      mkdirSync(this.mediaDir, { recursive: true });
      const ext = MEDIA_EXT[media.contentType] ?? (ev.msgtype === "m.image" ? ".img" : ".bin");
      const file = join(this.mediaDir, `${mediaId}${ext}`);
      if (!existsSync(file)) writeFileSync(file, media.body);
      const promptPath = file.replaceAll("\\", "/");
      this.mediaCache.set(ev.url, promptPath);
      return promptPath;
    } catch (err) {
      this.log(`[gateway] media cache failed: ${err.message}`);
      return null;
    }
  }

  #isAck(text) {
    const t = String(text ?? "").trim().toLowerCase();
    if (!t) return true;
    const stop = new Set([
      "ok",
      "okay",
      "k",
      "收到",
      "好的",
      "好",
      "谢谢",
      "谢了",
      "thanks",
      "thank you",
      "thx",
      "👍",
      "👌",
      "🙏",
    ]);
    return stop.has(t) || /^[\p{Extended_Pictographic}\s]+$/u.test(t);
  }

  /** Return a skip reason, or null when the agent may take a turn. */
  #triageSkip(agent, message, attention) {
    if (["direct_mention", "reply", "task_owner"].includes(attention)) return null;
    const cfg = { ...this.triage, ...(agent.triage ?? {}) };
    if (cfg.skipAcks && message.senderKind === "human" && this.#isAck(message.text)) {
      return "ack";
    }
    const now = this.now();
    const last = this.lastTurnAt.get(agent.id);
    if (last !== undefined && now - last < cfg.cooldownMs) return "cooldown";
    const times = (this.turnTimes.get(agent.id) ?? []).filter((t) => t > now - 3_600_000);
    this.turnTimes.set(agent.id, times);
    if (cfg.maxTurnsPerHour > 0 && times.length >= cfg.maxTurnsPerHour) return "hourly_cap";
    return null;
  }

  #recordTurn(agentId) {
    const now = this.now();
    this.lastTurnAt.set(agentId, now);
    const times = (this.turnTimes.get(agentId) ?? []).filter((t) => t > now - 3_600_000);
    times.push(now);
    this.turnTimes.set(agentId, times);
  }

  #resolveMentions(text, selfId) {
    const byLocalpart = new Map();
    const roleCounts = new Map();
    for (const [, agent] of this.engine.agents) {
      const aliases = [agent.role, ...(agent.roles ?? [])].filter(Boolean);
      for (const alias of aliases) roleCounts.set(alias, (roleCounts.get(alias) ?? 0) + 1);
    }
    for (const [id, agent] of this.engine.agents) {
      byLocalpart.set(String(id).replace(/^@/, "").split(":")[0], id);
      if (agent.displayName && !byLocalpart.has(agent.displayName)) byLocalpart.set(agent.displayName, id);
      // @reviewer / @coder resolves only when that role is unique.
      const aliases = [agent.role, ...(agent.roles ?? [])].filter(Boolean);
      for (const alias of aliases) {
        if (roleCounts.get(alias) === 1 && !byLocalpart.has(alias)) byLocalpart.set(alias, id);
      }
    }
    const out = new Set();
    for (const m of String(text ?? "").matchAll(/@([\p{L}\p{N}._=-]+)(?::([A-Za-z0-9.-]+))?/gu)) {
      const id = m[2] ? `@${m[1]}:${m[2]}` : byLocalpart.get(m[1]);
      if (id && id !== selfId) out.add(id);
    }
    return [...out];
  }

  #tick() {
    if (!this.running) return;
    const results = this.engine.tick(this.now());
    for (const r of results) {
      if (r.type === "turn_timeout") {
        this.audit.write({ kind: "turn_timeout", ...r });
        const runtime = this.runtimes.get(r.agentId);
        const session = this.sessions.get(r.agentId);
        Promise.resolve(runtime?.interrupt?.(session)).catch((err) =>
          this.log(`[gateway] interrupt ${r.agentId} failed: ${err.message}`),
        );
        this.log(`[gateway] turn timeout: ${r.agentId}`);
      } else if (r.type === "granted" && r.grant) {
        this.#enqueue(() => this.#dispatch(r.grant, new Set())).catch((err) =>
          this.log(`[gateway] dispatch after timeout failed: ${err.message}`),
        );
      } else if (r.type === "quiescent") {
        this.audit.write({ kind: "quiescent", thread: r.thread });
        this.log(`[gateway] quiescent: ${r.thread}`);
      } else {
        this.audit.write({ kind: r.type, ...r });
      }
    }
  }

  async health() {
    const agents = {};
    for (const [id, runtime] of this.runtimes) {
      agents[id] = { capabilities: runtime.capabilities?.(), health: await runtime.health?.() };
    }
    return {
      running: this.running,
      rooms: [...this.engine.rooms.keys()],
      since: Object.fromEntries(this.since),
      agents,
    };
  }
}
