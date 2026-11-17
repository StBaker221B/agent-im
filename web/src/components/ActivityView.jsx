import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import Icon from "./Icon";

const KINDS = [
  { value: "", label: "全部事件" },
  { value: "outbound", label: "消息" },
  { value: "tool_use", label: "工具调用" },
  { value: "tool_result", label: "工具结果" },
  { value: "usage", label: "成本" },
  { value: "triage_skip", label: "triage 跳过" },
  { value: "budget_skip", label: "预算跳过" },
  { value: "paused_skip", label: "暂停跳过" },
  { value: "turn_error", label: "错误" },
];

const USD = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});

function timeOf(ts) {
  if (!ts) return "—";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function kindLabel(kind) {
  return KINDS.find((item) => item.value === kind)?.label ?? kind;
}

export default function ActivityView({ data, onBack }) {
  const [events, setEvents] = useState([]);
  const [kind, setKind] = useState("");
  const [agentId, setAgentId] = useState("");
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);

  const agents = useMemo(() => data?.agents ?? [], [data?.agents]);
  const names = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.displayName])), [agents]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.audit({ limit: 250, kind, agentId });
        if (!alive) return;
        setEvents(res.events ?? []);
        setError("");
        setUpdatedAt(Date.now());
      } catch (err) {
        if (alive) setError(err.message);
      }
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [kind, agentId]);

  return (
    <section className="activity-view">
      <header className="view-head">
        <button type="button" className="icon-btn only-mobile" onClick={onBack} aria-label="返回会话列表">
          <Icon name="back" />
        </button>
        <div className="view-title">
          <h2>活动 / 审计</h2>
          <p>最近 250 条 gateway 事件；本地只读视图</p>
        </div>
      </header>

      <div className="activity-filters">
        <label className="field compact">
          <span>类型</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((item) => (
              <option key={item.value || "all"} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field compact">
          <span>Agent</span>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">全部 agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.displayName}
              </option>
            ))}
          </select>
        </label>
        <span className="activity-updated">
          {updatedAt
            ? `刷新于 ${new Date(updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}`
            : "加载中…"}
        </span>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="activity-list">
        {events.map((event, index) => (
          <div className="activity-row" key={`${event.ts}:${event.kind}:${index}`}>
            <time className="activity-time">{timeOf(event.ts)}</time>
            <span className={`activity-kind kind-${event.kind}`}>{kindLabel(event.kind)}</span>
            <span className="activity-agent">{names.get(event.agentId) ?? event.agentId ?? "—"}</span>
            <span className="activity-detail">{event.detail || event.name || event.type || "—"}</span>
            <span className="activity-cost">{event.costUsd != null ? USD.format(event.costUsd) : ""}</span>
          </div>
        ))}
        {!events.length && !error && <p className="muted">暂时没有事件。</p>}
      </div>
    </section>
  );
}
