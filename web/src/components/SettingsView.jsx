import { useEffect, useState } from "react";
import { api } from "../api";
import Avatar from "./Avatar";
import Icon from "./Icon";

const USD = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", maximumFractionDigits: 4 });

const WAKE_OPTIONS = [
  { value: "human_all", label: "人类消息全部判断（默认）" },
  { value: "mention_only", label: "只在被 @ 时回复" },
  { value: "mention_or_reply", label: "被 @ 或回复时判断" },
  { value: "all", label: "所有消息都判断" },
  { value: "digest", label: "只收摘要" },
];

function AgentSettings({ agent, templates, onSave }) {
  const [displayName, setDisplayName] = useState(agent.displayName ?? "");
  const [templateId, setTemplateId] = useState(agent.templateId ?? "generic");
  const [roles, setRoles] = useState((agent.roles ?? []).filter((r) => r !== agent.templateId).join(", "));
  const [wakePolicy, setWakePolicy] = useState(agent.wakePolicy ?? "human_all");
  const [toolsMode, setToolsMode] = useState(agent.toolsMode ?? (agent.toolsEnabled ? "template" : "off"));
  const [dailyBudgetUsd, setDailyBudgetUsd] = useState(Number(agent.dailyBudgetUsd ?? 0));
  const [status, setStatus] = useState(agent.status ?? "active");
  const [cooldownSec, setCooldownSec] = useState(Math.round((agent.triage?.cooldownMs ?? 15000) / 1000));
  const [maxTurns, setMaxTurns] = useState(agent.triage?.maxTurnsPerHour ?? 30);
  const [skipAcks, setSkipAcks] = useState(agent.triage?.skipAcks ?? true);
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const template = templates.find((t) => t.id === templateId) ?? null;

  useEffect(() => {
    setDisplayName(agent.displayName ?? "");
    setTemplateId(agent.templateId ?? "generic");
    setRoles((agent.roles ?? []).filter((r) => r !== agent.templateId).join(", "));
    setWakePolicy(agent.wakePolicy ?? "human_all");
    setToolsMode(agent.toolsMode ?? (agent.toolsEnabled ? "template" : "off"));
    setDailyBudgetUsd(Number(agent.dailyBudgetUsd ?? 0));
    setStatus(agent.status ?? "active");
    setCooldownSec(Math.round((agent.triage?.cooldownMs ?? 15000) / 1000));
    setMaxTurns(agent.triage?.maxTurnsPerHour ?? 30);
    setSkipAcks(agent.triage?.skipAcks ?? true);
    setSystemPrompt(agent.systemPrompt ?? "");
  }, [agent]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const ok = await onSave(agent.id, {
        displayName,
        templateId,
        roles,
        wakePolicy,
        toolsMode,
        dailyBudgetUsd,
        status,
        triage: {
          cooldownMs: Math.max(0, Number(cooldownSec) || 0) * 1000,
          maxTurnsPerHour: Math.max(0, Number(maxTurns) || 0),
          skipAcks,
        },
        systemPrompt,
      });
      if (ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="settings-agent" onSubmit={submit}>
      <div className="settings-agent-head">
        <Avatar name={agent.name} size={40} />
        <div>
          <div className="settings-agent-name">{agent.displayName}</div>
          <div className="settings-agent-handle">
            @{agent.name} · {agent.runtime === "script" ? "测试脚本" : "Claude"}
          </div>
        </div>
        <span className="settings-saved" aria-live="polite">
          {saved ? "已保存" : ""}
        </span>
      </div>

      <div className="field-row">
        <label className="field">
          <span>显示名</span>
          <input
            name="displayName"
            autoComplete="off"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>标签（逗号分隔）</span>
          <input name="roles" autoComplete="off" value={roles} onChange={(e) => setRoles(e.target.value)} />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span>角色模板</span>
          <select name="templateId" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}（{t.category}）
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>唤醒策略</span>
          <select name="wakePolicy" value={wakePolicy} onChange={(e) => setWakePolicy(e.target.value)}>
            {WAKE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {template && (
        <div className="template-preview compact">
          <div className="template-preview-head">
            <strong>{template.name}</strong>
            <span>{template.mission}</span>
          </div>
          <p className="template-boundary">边界：{template.boundaries.slice(0, 3).join("；")}</p>
          <p className="template-meta">
            工具：{(template.tools?.allow ?? []).join(" / ") || "无"} · 知识包：
            {(template.knowledgePacks ?? []).join("、") || "无"}
          </p>
        </div>
      )}

      <div className="field-row">
        <label className="field">
          <span>状态</span>
          <select name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">启用</option>
            <option value="paused">暂停（收到消息也不跑）</option>
          </select>
        </label>
        <label className="field">
          <span>triage 冷却（秒）</span>
          <input
            type="number"
            name="cooldownSec"
            min="0"
            step="1"
            value={cooldownSec}
            onChange={(e) => setCooldownSec(e.target.value)}
          />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span>每小时上限（0 = 不限）</span>
          <input
            type="number"
            name="maxTurns"
            min="0"
            step="1"
            value={maxTurns}
            onChange={(e) => setMaxTurns(e.target.value)}
          />
        </label>
        <label className="check-inline">
          <input type="checkbox" checked={skipAcks} onChange={(e) => setSkipAcks(e.target.checked)} />
          <span>跳过纯 ack / emoji</span>
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span>工具权限</span>
          <select name="toolsMode" value={toolsMode} onChange={(e) => setToolsMode(e.target.value)}>
            <option value="template">按模板（推荐）</option>
            <option value="full">完整工具（可写；需要时再放开）</option>
            <option value="off">关闭工具</option>
          </select>
        </label>
        <label className="field">
          <span>每日预算 USD（0 = 不限）</span>
          <input
            type="number"
            name="dailyBudgetUsd"
            min="0"
            step="0.5"
            value={dailyBudgetUsd}
            onChange={(e) => setDailyBudgetUsd(e.target.value)}
          />
        </label>
      </div>

      {agent.approvedTools?.length > 0 && (
        <div className="approved-tools">
          <span>已批准工具：</span>
          {agent.approvedTools.map((tool) => (
            <button
              key={tool}
              type="button"
              className="tool-chip"
              title="撤销这个工具"
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave(agent.id, {
                    approvedTools: agent.approvedTools.filter((item) => item !== tool),
                  });
                } finally {
                  setSaving(false);
                }
              }}
            >
              {tool} ×
            </button>
          ))}
        </div>
      )}

      <p className="form-note">
        私有知识：<code>app/data/agents/{agent.name}/knowledge/*.md</code>；角色知识包在
        <code>app/role-knowledge/{templateId}.md</code>。改模板/工具/提示会重建 runtime。
      </p>

      {agent.runtime !== "script" && (
        <label className="field">
          <span>系统提示（保存后下一轮生效）</span>
          <textarea
            name="systemPrompt"
            autoComplete="off"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={5}
          />
        </label>
      )}

      <button type="submit" className="primary" disabled={saving}>
        {saving ? "保存中…" : "保存"}
      </button>
    </form>
  );
}

export default function SettingsView({ data, templates = [], onSave, onBack }) {
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .usage()
        .then((d) => {
          if (alive) setUsage(d);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <section className="settings-view">
      <header className="view-head">
        <button type="button" className="icon-btn only-mobile" onClick={onBack} aria-label="返回会话列表">
          <Icon name="back" />
        </button>
        <div className="view-title">
          <h2>设置</h2>
          <p>系统信息和 agent 参数</p>
        </div>
      </header>

      <div className="settings-section">
        <h3>系统</h3>
        <dl className="settings-facts">
          <div>
            <dt>Homeserver</dt>
            <dd>{data?.homeserver ?? "—"}</dd>
          </div>
          <div>
            <dt>服务器名</dt>
            <dd>{data?.serverName ?? "—"}</dd>
          </div>
          <div>
            <dt>人类账号</dt>
            <dd>@{data?.human?.name ?? "—"}</dd>
          </div>
          <div>
            <dt>Agent / 会话</dt>
            <dd>
              {data?.agents?.length ?? 0} / {data?.rooms?.length ?? 0}
            </dd>
          </div>
        </dl>
      </div>

      <div className="settings-section">
        <h3>用量（今天 / 累计）</h3>
        {usage ? (
          <>
            <div className="usage-table">
              <div className="usage-row head">
                <span>Agent</span>
                <span className="usage-num">今天 turns</span>
                <span className="usage-num">今天 $</span>
                <span className="usage-num usage-total">累计 turns</span>
                <span className="usage-num usage-total">累计 $</span>
              </div>
              {[...usage.agents]
                .sort((a, b) => b.todayCost - a.todayCost)
                .map((row) => (
                  <div className="usage-row" key={row.id}>
                    <span>{row.displayName}</span>
                    <span className="usage-num">{row.todayTurns}</span>
                    <span className="usage-num">{USD.format(row.todayCost)}</span>
                    <span className="usage-num usage-total">{row.totalTurns}</span>
                    <span className="usage-num usage-total">{USD.format(row.totalCost)}</span>
                  </div>
                ))}
              <div className="usage-row total">
                <span>合计</span>
                <span className="usage-num">{usage.todayTurns}</span>
                <span className="usage-num">{USD.format(usage.todayCost)}</span>
                <span className="usage-num usage-total">{usage.totalTurns}</span>
                <span className="usage-num usage-total">{USD.format(usage.totalCost)}</span>
              </div>
            </div>
            <p className="settings-note">
              数据来自 app/data/audit.jsonl 的 usage 事件；triage 跳过不会产生 turn。
            </p>
          </>
        ) : (
          <p className="muted">加载中…</p>
        )}
      </div>

      <div className="settings-section">
        <h3>Agents</h3>
        <p className="settings-note">
          唤醒策略决定 agent 什么时候跑模型。human_all 会让每个 Claude agent 都读每条人类消息，成本随 agent
          数增加。系统提示修改会重建 runtime，下一轮生效。
        </p>
        <div className="settings-agents">
          {(data?.agents ?? []).map((agent) => (
            <AgentSettings key={agent.id} agent={agent} templates={templates} onSave={onSave} />
          ))}
        </div>
      </div>
    </section>
  );
}
