// Wires the control-plane state to the protocol engine, Matrix clients and
// runtimes. One process hosts every agent worker.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Engine } from "../spike/src/scheduler.mjs";
import { ClaudeAdapter } from "../spike/src/claude-adapter.mjs";
import { ScriptPeer, scripts } from "../spike/src/script-peer.mjs";
import { MatrixClient } from "../spike/src/matrix-transport.mjs";
import { Gateway } from "../spike/src/gateway.mjs";
import { composeSystemPrompt } from "./store.mjs";
import { getTemplate } from "./role-templates.mjs";
import { mergeToolArgs, toolArgsFor } from "./tool-policy.mjs";

function engineProfile(agent, humanId) {
  return {
    id: agent.id,
    name: agent.name,
    displayName: agent.displayName,
    role: agent.role,
    paused: agent.status === "paused",
    owner: humanId,
    roles: agent.roles ?? [],
    domains: agent.domains ?? [],
    speakMode: "volunteer",
    wakePolicy: agent.wakePolicy ?? "human_all",
    canInvite: "allowlist",
    allowlist: [],
  };
}

function createRuntime(agent, { dataDir, log }) {
  const home = agent.agentHome ?? join(dataDir, "agents", agent.name);
  mkdirSync(join(home, "workspace"), { recursive: true });
  mkdirSync(join(home, "sessions"), { recursive: true });
  mkdirSync(join(home, "knowledge"), { recursive: true });
  if (agent.runtime === "claude") {
    const template = getTemplate(agent.templateId) ?? getTemplate(agent.role);
    const mode = agent.toolsMode ?? (agent.toolsEnabled ? "template" : "off");
    return new ClaudeAdapter({
      command: "claude",
      cwd: agent.cwd ? resolve(agent.cwd) : join(home, "workspace"),
      agentId: agent.id,
      model: agent.model,
      systemPrompt: composeSystemPrompt(agent),
      turnTimeoutMs: 300_000,
      // Same person across rooms: one Claude session per agent, not per room.
      sessionScope: agent.sessionScope ?? "agent",
      sessionStorePath: join(home, "sessions", "claude.json"),
      // Re-apply the current policy even if state has stale tool flags.
      extraArgs: mergeToolArgs(
        agent.extraArgs ?? [],
        toolArgsFor(template, mode, agent.runtime, agent.approvedTools ?? []),
      ),
      log: (msg) => log(`[claude:${agent.name}] ${msg}`),
    });
  }
  if (agent.runtime === "script") {
    const handler = scripts[agent.script ?? "reviewer"] ?? scripts.reviewer;
    return new ScriptPeer({ agentId: agent.id, handler });
  }
  throw new Error(`unknown runtime: ${agent.runtime}`);
}

export async function createHost({
  store,
  dataDir,
  kinds: sharedKinds = null,
  onEvent = null,
  log = console.log,
}) {
  const humanId = store.human.id;
  const kinds = sharedKinds ?? new Map();
  kinds.set(humanId, "human");
  for (const agent of store.agents) kinds.set(agent.id, "agent");

  const engine = new Engine({
    now: Date.now(),
    quietWindowMs: 30_000,
    maxTurnMs: 300_000,
    lazyConsensusMs: 60_000,
    // High enough for organic back-and-forth; still a runaway-loop guard.
    maxAgentChain: 10,
  });
  engine.addHuman({ id: humanId });

  const clients = new Map();
  const runtimes = new Map();
  const roomModes = new Map(store.rooms.map((room) => [room.id, room.mode ?? "brief"]));
  for (const agent of store.agents) {
    engine.addAgent(engineProfile(agent, humanId));
    clients.set(
      agent.id,
      new MatrixClient({
        homeserver: store.homeserver,
        userId: agent.id,
        accessToken: agent.accessToken,
        kinds,
        log: (msg) => log(`[matrix:${agent.name}] ${msg}`),
      }),
    );
    runtimes.set(agent.id, createRuntime(agent, { dataDir, log }));
  }

  const spendToday = new Map();
  let spendDay = new Date().toISOString().slice(0, 10);
  const ensureSpendDay = () => {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== spendDay) {
      spendDay = day;
      spendToday.clear();
    }
  };
  const auditPath = join(dataDir, "audit.jsonl");
  if (existsSync(auditPath)) {
    try {
      for (const line of readFileSync(auditPath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (entry.kind !== "usage" || !entry.agentId) continue;
        if (String(entry.ts ?? "").slice(0, 10) !== spendDay) continue;
        spendToday.set(entry.agentId, (spendToday.get(entry.agentId) ?? 0) + (Number(entry.costUsd) || 0));
      }
    } catch {
      // ignore unreadable audit
    }
  }
  const budgetCheck = (agentId) => {
    ensureSpendDay();
    const agent = store.agent(agentId);
    const cap = Number(agent?.dailyBudgetUsd) || 0;
    if (cap <= 0) return null;
    const spent = spendToday.get(agentId) ?? 0;
    return spent >= cap ? { exceeded: true, spent, cap } : null;
  };
  const onUsage = (agentId, costUsd) => {
    ensureSpendDay();
    spendToday.set(agentId, (spendToday.get(agentId) ?? 0) + costUsd);
  };

  const gateway = new Gateway({
    engine,
    clients,
    runtimes,
    rooms: store.rooms.map((r) => r.id),
    statePath: join(dataDir, "gateway-state.json"),
    auditPath,
    syncTimeoutMs: 30_000,
    tickMs: 1000,
    mediaDir: join(dataDir, "media"),
    budgetCheck,
    onUsage,
    onEvent,
    log,
  });

  const applyRoomMode = (roomId, mode = "brief") => {
    roomModes.set(roomId, mode);
    const engineRoom = engine.rooms.get(roomId);
    if (engineRoom) engineRoom.mode = mode;
  };

  return {
    engine,
    clients,
    runtimes,
    gateway,

    async start() {
      await gateway.start();
      for (const [roomId, mode] of roomModes) applyRoomMode(roomId, mode);
    },

    setRoomMode(roomId, mode) {
      applyRoomMode(roomId, mode);
    },

    async stop() {
      await gateway.stop();
    },

    async attachAgent(agent) {
      kinds.set(agent.id, "agent");
      const client = new MatrixClient({
        homeserver: store.homeserver,
        userId: agent.id,
        accessToken: agent.accessToken,
        kinds,
        log: (msg) => log(`[matrix:${agent.name}] ${msg}`),
      });
      const runtime = createRuntime(agent, { dataDir, log });
      await gateway.addAgent({
        agentId: agent.id,
        client,
        runtime,
        profile: engineProfile(agent, humanId),
      });
    },

    async updateAgent(agent) {
      const old = runtimes.get(agent.id);
      const runtime = createRuntime(agent, { dataDir, log });
      runtimes.set(agent.id, runtime);
      try {
        await old?.close?.();
      } catch (err) {
        log(`[gateway] close old runtime ${agent.name} failed: ${err.message}`);
      }
    },

    async attachRoom(roomId, mode = "brief") {
      roomModes.set(roomId, mode);
      await gateway.addRoom(roomId);
      applyRoomMode(roomId, mode);
    },

    async syncRoom(roomId) {
      await gateway.syncRoom(roomId);
    },

    async removeRoom(roomId) {
      roomModes.delete(roomId);
      await gateway.removeRoom(roomId);
    },

    agentStatus(agentId) {
      if (engine.agents.get(agentId)?.paused) return "paused";
      if (!runtimes.has(agentId)) return "offline";
      for (const thread of engine.threads.values()) {
        const state = thread.states.get(agentId);
        if (state === "thinking" || state === "working") return "working";
      }
      return "idle";
    },

    roomActivity(roomId) {
      const thread = engine.getThread(roomId, "main");
      if (!thread) return { floor: null, queued: [], states: {} };
      return {
        floor: thread.floor.holder,
        queued: thread.floor.queue.map((item) => item.agentId),
        states: Object.fromEntries(thread.states),
      };
    },
  };
}
