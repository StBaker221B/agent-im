import { useState } from "react";
import Icon from "./Icon";
import { useDialogFocus } from "../useDialogFocus";

function defaultDueInput() {
  const date = new Date(Date.now() + 5 * 60_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function TaskModal({ agents, rooms, busy, error, onClose, onCreate }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState("");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [dueAt, setDueAt] = useState(defaultDueInput());
  const dialogRef = useDialogFocus(onClose);
  const canSubmit = title.trim() && roomId && !busy;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="新建任务"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>新建任务</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">
          {error && <p className="form-error">{error}</p>}
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canSubmit) return;
              onCreate({
                title: title.trim(),
                description: description.trim(),
                owner: owner || null,
                roomId,
                dueAt: dueAt ? new Date(dueAt).toISOString() : null,
              });
            }}
          >
            <label className="field">
              <span>任务标题</span>
              <input
                name="title"
                autoComplete="off"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：每周一整理上周账单"
                required
              />
            </label>
            <label className="field">
              <span>描述 / 验收</span>
              <textarea
                name="description"
                autoComplete="off"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="要做什么、产出什么、怎么算完成"
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>负责 agent</span>
                <select name="owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
                  <option value="">不指定</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>派发到房间</span>
                <select name="roomId" value={roomId} onChange={(e) => setRoomId(e.target.value)} required>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>到期时间（到期后自动派发）</span>
              <input
                type="datetime-local"
                name="dueAt"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </label>
            <p className="form-note">
              任务会持久化到 app/data/tasks.json；到期派发一次后变“进行中”，重启不会重复派发。当前不做 turn
              级恢复。
            </p>
            <button type="submit" className="primary wide" disabled={!canSubmit}>
              {busy ? "创建中…" : "创建任务"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
