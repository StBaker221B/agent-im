import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentPrompt, parseReply } from "../src/claude-adapter.mjs";

test("parseReply recognizes PASS / ASK_HUMAN / REQUEST_TOOL / DONE", () => {
  assert.deepEqual(parseReply("PASS"), { type: "pass" });
  assert.deepEqual(parseReply("ASK_HUMAN: 需要人决定"), { type: "ask_human", question: "需要人决定" });
  assert.deepEqual(parseReply("REQUEST_TOOL: Write 需要保存文件"), {
    type: "tool_request",
    tool: "Write",
    reason: "需要保存文件",
  });
  assert.deepEqual(parseReply("DONE: 已完成"), { type: "done", reason: "已完成" });
  assert.deepEqual(parseReply("普通回复"), { type: "message", text: "普通回复" });
});

test("buildAgentPrompt includes room, sender, attention, and markers", () => {
  const prompt = buildAgentPrompt({
    message: {
      roomId: "r1",
      threadId: "t1",
      sender: "human",
      senderKind: "human",
      mentions: ["claude-dev"],
      text: "hello",
    },
    recentMessages: [{ sender: "human", text: "hello" }],
    attention: "direct_mention",
  });
  assert.match(prompt, /Room r1, thread t1/);
  assert.match(prompt, /from human \(human\)/);
  assert.match(prompt, /direct_mention/);
  assert.match(prompt, /PASS/);
  assert.match(prompt, /ASK_HUMAN/);
  assert.match(prompt, /DONE/);
});
