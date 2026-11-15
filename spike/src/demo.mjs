// Deterministic demo: human + PM + dev + reviewer in one room.
// Run: npm run demo
import { Engine } from "./scheduler.mjs";

const e = new Engine({ quietWindowMs: 30, lazyConsensusMs: 50, maxTurnMs: 5000 });
e.addHuman({ id: "human" });
e.addAgent({ id: "pm", owner: "human", roles: ["pm"], domains: ["product"], speakMode: "volunteer", wakePolicy: "mention_or_reply" });
e.addAgent({ id: "dev", owner: "human", roles: ["coder"], domains: ["backend"], speakMode: "volunteer", wakePolicy: "mention_or_reply" });
e.addAgent({ id: "reviewer", owner: "human", roles: ["reviewer"], domains: ["review"], speakMode: "volunteer", wakePolicy: "mention_or_reply" });
e.addRoom({ id: "room1", members: ["human", "pm", "dev", "reviewer"], facilitator: "human", admin: "human" });
e.createThread({ roomId: "room1", threadId: "th1" });

const log = (label, obj) => {
  const granted = obj?.granted ? `floor→${obj.granted.agentId}` : "floor held/empty";
  const delivered = obj?.deliveredTo ? `delivered=[${obj.deliveredTo.join(",")}]` : "";
  const wake = obj?.wake ? `wake=[${obj.wake.join(",")}]` : "";
  console.log(`${label} | ${delivered} ${wake} ${granted}`.trim());
};

console.log("\n=== 1. human asks PM ===");
log("human", e.post({ id: "m1", roomId: "room1", threadId: "th1", sender: "human", text: "做一个登录功能，@pm 拆一下", mentions: ["pm"] }));

console.log("\n=== 2. PM responds with proposal ===");
log("pm", e.agentAct("room1", "th1", "pm", {
  id: "o1",
  type: "message",
  intent: "proposal",
  proposalId: "p1",
  text: "方案：JWT + refresh token；dev 实现，reviewer 审。",
}));

console.log("\n=== 3. dev volunteers and takes the task ===");
log("dev", e.requestFloor("room1", "th1", "dev"));
log("dev", e.agentAct("room1", "th1", "dev", {
  id: "o2",
  type: "message",
  intent: "task",
  taskId: "task1",
  text: "我接实现，worktree: dev-login。",
}));

console.log("\n=== 4. reviewer votes agree ===");
log("reviewer", e.requestFloor("room1", "th1", "reviewer"));
log("reviewer", e.agentAct("room1", "th1", "reviewer", { id: "o3", type: "vote", proposalId: "p1", vote: "agree" }));

console.log("\n=== 5. dev finishes ===");
log("dev", e.requestFloor("room1", "th1", "dev"));
log("dev", e.agentAct("room1", "th1", "dev", { id: "o4", type: "done", taskId: "task1", reason: "login implemented in worktree dev-login", artifact: { kind: "branch", ref: "dev-login" } }));

console.log("\n=== 6. reviewer says LGTM ===");
log("reviewer", e.requestFloor("room1", "th1", "reviewer"));
log("reviewer", e.agentAct("room1", "th1", "reviewer", { id: "o5", type: "message", text: "LGTM", intent: "chat" }));

console.log("\n=== 7. advance time: consensus + quiescence ===");
e.advance(60);
console.log("tick:", e.tick());
console.log("proposal p1:", e.proposals.get("p1")?.status);
console.log("thread quiescent:", e.getThread("room1", "th1").quiescent);
console.log("agent states:", Object.fromEntries(e.getThread("room1", "th1").states));

console.log("\n=== transcript ===");
for (const m of e.getThread("room1", "th1").messages) {
  console.log(`${m.sender.padEnd(9)} ${String(m.intent).padEnd(9)} ${m.text}`);
}
