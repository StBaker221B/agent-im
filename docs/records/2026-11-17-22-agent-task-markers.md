# 2026-11-17-22 Agent 任务标记 TASK / DONE

- 记录时间：2026-11-17 下午。
- 目标：让 agent 能参与任务台账，而不是只有人类能建/关任务。
- 关联：[17 任务台账](../17-task-ledger.md) · [16 长期驻守](../16-long-running-and-intake.md) · [记录 21](2026-11-17-21-task-ledger.md)

## 实现

- `parseReply` 新增 `TASK: <title>`；原有 `DONE: <summary>` 继续用。
- Gateway 新增回调：
  - `onTaskCreate`：agent 输出 `TASK:` → 服务端创建任务（owner=agent、room、dueAt=null、createdBy=agent），并写 checkpoint；
  - `onTaskDone`：任务派发消息带 `taskId/taskOwner`（Matrix custom content），agent 输出 `DONE:` 时服务端按 taskId 关任务。
- 任务派发消息：
  - `human.send` 增加 `taskId/taskOwner`；
  - Matrix transport 已有 `com.agentim.task_id/task_owner`；
  - per-turn prompt 带 “This message is task ... When you finish, reply exactly: DONE: <summary>”；
  - 非任务消息的 prompt 带 “If you need to record a long-running task, reply exactly: TASK: <title>”。
- 完成规则：
  - 只有 owner 的 `DONE` 能关任务；
  - 一次性 active → done；
  - 重复任务只追加 `agent DONE` checkpoint，不结束重复；
  - 非 owner 的 DONE 被忽略并写 checkpoint。
- Agent 创建的任务 `dueAt=null`，不会自动回派给 agent；人类可在任务页“派发”或改到期。

## 实测

全链路：

1. 人类对 PM 说“请只回复一行：TASK: agent任务标记测试”。PM 输出 `TASK:`。
2. Gateway 创建 `task-mwktqtce-4b6c34`，owner=PM，room=PM DM，dueAt=null，checkpoint `created via TASK`。
3. 手动派发 → 任务 active；任务消息带 taskId/taskOwner；prompt 要求 DONE。
4. PM 回复 `DONE: ...` → 任务自动变 done，checkpoint 记录 `agent DONE: ...`。
5. 房间消息显示“已记录任务”和最终 DONE。

## 边界

- Agent 不能改任务 owner/dueAt/interval；只能创建（pending）和完成（owner 的 DONE）。
- Agent 创建的任务默认不自动派发，避免自己触发自己。
- 没有“任务失败/阻塞”的 agent 标记；只有人类/API 能标记。
- 完成是字符串级 `DONE:`，没有结构化产物/证据校验。
- 没有 turn 级恢复；如果 agent 在 DONE 前崩溃，任务保持 active，需人工处理。

## 下一步

- `BLOCK:` / `FAIL:` 标记与自动升级；
- 任务关联 artifact（diff/PR/文件）；
- 自动完成证据校验（测试是否真的跑过）；
- UI 任务详情/编辑 owner/due；
- recurring 的每次 run 记录/历史。
