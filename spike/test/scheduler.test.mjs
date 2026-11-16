import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/scheduler.mjs";

function setup(overrides = {}) {
  const e = new Engine({ quietWindowMs: 100, lazyConsensusMs: 100, maxTurnMs: 1000, ...overrides });
  e.addHuman({ id: "human" });
  e.addAgent({
    id: "a1",
    owner: "human",
    roles: ["pm", "reviewer"],
    domains: ["auth"],
    speakMode: "volunteer",
    wakePolicy: "mention_or_reply",
    canInvite: "allowlist",
    allowlist: ["a2"],
  });
  e.addAgent({
    id: "a2",
    owner: "human",
    roles: ["coder"],
    domains: ["frontend"],
    speakMode: "volunteer",
    wakePolicy: "mention_or_reply",
    canInvite: "none",
  });
  e.addRoom({ id: "r1", members: ["human", "a1", "a2"], facilitator: "human", admin: "human" });
  e.createThread({ roomId: "r1", threadId: "t1" });
  return e;
}

test("delivery reaches everyone; mention is an attention signal", () => {
  const e = setup();
  const res = e.post({ id: "m1", roomId: "r1", threadId: "t1", sender: "human", text: "@a1 please", mentions: ["a1"] });
  assert.equal(res.duplicate, false);
  assert.deepEqual(res.deliveredTo, ["a1", "a2"]);
  assert.ok(res.wake.includes("a1"));
  assert.ok(!res.wake.includes("a2"));
  assert.equal(e.attentionFor("a1", res.message), "direct_mention");
  assert.equal(e.attentionFor("a2", res.message), "room_mention");
  assert.equal(res.granted.agentId, "a1");
});

test("mention beats volunteer; pass releases the floor", () => {
  const e = setup();
  const res = e.post({ id: "m1", roomId: "r1", threadId: "t1", sender: "human", text: "@a2", mentions: ["a2"] });
  assert.equal(res.granted.agentId, "a2");

  const req = e.requestFloor("r1", "t1", "a1");
  assert.equal(req.enqueued, true);
  assert.equal(e.getThread("r1", "t1").floor.holder, "a2");

  const pass = e.agentAct("r1", "t1", "a2", { id: "o1", type: "pass" });
  assert.equal(pass.accepted, true);
  assert.equal(pass.granted.agentId, "a1");
});

test("single writer per thread; the next writer gets the floor after release", () => {
  const e = setup();
  const r1 = e.post({ id: "m1", roomId: "r1", threadId: "t1", sender: "human", text: "@a1", mentions: ["a1"] });
  assert.equal(r1.granted.agentId, "a1");

  const r2 = e.post({ id: "m2", roomId: "r1", threadId: "t1", sender: "human", text: "@a2", mentions: ["a2"] });
  assert.equal(r2.granted, null);
  assert.equal(e.getThread("r1", "t1").floor.holder, "a1");

  const act = e.agentAct("r1", "t1", "a1", { id: "o1", type: "message", text: "working on it" });
  assert.equal(act.accepted, true);
  assert.equal(act.granted.agentId, "a2");
});

test("quiescence after answer + quiet window", () => {
  const e = setup();
  const q = e.post({ id: "q1", roomId: "r1", threadId: "t1", sender: "human", text: "status?", intent: "question" });
  assert.equal(q.granted, null);

  const req = e.requestFloor("r1", "t1", "a1");
  assert.equal(req.granted.agentId, "a1");

  const a = e.agentAct("r1", "t1", "a1", { id: "o1", type: "message", text: "done", intent: "answer", replyTo: "q1" });
  assert.equal(a.accepted, true);
  assert.equal(e.getThread("r1", "t1").quiescent, false);

  const results = e.tick(100);
  assert.ok(results.some((r) => r.type === "quiescent"));
  assert.equal(e.getThread("r1", "t1").quiescent, true);
});

test("lazy consensus accepts a proposal with no objection", () => {
  const e = setup();
  e.post({ id: "p1", roomId: "r1", threadId: "t1", sender: "human", text: "proposal A", intent: "proposal", proposalId: "prop1" });
  assert.equal(e.proposals.get("prop1").status, "open");
  e.tick(100);
  assert.equal(e.proposals.get("prop1").status, "accepted");
});

test("an objection escalates to the human chain", () => {
  const e = setup();
  e.post({ id: "p2", roomId: "r1", threadId: "t1", sender: "human", text: "proposal B", intent: "proposal", proposalId: "prop2" });
  e.vote("prop2", "a1", "object");
  assert.equal(e.proposals.get("prop2").status, "escalated");
  assert.deepEqual(e.resolveEscalation(e.getThread("r1", "t1"), "a1"), ["human"]);
});

test("escalation chain: task owner -> facilitator -> agent owner -> admin", () => {
  const e = setup();
  const t = e.getThread("r1", "t1");

  t.taskOwner = "a2";
  assert.deepEqual(e.resolveEscalation(t, "a1"), ["a2"]);

  t.taskOwner = null;
  assert.deepEqual(e.resolveEscalation(t, "a1"), ["human"]); // room facilitator

  e.rooms.get("r1").facilitator = null;
  assert.deepEqual(e.resolveEscalation(t, "a1"), ["human"]); // agent owner

  e.agents.get("a1").owner = null;
  assert.deepEqual(e.resolveEscalation(t, "a1"), ["human"]); // room admin
});

test("idempotency: duplicate inbound and outbound ids are ignored", () => {
  const e = setup();
  e.post({ id: "m1", roomId: "r1", threadId: "t1", sender: "human", text: "hi", mentions: ["a1"] });
  const dup = e.post({ id: "m1", roomId: "r1", threadId: "t1", sender: "human", text: "hi", mentions: ["a1"] });
  assert.equal(dup.duplicate, true);
  assert.equal(e.getThread("r1", "t1").messages.length, 1);

  e.agentAct("r1", "t1", "a1", { id: "o1", type: "message", text: "hello" });
  const dupAct = e.agentAct("r1", "t1", "a1", { id: "o1", type: "message", text: "hello" });
  assert.equal(dupAct.duplicate, true);
  assert.equal(e.getThread("r1", "t1").messages.length, 2);
});

test("canInvite is enforced by configuration", () => {
  const e = setup();
  e.addAgent({
    id: "a3",
    owner: "human",
    roles: ["researcher"],
    domains: ["search"],
    canInvite: "approval",
  });
  e.rooms.get("r1").members.push("a3");

  assert.equal(e.canInvite("a1", "a2", "r1"), true);
  assert.equal(e.canInvite("a1", "a3", "r1"), false);
  assert.equal(e.canInvite("a2", "a1", "r1"), false);
  assert.equal(e.canInvite("a3", "a1", "r1"), "approval");
});

test("interrupt preempts the floor; human post reopens it", () => {
  const e = setup();
  e.post({ id: "m1", roomId: "r1", threadId: "t1", sender: "human", text: "@a1", mentions: ["a1"] });
  assert.equal(e.getThread("r1", "t1").floor.holder, "a1");

  const i = e.interrupt("r1", "t1", "human");
  assert.equal(i.previous, "a1");
  assert.equal(e.getThread("r1", "t1").floor.holder, "human");
  assert.equal(e.stateOf("r1", "t1", "a1"), "waiting");

  e.post({ id: "m2", roomId: "r1", threadId: "t1", sender: "human", text: "listen to me" });
  assert.notEqual(e.getThread("r1", "t1").floor.holder, "human");
});

test("turn timeout releases the floor into error", () => {
  const e = setup({ maxTurnMs: 50 });
  e.post({ id: "m1", roomId: "r1", threadId: "t1", sender: "human", text: "@a1", mentions: ["a1"] });
  const results = e.tick(50);
  assert.ok(results.some((r) => r.type === "turn_timeout"));
  assert.equal(e.stateOf("r1", "t1", "a1"), "error");
});

test("whoCanHelp resolves roles/domains", () => {
  const e = setup();
  assert.deepEqual(e.whoCanHelp("auth"), ["a1"]);
  assert.deepEqual(e.whoCanHelp("frontend"), ["a2"]);
});

test("ASK_HUMAN blocks quiescence; a human reply clears it and wakes the waiter", () => {
  const e = setup();
  const asker = e.post({ id: "m1", roomId: "r1", threadId: "t1", sender: "human", text: "@a1 decide", mentions: ["a1"] });
  assert.equal(asker.granted.agentId, "a1");

  const ask = e.agentAct("r1", "t1", "a1", { id: "o1", type: "ask_human", question: "approve the merge?" });
  assert.equal(ask.accepted, true);
  assert.equal(e.stateOf("r1", "t1", "a1"), "waiting");
  assert.equal(e.getThread("r1", "t1").pendingApprovals.size, 1);
  assert.equal(e.getThread("r1", "t1").messages.at(-1).intent, "ask_human");

  e.advance(1000);
  assert.ok(!e.tick().some((r) => r.type === "quiescent"), "pending approval blocks quiescence");

  const reply = e.post({ id: "m2", roomId: "r1", threadId: "t1", sender: "human", text: "approved" });
  assert.equal(reply.granted?.agentId, "a1", "human reply gives the floor back");
  assert.equal(e.getThread("r1", "t1").pendingApprovals.size, 0);

  e.agentAct("r1", "t1", "a1", { id: "o2", type: "done", reason: "ok" });
  e.advance(1000);
  assert.ok(e.tick().some((r) => r.type === "quiescent"));
});
