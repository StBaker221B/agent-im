import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import Icon from "./Icon";
import { api } from "../api";
import { useDialogFocus } from "../useDialogFocus";

const STATUS = { idle: "空闲", working: "思考中", paused: "已暂停", offline: "离线" };
const WAKE = {
  human_all: "每条人类消息都会判断",
  mention_only: "只被 @ 时回复",
  all: "所有消息都判断",
  mention_or_reply: "被 @ 或回复时判断",
  digest: "只收摘要",
};

export default function ProfileModal({ profile, onClose, onDm, onConfigure }) {
  const dialogRef = useDialogFocus(onClose);
  const [card, setCard] = useState(null);

  useEffect(() => {
    let alive = true;
    setCard(null);
    if (!profile?.id || profile.kind !== "agent") return () => {};
    api
      .agentCard(profile.id)
      .then((res) => {
        if (alive) setCard(res.card);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [profile?.id, profile?.kind]);

  if (!profile) return null;
  const isAgent = profile.kind === "agent";

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal profile-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="资料"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>资料</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" />
          </button>
        </header>

        <div className="profile-body">
          <Avatar name={profile.name ?? profile.displayName} size={64} />
          <h3>{profile.displayName || profile.name}</h3>
          <p className="profile-handle">@{profile.name}</p>

          <dl className="profile-facts">
            <div>
              <dt>类型</dt>
              <dd>{isAgent ? "Agent" : "人类"}</dd>
            </div>
            {isAgent && (
              <div>
                <dt>Runtime</dt>
                <dd>{profile.runtime === "script" ? "测试脚本" : "Claude"}</dd>
              </div>
            )}
            {isAgent && (
              <div>
                <dt>角色模板</dt>
                <dd>{profile.templateName ?? profile.role ?? "通用"}</dd>
              </div>
            )}
            {isAgent && (
              <div>
                <dt>状态</dt>
                <dd>{STATUS[profile.status] ?? profile.status ?? "未知"}</dd>
              </div>
            )}
            {isAgent && (
              <div>
                <dt>唤醒</dt>
                <dd>{WAKE[profile.wakePolicy] ?? profile.wakePolicy ?? "—"}</dd>
              </div>
            )}
            {isAgent && (
              <div>
                <dt>角色</dt>
                <dd>{(profile.roles ?? []).filter((r) => r !== profile.templateId).join("、") || "通用"}</dd>
              </div>
            )}
            {isAgent && profile.domains?.length > 0 && (
              <div>
                <dt>领域</dt>
                <dd>{profile.domains.join("、")}</dd>
              </div>
            )}
          </dl>

          {isAgent && profile.mission && <p className="profile-note">{profile.mission}</p>}
          {isAgent && (
            <p className="profile-note">这个 agent 在群聊和私聊共享同一份记忆，但会把私聊内容留在私聊。</p>
          )}

          {card && (
            <div className="profile-card">
              {[
                ["职责", card.responsibilities],
                ["边界", card.boundaries],
                ["决策权", card.decisionRights],
                ["思维风格", card.thinkingStyle],
                ["沟通风格", card.communicationStyle],
                ["交接", card.handoff],
                ["成功标准", card.successCriteria],
              ]
                .filter(([, items]) => items?.length)
                .map(([label, items]) => (
                  <div className="profile-card-section" key={label}>
                    <strong>{label}</strong>
                    <ul>
                      {items.slice(0, 5).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              {card.tools?.allow?.length > 0 && (
                <div className="profile-card-section">
                  <strong>工具</strong>
                  <p>{card.tools.allow.join(" / ")}</p>
                </div>
              )}
              {card.capabilities && (
                <div className="profile-card-section">
                  <strong>Runtime capabilities</strong>
                  <p>
                    {Object.entries(card.capabilities)
                      .map(([key, value]) => `${key}=${value}`)
                      .join(" · ")}
                  </p>
                </div>
              )}
            </div>
          )}

          {isAgent && (onDm || onConfigure) && (
            <div className="profile-actions">
              {onConfigure && (
                <button type="button" className="ghost" onClick={() => onConfigure(profile.id)}>
                  设置
                </button>
              )}
              {onDm && (
                <button type="button" className="primary" onClick={() => onDm(profile.id)}>
                  私聊
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
