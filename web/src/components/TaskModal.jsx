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
  const [intervalMinutes, setIntervalMinutes] = useState(0);
  const [cron, setCron] = useState("");
  const [maxRetries, setMaxRetries] = useState(2);
  const [retryBackoffMinutes, setRetryBackoffMinutes] = useState(5);
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
                intervalMinutes: Math.max(0, Number(intervalMinutes) || 0),
                cron: cron.trim() || null,
                maxRetries: Math.max(0, Number(maxRetries) || 0),
                retryBackoffMinutes: Math.max(1, Number(retryBackoffMinutes) || 1),
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
            <div className="field-row">
              <label className="field">
                <span>首次到期（到期后自动派发）</span>
                <input
                  type="datetime-local"
                  name="dueAt"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                />
              </label>
              <label className="field">
                <span>重复间隔（分钟，0 = 一次性）</span>
                <input
                  type="number"
                  name="intervalMinutes"
                  min="0"
                  step="1"
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(e.target.value)}
                />
              </label>
            </div>
            <label className="field">
              <span>Cron（5 段，本地时区；留空用间隔）</span>
              <input
                name="cron"
                autoComplete="off"
                spellCheck={false}
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="0 9 * * 1-5 = 工作日 09:00"
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>失败重试次数</span>
                <input
                  type="number"
                  name="maxRetries"
                  min="0"
                  step="1"
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(e.target.value)}
                />
              </label>
              <label className="field">
                <span>重试退避基数（分钟）</span>
                <input
                  type="number"
                  name="retryBackoffMinutes"
                  min="1"
                  step="1"
                  value={retryBackoffMinutes}
                  onChange={(e) => setRetryBackoffMinutes(e.target.value)}
                />
              </label>
            </div>
            <p className="form-note">
              任务会持久化到 app/data/tasks.json。一次性任务派发后变“进行中”；重复任务派发后按间隔排下一次，
              重启不会重复派发。失败按 5/10/20… 分钟退避重试，耗尽后置 failed 并标记需关注；当前不做 turn
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
