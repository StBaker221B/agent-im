import AgentSettings from "./AgentSettings";
import Icon from "./Icon";

export default function AgentSettingsView({ agent, templates = [], onSave, onBack }) {
  if (!agent) {
    return (
      <section className="settings-view">
        <header className="view-head">
          <button type="button" className="icon-btn" onClick={onBack} aria-label="返回 Agents">
            <Icon name="back" />
          </button>
          <div className="view-title">
            <h2>Agent 不存在</h2>
            <p>它可能已经被删除，或者链接过期了。</p>
          </div>
        </header>
      </section>
    );
  }

  return (
    <section className="settings-view">
      <header className="view-head">
        <button type="button" className="icon-btn only-mobile" onClick={onBack} aria-label="返回 Agents">
          <Icon name="back" />
        </button>
        <div className="view-title">
          <h2>{agent.displayName}</h2>
          <p>
            Agent 配置 · @{agent.name} · {agent.templateName ?? agent.role ?? "通用"}
          </p>
        </div>
        <button type="button" className="ghost" onClick={onBack}>
          返回 Agents
        </button>
      </header>

      <div className="settings-section">
        <AgentSettings agent={agent} templates={templates} onSave={onSave} />
      </div>
    </section>
  );
}
