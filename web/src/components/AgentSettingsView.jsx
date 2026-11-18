import { useState } from "react";
import AgentSettings from "./AgentSettings";
import Icon from "./Icon";

export default function AgentSettingsView({
  agent,
  templates = [],
  onSave,
  onCreateWorktree,
  onMergeWorktree,
  onRemoveWorktree,
  onDelete,
  onBack,
}) {
  const [repoPath, setRepoPath] = useState("");
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

      <div className="settings-section">
        <h3>Workspace / Worktree</h3>
        {agent.worktree ? (
          <>
            <p className="settings-note">
              当前 worktree：<code>{agent.worktree.path}</code>
              <br />
              分支：<code>{agent.worktree.branch}</code>
              <br />
              仓库：<code>{agent.worktree.repo}</code>
            </p>
            <div className="settings-actions">
              <button type="button" className="primary" onClick={() => onMergeWorktree?.(agent.id)}>
                合并到当前分支（人工确认）
              </button>
              <button type="button" className="ghost" onClick={() => onRemoveWorktree?.(agent.id)}>
                移除 worktree
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="settings-note">
              给这个 agent 一个独立 git worktree/branch，避免和其他 agent 共用工作目录。不会自动合并分支。
            </p>
            <div className="field-row">
              <label className="field">
                <span>Git 仓库路径</span>
                <input
                  name="repoPath"
                  autoComplete="off"
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder="D:\\path\\to\\repo"
                />
              </label>
              <div className="settings-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={!repoPath.trim()}
                  onClick={() => onCreateWorktree?.(agent.id, repoPath.trim())}
                >
                  创建 worktree
                </button>
              </div>
            </div>
            {agent.cwd && (
              <p className="settings-note">
                当前 cwd：<code>{agent.cwd}</code>
              </p>
            )}
          </>
        )}
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
