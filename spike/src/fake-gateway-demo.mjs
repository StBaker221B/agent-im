// Free, deterministic end-to-end demo of the gateway on the fake bus:
// group @mention -> chain -> pass -> quiescence; DM; volunteer; restart dedup.
// Run: npm run gateway-demo

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FakeBus } from "./fake-bus.mjs";
import { MockRuntime } from "./mock-runtime.mjs";
import { ScriptPeer, scripts } from "./script-peer.mjs";
import { createGatewayFromConfig } from "./supervisor.mjs";

const HUMAN = "@kudo:fake";
const CLAUDE = "@claude-dev:fake";
const PEER = "@script-peer:fake";
const GROUP = "!group:fake";
const DM = "!dm:fake";

const tmp = join(process.cwd(), ".tmp");
mkdirSync(tmp, { recursive: true });
const busLog = join(tmp, "fake-gateway-bus.jsonl");
const statePath = join(tmp, "fake-gateway-state.json");
const auditPath = join(tmp, "fake-gateway-audit.jsonl");
for (const f of [busLog, statePath, auditPath]) rmSync(f, { force: true });

const users = [
  { id: HUMAN, kind: "human" },
  { id: CLAUDE, kind: "agent" },
  { id: PEER, kind: "agent" },
];
const rooms = [
  { id: GROUP, members: [HUMAN, CLAUDE, PEER] },
  { id: DM, members: [HUMAN, PEER] },
];
const newBus = () => new FakeBus({ users, rooms, logPath: busLog });

const config = {
  transport: "fake",
  rooms: [GROUP, DM],
  humans: [HUMAN],
  quietWindowMs: 300,
  maxTurnMs: 5000,
  syncTimeoutMs: 75,
  tickMs: 50,
  statePath,
  auditPath,
  agents: [
    { id: CLAUDE, runtime: "claude", roles: ["coder"], domains: ["auth"], speakMode: "volunteer", wakePolicy: "mention_or_reply" },
    { id: PEER, runtime: "script", script: "reviewer", roles: ["reviewer"], domains: ["review"], speakMode: "volunteer", wakePolicy: "mention_or_reply" },
  ],
};

function makeRuntimes({ mockReply }) {
  const mock = new MockRuntime({ agentId: CLAUDE, reply: mockReply });
  const peer = new ScriptPeer({ agentId: PEER, handler: scripts.reviewer });
  return { runtimes: new Map([[CLAUDE, mock], [PEER, peer]]), mock };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(label, fn, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await sleep(25);
  }
  throw new Error(`timeout waiting for ${label}`);
}

const thread = (engine, roomId) => engine.getThread(roomId, "main");
const transcript = (engine, roomId) => thread(engine, roomId)?.messages ?? [];

async function main() {
  const bus1 = newBus();
  const first = makeRuntimes({
    mockReply: (envelope, n) => {
      if (envelope.message.text.includes("volunteer")) return "我主动补充一句：先做最小版。";
      return n === 1 ? "方案：JWT + refresh token。@script-peer 你 review 一下。" : "PASS";
    },
  });
  const built1 = await createGatewayFromConfig(config, { bus: bus1, runtimes: first.runtimes });
  await built1.gateway.start();
  const human = bus1.clientFor(HUMAN);

  console.log("\n=== 1. group @mention -> chain -> pass -> quiescence ===");
  await human.send(GROUP, { text: "@claude-dev 登录功能怎么做？", mentions: [CLAUDE] });
  await waitFor("group chain", () => transcript(built1.engine, GROUP).length >= 3);
  await waitFor("group quiescent", () => thread(built1.engine, GROUP).quiescent);
  for (const m of transcript(built1.engine, GROUP)) console.log(`  ${m.sender} [${m.intent}] ${m.text}`);
  console.log("  agent states:", Object.fromEntries(thread(built1.engine, GROUP).states));

  console.log("\n=== 2. DM (2-person room = implicit mention) ===");
  await human.send(DM, { text: "在吗？" });
  await waitFor("dm reply", () => transcript(built1.engine, DM).length >= 2);
  await waitFor("dm quiescent", () => thread(built1.engine, DM).quiescent);
  for (const m of transcript(built1.engine, DM)) console.log(`  ${m.sender} [${m.intent}] ${m.text}`);

  console.log("\n=== 3. volunteer turn (no mention) ===");
  await human.send(GROUP, { text: "volunteer: 大家对登录方案还有补充吗？" });
  await sleep(50);
  console.log("  before volunteer, messages:", transcript(built1.engine, GROUP).length);
  await built1.gateway.requestFloor(CLAUDE, { roomId: GROUP });
  await waitFor("volunteer reply", () => transcript(built1.engine, GROUP).length >= 4);
  await waitFor("group quiescent again", () => thread(built1.engine, GROUP).quiescent);
  console.log("  last message:", transcript(built1.engine, GROUP).at(-1).text);
  console.log("  mock turns:", first.mock.calls.length);

  console.log("\n=== 4. restart: no duplicate turns, missed message processed once ===");
  await built1.gateway.stop();
  await sleep(20);
  const beforeRestartTurns = first.mock.calls.length;
  await human.send(GROUP, { text: "重启后这条还要回吗？@claude-dev", mentions: [CLAUDE] });
  const missedId = bus1.events.at(-1).id;
  console.log("  posted while gateway down:", missedId);

  const bus2 = newBus();
  const second = makeRuntimes({ mockReply: () => "PASS" });
  const built2 = await createGatewayFromConfig(config, { bus: bus2, runtimes: second.runtimes });
  await built2.gateway.start();
  await waitFor("restart processes missed message", () => second.mock.calls.length >= 1);
  await waitFor("group quiescent after restart", () => thread(built2.engine, GROUP).quiescent);

  console.log("  turns before restart:", beforeRestartTurns);
  console.log("  turns after restart:", second.mock.calls.length, "trigger:", second.mock.calls[0]?.id);
  console.log("  old message re-run?", second.mock.calls.some((c) => c.id !== missedId));
  console.log("  transcript length after hydration:", transcript(built2.engine, GROUP).length);
  console.log("  audit:", auditPath);
  await built2.gateway.stop();

  const ok =
    beforeRestartTurns === 3 &&
    second.mock.calls.length === 1 &&
    second.mock.calls[0].id === missedId &&
    !second.mock.calls.some((c) => c.id !== missedId) &&
    transcript(built2.engine, GROUP).some((m) => m.id === missedId);
  console.log(`\n=== ${ok ? "PASS" : "FAIL"} ===`);
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
