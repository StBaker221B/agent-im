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
  "cron": null,
  "maxRetries": 2,
  "retryCount": 0,
  "retryBackoffMinutes": 5,
  "needsAttention": false,
  "priority": 0,
  "status": "pending | active | blocked | failed | done | cancelled",
  "createdAt": "...",
  "updatedAt": "...",
  "lastDispatchedAt": null,
  "lastError": null,
  "checkpoints": [{ "ts": "...", "by": "...", "text": "..." }],
  "createdBy": "@kudo:localhost"
}
```

- `dueAt` 为空 = 不自动派发，可手动“派发”。
- `intervalMinutes > 0` = 固定间隔重复；`cron` = 5 段 cron（本地时区），两者互斥。重复任务派发后 status 回到 pending 并排下一次；都为空为一次性任务（派发后 active）。
- 状态由人/UI 或 owner `DONE/BLOCK/FAIL` 更新；`FAIL` 会按退避重试，耗尽置 failed/blocked 并标记 needsAttention。

## 3. API

| API | 行为 |
|---|---|
| `GET /api/tasks` | 列出任务（附 owner/room 显示名） |
| `POST /api/tasks` | `{title,description,owner,roomId,dueAt,intervalMinutes,cron,maxRetries,retryBackoffMinutes,priority}`；创建 pending |
| `PATCH /api/tasks/:id` | 改 title/description/owner/roomId/dueAt/intervalMinutes/cron/maxRetries/retryBackoffMinutes/status/priority |
| `POST /api/tasks/:id/checkpoints` | `{text}` 追加检查点 |
| `POST /api/tasks/:id/dispatch` | 立即派发（人工触发） |

## 4. 派发语义

- 服务启动 5s 后和第 30s 周期执行一次 `tickTasks()`；
- 只派发 `status=pending` 且 `dueAt <= now` 的任务；
- 派发 = 以人类身份往 `roomId` 发一条消息，`mentions=[owner]`（有 owner 时），并带 `com.agentim.task_id/task_owner`；agent 的 per-turn prompt 会看到 taskId 和 DONE/BLOCK/FAIL 指令；
- 派发**先更新任务状态并写 checkpoint**，再发送：
  - 一次性：active；重复任务：pending，`dueAt = now + intervalMinutes`；
  - 成功：`lastDispatchedAt` 记录；
  - 发送失败：按退避重试；耗尽后 failed/blocked，`lastError` 记录；
  - owner 已暂停：直接 blocked，不发送；
- 重启后 active/blocked 不会被重新派发；pending 且到期的会在启动 tick 补发一次。
- 重复任务（interval 或 cron）不做多次补跑：停机跨过多个周期，恢复后只按下一次执行一次。cron 支持 `*`/`*/n`/`a-b`/列表，本地时区，DOM/DOW 同时受限按 OR。
- 不恢复进行中的 agent turn；只恢复任务状态。
- 启动时 active 且 lastDispatchedAt 超过 30 分钟（或无记录）→ `needsAttention=true`，UI 显示「需关注」。

### 4.1 失败重试

- `maxRetries` 默认 2，`retryBackoffMinutes` 默认 5；退避 5/10/20… 分钟。
- `FAIL`：未耗尽 → status=pending、retryCount++、dueAt=now+backoff*2^(n-1)、checkpoint `retry n/max`；耗尽 → 一次性 failed、重复 blocked，needsAttention=true。
- `BLOCK` 不自动重试（通常缺信息/需人类）。

## 5. UI

侧栏「任务」：

- 状态筛选；
- 显示标题、状态、负责人、房间、到期/最近派发、最近检查点、错误；
- 操作：派发、标记完成、阻塞、取消、重开、打开房间；
- 新建任务 modal：标题、描述/验收、负责 agent、派发房间、到期时间（默认 5 分钟后）。

### 5.1 Agent 任务标记

- 非任务消息的 prompt 提示：需要长期任务时回复 `TASK: <title>`。
- Gateway `onTaskCreate` 创建任务：owner=agent、room=当前房间、dueAt=null（不会自动回派），写 checkpoint。
- 任务派发消息带 taskId/taskOwner；agent 完成后回复 `DONE: <summary>`，阻塞/失败回复 `BLOCK: <reason>` / `FAIL: <reason>`。
- `onTaskDone`：只有 owner 能关；一次性任务 → done；重复任务只追加 checkpoint，不结束重复。
- `onTaskBlocked` / `onTaskFailed`：owner 才生效；任务变 blocked/failed，写 `lastError` 和 checkpoint；重复任务停止下一次派发。
- Agent 创建的任务需要人类在任务页手动“派发”或设置到期。

## 6. 已验证

- 创建 `task-mwkjvmf6-76b8af`（script-peer DM，due 2 秒前）：
  - 30s tick 后 status=active，`lastDispatchedAt` 写入，checkpoint +1，房间收到任务消息；
  - 重启 app 后任务仍存在，8 秒内消息数不变、`lastDispatchedAt` 不变，没有重复派发；
  - 手动标记 done。
- 重复任务 `task-mwktdsqw-83eeb5`（interval 1 分钟，手动派发）：
  - 派发后 status 回到 pending，`dueAt` 约 1 分钟后，checkpoint 记录 `recurring dispatch; next ...`；
  - 不会在 next due 前重复派发；随后取消。
- 重试测试 `task-...` maxRetries=1/backoff=1：PM `FAIL: 故意失败` → pending、retry 1/1、dueAt +1min、lastError/checkpoint 正确；随后取消。
- Agent 全链路 `task-mwktqtce-4b6c34`：PM 输出 `TASK:` → 任务创建（owner=PM, dueAt=null）→ 手动派发 active → PM 输出 `DONE:` → 任务自动 done，checkpoint 记录 `agent DONE`。
- 阻塞测试：PM 回 `BLOCK: 缺少信息` → 任务 blocked、lastError=缺少信息、checkpoint `agent BLOCK`、消息 intent=blocked。
- 新增 7 个 TaskStore 单测：持久化、due/dispatch、recurring next、cron next、retry/耗尽、markStale、checkpoint/非法更新；spike 共 **42 tests**。

## 7. 边界

- 有 5 段 cron（本地时区），但没有时区参数、节假日日历、秒级/单次 cron；停机跨周期只补一次。
- Agent 只能创建 `TASK:`、完成/阻塞/失败 owner 的任务；不能改 owner/due/interval，不能重试。
- 没有自动检测完成；需要人类或 UI 标记。
- 退避重试是任务级；没有 jitter/最大延迟/错误类型区分，不恢复 turn。
- 没有 turn 级恢复/检查点自动生成；checkpoint 目前只由派发/API 写。
- 单机单进程；多实例需租约/去重。

## 8. 下一步

1. 固定间隔 + 5 段 cron 已完成；待做时区/节假日、多次补跑策略、下次时间预览。
2. Agent `TASK:`/`DONE:`/`BLOCK:`/`FAIL:` 与失败退避重试已完成；待做耗尽通知/告警。
3. 自动完成/失败：owner DONE 已完成；待做超时、连续失败升级、证据校验。
4. 通知/告警：到期、失败、预算、审批。
5. 检查点 UI + 任务详情页。
6. 与 intake 的 `RECOMMEND` 联动：一键创建单 agent 任务或小队的任务集。
