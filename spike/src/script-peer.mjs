// Deterministic scripted participant. Implements the same runtime contract as
// the Claude adapter, so the gateway does not care whether a turn is a model
// call or a local script.

const at = (id) => "@" + String(id ?? "").replace(/^@/, "").split(":")[0];

export const scripts = {
  reviewer:
    (envelope) =>
      envelope.attention === "direct_mention" || envelope.attention === "reply"
        ? `收到，${at(envelope.message.sender)}。我看过了，暂时没有异议。`
        : "PASS",
  echo: (envelope) => `ACK: ${envelope.message.text}`,
};

export class ScriptPeer {
  constructor({ agentId, handler = () => "PASS", capabilities: overrides = {} }) {
    this.agentId = agentId;
    this.handler = handler;
    this.overrides = overrides;
  }

  capabilities() {
    return {
      streaming: false,
      interrupt: false,
      resume: false,
      approval: false,
      tools: false,
      multi_session: true,
      ...this.overrides,
    };
  }

  async ensureSession(ctx) {
    return { key: `${ctx.roomId}/${ctx.threadId}`, agentId: this.agentId };
  }

  async *send(session, envelope) {
    const text = this.handler(envelope, session);
    if (text) yield { type: "message", text };
    yield { type: "turn_end", text: text ?? "", sessionId: session.key };
  }

  async interrupt() {}
  async resume(session) {
    return session;
  }
  async health() {
    return [{ key: "script", alive: true }];
  }
  async close() {}
}
