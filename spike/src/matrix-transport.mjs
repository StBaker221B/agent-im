// Minimal Matrix client-server API transport for one participant.
// One instance per Matrix account (agent). Syncs joined rooms, normalizes
// m.room.message events, and sends threaded/mention-bearing messages.
// No external deps; uses global fetch (Node >= 22).

const API = "/_matrix/client/v3";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class MatrixError extends Error {
  constructor(status, body, method, path) {
    super(`matrix ${method} ${path}: ${status} ${body?.errcode ?? ""} ${body?.error ?? ""}`.trim());
    this.name = "MatrixError";
    this.status = status;
    this.errcode = body?.errcode;
    this.body = body;
  }
}

export class MatrixClient {
  constructor({
    homeserver,
    userId,
    accessToken,
    kinds = new Map(),
    fetchImpl = globalThis.fetch,
    requestTimeoutMs = 30_000,
    log = () => {},
  }) {
    if (!homeserver) throw new Error("matrix: homeserver required");
    if (!userId) throw new Error("matrix: userId required");
    if (!accessToken) throw new Error("matrix: accessToken required");
    this.homeserver = homeserver.replace(/\/+$/, "");
    this.userId = userId;
    this.accessToken = accessToken;
    this.kinds = kinds;
    this.fetch = fetchImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.log = log;
    this.txnSeq = 0;
  }

  async #request(method, path, { query, body, timeoutMs, retries = 2 } = {}) {
    const url = new URL(this.homeserver + (path.startsWith("/_matrix") ? path : API + path));
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.requestTimeoutMs);
      try {
        const res = await this.fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        const text = await res.text();
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        if (res.ok) return json ?? {};
        if (res.status === 429 && attempt < retries) {
          await sleep(json?.retry_after_ms ?? 1000);
          lastError = new MatrixError(res.status, json, method, path);
          continue;
        }
        if (res.status >= 500 && attempt < retries) {
          await sleep(500 * (attempt + 1));
          lastError = new MatrixError(res.status, json, method, path);
          continue;
        }
        throw new MatrixError(res.status, json, method, path);
      } catch (err) {
        if (err instanceof MatrixError) throw err;
        lastError = err;
        if (attempt < retries) {
          await sleep(500 * (attempt + 1));
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  async whoami() {
    return this.#request("GET", "/account/whoami");
  }

  async resolveAlias(alias) {
    const res = await this.#request("GET", `/directory/room/${encodeURIComponent(alias)}`);
    return res.room_id;
  }

  async joinRoom(roomIdOrAlias) {
    const res = await this.#request("POST", `/join/${encodeURIComponent(roomIdOrAlias)}`, { body: {} });
    return res.room_id;
  }

  async members(roomId) {
    const res = await this.#request("GET", `/rooms/${encodeURIComponent(roomId)}/joined_members`);
    return Object.keys(res.joined ?? {});
  }

  async sync(since, { timeoutMs = 30_000 } = {}) {
    const query = {
      timeout: timeoutMs,
      filter: JSON.stringify({ room: { timeline: { limit: 50 } } }),
    };
    if (since) query.since = since;
    const res = await this.#request("GET", "/sync", { query, timeoutMs: timeoutMs + 10_000 });
    const events = [];
    const rooms = [];
    for (const [roomId, data] of Object.entries(res.rooms?.join ?? {})) {
      rooms.push(roomId);
      for (const ev of data.timeline?.events ?? []) {
        const norm = this.#normalize(roomId, ev);
        if (norm) events.push(norm);
      }
    }
    return { events, nextToken: res.next_batch, rooms };
  }

  async getMessages(roomId, { limit = 50, from } = {}) {
    const query = { dir: "b", limit };
    if (from) query.from = from;
    const res = await this.#request("GET", `/rooms/${encodeURIComponent(roomId)}/messages`, { query });
    const out = [];
    for (const ev of [...(res.chunk ?? [])].reverse()) {
      const norm = this.#normalize(roomId, ev);
      if (norm) out.push(norm);
    }
    return out;
  }

  async getEvent(roomId, eventId) {
    const ev = await this.#request(
      "GET",
      `/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`,
    );
    return this.#normalize(roomId, ev);
  }

  async send(roomId, payload = {}) {
    const txnId = payload.txnId ?? this.#nextTxnId();
    const content = {
      msgtype: payload.msgtype ?? "m.text",
      body: payload.text ?? payload.filename ?? "",
    };
    if (payload.url) content.url = payload.url;
    if (payload.info) content.info = payload.info;
    if (payload.mentions?.length) content["m.mentions"] = { user_ids: payload.mentions };
    if (payload.intent && payload.intent !== "chat") content["com.agentim.intent"] = payload.intent;
    if (payload.proposalId) content["com.agentim.proposal_id"] = payload.proposalId;
    if (payload.taskId) content["com.agentim.task_id"] = payload.taskId;
    if (payload.taskOwner) content["com.agentim.task_owner"] = payload.taskOwner;
    if (payload.artifact) content["com.agentim.artifact"] = payload.artifact;
    if (payload.threadId && payload.threadId !== "main") {
      content["m.relates_to"] = { rel_type: "m.thread", event_id: payload.threadId };
      if (payload.replyTo) content["m.relates_to"]["m.in_reply_to"] = { event_id: payload.replyTo };
    } else if (payload.replyTo) {
      content["m.relates_to"] = { "m.in_reply_to": { event_id: payload.replyTo } };
    }
    const res = await this.#request(
      "PUT",
      `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`,
      { body: content },
    );
    return { eventId: res.event_id, txnId };
  }

  async setTyping(roomId, typing) {
    await this.#request(
      "PUT",
      `/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(this.userId)}`,
      { body: { typing: Boolean(typing), timeout: 30_000 } },
    ).catch((err) => this.log(`typing failed: ${err.message}`));
  }

  /** Upload raw bytes to the media repo; returns an mxc:// URI. */
  async uploadMedia(bytes, { contentType = "application/octet-stream", filename = "file" } = {}) {
    const url = new URL(`${this.homeserver}/_matrix/media/v3/upload`);
    url.searchParams.set("filename", filename);
    const res = await this.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": contentType,
      },
      body: bytes,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new MatrixError(res.status, json, "POST", "/media/v3/upload");
    if (!json?.content_uri) throw new Error("media upload returned no content_uri");
    return json.content_uri;
  }

  /** Authenticated media download (Tuwunel requires the v1 endpoint). */
  async downloadMedia(serverName, mediaId) {
    const url = `${this.homeserver}/_matrix/client/v1/media/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`;
    const res = await this.fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      throw new MatrixError(res.status, json, "GET", "/media/download");
    }
    return {
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      body: Buffer.from(await res.arrayBuffer()),
    };
  }

  #nextTxnId() {
    this.txnSeq += 1;
    return `agentim-${this.userId.replace(/[^a-zA-Z0-9._=-]/g, "_")}-${Date.now()}-${this.txnSeq}`;
  }

  #normalize(roomId, ev) {
    if (!ev || ev.type !== "m.room.message") return null;
    const content = ev.content ?? {};
    const allowed = new Set(["m.text", "m.notice", "m.image", "m.file"]);
    if (!allowed.has(content.msgtype)) return null;
    const rel = content["m.relates_to"];
    let threadId = "main";
    let replyTo;
    if (rel?.rel_type === "m.thread") {
      threadId = rel.event_id;
      replyTo = rel["m.in_reply_to"]?.event_id;
    } else if (rel?.rel_type === "m.in_reply_to") {
      replyTo = rel.event_id;
    }
    return {
      id: ev.event_id,
      roomId,
      threadId,
      sender: ev.sender,
      senderKind: this.kinds.get(ev.sender) ?? "human",
      msgtype: content.msgtype,
      text: content.body ?? "",
      url: content.url ?? null,
      fileInfo: content.info ?? null,
      intent: content["com.agentim.intent"] ?? "chat",
      mentions: content["m.mentions"]?.user_ids ?? [],
      replyTo,
      proposalId: content["com.agentim.proposal_id"],
      taskId: content["com.agentim.task_id"],
      taskOwner: content["com.agentim.task_owner"],
      artifact: content["com.agentim.artifact"],
      createdAt: ev.origin_server_ts ?? Date.now(),
      raw: ev,
    };
  }
}
