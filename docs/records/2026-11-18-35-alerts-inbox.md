# 2026-11-18-35 待办/告警收件箱

- 记录时间：2026-11-18。
- 目标：A 轨道第一块——把分散在房间/任务/预算里的待处理项集中起来。
- 关联：[13 MVP 架构](../13-mvp-architecture.md) · [19 §7](../19-product-and-architecture-review.md) · [记录 20 活动页](2026-11-17-20-activity-and-global-pause.md)

## 实现

- `GET /api/alerts` 聚合：
  - 最近 24h 的 `tool_request` / `room_request` 消息（房间、发送者、文本）；
  - tasks：`needsAttention` 或 `failed/blocked`；
  - budget：今天花费达到/超过 `dailyBudgetUsd`（cap>0）的 agent；
  - system：killed / gatewayRunning / pausedAgents。
- UI 侧栏「待办」页：
  - 审批/请求、任务需关注、超预算、系统状态；
  - 每条可打开房间/任务页；本版不做页内直接批准。
- usageSummary 每行新增 `dailyBudgetUsd/overBudget`。

## 验证

- `/api/alerts` 返回 approvals=1（历史 room_request）、tasks=0、budget=0、system `{killed:false,gatewayRunning:true,pausedAgents:0}`。
- lint/build 通过；42 tests。

## 边界

- 审批没有持久 pending 状态：已处理的 tool/room request 仍可能出现在 24h 列表里；需要打开房间看上下文。
- 只能跳转，不能在收件箱里直接批准/拒绝。
- 24h 窗口/最多 50 条；会扫描每个房间最近 100 条消息，房间多时较慢。
- 预算告警只覆盖 cap>0；默认 cap=0（不限）不会报警。
- 没有推送/桌面通知联动；没有告警静音/已读。
