// Config loading and process wiring for the spike gateway.
// One supervisor process hosts a set of agent identities, their transports,
// and their runtimes. It is infrastructure, not a participant.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Engine } from "./scheduler.mjs";
import { ClaudeAdapter } from "./claude-adapter.mjs";
import { ScriptPeer, scripts } from "./script-peer.mjs";
import { FakeBus } from "./fake-bus.mjs";
import { MatrixClient } from "./matrix-transport.mjs";
import { Gateway } from "./gateway.mjs";

const ENV = /\$\{([A-Z0-9_]+)\}/g;

function substitute(value) {
  if (typeof value === "string") return value.replace(ENV, (_, name) => process.env[name] ?? "");
  if (Array.isArray(value)) return value.map(substitute);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v)]));
  }
  return value;
}

export function loadConfig(path) {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`config not found: ${abs}`);
  return substitute(JSON.parse(readFileSync(abs, "utf8")));
}

export function localpart(id) {
  return String(id).replace(/^@/, "").split(":")[0];
}

function dataDirFor(config) {
  return resolve(config.dataDir ?? join(process.cwd(), ".tmp"));
}

export async function createGatewayFromConfig(config, deps = {}) {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? console.log;
  const engine = new Engine({
    now: now(),
    quietWindowMs: config.quietWindowMs ?? 30_000,
    maxTurnMs: config.maxTurnMs ?? 300_000,
    lazyConsensusMs: config.lazyConsensusMs ?? 60_000,
  });

  for (const human of config.humans ?? []) engine.addHuman({ id: human });
  for (const agent of config.agents ?? []) {
    engine.addAgent({
      id: agent.id,
      owner: agent.owner ?? config.humans?.[0] ?? null,
      roles: agent.roles ?? [],
      domains: agent.domains ?? [],
      speakMode: agent.speakMode ?? "volunteer",
      wakePolicy: agent.wakePolicy ?? "mention_or_reply",
      canInvite: agent.canInvite ?? "allowlist",
      allowlist: agent.allowlist ?? [],
    });
  }

  const baseDir = dataDirFor(config);
  const statePath = config.statePath ?? join(baseDir, "gateway-state.json");
  const auditPath = config.auditPath ?? join(baseDir, "audit.jsonl");

  let bus = deps.bus ?? null;
  const clients = new Map();
  if (config.transport === "fake") {
    bus = bus ?? new FakeBus({
      users: config.fake?.users ?? [
        ...(config.humans ?? []).map((id) => ({ id, kind: "human" })),
        ...(config.agents ?? []).map((a) => ({ id: a.id, kind: "agent" })),
      ],
      rooms: config.fake?.rooms ?? [],
      logPath: config.fake?.logPath ?? null,
      now,
    });
    for (const agent of config.agents ?? []) clients.set(agent.id, bus.clientFor(agent.id));
  } else if (config.transport === "matrix") {
    const homeserver = config.matrix?.homeserver;
    if (!homeserver) throw new Error("matrix.homeserver required");
    const kinds = new Map((config.agents ?? []).map((a) => [a.id, "agent"]));
    for (const human of config.humans ?? []) kinds.set(human, "human");
    for (const agent of config.agents ?? []) {
      const token = agent.accessToken ?? (agent.accessTokenEnv ? process.env[agent.accessTokenEnv] : "");
      if (!token) throw new Error(`missing Matrix token for ${agent.id}`);
      clients.set(
        agent.id,
        new MatrixClient({
          homeserver,
          userId: agent.id,
          accessToken: token,
          kinds,
          log: (msg) => log(`[matrix:${localpart(agent.id)}] ${msg}`),
        }),
      );
    }
  } else {
    throw new Error(`unknown transport: ${config.transport}`);
  }

  const runtimes = new Map(deps.runtimes ?? []);
  for (const agent of config.agents ?? []) {
    if (runtimes.has(agent.id)) continue;
    if (agent.runtime === "claude") {
      const home = agent.agentHome ? resolve(agent.agentHome) : join(baseDir, "agents", localpart(agent.id));
      mkdirSync(home, { recursive: true });
      runtimes.set(
        agent.id,
        new ClaudeAdapter({
          command: agent.command ?? "claude",
          cwd: agent.cwd ? resolve(agent.cwd) : process.cwd(),
          agentId: agent.id,
          model: agent.model,
          systemPrompt: agent.systemPrompt,
          turnTimeoutMs: agent.turnTimeoutMs ?? config.maxTurnMs ?? 300_000,
          sessionStorePath: join(home, "sessions", "claude.json"),
          extraArgs: agent.extraArgs ?? [],
        }),
      );
    } else if (agent.runtime === "script") {
      const handler = scripts[agent.script];
      if (!handler) throw new Error(`unknown script peer: ${agent.script}`);
      runtimes.set(agent.id, new ScriptPeer({ agentId: agent.id, handler }));
    } else {
      throw new Error(`unknown runtime: ${agent.runtime}`);
    }
  }

  const rooms = config.rooms ?? (config.roomId ? [config.roomId] : []);
  const gateway = new Gateway({
    engine,
    clients,
    runtimes,
    rooms,
    statePath,
    auditPath,
    syncTimeoutMs: config.syncTimeoutMs ?? (config.transport === "fake" ? 250 : 30_000),
    tickMs: config.tickMs ?? 1000,
    now,
    log,
  });

  return { config, engine, clients, runtimes, gateway, bus, statePath, auditPath };
}

export async function runSupervisor(configPath) {
  const config = loadConfig(configPath);
  const built = await createGatewayFromConfig(config);
  await built.gateway.start();
  const healthTimer = setInterval(async () => {
    try {
      const health = await built.gateway.health();
      const states = Object.fromEntries(
        [...built.engine.threads.values()].map((t) => [t.key, { quiescent: t.quiescent, states: Object.fromEntries(t.states) }]),
      );
      console.log(`[health] ${JSON.stringify({ running: health.running, rooms: health.rooms, states })}`);
    } catch (err) {
      console.log(`[health] ${err.message}`);
    }
  }, 60_000);
  healthTimer.unref?.();

  const shutdown = async (signal) => {
    console.log(`[supervisor] ${signal}; stopping`);
    clearInterval(healthTimer);
    await built.gateway.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  return built;
}
