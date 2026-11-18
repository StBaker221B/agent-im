# 2026-11-18-38 Worktree 分支合并（人工确认）

- 记录时间：2026-11-18。
- 目标：E 轨道补 merge 门——agent 的分支必须由人类显式合并，不自动落主分支。
- 关联：[记录 36 Worktree](2026-11-18-36-worktree-workspace.md) · [13 MVP 架构](../13-mvp-architecture.md) · [19 §7](../19-product-and-architecture-review.md)

## 实现

- `app/worktrees.mjs` 新增 `mergeWorktree`：
  - 拒绝主工作区 dirty；
  - 拒绝 detached HEAD；
  - 拒绝 branch 合并到自己；
  - `git merge --no-ff <branch> -m <message>`。
- `POST /api/agents/:id/worktree/merge`：
  - agent 必须有 worktree、必须空闲；
  - 由人类 API 调用触发；失败 409。
- UI Agent 设置页：worktree 显示区有「合并到当前分支（人工确认）」，二次 confirm；不会自动合并。
- 测试：临时 repo 创建 demo-security worktree，在 worktree 提交 README 修改，调用 merge，主 repo README 变为新内容；随后移除 worktree。

## 边界

- 没有冲突解决 UI；冲突由 git 返回 409，需人类在 shell 处理（可能留下 MERGE_HEAD）。
- 没有审批记录/签名；人类点 confirm + API 调用就是批准。
- 没有 CI/tests 门禁、没有 target branch 选择（合并到当前分支）。
- 没有自动删除已合并 worktree/branch。
- 仍没有 OS 只读/容器/凭据隔离。
