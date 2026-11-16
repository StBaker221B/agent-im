import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeBus } from "../src/fake-bus.mjs";
import { MockRuntime } from "../src/mock-runtime.mjs";
import { ScriptPeer, scripts } from "../src/script-peer.mjs";
import { createGatewayFromConfig } from "../src/supervisor.mjs";

const HUMAN = "@kudo:fake";
const CLAUDE = "@claude-dev:fake";
const PEER = "@script-peer:fake";
const GROUP = "!group:fake";
const DM = "!dm:fake";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label = "condition", timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await sleep(10);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function makeConfig(dir) {
  return {
    transport: "fake",
    rooms: [GROUP, DM],
    humans: [HUMAN],
    quietWindowMs: 80,
    maxTurnMs: 2000,
    syncTimeoutMs: 20,
    tickMs: 20,
    statePath: join(dir, "state.json"),
    auditPath: join(dir, "audit.jsonl"),
    agents: [
      { id: CLAUDE, runtime: "claude", roles: ["coder"], domains: ["auth"], speakMode: "volunteer", wakePolicy: "mention_or_reply" },
      { id: PEER, runtime: "script", script: "reviewer", roles: ["reviewer"], domains: ["review"], speakMode: "volunteer", wakePolicy: "mention_or_reply" },
    ],
  };
}

function makeUsersRooms() {
  return {
    users: [
      { id: HUMAN, kind: "human" },
      { id: CLAUDE, kind: "agent" },
      { id: PEER, kind: "agent" },
    ],
    rooms: [
      { id: GROUP, members: [HUMAN, CLAUDE, PEER] },
      { id: DM, members: [HUMAN, PEER] },
    ],
  };
}

async function setup(dir, { mockReply, logPath = null } = {}) {
  const { users, rooms } = makeUsersRooms();
  const bus = new FakeBus({ users, rooms, logPath });
  const mock = new MockRuntime({ agentId: CLAUDE, reply: mockReply ?? (() => "PASS") });
  const peer = new ScriptPeer({ agentId: PEER, handler: scripts.reviewer });
  const runtimes = new Map([
    [CLAUDE, mock],
    [PEER, peer],
  ]);
  const config = makeConfig(dir);
  const built = await createGatewayFromConfig(config, { bus, runtimes });
  return { ...built, bus, mock, peer, config };
}

test("group @mention chains to peer, a PASS turn adds no message, then quiescence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-im-gw-"));
  try {
    const { gateway, engine, bus, mock } = await setup(dir, {
      mockReply: (envelope, n) =>
        n === 1 ? "方案：JWT + refresh token。@script-peer 你 review 一下。" : "PASS",
    });
    await gateway.start();
    const human = bus.clientFor(HUMAN);
    await human.send(GROUP, { text: "@claude-dev 登录怎么做？", mentions: [CLAUDE] });

    const thread = engine.getThread(GROUP, "main");
    await waitFor(() => thread.messages.length >= 3, "3 messages");
    await waitFor(() => thread.quiescent, "quiescence");

    assert.equal(thread.messages.length, 3);
    assert.equal(thread.messages[0].sender, HUMAN);
    assert.equal(thread.messages[1].sender, CLAUDE);
    assert.match(thread.messages[1].text, /@script-peer/);
    assert.equal(thread.messages[2].sender, PEER);
    assert.equal(mock.calls.length, 2);
    assert.equal(thread.states.get(CLAUDE), "idle");
    await gateway.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a 2-person room treats every message as a direct mention", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-im-gw-"));
  try {
    const { gateway, engine, bus } = await setup(dir);
    await gateway.start();
    const human = bus.clientFor(HUMAN);
    await human.send(DM, { text: "在吗？" });

    const thread = engine.getThread(DM, "main");
    await waitFor(() => thread.messages.length >= 2, "dm reply");
    await waitFor(() => thread.quiescent, "dm quiescence");
    assert.equal(thread.messages[1].sender, PEER);
    assert.match(thread.messages[1].text, /@kudo/);
    await gateway.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ambient message does not wake; requestFloor produces a volunteer turn", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-im-gw-"));
  try {
    const { gateway, engine, bus, mock } = await setup(dir, {
      mockReply: (envelope) =>
        envelope.message.text.includes("volunteer") ? "我主动补充一句：先做最小版。" : "PASS",
    });
    await gateway.start();
    const human = bus.clientFor(HUMAN);
    await human.send(GROUP, { text: "volunteer: 还有补充吗？" });
    await sleep(120);

    const thread = engine.getThread(GROUP, "main");
    assert.equal(thread.messages.length, 1, "ambient message wakes nobody");
    assert.equal(mock.calls.length, 0);

    await gateway.requestFloor(CLAUDE, { roomId: GROUP });
    await waitFor(() => thread.messages.length >= 2, "volunteer message");
    await waitFor(() => thread.quiescent, "quiescence");
    assert.equal(thread.messages[1].sender, CLAUDE);
    assert.match(thread.messages[1].text, /主动补充/);
    await gateway.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restart does not re-run consumed messages and processes the missed one once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-im-gw-"));
  const logPath = join(dir, "bus.jsonl");
  try {
    const first = await setup(dir, {
      logPath,
      mockReply: (envelope, n) =>
        n === 1 ? "方案：JWT + refresh token。@script-peer 你 review 一下。" : "PASS",
    });
    await first.gateway.start();
    const human = first.bus.clientFor(HUMAN);
    await human.send(GROUP, { text: "@claude-dev 登录怎么做？", mentions: [CLAUDE] });
    const thread1 = first.engine.getThread(GROUP, "main");
    await waitFor(() => thread1.quiescent, "first quiescence");
    assert.equal(first.mock.calls.length, 2);

    await first.gateway.stop();
    await sleep(15);
    await human.send(GROUP, { text: "重启后这条还要回吗？@claude-dev", mentions: [CLAUDE] });
    const missedId = first.bus.events.at(-1).id;

    const { users, rooms } = makeUsersRooms();
    const bus2 = new FakeBus({ users, rooms, logPath });
    const mock2 = new MockRuntime({ agentId: CLAUDE, reply: () => "PASS" });
    const peer2 = new ScriptPeer({ agentId: PEER, handler: scripts.reviewer });
    const built2 = await createGatewayFromConfig(makeConfig(dir), {
      bus: bus2,
      runtimes: new Map([
        [CLAUDE, mock2],
        [PEER, peer2],
      ]),
    });
    await built2.gateway.start();
    await waitFor(() => mock2.calls.length >= 1, "missed message processed");
    const thread2 = built2.engine.getThread(GROUP, "main");
    await waitFor(() => thread2.quiescent, "second quiescence");

    assert.equal(mock2.calls.length, 1);
    assert.equal(mock2.calls[0].id, missedId);
    assert.ok(!mock2.calls.some((c) => c.id !== missedId), "no old message re-run");
    assert.ok(thread2.messages.some((m) => m.id === missedId), "missed message in transcript");
    await built2.gateway.stop();
    await bus2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
