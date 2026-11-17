# 2026-11-17-26 Agent BLOCK / FAIL 任务标记

- 记录时间：2026-11-17 晚上。
- 目标：agent 不只报成功，也能把阻塞/失败写回任务台账。
- 关联：[17 任务台账](../17-task-ledger.md) · [记录 22 TASK/DONE](2026-11-17-22-agent-task-markers.md)

## 实现

- Parser：新增 `BLOCK: <reason>` / `FAIL: <reason>`。
- Gateway：
  - 任务消息带 taskId 时，`BLOCK:` → `onTaskBlocked`；`FAIL:` → `onTaskFailed`。
  - 发送 outbound 消息：intent=`blocked` / `failed`，文本“任务阻塞/失败：...”。
  - 写 audit `task_blocked` / `task_failed`。
- Server：
  - 只有 owner 能更新；非 owner 写 checkpoint 并忽略。
  - `BLOCK` → status `blocked`，`lastError=reason`，追加 `agent BLOCK: ...` checkpoint。
  - `FAIL` → status `failed`，同上。
  - 重复任务被阻塞/失败后停在下一次；不会继续自动派发。
- TaskStore 状态增加 `failed`；UI 任务卡片显示“失败”，可重开/取消。
- Prompt 在任务 turn 里提示：完成 `DONE:`，阻塞 `BLOCK:`，失败 `FAIL:`。

## 实测

- 创建任务「阻塞标记测试」owner=PM，描述要求只回 `BLOCK: 缺少信息`，手动派发。
- PM 回复 `BLOCK: 缺少信息`：
  - 任务 status=blocked；
  - lastError=缺少信息；
  - checkpoint `agent BLOCK: 缺少信息`；
  - 房间消息 intent=blocked。
- 随后取消测试任务。
- 单测增加 failed 状态断言；spike 38 tests。

## 边界

- 没有失败重试/退避/自动升级；失败即停，人工重开。
- 没有结构化失败原因/证据校验。
- 阻塞/失败后仍可被 owner 的 DONE 改成 done（如果后来解决了）。
- 没有通知/告警；只在任务页和消息里可见。

## 下一步

- 连续失败自动升级/通知。
- 失败重试（N 次/退避）与人工批准。
- 失败原因分类与任务详情。
