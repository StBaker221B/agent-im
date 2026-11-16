// Persistent state for the MVP control plane.
//
// One JSON document holds the human, agents and rooms. It is local dev data
// (app/data is gitignored) and contains Matrix access tokens/passwords.
//
// On first run we import the protocol spike's setup so the existing accounts
// and rooms keep working: users from spike/.tmp/matrix-users.json, tokens from
// spike/.tmp/matrix-config.json, registration token from spike/.tmp.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = here;
const spikeRoot = resolve(here, "..", "spike");

export const dataDir = join(appRoot, "data");
export const statePath = join(dataDir, "state.json");

export const localpart = (id) =>
  String(id ?? "")
    .replace(/^@/, "")
    .split(":")[0];

export function defaultSystemPrompt({ displayName, name, roles = [] }) {
  return `你是 ${displayName || name}（@${name}），Agent IM 房间里的一个 agent。角色：${roles.join("、") || "通用"}。
你和人类、其他 agent 在同一个房间对等交流。
- 你在不同房间共享同一份记忆：在群里说过的事、私聊里说过的事，你都记得，不要把每个房间当成陌生人。
- 但要注意场合：私聊里的原话和敏感内容不要主动带到群聊；需要引用时用自己的话概括，不确定时先问。
- 私聊里，或人类直接向你提问/点名时，必须给出回应；不要用 PASS 回避直接问题。
- 只有群聊里确实没有新增价值（别人已经答完、你也没有补充）时才 PASS。
- 不要为了礼貌而回复，不要复述别人说过的话。
- 收到图片/文件时，消息里会带一个本地路径；必须先 Read 打开它再回答，不要说"看不到图片"。
- 只有确实需要对方参与时才 @ 其他 agent；讨论模式下可以为了推进讨论 @ 对方，但不要客套循环。
- 默认只进行对话；除非用户明确要求改代码或执行命令，不要使用工具。
- 一条消息说完，保持简洁。`;
}

export const ROLE_TEMPLATES = {
  generic: "",
  coder: `职责（coder）：
- 负责给出最小可执行实现方案：涉及的文件/接口/数据流/验证方式。
- 需要 review 时主动 @ 负责 review 的 agent，用对方的真实 @用户名（例如 @arch-reviewer），不要写 @reviewer 这种泛称；并说明要 review 的点。
- 任务明确要求直接修时，使用工具修改 workspace 并运行测试；不要修改测试来让测试通过。
- 收到 objection 必须回应：接受并修改，或给出具体理由；不要只客套。
- 完成时用 DONE: <一句话> 结束。`,
  reviewer: `职责（reviewer）：
- 你的任务是找出具体问题：失败场景、遗漏、反例、安全/并发/兼容风险。
- 只读：不要修改文件；可以运行测试、读代码/diff。
- 必须给出可操作的修正建议，并 @ 提案人的真实 @用户名；最后请提案人确认。
- 如果没有具体风险，才输出 PASS。
- 不要替提案人写完整实现；只指出问题和边界。`,
  researcher: `职责（researcher）：
- 负责查证事实、对比方案、给出依据和适用边界。
- 区分事实/推断；给出验证方法或来源。
- 发现方案前提不成立时，明确 @ 提案人的真实 @用户名 指出。
- 不要只表态或复述。`,
};

export const ROLE_NAMES = Object.keys(ROLE_TEMPLATES);

/** Read optional private notes from app/data/agents/<name>/knowledge/*.md. */
export function readKnowledge(agentHome) {
  const dir = join(agentHome ?? "", "knowledge");
  if (!agentHome || !existsSync(dir)) return "";
  let text = "";
  try {
    for (const file of readdirSync(dir).sort()) {
      if (!/\.(md|txt)$/i.test(file)) continue;
      const part = readFileSync(join(dir, file), "utf8").trim();
      if (!part) continue;
      text += `\n\n## ${file}\n${part}`;
      if (text.length >= 12_000) break;
    }
  } catch {
    return "";
  }
  return text.trim();
}

/** Base prompt + role obligations + private knowledge. */
export function composeSystemPrompt(agent) {
  const role = ROLE_TEMPLATES[agent.role] ?? "";
  const knowledge = readKnowledge(agent.agentHome);
  return [
    agent.systemPrompt,
    role,
    knowledge ? `你的私有知识（只在这个 agent 的 home 里）：\n${knowledge}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

function importFromSpike() {
  const config = readJson(join(spikeRoot, ".tmp", "matrix-config.json"));
  if (!config) return null;
  const users = readJson(join(spikeRoot, ".tmp", "matrix-users.json"), { users: [] });
  const humanId = config.humans?.[0];
  if (!humanId) return null;
  const serverName = String(humanId).split(":")[1] ?? "localhost";
  const passwordOf = (username) => users.users?.find((u) => u.username === username)?.password ?? "";
  const userOf = (id) => users.users?.find((u) => u.username === localpart(id));

  const agents = (config.agents ?? []).map((a) => {
    const name = localpart(a.id);
    const user = userOf(a.id) ?? {};
    const roles = a.roles ?? [];
    return {
      id: a.id,
      name,
      username: name,
      displayName: user.displayName ?? name,
      password: user.password ?? passwordOf(name),
      accessToken: a.accessToken,
      runtime: a.runtime ?? "script",
      script: a.script,
      roles,
      domains: a.domains ?? [],
      systemPrompt: defaultSystemPrompt({ displayName: user.displayName ?? name, name, roles }),
      // Product default: agents evaluate every human message. The scripted
      // reviewer stays quiet unless addressed so it does not add noise.
      wakePolicy: a.runtime === "claude" ? "human_all" : "mention_only",
      status: "active",
      agentHome: join(dataDir, "agents", name),
      createdAt: new Date().toISOString(),
    };
  });

  const byName = new Map(agents.map((a) => [a.name, a]));
  const rooms = (config.rooms ?? []).map((id, index) => {
    const agent = index === 0 ? null : (byName.get("script-peer") ?? agents[0] ?? null);
    return {
      id,
      kind: index === 0 ? "group" : "dm",
      mode: "brief",
      name: index === 0 ? "Agent IM 群聊" : `${agent?.displayName ?? "Agent"} 私聊`,
      peerId: index === 0 ? null : (agent?.id ?? null),
      memberIds:
        index === 0 ? [humanId, ...agents.map((a) => a.id)] : [humanId, ...(agent ? [agent.id] : [])],
      createdAt: new Date().toISOString(),
      // Imported history is not "unread" for the product UI.
      lastReadTs: Date.now(),
    };
  });

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    homeserver: config.matrix?.homeserver ?? "http://127.0.0.1:8008",
    serverName,
    registrationToken: readText(join(spikeRoot, ".tmp", "matrix-registration-token.txt")),
    human: {
      id: humanId,
      name: localpart(humanId),
      displayName: userOf(humanId)?.displayName ?? "Kudo",
      password: passwordOf(localpart(humanId)),
      accessToken: config.humanAccessToken,
    },
    agents,
    rooms,
  };
}

export class Store {
  constructor() {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(dataDir, "agents"), { recursive: true });
    this.state = readJson(statePath) ?? importFromSpike();
    if (!this.state?.human?.accessToken) {
      throw new Error(
        "no state and no importable spike setup. Run agent-im/spike setup-matrix first (docs/12), then start the app.",
      );
    }
    const roleByName = { "claude-dev": "coder", researcher: "researcher" };
    for (const agent of this.state.agents) {
      if (!agent.role) agent.role = roleByName[agent.name] ?? "generic";
      mkdirSync(join(agent.agentHome ?? join(dataDir, "agents", agent.name), "knowledge"), {
        recursive: true,
      });
    }
    for (const room of this.state.rooms) {
      if (!room.mode) room.mode = "brief";
    }
    this.save();
  }

  save() {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(statePath, JSON.stringify(this.state, null, 2) + "\n", "utf8");
  }

  get human() {
    return this.state.human;
  }

  get homeserver() {
    return this.state.homeserver;
  }

  get serverName() {
    return this.state.serverName;
  }

  get registrationToken() {
    return this.state.registrationToken;
  }

  get agents() {
    return this.state.agents;
  }

  get rooms() {
    return this.state.rooms;
  }

  agent(idOrName) {
    return this.state.agents.find((a) => a.id === idOrName || a.name === idOrName) ?? null;
  }

  room(id) {
    return this.state.rooms.find((r) => r.id === id) ?? null;
  }

  addAgent(agent) {
    if (this.agent(agent.id)) throw new Error(`agent exists: ${agent.id}`);
    this.state.agents.push(agent);
    this.save();
    return agent;
  }

  addRoom(room) {
    if (this.room(room.id)) return this.room(room.id);
    this.state.rooms.push(room);
    this.save();
    return room;
  }

  updateRoom(id, patch) {
    const room = this.room(id);
    if (!room) return null;
    Object.assign(room, patch);
    this.save();
    return room;
  }

  markRead(id, ts) {
    const room = this.room(id);
    if (!room) return null;
    room.lastReadTs = Math.max(room.lastReadTs ?? 0, Number(ts) || 0);
    this.save();
    return room;
  }

  removeRoom(id) {
    const before = this.state.rooms.length;
    this.state.rooms = this.state.rooms.filter((r) => r.id !== id);
    this.save();
    return this.state.rooms.length !== before;
  }

  dmWith(agentId) {
    return this.state.rooms.find((r) => r.kind === "dm" && r.peerId === agentId) ?? null;
  }

  publicAgents() {
    return this.state.agents.map((a) => ({
      id: a.id,
      name: a.name,
      displayName: a.displayName,
      runtime: a.runtime,
      role: a.role,
      roles: a.roles,
      domains: a.domains,
      wakePolicy: a.wakePolicy,
      systemPrompt: a.systemPrompt,
      status: a.status,
    }));
  }

  publicRooms() {
    return this.state.rooms.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      peerId: r.peerId,
      memberIds: r.memberIds,
      lastReadTs: r.lastReadTs ?? 0,
      createdAt: r.createdAt,
    }));
  }
}
