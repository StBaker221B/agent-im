# 2026-11-17-17 Agent 软删除

- 记录时间：2026-11-17 上午。
- 目的：清理实验/临时 agent，不再让它们出现在 Agents、会话和后续唤醒里。
- 关联：[13 MVP 架构](../13-mvp-architecture.md) · [14 路线图](../14-role-templates-and-roadmap.md) · [记录 15 设置/团队](2026-11-17-15-settings-teams-time.md)

## 行为

`DELETE /api/agents/:id` 是软删除：

- 正在跑（engine floor/queue 里有它）→ 409，要求等空闲或先暂停。
- 对每个房间：
  - DM（`kind=dm && peerId=agent`）：人类也 leave，房间从 store/列表移除；Matrix 历史留在服务器。
  - 群：agent leave，房间保留，`memberIds` 去掉它；其他人和历史不受影响。
- `agent.status = "deleted"`，写 `deletedAt`；bootstrap 的 agents 过滤掉它，但 state/usage/audit 保留。
- Gateway `removeAgent`：停止该 agent 的 sync 循环、删除 runtime/client、从 engine agents/rooms 移除。
- 设置页 danger zone 有「删除这个 agent」，确认后回到 Agents 页。

## 实测

- 创建临时 `@tmpdel072896`（generic、tools off）→ 建 DM → `DELETE` 200。
- bootstrap：agent 不在列表、DM 不在列表。
- 再次 `DELETE` → 404。
- 服务日志显示 agent removed；没有模型调用/成本。

## 边界

- Matrix 账号不回收；同名 ID 不能直接重建（账号还在）。
- 没有 undelete/硬删除；没有批量删除。
- 群如果只剩人类，会保留成空群，需要手动删除。
- 删除只在 agent 空闲时允许；运行中的 agent 先暂停/等结束。
- 目前 UI 只从 Agent 设置页删除；Agents 列表没有批量操作。
