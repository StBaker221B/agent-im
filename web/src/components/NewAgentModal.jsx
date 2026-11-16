import { useState } from "react";
import Icon from "./Icon";
import { useDialogFocus } from "../useDialogFocus";

export default function NewAgentModal({ busy, error, onClose, onCreateAgent }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roles, setRoles] = useState("");
  const [runtime, setRuntime] = useState("claude");
  const [systemPrompt, setSystemPrompt] = useState("");
  const dialogRef = useDialogFocus(onClose);

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
                  roles,
                  runtime,
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

            <div className="field-row">
              <label className="field">
                <span>角色（逗号分隔）</span>
                <input
                  name="roles"
                  autoComplete="off"
                  value={roles}
                  onChange={(e) => setRoles(e.target.value)}
                  placeholder="coder, reviewer"
                />
              </label>
              <label className="field">
                <span>Runtime</span>
                <select name="runtime" value={runtime} onChange={(e) => setRuntime(e.target.value)}>
                  <option value="claude">Claude（真实）</option>
                  <option value="script">测试脚本（不花钱）</option>
                </select>
              </label>
            </div>

            <label className="field">
              <span>系统提示（留空用默认）</span>
              <textarea
                name="systemPrompt"
                autoComplete="off"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
                placeholder="默认：只在有实际补充时回复，否则 PASS；跨房间保留记忆但注意私聊隐私。"
              />
            </label>

            <p className="form-note">创建后会自动开一个私聊，并加入网关开始收消息。</p>
            <button type="submit" className="primary wide" disabled={!canSubmit}>
              {busy ? "创建中…" : "创建并私聊"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
