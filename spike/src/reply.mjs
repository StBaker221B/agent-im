// Shared prompt building and response-marker parsing.
// Kept separate from the Claude adapter so the gateway and script peers use
// exactly the same marker grammar as a real runtime.

function formatTime(ts) {
  if (!ts) return "unknown";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function buildAgentPrompt(envelope) {
  const m = envelope.message;
  const recent = (envelope.recentMessages ?? [])
    .slice(-8)
    .map((x) => `[${formatTime(x.createdAt)}] [${x.sender}] ${x.text}`)
    .join("\n");
  const taskLine = m.taskId
    ? `This message is task ${m.taskId}${m.taskOwner ? ` owned by ${m.taskOwner}` : ""}. When you finish, reply exactly: DONE: <summary>.`
    : "If you need to record a long-running task, reply exactly: TASK: <title>.";
  const roomLine =
    'If you need a side room, reply exactly: REQUEST_ROOM: dm @agent <reason> or REQUEST_ROOM: group "name" @a @b <reason>. You never create rooms yourself; a human approves.';
  return `Current time: ${formatTime(Date.now())} (local server time).
Room ${m.roomId}, thread ${m.threadId}.
Recent messages (timestamped):
${recent || "(none)"}

Newest message from ${m.sender} (${m.senderKind}) at ${formatTime(m.createdAt)}; mentions=${JSON.stringify(m.mentions ?? [])}; your attention=${envelope.attention}.
${taskLine}
${roomLine}
Use the timestamps above for dates. If an older memory has no timestamp, say you are unsure instead of guessing.
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
  if (/^TASK\s*:/i.test(t)) return { type: "task", title: t.replace(/^TASK\s*:/i, "").trim() };
  if (/^REQUEST_ROOM\s*:/i.test(t)) {
    const body = t.replace(/^REQUEST_ROOM\s*:/i, "").trim();
    const kind = /^dm\b/i.test(body) ? "dm" : /^group\b/i.test(body) ? "group" : "";
    const nameMatch = /^group\s+(?:"([^"]+)"|(\S+))/i.exec(body);
    return {
      type: "room_request",
      body,
      roomKind: kind,
      roomName: nameMatch?.[1] ?? nameMatch?.[2] ?? "",
    };
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
