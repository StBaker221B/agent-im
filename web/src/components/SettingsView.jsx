import { useEffect, useState } from "react";
import { api } from "../api";
import Icon from "./Icon";

const USD = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", maximumFractionDigits: 4 });

export default function SettingsView({ data, onBack }) {
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
          <p>系统信息、用量和全局配置</p>
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
              数据来自 app/data/audit.jsonl 的 usage 事件；USD 是 Claude CLI 返回的
              total_cost_usd（供应商计价），不是前端按 token 估算。triage 跳过不会产生 turn。
            </p>
          </>
        ) : (
          <p className="muted">加载中…</p>
        )}
      </div>

      <div className="settings-section">
        <h3>Agent 配置</h3>
        <p className="settings-note">
          每个 agent 的角色模板、工具权限、每日预算、triage、暂停和系统提示，在 Agents 页对应 agent
          的「设置」里改。
        </p>
      </div>
    </section>
  );
}
