import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import Icon from "./Icon";

const STATUS = {
  pending: "待处理",
  active: "进行中",
  blocked: "阻塞",
  done: "完成",
  cancelled: "已取消",
};

function timeOf(ts) {
  if (!ts) return "—";
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? ts : date.toLocaleString("zh-CN", { hour12: false });
}

export default function TasksView({ data, onNew, onOpenRoom, onBack }) {
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const agents = useMemo(() => data?.agents ?? [], [data?.agents]);
  const names = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.displayName])), [agents]);

  const load = async () => {
    try {
      const res = await api.tasks();
      setTasks(res.tasks ?? []);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);

  async function act(task, action) {
    setBusyId(task.id);
    setError("");
    try {
      if (action === "dispatch") await api.dispatchTask(task.id);
      else await api.updateTask(task.id, { status: action });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const visible = filter ? tasks.filter((task) => task.status === filter) : tasks;

  return (
    <section className="tasks-view">
      <header className="view-head">
        <button type="button" className="icon-btn only-mobile" onClick={onBack} aria-label="返回会话列表">
          <Icon name="back" />
        </button>
        <div className="view-title">
          <h2>任务</h2>
          <p>持久任务台账；到期会派发到房间，重启不丢</p>
        </div>
        <button type="button" className="primary" onClick={onNew}>
          <Icon name="plus" size={16} />
          新建任务
        </button>
      </header>

      <div className="tasks-filters">
        <label className="field compact">
          <span>状态</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">全部</option>
            {Object.entries(STATUS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <span className="tasks-count">{visible.length} 个任务</span>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="task-list">
        {visible.map((task) => {
          const owner = task.ownerName || names.get(task.owner) || "未指定";
          const last = task.checkpoints?.at(-1);
          const due = task.dueAt ? timeOf(task.dueAt) : "未设定";
          const working = busyId === task.id;
          return (
            <article className={`task-card status-${task.status}`} key={task.id}>
              <div className="task-top">
                <div className="task-title">
                  <span className={`task-status status-${task.status}`}>
                    {STATUS[task.status] ?? task.status}
                  </span>
                  <h3>{task.title}</h3>
                </div>
                <time className="task-due">到期：{due}</time>
              </div>
              {task.description && <p className="task-desc">{task.description}</p>}
              <p className="task-meta">
                负责人：{owner}
                {task.roomName ? ` · 房间：${task.roomName}` : " · 未绑定房间"}
                {task.intervalMinutes > 0 ? ` · 每 ${task.intervalMinutes} 分钟` : " · 一次性"}
                {task.lastDispatchedAt ? ` · 已派发：${timeOf(task.lastDispatchedAt)}` : ""}
              </p>
              {task.lastError && <p className="form-error">{task.lastError}</p>}
              {last && <p className="task-checkpoint">最近检查点：{last.text}</p>}
              <div className="task-actions">
                {(task.status === "pending" || task.status === "blocked") && (
                  <button
                    type="button"
                    className="primary small"
                    disabled={working}
                    onClick={() => act(task, "dispatch")}
                  >
                    派发
                  </button>
                )}
                {task.status === "active" && (
                  <button
                    type="button"
                    className="primary small"
                    disabled={working}
                    onClick={() => act(task, "done")}
                  >
                    标记完成
                  </button>
                )}
                {task.status === "active" && (
                  <button
                    type="button"
                    className="ghost"
                    disabled={working}
                    onClick={() => act(task, "blocked")}
                  >
                    阻塞
                  </button>
                )}
                {(task.status === "done" || task.status === "cancelled") && (
                  <button
                    type="button"
                    className="ghost"
                    disabled={working}
                    onClick={() => act(task, "pending")}
                  >
                    重开
                  </button>
                )}
                {task.status !== "done" && task.status !== "cancelled" && (
                  <button
                    type="button"
                    className="ghost"
                    disabled={working}
                    onClick={() => act(task, "cancelled")}
                  >
                    取消
                  </button>
                )}
                {task.roomId && (
                  <button type="button" className="ghost" onClick={() => onOpenRoom(task.roomId)}>
                    打开房间
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {!visible.length && <p className="muted">还没有任务。新建一个，到期会自动派发到房间。</p>}
      </div>
    </section>
  );
}
