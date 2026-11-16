import { useState } from "react";
import Avatar from "./Avatar";
import Icon from "./Icon";
import { useDialogFocus } from "../useDialogFocus";

const TABS = [
  { id: "dm", label: "私聊" },
  { id: "group", label: "群聊" },
];

export default function NewChatModal({
  agents,
  busy,
  error,
  onClose,
  onCreateDm,
  onCreateGroup,
  onNewAgent,
}) {
  const [tab, setTab] = useState("dm");
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const dialogRef = useDialogFocus(onClose);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canGroup = groupName.trim() && selected.size > 0 && !busy;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="新建会话"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>新建会话</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" />
          </button>
        </header>

        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              type="button"
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="modal-body">
          {error && <p className="form-error">{error}</p>}

          {tab === "dm" && (
            <div className="dm-picker">
              {agents.map((agent) => (
                <button
                  type="button"
                  key={agent.id}
                  className="dm-option"
                  disabled={busy}
                  onClick={() => onCreateDm(agent.id)}
                >
                  <Avatar name={agent.name} size={40} />
                  <span className="dm-name">
                    <strong>{agent.displayName}</strong>
                    <span>
                      @{agent.name} · {agent.runtime === "script" ? "测试脚本" : "Claude"}
                    </span>
                  </span>
                  <span
                    className={`status-dot ${agent.status === "working" ? "working" : "idle"}`}
                    aria-hidden="true"
                  />
                </button>
              ))}
              {!agents.length && (
                <div className="picker-empty">
                  <p>还没有 agent。</p>
                  <button type="button" className="ghost" onClick={onNewAgent}>
                    去创建一个
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === "group" && (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                if (canGroup) onCreateGroup(groupName.trim(), [...selected]);
              }}
            >
              <label className="field">
                <span>群聊名字</span>
                <input
                  name="groupName"
                  autoComplete="off"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="例如：登录方案评审"
                  autoFocus
                />
              </label>

              <div className="field">
                <span>选择 agent（{selected.size}）</span>
                <div className="checks">
                  {agents.map((agent) => (
                    <label className="check" key={agent.id}>
                      <input
                        type="checkbox"
                        checked={selected.has(agent.id)}
                        onChange={() => toggle(agent.id)}
                      />
                      <Avatar name={agent.name} size={28} />
                      <span className="check-name">{agent.displayName}</span>
                      <span className="check-sub">@{agent.name}</span>
                    </label>
                  ))}
                  {!agents.length && <p className="muted">还没有 agent，先去 Agents 页创建。</p>}
                </div>
              </div>

              <button type="submit" className="primary wide" disabled={!canGroup}>
                {busy ? "创建中…" : "创建群聊"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
