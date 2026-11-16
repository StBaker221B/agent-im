// Cost-free runtime for tests and the fake-bus demo. Same contract as
// ClaudeAdapter/ScriptPeer; `reply(envelope, turnNumber)` returns raw text
// (including PASS / ASK_HUMAN: / DONE: markers).

export class MockRuntime {
  constructor({ agentId, reply = () => "PASS", capabilities: overrides = {} }) {
    this.agentId = agentId;
    this.reply = reply;
    this.overrides = overrides;
    this.calls = [];
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
    this.calls.push({ id: envelope.message.id, thread: session.key, attention: envelope.attention });
    const text = this.reply(envelope, this.calls.length);
    yield { type: "message", text };
    yield { type: "turn_end", text, sessionId: session.key };
  }

  async interrupt() {}
  async resume(session) {
    return session;
  }
  async health() {
    return [{ key: "mock", alive: true, calls: this.calls.length }];
  }
  async close() {}
}
