import { useState } from "react";
import Icon from "./Icon";
import { useDialogFocus } from "../useDialogFocus";

export default function IntakeModal({ busy, error, onClose, onSubmit }) {
  const [problem, setProblem] = useState("");
  const dialogRef = useDialogFocus(onClose);
  const canSubmit = problem.trim().length >= 5 && !busy;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="需求评估"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>需求评估</h2>
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
              if (canSubmit) onSubmit(problem.trim());
            }}
          >
            <label className="field">
              <span>你遇到的问题 / 想做的事</span>
              <textarea
                name="problem"
                autoComplete="off"
                rows={7}
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
                placeholder="例如：我想做一个稳定的个人记账服务，先从一个最小版本开始……"
                required
              />
            </label>
            <p className="form-note">
              需求顾问会先重述目标、约束和验收，再推荐单点解决还是小团队运营；默认优先单点，不会自动创建团队。
              评估结果会打开一个私聊，你可以看完再决定。
            </p>
            <button type="submit" className="primary wide" disabled={!canSubmit}>
              {busy ? "打开评估…" : "让需求顾问评估"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
