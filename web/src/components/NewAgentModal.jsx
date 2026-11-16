import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useDialogFocus } from "../useDialogFocus";

export default function NewAgentModal({ templates, busy, error, onClose, onCreateAgent }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [templateId, setTemplateId] = useState("generic");
  const [roles, setRoles] = useState("");
  const [runtime, setRuntime] = useState("claude");
  const [toolsMode, setToolsMode] = useState("template");
  const [systemPrompt, setSystemPrompt] = useState("");
  const dialogRef = useDialogFocus(onClose);

  useEffect(() => {
    if (templates.length && !templates.some((t) => t.id === templateId)) {
      setTemplateId(templates[0].id);
    }
  }, [templates, templateId]);

  const template = templates.find((t) => t.id === templateId) ?? null;
  const canSubmit = username.trim() && !busy;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="新建 agent"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>新建 Agent</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" />
          </button>
        </header>

        <div className="modal-body">
          {error && <p className="form-error">{error}</p>}
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) {
                onCreateAgent({
                  username: username.trim().toLowerCase(),
                  displayName: displayName.trim(),
                  templateId,
                  roles,
                  runtime,
                  toolsMode,
                  systemPrompt,
                });
              }
            }}
          >
            <div className="field-row">
              <label className="field">
                <span>ID（用于 @）</span>
                <input
                  name="username"
                  autoComplete="off"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="frontend-dev"
                  pattern="[a-z0-9._=\-]{1,32}"
                  title="小写字母、数字和 . _ = -"
                  autoFocus
                  required
                />
              </label>
              <label className="field">
                <span>显示名</span>
                <input
                  name="displayName"
                  autoComplete="off"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="前端助手"
                />
              </label>
            </div>

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

            {template && (
              <div className="template-preview">
                <div className="template-preview-head">
                  <strong>{template.name}</strong>
                  <span>{template.mission}</span>
                </div>
                <ul>
                  {template.responsibilities.slice(0, 4).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
                <p className="template-boundary">边界：{template.boundaries.slice(0, 3).join("；")}</p>
                <p className="template-meta">
                  工具：{(template.tools?.allow ?? []).join(" / ") || "无"} · 知识包：
                  {(template.knowledgePacks ?? []).join("、") || "无"}
                </p>
              </div>
            )}

            <div className="field-row">
              <label className="field">
                <span>Runtime</span>
                <select name="runtime" value={runtime} onChange={(e) => setRuntime(e.target.value)}>
                  <option value="claude">Claude（真实）</option>
                  <option value="script">测试脚本（不花钱）</option>
                </select>
              </label>
              <label className="field">
                <span>工具权限</span>
                <select name="toolsMode" value={toolsMode} onChange={(e) => setToolsMode(e.target.value)}>
                  <option value="template">按模板（推荐）</option>
                  <option value="full">完整工具（可写；需要时再放开）</option>
                  <option value="off">关闭工具</option>
                </select>
              </label>
            </div>

            <label className="field">
              <span>标签（逗号分隔，仅展示）</span>
              <input
                name="roles"
                autoComplete="off"
                value={roles}
                onChange={(e) => setRoles(e.target.value)}
                placeholder="例如：auth, frontend"
              />
            </label>

            <label className="field">
              <span>个人补充（追加到默认提示，可留空）</span>
              <textarea
                name="systemPrompt"
                autoComplete="off"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={3}
                placeholder="只写这个 agent 的个性化要求；角色卡和知识包会自动追加。"
              />
            </label>

            <p className="form-note">角色卡、角色知识包和私有 knowledge 会在运行时拼接；创建后自动开私聊。</p>
            <button type="submit" className="primary wide" disabled={!canSubmit}>
              {busy ? "创建中…" : "创建并私聊"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
