// Shared prompt building and response-marker parsing.
// Kept separate from the Claude adapter so the gateway and script peers use
// exactly the same marker grammar as a real runtime.

export function buildAgentPrompt(envelope) {
  const m = envelope.message;
  const recent = (envelope.recentMessages ?? [])
    .slice(-8)
    .map((x) => `[${x.sender}] ${x.text}`)
    .join("\n");
  return `Room ${m.roomId}, thread ${m.threadId}.
Recent messages:
${recent || "(none)"}

Newest message from ${m.sender} (${m.senderKind}); mentions=${JSON.stringify(m.mentions ?? [])}; your attention=${envelope.attention}.
Reply as yourself, in one message max. Do not prefix with your name.
If you have nothing to add, reply exactly: PASS
If you need a human decision, reply exactly: ASK_HUMAN: <question>
If you are done, reply exactly: DONE: <summary>
If another agent's point needs a concrete question, objection or addition, @ that agent and continue. Do not repeat or exchange pleasantries. PASS when you have nothing new.`;
}

export function parseReply(text) {
  const t = (text ?? "").trim();
  if (/^PASS\b/i.test(t) || t === "PASS") return { type: "pass" };
  if (/^ASK_HUMAN\s*:/i.test(t)) return { type: "ask_human", question: t.replace(/^ASK_HUMAN\s*:/i, "").trim() };
  if (/^REQUEST_TOOL\s*:/i.test(t)) {
    const body = t.replace(/^REQUEST_TOOL\s*:/i, "").trim();
    const [tool, ...rest] = body.split(/\s+/);
    return { type: "tool_request", tool: tool ?? "", reason: rest.join(" ") };
  }
  if (/^DONE\s*:/i.test(t)) return { type: "done", reason: t.replace(/^DONE\s*:/i, "").trim() };
  // Some models emit a fake DSML/XML tool call when the CLI has no tools.
  // Treat it as a request instead of posting raw XML to the room.
  const invoked = /invoke\s+name=["']([^"']+)["']/i.exec(t);
  if (invoked && /DSML|function_calls|invoke\s+name=/i.test(t)) {
    return { type: "tool_request", tool: invoked[1], reason: "模型尝试调用不可用工具" };
  }
  return { type: "message", text: t };
}
