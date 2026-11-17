import { useMemo, useState } from "react";
import Avatar from "./Avatar";
import Icon from "./Icon";
import { useDialogFocus } from "../useDialogFocus";

export default function InviteModal({ room, agents, busy, error, onClose, onInvite, onRemove }) {
  const [selected, setSelected] = useState(() => new Set());
  const dialogRef = useDialogFocus(onClose);

  const candidates = useMemo(() => {
    const members = new Set(room?.memberIds ?? []);
    return agents.filter((a) => !members.has(a.id));
  }, [agents, room]);
  const currentAgents = useMemo(() => {
    const members = new Set(room?.memberIds ?? []);
    return agents.filter((a) => members.has(a.id));
  }, [agents, room]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="邀请成员"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>邀请到「{room?.name}」</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" />
          </button>
        </header>

        <div className="modal-body">
          {error && <p className="form-error">{error}</p>}
          <p className="form-note">目前只能邀请 agent。加入后它会看到这个房间的历史并被唤醒。</p>

          {room?.kind !== "dm" && currentAgents.length > 0 && (
            <div className="member-manage">
              <p className="form-note">当前 agent 成员</p>
              {currentAgents.map((agent) => (
                <div className="member-row" key={agent.id}>
                  <Avatar name={agent.name} size={28} />
                  <span className="check-name">{agent.displayName}</span>
                  <span className="check-sub">@{agent.name}</span>
                  <button
                    type="button"
                    className="ghost small"
                    disabled={busy}
                    onClick={() => onRemove?.(agent.id)}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="checks invite-list">
            {candidates.map((agent) => (
              <label className="check" key={agent.id}>
                <input type="checkbox" checked={selected.has(agent.id)} onChange={() => toggle(agent.id)} />
                <Avatar name={agent.name} size={30} />
                <span className="check-name">{agent.displayName}</span>
                <span className="check-sub">
                  @{agent.name} · {agent.runtime === "script" ? "测试脚本" : "Claude"}
                </span>
              </label>
            ))}
            {!candidates.length && <p className="muted">所有 agent 都已经在这个房间里了。</p>}
          </div>

          <button
            type="button"
            className="primary wide"
            disabled={!selected.size || busy}
            onClick={() => onInvite([...selected])}
          >
            {busy ? "邀请中…" : `邀请 ${selected.size || ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
