import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import Icon from "./Icon";

function timeOf(ts) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function ThreadPanel({ room, root, human, onClose, onSend }) {
  const [messages, setMessages] = useState([]);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    if (!room?.id || !root?.id) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await api.thread(room.id, root.id);
        if (alive) {
          setMessages(res.messages ?? []);
          setError("");
        }
      } catch (err) {
        if (alive) setError(err.message);
      }
    };
    load();
    const timer = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [room?.id, root?.id]);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  async function submit(event) {
    event.preventDefault();
    const text = value.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const ok = await onSend(text);
      if (ok) {
        setValue("");
        const res = await api.thread(room.id, root.id);
        setMessages(res.messages ?? []);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <aside className="thread-panel" aria-label="Thread">
      <div className="thread-head">
        <div>
          <strong>Thread</strong>
          <span className="thread-root-label">{root.displayName || root.senderName}</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭 thread">
          <Icon name="close" />
        </button>
      </div>

      <div className="thread-list" ref={listRef}>
        <div className="thread-message thread-root-message">
          <div className="thread-message-top">
            <strong>{root.displayName || root.senderName}</strong>
            <time>{timeOf(root.createdAt)}</time>
          </div>
          <p>{root.text}</p>
        </div>
        {messages.map((message) => (
          <div className={`thread-message${message.sender === human.id ? " mine" : ""}`} key={message.id}>
            <div className="thread-message-top">
              <strong>{message.displayName || message.senderName}</strong>
              <time>{timeOf(message.createdAt)}</time>
            </div>
            <p>{message.text}</p>
          </div>
        ))}
        {!messages.length && <p className="muted thread-empty">还没有回复，开始讨论。</p>}
        {error && <p className="form-error">{error}</p>}
      </div>

      <form className="thread-composer" onSubmit={submit}>
        <input
          name="thread-message"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="回复这个 thread…"
          aria-label="回复 thread"
        />
        <button type="submit" className="primary" disabled={!value.trim() || sending}>
          发送
        </button>
      </form>
    </aside>
  );
}
