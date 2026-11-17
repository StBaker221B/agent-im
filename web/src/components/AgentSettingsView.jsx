import AgentSettings from "./AgentSettings";
import Icon from "./Icon";

export default function AgentSettingsView({ agent, templates = [], onSave, onDelete, onBack }) {
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

      {onDelete && (
        <div className="settings-section danger-zone">
          <div>
            <h3>删除 agent</h3>
            <p className="settings-note">
              退出所有房间并从列表隐藏；Matrix 历史保留，账号不回收。正在运行的 agent 需要先等它空闲或暂停。
            </p>
          </div>
          <button type="button" className="danger" onClick={() => onDelete(agent.id)}>
            删除这个 agent
          </button>
        </div>
      )}
    </section>
  );
}
