import { useEffect, useState } from "react";
import { api } from "../api";
import Icon from "./Icon";

const USD = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});

function timeOf(ts) {
  if (!ts) return "—";
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? ts : date.toLocaleString("zh-CN", { hour12: false });
}

export default function AlertsView({ onOpenRoom, onTasks, onBack }) {
  const [alerts, setAlerts] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await api.alerts();
        if (alive) {
          setAlerts(data);
          setError("");
        }
      } catch (err) {
        if (alive) setError(err.message);
      }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const approvals = alerts?.approvals ?? [];
  const tasks = alerts?.tasks ?? [];
  const budget = alerts?.budget ?? [];
  const system = alerts?.system ?? {};

  return (
    <section className="alerts-view">
      <header className="view-head">
        <button type="button" className="icon-btn only-mobile" onClick={onBack} aria-label="返回会话列表">
          <Icon name="back" />
        </button>
        <div className="view-title">
          <h2>待办 / 告警</h2>
          <p>24h 内的工具/房间请求、需关注任务、超预算与系统状态</p>
        </div>
      </header>

      {error && <p className="form-error">{error}</p>}

      <div className="alert-summary">
        <span>审批/请求 {approvals.length}</span>
        <span>任务 {tasks.length}</span>
        <span>预算 {budget.length}</span>
        <span>{system.killed ? "硬 kill 中" : system.gatewayRunning ? "gateway 运行" : "gateway 停止"}</span>
        <span>{system.pausedAgents ?? 0} 个 agent 暂停</span>
      </div>

      <div className="alert-grid">
        <section className="settings-section alert-section">
          <h3>审批 / 请求</h3>
          {approvals.map((item) => (
            <div className="alert-card" key={item.message.id}>
              <div className="alert-card-top">
                <strong>{item.message.displayName || item.message.senderName}</strong>
                <time>{timeOf(item.message.createdAt)}</time>
              </div>
              <p>{String(item.message.text ?? "").slice(0, 220)}</p>
              <div className="alert-actions">
                <span className="alert-room">{item.room.name}</span>
                <button type="button" className="ghost" onClick={() => onOpenRoom(item.room.id)}>
                  打开房间
                </button>
              </div>
            </div>
          ))}
          {!approvals.length && <p className="muted">没有待处理的工具/房间请求。</p>}
        </section>

        <section className="settings-section alert-section">
          <h3>任务需关注</h3>
          {tasks.map((task) => (
            <div className="alert-card" key={task.id}>
              <div className="alert-card-top">
                <strong>{task.title}</strong>
                <time>{task.status}</time>
              </div>
              <p>
                {task.lastError || (task.needsAttention ? "可能中断/需人工处理" : "阻塞")}
                {task.retryCount > 0 ? ` · 重试 ${task.retryCount}/${task.maxRetries}` : ""}
              </p>
              <div className="alert-actions">
                <button type="button" className="ghost" onClick={onTasks}>
                  打开任务
                </button>
                {task.roomId && (
                  <button type="button" className="ghost" onClick={() => onOpenRoom(task.roomId)}>
                    打开房间
                  </button>
                )}
              </div>
            </div>
          ))}
          {!tasks.length && <p className="muted">没有需关注的任务。</p>}
        </section>

        <section className="settings-section alert-section">
          <h3>超预算</h3>
          {budget.map((row) => (
            <div className="alert-card" key={row.id}>
              <div className="alert-card-top">
                <strong>{row.displayName}</strong>
                <time>
                  {USD.format(row.todayCost)} / {USD.format(row.dailyBudgetUsd)}
                </time>
              </div>
              <p>今天 {row.todayTurns} turns；达到/超过每日预算。</p>
            </div>
          ))}
          {!budget.length && <p className="muted">没有超预算的 agent。</p>}
        </section>
      </div>
    </section>
  );
}
