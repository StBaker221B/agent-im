// Wires the control-plane state to the protocol engine, Matrix clients and
// runtimes. One process hosts every agent worker.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Engine } from "../spike/src/scheduler.mjs";
import { ClaudeAdapter } from "../spike/src/claude-adapter.mjs";
import { ScriptPeer, scripts } from "../spike/src/script-peer.mjs";
import { MatrixClient } from "../spike/src/matrix-transport.mjs";
import { Gateway } from "../spike/src/gateway.mjs";
import { composeSystemPrompt } from "./store.mjs";

function engineProfile(agent, humanId) {
  return {
    id: agent.id,
    name: agent.name,
    displayName: agent.displayName,
    role: agent.role,
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
    return new ClaudeAdapter({
      command: "claude",
      cwd: join(home, "workspace"),
      agentId: agent.id,
      model: agent.model,
      systemPrompt: composeSystemPrompt(agent),
      turnTimeoutMs: 300_000,
      // Same person across rooms: one Claude session per agent, not per room.
      sessionScope: agent.sessionScope ?? "agent",
      sessionStorePath: join(home, "sessions", "claude.json"),
      log: (msg) => log(`[claude:${agent.name}] ${msg}`),
    });
  }
  if (agent.runtime === "script") {
    const handler = scripts[agent.script ?? "reviewer"] ?? scripts.reviewer;
    return new ScriptPeer({ agentId: agent.id, handler });
  }
  throw new Error(`unknown runtime: ${agent.runtime}`);
}

export async function createHost({ store, dataDir, kinds: sharedKinds = null, log = console.log }) {
  const humanId = store.human.id;
  const kinds = sharedKinds ?? new Map();
  kinds.set(humanId, "human");
  for (const agent of store.agents) kinds.set(agent.id, "agent");

  const engine = new Engine({
    now: Date.now(),
    quietWindowMs: 30_000,
    maxTurnMs: 300_000,
    lazyConsensusMs: 60_000,
    maxAgentChain: 3,
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

  const gateway = new Gateway({
    engine,
    clients,
    runtimes,
    rooms: store.rooms.map((r) => r.id),
    statePath: join(dataDir, "gateway-state.json"),
    auditPath: join(dataDir, "audit.jsonl"),
    syncTimeoutMs: 30_000,
    tickMs: 1000,
    mediaDir: join(dataDir, "media"),
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
