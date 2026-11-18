// Agent IM MVP: control plane + gateway host + web API.
//
// One loopback process owns the human session, the agent workers and the
// web client. The browser talks to /api only; Matrix tokens never leave this
// process.
//
//   npm run start            # http://127.0.0.1:8790
//   npm run start -- --port 8890
//
// The web build lives in ../web/dist. For UI development run Vite there and
// proxy /api to this server.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, dataDir, defaultSystemPrompt, localpart } from "./store.mjs";
import { TaskStore } from "./tasks.mjs";
import { TEMPLATE_IDS, TEMPLATE_LIST, getTemplate, publicTemplate } from "./role-templates.mjs";
import { TEAM_LIST, getTeamTemplate, publicTeam, shortRoleName } from "./team-templates.mjs";
import { normalizeApprovedTools, toolArgsFor } from "./tool-policy.mjs";
import { createWorktree, mergeWorktree, removeWorktree } from "./worktrees.mjs";
import { createMatrixAdmin } from "./matrix-admin.mjs";
import { createHost } from "./gateway-host.mjs";
import { MatrixClient } from "../spike/src/matrix-transport.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, "..", "web", "dist");
const portArg = process.argv.indexOf("--port");
const port = Number(portArg >= 0 ? process.argv[portArg + 1] : (process.env.PORT ?? 8790));
const hostName = "127.0.0.1";
const log = (...args) => console.log(...args);

const store = new Store();
const tasks = new TaskStore(join(dataDir, "tasks.json"));
{
  const stale = tasks.markStale();
  if (stale) log(`[app] ${stale} active task(s) marked needsAttention after startup`);
}
const admin = createMatrixAdmin({
  homeserver: store.homeserver,
  registrationToken: store.registrationToken,
});

const kinds = new Map([[store.human.id, "human"]]);
for (const agent of store.agents) kinds.set(agent.id, "agent");

async function ensureHumanSession() {
  const client = new MatrixClient({
    homeserver: store.homeserver,
    userId: store.human.id,
    accessToken: store.human.accessToken,
    kinds,
  });
  try {
    await client.whoami();
    return client;
  } catch (err) {
    log(`[app] human token rejected (${err.message}); logging in again`);
    const session = await admin.login({ username: store.human.name, password: store.human.password });
    if (!session?.access_token)
      throw new Error("human login failed; check state.json or rerun setup-matrix", { cause: err });
    store.human.accessToken = session.access_token;
    store.save();
    return new MatrixClient({
      homeserver: store.homeserver,
      userId: store.human.id,
      accessToken: session.access_token,
      kinds,
    });
  }
}

const human = await ensureHumanSession();

async function reconcileRooms() {
  for (const room of store.rooms) {
    try {
      const members = await admin.members(human.accessToken, room.id);
      if (!members.length) continue;
      const others = members.filter((m) => m !== store.human.id);
      // Keep the stored kind: a group with one agent still has two members.
      const patch = { memberIds: members };
      if (room.kind === "dm" && others.length === 1) patch.peerId = others[0];
      store.updateRoom(room.id, patch);
    } catch (err) {
      log(`[app] room ${room.id} reconcile failed: ${err.message}`);
    }
  }
}

await reconcileRooms();

const liveClients = new Set();
function broadcastLive(event) {
  const data = JSON.stringify(event);
  for (const client of liveClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      liveClients.delete(client);
    }
  }
}

const host = await createHost({
  store,
  dataDir,
  kinds,
  onEvent: broadcastLive,
  onTaskCreate: taskCreatedByAgent,
  onTaskDone: taskDoneByAgent,
  onTaskBlocked: taskBlockedByAgent,
  onTaskFailed: taskFailedByAgent,
  onRoomRequest: roomRequestedByAgent,
  log,
});
await host.start();
let killed = false;
const pausedBeforeKill = new Map();

async function setKilled(kill) {
  if (kill) {
    if (killed) return { killed: true };
    pausedBeforeKill.clear();
    for (const agent of store.agents) {
      if (agent.status === "deleted") continue;
      pausedBeforeKill.set(agent.id, agent.status);
      agent.status = "paused";
      const engineAgent = host.engine.agents.get(agent.id);
      if (engineAgent) engineAgent.paused = true;
    }
    store.save();
    await host.kill();
    killed = true;
    log("[app] hard kill engaged");
    return { killed: true };
  }
  if (!killed) return { killed: false };
  killed = false;
  for (const agent of store.agents) {
    if (agent.status === "deleted") continue;
    const previous = pausedBeforeKill.get(agent.id) ?? "active";
    agent.status = previous === "paused" ? "paused" : "active";
    const engineAgent = host.engine.agents.get(agent.id);
    if (engineAgent) engineAgent.paused = agent.status === "paused";
  }
  pausedBeforeKill.clear();
  store.save();
  await host.resume();
  log("[app] hard kill released");
  return { killed: false };
}

// Dispatch due tasks once shortly after startup, then every 30s. Tasks are
// persisted, so a restart does not lose them; an active task is not re-sent.
const taskTimer = setInterval(tickTasks, 30_000);
taskTimer.unref?.();
const taskBootTimer = setTimeout(tickTasks, 5_000);
taskBootTimer.unref?.();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("request body too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const nameOf = new Map([store.human.id, ...store.agents.map((a) => a.id)].map((id) => [id, localpart(id)]));

function displayOf(id) {
  if (id === store.human.id) return store.human.displayName;
  return store.agent(id)?.displayName ?? localpart(id);
}

function mentionIdsIn(text, room) {
  const members = new Set(room.memberIds ?? []);
  const byName = new Map();
  const roleCounts = new Map();
  for (const id of members) {
    const agent = store.agent(id);
    for (const alias of [agent?.role, ...(agent?.roles ?? [])].filter(Boolean)) {
      roleCounts.set(alias, (roleCounts.get(alias) ?? 0) + 1);
    }
  }
  for (const id of members) {
    byName.set(localpart(id), id);
    const display = displayOf(id);
    if (display && !byName.has(display)) byName.set(display, id);
    const agent = store.agent(id);
    for (const alias of [agent?.role, ...(agent?.roles ?? [])].filter(Boolean)) {
      if (roleCounts.get(alias) === 1 && !byName.has(alias)) byName.set(alias, id);
    }
  }
  const out = [];
  for (const m of String(text).matchAll(/@([\p{L}\p{N}._=-]+)(?::([A-Za-z0-9.-]+))?/gu)) {
    const id = m[2] ? `@${m[1]}:${m[2]}` : byName.get(m[1]);
    if (id && members.has(id) && id !== store.human.id && !out.includes(id)) out.push(id);
  }
  return out;
}

async function roomMessagesPage(roomId, { limit = 100, from = null } = {}) {
  const page = await human.getMessagesPage(roomId, { limit, from });
  const reactions = {};
  for (const event of page.messages) {
    if (event.kind !== "reaction" || !event.targetId) continue;
    (reactions[event.targetId] ??= []).push({ key: event.key, sender: event.sender });
  }
  return {
    messages: page.messages.filter((m) => m.text && m.threadId === "main"),
    reactions,
    next: page.end ?? null,
  };
}

async function roomMessages(roomId, limit = 100) {
  return (await roomMessagesPage(roomId, { limit })).messages;
}

async function roomThreadPage(roomId, rootId, { limit = 100, from = null } = {}) {
  const root = await human.getEvent(roomId, rootId);
  if (!root?.text) throw Object.assign(new Error("thread root not found"), { status: 404 });
  const page = await human.getThread(roomId, rootId, { limit, from });
  const reactions = {};
  for (const event of page.messages) {
    if (event.kind !== "reaction" || !event.targetId) continue;
    (reactions[event.targetId] ??= []).push({ key: event.key, sender: event.sender });
  }
  return {
    root: messageView(root),
    messages: page.messages.filter((m) => m.text),
    reactions,
    next: page.next ?? null,
  };
}

function messageView(m) {
  return {
    id: m.id,
    sender: m.sender,
    senderName: nameOf.get(m.sender) ?? localpart(m.sender),
    displayName: displayOf(m.sender),
    kind: m.senderKind,
    msgtype: m.msgtype ?? "m.text",
    text: m.text,
    url: m.url ?? null,
    fileInfo: m.fileInfo ?? null,
    intent: m.intent ?? "chat",
    tool: m.tool ?? null,
    room: m.room ?? null,
    mentions: m.mentions,
    replyTo: m.replyTo ?? null,
    threadId: m.threadId ?? "main",
    createdAt: m.createdAt,
  };
}

async function roomSummary(room) {
  let messages = [];
  try {
    messages = await roomMessages(room.id, 100);
  } catch (err) {
    log(`[app] messages ${room.id} failed: ${err.message}`);
  }
  const last = messages.at(-1) ?? null;
  const humanName = String(store.human.name ?? "");
  const unreadMessages = messages.filter(
    (m) => m.sender !== store.human.id && (m.createdAt ?? 0) > (room.lastReadTs ?? 0),
  );
  const unread = unreadMessages.length;
  const mentionUnread = unreadMessages.filter(
    (m) =>
      m.mentions?.includes(store.human.id) ||
      (humanName &&
        String(m.text ?? "")
          .toLowerCase()
          .includes(`@${humanName.toLowerCase()}`)) ||
      ["ask_human", "tool_request", "room_request"].includes(m.intent),
  ).length;
  return {
    ...room,
    members: (room.memberIds ?? []).map((id) => ({
      id,
      name: nameOf.get(id) ?? localpart(id),
      displayName: displayOf(id),
      kind: id === store.human.id ? "human" : "agent",
      role: store.agent(id)?.role ?? null,
    })),
    lastMessage: last ? messageView(last) : null,
    unread,
    mentionUnread,
    activity: host.roomActivity(room.id),
  };
}

async function bootstrap() {
  const rooms = await Promise.all(store.rooms.map((room) => roomSummary(room)));
  rooms.sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0));
  const agents = store
    .publicAgents()
    .filter((a) => a.status !== "deleted")
    .map((a) => ({
      ...a,
      kind: "agent",
      status: host.agentStatus(a.id),
    }));
  return {
    human: { id: store.human.id, name: store.human.name, displayName: store.human.displayName },
    homeserver: store.homeserver,
    serverName: store.serverName,
    agents,
    rooms,
    policy: store.policy,
    totalUnread: rooms.reduce((n, r) => n + r.unread, 0),
    totalMentions: rooms.reduce((n, r) => n + r.mentionUnread, 0),
    killed,
  };
}

async function usageSummary() {
  const today = new Date().toISOString().slice(0, 10);
  const rows = new Map(
    store.agents.map((a) => [
      a.id,
      {
        id: a.id,
        name: a.name,
        displayName: a.displayName,
        todayTurns: 0,
        todayCost: 0,
        totalTurns: 0,
        totalCost: 0,
        dailyBudgetUsd: Number(a.dailyBudgetUsd) || 0,
        overBudget: false,
      },
    ]),
  );
  let text = "";
  try {
    text = await readFile(join(dataDir, "audit.jsonl"), "utf8");
  } catch {
    // no usage yet
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || entry.kind !== "usage" || !entry.agentId) continue;
    const row = rows.get(entry.agentId);
    if (!row) continue;
    const cost = Number(entry.costUsd) || 0;
    row.totalTurns += 1;
    row.totalCost += cost;
    if (String(entry.ts ?? "").slice(0, 10) === today) {
      row.todayTurns += 1;
      row.todayCost += cost;
    }
  }
  const agents = [...rows.values()];
  for (const row of agents) {
    row.overBudget = row.dailyBudgetUsd > 0 && row.todayCost >= row.dailyBudgetUsd;
  }
  return {
    today,
    agents,
    totalTurns: agents.reduce((n, a) => n + a.totalTurns, 0),
    totalCost: agents.reduce((n, a) => n + a.totalCost, 0),
    todayTurns: agents.reduce((n, a) => n + a.todayTurns, 0),
    todayCost: agents.reduce((n, a) => n + a.todayCost, 0),
  };
}

function validateUsername(username) {
  if (!/^[a-z0-9._=-]{1,32}$/.test(username)) {
    throw Object.assign(new Error("ID 只能是小写字母、数字和 . _ = -，长度 1–32"), { status: 400 });
  }
  if (store.agent(username)) throw Object.assign(new Error("这个 ID 已经存在"), { status: 409 });
}

const TOOL_MODES = new Set(["template", "full", "off"]);

function normalizeTriage(input = {}) {
  const out = {};
  if (input.cooldownMs !== undefined) {
    const value = Number(input.cooldownMs);
    if (!Number.isFinite(value) || value < 0 || value > 600_000)
      throw Object.assign(new Error("bad triage.cooldownMs"), { status: 400 });
    out.cooldownMs = value;
  }
  if (input.maxTurnsPerHour !== undefined) {
    const value = Number(input.maxTurnsPerHour);
    if (!Number.isInteger(value) || value < 0 || value > 1000)
      throw Object.assign(new Error("bad triage.maxTurnsPerHour"), { status: 400 });
    out.maxTurnsPerHour = value;
  }
  if (input.skipAcks !== undefined) out.skipAcks = Boolean(input.skipAcks);
  return out;
}

function toolsModeOf(body, fallback = "template") {
  if (TOOL_MODES.has(body.toolsMode)) return body.toolsMode;
  if (body.toolsEnabled === false) return "off";
  if (body.toolsEnabled === true) return "template";
  return fallback;
}

function parseRoles(body) {
  const list = Array.isArray(body.roles)
    ? body.roles.map(String).filter(Boolean)
    : String(body.roles ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  // Template ids are added by the server; keep them out of user tags.
  return list.filter((r) => !TEMPLATE_IDS.includes(r));
}

async function createAgent(body) {
  const username = String(body.username ?? "")
    .trim()
    .toLowerCase();
  const displayName = String(body.displayName ?? "").trim() || username;
  const runtime = body.runtime === "script" ? "script" : "claude";
  const templateId = TEMPLATE_IDS.includes(body.templateId) ? body.templateId : "generic";
  const template = getTemplate(templateId);
  const tags = parseRoles(body);
  const roles = [...new Set([template.id, ...tags])];
  const toolsMode = runtime === "claude" ? toolsModeOf(body, "template") : "off";
  const toolsEnabled = toolsMode !== "off";
  let cwd = null;
  if (body.cwd) {
    cwd = resolve(String(body.cwd));
    if (!existsSync(cwd)) throw Object.assign(new Error("cwd not found"), { status: 400 });
  }
  validateUsername(username);

  const password = randomBytes(18).toString("base64url");
  const account = await admin.registerOrLogin({ username, password, displayName });
  await admin.setDisplayName(account.accessToken, account.userId, displayName);

  const agent = {
    id: account.userId,
    name: username,
    username,
    displayName,
    password,
    accessToken: account.accessToken,
    runtime,
    role: template.role,
    templateId,
    script: runtime === "script" ? "reviewer" : undefined,
    roles,
    domains: [],
    systemPrompt:
      String(body.systemPrompt ?? "").trim() ||
      defaultSystemPrompt({ displayName, name: username, roles: [template.name, ...tags] }),
    wakePolicy: runtime === "script" ? "mention_only" : (template.defaultWakePolicy ?? "human_all"),
    toolsMode,
    toolsEnabled,
    dailyBudgetUsd: Math.max(0, Number(body.dailyBudgetUsd) || 0),
    triage: normalizeTriage(body.triage),
    extraArgs: toolArgsFor(template, toolsMode, runtime, []),
    approvedTools: [],
    status: "active",
    agentHome: join(dataDir, "agents", username),
    ...(cwd ? { cwd } : {}),
    createdAt: new Date().toISOString(),
  };
  store.addAgent(agent);
  await host.attachAgent(agent);
  log(`[app] agent created ${agent.id} template=${templateId} runtime=${runtime}`);
  return {
    id: agent.id,
    name: agent.name,
    displayName: agent.displayName,
    runtime: agent.runtime,
    role: agent.role,
    templateId: agent.templateId,
    templateName: template.name,
    mission: template.mission,
    roles: agent.roles,
    toolsMode: agent.toolsMode,
    toolsEnabled: agent.toolsEnabled,
    dailyBudgetUsd: Number(agent.dailyBudgetUsd ?? 0),
    triage: agent.triage ?? {},
    status: "idle",
  };
}

const WAKE_POLICIES = new Set(["human_all", "mention_only", "all", "mention_or_reply", "digest"]);

async function updateAgent(agentId, body) {
  const agent = store.agent(agentId);
  if (!agent || agent.status === "deleted")
    throw Object.assign(new Error("agent not found"), { status: 404 });
  const patch = {};
  if (typeof body.displayName === "string" && body.displayName.trim())
    patch.displayName = body.displayName.trim();

  const oldTemplateId = agent.templateId;
  let template = getTemplate(agent.templateId) ?? getTemplate("generic");
  let templateChanged = false;
  if (body.templateId !== undefined) {
    if (!TEMPLATE_IDS.includes(body.templateId))
      throw Object.assign(new Error("bad templateId"), { status: 400 });
    template = getTemplate(body.templateId);
    templateChanged = template.id !== oldTemplateId;
    patch.templateId = template.id;
    patch.role = template.role;
  }

  if (body.roles !== undefined) {
    patch.roles = [...new Set([template.id, ...parseRoles(body)])];
  } else if (templateChanged) {
    patch.roles = [...new Set([template.id, ...(agent.roles ?? []).filter((r) => r !== oldTemplateId)])];
  }

  if (body.wakePolicy !== undefined) {
    if (!WAKE_POLICIES.has(body.wakePolicy))
      throw Object.assign(new Error("bad wakePolicy"), { status: 400 });
    patch.wakePolicy = body.wakePolicy;
  }

  let toolsMode = agent.toolsMode ?? (agent.toolsEnabled ? "template" : "off");
  let approvedTools = Array.isArray(agent.approvedTools) ? agent.approvedTools : [];
  let toolsChanged = false;
  if (body.toolsMode !== undefined || body.toolsEnabled !== undefined) {
    const next = toolsModeOf(body, toolsMode);
    toolsChanged = next !== toolsMode;
    toolsMode = next;
  }
  if (body.approvedTools !== undefined) {
    const next = normalizeApprovedTools(body.approvedTools);
    patch.approvedTools = next;
    approvedTools = next;
    toolsChanged = true;
  }
  const toolsEnabled = toolsMode !== "off";
  if (toolsEnabled !== Boolean(agent.toolsEnabled)) {
    patch.toolsEnabled = toolsEnabled;
    toolsChanged = true;
  }
  if (templateChanged || toolsChanged) {
    patch.toolsMode = toolsMode;
    patch.toolsEnabled = toolsEnabled;
    patch.extraArgs = toolArgsFor(template, toolsMode, agent.runtime, approvedTools);
  }

  const promptChanged = typeof body.systemPrompt === "string" && body.systemPrompt !== agent.systemPrompt;
  if (typeof body.systemPrompt === "string") patch.systemPrompt = body.systemPrompt;
  if (body.dailyBudgetUsd !== undefined) {
    const value = Number(body.dailyBudgetUsd);
    if (!Number.isFinite(value) || value < 0)
      throw Object.assign(new Error("bad dailyBudgetUsd"), { status: 400 });
    patch.dailyBudgetUsd = value;
  }
  let cwdChanged = false;
  if (body.cwd !== undefined) {
    if (body.cwd) {
      const next = resolve(String(body.cwd));
      if (!existsSync(next)) throw Object.assign(new Error("cwd not found"), { status: 400 });
      patch.cwd = next;
    } else {
      patch.cwd = null;
    }
    cwdChanged = true;
  }
  if (body.status !== undefined) {
    if (!["active", "paused"].includes(body.status))
      throw Object.assign(new Error("bad status"), { status: 400 });
    patch.status = body.status;
  }
  if (body.triage !== undefined) {
    patch.triage = { ...(agent.triage ?? {}), ...normalizeTriage(body.triage) };
  }
  Object.assign(agent, patch);
  if (patch.displayName) {
    for (const room of store.rooms) {
      if (room.kind === "dm" && room.peerId === agent.id) room.name = patch.displayName;
    }
    await admin.setDisplayName(agent.accessToken, agent.id, patch.displayName).catch(() => {});
  }
  store.save();
  const engineAgent = host.engine.agents.get(agent.id);
  if (engineAgent) {
    if (patch.displayName) engineAgent.displayName = patch.displayName;
    if (patch.roles) engineAgent.roles = patch.roles;
    if (patch.wakePolicy) engineAgent.wakePolicy = patch.wakePolicy;
    if (patch.status) engineAgent.paused = patch.status === "paused";
    if (templateChanged) engineAgent.role = template.role;
  }
  if (promptChanged || templateChanged || toolsChanged || cwdChanged) await host.updateAgent(agent);
  log(`[app] agent updated ${agent.id}`);
  return {
    id: agent.id,
    name: agent.name,
    displayName: agent.displayName,
    runtime: agent.runtime,
    role: agent.role,
    templateId: agent.templateId,
    templateName: template.name,
    mission: template.mission,
    roles: agent.roles,
    toolsMode: agent.toolsMode,
    toolsEnabled: Boolean(agent.toolsEnabled),
    dailyBudgetUsd: Number(agent.dailyBudgetUsd ?? 0),
    triage: agent.triage ?? {},
    approvedTools: agent.approvedTools ?? [],
    wakePolicy: agent.wakePolicy,
    status: host.agentStatus(agent.id),
  };
}

async function approveTool(agentId, body) {
  const agent = store.agent(agentId);
  if (!agent) throw Object.assign(new Error("agent not found"), { status: 404 });
  const room = store.room(String(body.roomId ?? ""));
  if (!room) throw Object.assign(new Error("room not found"), { status: 404 });
  const tool = String(body.tool ?? "").trim() || "工具";
  const template = getTemplate(agent.templateId);
  agent.approvedTools = normalizeApprovedTools([...(agent.approvedTools ?? []), tool]);
  agent.extraArgs = toolArgsFor(template, agent.toolsMode, agent.runtime, agent.approvedTools);
  store.save();
  await host.updateAgent(agent);
  store.markRead(room.id, Date.now());
  const sent = await human.send(room.id, {
    threadId: "main",
    text: `已批准使用 ${tool}，请继续完成刚才的任务。`,
    mentions: [agent.id],
  });
  log(`[app] tool approved ${agent.id} ${tool}`);
  return { ok: true, eventId: sent.eventId, toolsMode: agent.toolsMode, approvedTools: agent.approvedTools };
}

const INTAKE_PROMPT = `你是 Agent IM 的需求评估顾问。人类会把一个问题或想法交给你。
先重述目标、约束和验收标准；再判断应该单点解决还是小团队运营。
- 默认优先 single；只有独立性、风险、不同专业或并行收益足够时才推荐 pair/squad。
- 明确说明团队多花多少成本、换来什么；不要为了热闹组队。
- 不确定时先给最小验证，而不是直接建大团队。
输出结构：
1. 问题重述与验收
2. 选项与推荐（single / pair / squad）
3. 理由与风险
4. 若推荐团队：角色与分工
5. 最小下一步
最后单独一行输出：RECOMMEND: single 或 RECOMMEND: pair 或 RECOMMEND: squad。
不要自己创建房间或团队；人类批准后再做。`;

async function ensureIntakeAgent() {
  let agent = store.agent("intake");
  if (agent && agent.status !== "deleted") {
    if (agent.status === "paused") {
      agent.status = "active";
      store.save();
      const engineAgent = host.engine.agents.get(agent.id);
      if (engineAgent) engineAgent.paused = false;
    }
    return agent;
  }
  const username = agent ? `intake-${Date.now().toString().slice(-6)}` : "intake";
  agent = await createAgent({
    username,
    displayName: "需求顾问",
    runtime: "claude",
    templateId: "facilitator",
    toolsMode: "off",
    roles: "intake,需求评估",
    systemPrompt: INTAKE_PROMPT,
    wakePolicy: "human_all",
  });
  return agent;
}

async function setAllPaused(paused) {
  let count = 0;
  for (const agent of store.agents) {
    if (agent.status === "deleted") continue;
    agent.status = paused ? "paused" : "active";
    const engineAgent = host.engine.agents.get(agent.id);
    if (engineAgent) engineAgent.paused = paused;
    count += 1;
  }
  store.save();
  log(`[app] pause-all=${paused} agents=${count}`);
  return { ok: true, paused, count };
}

function agentCard(agent) {
  const template = getTemplate(agent.templateId) ?? getTemplate(agent.role) ?? getTemplate("generic");
  return {
    id: agent.id,
    name: agent.name,
    displayName: agent.displayName,
    runtime: agent.runtime,
    role: agent.role,
    roles: agent.roles ?? [],
    domains: agent.domains ?? [],
    templateId: template.id,
    templateName: template.name,
    mission: template.mission,
    responsibilities: template.responsibilities ?? [],
    boundaries: template.boundaries ?? [],
    decisionRights: template.decisionRights ?? [],
    thinkingStyle: template.thinkingStyle ?? [],
    communicationStyle: template.communicationStyle ?? [],
    tools: template.tools ?? null,
    toolsMode: agent.toolsMode,
    knowledgePacks: template.knowledgePacks ?? [],
    handoff: template.handoff ?? [],
    successCriteria: template.successCriteria ?? [],
    status: host.agentStatus(agent.id),
    capabilities: host.runtimes.get(agent.id)?.capabilities?.() ?? null,
  };
}

function directory(searchParams) {
  const q = String(searchParams.get("q") ?? "")
    .trim()
    .toLowerCase();
  return store.agents
    .filter((agent) => agent.status !== "deleted")
    .map(agentCard)
    .filter((card) => {
      if (!q) return true;
      return [
        card.id,
        card.name,
        card.displayName,
        card.role,
        card.templateId,
        card.templateName,
        card.mission,
        ...(card.roles ?? []),
        ...(card.domains ?? []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    })
    .slice(0, 100);
}

async function alertsSummary() {
  const since = Date.now() - 24 * 60 * 60_000;
  const approvals = [];
  for (const room of store.rooms) {
    let messages;
    try {
      messages = await roomMessages(room.id, 100);
    } catch {
      continue;
    }
    for (const message of messages) {
      if (!["tool_request", "room_request"].includes(message.intent)) continue;
      if ((message.createdAt ?? 0) < since) continue;
      approvals.push({
        room: { id: room.id, name: room.name, kind: room.kind },
        message: messageView(message),
      });
    }
  }
  approvals.sort((a, b) => (b.message.createdAt ?? 0) - (a.message.createdAt ?? 0));
  const taskRows = tasks
    .list()
    .filter((task) => task.needsAttention || ["failed", "blocked"].includes(task.status))
    .map(taskView);
  const usage = await usageSummary();
  return {
    approvals: approvals.slice(0, 50),
    tasks: taskRows.slice(0, 50),
    budget: usage.agents.filter((row) => row.overBudget),
    system: {
      killed,
      gatewayRunning: Boolean(host.gateway.running),
      pausedAgents: store.agents.filter((a) => a.status === "paused").length,
    },
  };
}

async function auditEvents(searchParams) {
  const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit")) || 200));
  const kind = String(searchParams.get("kind") ?? "").trim();
  const agentId = String(searchParams.get("agentId") ?? "").trim();
  let text;
  try {
    text = await readFile(join(dataDir, "audit.jsonl"), "utf8");
  } catch {
    return { events: [] };
  }
  const events = [];
  for (const line of text.trim().split("\n").slice(-5000)) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (kind && entry.kind !== kind) continue;
    if (agentId && entry.agentId !== agentId) continue;
    let detail = entry.text ?? entry.reason ?? entry.error ?? "";
    if (entry.input && typeof entry.input === "object") {
      detail = entry.input.command ?? entry.input.file_path ?? entry.input.pattern ?? detail;
    }
    events.push({
      ts: entry.ts ?? null,
      kind: entry.kind ?? "event",
      agentId: entry.agentId ?? null,
      roomId: entry.roomId ?? null,
      type: entry.type ?? null,
      name: entry.name ?? null,
      detail: String(detail ?? "").slice(0, 500),
      costUsd: entry.costUsd ?? null,
      reason: entry.reason ?? null,
    });
  }
  return { events: events.reverse().slice(0, limit) };
}

function taskView(task) {
  const owner = task.owner ? store.agent(task.owner) : null;
  const room = task.roomId ? store.room(task.roomId) : null;
  return {
    ...task,
    ownerName: owner?.displayName ?? null,
    roomName: room?.name ?? null,
  };
}

function taskAgent(agentId) {
  if (!agentId) return null;
  const agent = store.agent(agentId);
  if (!agent || agent.status === "deleted")
    throw Object.assign(new Error("agent not found"), { status: 404 });
  return agent;
}

function taskRoom(roomId) {
  if (!roomId) throw Object.assign(new Error("roomId required"), { status: 400 });
  const room = store.room(roomId);
  if (!room) throw Object.assign(new Error("room not found"), { status: 404 });
  return room;
}

async function roomRequestedByAgent({ agentId, roomKind, roomName, targets }) {
  if (store.policy.agentRooms !== "open") return null;
  const requester = store.agent(agentId);
  if (!requester || requester.status === "deleted") return null;
  const ids = [...new Set([agentId, ...(targets ?? [])])].filter((id) => {
    const agent = store.agent(id);
    return agent && agent.status !== "deleted";
  });
  if (ids.length < 2) return null;
  const names = ids.map((id) => store.agent(id)?.displayName ?? localpart(id));
  const name =
    String(roomName || "").trim() ||
    (roomKind === "dm" ? `私聊-${names[1]}` : `群聊-${names.slice(1).join("-")}`);
  try {
    const result = await createGroup({ name, agentIds: ids });
    log(`[app] agent room request auto-created ${result.room.id} by ${agentId}`);
    return { room: result.room, existing: result.existing };
  } catch (err) {
    log(`[app] agent room request failed: ${err.message}`);
    return null;
  }
}

async function createAgentWorktree(agentId, body) {
  const agent = store.agent(agentId);
  if (!agent || agent.status === "deleted")
    throw Object.assign(new Error("agent not found"), { status: 404 });
  if (agent.worktree) throw Object.assign(new Error("agent 已有 worktree，先移除"), { status: 409 });
  if (host.agentStatus(agent.id) === "working")
    throw Object.assign(new Error("agent 正在运行，等空闲或先暂停"), { status: 409 });
  const repoPath = String(body.repoPath ?? "").trim();
  if (!repoPath) throw Object.assign(new Error("repoPath required"), { status: 400 });
  try {
    const wt = createWorktree({
      repoPath,
      agentName: agent.name,
      base: String(body.base ?? "HEAD"),
      rootDir: join(dataDir, "worktrees"),
    });
    agent.cwd = wt.path;
    agent.worktree = wt;
    store.save();
    await host.updateAgent(agent);
    log(`[app] agent ${agent.id} worktree ${wt.branch} -> ${wt.path}`);
    return { ok: true, ...wt };
  } catch (err) {
    throw Object.assign(new Error(`worktree: ${err.message}`), { status: 400 });
  }
}

async function removeAgentWorktree(agentId) {
  const agent = store.agent(agentId);
  if (!agent || agent.status === "deleted")
    throw Object.assign(new Error("agent not found"), { status: 404 });
  if (!agent.worktree) throw Object.assign(new Error("agent has no worktree"), { status: 404 });
  if (host.agentStatus(agent.id) === "working")
    throw Object.assign(new Error("agent 正在运行，等空闲或先暂停"), { status: 409 });
  try {
    removeWorktree(agent.worktree);
  } catch (err) {
    log(`[app] remove worktree failed: ${err.message}`);
  }
  agent.cwd = null;
  delete agent.worktree;
  store.save();
  await host.updateAgent(agent);
  return { ok: true };
}

async function mergeAgentWorktree(agentId, body) {
  const agent = store.agent(agentId);
  if (!agent || agent.status === "deleted")
    throw Object.assign(new Error("agent not found"), { status: 404 });
  if (!agent.worktree) throw Object.assign(new Error("agent has no worktree"), { status: 404 });
  if (host.agentStatus(agent.id) === "working")
    throw Object.assign(new Error("agent 正在运行，等空闲或先暂停"), { status: 409 });
  try {
    const output = mergeWorktree({
      repo: agent.worktree.repo,
      branch: agent.worktree.branch,
      message: String(body.message ?? `merge ${agent.worktree.branch}`),
    });
    log(`[app] merged worktree ${agent.worktree.branch} for ${agent.id}`);
    return { ok: true, output };
  } catch (err) {
    throw Object.assign(new Error(`merge: ${err.message}`), { status: 409 });
  }
}

async function taskCreatedByAgent({ agentId, roomId, title }) {
  taskAgent(agentId);
  taskRoom(roomId);
  const clean = String(title ?? "").trim();
  if (!clean) throw new Error("empty task title");
  const task = tasks.create({
    title: clean,
    description: `由 ${agentId} 通过 TASK: 标记创建`,
    owner: agentId,
    roomId,
    dueAt: null,
    createdBy: agentId,
  });
  tasks.addCheckpoint(task.id, `created via TASK by ${agentId}`, agentId);
  log(`[app] task created by agent ${agentId}: ${task.id} ${clean}`);
  return taskView(task);
}

async function taskDoneByAgent({ taskId, agentId, summary }) {
  const task = tasks.get(taskId);
  if (!task) return null;
  if (task.owner && task.owner !== agentId) {
    tasks.addCheckpoint(task.id, `DONE ignored: ${agentId} is not owner`, agentId);
    return null;
  }
  if (task.intervalMinutes > 0) {
    tasks.addCheckpoint(task.id, `agent DONE: ${summary}`, agentId);
    return null;
  }
  if (task.status === "done" || task.status === "cancelled") return null;
  tasks.addCheckpoint(task.id, `agent DONE: ${summary}`, agentId);
  const updated = tasks.update(task.id, { status: "done" });
  return updated ? taskView(updated) : null;
}

async function setTaskStatusByAgent({ taskId, agentId, summary, status }) {
  const task = tasks.get(taskId);
  if (!task) return null;
  if (task.owner && task.owner !== agentId) {
    tasks.addCheckpoint(task.id, `${status.toUpperCase()} ignored: ${agentId} is not owner`, agentId);
    return null;
  }
  if (task.status === "done" || task.status === "cancelled") return null;
  tasks.addCheckpoint(task.id, `agent ${status.toUpperCase()}: ${summary}`, agentId);
  const updated = tasks.update(task.id, { status, lastError: summary });
  return updated ? taskView(updated) : null;
}

async function taskBlockedByAgent(payload) {
  return setTaskStatusByAgent({ ...payload, status: "blocked" });
}

async function taskFailedByAgent({ taskId, agentId, summary }) {
  const task = tasks.get(taskId);
  if (!task) return null;
  if (task.owner && task.owner !== agentId) {
    tasks.addCheckpoint(task.id, `FAIL ignored: ${agentId} is not owner`, agentId);
    return null;
  }
  if (task.status === "done" || task.status === "cancelled") return null;
  tasks.addCheckpoint(task.id, `agent FAIL: ${summary}`, agentId);
  const updated = tasks.scheduleRetry(task.id, summary);
  return updated ? taskView(updated) : null;
}

async function createTask(body) {
  try {
    taskAgent(body.owner);
    taskRoom(body.roomId);
    const task = tasks.create({
      title: body.title,
      description: body.description,
      owner: body.owner,
      roomId: body.roomId,
      dueAt: body.dueAt,
      intervalMinutes: body.intervalMinutes,
      cron: body.cron,
      maxRetries: body.maxRetries,
      retryBackoffMinutes: body.retryBackoffMinutes,
      priority: body.priority,
      createdBy: store.human.id,
    });
    return taskView(task);
  } catch (err) {
    if (err.status) throw err;
    throw Object.assign(new Error(err.message), { status: 400 });
  }
}

async function updateTask(taskId, body) {
  try {
    if (body.owner !== undefined) taskAgent(body.owner);
    if (body.roomId !== undefined) taskRoom(body.roomId);
    const task = tasks.update(taskId, body);
    if (!task) throw Object.assign(new Error("task not found"), { status: 404 });
    return taskView(task);
  } catch (err) {
    if (err.status) throw err;
    throw Object.assign(new Error(err.message), { status: 400 });
  }
}

async function addTaskCheckpoint(taskId, body) {
  try {
    const task = tasks.addCheckpoint(taskId, body.text, store.human.id);
    if (!task) throw Object.assign(new Error("task not found"), { status: 404 });
    return taskView(task);
  } catch (err) {
    if (err.status) throw err;
    throw Object.assign(new Error(err.message), { status: 400 });
  }
}

async function dispatchTask(task, by = "human") {
  const room = taskRoom(task.roomId);
  const owner = taskAgent(task.owner);
  if (owner?.status === "paused") {
    tasks.update(task.id, { status: "blocked", lastError: "owner paused" });
    throw Object.assign(new Error("owner 已暂停，先恢复再派发"), { status: 409 });
  }
  const mention = owner ? `@${owner.displayName} ` : "";
  const text = `任务到期：${task.title}\n${task.description || ""}\n${mention}请接手；完成后把任务标记为 done。`;
  tasks.dispatch(task.id, by);
  try {
    const sent = await human.send(room.id, {
      threadId: "main",
      text,
      mentions: owner ? [owner.id] : [],
      taskId: task.id,
      taskOwner: task.owner,
    });
    log(`[app] task dispatched ${task.id} room=${room.id}`);
    host.gateway.audit.write({
      kind: "task_dispatch",
      taskId: task.id,
      agentId: task.owner ?? null,
      roomId: room.id,
      eventId: sent.eventId,
      status: tasks.get(task.id)?.status ?? null,
    });
    return { task: taskView(tasks.get(task.id)), eventId: sent.eventId };
  } catch (err) {
    tasks.scheduleRetry(task.id, `dispatch failed: ${err.message}`);
    host.gateway.audit.write({
      kind: "task_dispatch_error",
      taskId: task.id,
      agentId: task.owner ?? null,
      roomId: room.id,
      error: err.message,
    });
    throw Object.assign(new Error(`task dispatch failed: ${err.message}`), { status: 502 });
  }
}

async function dispatchTaskById(taskId, by) {
  const task = tasks.get(taskId);
  if (!task) throw Object.assign(new Error("task not found"), { status: 404 });
  if (!["pending", "blocked"].includes(task.status))
    throw Object.assign(new Error(`任务状态为 ${task.status}，不能重复派发`), { status: 409 });
  return dispatchTask(task, by);
}

let taskTickRunning = false;
async function tickTasks() {
  if (taskTickRunning) return;
  taskTickRunning = true;
  try {
    for (const task of tasks.due()) {
      try {
        await dispatchTask(task, "scheduler");
      } catch (err) {
        log(`[app] task dispatch ${task.id} failed: ${err.message}`);
      }
    }
  } finally {
    taskTickRunning = false;
  }
}

async function intake(body) {
  const problem = String(body.problem ?? "").trim();
  if (problem.length < 5) throw Object.assign(new Error("请把问题描述得具体一点"), { status: 400 });
  if (problem.length > 8000)
    throw Object.assign(new Error("问题太长，请压缩到 8000 字以内"), { status: 400 });
  const agent = await ensureIntakeAgent();
  const dm = await createDm({ agentId: agent.id });
  const prompt = `请评估下面这个问题，给出“单点解决 / 小团队运营”的建议。\n\n${problem}\n\n请按你的 intake 结构输出，最后给出 RECOMMEND 标签。`;
  await human.send(dm.room.id, {
    threadId: "main",
    text: prompt,
    mentions: [agent.id],
  });
  store.markRead(dm.room.id, Date.now());
  log(`[app] intake ${agent.id} room=${dm.room.id}`);
  return { room: dm.room, agent: { id: agent.id, displayName: agent.displayName } };
}

async function createTeam(teamId, body) {
  const team = getTeamTemplate(teamId);
  if (!team) throw Object.assign(new Error("team template not found"), { status: 404 });
  const prefix = String(body.prefix ?? "squad")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,19}$/.test(prefix))
    throw Object.assign(new Error("prefix 只能是小写字母/数字/-，1–20 位"), { status: 400 });
  const usernames = team.roles.map((roleId) => `${prefix}-${shortRoleName(roleId)}`);
  for (const username of usernames) {
    if (store.agent(username))
      throw Object.assign(new Error(`ID 已存在：${username}，换一个 prefix`), { status: 409 });
  }
  const agents = [];
  for (let i = 0; i < team.roles.length; i++) {
    const roleId = team.roles[i];
    const template = getTemplate(roleId);
    if (!template) throw new Error(`unknown role template: ${roleId}`);
    const agent = await createAgent({
      username: usernames[i],
      displayName: template.name,
      runtime: "claude",
      templateId: roleId,
      toolsMode: "template",
      roles: "",
      systemPrompt: "",
    });
    agents.push(agent);
  }
  const group = await createGroup({
    name: String(body.groupName ?? "").trim() || team.groupName,
    agentIds: agents.map((a) => a.id),
  });
  log(`[app] team created ${team.id} prefix=${prefix} agents=${agents.length}`);
  return { team: team.id, group, agents };
}

async function createDm(body) {
  const agent = store.agent(String(body.agentId ?? ""));
  if (!agent || agent.status === "deleted")
    throw Object.assign(new Error("agent not found"), { status: 404 });
  const existing = store.dmWith(agent.id);
  if (existing) return { room: await roomSummary(existing), existing: true };

  const roomId = await admin.createRoom(store.human.accessToken, {
    name: agent.displayName,
    invite: [agent.id],
    isDirect: true,
  });
  await admin.join(agent.accessToken, roomId);
  const room = store.addRoom({
    id: roomId,
    kind: "dm",
    mode: "brief",
    name: agent.displayName,
    peerId: agent.id,
    memberIds: [store.human.id, agent.id],
    createdAt: new Date().toISOString(),
    lastReadTs: Date.now(),
  });
  await host.attachRoom(roomId, "brief");
  log(`[app] dm created ${room.id} with ${agent.id}`);
  return { room: await roomSummary(room), existing: false };
}

async function createGroup(body) {
  const name = String(body.name ?? "").trim();
  const rawIds = Array.isArray(body.agentIds) ? body.agentIds : [];
  const ids = [...new Set(rawIds.map(String))];
  if (!name) throw Object.assign(new Error("群聊需要一个名字"), { status: 400 });
  if (!ids.length) throw Object.assign(new Error("至少选择一个 agent"), { status: 400 });
  const agents = ids.map((id) => store.agent(id)).filter((a) => a && a.status !== "deleted");
  if (agents.length !== ids.length) throw Object.assign(new Error("有 agent 不存在"), { status: 404 });

  const memberIds = [store.human.id, ...agents.map((a) => a.id)];
  const memberSet = new Set(memberIds);
  const existing = store.rooms.find(
    (room) =>
      room.kind === "group" &&
      room.name === name &&
      room.memberIds.length === memberSet.size &&
      room.memberIds.every((id) => memberSet.has(id)),
  );
  if (existing) return { room: await roomSummary(existing), existing: true };

  const roomId = await admin.createRoom(store.human.accessToken, {
    name,
    invite: agents.map((a) => a.id),
  });
  for (const agent of agents) await admin.join(agent.accessToken, roomId);
  const room = store.addRoom({
    id: roomId,
    kind: "group",
    mode: "brief",
    name,
    peerId: null,
    memberIds,
    createdAt: new Date().toISOString(),
    lastReadTs: Date.now(),
  });
  await host.attachRoom(roomId, "brief");
  log(`[app] group created ${room.id} "${name}" agents=${agents.length}`);
  return { room: await roomSummary(room), existing: false };
}

async function updateRoom(roomId, body) {
  const room = store.room(roomId);
  if (!room) throw Object.assign(new Error("room not found"), { status: 404 });
  if (body.mode !== undefined) {
    const mode = body.mode === "discussion" ? "discussion" : "brief";
    store.updateRoom(roomId, { mode });
    host.setRoomMode(roomId, mode);
  }
  return roomSummary(store.room(roomId));
}

async function addMembers(roomId, body) {
  const room = store.room(roomId);
  if (!room) throw Object.assign(new Error("room not found"), { status: 404 });
  if (room.kind === "dm") throw Object.assign(new Error("私聊不能加人；请新建群聊"), { status: 400 });
  const raw = Array.isArray(body.agentIds) ? body.agentIds : [];
  const ids = [...new Set(raw.map(String))].filter((id) => !room.memberIds.includes(id));
  const agents = ids.map((id) => store.agent(id)).filter(Boolean);
  if (!agents.length) return { room: await roomSummary(room), added: [] };
  for (const agent of agents) {
    await admin.invite(store.human.accessToken, roomId, agent.id);
    await admin.join(agent.accessToken, roomId);
  }
  store.updateRoom(roomId, {
    memberIds: [...new Set([...room.memberIds, ...agents.map((a) => a.id)])],
  });
  await host.syncRoom(roomId);
  log(`[app] room ${roomId} invited ${agents.map((a) => a.id).join(",")}`);
  return { room: await roomSummary(store.room(roomId)), added: agents.map((a) => a.id) };
}

async function removeMember(roomId, agentId) {
  const room = store.room(roomId);
  if (!room) throw Object.assign(new Error("room not found"), { status: 404 });
  if (room.kind === "dm") throw Object.assign(new Error("私聊请直接删除会话"), { status: 400 });
  const agent = store.agent(agentId);
  if (!agent || agent.status === "deleted")
    throw Object.assign(new Error("agent not found"), { status: 404 });
  if (!room.memberIds.includes(agent.id))
    throw Object.assign(new Error("agent 不在这个房间里"), { status: 404 });
  if (host.agentStatus(agent.id) === "working")
    throw Object.assign(new Error("agent 正在运行，等这一轮结束或先暂停再移除"), { status: 409 });
  await admin.leave(agent.accessToken, roomId);
  room.memberIds = room.memberIds.filter((id) => id !== agent.id);
  store.save();
  await host.removeRoomMember(roomId, agent.id);
  log(`[app] room ${roomId} removed ${agent.id}`);
  return { room: await roomSummary(store.room(roomId)), removed: agent.id };
}

async function deleteAgent(agentId) {
  const agent = store.agent(agentId);
  if (!agent || agent.status === "deleted")
    throw Object.assign(new Error("agent not found"), { status: 404 });
  if (host.agentStatus(agent.id) === "working")
    throw Object.assign(new Error("agent 正在运行，等这一轮结束或先暂停再删除"), { status: 409 });

  const rooms = store.rooms.filter((room) => room.memberIds.includes(agent.id));
  for (const room of rooms) {
    if (room.kind === "dm" && room.peerId === agent.id) {
      // A DM exists only for this agent; remove the room from the human's list.
      await deleteRoom(room.id).catch((err) => log(`[app] delete DM ${room.id} failed: ${err.message}`));
      continue;
    }
    await admin
      .leave(agent.accessToken, room.id)
      .catch((err) => log(`[app] ${agent.name} leave ${room.id} failed: ${err.message}`));
    room.memberIds = room.memberIds.filter((id) => id !== agent.id);
    store.save();
  }

  agent.status = "deleted";
  agent.deletedAt = new Date().toISOString();
  store.save();
  await host.removeAgent(agent.id);
  log(`[app] agent removed ${agent.id}`);
  return { ok: true };
}

async function deleteRoom(roomId) {
  const room = store.room(roomId);
  if (!room) throw Object.assign(new Error("room not found"), { status: 404 });
  await admin
    .leave(store.human.accessToken, roomId)
    .catch((err) => log(`[app] human leave failed: ${err.message}`));
  for (const memberId of room.memberIds) {
    const agent = store.agent(memberId);
    if (!agent) continue;
    await admin
      .leave(agent.accessToken, roomId)
      .catch((err) => log(`[app] ${agent.name} leave failed: ${err.message}`));
  }
  await host.removeRoom(roomId);
  store.removeRoom(roomId);
  log(`[app] room removed ${roomId}`);
  return { ok: true };
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]

  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
    liveClients.add(res);
    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        // closed
      }
    }, 20_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      liveClients.delete(res);
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    return json(res, 200, await bootstrap());
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    const health = await host.gateway.health();
    return json(res, 200, { ok: true, running: health.running, killed, rooms: health.rooms });
  }

  if (req.method === "GET" && url.pathname === "/api/role-templates") {
    return json(res, 200, { templates: TEMPLATE_LIST.map(publicTemplate) });
  }

  if (req.method === "GET" && url.pathname === "/api/team-templates") {
    return json(res, 200, { teams: TEAM_LIST.map(publicTeam) });
  }

  if (req.method === "GET" && url.pathname === "/api/directory") {
    return json(res, 200, { agents: directory(url.searchParams) });
  }

  if (req.method === "GET" && parts[1] === "agents" && parts[3] === "card" && parts.length === 4) {
    const agent = store.agent(decodeURIComponent(parts[2]));
    if (!agent || agent.status === "deleted") return json(res, 404, { error: "agent not found" });
    return json(res, 200, { card: agentCard(agent) });
  }

  if (req.method === "PATCH" && url.pathname === "/api/settings") {
    const body = await readBody(req);
    const patch = {};
    for (const key of ["agentRooms", "agentContact"]) {
      if (body.policy?.[key] === undefined) continue;
      if (!["open", "approval"].includes(body.policy[key])) {
        throw Object.assign(new Error(`bad policy.${key}`), { status: 400 });
      }
      patch[key] = body.policy[key];
    }
    return json(res, 200, { policy: store.updatePolicy(patch) });
  }

  if (req.method === "POST" && parts[1] === "team-templates" && parts[3] === "create" && parts.length === 4) {
    const teamId = decodeURIComponent(parts[2]);
    const body = await readBody(req);
    return json(res, 200, await createTeam(teamId, body));
  }

  if (req.method === "POST" && url.pathname === "/api/intake") {
    const body = await readBody(req);
    return json(res, 200, await intake(body));
  }

  if (req.method === "GET" && url.pathname === "/api/usage") {
    return json(res, 200, await usageSummary());
  }

  if (req.method === "GET" && url.pathname === "/api/alerts") {
    return json(res, 200, await alertsSummary());
  }

  if (req.method === "GET" && url.pathname === "/api/audit") {
    return json(res, 200, await auditEvents(url.searchParams));
  }

  if (req.method === "GET" && url.pathname === "/api/audit/export") {
    let text;
    try {
      text = await readFile(join(dataDir, "audit.jsonl"), "utf8");
    } catch {
      text = "";
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="agentim-audit-${stamp}.jsonl"`,
      "Cache-Control": "no-store",
    });
    res.end(text);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/pause-all") {
    const body = await readBody(req);
    return json(res, 200, await setAllPaused(Boolean(body.paused)));
  }

  if (req.method === "POST" && url.pathname === "/api/admin/kill") {
    const body = await readBody(req);
    return json(res, 200, await setKilled(Boolean(body.kill)));
  }

  if (req.method === "GET" && url.pathname === "/api/tasks") {
    return json(res, 200, { tasks: tasks.list().map(taskView) });
  }

  if (req.method === "POST" && url.pathname === "/api/tasks") {
    const body = await readBody(req);
    return json(res, 200, await createTask(body));
  }

  if (req.method === "PATCH" && parts[1] === "tasks" && parts.length === 3) {
    const body = await readBody(req);
    return json(res, 200, await updateTask(decodeURIComponent(parts[2]), body));
  }

  if (req.method === "POST" && parts[1] === "tasks" && parts[3] === "checkpoints" && parts.length === 4) {
    const body = await readBody(req);
    return json(res, 200, await addTaskCheckpoint(decodeURIComponent(parts[2]), body));
  }

  if (req.method === "POST" && parts[1] === "tasks" && parts[3] === "dispatch" && parts.length === 4) {
    return json(res, 200, await dispatchTaskById(decodeURIComponent(parts[2]), "human"));
  }

  if (req.method === "GET" && url.pathname === "/api/search") {
    const q = String(url.searchParams.get("q") ?? "").trim();
    if (!q) return json(res, 200, { query: "", results: [] });
    const needle = q.toLowerCase();
    const results = [];
    for (const room of store.rooms) {
      let messages = [];
      try {
        messages = await roomMessages(room.id, 100);
      } catch {
        // a room may be unreadable; skip it
      }
      for (const m of messages) {
        if (!m.text?.toLowerCase().includes(needle)) continue;
        results.push({
          room: { id: room.id, kind: room.kind, name: room.name },
          message: messageView(m),
        });
      }
    }
    results.sort((a, b) => (b.message.createdAt ?? 0) - (a.message.createdAt ?? 0));
    return json(res, 200, { query: q, results: results.slice(0, 60) });
  }

  if (req.method === "POST" && parts[1] === "rooms" && parts[3] === "reactions" && parts.length === 4) {
    const roomId = decodeURIComponent(parts[2]);
    const room = store.room(roomId);
    if (!room) return json(res, 404, { error: "room not found" });
    const body = await readBody(req);
    const messageId = String(body.messageId ?? "").trim();
    const key = String(body.key ?? "👍")
      .trim()
      .slice(0, 16);
    if (!messageId || !key) return json(res, 400, { error: "messageId/key required" });
    const target = await human.getEvent(roomId, messageId).catch(() => null);
    if (!target?.text) return json(res, 404, { error: "message not found" });
    await human.sendReaction(roomId, messageId, key);
    return json(res, 200, { ok: true, messageId, key });
  }

  if (req.method === "GET" && parts[1] === "rooms" && parts[3] === "threads" && parts.length === 5) {
    const roomId = decodeURIComponent(parts[2]);
    const rootId = decodeURIComponent(parts[4]);
    if (!store.room(roomId)) return json(res, 404, { error: "room not found" });
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
    const from = url.searchParams.get("from") || null;
    return json(res, 200, await roomThreadPage(roomId, rootId, { limit, from }));
  }

  if (req.method === "GET" && parts[1] === "rooms" && parts[3] === "messages" && parts.length === 4) {
    const roomId = decodeURIComponent(parts[2]);
    if (!store.room(roomId)) return json(res, 404, { error: "room not found" });
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
    const from = url.searchParams.get("from") || null;
    const page = await roomMessagesPage(roomId, { limit, from });
    return json(res, 200, {
      messages: page.messages.map(messageView),
      reactions: page.reactions,
      next: page.next,
    });
  }

  if (req.method === "POST" && parts[1] === "rooms" && parts[3] === "messages" && parts.length === 4) {
    const roomId = decodeURIComponent(parts[2]);
    const room = store.room(roomId);
    if (!room) return json(res, 404, { error: "room not found" });
    const body = await readBody(req);
    const text = String(body.text ?? "").trim();
    if (!text) return json(res, 400, { error: "消息不能为空" });
    const mentions = mentionIdsIn(text, room);
    const replyTo = typeof body.replyTo === "string" && body.replyTo ? body.replyTo : null;
    const threadId =
      typeof body.threadId === "string" && body.threadId && body.threadId !== "main" ? body.threadId : "main";
    if (threadId !== "main") {
      const root = await human.getEvent(roomId, threadId).catch(() => null);
      if (!root?.text) return json(res, 404, { error: "thread root not found" });
    }
    const sent = await human.send(roomId, { threadId, text, mentions, replyTo });
    store.markRead(roomId, Date.now());
    return json(res, 200, {
      eventId: sent.eventId,
      mentions,
      message: {
        id: sent.eventId,
        sender: store.human.id,
        senderName: store.human.name,
        displayName: store.human.displayName,
        kind: "human",
        text,
        mentions,
        replyTo,
        threadId,
        createdAt: Date.now(),
      },
    });
  }

  if (req.method === "POST" && parts[1] === "rooms" && parts[3] === "upload" && parts.length === 4) {
    const roomId = decodeURIComponent(parts[2]);
    if (!store.room(roomId)) return json(res, 404, { error: "room not found" });
    const body = await readBody(req, 16 * 1024 * 1024);
    const filename = String(body.filename ?? "file").slice(0, 200);
    const contentType = String(body.contentType ?? "application/octet-stream");
    const bytes = Buffer.from(String(body.data ?? ""), "base64");
    if (!bytes.length) return json(res, 400, { error: "文件为空" });
    if (bytes.length > 8 * 1024 * 1024) return json(res, 400, { error: "文件不能超过 8MB" });
    const mxc = await human.uploadMedia(bytes, { contentType, filename });
    const msgtype = contentType.startsWith("image/") ? "m.image" : "m.file";
    const info = { mimetype: contentType, size: bytes.length };
    const sent = await human.send(roomId, {
      threadId: "main",
      msgtype,
      text: filename,
      url: mxc,
      info,
    });
    store.markRead(roomId, Date.now());
    return json(res, 200, {
      eventId: sent.eventId,
      message: {
        id: sent.eventId,
        sender: store.human.id,
        senderName: store.human.name,
        displayName: store.human.displayName,
        kind: "human",
        msgtype,
        text: filename,
        url: mxc,
        fileInfo: info,
        mentions: [],
        createdAt: Date.now(),
      },
    });
  }

  if (req.method === "GET" && url.pathname === "/api/media") {
    const uri = String(url.searchParams.get("uri") ?? "");
    const match = uri.match(/^mxc:\/\/([^/]+)\/(.+)$/);
    if (!match) return json(res, 400, { error: "bad mxc uri" });
    const media = await human.downloadMedia(match[1], match[2]);
    res.writeHead(200, {
      "Content-Type": media.contentType,
      "Content-Length": media.body.length,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    return res.end(media.body);
  }

  if (req.method === "POST" && parts[1] === "rooms" && parts[3] === "read" && parts.length === 4) {
    const roomId = decodeURIComponent(parts[2]);
    if (!store.room(roomId)) return json(res, 404, { error: "room not found" });
    const body = await readBody(req);
    store.markRead(roomId, Number(body.ts) || Date.now());
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && parts[1] === "rooms" && parts[3] === "members" && parts.length === 4) {
    const roomId = decodeURIComponent(parts[2]);
    const body = await readBody(req);
    return json(res, 200, await addMembers(roomId, body));
  }

  if (req.method === "DELETE" && parts[1] === "rooms" && parts[3] === "members" && parts.length === 5) {
    return json(res, 200, await removeMember(decodeURIComponent(parts[2]), decodeURIComponent(parts[4])));
  }

  if (req.method === "DELETE" && parts[1] === "rooms" && parts.length === 3) {
    const roomId = decodeURIComponent(parts[2]);
    return json(res, 200, await deleteRoom(roomId));
  }

  if (req.method === "PATCH" && parts[1] === "rooms" && parts.length === 3) {
    const roomId = decodeURIComponent(parts[2]);
    const body = await readBody(req);
    return json(res, 200, await updateRoom(roomId, body));
  }

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readBody(req);
    const kind = body.kind === "dm" ? "dm" : "group";
    const result = kind === "dm" ? await createDm(body) : await createGroup(body);
    return json(res, 200, result);
  }

  if (req.method === "POST" && url.pathname === "/api/agents") {
    const body = await readBody(req);
    return json(res, 200, await createAgent(body));
  }

  if (req.method === "PATCH" && parts[1] === "agents" && parts.length === 3) {
    const agentId = decodeURIComponent(parts[2]);
    const body = await readBody(req);
    return json(res, 200, await updateAgent(agentId, body));
  }

  if (req.method === "DELETE" && parts[1] === "agents" && parts.length === 3) {
    return json(res, 200, await deleteAgent(decodeURIComponent(parts[2])));
  }

  if (req.method === "POST" && parts[1] === "agents" && parts[3] === "approve-tool" && parts.length === 4) {
    const agentId = decodeURIComponent(parts[2]);
    const body = await readBody(req);
    return json(res, 200, await approveTool(agentId, body));
  }

  if (req.method === "POST" && parts[1] === "agents" && parts[3] === "worktree" && parts.length === 4) {
    const agentId = decodeURIComponent(parts[2]);
    const body = await readBody(req);
    return json(res, 200, await createAgentWorktree(agentId, body));
  }

  if (req.method === "DELETE" && parts[1] === "agents" && parts[3] === "worktree" && parts.length === 4) {
    return json(res, 200, await removeAgentWorktree(decodeURIComponent(parts[2])));
  }

  if (
    req.method === "POST" &&
    parts[1] === "agents" &&
    parts[3] === "worktree" &&
    parts[4] === "merge" &&
    parts.length === 5
  ) {
    const agentId = decodeURIComponent(parts[2]);
    const body = await readBody(req);
    return json(res, 200, await mergeAgentWorktree(agentId, body));
  }

  return json(res, 404, { error: "not found" });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function serveStatic(res, pathname) {
  if (!existsSync(webDist)) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("web/dist not built yet. Run: cd agent-im/web && npm install && npm run build");
  }
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let file = resolve(webDist, rel);
  if (!file.startsWith(webDist)) file = join(webDist, "index.html");
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    file = join(webDist, "index.html");
  }
  const data = await readFile(file);
  res.writeHead(200, {
    "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    "Cache-Control": file.includes(`${join(webDist, "assets")}`)
      ? "public, max-age=31536000, immutable"
      : "no-store",
    "Content-Length": data.length,
    "X-Content-Type-Options": "nosniff",
  });
  res.end(data);
}

const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
const allowedOrigins = new Set([
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  ...String(process.env.AGENT_IM_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
]);

function allowLocalRequest(req, res) {
  const host = req.headers.host;
  if (host && !allowedHosts.has(host)) {
    json(res, 403, { error: "forbidden host" });
    return false;
  }
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    json(res, 403, { error: "forbidden origin" });
    return false;
  }
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${hostName}:${port}`);
  try {
    if (!allowLocalRequest(req, res)) return;
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveStatic(res, url.pathname);
  } catch (err) {
    log(`[app] ${req.method} ${url.pathname} -> ${err.status ?? 500} ${err.message}`);
    json(res, err.status ?? 502, { error: err.message ?? String(err) });
  }
});

server.listen(port, hostName, () => {
  log(`agent-im app  http://${hostName}:${port}`);
  log(`homeserver   ${store.homeserver}`);
  log(`human        ${store.human.id}`);
  log(`agents       ${store.agents.map((a) => a.name).join(", ")}`);
  log(`rooms        ${store.rooms.length}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    log(`\n[app] ${signal}; stopping`);
    server.close();
    await host.stop().catch(() => {});
    process.exit(0);
  });
}
