import { useEffect, useMemo, useRef, useState } from "react";
import Avatar from "./Avatar";
import Icon from "./Icon";
import { colorFor, dayLabel, preview, sameRun, shouldShowDay, timeShort } from "../format";

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderRich(text, pattern) {
  if (!pattern) return text;
  const out = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(
      <span className="mention" key={`${match.index}-${match[0]}`}>
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function mediaSrc(url) {
  return `/api/media?uri=${encodeURIComponent(url)}`;
}

function formatSize(n) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function toolFromRequest(text) {
  const match = /申请工具：([^\s（(]+)/.exec(text ?? "");
  return match?.[1] ?? "工具";
}

function renderContent(message, pattern) {
  if (message.msgtype === "m.image" && message.url) {
    const width = message.fileInfo?.w;
    const height = message.fileInfo?.h;
    return (
      <img
        className="media-img"
        src={mediaSrc(message.url)}
        alt={message.text || "图片"}
        width={width || undefined}
        height={height || undefined}
        loading="lazy"
      />
    );
  }
  if (message.msgtype === "m.file" && message.url) {
    return (
      <a
        className="file-card"
        href={mediaSrc(message.url)}
        download={message.text || "file"}
        target="_blank"
        rel="noreferrer"
      >
        <Icon name="paperclip" size={16} />
        <span className="file-name">{message.text || "文件"}</span>
        <span className="file-size">{formatSize(message.fileInfo?.size)}</span>
      </a>
    );
  }
  return renderRich(message.text, pattern);
}

export default function ChatView({
  room,
  messages,
  human,
  agentsById,
  activity,
  live,
  hasMore,
  loadingOlder,
  onLoadMore,
  sending,
  uploading,
  focusId,
  onSend,
  onUpload,
  onInvite,
  onApproveTool,
  onApproveRoom,
  onDelete,
  onProfile,
  onBack,
}) {
  const [value, setValue] = useState("");
  const [replyTarget, setReplyTarget] = useState(null);
  const [mention, setMention] = useState(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const nearBottom = useRef(true);

  const members = useMemo(() => room?.members ?? [], [room]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const floorMember = activity?.floor ? memberById.get(activity.floor) : null;
  const queuedMembers = (activity?.queued ?? []).map((id) => memberById.get(id)).filter(Boolean);
  const mentionPattern = useMemo(() => {
    const names = members
      .flatMap((m) => [m.name, m.displayName, m.role === "generic" ? null : m.role])
      .filter(Boolean)
      .map(escapeRegExp)
      .sort((a, b) => b.length - a.length);
    return names.length ? new RegExp(`@(?:${names.join("|")})`, "gu") : null;
  }, [members]);
  const agentMembers = useMemo(() => members.filter((m) => m.kind === "agent"), [members]);
  const liveAgents = Object.values(live ?? {}).filter(
    (item) => item.roomId === room?.id && (item.text || item.tools?.length),
  );

  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastId, room?.id]);

  useEffect(() => {
    if (!focusId) return;
    const el = logRef.current?.querySelector(`[data-id="${CSS.escape(focusId)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("focus");
    const timer = setTimeout(() => el.classList.remove("focus"), 2500);
    return () => clearTimeout(timer);
  }, [focusId, lastId]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 150) + "px";
  }, [value]);

  const candidates = useMemo(() => {
    if (!mention || dismissed) return [];
    const q = mention.query;
    return agentMembers
      .filter(
        (m) =>
          m.name.toLowerCase().startsWith(q) ||
          (m.displayName ?? "").toLowerCase().startsWith(q) ||
          (m.role ?? "").toLowerCase().startsWith(q),
      )
      .slice(0, 6);
  }, [mention, dismissed, agentMembers]);

  if (!room) return null;

  const peer = room.kind === "dm" ? room.members.find((m) => m.kind === "agent") : null;
  const peerAgent = peer ? agentsById.get(peer.id) : null;
  const subtitle =
    room.kind === "dm" && peer
      ? `@${peer.name} · ${peerAgent?.runtime === "script" ? "测试脚本" : "Claude"} · ${
          peerAgent?.status === "working" ? "思考中" : "在线"
        }`
      : `${room.members.length} 位成员 · ${agentMembers.map((m) => m.displayName).join("、")}`;
  const accent = peer ? colorFor(peer.name) : null;

  function confirmDelete() {
    const label = room.kind === "dm" ? peer?.displayName || room.name : room.name;
    if (window.confirm(`删除「${label}」？会离开这个房间并从列表移除。`)) onDelete();
  }

  function onInput(e) {
    const next = e.target.value;
    setValue(next);
    setDismissed(false);
    const caret = e.target.selectionStart ?? next.length;
    const before = next.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\p{L}\p{N}._=-]*)$/u);
    if (m) {
      setMention({ query: m[1].toLowerCase(), start: before.length - m[1].length - 1 });
      setMentionIndex(0);
    } else {
      setMention(null);
    }
  }

  function insertMention(member) {
    if (!mention) return;
    const el = inputRef.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, mention.start);
    const pad = before && !/\s$/.test(before) ? " " : "";
    const next = `${before}${pad}@${member.name} ${value.slice(caret)}`;
    setValue(next);
    setMention(null);
    setDismissed(true);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = (before + pad + `@${member.name} `).length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function submit() {
    const text = value.trim();
    if (!text || sending) return;
    const ok = await onSend(text, replyTarget?.id ?? null);
    if (ok) {
      setValue("");
      setMention(null);
      setReplyTarget(null);
      nearBottom.current = true;
    }
  }

  function onKeyDown(e) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape" && replyTarget) {
      e.preventDefault();
      setReplyTarget(null);
      return;
    }
    if (candidates.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % candidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(candidates[mentionIndex] ?? candidates[0]);
        return;
      }
    }
    if (e.key === "Escape") {
      setMention(null);
      setDismissed(true);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <section className="chat" style={accent ? { "--room-accent": accent } : undefined}>
      <header className="chat-head">
        <button type="button" className="icon-btn only-mobile" onClick={onBack} aria-label="返回会话列表">
          <Icon name="back" />
        </button>
        {room.kind === "dm" ? (
          <button
            type="button"
            className="avatar-btn"
            onClick={() => onProfile(peer ?? human)}
            aria-label={`查看 ${peer?.displayName ?? room.name} 的资料`}
          >
            <Avatar name={peer?.name ?? room.name} size={40} />
          </button>
        ) : (
          <Avatar name={room.name} group square size={40} />
        )}
        <div className="chat-title">
          <h2>{room.kind === "dm" ? peer?.displayName || room.name : room.name}</h2>
          <p>
            {room.kind === "dm" && (
              <span
                className={`status-dot ${
                  peerAgent?.status === "working"
                    ? "working"
                    : peerAgent?.status === "offline"
                      ? "offline"
                      : "idle"
                }`}
                aria-hidden="true"
              />
            )}
            {subtitle}
          </p>
        </div>
        <div className="chat-head-right">
          {room.kind === "group" && (
            <button type="button" className="head-action" onClick={onInvite} title="邀请成员">
              <Icon name="users" size={15} />
              <span className="head-action-label">邀请</span>
            </button>
          )}
          <span className="member-count">
            <Icon name="users" size={15} />
            {room.members.length}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={confirmDelete}
            title="删除会话"
            aria-label="删除会话"
          >
            <Icon name="trash" />
          </button>
        </div>
      </header>

      <div
        className="log"
        ref={logRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        aria-live="polite"
      >
        <div className="thread">
          {hasMore && (
            <div className="load-older">
              <button type="button" className="ghost" disabled={loadingOlder} onClick={onLoadMore}>
                {loadingOlder ? "加载中…" : "加载更早的消息"}
              </button>
            </div>
          )}
          {!messages.length && (
            <div className="chat-intro">
              <Avatar
                name={peer?.name ?? room.name}
                group={room.kind !== "dm"}
                square={room.kind !== "dm"}
                size={54}
              />
              <h3>
                {room.kind === "dm" ? `和 ${peer?.displayName ?? room.name} 的私聊` : `欢迎来到 ${room.name}`}
              </h3>
              <p>
                {room.kind === "dm"
                  ? "直接说话。agent 会读每条消息，自己判断要不要回复；不想回就 PASS。"
                  : `群里 ${agentMembers.length} 个 agent。每条人类消息都会被它们读到，由它们决定是否发言。`}
              </p>
            </div>
          )}

          {messages.map((message, i) => {
            const prev = messages[i - 1];
            const dayBreak = shouldShowDay(prev?.createdAt, message.createdAt);
            const cont = !dayBreak && sameRun(prev, message);
            const member = memberById.get(message.sender);
            const name = member?.displayName || message.displayName || message.senderName;
            const mine = message.sender === human.id;
            const color = mine ? "var(--own)" : colorFor(member?.name ?? message.senderName);
            const parent = message.replyTo ? messageById.get(message.replyTo) : null;

            return (
              <div key={message.id}>
                {dayBreak && <div className="day">{dayLabel(message.createdAt)}</div>}
                <div className={`msg-row${mine ? " mine" : ""}${cont ? " cont" : ""}`} data-id={message.id}>
                  <div className="avatar-slot">
                    {!cont && (
                      <button
                        type="button"
                        className="avatar-btn"
                        onClick={() => onProfile(message.sender)}
                        aria-label={`查看 ${name} 的资料`}
                      >
                        <Avatar name={name} size={34} />
                      </button>
                    )}
                  </div>
                  <div className="msg-body">
                    {!cont && (
                      <div className="msg-meta">
                        {!mine && (
                          <span className="msg-name" style={{ color }}>
                            {name}
                          </span>
                        )}
                        <span className="msg-time">{timeShort(message.createdAt)}</span>
                        <button
                          type="button"
                          className="reply-action"
                          onClick={() => setReplyTarget(message)}
                        >
                          回复
                        </button>
                      </div>
                    )}
                    {message.replyTo && (
                      <div className="reply-quote">
                        {parent
                          ? `${parent.displayName || parent.senderName}：${preview(
                              parent.msgtype === "m.image" ? "[图片]" : parent.text,
                            )}`
                          : "回复一条更早的消息"}
                      </div>
                    )}
                    <div
                      className={`bubble${mine ? " mine" : ""}${message.msgtype === "m.image" ? " media" : ""}`}
                    >
                      {renderContent(message, mentionPattern)}
                    </div>
                    {!mine && message.intent === "room_request" && message.room && (
                      <button type="button" className="approve-tool" onClick={() => onApproveRoom(message)}>
                        {message.room.kind === "dm"
                          ? "创建私聊（人类可见）"
                          : `创建群「${message.room.name}」`}
                      </button>
                    )}
                    {!mine &&
                      message.intent === "tool_request" &&
                      agentsById.get(message.sender)?.toolsMode !== "full" &&
                      !(agentsById.get(message.sender)?.approvedTools ?? []).includes(
                        message.tool ?? toolFromRequest(message.text),
                      ) && (
                        <button
                          type="button"
                          className="approve-tool"
                          onClick={() =>
                            onApproveTool(message.sender, message.tool ?? toolFromRequest(message.text))
                          }
                        >
                          批准 {message.tool ?? toolFromRequest(message.text)}（只开这个工具）
                        </button>
                      )}
                  </div>
                </div>
              </div>
            );
          })}

          {liveAgents.map((item) => {
            const member = memberById.get(item.agentId);
            const name = member?.displayName || String(item.agentId).replace(/^@/, "").split(":")[0];
            const lastTool = item.tools?.at(-1);
            const detail = lastTool?.input?.file_path || lastTool?.input?.command || "";
            return (
              <div className="msg-row live-row" key={item.agentId}>
                <div className="avatar-slot">
                  <Avatar name={member?.name ?? name} size={34} />
                </div>
                <div className="msg-body">
                  <div className="msg-meta">
                    <span className="msg-name" style={{ color: colorFor(member?.name ?? name) }}>
                      {name}
                    </span>
                    <span className="msg-time">{item.doneAt ? "刚输出" : "实时"}</span>
                  </div>
                  {item.text ? (
                    <div className="bubble live-bubble">
                      {item.text}
                      <span className="live-cursor" aria-hidden="true" />
                    </div>
                  ) : null}
                  {lastTool && (
                    <div className="live-tools">
                      正在使用 {lastTool.name}
                      {detail ? ` · ${String(detail).slice(0, 90)}` : ""}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <footer className="composer">
        {(floorMember || queuedMembers.length > 0) && (
          <div className="thinking" aria-live="polite">
            <span className="thinking-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {floorMember && <span>{floorMember.displayName || floorMember.name} 正在思考</span>}
            {floorMember && queuedMembers.length > 0 && <span className="thinking-sep">·</span>}
            {queuedMembers.length > 0 && (
              <span className="thinking-queued">
                {queuedMembers.map((m) => m.displayName || m.name).join("、")} 排队中
              </span>
            )}
          </div>
        )}

        {uploading && (
          <div className="thinking upload" aria-live="polite">
            <span className="thinking-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            正在上传文件…
          </div>
        )}

        {replyTarget && (
          <div className="reply-draft">
            <span>
              回复 {replyTarget.displayName || replyTarget.senderName}：
              {preview(replyTarget.msgtype === "m.image" ? "[图片]" : replyTarget.text)}
            </span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setReplyTarget(null)}
              aria-label="取消回复"
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        )}

        <div className="input-wrap">
          {candidates.length > 0 && (
            <div className="mention-menu" role="listbox" aria-label="提及 agent">
              {candidates.map((member, i) => (
                <button
                  type="button"
                  key={member.id}
                  role="option"
                  aria-selected={i === mentionIndex}
                  className={i === mentionIndex ? "active" : ""}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertMention(member)}
                >
                  <span className="mention-at">@</span>
                  <span className="mention-name">{member.name}</span>
                  <span className="mention-display">{member.displayName}</span>
                </button>
              ))}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) await onUpload(file);
            }}
          />
          <button
            type="button"
            className="attach"
            onClick={() => fileRef.current?.click()}
            disabled={sending || uploading}
            title="发送图片或文件"
            aria-label="发送图片或文件"
          >
            <Icon name="paperclip" size={18} />
          </button>
          <textarea
            ref={inputRef}
            name="message"
            autoComplete="off"
            value={value}
            rows={1}
            placeholder={`发消息${room.kind === "dm" ? "" : "，用 @ 提及 agent"}`}
            aria-label="消息"
            onChange={onInput}
            onKeyDown={onKeyDown}
            onBlur={() => setTimeout(() => setMention(null), 120)}
          />
          <button
            type="button"
            className="send"
            disabled={!value.trim() || sending}
            onClick={submit}
            aria-label="发送"
            title="发送"
          >
            <Icon name="send" size={19} />
          </button>
        </div>
        <p className="hint">Enter 发送 · Shift+Enter 换行 · @ 提及 agent · 图片/文件 ≤8MB</p>
      </footer>
    </section>
  );
}
