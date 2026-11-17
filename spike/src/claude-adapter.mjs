// Claude Code stream-json adapter for the Agent IM spike.
// One long-lived CLI process per session (room/thread); kill+resume on interrupt.
// No external deps. Windows: spawned through cmd.exe /c because claude is a .cmd shim.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFileSync, readFileSync, mkdirSync, renameSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { buildAgentPrompt, parseReply } from "./reply.mjs";

export { buildAgentPrompt, parseReply };

const DEFAULT_SYSTEM_PROMPT = `You are an IM participant agent. You see room messages and reply as yourself.
Be concise. Follow the response markers in the user message.
Do not use tools unless the user explicitly asks for work that needs them.`;

function quoteArg(arg) {
  const s = String(arg);
  if (!/[\s"]/u.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function createQueue() {
  const items = [];
  const waiters = [];
  let ended = false;
  let error = null;
  return {
    push(value) {
      if (ended) return;
      if (waiters.length) waiters.shift()({ value, done: false });
      else items.push(value);
    },
    end() {
      if (ended) return;
      ended = true;
      while (waiters.length) waiters.shift()({ value: undefined, done: true });
    },
    fail(err) {
      error = err;
      this.end();
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (items.length) {
          yield items.shift();
          continue;
        }
        if (ended) {
          if (error) throw error;
          return;
        }
        const next = await new Promise((resolve) => waiters.push(resolve));
        if (next.done) {
          if (error) throw error;
          return;
        }
        yield next.value;
      }
    },
  };
}


export class ClaudeAdapter {
  constructor(opts = {}) {
    this.command = opts.command ?? "claude";
    this.cwd = opts.cwd ?? process.cwd();
    this.model = opts.model;
    this.systemPrompt = opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.turnTimeoutMs = opts.turnTimeoutMs ?? 180_000;
    this.extraArgs = opts.extraArgs ?? [];
    this.env = { ...process.env, ...(opts.env ?? {}) };
    this.sessions = new Map();
    this.closed = false;
    this.agentId = opts.agentId ?? "claude-dev";
    // "room" (default) keeps one session per room/thread; "agent" keeps one
    // session for the whole agent so the same person remembers every room.
    this.sessionScope = opts.sessionScope ?? "room";
    this.sessionStorePath = opts.sessionStorePath ?? null;
    this.nativeIds = this.#loadSessionStore();

    const dir = mkdtempSync(join(tmpdir(), "agent-im-claude-"));
    this.systemPromptPath = join(dir, "system-prompt.txt");
    writeFileSync(this.systemPromptPath, this.systemPrompt, "utf8");
  }

  /** Persisted thread -> native session id, so a gateway restart can --resume. */
  #loadSessionStore() {
    if (!this.sessionStorePath) return new Map();
    try {
      const raw = JSON.parse(readFileSync(this.sessionStorePath, "utf8"));
      return new Map(Object.entries(raw?.sessions ?? {}));
    } catch (err) {
      if (err?.code !== "ENOENT") {
        // A corrupt/mid-write store should not prevent startup; the next turn
        // starts a fresh native session instead of resuming.
        console.error(`[claude-adapter] ignoring unreadable session store: ${err.message}`);
      }
      return new Map();
    }
  }

  #saveSessionStore() {
    if (!this.sessionStorePath) return;
    const dir = dirname(this.sessionStorePath);
    mkdirSync(dir, { recursive: true });
    const tmp = `${this.sessionStorePath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ sessions: Object.fromEntries(this.nativeIds) }, null, 2), "utf8");
    renameSync(tmp, this.sessionStorePath);
  }

  #rememberSession(key, sessionId) {
    if (!sessionId) return;
    if (this.nativeIds.get(key) === sessionId) return;
    this.nativeIds.set(key, sessionId);
    this.#saveSessionStore();
  }

  capabilities() {
    return {
      streaming: true, // partial text_delta events via --include-partial-messages
      interrupt: true, // kill + resume
      resume: true,
      approval: true, // cooperative REQUEST_TOOL / human approval flow
      tools: true,
      multi_session: true, // one CLI process per room/thread
    };
  }

  async health() {
    return [...this.sessions.values()].map((s) => ({
      key: s.key,
      pid: s.child?.pid,
      alive: Boolean(s.child && !s.exited),
      sessionId: s.sessionId,
      stderr: s.stderr.slice(-500),
    }));
  }

  keyFor(ctx) {
    if (this.sessionScope === "agent") return `agent:${this.agentId}`;
    return `${ctx.roomId}/${ctx.threadId}`;
  }

  async ensureSession(ctx) {
    return this.#ensure(ctx);
  }

  #ensure(ctx) {
    if (this.closed) throw new Error("adapter closed");
    const key = this.keyFor(ctx);
    const existing = this.sessions.get(key);
    if (existing?.child && !existing.exited) return existing;
    return this.#spawn(ctx, existing?.sessionId ?? this.nativeIds.get(key));
  }

  #spawn(ctx, resumeId) {
    const key = this.keyFor(ctx);
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--bare",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--system-prompt-file", this.systemPromptPath,
    ];
    if (this.model) args.push("--model", this.model);
    if (resumeId) args.push("--resume", resumeId);
    args.push(...this.extraArgs);

    const useShell = process.platform === "win32";
    const child = useShell
      ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", [this.command, ...args].map(quoteArg).join(" ")], {
          cwd: this.cwd,
          env: this.env,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        })
      : spawn(this.command, args, {
          cwd: this.cwd,
          env: this.env,
          stdio: ["pipe", "pipe", "pipe"],
        });

    const session = {
      key,
      child,
      sessionId: resumeId ?? null,
      exited: false,
      pending: null,
      stderr: "",
      rl: null,
    };

    session.rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    session.rl.on("line", (line) => this.#onLine(session, line));
    child.stderr.on("data", (d) => {
      session.stderr += d.toString();
      if (session.stderr.length > 20_000) session.stderr = session.stderr.slice(-20_000);
    });
    child.on("error", (err) => {
      session.exited = true;
      if (session.pending) {
        session.pending.queue.fail(new Error(`claude spawn error: ${err.message}`));
        session.pending = null;
      }
    });
    child.on("exit", (code, signal) => {
      session.exited = true;
      if (session.pending) {
        session.pending.queue.fail(new Error(`claude exited code=${code} signal=${signal}\n${session.stderr.slice(-3000)}`));
        session.pending = null;
      }
    });

    this.sessions.set(key, session);
    return session;
  }

  async *send(sessionRef, envelope) {
    const ctx = { roomId: envelope.message.roomId, threadId: envelope.message.threadId };
    let session = sessionRef?.child && !sessionRef.exited ? sessionRef : this.#ensure(ctx);
    if (session.pending) throw new Error("a turn is already in progress for this session");

    const queue = createQueue();
    const turn = {
      queue,
      sessionId: session.sessionId,
      text: [],
      tools: [],
      usage: null,
      cost: null,
      seenText: new Set(),
    };
    session.pending = turn;

    const timer = setTimeout(() => {
      if (session.pending === turn) {
        queue.fail(new Error(`claude turn timeout after ${this.turnTimeoutMs}ms`));
        session.pending = null;
        this.#kill(session);
      }
    }, this.turnTimeoutMs);

    const prompt = buildAgentPrompt(envelope);
    session.child.stdin.write(JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: prompt }] },
    }) + "\n");

    try {
      for await (const ev of queue) yield ev;
    } finally {
      clearTimeout(timer);
      if (session.pending === turn) session.pending = null;
    }
  }

  #onLine(session, line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let ev;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      // CLI may print non-JSON warnings to stdout; keep them for debugging.
      return;
    }

    if (ev.type === "system" && ev.subtype === "init") {
      session.sessionId = ev.session_id ?? session.sessionId;
      this.#rememberSession(session.key, session.sessionId);
      return;
    }
    if (ev.type === "system" && String(ev.subtype ?? "").startsWith("hook")) return;
    if (ev.type === "system" && String(ev.subtype ?? "").startsWith("rate_limit")) return;

    const turn = session.pending;
    if (!turn) return;

    if (ev.type === "stream_event") {
      const inner = ev.event;
      if (inner?.type === "content_block_delta" && inner.delta?.type === "text_delta" && inner.delta.text) {
        turn.queue.push({ type: "text_delta", text: inner.delta.text });
      }
      return;
    }

    if (ev.type === "assistant") {
      const blocks = ev.message?.content ?? [];
      for (const block of blocks) {
        if (block.type === "text" && block.text) {
          const key = `${ev.message?.id}:${block.text}`;
          if (!turn.seenText.has(key)) {
            turn.seenText.add(key);
            turn.text.push(block.text);
            turn.queue.push({ type: "message", text: block.text });
          }
        } else if (block.type === "tool_use") {
          const tool = { type: "tool_use", name: block.name, input: block.input, id: block.id };
          turn.tools.push(tool);
          turn.queue.push(tool);
        }
      }
      return;
    }

    if (ev.type === "user") {
      const blocks = ev.message?.content ?? [];
      for (const block of blocks) {
        if (block.type === "tool_result") {
          turn.queue.push({ type: "tool_result", toolUseId: block.tool_use_id, isError: block.is_error ?? false });
        }
      }
      return;
    }

    if (ev.type === "result") {
      turn.sessionId = ev.session_id ?? turn.sessionId;
      session.sessionId = turn.sessionId ?? session.sessionId;
      this.#rememberSession(session.key, session.sessionId);
      turn.usage = ev.usage ?? null;
      turn.cost = ev.total_cost_usd ?? null;
      turn.queue.push({
        type: "usage",
        usage: turn.usage,
        costUsd: turn.cost,
        sessionId: turn.sessionId,
        isError: Boolean(ev.is_error),
        durationMs: ev.duration_ms,
      });
      turn.queue.push({ type: "turn_end", sessionId: turn.sessionId, text: turn.text.join("").trim(), isError: Boolean(ev.is_error) });
      turn.queue.end();
      session.pending = null;
      return;
    }

    if (ev.type === "error") {
      turn.queue.fail(new Error(`claude error: ${JSON.stringify(ev).slice(0, 2000)}`));
      session.pending = null;
    }
  }

  async interrupt(sessionRef) {
    const session = sessionRef?.child ? sessionRef : this.sessions.get(sessionRef?.key ?? "");
    if (!session) return;
    if (session.pending) {
      const turn = session.pending;
      session.pending = null;
      turn.queue.fail(new Error("interrupted"));
    }
    this.#kill(session);
  }

  async resume(sessionRef) {
    const session = sessionRef?.child ? sessionRef : this.sessions.get(sessionRef?.key ?? "");
    if (!session) throw new Error("unknown session");
    const ctx = { roomId: session.key.split("/")[0], threadId: session.key.split("/").slice(1).join("/") };
    this.#kill(session);
    return this.#spawn(ctx, session.sessionId);
  }

  #kill(session) {
    try {
      session.rl?.close();
    } catch {}
    try {
      if (process.platform === "win32" && session.child?.pid) {
        spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `taskkill /PID ${session.child.pid} /T /F`], { windowsHide: true });
      } else {
        session.child?.kill("SIGKILL");
      }
    } catch {}
    session.exited = true;
  }

  async close() {
    this.closed = true;
    for (const session of this.sessions.values()) this.#kill(session);
  }
}
