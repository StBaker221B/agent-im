// Milestone A: real Claude Code as one IM participant on the fake bus.
// Phases: first turn, continuity (same process), restart + resume (kill and --resume).
// Run: npm run claude-demo
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { Engine } from "./scheduler.mjs";
import { ClaudeAdapter, parseReply } from "./claude-adapter.mjs";

const ROOM = "r1";
const THREAD = "t1";
const auditDir = join(process.cwd(), ".tmp");
mkdirSync(auditDir, { recursive: true });
const auditPath = join(auditDir, "audit.jsonl");
const audit = (ev) => appendFileSync(auditPath, JSON.stringify({ ts: new Date().toISOString(), ...ev }) + "\n", "utf8");

const engine = new Engine({ quietWindowMs: 100, lazyConsensusMs: 100, maxTurnMs: 600_000 });
engine.addHuman({ id: "human" });
engine.addAgent({
  id: "claude-dev",
  owner: "human",
  roles: ["coder"],
  domains: ["auth"],
  speakMode: "volunteer",
  wakePolicy: "mention_or_reply",
});
engine.addAgent({
  id: "reviewer",
  owner: "human",
  roles: ["reviewer"],
  domains: ["review"],
  speakMode: "volunteer",
  wakePolicy: "mention_or_reply",
});
engine.addRoom({ id: ROOM, members: ["human", "claude-dev", "reviewer"], facilitator: "human", admin: "human" });
engine.createThread({ roomId: ROOM, threadId: THREAD });

const adapter = new ClaudeAdapter({
  cwd: process.cwd(),
  agentId: "claude-dev",
  turnTimeoutMs: 180_000,
  systemPrompt: `You are @claude-dev, an agent in an IM room. You are a coding agent.
Reply as a normal participant: one concise message, no name prefix.
Do not use tools unless the newest message explicitly asks you to edit code or run commands.
If you have nothing to add, reply exactly PASS.
If a human decision is needed, reply exactly ASK_HUMAN: <question>.
If your assignment is complete, reply exactly DONE: <summary>.`,
});

let totalCost = 0;
let totalInput = 0;
let totalOutput = 0;
let steps = 0;
let lastSessionId = null;
let claudeSession = null;

function printUsage(ev, label) {
  totalCost += ev.costUsd ?? 0;
  totalInput += ev.usage?.input_tokens ?? 0;
  totalOutput += ev.usage?.output_tokens ?? 0;
  lastSessionId = ev.sessionId ?? lastSessionId;
  console.log(`usage(${label}): in=${ev.usage?.input_tokens} out=${ev.usage?.output_tokens} cost=$${ev.costUsd}`);
  audit({ kind: "usage", agentId: "claude-dev", ...ev });
}

async function runClaudeTurn(envelope, label) {
  const events = [];
  for await (const ev of adapter.send(claudeSession, envelope)) {
    events.push(ev);
    if (ev.type === "message") {
      console.log(`claude: ${ev.text}`);
      audit({ kind: "message", agentId: "claude-dev", text: ev.text, sessionId: lastSessionId });
    }
    if (ev.type === "tool_use") {
      console.log(`claude tool: ${ev.name}`);
      audit({ kind: "tool_use", agentId: "claude-dev", name: ev.name, input: ev.input, sessionId: lastSessionId });
    }
    if (ev.type === "tool_result") {
      audit({ kind: "tool_result", agentId: "claude-dev", toolUseId: ev.toolUseId, isError: ev.isError, sessionId: lastSessionId });
    }
    if (ev.type === "usage") printUsage(ev, label);
    if (ev.type === "turn_end") lastSessionId = ev.sessionId ?? lastSessionId;
  }

  const reply = events.filter((e) => e.type === "message").map((e) => e.text).join("").trim();
  const action = parseReply(reply);
  console.log("parsed action:", action.type);

  let act;
  if (action.type === "pass") {
    act = engine.agentAct(ROOM, THREAD, "claude-dev", { id: `claude-${++steps}`, type: "pass" });
  } else if (action.type === "ask_human") {
    act = engine.agentAct(ROOM, THREAD, "claude-dev", { id: `claude-${++steps}`, type: "ask_human", question: action.question });
  } else if (action.type === "done") {
    act = engine.agentAct(ROOM, THREAD, "claude-dev", { id: `claude-${++steps}`, type: "done", reason: action.reason });
  } else {
    const mentions = [...action.text.matchAll(/@([a-zA-Z0-9_-]+)/g)]
      .map((m) => m[1])
      .filter((x) => x !== "claude-dev");
    act = engine.agentAct(ROOM, THREAD, "claude-dev", {
      id: `claude-${++steps}`,
      type: "message",
      text: action.text,
      mentions,
    });
  }
  return act.granted;
}

try {
  const session = await adapter.ensureSession({ roomId: ROOM, threadId: THREAD });
  claudeSession = session;
  console.log("session:", session.sessionId ?? "(new)");
  console.log("pid:", session.child?.pid);

  console.log("\n=== phase 1: first turn ===");
  const humanText = "请 @claude-dev 用一句话说明登录功能怎么做；如果需要 review，请 @reviewer。";
  const post = engine.post({
    id: "m1",
    roomId: ROOM,
    threadId: THREAD,
    sender: "human",
    text: humanText,
    mentions: ["claude-dev"],
  });
  console.log(`human: ${humanText}`);
  console.log(`delivered=${JSON.stringify(post.deliveredTo)} wake=${JSON.stringify(post.wake)} floor=${post.granted?.agentId}`);

  let pending = post.granted;
  while (pending && steps < 8) {
    const { agentId, envelope } = pending;
    console.log(`\n--- floor: ${agentId} ---`);
    if (agentId === "claude-dev") {
      pending = await runClaudeTurn(envelope, `turn-${steps + 1}`);
      if (!pending && steps === 1) {
        const req = engine.requestFloor(ROOM, THREAD, "reviewer");
        if (req.granted) pending = req.granted;
      }
    } else if (agentId === "reviewer") {
      const text = "同意，建议 JWT + refresh token。没有补充。";
      console.log(`reviewer: ${text}`);
      const act = engine.agentAct(ROOM, THREAD, "reviewer", {
        id: `reviewer-${++steps}`,
        type: "message",
        text,
        intent: "chat",
      });
      pending = act.granted;
    } else {
      console.log(`unexpected floor holder: ${agentId}`);
      break;
    }
  }

  console.log("\n=== phase 2: continuity (same process) ===");
  const followUp = "请 @claude-dev 补充一句：refresh token 的过期时间建议设多久？";
  const post2 = engine.post({
    id: "m2",
    roomId: ROOM,
    threadId: THREAD,
    sender: "human",
    text: followUp,
    mentions: ["claude-dev"],
  });
  console.log(`human: ${followUp}`);
  if (post2.granted) await runClaudeTurn(post2.granted.envelope, "continuity");

  console.log("\n=== phase 3: restart + resume (kill process, --resume) ===");
  const beforeKill = lastSessionId;
  await adapter.interrupt(session);
  console.log("killed pid:", session.child?.pid, "sessionId before:", beforeKill);
  await new Promise((r) => setTimeout(r, 800));

  const afterRestart = "请 @claude-dev 用一句话总结我们刚才定的登录方案。";
  const post3 = engine.post({
    id: "m3",
    roomId: ROOM,
    threadId: THREAD,
    sender: "human",
    text: afterRestart,
    mentions: ["claude-dev"],
  });
  console.log(`human: ${afterRestart}`);
  if (post3.granted) await runClaudeTurn(post3.granted.envelope, "resume");
  console.log("sessionId after:", lastSessionId, "resume kept:", lastSessionId === beforeKill);

  engine.advance(200);
  console.log("\n=== tick ===");
  console.log(engine.tick());
  console.log("quiescent:", engine.getThread(ROOM, THREAD).quiescent);
  console.log("states:", Object.fromEntries(engine.getThread(ROOM, THREAD).states));

  console.log("\n=== transcript ===");
  for (const m of engine.getThread(ROOM, THREAD).messages) {
    console.log(`${m.sender.padEnd(11)} ${String(m.intent).padEnd(9)} ${m.text}`);
  }

  console.log(`\n=== totals ===\nin=${totalInput} out=${totalOutput} cost=$${totalCost.toFixed(6)}`);
  console.log("audit:", auditPath);
  console.log("adapter health:", await adapter.health());
} finally {
  await adapter.close();
}
