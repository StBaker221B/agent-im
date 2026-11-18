import { useEffect, useState } from "react";
import { api } from "../api";
import Icon from "./Icon";
import { useDialogFocus } from "../useDialogFocus";

const STATUS = {
  pending: "待处理",
  active: "进行中",
  blocked: "阻塞",
  failed: "失败",
  done: "完成",
  cancelled: "已取消",
};

function timeOf(ts) {
  if (!ts) return "—";
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? ts : date.toLocaleString("zh-CN", { hour12: false });
}

export default function TaskDetailModal({ task: initial, onClose, onOpenRoom }) {
  const dialogRef = useDialogFocus(onClose);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .taskEvents(initial.id)
      .then((res) => {
        if (alive) setData(res);
      })
      .catch((err) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, [initial.id]);

  const task = data?.task ?? initial;
  const events = data?.events ?? [];
  const checkpoints = task.checkpoints ?? [];

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal task-detail-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`任务详情：${task.title}`}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2>{task.title}</h2>
            <p className="muted">
              {STATUS[task.status] ?? task.status}
              {task.ownerName ? ` · ${task.ownerName}` : ""}
              {task.roomName ? ` · ${task.roomName}` : ""}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" />
          </button>
        </header>

        {error && <p className="form-error">{error}</p>}

        <div className="task-detail-grid">
          <section>
            <h3>检查点</h3>
            {checkpoints.map((checkpoint, index) => (
              <div className="task-timeline-item" key={`${checkpoint.ts}-${index}`}>
                <time>{timeOf(checkpoint.ts)}</time>
                <p>{checkpoint.text}</p>
                <span className="muted">{checkpoint.by}</span>
              </div>
            ))}
            {!checkpoints.length && <p className="muted">还没有检查点。</p>}
          </section>

          <section>
            <h3>审计事件</h3>
            {events.map((event, index) => (
              <div className="task-timeline-item" key={`${event.ts}-${index}`}>
                <time>{timeOf(event.ts)}</time>
                <p>
                  <strong>{event.kind}</strong>
                  {event.status ? ` · ${event.status}` : ""}
                  {event.agentId ? ` · ${event.agentId}` : ""}
                </p>
                {event.text && <span className="muted">{String(event.text).slice(0, 200)}</span>}
                {event.error && <span className="form-error">{event.error}</span>}
              </div>
            ))}
            {!events.length && <p className="muted">没有 taskId 关联的审计事件。</p>}
          </section>
        </div>

        <div className="modal-actions">
          {task.roomId && onOpenRoom && (
            <button type="button" className="ghost" onClick={() => onOpenRoom(task.roomId)}>
              打开房间
            </button>
          )}
          <button type="button" className="primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
