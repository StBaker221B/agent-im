// Agent IM spike: deterministic floor / quiescence / consensus engine.
// No external deps. Time is injected so tests are deterministic.

let seq = 0;
const nextId = (prefix) => `${prefix}-${++seq}`;

/**
 * @typedef {"chat"|"proposal"|"question"|"answer"|"decision"|"task"|"status"|"done"|"handoff"|"ask_human"|"agree"|"object"|"abstain"|"pass"} Intent
 * @typedef {"idle"|"waiting"|"thinking"|"working"|"done"|"pass"|"error"} AgentState
 */

export class Engine {
  /**
   * @param {{quietWindowMs?: number, maxTurnMs?: number, lazyConsensusMs?: number, now?: number}} opts
   */
  constructor(opts = {}) {
    this.now = opts.now ?? 0;
    this.quietWindowMs = opts.quietWindowMs ?? 50;
    this.maxTurnMs = opts.maxTurnMs ?? 1000;
    this.lazyConsensusMs = opts.lazyConsensusMs ?? 100;
    // Cap consecutive agent messages after a human message. Mentions can wake
    // another agent, but a thread cannot ping-pong forever.
    this.maxAgentChain = opts.maxAgentChain ?? 3;

    /** @type {Map<string, any>} */
    this.agents = new Map();
    /** @type {Map<string, any>} */
    this.rooms = new Map();
    /** @type {Map<string, any>} */
    this.threads = new Map();
    /** @type {Map<string, any>} */
    this.proposals = new Map();
    this.processedMessageIds = new Set();
    this.processedOutboundIds = new Set();
  }

  advance(ms) {
    this.now += ms;
    return this.now;
  }

  setNow(now) {
    this.now = now;
    return this.now;
  }

  addAgent(agent) {
    if (!agent.id) throw new Error("agent.id required");
    this.agents.set(agent.id, {
      id: agent.id,
      kind: "agent",
      owner: agent.owner ?? null,
      roles: agent.roles ?? [],
      domains: agent.domains ?? [],
      speakMode: agent.speakMode ?? "volunteer",
      wakePolicy: agent.wakePolicy ?? "mention_or_reply",
      canInvite: agent.canInvite ?? "allowlist",
      allowlist: agent.allowlist ?? [],
      ...agent,
    });
    return this.agents.get(agent.id);
  }

  addHuman(human) {
    this.agents.set(human.id, { id: human.id, kind: "human", ...human });
    return this.agents.get(human.id);
  }

  addRoom(room) {
    if (!room.id || !Array.isArray(room.members)) throw new Error("room.id/members required");
    this.rooms.set(room.id, {
      id: room.id,
      members: [...room.members],
      facilitator: room.facilitator ?? null,
      admin: room.admin ?? null,
      ...room,
    });
    return this.rooms.get(room.id);
  }

  createThread({ roomId, threadId, taskOwner = null, agendaId = null }) {
    if (!this.rooms.has(roomId)) throw new Error(`unknown room ${roomId}`);
    const key = `${roomId}/${threadId}`;
    const thread = {
      key,
      roomId,
      id: threadId,
      messages: [],
      version: 0,
      floor: { threadId: key, holder: null, human: false, version: 0, queue: [], expiresAt: null },
      states: new Map(), // agentId -> AgentState
      seenVersion: new Map(), // agentId -> thread.version
      quiescent: false,
      lastSubstantiveAt: this.now,
      taskOwner,
      facilitator: null,
      agendaId,
      openTasks: new Set(),
      openQuestions: new Set(),
      pendingApprovals: new Set(),
      interruptedBy: null,
      agentChainDepth: 0,
    };
    for (const memberId of this.rooms.get(roomId).members) {
      const member = this.agents.get(memberId);
      if (member?.kind === "agent") thread.states.set(memberId, "idle");
      thread.seenVersion.set(memberId, 0);
    }
    this.threads.set(key, thread);
    return thread;
  }

  /**
   * Rebuild a thread from persisted history without waking anyone or granting
   * the floor. Hydrated ids are treated as already consumed, so a synced replay
   * of the same event is ignored. Callers must only pass messages that are
   * known to predate the gateway's persisted high-water mark.
   */
  hydrateThread({ roomId, threadId, messages = [] }) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`unknown room ${roomId}`);
    let thread = this.getThread(roomId, threadId);
    if (!thread) thread = this.createThread({ roomId, threadId });
    const seen = new Set(thread.messages.map((m) => m.id));
    for (const input of messages) {
      if (!input?.id || seen.has(input.id)) continue;
      const message = {
        id: input.id,
        roomId,
        threadId,
        sender: input.sender,
        senderKind: input.senderKind ?? (this.agents.get(input.sender)?.kind ?? "human"),
        text: input.text ?? "",
        intent: input.intent ?? "chat",
        mentions: input.mentions ?? [],
        replyTo: input.replyTo,
        proposalId: input.proposalId,
        taskId: input.taskId,
        taskOwner: input.taskOwner,
        artifact: input.artifact,
        createdAt: input.createdAt ?? this.now,
      };
      thread.messages.push(message);
      thread.version += 1;
      for (const memberId of room.members) thread.seenVersion.set(memberId, thread.version);
      if (this.#isSubstantive(message)) thread.lastSubstantiveAt = this.now;
      this.#trackTaskOrQuestion(message, thread);
      if (message.intent === "proposal" && message.proposalId && !this.proposals.has(message.proposalId)) {
        // A historical proposal without a recorded decision is closed by
        // definition; leaving it open would block quiescence forever.
        this.proposals.set(message.proposalId, {
          id: message.proposalId,
          threadKey: thread.key,
          roomId,
          threadId,
          proposer: message.sender,
          createdAt: message.createdAt,
          deadlineAt: message.createdAt,
          votes: new Map(),
          status: "closed_history",
        });
      }
      this.processedMessageIds.add(message.id);
      seen.add(message.id);
    }
    for (const [agentId, state] of thread.states) {
      if (state === "thinking" || state === "working" || state === "waiting") thread.states.set(agentId, "idle");
    }
    thread.floor.holder = null;
    thread.floor.human = false;
    thread.floor.version += 1;
    return thread;
  }

  getThread(roomId, threadId) {
    return this.threads.get(`${roomId}/${threadId}`);
  }

  stateOf(roomId, threadId, agentId) {
    return this.getThread(roomId, threadId)?.states.get(agentId) ?? "idle";
  }

  setState(roomId, threadId, agentId, state) {
    const t = this.getThread(roomId, threadId);
    if (!t) throw new Error("unknown thread");
    t.states.set(agentId, state);
  }

  /** Post a message from a human/service/agent. Idempotent by message.id. */
  post(input) {
    const room = this.rooms.get(input.roomId);
    if (!room) throw new Error(`unknown room ${input.roomId}`);
    const thread = this.getThread(input.roomId, input.threadId);
    if (!thread) throw new Error(`unknown thread ${input.threadId}`);

    const id = input.id ?? nextId("msg");
    if (this.processedMessageIds.has(id)) {
      return { duplicate: true, id, deliveredTo: [], wake: [], floor: thread.floor };
    }
    this.processedMessageIds.add(id);

    const message = {
      id,
      roomId: input.roomId,
      threadId: input.threadId,
      sender: input.sender,
      senderKind: input.senderKind ?? (this.agents.get(input.sender)?.kind ?? "human"),
      text: input.text ?? "",
      intent: input.intent ?? "chat",
      mentions: input.mentions ?? [],
      replyTo: input.replyTo,
      proposalId: input.proposalId,
      taskId: input.taskId,
      taskOwner: input.taskOwner,
      artifact: input.artifact,
      createdAt: this.now,
    };

    const deliveredTo = room.members.filter((m) => m !== message.sender);
    for (const memberId of deliveredTo) thread.seenVersion.set(memberId, thread.version + 1);
    thread.version += 1;
    thread.messages.push(message);
    thread.quiescent = false;
    if (message.senderKind === "human") thread.agentChainDepth = 0;
    else if (message.senderKind === "agent") thread.agentChainDepth += 1;

    if (this.#isSubstantive(message)) {
      thread.lastSubstantiveAt = this.now;
    }

    this.#trackTaskOrQuestion(message, thread);
    this.#maybeCreateProposal(message, thread);
    this.#syncHumanFloor(message, thread);

    // A human message in the thread is a response to anything the agents were
    // waiting on (ASK_HUMAN / approval). Clear the block and give the waiting
    // agents the floor back; an explicit mention/reply still outranks this.
    if (message.senderKind === "human") {
      thread.pendingApprovals.clear();
      for (const [agentId, state] of thread.states) {
        if (state !== "waiting") continue;
        thread.states.set(agentId, "idle");
        this.#enqueue(thread, {
          agentId,
          priority: 1,
          enqueuedAt: this.now,
          reason: "reply",
          messageId: message.id,
        });
      }
    }

    const wake = [];
    const chainCapped = message.senderKind === "agent" && thread.agentChainDepth >= this.maxAgentChain;
    for (const memberId of deliveredTo) {
      const agent = this.agents.get(memberId);
      if (agent?.kind !== "agent") continue;
      if (!chainCapped && this.#shouldWake(agent, message)) wake.push(memberId);
    }

    // Auto-enqueue direct mention / reply / task owner. Volunteers call requestFloor().
    this.#enqueueCandidates(message, thread, deliveredTo);

    const granted = this.grantNext(input.roomId, input.threadId);
    return { duplicate: false, id, message, deliveredTo, wake, floor: thread.floor, granted };
  }

  requestFloor(roomId, threadId, agentId, opts = {}) {
    const thread = this.getThread(roomId, threadId);
    const agent = this.agents.get(agentId);
    if (!thread || !agent || agent.kind !== "agent") throw new Error("unknown agent/thread");
    const latest = thread.messages[thread.messages.length - 1];
    const attention = latest ? this.attentionFor(agentId, latest) : "ambient";
    const priority = opts.priority ?? 2;
    const reason = opts.reason ?? "volunteer";
    if (agent.speakMode === "mentioned_only" && attention === "ambient") {
      return { enqueued: false, reason: "speak_mode=mentioned_only" };
    }
    this.#enqueue(thread, {
      agentId,
      priority,
      enqueuedAt: this.now,
      reason,
      messageId: latest?.id,
      proposalId: opts.proposalId,
    });
    return { enqueued: true, granted: this.grantNext(roomId, threadId) };
  }

  grantNext(roomId, threadId) {
    const thread = this.getThread(roomId, threadId);
    if (!thread) return null;
    if (thread.floor.holder) return null;

    thread.floor.queue.sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt || a.agentId.localeCompare(b.agentId));
    const item = thread.floor.queue.shift();
    if (!item) return null;

    thread.floor.holder = item.agentId;
    thread.floor.human = false;
    thread.floor.version += 1;
    thread.floor.expiresAt = this.now + this.maxTurnMs;
    thread.states.set(item.agentId, "thinking");
    const trigger = thread.messages.find((m) => m.id === item.messageId) ?? thread.messages[thread.messages.length - 1];
    const envelope = this.#envelope(thread, item.agentId, trigger);
    return { agentId: item.agentId, floor: { ...thread.floor, queue: [...thread.floor.queue] }, envelope };
  }

  /** Agent acts while holding the floor. */
  agentAct(roomId, threadId, agentId, outbound) {
    const thread = this.getThread(roomId, threadId);
    if (!thread) throw new Error("unknown thread");
    const outId = outbound.id ?? nextId("out");
    if (this.processedOutboundIds.has(outId)) return { duplicate: true, id: outId };
    this.processedOutboundIds.add(outId);

    if (thread.floor.holder !== agentId) {
      return { accepted: false, reason: `agent ${agentId} does not hold the floor` };
    }

    if (outbound.type === "pass") {
      thread.states.set(agentId, "pass");
      this.#release(thread);
      return { accepted: true, pass: true, granted: this.grantNext(roomId, threadId) };
    }

    if (outbound.type === "vote") {
      this.vote(outbound.proposalId, agentId, outbound.vote);
      thread.states.set(agentId, "idle");
      this.#release(thread);
      return { accepted: true, vote: true, granted: this.grantNext(roomId, threadId) };
    }

    if (outbound.type === "state") {
      thread.states.set(agentId, outbound.state);
      this.#release(thread);
      return { accepted: true, state: outbound.state, granted: this.grantNext(roomId, threadId) };
    }

    if (outbound.type === "ask_human") {
      const escalation = this.resolveEscalation(thread, agentId);
      const msg = this.#appendAgentMessage(thread, agentId, {
        text: outbound.question ?? outbound.text ?? "",
        intent: "ask_human",
        mentions: outbound.mentions ?? [],
        id: outId,
      });
      thread.pendingApprovals.add(nextId("approval"));
      thread.states.set(agentId, "waiting");
      this.#release(thread);
      return { accepted: true, message: msg, askHuman: true, escalation, granted: this.grantNext(roomId, threadId) };
    }

    if (outbound.type === "done" || outbound.type === "handoff") {
      const msg = this.#appendAgentMessage(thread, agentId, {
        text: outbound.reason ?? "",
        intent: outbound.type,
        mentions: outbound.mentions ?? [],
        taskId: outbound.taskId,
        artifact: outbound.artifact,
        id: outId,
      });
      thread.states.set(agentId, outbound.type === "done" ? "done" : "idle");
      this.#release(thread);
      if (outbound.type === "handoff" && outbound.to) {
        this.#enqueue(thread, { agentId: outbound.to, priority: 0, enqueuedAt: this.now, reason: "mention", messageId: msg.id });
      }
      return { accepted: true, message: msg, granted: this.grantNext(roomId, threadId) };
    }

    // message / artifact / approval_request / task_update default to a message
    const msg = this.#appendAgentMessage(thread, agentId, {
      text: outbound.text ?? "",
      intent: outbound.intent ?? "chat",
      replyTo: outbound.replyTo,
      mentions: outbound.mentions ?? [],
      proposalId: outbound.proposalId,
      taskId: outbound.taskId,
      artifact: outbound.artifact,
      id: outId,
    });
    thread.states.set(agentId, "idle");
    this.#release(thread);
    return { accepted: true, message: msg, granted: this.grantNext(roomId, threadId) };
  }

  interrupt(roomId, threadId, by) {
    const thread = this.getThread(roomId, threadId);
    if (!thread) throw new Error("unknown thread");
    const previous = thread.floor.holder;
    if (previous && previous !== by) thread.states.set(previous, "waiting");
    thread.floor.holder = by;
    thread.floor.human = true;
    thread.floor.version += 1;
    thread.floor.expiresAt = null;
    thread.interruptedBy = by;
    return { previous, holder: by };
  }

  tick(now = this.now) {
    this.now = now;
    const results = [];
    for (const thread of this.threads.values()) {
      if (thread.floor.holder && thread.floor.expiresAt && now >= thread.floor.expiresAt && !thread.floor.human) {
        const expired = thread.floor.holder;
        thread.states.set(expired, "error");
        thread.floor.holder = null;
        thread.floor.expiresAt = null;
        thread.floor.version += 1;
        thread.quiescent = false;
        results.push({ type: "turn_timeout", thread: thread.key, agentId: expired });
        const grant = this.grantNext(thread.roomId, thread.id);
        if (grant) results.push({ type: "granted", thread: thread.key, grant });
      }

      for (const proposal of this.proposals.values()) {
        if (proposal.threadKey !== thread.key || proposal.status !== "open") continue;
        const evalResult = this.evaluateProposal(proposal.id, now);
        if (evalResult) results.push(evalResult);
      }

      if (!thread.quiescent && this.#isQuiescent(thread, now)) {
        thread.quiescent = true;
        for (const [agentId, state] of thread.states) {
          if (state !== "error") thread.states.set(agentId, "idle");
        }
        results.push({ type: "quiescent", thread: thread.key });
      }
    }
    return results;
  }

  /** Mark a turn failed, release the floor, and let the queue continue. */
  failTurn(roomId, threadId, agentId, reason = "turn failed") {
    const thread = this.getThread(roomId, threadId);
    if (!thread) throw new Error(`unknown thread ${threadId}`);
    thread.states.set(agentId, "error");
    thread.quiescent = false;
    if (thread.floor.holder === agentId) this.#release(thread);
    return {
      type: "turn_failed",
      thread: thread.key,
      agentId,
      reason,
      granted: this.grantNext(roomId, threadId),
    };
  }

  attentionFor(agentId, message) {
    if (message.mentions?.includes(agentId)) return "direct_mention";
    if (message.intent === "task" && message.taskOwner === agentId) return "task_owner";
    if (message.replyTo) {
      const replied = this.#findMessage(message.roomId, message.threadId, message.replyTo);
      if (replied?.sender === agentId) return "reply";
    }
    if (message.mentions?.length) return "room_mention";
    return "ambient";
  }

  #shouldWake(agent, message) {
    if (agent.id === message.sender) return false;
    const attention = this.attentionFor(agent.id, message);
    switch (agent.wakePolicy) {
      case "all": return true;
      // Product default: every human message is evaluated by every agent; an
      // agent's own messages only wake others when explicitly addressed. This
      // keeps "agents decide whether to reply" without agent-to-agent chatter.
      case "human_all":
        return message.senderKind === "human" || attention === "direct_mention" || attention === "reply" || attention === "task_owner";
      case "mention_only": return attention === "direct_mention";
      case "mention_or_reply": return attention === "direct_mention" || attention === "reply" || attention === "task_owner";
      case "digest": return false;
      default: return false;
    }
  }

  #isSubstantive(message) {
    if (message.intent === "pass") return false;
    const text = (message.text ?? "").trim().toLowerCase();
    if (!text && !["proposal", "decision", "task", "done", "object", "agree"].includes(message.intent)) return false;
    if (["ok", "okay", "thanks", "thank you", "收到", "好的", "谢谢"].includes(text)) return false;
    return true;
  }

  #trackTaskOrQuestion(message, thread) {
    if (message.intent === "task" && message.taskId) thread.openTasks.add(message.taskId);
    if (message.intent === "done" && message.taskId) thread.openTasks.delete(message.taskId);
    if (message.intent === "question") thread.openQuestions.add(message.id);
    if (message.intent === "answer" && message.replyTo) thread.openQuestions.delete(message.replyTo);
    if (message.intent === "decision" && message.proposalId) {
      const p = this.proposals.get(message.proposalId);
      if (p) p.status = "accepted";
    }
  }

  #maybeCreateProposal(message, thread) {
    if (message.intent !== "proposal" || !message.proposalId) return;
    if (this.proposals.has(message.proposalId)) return;
    this.proposals.set(message.proposalId, {
      id: message.proposalId,
      threadKey: thread.key,
      roomId: thread.roomId,
      threadId: thread.id,
      proposer: message.sender,
      createdAt: this.now,
      deadlineAt: this.now + this.lazyConsensusMs,
      votes: new Map(),
      status: "open",
    });
  }

  #syncHumanFloor(message, thread) {
    if (thread.floor.human && thread.floor.holder === message.sender) {
      thread.floor.holder = null;
      thread.floor.human = false;
      thread.floor.version += 1;
      thread.interruptedBy = null;
    }
  }

  #enqueueCandidates(message, thread, deliveredTo) {
    // A human message starts a fresh chain. Agent messages may wake others by
    // mention, but only until the chain cap is reached.
    if (message.senderKind === "agent" && thread.agentChainDepth >= this.maxAgentChain) return;
    for (const memberId of deliveredTo) {
      const agent = this.agents.get(memberId);
      if (agent?.kind !== "agent") continue;
      const attention = this.attentionFor(memberId, message);
      if (attention === "direct_mention" || attention === "reply" || attention === "task_owner") {
        this.#enqueue(thread, {
          agentId: memberId,
          priority: attention === "task_owner" ? 1 : 0,
          enqueuedAt: this.now,
          reason: attention === "task_owner" ? "task_owner" : attention === "reply" ? "reply" : "mention",
          messageId: message.id,
        });
      }
    }
  }

  #enqueue(thread, item) {
    const existing = thread.floor.queue.find((q) => q.agentId === item.agentId);
    if (existing) {
      if (item.priority < existing.priority) {
        existing.priority = item.priority;
        existing.reason = item.reason;
        existing.messageId = item.messageId;
      }
      return;
    }
    thread.floor.queue.push(item);
  }

  #release(thread) {
    thread.floor.holder = null;
    thread.floor.human = false;
    thread.floor.expiresAt = null;
    thread.floor.version += 1;
  }

  #appendAgentMessage(thread, agentId, payload) {
    const message = {
      id: payload.id ?? nextId("msg"),
      roomId: thread.roomId,
      threadId: thread.id,
      sender: agentId,
      senderKind: "agent",
      text: payload.text ?? "",
      intent: payload.intent ?? "chat",
      mentions: payload.mentions ?? [],
      replyTo: payload.replyTo,
      proposalId: payload.proposalId,
      taskId: payload.taskId,
      artifact: payload.artifact,
      createdAt: this.now,
    };
    thread.version += 1;
    thread.messages.push(message);
    thread.quiescent = false;
    thread.agentChainDepth += 1;
    for (const memberId of this.rooms.get(thread.roomId).members) {
      thread.seenVersion.set(memberId, thread.version);
    }
    if (this.#isSubstantive(message)) thread.lastSubstantiveAt = this.now;
    this.#trackTaskOrQuestion(message, thread);
    this.#maybeCreateProposal(message, thread);
    const deliveredTo = this.rooms.get(thread.roomId).members.filter((m) => m !== agentId);
    this.#enqueueCandidates(message, thread, deliveredTo);
    return message;
  }

  #findMessage(roomId, threadId, id) {
    return this.getThread(roomId, threadId)?.messages.find((m) => m.id === id);
  }

  #envelope(thread, agentId, trigger) {
    const agent = this.agents.get(agentId);
    const recent = thread.messages.slice(-12);
    return {
      agentId,
      message: trigger,
      attention: trigger ? this.attentionFor(agentId, trigger) : "ambient",
      directMention: Boolean(trigger?.mentions?.includes(agentId)),
      recentMessages: recent,
      floor: { holder: thread.floor.holder, version: thread.floor.version },
      policy: {
        speakMode: agent.speakMode,
        wakePolicy: agent.wakePolicy,
        canInvite: agent.canInvite,
        roles: agent.roles,
        domains: agent.domains,
      },
      budget: { tokensRemaining: Infinity, turnsRemaining: Infinity },
    };
  }

  #isQuiescent(thread, now) {
    if (thread.floor.holder) return false;
    if (thread.floor.queue.length > 0) return false;
    for (const state of thread.states.values()) {
      if (state === "thinking" || state === "working" || state === "waiting" || state === "error") return false;
    }
    if (thread.openTasks.size > 0 || thread.openQuestions.size > 0 || thread.pendingApprovals.size > 0) return false;
    for (const proposal of this.proposals.values()) {
      if (proposal.threadKey === thread.key && proposal.status === "open") return false;
    }
    if (now - thread.lastSubstantiveAt < this.quietWindowMs) return false;
    for (const memberId of this.rooms.get(thread.roomId).members) {
      const agent = this.agents.get(memberId);
      if (agent?.kind !== "agent") continue;
      if ((thread.seenVersion.get(memberId) ?? 0) < thread.version) return false;
    }
    return true;
  }

  vote(proposalId, agentId, vote) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return { accepted: false, reason: "unknown proposal" };
    if (!["agree", "object", "abstain"].includes(vote)) return { accepted: false, reason: "bad vote" };
    proposal.votes.set(agentId, vote);
    if (vote === "object") proposal.status = "escalated";
    return { accepted: true };
  }

  evaluateProposal(proposalId, now = this.now) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== "open") return null;
    if (now < proposal.deadlineAt) return null;
    const room = this.rooms.get(proposal.roomId);
    const active = room.members.filter((m) => this.agents.get(m)?.kind === "agent");
    const quorum = Math.max(1, Math.ceil(active.length / 2));
    const objects = [...proposal.votes.values()].filter((v) => v === "object").length;
    const agrees = [...proposal.votes.values()].filter((v) => v === "agree").length;
    if (objects > 0) {
      proposal.status = "escalated";
      return { type: "proposal_escalated", proposalId, escalation: this.resolveEscalation(this.threads.get(proposal.threadKey), proposal.proposer) };
    }
    const seenEnough = active.length >= quorum;
    if (seenEnough && agrees >= 0) {
      proposal.status = "accepted";
      return { type: "proposal_accepted", proposalId, rule: "lazy", agrees, quorum };
    }
    proposal.status = "escalated";
    return { type: "proposal_escalated", proposalId };
  }

  resolveEscalation(thread, proposerId) {
    if (!thread) return [];
    if (thread.taskOwner) return [thread.taskOwner];
    const room = this.rooms.get(thread.roomId);
    if (room?.facilitator) return [room.facilitator];
    const agent = this.agents.get(proposerId);
    if (agent?.owner) return [agent.owner];
    if (room?.admin) return [room.admin];
    return [];
  }

  whoCanHelp(topic) {
    return [...this.agents.values()]
      .filter((a) => a.kind === "agent" && (a.roles.includes(topic) || a.domains.includes(topic)))
      .map((a) => a.id);
  }

  canInvite(agentId, targetId, roomId) {
    const agent = this.agents.get(agentId);
    if (!agent || agent.kind !== "agent") return false;
    switch (agent.canInvite) {
      case "none": return false;
      case "allowlist": return agent.allowlist.includes(targetId);
      case "room": return Boolean(this.rooms.get(roomId)?.members.includes(targetId));
      case "approval": return "approval";
      default: return false;
    }
  }
}
