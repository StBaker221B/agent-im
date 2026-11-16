import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import { useDialogFocus } from "../useDialogFocus";

export default function TeamModal({ teams, templates, busy, error, onClose, onCreate }) {
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [prefix, setPrefix] = useState("squad");
  const [groupName, setGroupName] = useState(teams[0]?.groupName ?? "小队");
  const dialogRef = useDialogFocus(onClose);

  const team = teams.find((t) => t.id === teamId) ?? null;
  const roleNames = useMemo(() => {
    const map = new Map(templates.map((t) => [t.id, t.name]));
    return (team?.roles ?? []).map((id) => map.get(id) ?? id);
  }, [team, templates]);

  useEffect(() => {
    if (!team) return;
    setGroupName(team.groupName);
  }, [team]);

  const canSubmit = team && prefix.trim() && !busy;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="创建小队"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>创建小队</h2>
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
                onCreate({ teamId, prefix: prefix.trim().toLowerCase(), groupName: groupName.trim() });
              }
            }}
          >
            <label className="field">
              <span>小队模板</span>
              <select name="teamId" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            {team && (
              <div className="template-preview">
                <div className="template-preview-head">
                  <strong>{team.name}</strong>
                  <span>{team.description}</span>
                </div>
                <p className="template-meta">角色：{roleNames.join("、")}</p>
              </div>
            )}

            <div className="field-row">
              <label className="field">
                <span>ID 前缀（避免重名）</span>
                <input
                  name="prefix"
                  autoComplete="off"
                  spellCheck={false}
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  placeholder="squad"
                  pattern="[a-z0-9][a-z0-9-]{0,19}"
                  title="小写字母/数字/-，1–20 位"
                  required
                />
              </label>
              <label className="field">
                <span>群名</span>
                <input
                  name="groupName"
                  autoComplete="off"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                />
              </label>
            </div>

            <p className="form-note">
              会注册 N 个 Matrix 用户、创建 N 个 agent，并把它们拉进一个群；ID 形如 {prefix || "squad"}-pm。
            </p>
            <button type="submit" className="primary wide" disabled={!canSubmit}>
              {busy ? "创建中…" : "创建小队"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
