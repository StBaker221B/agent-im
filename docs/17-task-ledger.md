# 17. 持久任务台账（v1）

- 状态：2026-11-17 v1 已落地；任务台账 + 到期派发 + 重启不重发。
- 关联：[16 长期驻守与 intake](16-long-running-and-intake.md) · [13 MVP 架构](13-mvp-architecture.md) · [记录 21](records/2026-11-17-21-task-ledger.md)

## 1. 为什么

长期驻守不能只有“聊天 + session”：

- 重启后要知道还有哪些事没做；
- 长任务要有状态（待处理/进行中/阻塞/完成/取消）和检查点；
- 到期的任务要主动派发，而不是等人记得；
- 派发过一次后，重启不能重复发。

v1 先做“人类创建任务 → 到期派发到房间 → 人类/agent 做完后标记”，不做完整工作流引擎。

## 2. 数据

`app/data/tasks.json`（gitignored）：

```json
{
  "id": "task-...",
  "title": "每周整理账单",
  "description": "验收标准……",
  "owner": "@agent:localhost",
  "roomId": "!room:localhost",
  "dueAt": "2026-11-17T10:29:14.476Z",
  "intervalMinutes": 0,
  "priority": 0,
  "status": "pending | active | blocked | done | cancelled",
  "createdAt": "...",
  "updatedAt": "...",
  "lastDispatchedAt": null,
  "lastError": null,
  "checkpoints": [{ "ts": "...", "by": "...", "text": "..." }],
  "createdBy": "@kudo:localhost"
}
```

- `dueAt` 为空 = 不自动派发，可手动“派发”。
- `intervalMinutes > 0` = 重复任务：派发后按间隔排下一次，status 回到 pending；`0` 为一次性任务（派发后 active）。
- 状态由人/UI 更新；v1 不自动根据 agent 回复判完成。

## 3. API

| API | 行为 |
|---|---|
| `GET /api/tasks` | 列出任务（附 owner/room 显示名） |
| `POST /api/tasks` | `{title,description,owner,roomId,dueAt,intervalMinutes,priority}`；创建 pending |
| `PATCH /api/tasks/:id` | 改 title/description/owner/roomId/dueAt/intervalMinutes/status/priority |
| `POST /api/tasks/:id/checkpoints` | `{text}` 追加检查点 |
| `POST /api/tasks/:id/dispatch` | 立即派发（人工触发） |

## 4. 派发语义

- 服务启动 5s 后和第 30s 周期执行一次 `tickTasks()`；
- 只派发 `status=pending` 且 `dueAt <= now` 的任务；
- 派发 = 以人类身份往 `roomId` 发一条消息，`mentions=[owner]`（有 owner 时）；
- 派发**先更新任务状态并写 checkpoint**，再发送：
  - 一次性：active；重复任务：pending，`dueAt = now + intervalMinutes`；
  - 成功：`lastDispatchedAt` 记录；
  - 失败：blocked，`lastError` 记录；
  - owner 已暂停：直接 blocked，不发送；
- 重启后 active/blocked 不会被重新派发；pending 且到期的会在启动 tick 补发一次。
- 重复任务不做错过补跑：如果服务停机跨过多个周期，恢复后只按新的下一次 dueAt 执行一次。
- 不恢复进行中的 agent turn；只恢复任务状态。

## 5. UI

侧栏「任务」：

- 状态筛选；
- 显示标题、状态、负责人、房间、到期/最近派发、最近检查点、错误；
- 操作：派发、标记完成、阻塞、取消、重开、打开房间；
- 新建任务 modal：标题、描述/验收、负责 agent、派发房间、到期时间（默认 5 分钟后）。

## 6. 已验证

- 创建 `task-mwkjvmf6-76b8af`（script-peer DM，due 2 秒前）：
  - 30s tick 后 status=active，`lastDispatchedAt` 写入，checkpoint +1，房间收到任务消息；
  - 重启 app 后任务仍存在，8 秒内消息数不变、`lastDispatchedAt` 不变，没有重复派发；
  - 手动标记 done。
- 重复任务 `task-mwktdsqw-83eeb5`（interval 1 分钟，手动派发）：
  - 派发后 status 回到 pending，`dueAt` 约 1 分钟后，checkpoint 记录 `recurring dispatch; next ...`；
  - 不会在 next due 前重复派发；随后取消。
- 新增 4 个 TaskStore 单测：持久化、due/dispatch、recurring next、checkpoint/非法更新；spike 共 **38 tests**。

## 7. 边界

- 只有固定分钟间隔，没有 cron 表达式、工作日/时区规则；停机跨周期不补跑。
- 没有 agent 侧创建/更新任务的 marker；目前人类/API 创建。
- 没有自动检测完成；需要人类或 UI 标记。
- 没有重试队列/退避；失败即 blocked，人工重开。
- 没有 turn 级恢复/检查点自动生成；checkpoint 目前只由派发/API 写。
- 单机单进程；多实例需租约/去重。

## 8. 下一步

1. 固定间隔重复已完成；待做 cron/工作日/时区、错过补跑策略。
2. Agent 任务标记：`TASK:` / `DONE:` 与服务端任务关联。
3. 自动完成/失败：agent `DONE`、超时、连续失败升级。
4. 通知/告警：到期、失败、预算、审批。
5. 检查点 UI + 任务详情页。
6. 与 intake 的 `RECOMMEND` 联动：一键创建单 agent 任务或小队的任务集。
