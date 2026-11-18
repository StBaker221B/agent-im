# 2026-11-18-47 任务详情与审计时间线

- 记录时间：2026-11-18。
- 目标：A/F 轨道——任务不只一行状态，能看检查点和 taskId 关联的审计事件。
- 关联：[17 任务台账](../17-task-ledger.md) · [13 MVP 架构](../13-mvp-architecture.md) · [记录 35 待办](2026-11-18-35-alerts-inbox.md)

## 实现

- `GET /api/tasks/:id/events`：
  - 返回 taskView + audit.jsonl 里 `taskId` 匹配的事件（按时间排序，最多 200 条）；
  - 找不到任务 404；
  - 没有 taskId 的事件（usage/turn）不会出现。
- TasksView 每张卡片「详情」→ TaskDetailModal：
  - 状态/负责人/房间；
  - checkpoints 时间线；
  - audit 事件（task_create/task_dispatch/task_done/task_failed 等）；
  - 可打开房间/关闭。

## 验证

- `soak-...-2m` 任务：checkpoints=2，events=2（task_dispatch ×2）。
- `agent任务标记测试`：详情显示 3 条 checkpoint（created/dispatched/DONE）+ task_create/task_done 审计；Chromium 截图确认。
- lint/build 通过；43 tests（UI/API 未加自动化）。

## 边界

- 不是完整回放：usage/turn 审计没有 taskId，无法串进任务时间线。
- 只读 audit.jsonl 最近全部扫描；没有分页/过滤/导出单任务。
- 没有线程回放/事件 schema/actor；taskId 目前是软关联。
- 没有独立任务详情路由/深链；刷新后 modal 关闭。
