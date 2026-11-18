# 2026-11-18-31 任务重试/需关注/开机自启

- 记录时间：2026-11-18。
- 目标：B 轨道第一批可靠性——失败重试、退避、耗尽升级、重启后 active 任务需关注、autostart。
- 关联：[17 任务台账](../17-task-ledger.md) · [18 运维](../18-operations.md) · [19 §7](../19-product-and-architecture-review.md)

## 实现

- 任务新增：
  - `maxRetries`（默认 2，0=不重试）
  - `retryCount`
  - `retryBackoffMinutes`（默认 5，指数退避 5/10/20…）
  - `needsAttention`
- `agent FAIL:` → `TaskStore.scheduleRetry`：
  - 未耗尽：status 回 pending，dueAt=now+backoff*2^(n-1)，checkpoint `retry n/max`；
  - 耗尽：一次性任务 failed、重复任务 blocked，`needsAttention=true`，checkpoint `retry exhausted`。
- BLOCK 不自动重试（通常缺信息/需人类）；发送失败也走 retry。
- 启动时 `markStale()`：active 且 lastDispatchedAt 超过 30 分钟（或无记录）→ `needsAttention=true` + checkpoint；UI 显示「需关注」。
- 新建任务 modal 可设重试次数/退避基数。
- `scripts/install-autostart.ps1`：注册 Windows 计划任务，登录时 + 每 5 分钟跑 `start-agent-im.ps1`（幂等，兼作简单 watchdog）；`-Remove` 卸载。脚本只做语法检查，未实际注册。

## 验证

- 任务「重试标记测试」，maxRetries=1/backoff=1：
  - PM 回 `FAIL: 故意失败`；
  - 任务 status=pending，retryCount=1/1，dueAt 约 1 分钟后，needsAttention=false，lastError=故意失败；
  - checkpoints: dispatched → agent FAIL → retry scheduled；
  - 房间消息 intent=failed。
- TaskStore 新增 retry/markStale 单测；spike **41 tests**。
- autostart 脚本 PowerShell 语法检查通过；未实际 Register-ScheduledTask（避免动系统）。

## 边界

- 重试是任务级，不是 turn 级；只重发任务，不恢复崩溃的 turn。
- 退避固定指数，没有 jitter/最大延迟/按错误类型区分。
- 耗尽后只标记 needsAttention，不主动通知（桌面通知只覆盖未读消息）。
- 重复任务失败重试仍保留 recurrence；耗尽变 blocked。
- `install-autostart.ps1` 是否需管理员取决于系统策略；未验证注册。
- 没有 72h soak 脚本/结果。

## 下一步

- cron/工作日/时区 + 错过补跑策略。
- needsAttention/失败/预算告警。
- 72h soak 脚本与真实运行。
- baseline（单 Claude+subagent）后再定 kill criterion 数字。
