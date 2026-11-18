# 2026-11-18-36 Agent Worktree 工作区

- 记录时间：2026-11-18。
- 目标：E 轨道第一步——让 coding agent 在独立 git worktree/branch 工作，不再共享 cwd。
- 关联：[13 MVP 架构](../13-mvp-architecture.md) · [19 §7](../19-product-and-architecture-review.md) · [17 任务台账](../17-task-ledger.md)

## 实现

- `app/worktrees.mjs`：
  - `createWorktree({repoPath, agentName, base, rootDir})`：校验 git root，`git worktree add -b agent/<name>/<stamp> <path> <base>`；
  - `removeWorktree`：`git worktree remove --force`；
  - `listWorktrees`。
- API：
  - `POST /api/agents/:id/worktree {repoPath,base}`：agent 空闲才允许；创建后设置 `agent.cwd`/`agent.worktree`，重建 runtime；一个 agent 只能一个 worktree。
  - `DELETE /api/agents/:id/worktree`：移除 worktree，cwd 置空，重建 runtime。
- UI：Agent 设置页「Workspace / Worktree」：
  - 填 git 仓库路径 → 创建；
  - 显示 repo/path/branch，可移除。
- 测试：临时 git repo + demo-security 创建/移除，branch/path/cwd 正确，移除后 worktree=null/cwd=null；worktree 单测 1 个，spike **43 tests**。

## 边界

- **没有 merge 审批**：branch 只创建，不自动合并；合并需要人类在 git 外部完成。
- 一个 agent 一个 worktree；没有按 task/thread 多 worktree。
- worktree 从 HEAD 创建，不包含主工作区未提交改动。
- 没有 OS 级只读（reviewer 只读仍靠 prompt/toolsMode）、容器/凭据隔离。
- worktree 路径在 `app/data/worktrees/`（gitignored）；删除 agent 不会自动删 worktree（需先移除）。
- 不适用于非 git 业务目录；非编码业务流仍用 cwd/权限模式。

## 下一步

- merge 审批门（人类批准后 merge/cherry-pick）。
- 按 task/thread 的 worktree 生命周期与清理。
- reviewer OS 只读/容器沙箱。
