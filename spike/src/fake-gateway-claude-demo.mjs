// One real Claude Code agent + one script peer through the gateway on the
// fake bus. This is the cost-bearing integration check before Matrix.
// Run: npm run gateway-demo-claude  (about $0.01–0.05, 1–3 minutes)

import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FakeBus } from "./fake-bus.mjs";
import { ClaudeAdapter } from "./claude-adapter.mjs";
import { ScriptPeer, scripts } from "./script-peer.mjs";
import { createGatewayFromConfig } from "./supervisor.mjs";

const HUMAN = "@kudo:fake";
const CLAUDE = "@claude-dev:fake";
const PEER = "@script-peer:fake";
const GROUP = "!group:fake";

const tmp = join(process.cwd(), ".tmp");
mkdirSync(tmp, { recursive: true });
const statePath = join(tmp, "claude-gateway-state.json");
const auditPath = join(tmp, "claude-gateway-audit.jsonl");
for (const f of [statePath, auditPath]) rmSync(f, { force: true });

const bus = new FakeBus({
  users: [
    { id: HUMAN, kind: "human" },
    { id: CLAUDE, kind: "agent" },
    { id: PEER, kind: "agent" },
  ],
  rooms: [{ id: GROUP, members: [HUMAN, CLAUDE, PEER] }],
});

const config = {
  transport: "fake",
  rooms: [GROUP],
  humans: [HUMAN],
  quietWindowMs: 2000,
  maxTurnMs: 180_000,
  syncTimeoutMs: 100,
  tickMs: 200,
  statePath,
  auditPath,
  agents: [
    { id: CLAUDE, runtime: "claude", roles: ["coder"], domains: ["auth"], speakMode: "volunteer", wakePolicy: "mention_or_reply" },
    { id: PEER, runtime: "script", script: "reviewer", roles: ["reviewer"], domains: ["review"], speakMode: "volunteer", wakePolicy: "mention_or_reply" },
  ],
};

const adapter = new ClaudeAdapter({
  cwd: process.cwd(),
  agentId: CLAUDE,
  turnTimeoutMs: 180_000,
  sessionStorePath: join(tmp, "agents", "claude-dev", "sessions", "claude.json"),
  systemPrompt: `You are @claude-dev, a coding agent in a group chat with @kudo (human) and @script-peer (another agent).
Reply as yourself, one concise message, no name prefix.
Follow the response markers in the user message.
Do not use tools. If you have nothing to add, reply exactly PASS.`,
});
const peer = new ScriptPeer({ agentId: PEER, handler: scripts.reviewer });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function main() {
  const built = await createGatewayFromConfig(config, {
    bus,
    runtimes: new Map([
      [CLAUDE, adapter],
      [PEER, peer],
    ]),
  });
  try {
    await built.gateway.start();
    const human = bus.clientFor(HUMAN);
    const thread = built.engine.getThread(GROUP, "main");

    console.log("sending one message to @claude-dev (real model call) ...");
    await human.send(GROUP, {
      text: "@claude-dev 用一句话说明登录功能怎么做；如果需要 review，请 @script-peer。",
      mentions: [CLAUDE],
    });
    await waitFor(() => thread.quiescent, "quiescence");

    console.log("\n=== transcript ===");
    for (const m of thread.messages) console.log(`${m.sender.padEnd(18)} [${m.intent}] ${m.text}`);
    console.log("\nquiescent:", thread.quiescent);
    console.log("states:", Object.fromEntries(thread.states));

    let inTokens = 0;
    let outTokens = 0;
    let cost = 0;
    for (const line of readFileSync(auditPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (ev.kind === "usage") {
        inTokens += ev.usage?.input_tokens ?? 0;
        outTokens += ev.usage?.output_tokens ?? 0;
        cost += ev.costUsd ?? 0;
      }
    }
    console.log(`usage: in=${inTokens} out=${outTokens} cost=$${cost.toFixed(6)}`);
    console.log("audit:", auditPath);
    if (!thread.quiescent) process.exitCode = 1;
  } finally {
    await built.gateway.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
