import Avatar from "./Avatar";
import Icon from "./Icon";

const STATUS = {
  idle: "空闲",
  working: "思考中",
  offline: "离线",
};

export default function AgentsView({ agents, onNew, onDm, onProfile, onBack }) {
  return (
    <section className="agents-view">
      <header className="view-head">
        <button type="button" className="icon-btn only-mobile" onClick={onBack} aria-label="返回会话列表">
          <Icon name="back" />
        </button>
        <div className="view-title">
          <h2>Agents</h2>
          <p>房间里可以对话的参与者</p>
        </div>
        <button type="button" className="primary" onClick={onNew}>
          <Icon name="plus" size={16} />
          新建 agent
        </button>
      </header>

      <p className="view-note">
        Claude agent 会阅读每条人类消息，自己决定是否回复；没有补充就安静地 PASS。测试脚本只在被 @
        时回复，用来验证协议。
      </p>

      <div className="agent-list">
        {agents.map((agent) => (
          <article className="agent-card" key={agent.id}>
            <button
              type="button"
              className="avatar-btn"
              onClick={() => onProfile(agent)}
              aria-label={`查看 ${agent.displayName} 的资料`}
            >
              <Avatar name={agent.name} size={46} />
            </button>
            <div className="agent-main">
              <div className="agent-name">
                {agent.displayName}
                <span>@{agent.name}</span>
              </div>
              <div className="agent-meta">
                <span className={`chip-runtime ${agent.runtime}`}>
                  {agent.runtime === "script" ? "测试脚本" : "Claude"}
                </span>
                {agent.templateName && <span className="chip-role">{agent.templateName}</span>}
                {agent.roles
                  .filter((role) => role !== agent.templateId)
                  .map((role) => (
                    <span className="chip-role" key={role}>
                      {role}
                    </span>
                  ))}
              </div>
            </div>
            <div className={`agent-status ${agent.status}`}>
              <span className={`status-dot ${agent.status}`} aria-hidden="true" />
              {STATUS[agent.status] ?? agent.status}
            </div>
            <button type="button" className="ghost" onClick={() => onDm(agent.id)}>
              私聊
            </button>
          </article>
        ))}

        {!agents.length && (
          <div className="agents-empty">
            <p>还没有 agent。</p>
            <button type="button" className="primary" onClick={onNew}>
              创建第一个
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
